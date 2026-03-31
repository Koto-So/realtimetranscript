# ミーティングトランスクリプト アプリケーション仕様書

> **バージョン**: 2.0.0  
> **最終更新**: 2026-03-30  
> **概要**: 対面会議の録音 → 音声認識（STT） → 話者分離 → AI 整形 → 要約を、**完全ローカル処理**で実現する Windows デスクトップアプリケーション

---

## 1. アプリケーション概要

### 1.1 目的

会議室での対面ミーティングを PC のマイクで録音し、録音停止後にローカル上で:

1. **音声認識**（whisper.cpp — ggml-base モデル、日本語）
2. **話者分離**（sherpa-onnx — pyannote segmentation + 3D-Speaker embedding）
3. **AI 整形**（node-llama-cpp — Qwen3.5-0.8B GGUF、ノイズ除去・フィラー除去・自然文化）
4. **要約生成**（同 LLM でストリーミング出力）

を一気通貫で行う。インターネット接続なしで全機能が完結する。

### 1.2 主要機能一覧

| # | 機能 | 説明 |
|---|------|------|
| F1 | マイク録音 | ブラウザ MediaRecorder API（WebM/Opus）でリアルタイム録音 |
| F2 | リアルタイム波形表示 | Canvas + AnalyserNode で録音中の音声波形を描画 |
| F3 | 録音タイマー | mm:ss 形式のリアルタイム経過時間表示 |
| F4 | 音声変換 | ffmpeg で WebM → 16kHz mono PCM WAV に変換。ノイズ除去フィルタ自動選択 |
| F5 | 音声認識（STT） | whisper.cpp main.exe（`-l ja -oj`）でタイムスタンプ付き日本語文字起こし |
| F6 | 話者分離 | sherpa-onnx を子プロセスで実行。Whisper セグメントと話者をアライメント |
| F7 | AI 整形 | LLM で認識エラー・フィラー・繰り返しを除去し自然文に整形。話者ラベル保持 |
| F8 | 要約生成 | LLM でミーティング要約をストリーミング生成 |
| F9 | テキストコピー | 文字起こし・要約それぞれにクリップボードコピーボタン |
| F10 | 録音履歴 | 過去の録音 JSON を一覧表示、クリックで読み込み・再表示 |
| F11 | トランスクリプト永続保存 | JSON ファイルに自動保存（segments + formatted + createdAt） |
| F12 | LLM 状態表示 | 起動時に LLM モデル読み込み状態をヘッダーに表示 |
| F13 | トースト通知 | 操作結果をスライドイン通知で表示 |

---

## 2. 技術スタック

### 2.1 フレームワーク・ランタイム

| レイヤー | 技術 | バージョン |
|----------|------|-----------|
| デスクトップフレームワーク | **Electron** | ^40.8.0 |
| ランタイム | Node.js | (Electron 同梱 Chromium + Node) |
| パッケージビルド | Electron Forge | squirrel / zip makers |
| 言語 | JavaScript (ES Modules for LLM, CommonJS for main) | — |

### 2.2 AI / 音声処理ライブラリ

| 用途 | パッケージ | バージョン | 詳細 |
|------|-----------|-----------|------|
| 音声認識 (STT) | **whisper-node** | ^1.1.0 | whisper.cpp の Node ラッパー。`main.exe` + `ggml-base.bin` を同梱 |
| 話者分離 | **sherpa-onnx** | ^1.12.28 | pyannote segmentation-3.0 + 3D-Speaker embedding ONNX モデル |
| LLM 推論 | **node-llama-cpp** | ^3.17.1 | ESM dynamic import。GGUF モデルをロードして推論。JSON Schema Grammar 対応 |
| 音声変換 | **ffmpeg** (バイナリ) | 外部同梱 | resources/ffmpeg/ffmpeg.exe を同梱。WebM→WAV 変換 + ノイズ除去 |

### 2.3 LLM モデル

| モデル | ファイル名 | サイズ | 用途 |
|--------|-----------|--------|------|
| Qwen3.5-0.8B | `Qwen3.5-0.8B-Q4_K_M.gguf` | ~508 MB | AI 整形 + 要約生成 |

### 2.4 話者分離モデル

| モデル | ファイル名 | サイズ | 用途 |
|--------|-----------|--------|------|
| pyannote segmentation-3.0 | `segmentation.onnx` | ~5.7 MB | 音声セグメンテーション |
| 3D-Speaker ERes2Net | `embedding.onnx` | ~37.8 MB | 話者埋め込み (クラスタリング) |

### 2.5 Whisper モデル

| モデル | ファイル名 | サイズ | 言語 |
|--------|-----------|--------|------|
| ggml-base | `ggml-base.bin` | ~142 MB | 日本語 (`-l ja`) |

---

## 3. フォルダ構成

