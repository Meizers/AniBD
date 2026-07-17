@echo off
rem AniBD para Windows: doble click y listo. Sin Docker: usa PostgreSQL
rem embebido (PGlite); los datos quedan en %%APPDATA%%\AniBD\pgdata.
title AniBD
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Falta Node.js. Instalalo desde  https://nodejs.org  ^(boton "LTS"^),
  echo   con las opciones por defecto, y volve a abrir AniBD.bat.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias... ^(solo la primera vez, tarda un poco^)
  call npm install
  if errorlevel 1 (
    echo.
    echo   Fallo la instalacion de dependencias. Revisa tu conexion a internet.
    echo.
    pause
    exit /b 1
  )
)

node scripts\launch.js
if errorlevel 1 pause
