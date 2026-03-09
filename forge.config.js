module.exports = {
  packagerConfig: {
    asar: true,
    icon: "icon",
    // resources/ フォルダのバイナリをパッケージに同梱
    // （ollama.exe, ffmpeg.exe が配置されている場合のみ有効）
    extraResource: ["resources/ffmpeg", "models"],
    // whisper バイナリは asar 内から実行できないため除外して展開する
    asarUnpack: ["node_modules/whisper-node/lib/whisper.cpp/**"],
    win32metadata: {
      CompanyName: "RealTime Transcript",
      FileDescription: "Real-time Meeting Transcription and Summarization",
      ProductName: "RealTime Transcript",
    },
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
        certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
        iconUrl:
          "https://raw.githubusercontent.com/yourusername/realtimetranscript/main/icon.ico",
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"],
    },
    {
      name: "@electron-forge/maker-deb",
      config: {},
    },
  ],
  publishers: [
    {
      name: "@electron-forge/publisher-github",
      config: {
        repository: {
          owner: "yourusername",
          name: "realtimetranscript",
        },
        draft: true,
        prerelease: false,
        force: true,
      },
    },
  ],
  plugins: [],
};