```
realtimetranscript/
├── main.js                          # Electron メインプロセス (655行)
├── preload.js                       # contextBridge による IPC API 公開
├── index.html                       # メインウィンドウ HTML
├── renderer.js                      # レンダラープロセス (515行)
├── styles.css                       # 全スタイル定義 (540行)
├── diarize-worker.js                # 話者分離用子プロセスワーカー
├── package.json                     # npm 設定
├── forge.config.js                  # Electron Forge ビルド設定
├── setup.ps1                        # PowerShell セットアップスクリプト (300行)
├── setup.bat                        # setup.ps1 のラッパー
├── start.bat                        # アプリ起動 (npm start)
├── start.vbs                        # コンソール非表示で起動する VBScript
├── models/
│   ├── Qwen3.5-0.8B-Q4_K_M.gguf    # LLM モデル (~508 MB)
│   ├── README.txt
│   └── diarization/
│       ├── segmentation.onnx        # 話者分離セグメンテーションモデル (~5.7 MB)
│       └── embedding.onnx           # 話者埋め込みモデル (~37.8 MB)
├── resources/
│   ├── favicon.ico                  # アプリアイコン
│   ├── ffmpeg/
│   │   ├── ffmpeg.exe               # FFmpeg バイナリ
│   │   └── README.txt
│   └── svg/
│       ├── recording_stop.svg       # マイクアイコン (白・停止状態)
│       └── recording_doing.svg      # 録音中アニメーション (赤パルス+REC)
├── recordings/                      # (開発時) 録音 WAV 一時保存
├── transcripts/                     # 文字起こし JSON 永続保存先
│   └── transcript_YYYY-MM-DDTHH-MM-SS-mmmZ.json
└── node_modules/
    ├── whisper-node/
    │   └── lib/whisper.cpp/
    │       ├── main.exe             # whisper.cpp バイナリ
    │       ├── whisper.dll
    │       └── models/
    │           └── ggml-base.bin    # Whisper 音声認識モデル (~142 MB)
    ├── sherpa-onnx/                 # 話者分離ネイティブ
    └── node-llama-cpp/              # LLM 推論 (ESM)
```

---

## 4. アーキテクチャ

### 4.1 プロセス構成

```
┌─────────────────────────────────────────────────┐
│  Electron Main Process (main.js)                │
│  ┌───────────────────────────────────────────┐  │
│  │ IPC Handlers                              │  │
│  │  ├─ process-audio     (録音→STT→話者分離)│  │
│  │  ├─ format-transcript (AI整形)            │  │
│  │  ├─ generate-summary  (要約ストリーミング)│  │
│  │  ├─ list-transcripts  (履歴一覧)          │  │
│  │  ├─ read-transcript   (履歴読み込み)      │  │
│  │  └─ check-llm         (LLM状態確認)      │  │
│  ├───────────────────────────────────────────┤  │
│  │ 外部プロセス                              │  │
│  │  ├─ ffmpeg.exe (spawn)    音声変換        │  │
│  │  ├─ main.exe   (spawn)    Whisper STT     │  │
│  │  └─ node diarize-worker.js (spawn)        │  │
│  │     └─ sherpa-onnx         話者分離       │  │
│  ├───────────────────────────────────────────┤  │
│  │ node-llama-cpp (in-process, ESM)          │  │
│  │  ├─ LlamaModel / LlamaContext             │  │
│  │  ├─ LlamaChatSession                      │  │
│  │  └─ LlamaJsonSchemaGrammar               │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌───────────────── IPC Bridge ───────────────┐ │
│  │ preload.js (contextBridge)                 │ │
│  │  electronAPI.processAudio()                │ │
│  │  electronAPI.formatTranscript()            │ │
│  │  electronAPI.generateSummary()             │ │
│  │  electronAPI.listTranscripts()             │ │
│  │  electronAPI.readTranscript()              │ │
│  │  electronAPI.checkLlm()                    │ │
│  │  electronAPI.onStatusUpdate(callback)      │ │
│  │  electronAPI.onSummaryChunk(callback)      │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─────────────────────────────────────────────┐│
│  │ Renderer Process (renderer.js + index.html) ││
│  │  ├─ MediaRecorder (WebM/Opus)               ││
│  │  ├─ AudioContext + AnalyserNode (波形)       ││
│  │  ├─ Canvas 2D (波形描画)                     ││
│  │  └─ DOM 操作 (結果表示)                      ││
│  └─────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

### 4.2 データフロー（録音→文字起こし→AI 整形→要約）

```
[マイク] →(MediaRecorder)→ [WebM Blob]
    ↓ Base64 エンコード
[IPC: process-audio]
    ↓ (1) 一時ファイル書き出し
    ↓ (2) ffmpeg: WebM → 16kHz mono WAV (ノイズ除去フィルタ)
    ↓ (3) whisper.cpp: WAV → JSON (タイムスタンプ付き文字起こし)
    ↓ (4) sherpa-onnx: WAV → 話者分離結果
    ↓ (5) alignSpeakers(): Whisper セグメント × 話者をアライメント
    ↓ (6) JSON 保存 (transcripts/transcript_*.json)
    ↓ return { segments }
[レンダラー] → 生セグメント表示（話者N: テキスト）

[ユーザー: AI整形ボタン]
    ↓
[IPC: format-transcript]
    ↓ node-llama-cpp: セグメント → 整形テキスト (JSON Schema Grammar)
    ↓ return { formatted }
[レンダラー] → 整形テキスト表示

[ユーザー: 要約ボタン]
    ↓
[IPC: generate-summary]
    ↓ node-llama-cpp: テキスト → 要約 (ストリーミング)
    ↓ IPC: summary-chunk (チャンクごと)
    ↓ return { summary }
