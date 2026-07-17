#!/usr/bin/env bash
# AniBD — un solo click: levanta TODO (Docker + PostgreSQL + web + navegador)
# y al cerrar esta ventana (o Ctrl+C) apaga TODO.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

DB_NAME=anibd-db
PORT="${PORT:-3000}"
URL="http://localhost:${PORT}"
SERVER_PID=""

log() { printf '\033[35m▸ %s\033[0m\n' "$*"; }

cleanup() {
  echo
  log "Cerrando AniBD…"
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  docker stop "$DB_NAME" >/dev/null 2>&1 || true
  log "Todo apagado. ¡Chau! 🌸"
}
trap cleanup EXIT INT TERM HUP

# 1) Daemon de Docker (si está apagado). Pide contraseña una sola vez.
if ! docker info >/dev/null 2>&1; then
  log "Arrancando el servicio de Docker (puede pedir tu contraseña)…"
  if command -v pkexec >/dev/null 2>&1; then
    pkexec systemctl start docker
  else
    sudo systemctl start docker
  fi
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi

# 2) Contenedor de PostgreSQL (crea la 1ª vez, arranca las siguientes).
if docker ps --format '{{.Names}}' | grep -qx "$DB_NAME"; then
  log "PostgreSQL ya estaba corriendo."
elif docker ps -a --format '{{.Names}}' | grep -qx "$DB_NAME"; then
  log "Arrancando PostgreSQL…"
  docker start "$DB_NAME" >/dev/null
else
  log "Creando PostgreSQL (primera vez, descarga la imagen)…"
  docker run -d --name "$DB_NAME" \
    -e POSTGRES_USER=anibd -e POSTGRES_PASSWORD=anibd -e POSTGRES_DB=anibd \
    -p 5432:5432 -v anibd-data:/var/lib/postgresql/data \
    postgres:16-alpine >/dev/null
fi

# 3) Dependencias (por si es la primera vez).
[ -d node_modules ] || { log "Instalando dependencias…"; npm install; }

# 4) Esperar la base e inicializar SOLO si está vacía (no borra tus datos).
node scripts/ensure-db.js

# 5) Servidor web.
log "Levantando el servidor…"
node --env-file-if-exists=.env src/server.js &
SERVER_PID=$!

# 6) Abrir el navegador cuando el server responda.
for _ in $(seq 1 40); do
  curl -s -o /dev/null "$URL" && break || sleep 0.5
done
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 || true
fi

log "AniBD abierto en ${URL}"
log "Cerrá esta ventana (o Ctrl+C) para apagar TODO."
wait "$SERVER_PID"
