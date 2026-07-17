@echo off
rem Crea un acceso directo a AniBD (con su icono) en el Escritorio.
title Crear acceso directo de AniBD
cd /d "%~dp0"

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'AniBD.lnk')); $lnk.TargetPath = '%~dp0AniBD.bat'; $lnk.WorkingDirectory = '%~dp0'; $lnk.Description = 'AniBD - tu base de datos de animes'; if (Test-Path '%~dp0AniBD.ico') { $lnk.IconLocation = '%~dp0AniBD.ico' }; $lnk.Save()"

if errorlevel 1 (
  echo.
  echo   No se pudo crear el acceso directo. Podes hacerlo a mano:
  echo   click derecho sobre AniBD.bat ^> "Enviar a" ^> "Escritorio".
  echo.
  pause
  exit /b 1
)

echo.
echo   Listo: ya tenes el acceso directo "AniBD" en el Escritorio.
echo.
pause
