@echo off
title Fahd AI - No API Key
cd /d "%~dp0"

rem Default model. Override with:  set FAHD_MODEL=qwen2.5:7b
if "%FAHD_MODEL%"=="" set FAHD_MODEL=llama3.2

echo ========================================
echo          FAHD AI - FREE LOCAL AI
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install Node.js first.
  pause
  exit /b 1
)

where ollama >nul 2>nul
if errorlevel 1 (
  echo Ollama is not installed.
  echo.
  echo Install Ollama from:
  echo https://ollama.com/download/windows
  echo.
  pause
  exit /b 1
)

echo Checking local AI model (%FAHD_MODEL%)...
ollama list | findstr /I "%FAHD_MODEL%" >nul
if errorlevel 1 (
  echo %FAHD_MODEL% is not downloaded yet.
  echo Downloading it now...
  echo This can take a while.
  echo.
  ollama pull %FAHD_MODEL%
  if errorlevel 1 (
    echo.
    echo Could not download the model.
    pause
    exit /b 1
  )
)

echo.
echo Starting Fahd AI...
start "" http://localhost:3000
node server.js
pause
