@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM ---------- Fix Windows Store python stub ----------
set "PATH=%LOCALAPPDATA%\Programs\Python\Python311;%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python313;%ProgramFiles%\Python311;%ProgramFiles%\Python312;%ProgramFiles%\Python313;%PATH%"

REM ---------- Encoding & Mirrors ----------
set PYTHONIOENCODING=utf-8
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILTIN_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

echo ============================================
echo    LiangLLM - One-Click Launcher
echo ============================================
echo.

REM ---------- 1. Check Node ----------
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install Node.js 18+ from https://nodejs.org/
    pause
    exit /b 1
)

REM ---------- 2. Check Python ----------
where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Install Python 3.11+ from https://www.python.org/downloads/
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version 2^>nul') do set NODE_VER=%%v
for /f "tokens=*" %%v in ('python --version 2^>^&1') do set PY_VER=%%v
echo [OK] Node.js: !NODE_VER!
echo [OK] Python:  !PY_VER!
echo.

REM ---------- 3. Frontend deps ----------
if not exist "node_modules\" (
    echo [1/3] Installing frontend deps...
    call npm install --registry https://registry.npmmirror.com
    if errorlevel 1 (
        call npm install
        if errorlevel 1 (
            echo [ERROR] npm install failed.
            pause
            exit /b 1
        )
    )
    echo       done.
) else (
    echo [1/3] node_modules ready.
)

REM ---------- 3b. Ensure Electron binaries present ----------
if not exist "node_modules\electron\dist\electron.exe" (
    echo       Electron binary missing, downloading from npmmirror...
    for /f "tokens=*" %%v in ('node -e "console.log(require(\x27node_modules/electron/package.json\x27).version)"') do set EL_VER=%%v
    echo       Electron v!EL_VER!...
    powershell -NoProfile -Command ^
        "$zip=\"$env:TEMP\electron-v!EL_VER!-win32-x64.zip\"; " ^
        "curl.exe -sSL \"https://npmmirror.com/mirrors/electron/v!EL_VER!/electron-v!EL_VER!-win32-x64.zip\" -o \"$zip\" --max-time 180; " ^
        "if (-not (Test-Path $zip)) { throw 'Electron download failed' }; " ^
        "New-Item -ItemType Directory -Force node_modules\electron\dist ^| Out-Null; " ^
        "Expand-Archive -Path $zip -DestinationPath node_modules\electron\dist -Force; " ^
        "Set-Content -Path node_modules\electron\path.txt -Value 'electron.exe' -NoNewline"
    if errorlevel 1 (
        echo [ERROR] Electron download failed. Check network.
        pause
        exit /b 1
    )
    echo       Electron ready.
)

REM ---------- 4. Backend venv + deps ----------
echo [2/3] Checking backend env...

if not exist "backend\venv\" (
    echo       Creating venv...
    cd backend
    python -m venv venv
    if errorlevel 1 (
        echo [ERROR] python -m venv failed.
        cd ..
        pause
        exit /b 1
    )
    echo       Installing backend packages...
    venv\Scripts\pip.exe install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
    if errorlevel 1 (
        venv\Scripts\pip.exe install -r requirements.txt
        if errorlevel 1 (
            echo [ERROR] pip install failed.
            cd ..
            pause
            exit /b 1
        )
    )
    cd ..
    echo       done.
) else (
    echo [2/3] backend\venv ready.
)

REM ---------- 5. Kill stale backend/llama ports ----------
echo [3/3] Cleaning ports 19600 and 8080...
powershell -NoProfile -Command ^
  "foreach ($p in 19600,8080) { " ^
  "$c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; " ^
  "foreach ($x in $c) { taskkill /PID $x.OwningProcess /F | Out-Null } }" 2>nul

REM ---------- 6. Launch Electron ----------
echo [4/4] Launching LiangLLM...
echo ============================================
echo.

call npm.cmd start

endlocal