[レンダラー] → 要約リアルタイム表示
```

---

## 5. IPC API 仕様

### 5.1 `process-audio`

録音データを受け取り、音声変換→文字起こし→話者分離を実行して結果を返す。

**リクエスト:**
```typescript
{
  audioDataBase64: string;  // WebM 音声の Base64 エンコーディング
  mimeType: string;         // "audio/webm;codecs=opus" or "audio/webm"
}
```

**レスポンス (成功):**
```typescript
{
  success: true;
  segments: Array<{
    text: string;       // 認識テキスト
    start_ms: number;   // 開始時間 (ミリ秒)
    end_ms: number;     // 終了時間 (ミリ秒)
    speaker: number;    // 話者番号 (1-indexed)
  }>;
  filePath: string;     // 保存先 JSON ファイルパス
}
```

**レスポンス (失敗):**
```typescript
{ success: false; message: string; }
```

### 5.2 `format-transcript`

セグメント配列を受け取り、LLM で整形したテキストを返す。

**リクエスト:** `TranscriptSegment[]`（上記 segments と同形式）

**レスポンス:** `{ success: true; formatted: string; }` or `{ success: false; message: string; }`

### 5.3 `generate-summary`

テキストを受け取り、LLM で要約を生成する（チャンクは `summary-chunk` イベントで随時送信）。

**リクエスト:** `string`（整形済みテキスト、または生セグメントのプレーン連結）

**レスポンス:** `{ success: true; summary: string; }` or `{ success: false; message: string; }`

### 5.4 `list-transcripts`

保存済みトランスクリプトの一覧を取得する。

**レスポンス:**
```typescript
{
  success: true;
  transcripts: Array<{
    name: string;    // ファイル名
    path: string;    // 絶対パス
    created: Date;   // 作成日時
  }>;                // 新しい順、最大 20 件
}
```

### 5.5 `read-transcript`

指定パスのトランスクリプト JSON を読み込む。

**リクエスト:** `string`（ファイルの絶対パス）

**レスポンス:** `{ success: true; segments: [...]; formatted: string|null; createdAt: string; }`

### 5.6 `check-llm`

LLM モデルの読み込み状態を返す。

**レスポンス:**
```typescript
{
  success: boolean;
  loaded: boolean;      // モデルがメモリにロード済みか
  modelFile: string;    // "Qwen3.5-0.8B-Q4_K_M.gguf"
  modelFound: boolean;  // モデルファイルがディスク上に存在するか
}
```

### 5.7 IPC イベント (Main → Renderer)

| イベント名 | データ | 説明 |
|-----------|--------|------|
| `status-update` | `{ message: string; type: StatusType }` | ステータスバー更新 |
| `summary-chunk` | `string` | 要約テキストのストリーミングチャンク |

---

## 6. データ保存仕様

### 6.1 トランスクリプト JSON

**保存先:** `{app.getAppPath()}/transcripts/`  
**ファイル名規則:** `transcript_{ISO8601_createdAt}.json`（コロン・ピリオドをハイフンに置換）

**スキーマ:**
```json
{
  "segments": [
    {
      "text": "認識されたテキスト",
      "start_ms": 0,
      "end_ms": 3500,
      "speaker": 1
    }
  ],
  "formatted": "話者1: 整形されたテキスト\n話者2: ...",
  "createdAt": "2026-03-30T01:49:05.550Z"
}
```

| フィールド | 型 | 初期値 | 説明 |
|-----------|-----|--------|------|
| `segments` | `Array<Segment>` | 必須 | Whisper + 話者分離 結果 |
| `segments[].text` | `string` | — | 認識テキスト |
| `segments[].start_ms` | `number` | — | 開始時刻 (ms) |
| `segments[].end_ms` | `number` | — | 終了時刻 (ms) |
| `segments[].speaker` | `number` | — | 話者番号 (1-indexed) |
| `formatted` | `string \| null` | `null` | AI 整形後テキスト（AI 整形未実行時は null） |
| `createdAt` | `string` | — | ISO 8601 作成日時 |

---

## 7. UI デザイン仕様

### 7.1 全体レイアウト

```
┌──────────────────────────────────────────────────────────┐
│                       ヘッダー                           │
│  「ミーティングトランスクリプト」                          │
│  サブタイトル: 録音→文字起こし→AI整形・要約（完全ローカル）│
│  [LLM ステータスバッジ]                                  │
├──────────────────────────────────────────────────────────┤
│              コントロールバー（円形ボタン5個）             │
│  ◉録音開始  ◉停止  ◉AI整形  ◉要約  ◉クリア             │
├──────────────────────────────────────────────────────────┤
│  [波形バー (録音中のみ表示)]  ████████░░░░  00:42         │
├──────────────────────────────────────────────────────────┤
│  ● ステータスバー: 「準備完了」                           │
├─────────────────────────┬────────────────────────────────┤
│     文字起こしカード     │       要約カード               │
│  ┌───────────────────┐  │  ┌────────────────────────┐   │
│  │ 文字起こし    [⎘] │  │  │ 要約              [⎘] │   │
│  ├───────────────────┤  │  ├────────────────────────┤   │
│  │ 話者1: テキスト   │  │  │ 要約テキスト           │   │
│  │ 話者2: テキスト   │  │  │                        │   │
│  │ ...               │  │  │                        │   │
│  └───────────────────┘  │  └────────────────────────┘   │
├─────────────────────────┴────────────────────────────────┤
│  過去の録音                                              │
│  📄 transcript_2026-03-30T...json    2026/3/30 10:49    │
│  📄 transcript_2026-03-18T...json    2026/3/18 17:52    │
└──────────────────────────────────────────────────────────┘
```

### 7.2 ウィンドウ設定

| 項目 | 値 |
|------|-----|
| 初期サイズ | 1200 × 800 px |
| 最大幅 (container) | 1400px |
| contextIsolation | `true` |
| nodeIntegration | `false` |
| DevTools | `--dev` フラグまたは `NODE_ENV=development` で有効 |

### 7.3 カラーパレット

#### ベースカラー

| 用途 | カラーコード | 説明 |
|------|-------------|------|
| 背景 (body) | `#ffffff` | 純白 |
| テキスト (primary) | `#111827` | ほぼ黒 (gray-900) |
| テキスト (secondary) | `#6b7280` | グレー (gray-500) |
| テキスト (muted) | `#9ca3af` | 薄グレー (gray-400) |
| テキスト (body) | `#374151` | ダークグレー (gray-700) |
| テキスト (label small) | `#4b5563` | (gray-600) |
| ボーダー | `#e2e8f0` | 薄いグレー (slate-200) |
| カード背景 | `#ffffff` | 白 |
| コンテンツエリア背景 | `#f8fafc` | ごく薄いグレー (slate-50) |
| スクロールバー track | `#f1f5f9` | (slate-100) |
| スクロールバー thumb | `#93c5fd` | 薄いブルー (blue-300) |

