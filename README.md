# リアルタイムトランスクリプト

対面会議でのミーティングを記録し、記録したトランスクリプトをローカルLLMで要約するWindowsデスクトップアプリケーションです。

🎯 **重要な特徴**: ユーザーは Node.js または Python をインストールする必要がありません！ Nuitka + Electron Forge により、完全にバンドルされたスタンドアロンアプリケーションを配布できます。

## 機能

- 🎤 **録音機能**: 対面会議の音声を高品質で録音
- 👥 **話者分離**: 複数の話者を自動的に識別・分離
- 📝 **リアルタイムトランスクリプト**: 音声をリアルタイムでテキスト化
- ✨ **AI要約**: ローカルLLM（Ollama）による会議内容の要約生成
- 💾 **自動保存**: トランスクリプトをJSON形式で自動保存
- 📦 **スタンドアロン配布**: インストーラー形式で簡単配布

## 技術スタック

- **フレームワーク**: Electron.js
- **ビルド・パッケージ化**:
  - **Nuitka** - Python コードを Windows .exe にコンパイル
  - **Electron Forge** - デスクトップアプリのインストーラー生成
- **録音**: PyAudio
- **音声処理**: faster-whisper (OpenAI Whisper)
- **話者分離**: pyannote.audio
- **要約AI**: Ollama (qwen3.5:0.8b)
- **UI**: HTML/CSS/JavaScript

## 前提条件

### 開発環境

- Node.js (v18以上)
- Python (v3.8以上)
- pip

### 配布版（ユーザー向け）

- Windows 7以上
- 十分なディスク容量（インストーラーサイズ: 約500MB～1GB）
- Ollamaサービス（別途インストール）

## セットアップ

### 1. リポジトリのクローン

```bash
git clone <repository-url>
cd realtimetranscript
```

### 2. 自動セットアップスクリプトの実行

```powershell
.\setup.ps1
```

このスクリプトは以下を自動実行します:

- Node.js依存関係のインストール
- Python仮想環境（venv）の作成
- Python依存関係のインストール
- **Nuitka による Python実行ファイルのコンパイル**（オプション）
- 必要なディレクトリの作成

### 3. 手動セットアップ（オプション）

上記スクリプトを使わない場合:

```bash
# Node.js依存関係
npm install

# Python仮想環境の作成
python -m venv venv
.\venv\Scripts\Activate.ps1

# Python依存関係
pip install --upgrade pip setuptools wheel
pip install nuitka zstandard cffi patchelf pyaudio numpy
pip install faster-whisper pyannote.audio torch torchaudio  # オプション

# Ollamaのインストール
ollama pull qwen3.5:0.8b
```

### 4. Ollamaのインストールと設定

1. [Ollama公式サイト](https://ollama.ai/)からOllamaをダウンロード・インストール
2. qwen3.5:0.8bモデルをダウンロード:
   ```bash
   ollama pull qwen3.5:0.8b
   ```
3. Ollamaサービスが起動していることを確認:
   ```bash
   ollama serve
   ```

## 使用方法

### 開発モード

```bash
# 一般的な実行
npm start

# DevToolsを開く
npm run dev
```

### インストーラーの生成（配布向け）

```bash
# Windowsインストーラーを生成
npm run make

# または、すべてのプラットフォーム
npm run publish
```

生成されたインストーラーは `out/` ディレクトリに配置されます。

### Python実行ファイルのコンパイル（オプション）

Nuitkaを使用して、Python スクリプトを Windows の .exe にコンパイルすることで、ユーザー側での Python インストール不要化:

```bash
python build.py
```

コンパイル済みの実行ファイルは `bin/audio_processor.exe` に保存されます。

アプリケーションは自動的にバンドル済みの .exe を検出し、使用します。

## ディレクトリ構造

```
realtimetranscript/
├── main.js                    # Electronメインプロセス
├── preload.js                 # セキュアなIPC通信
├── index.html                 # UIのHTML
├── styles.css                 # UIのスタイル
├── renderer.js                # UIのロジック
├── audio_processor_standalone.py  # 音声処理（Nuitka対応）
├── audio_processor.py         # 音声処理（参照用）
├── build.py                   # Nuitkaビルドスクリプト
├── forge.config.js            # Electron Forge設定
├── setup.ps1                  # 自動セットアップスクリプト
├── package.json               # Node.js依存関係
├── requirements.txt           # Python依存関係
├── venv/                      # Python仮想環境
├── bin/                       # コンパイル済み実行ファイル
├── recordings/                # 録音ファイル保存先
├── transcripts/               # トランスクリプト保存先
└── out/                       # ビルド出力（インストーラーなど）
```

## 基本的な使い方

1. **録音開始**:
   - 「録音開始」ボタンをクリック
   - マイクへのアクセス許可を承認
   - 会議を開始

2. **リアルタイム表示**:
   - 音声が自動的に文字起こしされ、画面に表示されます
   - 話者ごとに識別して表示されます

3. **録音停止**:
   - 「録音停止」ボタンをクリック
   - トランスクリプトが自動的に保存されます

4. **要約生成**:
   - 「要約生成」ボタンをクリック
   - AIが会議内容を要約します
   - 要約をコピーして他のアプリケーションで使用できます

## トラブルシューティング

### 文字化けメッセージが表示される（PyAudio や faster-whisper 関連）

**症状**: 以下のような文字化けメッセージが表示される

```
Python Error: ・ｽx・ｽ・ｽ: PyAudio ・ｽ・ｽ・ｽC...
```

**原因**: Windows PowerShell のコンソールエンコーディングが Shift_JIS になっている

**対応方法**:

```powershell
# PowerShell で最初に実行：
chcp 65001

# その後、キャッシュをクリアして再インストール：
pip cache purge
pip install --force-reinstall -r requirements.txt
```

### マイクが認識されない

- Windowsの設定でマイクのアクセス許可を確認
- デバイスマネージャーでマイクが正常に動作しているか確認

### PyAudioのインストールエラー

```bash
pip install pipwin
pipwin install pyaudio
```

### Ollamaに接続できない

- Ollamaサービスが起動しているか確認: `ollama serve`
- ファイアウォール設定を確認
- デフォルトポート (11434) が使用可能か確認

### Nuitkaコンパイルエラー

- MinGW-w64 が必要な場合があります
- `pip install nuitka` で最新版にアップグレード
- `pyinstaller` を代替案として使用

## ビルドプロセス説明

### 1. 開発フェーズ

```
Python スクリプト → Electron + Node.js → ローカル実行
```

### 2. ビルドフェーズ

```
Python スクリプト
  ↓
Nuitka コンパイル → audio_processor.exe
  ↓
Electron Forge パッケージ化
  ↓
Windows インストーラー (.exe / .msi)
```

### 3. ユーザー配布

```
インストーラーを実行
  ↓
スタンドアロンアプリをインストール
  ↓
Python / Node.js 不要で直接実行 ✓
```

## ライセンス

MIT License

## 今後の改善予定

- [ ] リアルタイムストリーミング処理の実装
- [ ] より正確な話者分離アルゴリズム
- [ ] マルチ言語対応
- [ ] クラウドストレージへの自動バックアップ
- [ ] カスタムLLMモデルのサポート
- [ ] Linux/Mac版のサポート

## 貢献

プルリクエストは歓迎します。大きな変更の場合は、まずissueを開いて変更内容を議論してください。

## サポート

問題が発生した場合は、GitHubのIssuesセクションに報告してください。
