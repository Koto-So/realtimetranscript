@echo off
chcp 65001 > nul
echo.
echo  ================================================
echo   Meeting Transcript App - セットアップ
echo  ================================================
echo.
echo  セットアップを開始します...
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0setup.ps1"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  [ERR] セットアップに失敗しました。
    pause
    exit /b 1
)