#### アクセントカラー

| 用途 | カラーコード | 説明 |
|------|-------------|------|
| 話者ラベル背景 | `#eff6ff` | 薄いブルー (blue-50) |
| 話者ラベル左ボーダー | `#2563eb` | ブルー (blue-600) |
| 話者ラベルテキスト | `#1d4ed8` | 濃いブルー (blue-700) |
| セクション見出し下線 | `#bfdbfe` | (blue-200) |
| iconBtn hover 背景 | `#f0f4f8` | — |
| iconBtn hover テキスト | `#2563eb` | blue-600 |

#### ステータスカラー

| ステータス | ドットカラー | 説明 |
|-----------|-------------|------|
| idle (通常) | `#d1d5db` | gray-300 |
| recording | `#ef4444` | red-500 (pulse アニメーション) |
| processing | `#f59e0b` | amber-500 (pulse アニメーション) |
| success | `#22c55e` | green-500 |
| error | `#ef4444` | red-500 |
| info | `#2563eb` | blue-600 |

#### LLM ステータスバッジカラー

| 状態 | 背景 | テキスト |
|------|------|---------|
| checking | `#f1f5f9` | `#64748b` |
| connected | `#dcfce7` | `#16a34a` |
| warning | `#fef9c3` | `#b45309` |
| error | `#fee2e2` | `#dc2626` |

#### 波形 / 録音

| 要素 | カラー |
|------|--------|
| 波形線 | `#f5576c` (ピンクレッド) |
| 波形背景 (録音中) | `rgba(15, 23, 42, 0.3)` |
| 録音時間テキスト | `#ef4444` (red-500) |
| 波形コンテナボーダー | `1.5px solid #ef4444` |
| 録音中 SVG パルスカラー | `#ff4d4d` |

#### トースト通知

| タイプ | 背景 | テキスト |
|--------|------|---------|
| success | `#16a34a` | `#ffffff` |
| error | `#dc2626` | `#ffffff` |

#### ボタン

| 要素 | カラー |
|------|--------|
| 円形ボタン背景 | `#111827` (gray-900) |
| 円形ボタン内アイコン | `white` |
| ボタン shadow | `0 4px 16px rgba(0,0,0,0.18)` |
| ボタン hover shadow | `0 8px 24px rgba(0,0,0,0.28)` |
| disabled opacity | `0.32` |

### 7.4 タイポグラフィ

| 要素 | フォント | サイズ | ウェイト |
|------|---------|--------|---------|
| font-family | `-apple-system, BlinkMacSystemFont, "Segoe UI", "YuGothic", "Hiragino Sans", Arial, sans-serif` | — | — |
| h1 (タイトル) | 同上 | `2em` | 700 |
| サブタイトル | 同上 | `0.92em` | normal |
| LLM バッジ | 同上 | `0.82em` | 600 |
| section h2 | 同上 | `1.05em` | 700 |
| 本文 | 同上 | `14px` | normal |
| 話者ラベル | 同上 | `0.88em` | 700 |
| ボタンラベル | 同上 | `10px` | 700, letter-spacing: 0.08em, uppercase |
| 録音タイマー | `"SF Mono", "Courier New", monospace` | `1.25em` | 700 |
| 履歴ファイル名 | 同上 | `0.85em` | normal |
| 履歴日付 | 同上 | `0.8em` | normal |
| ステータステキスト | 同上 | `0.88em` | normal |
| body line-height | — | `1.6` | — |

### 7.5 コンポーネント詳細

#### 7.5.1 ヘッダー

- 白背景、角丸 `16px`、ボーダー `1px solid #e2e8f0`、影 `0 2px 8px rgba(0,0,0,0.06)`
- 中央揃え、padding `28px 24px 20px`
- h1: 「ミーティングトランスクリプト」
- サブタイトル: 「録音 → 文字起こし → AI整形・要約（完全ローカル）」
- LLM ステータスバッジ: inline-block、pill 型 (`border-radius: 20px`, `padding: 4px 16px`)

#### 7.5.2 コントロールバー（円形ボタン）

中央配置の横並び (`display: flex; justify-content: center; gap: 20px`)。各ボタンは縦にボタン + ラベルを配置する `circle-btn-wrap` 構造。

