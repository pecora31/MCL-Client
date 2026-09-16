@echo off
chcp 65001 >nul
cd /d "%~dp0"
cls

REM Builds the diagnostic tool if needed, then runs it. Takes a few minutes the first time.
if not exist "target\release\nat-tester.exe" (
    echo Building nat-tester, this only happens once...
    echo.
    cargo build --release
    if errorlevel 1 (
        echo.
        echo Build failed. Install Rust from https://rustup.rs and try again.
        pause
        exit /b 1
    )
)

"target\release\nat-tester.exe" %*
pause
