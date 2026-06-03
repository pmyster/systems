@echo off
REM ========================================================================
REM starter-pack runner - the "one command" launcher.
REM Wired to "npm run starter-pack" in editor-app/package.json.
REM
REM What this does:
REM   1. Activate the project-local Python venv.
REM   2. Run process.py with whatever args were passed (none = process all).
REM   3. On error, PAUSE so the window stays open.
REM ========================================================================

setlocal

REM Force UTF-8 codepage so logs with non-ASCII render correctly.
chcp 65001 >nul
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"

REM Resolve paths relative to this .bat file.
set "STARTER_PACK_DIR=%~dp0.."
set "VENV_PY=%STARTER_PACK_DIR%\venv\Scripts\python.exe"
set "PROCESS_PY=%STARTER_PACK_DIR%\scripts\process.py"

if not exist "%VENV_PY%" (
    echo.
    echo [starter-pack] ERROR: Python venv not found at:
    echo   %VENV_PY%
    echo.
    echo Run the setup steps in starter-pack\README.md first.
    echo.
    pause
    exit /b 2
)

if not exist "%PROCESS_PY%" (
    echo.
    echo [starter-pack] ERROR: process.py not found at:
    echo   %PROCESS_PY%
    echo.
    pause
    exit /b 2
)

echo [starter-pack] Using Python: %VENV_PY%
echo [starter-pack] Running: %PROCESS_PY% %*
echo.

"%VENV_PY%" "%PROCESS_PY%" %*
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%" == "0" (
    echo [starter-pack] All done. Exit code: %EXITCODE%
) else (
    echo [starter-pack] FINISHED WITH FAILURES. Exit code: %EXITCODE%
    echo Look at the per-photo .error.log files and the _logs folder.
)
echo.

REM Keep the window open so the owner can read the summary.
if not defined CI pause
endlocal
exit /b %EXITCODE%