| ボタン | サイズ | アイコン | ラベル | 初期状態 |
|--------|--------|---------|--------|---------|
| 録音開始 (startBtn) | 72×72px (通常) → 録音中は SVG のみ表示 | `recording_stop.svg` (停止時) / `recording_doing.svg` (録音中) | 「録音開始」 | enabled |
| 停止 (stopBtn) | 72×72px | 白い角丸四角 SVG (`rect rx=2.5`) | 「停止」 | disabled (録音中のみ有効) |
| AI整形 (formatBtn) | 72×72px | 白い星＋スパークル SVG | 「AI整形」 | disabled (文字起こし後に有効) |
| 要約 (summaryBtn) | 72×72px | 白いドキュメント SVG (線画) | 「要約」 | disabled (文字起こし後に有効) |
| クリア (clearBtn) | 54×54px (小) | 白いゴミ箱 SVG (線画) | 「クリア」 | always enabled |

**録音中の録音開始ボタン特殊挙動:**
- `btn-recording` クラスが付与される
- 背景が transparent、shadow none、サイズ auto に変化
- SVG 画像が 30×30 → 90×90 に拡大 (`recording_doing.svg`)
- `recording_doing.svg` は赤い同心円のパルスアニメーション + 「REC」テキスト

**ボタン共通スタイル:**
- 角丸 50%（完全な円）、背景 `#111827`
- hover: `transform: scale(1.08)`, shadow 強化
- active: `transform: scale(0.95)`
- disabled: `opacity: 0.32; cursor: not-allowed`

#### 7.5.3 波形バー

- 録音中のみ表示 (`display: flex`)
- `flex` 方向: 横並び (Canvas + タイマー)
- Container: 白背景、角丸 `10px`、赤ボーダー `1.5px solid #ef4444`
- Canvas: `flex: 1`, 高さ `56px`
  - `AnalyserNode.getByteTimeDomainData()` でリアルタイム描画
  - 波形色: `#f5576c`、背景: `rgba(15, 23, 42, 0.3)` (半透明ダークネイビー)
  - 線幅: `2px`
- タイマー: 等幅フォント、赤色 `#ef4444`、最小幅 `60px`、右寄せ

#### 7.5.4 ステータスバー

- 横並び (dot + テキスト)
- 白背景、角丸 `10px`、padding `10px 16px`
- ドット: `9×9px` 円形、ステータスに応じた色
- `recording` / `processing` 時は `pulse` アニメーション (opacity 1→0.25→1)

#### 7.5.5 メインコンテンツ（カード2列）

- `display: grid; grid-template-columns: 1fr 1fr; gap: 16px`
- レスポンシブ: 900px 以下で `1fr` に切り替え
- 各カード: 白背景、角丸 `14px`、padding `20px`、ボーダー `1px solid #e2e8f0`

**カードヘッダー:**
- 横並び (`justify-content: space-between`)
- 左に h2 タイトル、右にコピーボタン (SVG アイコン)
- 下線: `1.5px solid #e2e8f0`

**コンテンツエリア:**
- `min-height: 350px; max-height: 500px; overflow-y: auto`
- 背景 `#f8fafc`、角丸 `8px`、ボーダー `1px solid #e2e8f0`
- スクロールバー: 幅 `5px`、thumb `#93c5fd`

#### 7.5.6 文字起こし表示

**話者行 (`.speaker-line`):**
- 背景 `#eff6ff` (青系薄色)
- 左側ボーダー `3px solid #2563eb`
- 角丸 `8px`、padding `8px 14px`
- 話者ラベル: bold、色 `#1d4ed8`、フォント `0.88em`
- テキスト: 色 `#111827`
- margin-bottom: `10px`

**話者行判定の正規表現:**
```javascript
/^(話者[0-9A-Zａ-ｚ０-９][\s：:]*)/
```
このパターンにマッチした場合、speaker-line スタイルで表示。

**セクション見出し (`.section-heading`):**
- 「【要点】」「##」「**」で始まる行
- bold、色 `#1d4ed8`、下線 `#bfdbfe`

**箇条書き (`.bullet-item`):**
- 「・」「-」「•」で始まる行
- 色 `#374151`、フォント `0.9em`

**通常テキスト (`.transcript-line`):**
- 色 `#374151`、フォント `0.9em`

#### 7.5.7 要約表示

- `.summary-text`: 色 `#111827`、line-height `1.85`、`white-space: pre-wrap`
- ストリーミング中はチャンクごとに `.textContent` を追記

#### 7.5.8 コピーボタン

- 各カード（文字起こし・要約）のヘッダー右端に配置
- SVG アイコン: クリップボード柄 (`rect + path`)、18×18px
- クリック → `navigator.clipboard.writeText()` → トースト通知

#### 7.5.9 履歴セクション

- 見出し: 「過去の録音」（`#6b7280`, `0.95em`, semibold）
- リストコンテナ: `max-height: 180px; overflow-y: auto`
- 各アイテム: 横並び (ファイル名 + 日付)
  - 白背景、角丸 `8px`、ボーダー `1px solid #e2e8f0`
  - Hover: 背景 `#eff6ff`、ボーダー `#93c5fd`
  - cursor: pointer
  - クリック → `readTranscript` → `displayTranscript()` → カードへスクロール

#### 7.5.10 トースト通知

- `position: fixed; top: 20px; right: 20px`
- 角丸 `10px`、padding `12px 20px`、影 `0 4px 16px rgba(0,0,0,0.12)`
- 表示アニメーション: `translateX(110%) → translateX(0)`, opacity `0 → 1`
- 3 秒後に自動消去
- 2 タイプ: success (緑 `#16a34a`) / error (赤 `#dc2626`)

