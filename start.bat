@echo off
cd /d "%~dp0"

echo Suche Python...
where python >nul 2>nul
if errorlevel 1 (
  echo Python wurde nicht gefunden.
  echo Bitte installiere Python von https://python.org ^(Haken bei "Add python.exe to PATH" setzen^)
  echo und starte diese Datei danach erneut.
  pause
  exit /b 1
)
echo Python gefunden.

echo.
echo Installiere/pruefe Abhaengigkeiten ^(kann beim ersten Mal 1-2 Minuten dauern^)...
echo.
python -m pip install -r requirements.txt --timeout 30
if errorlevel 1 (
  echo.
  echo Installation einzelner Pakete ist fehlgeschlagen ^(z.B. wegen einer
  echo langsamen/instabilen Internetverbindung^). Das Programm startet trotzdem;
  echo falls dabei "ModuleNotFoundError" erscheint, starte start.bat einfach
  echo noch einmal - bereits installierte Pakete werden dabei nicht neu geladen.
  echo.
)

echo.
echo Starte Server...
echo.
python app.py

echo.
echo Server wurde beendet.
pause
