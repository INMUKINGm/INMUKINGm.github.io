@echo off
chcp 65001 >nul
title BEAST Senpai
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  node tools\serve.mjs 8730 --open
) else (
  echo Node.js が見つかりません。Python で起動します（MVのシークが遅くなります）。
  start "" http://localhost:8730/
  python -m http.server 8730
)
pause