#### 7.5.11 プレースホルダー

- 中央揃え、イタリック、色 `#9ca3af`
- padding `40px 20px`
- ローディング中は `.loading-dots` クラスで「...」アニメーション（CSS @keyframes）

#### 7.5.12 エラーメッセージ

- 背景 `#fee2e2`、テキスト `#dc2626`、左ボーダー `3px solid #ef4444`
- 角丸 `8px`、padding `12px`

---

## 8. 処理詳細

### 8.1 音声変換 (ffmpeg)

```
ffmpeg -y -i {input.webm} -ar 16000 -ac 1 -af {filter} -c:a pcm_s16le {output.wav}
```

**フィルタ自動選択（ffmpeg バージョンに応じて）:**

| 優先度 | フィルタ | 説明 |
|--------|---------|------|
| 1 | `highpass=f=80,lowpass=f=8000,afftdn=nf=-25` | スペクトル減算ノイズ除去 (新しいffmpeg) |
| 2 | `highpass=f=80,lowpass=f=8000,anlmdn` | 非局所平均ノイズ除去 |
| 3 | `highpass=f=80,lowpass=f=8000` | 基本バンドパスのみ (古いffmpeg) |

**ffmpeg パス解決順:**
1. `process.resourcesPath/ffmpeg/ffmpeg.exe` (パッケージ版)
2. `__dirname/resources/ffmpeg/ffmpeg.exe` (開発版)
3. `where ffmpeg` (システム PATH)

### 8.2 音声認識 (whisper.cpp)

```
main.exe -m {model} -f {wav} -l ja -oj -of {wav}
```

| パラメータ | 値 | 説明 |
|-----------|-----|------|
| `-m` | `ggml-base.bin` | モデルファイル |
| `-f` | WAV ファイルパス | 入力 |
| `-l` | `ja` | 日本語 |
| `-oj` | — | JSON 出力 |
| `-of` | WAV パス | 出力ファイルベース名 (`.json` が付与される) |

**出力 JSON 構造:**
```json
{
  "transcription": [
    {
      "text": "テキスト",
      "offsets": { "from": 0, "to": 3500 }
    }
  ]
}
```

**パス解決:**
- `app.getAppPath()` の `app.asar` を `app.asar.unpacked` に置換して `node_modules/whisper-node/lib/whisper.cpp/` を参照

### 8.3 話者分離 (sherpa-onnx)

子プロセス (`diarize-worker.js`) で実行し、WASM クラッシュからメインプロセスを保護。

**sherpa-onnx 設定:**
```javascript
{
  segmentation: {
    pyannote: { model: "segmentation.onnx" },
    numThreads: 1, debug: 0, provider: "cpu"
  },
  embedding: {
    model: "embedding.onnx",
    numThreads: 1, debug: 0, provider: "cpu"
  },
  clustering: { numClusters: -1, threshold: 0.55 },
  minDurationOn: 0.2,
  minDurationOff: 0.3
}
```

**話者アライメントアルゴリズム:**
1. Whisper の各セグメント `(start_ms, end_ms)` に対し
2. sherpa の各話者区間 `(start, end, speaker)` とのオーバーラップ時間を計算
3. 最大オーバーラップの話者番号を割り当て (0-indexed → 1-indexed に変換)
4. 話者分離結果がない場合は全セグメントに `speaker: 1` を付与

**タイムアウト:** 2 分

### 8.4 AI 整形 (node-llama-cpp)

**LLM 初期化:**
- `getLlama()` → `loadModel({ modelPath })` → `createContext({ sequences: 1 })`
- アプリ起動時に `did-finish-load` で非同期初期化

**JSON Schema Grammar:**
```json
{
  "type": "object",
  "properties": {
    "transcript": { "type": "string" }
  },
  "required": ["transcript"]
}
```

**プロンプト (AI 整形):**
```
あなたは音声認識テキストのノイズ除去専門家です。
以下のルールに従ってテキストを整形し、JSON の transcript フィールドに出力してください。

ルール:
- 認識エラーや意味不明な断片は自然な日本語に修正する
- 言い直し・繰り返し・フィラー（えー、あの、えっと等）を除去する
- 文末を適切に整える
- 【重要】各行頭に必ず話者情報を付与する。形式：「話者X: テキスト」
  - [話者N] の表記は「話者1:」「話者2:」のように数字に置き換えること
  - 話者情報は絶対に削除しない
- 要点・箇条書き・見出しなど余計なセクションは一切追加しない
- トランスクリプト本文のみを出力する

入力:
{rawText}

JSON:
```

**入力テキスト生成:**
- speaker フィールドがある場合: `[話者N]: テキスト` の形式で改行連結
- speaker なし: テキストのみ改行連結

### 8.5 要約生成 (node-llama-cpp)

**プロンプト:**
```
以下のミーティング内容を要約してください。重要な決定事項、アクションアイテム、次のステップを含めてください。

{transcriptText}

要約:
```

**ストリーミング:** `LlamaChatSession.prompt()` の `onTextChunk` コールバックでチャンクごとに IPC `summary-chunk` イベントを送信

---

## 9. 録音アイコン SVG 仕様

### 9.1 停止状態 (`recording_stop.svg`)

200×200 viewBox、白いマイクアイコン:
- マイク本体: `rect x=78 y=36 w=44 h=78 rx=22 fill=white`
- スタンド弧: `path Q曲線 stroke=white stroke-width=9`
- ポール: `line x1=100 y1=162 x2=100 y2=180 stroke=white stroke-width=9`
- ベース: `line x1=70 y1=180 x2=130 y2=180 stroke=white stroke-width=9`

