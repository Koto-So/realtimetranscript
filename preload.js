const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // 音声データを送信してWhisper + LLM処理
  processAudio: (data) => ipcRenderer.invoke("process-audio", data),
  // 要約生成
  generateSummary: (text) => ipcRenderer.invoke("generate-summary", text),
  // 過去の録音一覧
  listTranscripts: () => ipcRenderer.invoke("list-transcripts"),
  // 過去のトランスクリプトをパス指定で読み込む
  readTranscript: (filePath) => ipcRenderer.invoke("read-transcript", filePath),
  // LLM モデルの状態確認
  checkLlm: () => ipcRenderer.invoke("check-llm"),
  // ステータス更新受信
  onStatusUpdate: (callback) => {
    ipcRenderer.on("status-update", (event, data) => callback(data));
  },
  // 要約ストリーミング受信
  onSummaryChunk: (callback) => {
    ipcRenderer.on("summary-chunk", (event, chunk) => callback(chunk));
  },
});
