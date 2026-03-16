/**
 * 話者分離ワーカー (子プロセス)
 * main.js から spawn('node', ['diarize-worker.js', JSON]) で起動される。
 * 結果は最終行に JSON を stdout へ書き込む。
 * WASM クラッシュが起きてもメインプロセスには影響しない。
 */
"use strict";

const SherpaOnnx = require("sherpa-onnx");

function ok(segments) {
  process.stdout.write(JSON.stringify({ segments }) + "\n");
  process.exit(0);
}

function fail(msg) {
  process.stdout.write(JSON.stringify({ error: msg }) + "\n");
  process.exit(1);
}

let args;
try {
  args = JSON.parse(process.argv[2] || "{}");
} catch (e) {
  fail("引数のパースに失敗: " + e.message);
}

const { segModel, embModel, wavPath } = args;
if (!segModel || !embModel || !wavPath) fail("引数が不足しています");

// ---- 初期化 ----
let sd;
try {
  sd = SherpaOnnx.createOfflineSpeakerDiarization({
    segmentation: {
      pyannote: { model: segModel },
      numThreads: 1,
      debug: 0,
      provider: "cpu",
    },
    embedding: {
      model: embModel,
      numThreads: 1,
      debug: 0,
      provider: "cpu",
    },
    clustering: { numClusters: -1, threshold: 0.55 },
    minDurationOn: 0.2,
    minDurationOff: 0.3,
  });
} catch (e) {
  const msg =
    typeof e === "number" ? "WASM例外 ptr=" + e : e.message || String(e);
  fail("初期化エラー: " + msg);
}

if (!sd || !sd.handle) fail("初期化失敗 (handle=0)");

// ---- WAV 読み込み ----
let wave;
try {
  wave = SherpaOnnx.readWave(wavPath);
  if (!wave || !wave.samples) fail("WAV 読み込み失敗");
} catch (e) {
  fail("readWave エラー: " + (e.message || String(e)));
}

// ---- 話者分離処理 ----
let result;
try {
  result = sd.process(wave.samples);
  if (sd.free) sd.free();
} catch (e) {
  if (sd && sd.free)
    try {
      sd.free();
    } catch (_) {}
  const msg =
    typeof e === "number" ? "WASM例外 ptr=" + e : e.message || String(e);
  fail("process() エラー: " + msg);
}

if (!Array.isArray(result)) {
  ok([]);
} else {
  ok(
    result.map((seg) => ({
      start: seg.start,
      end: seg.end,
      speaker: seg.speaker,
    })),
  );
}