### 9.2 録音中状態 (`recording_doing.svg`)

200×200 viewBox、赤いパルスアニメーション:
- 外側パルス: `circle r=40→72, opacity 0.6→0, dur=1.6s, #ff4d4d`
- 内側パルス: `circle r=40→56, opacity 0.6→0, dur=1.6s, begin=0.4s, #ff4d4d`
- 中心ドット: `circle r=32↔28, fill=#ff4d4d`
- REC ラベル: `text "REC" x=100 y=106, font-size=16, font-weight=900, fill=white`

---

## 10. セットアップスクリプト仕様

### 10.1 `setup.ps1` (300 行)

自動セットアップの手順:

| ステップ | 内容 |
|---------|------|
| 1 | Node.js の存在確認 |
| 2 | `npm install --loglevel=error` |
| 3 | `npm rebuild whisper-node` (C++ ネイティブビルド) |
| 4 | `ggml-base.bin` の確認・HuggingFace から自動ダウンロード (~142MB) |
| 5 | `whisper.cpp main.exe` の確認・GitHub Release から自動ダウンロード |
| 6 | `resources/` フォルダ構成作成 |
| 7 | `ffmpeg.exe` の確認・BtbN/FFmpeg-Builds から自動ダウンロード (~200MB) |
| 8 | 話者分離モデルの確認・自動ダウンロード (segmentation ~5.7MB + embedding ~37.8MB) |
| 9 | デスクトップショートカット「議事録アプリ」作成 (`wscript.exe` → `start.vbs`) |

### 10.2 起動方法

| 方法 | コマンド/操作 |
|------|-------------|
| 開発モード | `npm run dev` (`chcp 65001 && electron . --dev`) |
| 通常起動 | `npm start` (`chcp 65001 && electron .`) |
| バッチ起動 | `start.bat` (ダブルクリック) |
| コンソール非表示起動 | デスクトップショートカット → `start.vbs` → `npm start` |

### 10.3 重要な制約

