#!/usr/bin/env bash
# Levanta PostgreSQL en Docker SIN necesidad del plugin "compose".
# Requiere el daemon de Docker corriendo (sudo systemctl start docker).
set -e

NAME=anibd-db

if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "El contenedor '$NAME' ya existe; lo arranco…"
  docker start "$NAME"
else
  docker run -d --name "$NAME" \
    -e POSTGRES_USER=anibd \
    -e POSTGRES_PASSWORD=anibd \
    -e POSTGRES_DB=anibd \
    -p 5432:5432 \
    -v anibd-data:/var/lib/postgresql/data \
    postgres:16-alpine
fi

echo "✔ PostgreSQL en localhost:5432  (usuario/clave/base: anibd)"
