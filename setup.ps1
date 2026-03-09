# =============================================================
# Meeting Transcript App - セットアップスクリプト
# =============================================================
# 実行方法: PowerShell で右クリック → PowerShell で実行
#           または: powershell -ExecutionPolicy Bypass -File setup.ps1
# =============================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $AppDir

function Write-Step($msg) { Write-Host "`n[STEP] $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!!] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host " [ERR] $msg" -ForegroundColor Red }

Write-Host @"

  ================================================
   Meeting Transcript App - セットアップ
  ================================================

"@ -ForegroundColor White

# ----------------------------------------------------------
# 1. Node.js 確認
# ----------------------------------------------------------
Write-Step "Node.js を確認中..."
try {
    $nodeVer = node --version 2>&1
    Write-OK "Node.js $nodeVer"
} catch {
    Write-Err "Node.js がインストールされていません。"
    Write-Host "  https://nodejs.org/ からインストールしてください。" -ForegroundColor Yellow
    Read-Host "Enterキーで終了"
    exit 1
}

# ----------------------------------------------------------
# 2. npm install
# ----------------------------------------------------------
Write-Step "npm パッケージをインストール中..."
npm install --ignore-scripts 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Err "npm install に失敗しました。"
    exit 1
}
Write-OK "npm パッケージのインストール完了"

# ----------------------------------------------------------
# 3. whisper-node ネイティブビルド
# ----------------------------------------------------------
Write-Step "whisper-node をビルド中..."
npm rebuild whisper-node 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Warn "whisper-node のビルドに失敗しました（Visual C++ Build Tools が必要な場合があります）"
} else {
    Write-OK "whisper-node ビルド完了"
}

# ----------------------------------------------------------
# 4. Whisper モデル (ggml-base.bin) の確認・ダウンロード
# ----------------------------------------------------------
Write-Step "Whisper 音声認識モデルを確認中..."
$modelDir  = Join-Path $AppDir "node_modules\whisper-node\lib\whisper.cpp\models"
$modelFile = Join-Path $modelDir "ggml-base.bin"
$mainExe   = Join-Path $AppDir "node_modules\whisper-node\lib\whisper.cpp\main.exe"

if (Test-Path $modelFile) {
    $sizeMB = [math]::Round((Get-Item $modelFile).Length / 1MB, 1)
    Write-OK "Whisper モデル確認済み ($sizeMB MB)"
} else {
    Write-Warn "Whisper モデルが見つかりません。ダウンロードします（約 142MB）..."
    try {
        $modelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
        Invoke-WebRequest -Uri $modelUrl -OutFile $modelFile -UseBasicParsing
        Write-OK "Whisper モデルのダウンロード完了"
    } catch {
        Write-Err "Whisper モデルのダウンロードに失敗しました: $_"
        Write-Warn "手動でダウンロードして以下へ配置してください:"
        Write-Host "  $modelFile" -ForegroundColor Yellow
    }
}

# ----------------------------------------------------------
# 5. whisper.cpp バイナリ (main.exe) の確認
# ----------------------------------------------------------
Write-Step "whisper.cpp バイナリを確認中..."
if (Test-Path $mainExe) {
    Write-OK "whisper.cpp main.exe 確認済み"
} else {
    Write-Warn "whisper.cpp バイナリが見つかりません。ダウンロードします..."
    try {
        $zipUrl     = "https://github.com/ggerganov/whisper.cpp/releases/download/v1.5.4/whisper-bin-x64.zip"
        $zipPath    = Join-Path $env:TEMP "whisper-bin.zip"
        $extractDir = Join-Path $env:TEMP "whisper-bin"
        $whisperDir = Join-Path $AppDir "node_modules\whisper-node\lib\whisper.cpp"

        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
        Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
        Copy-Item "$extractDir\main.exe"    $whisperDir -Force
        Copy-Item "$extractDir\whisper.dll" $whisperDir -Force
        Write-OK "whisper.cpp バイナリの配置完了"
    } catch {
        Write-Err "whisper.cpp バイナリのダウンロードに失敗しました: $_"
    }
}

# ----------------------------------------------------------
# 6. resources フォルダ構成の確認・作成
# ----------------------------------------------------------
Write-Step "resources フォルダを確認中..."
$resourcesDir = Join-Path $AppDir "resources"

$ollamaDir = Join-Path $resourcesDir "ollama"
$ffmpegDir = Join-Path $resourcesDir "ffmpeg"

