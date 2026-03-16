/**
 * sherpa-onnx 話者分離 動作確認スクリプト
 * 使い方: node test-diarization.js [WAVファイルパス]
 */
const path = require("path");
const fs = require("fs");
const os = require("os");

// --- モデルパス ---
const MODEL_DIR = path.join(__dirname, "models", "diarization");
const SEG_MODEL = path.join(MODEL_DIR, "segmentation.onnx");
const EMB_MODEL = path.join(MODEL_DIR, "embedding.onnx");

// --- テスト用 WAV 生成（16kHz, 1ch, 3秒の無音） ---
function createSilentWav(filePath, sampleRate = 16000, durationSec = 3) {
  const numSamples = sampleRate * durationSec;
  const dataSize = numSamples * 2; // 16-bit
  const buf = Buffer.alloc(44 + dataSize, 0);

  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // channels
  buf.writeUInt32LE(sampleRate, 24); // sample rate
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(filePath, buf);
}

async function main() {
  console.log("=== sherpa-onnx 話者分離 動作確認 ===\n");

  // 1. モデルファイル確認
  console.log("[1] モデルファイル確認");
  for (const [name, p] of [
    ["segmentation", SEG_MODEL],
    ["embedding", EMB_MODEL],
  ]) {
    if (fs.existsSync(p)) {
      const mb = (fs.statSync(p).size / 1024 / 1024).toFixed(1);
      console.log(`  [OK] ${name}: ${p} (${mb} MB)`);
    } else {
      console.error(`  [ERR] ${name} が見つかりません: ${p}`);
      process.exit(1);
    }
  }

  // 2. sherpa-onnx ロード確認
  console.log("\n[2] sherpa-onnx モジュール読み込み");
  let SherpaOnnx;
  try {
    SherpaOnnx = require("sherpa-onnx");
    console.log("  [OK] sherpa-onnx ロード成功");
    if (SherpaOnnx.version) console.log("  版本:", SherpaOnnx.version);
  } catch (e) {
    console.error("  [ERR] sherpa-onnx ロード失敗:", e.message || e);
    process.exit(1);
  }

  // 3. OfflineSpeakerDiarization 初期化
  console.log("\n[3] OfflineSpeakerDiarization 初期化");
  let sd;
  try {
    sd = SherpaOnnx.createOfflineSpeakerDiarization({
      segmentation: {
        pyannote: { model: SEG_MODEL },
        numThreads: 1,
        debug: 1,
        provider: "cpu",
      },
      embedding: {
        model: EMB_MODEL,
        numThreads: 1,
        debug: 1,
        provider: "cpu",
      },
      clustering: {
        numClusters: -1,
        threshold: 0.5,
      },
      minDurationOn: 0.3,
      minDurationOff: 0.5,
    });
    if (!sd || !sd.handle) {
      console.error("  [ERR] handle=0: モデル初期化失敗");
      process.exit(1);
    }
    console.log(
      `  [OK] 初期化成功  handle=${sd.handle}  期待サンプルレート=${sd.sampleRate} Hz`,
    );
  } catch (e) {
    if (typeof e === "number") {
      console.error(`  [ERR] WASM C++ 例外 (ptr=${e})`);
      console.error(
        "  → モデルファイルの破損 or sherpa-onnx バージョン非互換の可能性",
      );
    } else {
      console.error("  [ERR]", e.message || e);
    }
    process.exit(1);
  }

  // 4. WAV ファイルの準備
  const wavPath = process.argv[2] || path.join(os.tmpdir(), "test_silence.wav");
  if (!process.argv[2]) {
    console.log("\n[4] テスト用無音 WAV を生成 (16kHz, 3秒)");
    createSilentWav(wavPath, 16000, 3);
    console.log("  生成先:", wavPath);
  } else {
    console.log("\n[4] 指定 WAV:", wavPath);
    if (!fs.existsSync(wavPath)) {
      console.error("  [ERR] ファイルが見つかりません");
      process.exit(1);
    }
  }

  // 5. WAV 読み込み
  console.log("\n[5] WAV 読み込み");
  let wave;
  try {
    wave = SherpaOnnx.readWave(wavPath);
    if (!wave || !wave.samples) throw new Error("samples が null");
    console.log(
      `  [OK] samples=${wave.samples.length}  sampleRate=${wave.sampleRate} Hz`,
    );
    if (wave.sampleRate !== sd.sampleRate) {
      console.warn(
        `  [!!] サンプルレート不一致! WAV=${wave.sampleRate} Hz, モデル期待値=${sd.sampleRate} Hz`,
      );
      console.warn("      話者分離が機能しない可能性があります");
    }
  } catch (e) {
    console.error("  [ERR] WAV 読み込み失敗:", e.message || e);
    process.exit(1);
  }

  // 6. 話者分離処理
  console.log("\n[6] 話者分離処理");
  let result;
  try {
    result = sd.process(wave.samples);
    if (sd.free) sd.free();
    console.log(
      `  [OK] 処理完了  セグメント数=${Array.isArray(result) ? result.length : "?(非配列)"}`,
    );
    if (Array.isArray(result) && result.length > 0) {
      console.log("\n  セグメント一覧:");
      result.forEach((seg, i) => {
        console.log(
          `    [${i}] start=${seg.start?.toFixed(2)}s  end=${seg.end?.toFixed(2)}s  speaker=${seg.speaker}`,
        );
      });
    } else {
      console.log("  セグメントなし（無音ファイルのため正常）");
    }
  } catch (e) {
    if (typeof e === "number") {
      console.error(`  [ERR] WASM C++ 例外 (ptr=${e})`);
    } else {
      console.error("  [ERR]", e.message || e);
    }
    process.exit(1);
  }

  console.log("\n=== 話者分離は正常に機能しています ===");
}

main();
