@echo off
echo ===========================================
echo COSTO File Checker
echo ===========================================
echo.
echo Drag and drop your DXF/DWG file onto this script
echo or run: check-your-file.bat "path\to\your\file.dxf"
echo.
echo This will verify if your file generates proper COSTO output.
echo.

if "%~1"=="" (
    echo ERROR: No file provided!
    echo Usage: check-your-file.bat "path\to\file.dxf"
    pause
    exit /b 1
)

node test-your-file.js "%~1"
pause
