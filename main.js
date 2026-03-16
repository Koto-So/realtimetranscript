const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const os = require("os");

// Windows: コンソール出力をUTF-8に統一
if (process.platform === "win32") {
  process.stdout.reconfigure?.({ encoding: "utf8" });
  process.stderr.reconfigure?.({ encoding: "utf8" });
}

let mainWindow;
const MODEL_FILE = "Qwen3.5-0.8B-Q4_K_M.gguf";

// node-llama-cpp インスタンス (ESM なので dynamic import で読み込む)
let llamaModel = null;
let llamaContext = null;
let llamaInstance = null;
let LlamaChatSession = null;
let LlamaJsonSchemaGrammar = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow.loadFile("index.html");
  if (
    process.argv.includes("--dev") ||
    process.env.NODE_ENV === "development"
  ) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(async () => {
  createWindow();
  // レンダラーが完全にロードされてから LLM モデルを初期化する
  mainWindow.webContents.once("did-finish-load", async () => {
    await initLlama();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// GGUF モデルパスを解決（パッケージ版 / 開発版 共通）
function getModelPath() {
  const packed = path.join(process.resourcesPath || "", "models", MODEL_FILE);
  if (packed && fs.existsSync(packed)) {
    console.log("[LLAMA] パッケージ同梱モデル使用:", packed);
    return packed;
  }
  const dev = path.join(__dirname, "models", MODEL_FILE);
  if (fs.existsSync(dev)) {
    console.log("[LLAMA] ローカルモデル使用:", dev);
    return dev;
  }
  console.error("[LLAMA] GGUF モデルが見つかりません:", MODEL_FILE);
  return null;
}

// LLM モデルを初期化（起動時に一度だけ実行）
async function initLlama() {
  if (llamaModel) return true;
  const modelPath = getModelPath();
  if (!modelPath) {
    if (mainWindow) {
      mainWindow.webContents.send("status-update", {
        message: `LLM モデルが見つかりません。models/${MODEL_FILE} に配置してください。`,
        type: "error",
      });
    }
    return false;
  }
  try {
    if (mainWindow) {
      mainWindow.webContents.send("status-update", {
        message: "LLM モデルを読み込み中...",
        type: "info",
      });
    }
    const nodeLlamaCpp = await import("node-llama-cpp");
    LlamaChatSession = nodeLlamaCpp.LlamaChatSession;
    LlamaJsonSchemaGrammar = nodeLlamaCpp.LlamaJsonSchemaGrammar;
    const llama = await nodeLlamaCpp.getLlama();
    llamaInstance = llama;
    llamaModel = await llama.loadModel({ modelPath });
    llamaContext = await llamaModel.createContext({ sequences: 1 });
    console.log("[LLAMA] モデル読み込み完了:", modelPath);
    if (mainWindow) {
      mainWindow.webContents.send("status-update", {
        message: "LLM 準備完了",
        type: "success",
      });
    }
    return true;
  } catch (e) {
    console.error("[LLAMA] 初期化エラー:", e.message);
    llamaModel = null;
    llamaContext = null;
    llamaInstance = null;
    if (mainWindow) {
      mainWindow.webContents.send("status-update", {
        message: "LLM 初期化エラー: " + e.message,
        type: "error",
      });
    }
    return false;
  }
}

function getFfmpegPath() {
  // 1. パッケージ版: process.resourcesPath に extraResource が展開される
  const packed = path.join(process.resourcesPath || "", "ffmpeg", "ffmpeg.exe");
  if (packed && fs.existsSync(packed)) {
    console.log("[FFMPEG] パッケージ同梱バイナリ使用:", packed);
    return packed;
  }
  // 2. 開発版: プロジェクトルートの resources/ フォルダ
  const dev = path.join(__dirname, "resources", "ffmpeg", "ffmpeg.exe");
  if (fs.existsSync(dev)) {
    console.log("[FFMPEG] ローカル同梱バイナリ使用:", dev);
    return dev;
  }
  // 3. システム PATH から検索
  const { execSync } = require("child_process");
  try {
    const p = execSync("where ffmpeg", { encoding: "utf-8" })
      .split("\n")[0]
      .trim();
    if (p && fs.existsSync(p)) {
      console.log("[FFMPEG] システムバイナリ使用:", p);
      return p;
    }
  } catch (_) {}
  console.warn(
    "[FFMPEG] ffmpeg が見つかりません。resources/ffmpeg/ffmpeg.exe に配置してください。",
  );
  return "ffmpeg";
}

async function convertToWav(inputPath, outputPath) {
  const ffmpeg = getFfmpegPath();

  // ffmpeg バージョンに応じて使用可能なフィルタを自動選択
  function getAudioFilter() {
    try {
      const result = require("child_process").spawnSync(ffmpeg, ["-filters"], {
        encoding: "utf8",
        timeout: 5000,
      });
      const out = (result.stdout || "") + (result.stderr || "");
      if (out.includes("afftdn")) {
        console.log("[FFMPEG] フィルタ: afftdn (スペクトル減算ノイズ除去)");
        return "highpass=f=80,lowpass=f=8000,afftdn=nf=-25";
      } else if (out.includes("anlmdn")) {
        console.log("[FFMPEG] フィルタ: anlmdn (非局所平均ノイズ除去)");
        return "highpass=f=80,lowpass=f=8000,anlmdn";
      } else {
        console.log("[FFMPEG] フィルタ: 基本のみ (古いffmpeg検出)");
        return "highpass=f=80,lowpass=f=8000";
      }
    } catch (_) {
      return "highpass=f=80,lowpass=f=8000";
    }
  }

  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-i",
      inputPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-af",
      getAudioFilter(),
      "-c:a",
      "pcm_s16le",
      outputPath,
    ];
    const proc = spawn(ffmpeg, args, { stdio: "pipe" });
    proc.stderr.on("data", (d) => console.log("[ffmpeg]", d.toString().trim()));
    proc.on("close", (code) =>
      code === 0
        ? resolve(outputPath)
        : reject(new Error(`ffmpeg code: ${code}`)),
    );
  });
}

async function transcribeAudio(wavPath) {
  // whisper.cpp バイナリと モデルへの絶対パス
  // asar パッケージ内のバイナリは実行できないため、asarUnpack 以下のパスを使う
  const appRoot = app.getAppPath().replace(/app\.asar$/, "app.asar.unpacked");
  const whisperDir = path.join(
    appRoot,
    "node_modules",
    "whisper-node",
    "lib",
    "whisper.cpp",
  );
  const mainExe = path.join(whisperDir, "main.exe");
  const modelPath = path.join(whisperDir, "models", "ggml-base.bin");

  if (!fs.existsSync(mainExe)) {
    throw new Error(`whisper main.exe が見つかりません: ${mainExe}`);
  }
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Whisper モデルが見つかりません: ${modelPath}`);
  }

  return new Promise((resolve, reject) => {
    // -oj でタイムスタンプ付き JSON を出力
    const args = [
      "-m",
      modelPath,
      "-f",
      wavPath,
      "-l",
      "ja",
      "-oj",
      "-of",
      wavPath,
    ];
    console.log("[WHISPER] 実行:", mainExe, args.join(" "));
    const proc = spawn(mainExe, args, { cwd: whisperDir, stdio: "pipe" });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      console.log("[WHISPER]", d.toString().trim());
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Whisper が失敗しました (code ${code}): ${stderr.slice(-300)}`,
          ),
        );
        return;
      }
      // -oj オプションで wavPath.json に出力される
      const jsonFile = wavPath + ".json";
      if (fs.existsSync(jsonFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));
          fs.unlinkSync(jsonFile);
          const segments = (data.transcription || [])
            .map((seg) => ({
              text: (seg.text || "").trim(),
              start_ms: seg.offsets?.from ?? 0,
              end_ms: seg.offsets?.to ?? 0,
            }))
            .filter((s) => s.text);
          resolve(
            segments.length > 0
              ? segments
              : [
                  {
                    text: "(音声を認識できませんでした)",
                    start_ms: 0,
                    end_ms: 0,
                  },
                ],
          );
        } catch (e) {
          resolve([{ text: "(JSON解析エラー)", start_ms: 0, end_ms: 0 }]);
        }
      } else {
        resolve([
          { text: "(音声を認識できませんでした)", start_ms: 0, end_ms: 0 },
        ]);
      }
    });
    proc.on("error", (e) =>
      reject(new Error(`Whisper 起動失敗: ${e.message}`)),
    );
  });
}

