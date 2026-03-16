# =============================================================
# Meeting Transcript App - セットアップスクリプト
# =============================================================
# 実行方法: PowerShell で右クリック → PowerShell で実行
#           または: powershell -ExecutionPolicy Bypass -File setup.ps1
# =============================================================

# コンソール出力を UTF-8 に統一（文字化け防止）
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

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
# 7. FFmpeg バイナリの確認・ダウンロード
# ----------------------------------------------------------
Write-Step "FFmpeg を確認中..."

$ffmpegExe = Join-Path $ffmpegDir "ffmpeg.exe"
$sysFfmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue

if (Test-Path $ffmpegExe) {
    $sizeMB = [math]::Round((Get-Item $ffmpegExe).Length / 1MB, 1)
    Write-OK "FFmpeg バイナリ: 配置済み ($sizeMB MB)"
} elseif ($sysFfmpeg) {
    Write-OK "システムの FFmpeg を使用: $($sysFfmpeg.Source)"
} else {
    Write-Warn "FFmpeg が見つかりません。ダウンロードします（約 200MB）..."
    $ffmpegZipUrl  = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
    $ffmpegZip     = Join-Path $env:TEMP "ffmpeg.zip"
    $ffmpegExtract = Join-Path $env:TEMP "ffmpeg-extract"
    try {
        Write-Host "  curl でダウンロード中... (約 200MB)" -ForegroundColor Gray
        curl.exe -L --progress-bar -o $ffmpegZip $ffmpegZipUrl
        if ($LASTEXITCODE -ne 0) { throw "curl 失敗 (exit code: $LASTEXITCODE)" }

        Write-Host "  展開中..." -ForegroundColor Gray
        if (Test-Path $ffmpegExtract) { Remove-Item $ffmpegExtract -Recurse -Force }
        Expand-Archive -Path $ffmpegZip -DestinationPath $ffmpegExtract -Force

        $ffmpegBin = Get-ChildItem $ffmpegExtract -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
        if ($ffmpegBin) {
            Copy-Item $ffmpegBin.FullName $ffmpegExe -Force
            $sizeMB = [math]::Round((Get-Item $ffmpegExe).Length / 1MB, 1)
            Write-OK "FFmpeg のダウンロード・配置完了 ($sizeMB MB)"
        } else {
            Write-Err "ffmpeg.exe が ZIP 内に見つかりませんでした"
        }
    } catch {
        Write-Err "FFmpeg のダウンロードに失敗しました: $_"
        Write-Host "  手動でダウンロードして以下へ配置してください:" -ForegroundColor Yellow
        Write-Host "  $ffmpegExe" -ForegroundColor Yellow
        Write-Host "  ダウンロード先: https://github.com/BtbN/FFmpeg-Builds/releases" -ForegroundColor Yellow
    } finally {
        Remove-Item $ffmpegZip     -ErrorAction SilentlyContinue
        Remove-Item $ffmpegExtract -Recurse -ErrorAction SilentlyContinue
    }
}

# ----------------------------------------------------------
# 8. 話者分離モデルのダウンロード (sherpa-onnx)
# ----------------------------------------------------------
Write-Step "話者分離モデルを確認中..."

$diarDir  = Join-Path $AppDir "models\diarization"
$segModel = Join-Path $diarDir "segmentation.onnx"
$embModel = Join-Path $diarDir "embedding.onnx"

New-Item -ItemType Directory -Path $diarDir -Force | Out-Null

$diarOk = (Test-Path $segModel) -and (Test-Path $embModel)

if ($diarOk) {
    Write-OK "話者分離モデル確認済み"
} else {
    Write-Warn "話者分離モデルが見つかりません。ダウンロードします（計 ~45MB）..."

    if (-not (Test-Path $segModel)) {
        $tmpTar = Join-Path $env:TEMP "sherpa_seg.tar.bz2"
        $tmpDir = Join-Path $env:TEMP "sherpa_seg_extract"
        try {
            $segUrl = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
            Write-Host "  [セグメンテーション] ダウンロード中..." -ForegroundColor Gray
            Invoke-WebRequest -Uri $segUrl -OutFile $tmpTar -UseBasicParsing
            if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
            New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
            tar -xf $tmpTar -C $tmpDir
            $onnx = Get-ChildItem $tmpDir -Recurse -Filter "model.onnx" | Select-Object -First 1
            if ($onnx) {
                Copy-Item $onnx.FullName $segModel -Force
                Write-OK "[セグメンテーション] 完了 ($([math]::Round((Get-Item $segModel).Length/1MB,1)) MB)"
            } else {
                Write-Err "[セグメンテーション] model.onnx が見つかりませんでした"
            }
        } catch {
            Write-Err "[セグメンテーション] ダウンロードに失敗しました: $_"
        } finally {
            Remove-Item $tmpTar -ErrorAction SilentlyContinue
            Remove-Item $tmpDir -Recurse -ErrorAction SilentlyContinue
        }
    } else {
        Write-OK "[セグメンテーション] 確認済み"
    }

    if (-not (Test-Path $embModel)) {
        try {
            $embUrl = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
            Write-Host "  [話者埋め込み] ダウンロード中..." -ForegroundColor Gray
            Invoke-WebRequest -Uri $embUrl -OutFile $embModel -UseBasicParsing
            Write-OK "[話者埋め込み] 完了 ($([math]::Round((Get-Item $embModel).Length/1MB,1)) MB)"
        } catch {
            Write-Err "[話者埋め込み] ダウンロードに失敗しました: $_"
        }
    } else {
        Write-OK "[話者埋め込み] 確認済み"
    }
}

# ----------------------------------------------------------
# 9. デスクトップショートカット作成
# ----------------------------------------------------------
Write-Step "デスクトップショートカットを作成中..."

$iconPath     = Join-Path $AppDir "resources\favicon.ico"
$startVbs     = Join-Path $AppDir "start.vbs"
$desktopPath  = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "議事録アプリ.lnk"

try {
    $WshShell                  = New-Object -ComObject WScript.Shell
    $Shortcut                  = $WshShell.CreateShortcut($shortcutPath)
    $Shortcut.TargetPath       = "wscript.exe"
    $Shortcut.Arguments        = "`"$startVbs`""
    $Shortcut.WorkingDirectory = $AppDir
    if (Test-Path $iconPath) {
        $Shortcut.IconLocation = $iconPath
    }
    $Shortcut.Description      = "議事録自動生成アプリを起動"
    $Shortcut.Save()
    Write-OK "デスクトップに「議事録アプリ」ショートカットを作成しました"
} catch {
    Write-Warn "ショートカット作成に失敗しました: $_"
}

# ----------------------------------------------------------
# 完了
# ----------------------------------------------------------
Write-Host @"

  ================================================
   セットアップ完了！
  ================================================

  【アプリの起動】
  デスクトップの「議事録アプリ」アイコンをダブルクリック
  または: npm start

  【重要】LLM モデル (GGUF) を手動でダウンロードしてください
  -------------------------------------------------------
  以下のリンクから Qwen3.5-0.8B-Q4_K_M.gguf をダウンロードし、
  models フォルダ内に配置してください。

  ダウンロード先:
  https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/tree/main?show_file_info=Qwen3.5-0.8B-Q4_K_M.gguf

  配置先: $AppDir\models\Qwen3.5-0.8B-Q4_K_M.gguf
  -------------------------------------------------------

  - モデルは初回起動時に自動で読み込まれます（数秒〜数十秒）

"@ -ForegroundColor Green

Read-Host "Enterキーで終了"
