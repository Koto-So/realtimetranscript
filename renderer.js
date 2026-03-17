// ===== DOM 要素 =====
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const formatBtn = document.getElementById("formatBtn");
const summaryBtn = document.getElementById("summaryBtn");
const clearBtn = document.getElementById("clearBtn");
const copyBtn = document.getElementById("copyBtn");
const transcriptArea = document.getElementById("transcriptArea");
const summaryArea = document.getElementById("summaryArea");
const statusText = document.getElementById("statusText");
const statusIndicator = document.getElementById("statusIndicator");
const transcriptsList = document.getElementById("transcriptsList");
const waveformContainer = document.getElementById("waveformContainer");
const waveformCanvas = document.getElementById("waveformCanvas");
const recordingTimeEl = document.getElementById("recordingTime");
const recordingSvg = document.getElementById("recordingSvg");
const ollamaStatusEl = document.getElementById("ollamaStatus");

// ===== 状態 =====
let mediaRecorder = null;
let audioChunks = [];
let recordingStream = null;
let audioContext = null;
let analyser = null;
let animFrameId = null;
let recordingStartTime = null;
let timerInterval = null;
let currentFormattedText = "";
let currentRawSegments = null;

// ===== LLM モデル状態確認 =====
async function checkOllama() {
  try {
    const result = await window.electronAPI.checkLlm();
    if (result.loaded) {
      ollamaStatusEl.textContent = " LLM 準備完了";
      ollamaStatusEl.className = "ollama-status connected";
    } else if (result.modelFound) {
      ollamaStatusEl.textContent = " LLM 読み込み中...";
      ollamaStatusEl.className = "ollama-status warning";
      setTimeout(checkOllama, 2000);
    } else {
      ollamaStatusEl.textContent = ` LLM モデル未配置 (${result.modelFile})`;
      ollamaStatusEl.className = "ollama-status error";
    }
  } catch (e) {
    ollamaStatusEl.textContent = " LLM エラー";
    ollamaStatusEl.className = "ollama-status error";
  }
}

// ===== ステータス更新受信 =====
window.electronAPI.onStatusUpdate((data) => {
  setStatus(data.message, data.type || "info");
});

// ===== 要約ストリーミング受信 =====
window.electronAPI.onSummaryChunk((chunk) => {
  const existing = summaryArea.querySelector(".summary-text");
  if (existing) {
    existing.textContent += chunk;
  } else {
    summaryArea.innerHTML = "";
    const div = document.createElement("div");
    div.className = "summary-text";
    div.textContent = chunk;
    summaryArea.appendChild(div);
  }
  summaryArea.scrollTop = summaryArea.scrollHeight;
});

// ===== 録音開始 =====
startBtn.addEventListener("click", async () => {
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    audioChunks = [];

    // 波形解析
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(recordingStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    // MediaRecorder
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    mediaRecorder = new MediaRecorder(recordingStream, { mimeType });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.start(100);

    // UI 更新
    startBtn.disabled = true;
    stopBtn.disabled = false;
    waveformContainer.style.display = "flex";
    startBtn.classList.add("btn-recording");
    recordingSvg.src = "resources/svg/recording_doing.svg";
    setStatus("録音中...", "recording");

    // タイマー
    recordingStartTime = Date.now();
    timerInterval = setInterval(updateTimer, 500);

    // 波形描画
    drawWaveform();

    transcriptArea.innerHTML =
      '<p class="placeholder loading-dots">録音中です。停止ボタンを押すと文字起こしを開始します</p>';
    summaryArea.innerHTML =
      '<p class="placeholder">文字起こし後にAI整形→要約の順に実行できます。</p>';
    formatBtn.disabled = true;
    summaryBtn.disabled = true;
    copyBtn.disabled = true;
    currentFormattedText = "";
    currentRawSegments = null;
  } catch (e) {
    setStatus("マイクへのアクセスが拒否されました: " + e.message, "error");
    showToast("マイクの使用を許可してください", "error");
  }
});

// ===== 録音停止解析 =====
stopBtn.addEventListener("click", async () => {
  if (!mediaRecorder) return;

  stopBtn.disabled = true;
  startBtn.disabled = true;

  // 録音停止
  mediaRecorder.stop();
  recordingStream.getTracks().forEach((t) => t.stop());
  clearInterval(timerInterval);
  cancelAnimationFrame(animFrameId);
  waveformContainer.style.display = "none";
  startBtn.classList.remove("btn-recording");
  recordingSvg.src = "resources/svg/recording_stop.svg";
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  setStatus("解析中...", "processing");
  transcriptArea.innerHTML =
    '<p class="placeholder">音声を解析中です。しばらくお待ちください...</p>';

  // Blob  Base64
  await sleep(300); // MediaRecorder が最終チャンクを書き込む時間を待つ
  const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
  const base64 = await blobToBase64(blob);

  // メインプロセスへ送信
  const result = await window.electronAPI.processAudio({
    audioDataBase64: base64,
    mimeType: mediaRecorder.mimeType,
  });

  startBtn.disabled = false;

  if (result.success) {
    currentRawSegments = result.segments;
    displayRawSegments(result.segments);
    formatBtn.disabled = false;
    summaryBtn.disabled = false;
    setStatus(
      "文字起こし完了 — AI整形または要約ボタンで次のアクションへ",
      "success",
    );
    showToast("文字起こし完了！", "success");
    loadHistory();
  } else {
    transcriptArea.innerHTML = `<p class="error-msg"> エラー: ${result.message}</p>`;
    setStatus("エラーが発生しました", "error");
    showToast(result.message, "error");
  }
});

