# <img src="public/icon.svg" width="28" height="28" align="top" alt=""> AniBD — tu base de datos de animes

App web personal para llevar el registro de tus animes: **pendientes**, **en progreso**,
**completados**, con **puntuación y notas por temporada**, **géneros filtrables**, cantidad
de **veces vistas** y **promedio general por serie** (por ejemplo, Date A Live junta sus 6
temporadas y te muestra el promedio de todas).

Stack: **Node.js (Express) + PostgreSQL**. Frontend en HTML/CSS/JS sin dependencias.

---

## ▶ Uso rápido — un solo botón

Tenés un botón **AniBD** en el menú de aplicaciones y en el escritorio (ícono de AniBD).
Al abrirlo, con un click:

1. Prepara la base **solo si hace falta** (nunca borra tus datos),
2. Arranca el servidor y **abre el navegador** en http://localhost:3000.

**Cerrás la ventana de la terminal (o Ctrl+C) y se apaga TODO** (servidor + base). No hace
falta Docker ni PostgreSQL instalado: usa [PGlite](https://pglite.dev) (PostgreSQL embebido
dentro de Node) y guarda los datos en una carpeta local, **fuera del proyecto** (así podés
borrar/actualizar la carpeta de la app sin perder nada):

- Linux: `~/.local/share/anibd/pgdata` · Windows: `%APPDATA%\AniBD\pgdata` · Mac:
  `~/Library/Application Support/AniBD/pgdata`. Se cambia con `ANIBD_DATA_DIR`.
- Backup = copiar esa carpeta.

No hace falta ninguna preparación previa. Equivale a correr:

```bash
./anibd.sh        # o:  npm run go   /  npm run lite
```

> Reinstalar el botón (si moviste el proyecto): `cp AniBD.desktop ~/.local/share/applications/`

**Para pasárselo a alguien** (Windows/Mac/otra compu): que baje este repo (botón **Code →
Download ZIP** en GitHub, o `git clone`) y siga [`GUIA-INSTALACION.html`](GUIA-INSTALACION.html)
— instalar Node, descomprimir si hace falta, doble click en `AniBD.bat`; `Crear-acceso-directo.bat`
les deja el acceso directo con el ícono —`AniBD.ico`— en el Escritorio. La base arranca vacía y
cada uno carga sus animes desde la web (el buscador autocompleta todo desde AniList).

---

## Cómo funciona el modelo

- Un **anime** es la serie completa (ej: *Date A Live*). Tiene **géneros** y una sinopsis.
- Cada anime tiene una o varias **temporadas** (incluye películas y OVAs). Cada temporada
  guarda **de forma independiente**: estado, puntuación (0–10), notas/observaciones,
  veces vista, episodios y fechas.
- El **promedio general** del anime se calcula solo, promediando las puntuaciones de sus
  temporadas puntuadas.
- El **estado** (pendiente / en progreso / completado / en pausa / abandonado) vive en la
  temporada, así podés tener la T1 completada y la T2 pendiente.

---

## Requisitos

- **Node.js ≥ 20.6** (tenés v24 ✔). Ya trae todo; no hace falta nada más de JS — PostgreSQL
  viene embebido (PGlite), no hace falta instalar ni levantar nada aparte.

---

## (Opcional/avanzado) Usar PostgreSQL real en vez del embebido

> Si usás el **botón AniBD** o `npm start`/`npm run dev` tal cual (sección de arriba) no
> necesitás nada de esto: por defecto todo corre contra PGlite (embebido, sin Docker). Esta
> sección es solo para quien prefiera un PostgreSQL "de verdad" corriendo aparte — quitá o
> comentá `ANIBD_DB=pglite` de tu `.env` para volver a este modo.

Elegí **una** opción.

### Opción A — Docker

El daemon de Docker tiene que estar corriendo:

```bash
sudo systemctl start docker        # arranca el daemon (una vez por sesión)
```

Y después, si tenés el plugin `compose`:

```bash
docker compose up -d               # levanta la base
```

Si NO tenés el plugin `compose` (te tira "unknown command: docker compose"):

```bash
bash scripts/start-db.sh           # hace lo mismo con "docker run"
```

> Si `docker` te pide `sudo`, agregá tu usuario al grupo: `sudo usermod -aG docker $USER`
> y reiniciá la sesión. Mientras tanto podés anteponer `sudo` a los comandos de docker.

### Opción B — PostgreSQL nativo (Arch / CachyOS)