- **OneDrive フォルダに配置しない**: OneDrive のパス短縮 (`SONG~1.HAO`) により `spawn UNKNOWN` エラーが発生する。`C:\realtimetranscript\` など C ドライブ直下に展開すること。
- **Visual C++ Build Tools**: whisper-node のネイティブビルドに必要な場合がある。
- **LLM モデルは手動配置**: `models/Qwen3.5-0.8B-Q4_K_M.gguf` (~508MB) は HuggingFace から手動ダウンロード。

---

## 11. Electron Forge ビルド設定

```javascript
{
  packagerConfig: {
    asar: true,
    icon: "icon",
    extraResource: ["resources/ffmpeg", "models"],
    asarUnpack: ["node_modules/whisper-node/lib/whisper.cpp/**"],
    win32metadata: {
      CompanyName: "RealTime Transcript",
      FileDescription: "Real-time Meeting Transcription and Summarization",
      ProductName: "RealTime Transcript"
    }
  },
  makers: [
    "@electron-forge/maker-squirrel",   // Windows インストーラー
    "@electron-forge/maker-zip",         // macOS ZIP
    "@electron-forge/maker-deb"          // Linux DEB
  ]
}
```

**重要な asar 設定:**
- `asar: true` — アプリを asar アーカイブにパック
- `asarUnpack` — whisper.cpp バイナリは asar 内から実行できないため展開
- `extraResource` — ffmpeg と models は `process.resourcesPath` に配置

---

## 12. preload.js API 一覧

```javascript
contextBridge.exposeInMainWorld("electronAPI", {
  // IPC invoke (レンダラー → メイン → レスポンス)
  processAudio:     (data)     => ipcRenderer.invoke("process-audio", data),
  formatTranscript: (segments) => ipcRenderer.invoke("format-transcript", segments),
  generateSummary:  (text)     => ipcRenderer.invoke("generate-summary", text),
  listTranscripts:  ()         => ipcRenderer.invoke("list-transcripts"),
  readTranscript:   (filePath) => ipcRenderer.invoke("read-transcript", filePath),
  checkLlm:         ()         => ipcRenderer.invoke("check-llm"),

  // IPC on (メイン → レンダラー、イベント)
  onStatusUpdate: (callback) => ipcRenderer.on("status-update", (event, data) => callback(data)),
  onSummaryChunk: (callback) => ipcRenderer.on("summary-chunk", (event, chunk) => callback(chunk)),
});
```

---

## 13. CSS アニメーション一覧

| 名前 | 用途 | 定義 |
|------|------|------|
| `pulse` | ステータスインジケータの点滅 | `opacity: 1 → 0.25 → 1` (1s / 0.7s) |
| `loading` | プレースホルダーのドットアニメーション | `content: "" → "." → ".." → "..."` (1.4s) |
| トースト表示 | スライドイン | `translateX(110%) → translateX(0)` (0.28s ease) |
| ボタン hover | スケール | `transform: scale(1.08)` (0.2s ease) |
| ボタン active | スケール | `transform: scale(0.95)` (0.2s ease) |
| 録音 SVG パルス (SVG SMIL) | 録音アイコン外周パルス | `r: 40→72, opacity: 0.6→0` (1.6s) |
| 録音 SVG 呼吸 (SVG SMIL) | 録音コアドットの呼吸 | `r: 32→28→32` (1.6s) |

---

## 14. エラーハンドリング

| 状況 | 処理 |
|------|------|
| マイクアクセス拒否 | ステータス「error」+ トースト通知 |
| ffmpeg 失敗 | `Error: ffmpeg code: N` を IPC レスポンスで返却 |
| whisper.cpp 失敗 | stderr 末尾 300 文字を含むエラーメッセージ |
| whisper.cpp 認識不可 | `(音声を認識できませんでした)` テキストで fallback |
| 話者分離失敗 | `null` 返却 → 全セグメントに `speaker: 1` を付与（デグレードなし） |
| 話者分離タイムアウト | 2 分で kill → null 返却 |
| LLM モデル未配置 | ステータス「error」+ モデル配置指示メッセージ |
| LLM 整形エラー | 生テキスト (`rawText`) をそのまま返却 |
| LLM 要約エラー | エラーメッセージを要約テキストとして返却 |
| JSON パースエラー | `(JSON解析エラー)` テキストで fallback |
| クリア操作 | `confirm()` ダイアログで確認後にリセット |

---

## 15. 状態遷移

### 15.1 ボタン状態

| 操作 | startBtn | stopBtn | formatBtn | summaryBtn |
|------|----------|---------|-----------|------------|
| 初期状態 | ✅ enabled | ❌ disabled | ❌ disabled | ❌ disabled |
| 録音中 | ❌ disabled (recording class) | ✅ enabled | ❌ disabled | ❌ disabled |
| 停止 → 解析中 | ❌ disabled | ❌ disabled | ❌ disabled | ❌ disabled |
| 文字起こし完了 | ✅ enabled | ❌ disabled | ✅ enabled | ✅ enabled |
| AI 整形完了 | ✅ enabled | ❌ disabled | ✅ enabled | ✅ enabled |
| クリア後 | ✅ enabled | ❌ disabled | ❌ disabled | ❌ disabled |
| 履歴読み込み後 | ✅ enabled | ❌ disabled | ✅ (セグメントあれば) | ✅ (セグメントまたはformatあれば) |

### 15.2 レンダラー内部状態

| 変数 | 型 | 説明 |
|------|-----|------|
| `mediaRecorder` | `MediaRecorder \| null` | 録音インスタンス |
| `audioChunks` | `Blob[]` | 録音データチャンク |
| `recordingStream` | `MediaStream \| null` | マイクストリーム |
| `audioContext` | `AudioContext \| null` | 波形解析用 |
| `analyser` | `AnalyserNode \| null` | FFT 解析ノード |
| `animFrameId` | `number \| null` | requestAnimationFrame ID |
| `recordingStartTime` | `number \| null` | 録音開始 timestamp |
| `timerInterval` | `number \| null` | タイマー interval ID |
| `currentFormattedText` | `string` | 現在の AI 整形テキスト |
| `currentRawSegments` | `Segment[] \| null` | 現在の生セグメント |

### 15.3 メインプロセス内部状態

| 変数 | 型 | 説明 |
|------|-----|------|
| `llamaModel` | `LlamaModel \| null` | LLM モデルインスタンス |
| `llamaContext` | `LlamaContext \| null` | 推論コンテキスト |
| `llamaInstance` | `Llama \| null` | llama インスタンス |
| `LlamaChatSession` | `class` | セッションクラス参照 |
| `LlamaJsonSchemaGrammar` | `class` | Grammar クラス参照 |

---

## 16. package.json

```json
{
  "name": "realtime-transcript",
  "version": "2.0.0",
  "description": "対面会議の録音・文字起こし・AI要約アプリ（完全ローカル・脱Python構成）",
  "main": "main.js",
  "license": "MIT",
  "scripts": {
    "start": "chcp 65001 && electron .",
    "dev": "chcp 65001 && electron . --dev"
  },
  "dependencies": {
    "node-llama-cpp": "^3.17.1",
    "sherpa-onnx": "^1.12.28",
    "whisper-node": "^1.1.0"
  },
  "devDependencies": {
    "electron": "^40.8.0"
  }
}
```

---

## 17. 再現に必要なリソース一覧

このアプリケーションを完全に再現するには、以下のリソースが必要:

| リソース | 取得元 | サイズ | 配置先 |
|---------|--------|--------|--------|
| Node.js | https://nodejs.org/ | — | システムインストール |
| ffmpeg.exe | https://github.com/BtbN/FFmpeg-Builds/releases | ~200 MB (ZIP) | `resources/ffmpeg/ffmpeg.exe` |
| ggml-base.bin | https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin | ~142 MB | `node_modules/whisper-node/lib/whisper.cpp/models/` |
| whisper.cpp main.exe | https://github.com/ggerganov/whisper.cpp/releases/download/v1.5.4/whisper-bin-x64.zip | — | `node_modules/whisper-node/lib/whisper.cpp/` |
| segmentation.onnx | sherpa-onnx GitHub Release (pyannote-segmentation-3-0) | ~5.7 MB | `models/diarization/` |
| embedding.onnx | sherpa-onnx GitHub Release (3dspeaker_speech_eres2net) | ~37.8 MB | `models/diarization/` |
| Qwen3.5-0.8B-Q4_K_M.gguf | https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF | ~508 MB | `models/` |
| favicon.ico | アプリ同梱 | — | `resources/favicon.ico` |
| recording_stop.svg | アプリ同梱 (上記 §9.1 仕様参照) | — | `resources/svg/` |
| recording_doing.svg | アプリ同梱 (上記 §9.2 仕様参照) | — | `resources/svg/` |
