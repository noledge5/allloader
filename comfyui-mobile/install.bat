@echo off
setlocal
cd /d "%~dp0"

echo ComfyUI Mobile - Installation
echo.

rem ComfyUI Desktop merkt sich seinen Basisordner in %APPDATA%\ComfyUI\config.json
set "BASE="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$p = Join-Path $env:APPDATA 'ComfyUI\config.json'; if (Test-Path $p) { (Get-Content -Raw $p | ConvertFrom-Json).basePath }"`) do set "BASE=%%P"
if not defined BASE set "BASE=%USERPROFILE%\Documents\ComfyUI"

if exist "%BASE%\custom_nodes" goto found
echo Der ComfyUI-Ordner wurde nicht automatisch gefunden.
echo Gemeint ist der Ordner, in dem "custom_nodes" liegt (z.B. C:\Users\Name\Documents\ComfyUI).
set /p "BASE=Pfad zum ComfyUI-Ordner: "
set "BASE=%BASE:"=%"
if exist "%BASE%\custom_nodes" goto found
echo.
echo In "%BASE%" gibt es keinen Ordner "custom_nodes". Abbruch.
pause
exit /b 1

:found
echo Ziel: %BASE%\custom_nodes\comfyui-mobile
robocopy "%~dp0." "%BASE%\custom_nodes\comfyui-mobile" /E /XD tests __pycache__ /XF install.bat /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo Kopieren fehlgeschlagen.
  pause
  exit /b 1
)

echo.
echo Fertig! Jetzt noch:
echo  1. In ComfyUI Desktop: Einstellungen - Server-Config - Host auf 0.0.0.0 stellen
echo     (nur beim ersten Mal noetig, damit das Handy den PC erreicht).
echo  2. ComfyUI Desktop neu starten. Fragt die Windows-Firewall nach, Zugriff
echo     im privaten Netzwerk erlauben.
echo  3. Auf dem iPhone in Safari oeffnen:  http://IP-DES-PCS:8000/mobile
echo     Die genaue Adresse steht im ComfyUI-Log (Zeile "[ComfyUI Mobile]").
echo.
pause
