@echo off
chcp 65001 >nul
cd /d "%~dp0"
cls

if not exist "%~dp0nat-tester.exe" (
    echo [LOI] Khong tim thay file nat-tester.exe!
    echo Hay dam bao ban de ca 2 file Chay-Thu-NAT.bat va nat-tester.exe trong CUNG MOT THU MUC.
    echo.
    pause
    exit /b
)

"%~dp0nat-tester.exe"
pause
