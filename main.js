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
let LlamaChatSession = null;

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
    const llama = await nodeLlamaCpp.getLlama();
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
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-i",
      inputPath,
      "-ar",
      "16000",
      "-ac",
      "1",
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
    const args = [
      "-m",
      modelPath,
      "-f",
      wavPath,
      "-l",
      "ja",
      "-otxt",
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
      // -otxt オプションで wavPath.txt に出力される
      const txtFile = wavPath + ".txt";
      if (fs.existsSync(txtFile)) {
        const text = fs.readFileSync(txtFile, "utf-8").trim();
        fs.unlinkSync(txtFile); // 一時ファイル削除
        resolve([{ speech: text, start: 0, end: 0 }]);
      } else {
        resolve([{ speech: "(音声を認識できませんでした)", start: 0, end: 0 }]);
      }
    });
    proc.on("error", (e) =>
      reject(new Error(`Whisper 起動失敗: ${e.message}`)),
    );
  });
}

async function formatWithLLM(rawSegments) {
  const rawText = rawSegments.map((s) => s.speech || s.text || "").join("\n");
  const prompt = `以下は音声認識の生テキストです。会話形式に整形し、話者が複数いる場合は「話者A:」「話者B:」のように区別してください。また最後に【要点】として重要ポイントを箇条書きしてください。\n\nテキスト:\n${rawText}\n\n整形後:`;

  if (!llamaModel) {
    const ok = await initLlama();
    if (!ok) {
      return `【文字起こし結果】\n${rawText}\n\n【注記】\nLLM モデルが見つかりません。models/ フォルダに ${MODEL_FILE} を配置してください。`;
    }
  }
  let sequence = null;
  try {
    sequence = llamaContext.getSequence();
    const session = new LlamaChatSession({ contextSequence: sequence });
    const response = await session.prompt(prompt);
    return response;
  } catch (e) {
    console.error("[LLAMA] formatWithLLM エラー:", e.message);
    return `【文字起こし結果】\n${rawText}\n\n【注記】\nAI 整形エラー: ${e.message}`;
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
      const segments = await transcribeAudio(tmpWav);
      console.log("Whisper 結果:", segments);
      if (!segments || segments.length === 0) {
        return { success: false, message: "音声を認識できませんでした。" };
      }
      mainWindow.webContents.send("status-update", {
        message: "テキストを整形中...",
        type: "info",
      });
      const formatted = await formatWithLLM(segments);
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
          { segments, formatted, createdAt: new Date().toISOString() },
          null,
          2,
        ),
        "utf-8",
      );
      return { success: true, segments, formatted, filePath: outFile };
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