```bash
sudo pacman -S postgresql
sudo -u postgres initdb -D /var/lib/postgres/data   # solo la primera vez
sudo systemctl enable --now postgresql
sudo -u postgres psql -c "CREATE USER anibd WITH PASSWORD 'anibd';"
sudo -u postgres psql -c "CREATE DATABASE anibd OWNER anibd;"
```

Si elegiste una de estas dos opciones, configurá la conexión antes de arrancar:

```bash
cp .env.example .env      # comentá ANIBD_DB=pglite y ajustá DATABASE_URL si hace falta
npm install                # ya hecho, pero por las dudas
npm run db:schema          # crea las tablas
```

Con eso alcanza: la base queda vacía y cargás tus animes desde la web (el buscador autocompleta
todo desde AniList). Si además tenés un seed inicial propio armado con `src/seed.js`, `npm run
setup`/`db:seed` lo importan — ver [Scripts](#scripts).

---

## Desarrollo — levantar el server a mano

```bash
npm start                 # o "npm run dev" para autorecarga
```

Abrí **http://localhost:3000**. Con el `.env` por defecto (PGlite) no hace falta ningún paso
previo: la base se crea sola la primera vez.

Desde ahí podés: buscar, filtrar por **género** y **estado**, ordenar (mejor puntaje, más
visto…), crear animes, agregar temporadas, puntuar, dejar notas y sumar "veces vista" con
el botón **+1**. Clic en un chip de género para filtrar rápido.

---

## Scripts

| Comando             | Qué hace                                                     |
|----------------------|---------------------------------------------------------------|
| `npm run go`         | Todo-en-uno (= botón AniBD): base + server + navegador       |
| `npm run lite`       | Igual que `go`, invocado directo con Node (multiplataforma)  |
| `npm start`          | Levanta el servidor web                                      |
| `npm run dev`        | Igual, con autorecarga (`--watch`)                            |
| `npm run db:schema`  | Crea/reinicia las tablas (⚠️ borra lo que haya)               |
| `npm run db:check`   | Diagnóstico: cuántos animes tienen portada en la base         |
| `npm run setup`      | Crea el esquema **+** siembra datos iniciales, si los configuraste (`src/seed.js`, ⚠️ destructivo) |
| `npm run db:seed`    | Solo el paso de siembra inicial (no duplica)                  |
| `npm run fetch`      | Regenera metadata de AniList para la siembra (uso personal, internet) |
| `npm test`           | Tests del parser de listas (`src/parseAnimeList.js`)          |

---

## API (por si querés integrarla con otra cosa)

```
GET    /api/stats
GET    /api/genres                    POST /api/genres                DELETE /api/genres/:id
GET    /api/lookup?title=             (autocompletar desde AniList)
GET    /api/search?title=             (sugerencias, varios matches)
GET    /api/animes?genre=&status=&search=&sort=
POST   /api/animes                    GET /api/animes/:id
PATCH  /api/animes/:id                DELETE /api/animes/:id
GET    /api/animes/:id/missing        (temporadas/extras que faltan)
POST   /api/animes/:id/seasons        POST /api/animes/:id/extras
POST   /api/animes/:id/season-covers  (resuelve portadas por temporada)
PATCH  /api/seasons/:id               DELETE /api/seasons/:id
POST   /api/seasons/:id/watch         (suma una vista)
POST   /api/seasons/:id/episode       (avanza/retrocede episodios, body {delta})
GET    /api/recommendations           (según tus mejor puntuados)
```

---

## Estructura

```
AniBD/
├── db/
│   ├── schema.sql          Esquema PostgreSQL (tablas, vista de promedios, triggers)
│   └── migrations.sql      Cambios de esquema aditivos (para bases con datos)
├── src/
│   ├── server.js           Servidor Express + estáticos
│   ├── routes.js           API REST
│   ├── db.js               Pool de conexión (Postgres o PGlite embebido)
│   ├── anilist.js          Cliente de AniList (lookup/search/recomendaciones)
│   ├── parseAnimeList.js   Parser del formato de texto para la siembra inicial
│   └── seed.js             Siembra inicial a partir de ese texto
├── scripts/
│   ├── launch.js           Todo-en-uno sin Docker (npm run go / lite)
│   ├── ensure-db.js        Prepara/migra la base al arrancar (no destructivo)
│   └── db.js               CLI: schema / seed / setup / check
├── public/                 Frontend (index.html, styles.css, app.js)
└── test/parse.test.js      Tests del parser
```
