# 議事録アプリ

対面会議の音声を録音し、ローカルLLMでトランスクリプトを自動整形・要約する Windows デスクトップアプリです。

**Python・Ollama・クラウド接続は一切不要です。** すべての処理がローカルで完結します。

## 機能

- **録音**: ブラウザ API でマイク音声を録音（WebM/Opus）
- **文字起こし**: whisper.cpp（base モデル）による日本語音声認識
- **話者分離**: sherpa-onnx による複数話者の自動識別
- **AI 整形**: ローカル LLM（Qwen3.5-0.8B）によるノイズ除去・整形
- **要約生成**: 同 LLM によるストリーミング要約
- **自動保存**: トランスクリプトを JSON 形式で保存

## 技術スタック

| 役割           | ライブラリ / ツール                          |
| -------------- | -------------------------------------------- |
| フレームワーク | Electron v40.8.0 (Node.js 22)                |
| 音声変換       | FFmpeg（`resources/ffmpeg/ffmpeg.exe`）      |
| 音声認識       | whisper-node（whisper.cpp ggml-base.bin）    |
| 話者分離       | sherpa-onnx v1.12.28                         |
| LLM 推論       | node-llama-cpp v3 + Qwen3.5-0.8B-Q4_K_M.gguf |
| UI             | HTML / CSS / JavaScript                      |

## 前提条件

- Windows 10 / 11
- Node.js v22 以上
- 空きディスク容量: 約 2GB（モデルファイル含む）

Python・Ollama・Visual C++ Build Tools は**不要**です。

## セットアップ

### 方法A: setup.bat をダブルクリック（推奨）

```
setup.bat をダブルクリック
```

以下を自動で実行します:

1. Node.js の確認
2. npm パッケージのインストール（`npm install`）
3. whisper-node のビルド
4. Whisper モデルのダウンロード（約 142MB）
5. whisper.cpp バイナリのダウンロード
6. FFmpeg のダウンロード・配置（約 200MB）
7. LLM モデルのダウンロード（約 500MB）
8. 話者分離モデルのダウンロード（約 45MB）
9. デスクトップに「議事録アプリ」ショートカットを作成

### 方法B: PowerShell から実行

```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1
```

## アプリの起動

セットアップ後はデスクトップの「議事録アプリ」アイコンをダブルクリックするだけです。

開発時は以下のコマンドを使用します:

```bash
# 通常起動
npm start

# DevTools あり
npm run dev
```

## 使い方

1. **録音開始**
   - 「録音開始」ボタンをクリック
   - マイクのアクセス許可を承認

2. **話し終えたら録音停止**
   - 「録音停止」ボタンをクリック
   - 自動で文字起こし → 話者分離 → AI 整形が実行される
   - 整形済みトランスクリプトが表示される

3. **要約生成**
   - 「要約生成」ボタンをクリック
   - LLM がストリーミングで要約を生成

## ディレクトリ構造

```
realtimetranscript/
├── main.js              # Electron メインプロセス（音声処理・LLM 推論）
├── preload.js           # IPC 通信ブリッジ
├── index.html           # UI
├── styles.css           # スタイル
├── renderer.js          # UI ロジック
├── setup.ps1            # セットアップスクリプト
├── setup.bat            # セットアップ起動用バッチ
├── start.bat            # アプリ起動用バッチ
├── start.vbs            # コマンドプロンプト非表示で起動
├── package.json         # npm 設定
├── models/
│   ├── Qwen3.5-0.8B-Q4_K_M.gguf    # LLM モデル（~500MB）
│   └── diarization/
│       ├── segmentation.onnx         # 話者セグメンテーション（~6MB）
│       └── embedding.onnx            # 話者埋め込み（~38MB）
└── resources/
    └── ffmpeg/
        └── ffmpeg.exe                # FFmpeg バイナリ
```

## 処理フロー

```
録音（WebM/Opus）
  ↓ FFmpeg
WAV（16kHz / 16bit / Mono）
  ↓ whisper.cpp
テキスト + タイムスタンプ
  ↓ sherpa-onnx
話者ラベル付きセグメント
  ↓ node-llama-cpp (Qwen3.5)
整形済みトランスクリプト
  ↓ 自動保存
JSON（userData/transcripts/）
```

## トラブルシューティング

### 文字起こしが始まらない

- `resources/ffmpeg/ffmpeg.exe` が存在するか確認
- システムの PATH に ffmpeg があれば代替として使用される

### LLM 整形エラー

- `models/Qwen3.5-0.8B-Q4_K_M.gguf` が存在するか確認（約 500MB）
- ファイルが壊れている場合は `setup.bat` を再実行

### 話者分離がスキップされる

- `models/diarization/segmentation.onnx` と `embedding.onnx` が両方存在するか確認
- `setup.bat` を再実行してダウンロード

### マイクが認識されない

- Windows 設定 → プライバシー → マイク → アプリのアクセスを許可

## ライセンス

MIT License