// ===== トランスクリプト表示 =====
function displayTranscript(segments, formatted) {
  transcriptArea.innerHTML = "";

  // LLM整形テキストを表示
  if (formatted) {
    console.log("[DISPLAY] 整形済みテキスト受け取り:", formatted.substring(0, 200));
    const formattedDiv = document.createElement("div");
    formattedDiv.className = "formatted-transcript";

    const lines = formatted.split("\n");
    lines.forEach((line, idx) => {
      if (!line.trim()) return;
      const p = document.createElement("p");

      // 話者行判定：「話者X: テキスト」形式（X は数字またはアルファベット）
      const speakerMatch = line.match(/^(話者[0-9A-Zａ-ｚ０-９][\s：:]*)/);
      if (speakerMatch) {
        console.log(`[DISPLAY] 行${idx} マッチ:`, line.substring(0, 50));
        p.className = "speaker-line";
        const speaker = speakerMatch[1].trim();
        const text = line.substring(speakerMatch[0].length).trim();
        const spanLabel = document.createElement("span");
        spanLabel.className = "speaker-label";
        spanLabel.textContent = speaker;
        const spanText = document.createElement("span");
        spanText.className = "speaker-text";
        spanText.textContent = text;
        p.appendChild(spanLabel);
        p.appendChild(spanText);
      } else if (
        line.startsWith("【要点】") ||
        line.startsWith("##") ||
        line.startsWith("**")
      ) {
        p.className = "section-heading";
        p.textContent = line.replace(/^[#*\s]+/, "").replace(/[*]+/g, "");
      } else if (
        line.startsWith("") ||
        line.startsWith("-") ||
        line.startsWith("")
      ) {
        p.className = "bullet-item";
        p.textContent = line;
      } else {
        console.log(`[DISPLAY] 行${idx} 未マッチ:`, line.substring(0, 50));
        p.className = "transcript-line";
        p.textContent = line;
      }

      formattedDiv.appendChild(p);
    });

    transcriptArea.appendChild(formattedDiv);
  } else if (segments && segments.length > 0) {
    // formatted がない場合、生のセグメントを表示
    const div = document.createElement("div");
    div.className = "formatted-transcript";
    segments.forEach((seg) => {
      const text = (seg.text || seg.speech || "").trim();
      if (!text) return;
      const p = document.createElement("p");
      p.className = "speaker-line";
      const spanLabel = document.createElement("span");
      spanLabel.className = "speaker-label";
      spanLabel.textContent = `話者${seg.speaker || 1}: `;
      const spanText = document.createElement("span");
      spanText.className = "speaker-text";
      spanText.textContent = text;
      p.appendChild(spanLabel);
      p.appendChild(spanText);
      div.appendChild(p);
    });
    transcriptArea.appendChild(div);
  } else {
    transcriptArea.innerHTML =
      '<p class="placeholder">テキストが認識されませんでした。</p>';
  }

  transcriptArea.scrollTop = 0;
}

// ===== 生セグメント表示 (AI整形前) =====
function displayRawSegments(segments) {
  transcriptArea.innerHTML = "";
  if (!segments || segments.length === 0) {
    transcriptArea.innerHTML =
      '<p class="placeholder">テキストが認識されませんでした。</p>';
    return;
  }
  const div = document.createElement("div");
  div.className = "formatted-transcript";
  segments.forEach((seg) => {
    const text = (seg.text || seg.speech || "").trim();
    if (!text) return;
    const p = document.createElement("p");
    p.className = "speaker-line";
    const spanLabel = document.createElement("span");
    spanLabel.className = "speaker-label";
    spanLabel.textContent = `話者${seg.speaker || 1}: `;
    const spanText = document.createElement("span");
    spanText.className = "speaker-text";
    spanText.textContent = text;
    p.appendChild(spanLabel);
    p.appendChild(spanText);
    div.appendChild(p);
  });
  transcriptArea.appendChild(div);
  transcriptArea.scrollTop = 0;
}

// ===== AI整形 =====
formatBtn.addEventListener("click", async () => {
  if (!currentRawSegments) return;
  formatBtn.disabled = true;
  setStatus("AI整形中...", "processing");
  transcriptArea.innerHTML =
    '<p class="placeholder loading-dots">AIがテキストを整形中...しばらくお待ちください</p>';

  const result = await window.electronAPI.formatTranscript(currentRawSegments);

  formatBtn.disabled = false;
  if (result.success) {
    currentFormattedText = result.formatted;
    displayTranscript(currentRawSegments, result.formatted);
    summaryBtn.disabled = false;
    copyBtn.disabled = false;
    setStatus("AI整形完了", "success");
    showToast("AI整形完了！", "success");
  } else {
    displayRawSegments(currentRawSegments);
    setStatus("AI整形エラー", "error");
    showToast(result.message || "AI整形に失敗しました", "error");
  }
});

// ===== 要約生成 =====
summaryBtn.addEventListener("click", async () => {
  // AI整形済みテキストがあればそちらを優先、なければ生セグメントからプレーンテキストを生成
  const textForSummary =
    currentFormattedText ||
    (currentRawSegments
      ? currentRawSegments
          .map(
            (s) =>
              `話者${s.speaker || 1}: ${(s.text || s.speech || "").trim()}`,
          )
          .join("\n")
      : null);
  if (!textForSummary) return;
  summaryBtn.disabled = true;
  summaryArea.innerHTML =
    '<p class="placeholder loading-dots">要約を生成中...</p>';
  copyBtn.disabled = true;

  const result = await window.electronAPI.generateSummary(textForSummary);

  summaryBtn.disabled = false;
  if (result.success) {
    copyBtn.disabled = false;
    setStatus("要約完了", "success");
    summaryArea.scrollTop = 0;
  } else {
    summaryArea.innerHTML = `<p class="error-msg"> ${result.message}</p>`;
    setStatus("要約エラー", "error");
  }
});

// ===== クリア =====
clearBtn.addEventListener("click", () => {
  if (confirm("文字起こし結果をクリアしますか？")) {
    transcriptArea.innerHTML =
      '<p class="placeholder">録音を停止すると、ここに文字起こし結果が表示されます。</p>';
    summaryArea.innerHTML =
      '<p class="placeholder">文字起こし後にAI整形→要約の順に実行できます。</p>';
    formatBtn.disabled = true;
    summaryBtn.disabled = true;
    copyBtn.disabled = true;
    currentFormattedText = "";
    currentRawSegments = null;
  }
});

// ===== コピー =====
copyBtn.addEventListener("click", () => {
  const text = summaryArea.textContent;
  navigator.clipboard
    .writeText(text)
    .then(() => showToast("コピーしました", "success"))
    .catch(() => showToast("コピー失敗", "error"));
});

// ===== 波形描画 =====
function drawWaveform() {
  if (!analyser) return;
  const canvas = waveformCanvas;
  const ctx = canvas.getContext("2d");
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  canvas.width = canvas.offsetWidth || 600;
  canvas.height = canvas.offsetHeight || 60;

  function draw() {
    animFrameId = requestAnimationFrame(draw);
    analyser.getByteTimeDomainData(dataArray);

    ctx.fillStyle = "rgba(15, 23, 42, 0.3)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#f5576c";
    ctx.beginPath();

    const sliceWidth = canvas.width / bufferLength;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * canvas.height) / 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.stroke();
  }
  draw();
}

// ===== タイマー =====
function updateTimer() {
  if (!recordingStartTime) return;
  const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const s = String(elapsed % 60).padStart(2, "0");
  recordingTimeEl.textContent = `${m}:${s}`;
}

// ===== 履歴読み込み =====
async function loadHistory() {
  try {
    const result = await window.electronAPI.listTranscripts();
    if (!result.success || result.transcripts.length === 0) {
      transcriptsList.innerHTML =
        '<p class="placeholder">まだ録音がありません。</p>';
      return;
    }
    transcriptsList.innerHTML = "";
    result.transcripts.forEach((t) => {
      const item = document.createElement("div");
      item.className = "history-item";
      item.style.cursor = "pointer";
      const date = new Date(t.created).toLocaleString("ja-JP");
      item.innerHTML = `<span class="history-name"> ${t.name}</span><span class="history-date">${date}</span>`;
      item.addEventListener("click", async () => {
        try {
          const data = await window.electronAPI.readTranscript(t.path);
          if (data.success) {
            currentFormattedText = data.formatted || "";
            currentRawSegments = data.segments || [];
            displayTranscript(currentRawSegments, currentFormattedText);
            formatBtn.disabled = !currentRawSegments || currentRawSegments.length === 0;
            summaryBtn.disabled = !currentFormattedText && (!currentRawSegments || currentRawSegments.length === 0);
            copyBtn.disabled = true;
            setStatus(`"${t.name}" を読み込みました`, "success");
            // 文字起こしパネルへスクロール
            document
              .querySelector(".main-content")
              .scrollIntoView({ behavior: "smooth" });
          } else {
            showToast("読み込み失敗: " + data.message, "error");
          }
        } catch (e) {
          showToast("読み込みエラー: " + e.message, "error");
        }
      });
      transcriptsList.appendChild(item);
    });
  } catch (e) {
    console.error("履歴読み込みエラー:", e);
  }
}

// ===== ユーティリティ =====
function setStatus(msg, type = "info") {
  statusText.textContent = msg;
  statusIndicator.className = `status-indicator ${type}`;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function showToast(msg, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => document.body.removeChild(toast), 300);
  }, 3000);
}

// ===== 初期化 =====
checkOllama();
loadHistory();