New-Item -ItemType Directory -Path $ollamaDir -Force | Out-Null
New-Item -ItemType Directory -Path $ffmpegDir -Force | Out-Null

$ollamaExe = Join-Path $ollamaDir "ollama.exe"
$ffmpegExe = Join-Path $ffmpegDir "ffmpeg.exe"

Write-OK "resources フォルダを作成しました"

# ----------------------------------------------------------
# 7. FFmpeg バイナリの確認（案内のみ）
# ----------------------------------------------------------
Write-Host ""
Write-Host "  ┌─────────────────────────────────────┐" -ForegroundColor White
Write-Host "  │  手動配置が必要なバイナリ           │" -ForegroundColor White
Write-Host "  └─────────────────────────────────────┘" -ForegroundColor White

if (Test-Path $ffmpegExe) {
    Write-OK "FFmpeg バイナリ: 配置済み"
} else {
    Write-Warn "FFmpeg バイナリが未配置です。"
    Write-Host "  → ffmpeg.exe を以下へ配置してください:" -ForegroundColor Yellow
    Write-Host "    $ffmpegExe" -ForegroundColor Yellow
    Write-Host "  → ダウンロード: https://github.com/BtbN/FFmpeg-Builds/releases " -ForegroundColor Yellow
    Write-Host "    (ffmpeg-master-latest-win64-gpl.zip の bin/ffmpeg.exe)" -ForegroundColor Yellow

    # システム ffmpeg があるかフォールバック確認
    $sysFfmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($sysFfmpeg) {
        Write-Host "  ※ システムの ffmpeg ($($sysFfmpeg.Source)) が利用可能です（フォールバック）" -ForegroundColor DarkGray
    }
}

# ----------------------------------------------------------
# 8. GGUF モデルのダウンロード
# ----------------------------------------------------------
Write-Step "LLM モデル (GGUF) を確認中..."

$modelsDir  = Join-Path $AppDir "models"
$modelFile  = "Qwen3.5-0.8B-Q4_K_M.gguf"
$modelPath  = Join-Path $modelsDir $modelFile

New-Item -ItemType Directory -Path $modelsDir -Force | Out-Null

if (Test-Path $modelPath) {
    $sizeMB = [math]::Round((Get-Item $modelPath).Length / 1MB, 1)
    Write-OK "GGUF モデル確認済み ($sizeMB MB)"
} else {
    Write-Warn "GGUF モデルが見つかりません。ダウンロードします（約 500MB）..."
    $modelUrl = "https://huggingface.co/Qwen/Qwen3-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf"
    try {
        Write-Host "  URL: $modelUrl" -ForegroundColor Gray
        Write-Host "  保存先: $modelPath" -ForegroundColor Gray
        Invoke-WebRequest -Uri $modelUrl -OutFile $modelPath -UseBasicParsing
        $sizeMB = [math]::Round((Get-Item $modelPath).Length / 1MB, 1)
        Write-OK "GGUF モデルのダウンロード完了 ($sizeMB MB)"
    } catch {
        Write-Err "GGUF モデルのダウンロードに失敗しました: $_"
        Write-Host "" -ForegroundColor Yellow
        Write-Host "  手動でダウンロードして以下へ配置してください:" -ForegroundColor Yellow
        Write-Host "  $modelPath" -ForegroundColor Yellow
        Write-Host "" -ForegroundColor Yellow
        Write-Host "  ダウンロード先:" -ForegroundColor Yellow
        Write-Host "  https://huggingface.co/Qwen/Qwen3-0.8B-GGUF" -ForegroundColor Yellow
        Write-Host "  → $modelFile を選択してダウンロード" -ForegroundColor Yellow
    }
}

# ----------------------------------------------------------
# 完了
# ----------------------------------------------------------
Write-Host @"

  ================================================
   セットアップ完了！
  ================================================

  【次のステップ】

  1. FFmpeg バイナリの配置（オプション）
     resources/ffmpeg/ffmpeg.exe に配置すると優先される
     （システムの ffmpeg がある場合は不要）

  2. アプリの起動
     npm start

  【補足】
  - LLM は node-llama-cpp で直接 GGUF モデルを実行します
    （Ollama は不要です）
  - GGUF モデル: models/$modelFile
  - モデルは初回起動時に自動で読み込まれます（数秒〜数十秒）

"@ -ForegroundColor Green

Read-Host "Enterキーで終了"