// 話者分離モデルのパスを取得
function getDiarizationModelPath() {
  const candidates = [
    path.join(process.resourcesPath || "", "models", "diarization"),
    path.join(__dirname, "models", "diarization"),
  ];
  for (const dir of candidates) {
    const seg = path.join(dir, "segmentation.onnx");
    const emb = path.join(dir, "embedding.onnx");
    if (fs.existsSync(seg) && fs.existsSync(emb)) {
      return { segmentation: seg, embedding: emb };
    }
  }
  return null;
}

// sherpa-onnx による話者分離 (子プロセスで実行して WASM クラッシュを隔離)
async function diarizeAudio(wavPath) {
  const models = getDiarizationModelPath();
  if (!models) {
    console.warn("[DIAR] モデルが見つかりません。話者分離をスキップします。");
    return null;
  }

  console.log("[DIAR] 話者分離開始 (子プロセス):", wavPath);

  return new Promise((resolve) => {
    const { spawn } = require("child_process");
    const workerPath = path.join(__dirname, "diarize-worker.js");
    const nodeBin = process.execPath; // 現在の node バイナリのパス

    const args = JSON.stringify({
      segModel: models.segmentation,
      embModel: models.embedding,
      wavPath,
    });

    const worker = spawn(nodeBin, [workerPath, args], {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutBuf = "";
    let resolved = false;
    const finish = (val) => {
      if (!resolved) {
        resolved = true;
        resolve(val);
      }
    };

    worker.stdout.on("data", (d) => {
      stdoutBuf += d.toString();
    });

    worker.stderr.on("data", (d) => {
      // ONNX の debug ログを除き重要なメッセージだけ出力
      const line = d.toString().trim();
      if (line && !line.includes("sherpa-onnx/sherpa-onnx")) {
        console.log("[DIAR-worker]", line);
      }
    });

    worker.on("close", (code) => {
      const lastLine = stdoutBuf.trim().split("\n").pop() || "";
      try {
        const msg = JSON.parse(lastLine);
        if (msg.error) {
          console.error("[DIAR] エラー:", msg.error);
          finish(null);
        } else if (Array.isArray(msg.segments)) {
          console.log(
            "[DIAR] 話者分離完了:",
            msg.segments.length,
            "セグメント",
          );
          finish(msg.segments.length > 0 ? msg.segments : null);
        } else {
          finish(null);
        }
      } catch (_) {
        if (code !== 0) {
          console.error("[DIAR] 子プロセス異常終了 (code=" + code + ")");
        }
        finish(null);
      }
    });

    worker.on("error", (e) => {
      console.error("[DIAR] spawn エラー:", e.message);
      finish(null);
    });

    // 2分タイムアウト
    setTimeout(() => {
      if (!resolved) {
        console.error("[DIAR] タイムアウト (2分)");
        worker.kill();
        finish(null);
      }
    }, 120000);
  });
}

// whisper のタイムスタンプ付きセグメントと話者分離結果をアライメント
function alignSpeakers(whisperSegments, diarSegments) {
  if (!diarSegments || diarSegments.length === 0) {
    // 話者分離なし: speaker=1 を付与するだけ
    return whisperSegments.map((s) => ({ ...s, speaker: 1 }));
  }
  return whisperSegments.map((ws) => {
    const wsStart = ws.start_ms / 1000;
    const wsEnd = ws.end_ms / 1000;
    let bestSpeaker = 1;
    let bestOverlap = 0;
    for (const ds of diarSegments) {
      const overlap = Math.max(
        0,
        Math.min(wsEnd, ds.end) - Math.max(wsStart, ds.start),
      );
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSpeaker = ds.speaker + 1; // 0-indexed → 1-indexed
      }
    }
    return { ...ws, speaker: bestSpeaker };
  });
}

async function formatWithLLM(rawSegments) {
  // speaker フィールドがある場合は話者ラベル付き、ない場合はプレーン
  const hasSpeakers = rawSegments.some((s) => s.speaker && s.speaker > 0);
  const rawText = rawSegments
    .map((s) => {
      const text = (s.text || s.speech || "").trim();
      if (hasSpeakers && s.speaker) return `[話者${s.speaker}]: ${text}`;
      return text;
    })
    .join("\n");

  if (!llamaModel) {
    const ok = await initLlama();
    if (!ok) return rawText;
  }

  // 構造化出力スキーマ: transcript フィールドのみ
  const schema = {
    type: "object",
    properties: {
      transcript: { type: "string" },
    },
    required: ["transcript"],
  };

  const speakerInstruction = hasSpeakers
    ? "[話者N] の表記は「話者A:」「話者B:」のように置き換えること。"
    : "";
  const prompt = `あなたは音声認識テキストのノイズ除去専門家です。\
以下のルールに従ってテキストを整形し、JSON の transcript フィールドに出力してください。

ルール:
- 認識エラーや意味不明な断片は自然な日本語に修正する
- 言い直し・繰り返し・フィラー（えー、あの、えっと等）を除去する
- 文末を適切に整える
- ${speakerInstruction}要点・箇条書き・見出しなど余計なセクションは一切追加しない
- トランスクリプト本文のみを出力する

入力:
${rawText}

JSON:`;

  let sequence = null;
  try {
    const grammar = new LlamaJsonSchemaGrammar(llamaInstance, schema);
    sequence = llamaContext.getSequence();
    const session = new LlamaChatSession({ contextSequence: sequence });
    const response = await session.prompt(prompt, { grammar });
    // JSON をパースして transcript フィールドを取り出す
    const parsed = JSON.parse(response);
    return parsed.transcript ?? rawText;
  } catch (e) {
    console.error("[LLAMA] formatWithLLM エラー:", e.message);
    return rawText;
  } finally {
    if (sequence) sequence.dispose();
  }
}

async function generateSummaryLLM(transcriptText, onChunk) {
  const prompt = `以下のミーティング内容を要約してください。重要な決定事項、アクションアイテム、次のステップを含めてください。\n\n${transcriptText}\n\n要約:`;

  if (!llamaModel) {
    const ok = await initLlama();
    if (!ok) return "LLM モデルが見つかりません。";
  }
  let sequence = null;
  try {
    sequence = llamaContext.getSequence();
    const session = new LlamaChatSession({ contextSequence: sequence });
    const response = await session.prompt(prompt, {
      onTextChunk: (chunk) => {
        if (onChunk) onChunk(chunk);
      },
    });
    return response;
  } catch (e) {
    console.error("[LLAMA] generateSummaryLLM エラー:", e.message);
    return `要約生成に失敗しました。\n\nエラー: ${e.message}`;
  } finally {
    if (sequence) sequence.dispose();
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

ipcMain.handle(
  "process-audio",
  async (event, { audioDataBase64, mimeType }) => {
    const tmpDir = path.join(os.tmpdir(), "realtimetranscript");
    fs.mkdirSync(tmpDir, { recursive: true });
    const ext = mimeType.includes("webm") ? "webm" : "wav";
    const tmpInput = path.join(tmpDir, `rec_${Date.now()}.${ext}`);
    const tmpWav = path.join(tmpDir, `wav_${Date.now()}.wav`);
    try {
      fs.writeFileSync(tmpInput, Buffer.from(audioDataBase64, "base64"));
      console.log("録音保存:", tmpInput);
      mainWindow.webContents.send("status-update", {
        message: "音声を変換中...",
        type: "info",
      });
      await convertToWav(tmpInput, tmpWav);
      mainWindow.webContents.send("status-update", {
        message: "文字起こし中...",
        type: "info",
      });
      const whisperSegments = await transcribeAudio(tmpWav);
      console.log("[WHISPER] 結果:", whisperSegments);
      if (!whisperSegments || whisperSegments.length === 0) {
        return { success: false, message: "音声を認識できませんでした。" };
      }
      mainWindow.webContents.send("status-update", {
        message: "話者分離中...",
        type: "info",
      });
      const diarSegments = await diarizeAudio(tmpWav);
      const segments = alignSpeakers(whisperSegments, diarSegments);
      // AI整形はボタン押下時に実行するため、ここでは行わない
      // asar 内は書き込み不可のため userData に保存する
      const transcriptsDir = path.join(app.getPath("userData"), "transcripts");
      fs.mkdirSync(transcriptsDir, { recursive: true });
      const outFile = path.join(
        transcriptsDir,
        `transcript_${Date.now()}.json`,
      );
      fs.writeFileSync(
        outFile,
        JSON.stringify(
          { segments, formatted: null, createdAt: new Date().toISOString() },
          null,
          2,
        ),
        "utf-8",
      );
      return { success: true, segments, filePath: outFile };
    } catch (e) {
      console.error("音声処理エラー:", e);
      return { success: false, message: e.message };
    } finally {
      try {
        fs.unlinkSync(tmpInput);
      } catch (_) {}
      try {
        fs.unlinkSync(tmpWav);
      } catch (_) {}
    }
  },
);

// AI整形ハンドラ: セグメントを受け取り LLM で整形して返す
ipcMain.handle("format-transcript", async (event, segments) => {
  try {
    mainWindow.webContents.send("status-update", {
      message: "AI整形中...",
      type: "info",
    });
    const formatted = await formatWithLLM(segments);
    return { success: true, formatted };
  } catch (e) {
    console.error("AI整形エラー:", e);
    return { success: false, message: e.message };
  }
});

ipcMain.handle("generate-summary", async (event, transcriptText) => {
  try {
    mainWindow.webContents.send("status-update", {
      message: "要約を生成中...",
      type: "info",
    });
    const summary = await generateSummaryLLM(transcriptText, (chunk) => {
      mainWindow.webContents.send("summary-chunk", chunk);
    });
    return { success: true, summary };
  } catch (e) {
    console.error("要約生成エラー:", e);
    return { success: false, message: e.message };
  }
});

ipcMain.handle("list-transcripts", async () => {
  try {
    const dir = path.join(app.getPath("userData"), "transcripts");
    if (!fs.existsSync(dir)) return { success: true, transcripts: [] };
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const fp = path.join(dir, f);
        const stat = fs.statSync(fp);
        return { name: f, path: fp, created: stat.birthtime };
      })
      .sort((a, b) => b.created - a.created)
      .slice(0, 20);
    return { success: true, transcripts: files };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

// 過去のトランスクリプトを読み込む
ipcMain.handle("read-transcript", async (event, filePath) => {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return { success: true, ...data };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

ipcMain.handle("check-llm", async () => {
  const modelPath = getModelPath();
  return {
    success: !!llamaModel,
    loaded: !!llamaModel,
    modelFile: MODEL_FILE,
    modelFound: !!modelPath,
  };
});
