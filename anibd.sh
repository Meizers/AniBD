#!/usr/bin/env bash
# AniBD — un solo click: sin Docker (PostgreSQL embebido vía PGlite). Prepara
# la base si hace falta, levanta el servidor y abre el navegador; al cerrar
# esta ventana (o Ctrl+C) apaga todo. Es lo mismo que hace AniBD.desktop.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

[ -d node_modules ] || { echo "Instalando dependencias…"; npm install; }

exec node scripts/launch.js
