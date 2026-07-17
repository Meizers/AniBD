# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

**AniBD**: app web personal para trackear animes (pendiente / en progreso / completado, con
puntuación, notas y "veces vistas" **por temporada**, géneros filtrables y **promedio general
por serie**). Backend Node/Express + PostgreSQL; frontend vanilla en `public/` (sin dependencias
ni paso de build). La lista fuente del usuario es `Anime ordenado.txt` (español rioplatense).

## Entorno (no obvio)

- **Node ≥ 20.6** (se usan `--env-file-if-exists`, `node:test`, `fetch`/`AbortSignal.timeout`
  globales). El stack es Node **porque en esta máquina Python 3.14 no tiene `pip`**.
- **La máquina del usuario ya NO usa Docker**: dejó de usarlo por preferencia (más simple sin
  él). El `.env` local (gitignored) tiene `ANIBD_DB=pglite`, así que `npm start`/`npm run dev`
  también corren contra PGlite. Su base real (300+ animes) vive en
  `~/.local/share/anibd/pgdata`, migrada ahí — no hay contenedor ni volumen Docker en esta
  máquina. Docker/PostgreSQL nativo siguen documentados en el README como opción
  opcional/avanzada (por si algún día se quiere un Postgres real), pero no son el flujo
  esperado acá.
- **Modo portable / embebido (`ANIBD_DB=pglite`)**: PostgreSQL embebido vía `@electric-sql/pglite`
  (WASM), sin Docker — es el modo por defecto (tanto para el uso normal del usuario como para
  distribuirlo a otras personas en Windows). Tiene prioridad sobre `DATABASE_URL`. Datos en
  `%APPDATA%\AniBD\pgdata` / `~/.local/share/anibd/pgdata` (override: `ANIBD_DATA_DIR`), a
  propósito FUERA del proyecto. La abstracción vive en `src/db.js` (misma interfaz
  `pool.query`/`tx`; normaliza `rowCount` desde `affectedRows` y usa `exec()` para SQL
  multi-statement como `schema.sql`). PGlite trae códigos SQLSTATE reales, así que el mapeo de
  errores del server funciona igual.
- **PostgreSQL real (Docker o nativo) sigue soportado como alternativa**, no como default:
  conexión por `DATABASE_URL` (default `postgres://anibd:anibd@localhost:5432/anibd`), usado
  solo si se comenta `ANIBD_DB=pglite` del `.env`. `docker-compose.yml` / `scripts/start-db.sh`
  siguen ahí para quien lo quiera (contenedor `anibd-db`, volumen `anibd-data`, sin plugin
  `docker compose` → se usa `docker run` / `scripts/start-db.sh`), pero **no están en uso**.

## Comandos

- `npm run go` (= `./anibd.sh`, = botón `AniBD.desktop`): todo-en-uno SIN Docker (pglite) —
  **inicializa la base solo si está vacía** (`scripts/ensure-db.js`, no destructivo) y si ya
  tiene datos aplica las **migraciones idempotentes** de `db/migrations.sql`
  (`ALTER … IF NOT EXISTS`, sin borrar nada), arranca el server y abre el navegador; al cerrar
  la ventana se apaga todo (server; los datos de pglite quedan en disco). Los cambios de
  esquema **aditivos** van a `db/migrations.sql` (para bases con datos) **y** a `db/schema.sql`
  (para instalaciones nuevas). `anibd.sh` es un wrapper fino que delega en
  `scripts/launch.js` — mismo motor que `npm run lite`/`AniBD.desktop`.
- `npm run lite` (= `node scripts/launch.js`, = `AniBD.bat` en Windows): equivalente
  multiplataforma a `npm run go` (fuerza `ANIBD_DB=pglite` igual, sea cual sea el `.env`):
  ensure-db + server + navegador. Con base vacía y sin `Anime ordenado.txt`, `ensure-db` NO
  falla: deja la base vacía (instalaciones de amigos; guía para ellos:
  `GUIA-INSTALACION.html`; `Crear-acceso-directo.bat` crea el acceso directo en el Escritorio
  con `AniBD.ico`, generado desde `public/icon.svg` con ImageMagick). El ZIP para repartir se
  arma excluyendo `node_modules`, la lista personal y `.env` (comando en README § Uso rápido).
- `npm start` / `npm run dev` (`--watch`): server en http://localhost:3000.
- `npm run setup`: **DROP + recrea el esquema y reimporta la lista (DESTRUCTIVO).** Necesario
  para aplicar cambios de `data/anime-metadata.json` a una base ya creada (el arranque normal
  NO re-siembra si la base tiene datos). `db:schema` = solo esquema, `db:seed` = solo import.
- `npm run db:check`: diagnóstico — cuántos animes tienen portada en la base.
- `npm test` (= `node --test`). Un test suelto: `node --test test/parse.test.js`.
- `npm run fetch`: consulta AniList y (re)genera `data/anime-metadata.json` (~4 min, red).

## Modelo de datos (`db/schema.sql`)

- `anime` (la serie) **1—N** `season`. **El estado, la puntuación, las notas, `times_watched` y el
  progreso (`watched_episodes`) viven en la TEMPORADA**, no en el anime (podés tener T1 completada y
  T2 pendiente). `anime` tiene title / synopsis / cover_url / **`year` / `studio`** (metadata
  autocompletada desde AniList al crear/editar). **La temporada tiene su propia `cover_url`**
  (portada distinta por temporada, opcional) más `total_episodes` / **`watched_episodes`** (progreso)
  / **`duration`** (min/ep).
- `genre` **M—N** `anime` vía `anime_genre` (géneros a nivel serie).
- Vista **`anime_stats`**: agrega por anime el `avg_score`, conteos por estado y total de vistas,
  más `tv_count` (temporadas TV) y `extra_count` (pelis/OVAs) — la card usa `tv_count` para "temp."
  (las pelis/OVAs NO cuentan como temporada). **El promedio general de una serie sale de esta
  vista, no de una columna.**
- Función **`anibd_unaccent(text)`** (IMMUTABLE, `translate`, sin depender de la extensión
  `unaccent`): normaliza mayúsculas y acentos para que la búsqueda ignore tildes ("cafe" encuentra
  "Café"). La usa el filtro `search` de `GET /animes`.
- Enum `watch_status`: `pendiente | en_progreso | completado | en_pausa | abandonado`.
- Título único case-insensitive (índice sobre `lower(title)`); `UNIQUE(anime_id, number)`.

## Arquitectura backend (`src/`)

- `server.js`: Express; monta `/api` y sirve `public/`. **Boota aunque Postgres esté caído**
  (loguea y sigue). El middleware de error mapea códigos pg → HTTP (`23505`→409, `23514`→400,
  `ECONNREFUSED`→503).
- `routes.js`: toda la API en un Router, con SQL **parametrizado** vía pg (sin ORM). `ANIME_SELECT`
  es el SELECT reutilizable (anime + `anime_stats` + `array_agg` de géneros + un **LATERAL** que
  elige la temporada "en foco" → `focus_*`: la que estás viendo, o la próxima pendiente, o la última
  completada; alimenta las **acciones rápidas** de la card). Los filtros de `GET /animes`
  (`genre/status/search/sort`) se arman dinámicamente. **`search` matchea el título de la serie O el
  de cualquier temporada/peli/OVA** (así "date a bullet" encuentra "Date A Live") **ignorando acentos**
  vía `anibd_unaccent`. `POST /animes` autocompleta portada/géneros/**sinopsis/año/estudio** desde
  AniList si no vienen, y **puebla todo el franchise como pendiente** vía `walkFranchise` (con
  `total_episodes`/`duration` por entrada; fallback: una "Temporada 1" pendiente si no hay match).
  - **Progreso:** `POST /seasons/:id/episode` (`{delta}`, default +1) mueve `watched_episodes` y
    ajusta el estado solo (arrancar → `en_progreso` + `started_at`; llegar al total → `completado` +
    `finished_at`; no pisa `en_pausa`/`abandonado`).
  - **Franchise faltante:** `GET /animes/:id/missing` corre `walkFranchise` y devuelve lo que aún no
    tenés (dedup por título/portada) —TV **y** extras—; el front filtra por tipo (botón "🔎 ¿Faltan?"
    en Temporadas y "🔎 Buscar relacionadas" en Películas/OVAs). El alta en lote es `POST
    /animes/:id/extras` (sirve para tv/movie/ova).
  - **Recomendaciones:** `GET /recommendations` toma tus 6 series mejor puntuadas como semilla, junta
    las recomendaciones de AniList (`recommend()`) y excluye lo que ya tenés.
- `db.js`: Pool de pg + helper `tx()` (BEGIN/COMMIT/ROLLBACK).
- `anilist.js`: dos sets de campos — `CARD_FIELDS` (livianos, para el autocompletado) y `FULL_FIELDS`
  (suman `description`/`episodes`/`duration`/`seasonYear`/`studios`, para lookup y recomendaciones).
  `lookup(title)` → AniList GraphQL (sin API key) → mejor match `{ cover_url, thumb_url, genres (en
  español), romaji, siteUrl, averageScore, description (sin HTML), episodes, duration, year, studio }`.
  `search(title, limit)` → **varios** matches (livianos) para el autocompletado.
  `recommend(titles)` → agrega las recomendaciones de AniList de varias semillas por votos (usado por
  `GET /recommendations`). `seasonCover(animeTitle, season, animeCover)` → resuelve
  la portada de UNA temporada probando consultas de más a menos específica (título propio → "<serie>
  II/III…" o "<serie> Movie/OVA" → serie); la **T1 reusa la portada de la serie sin pegarle a la
  red**. Usados por `POST /animes`, `GET /api/lookup`, `GET /api/search` (sugerencias del front) y
  `POST /animes/:id/season-covers`.
- `walkFranchise(title)` (en `anilist.js`): parte del mejor match y recorre el franchise por
  **SEQUEL/PREQUEL** (atravesando las OVAs/películas intercaladas, que en AniList conectan
  temporadas) devolviendo **todas** las entradas —TV, películas y OVAs— únicas y **ordenadas por
  fecha de estreno** (cada entrada trae `episodes`/`duration`); **BFS acotado** (`maxCalls`) para no
  dispararse. Derivado: `relatedExtras()` = `walkFranchise().filter(kind!=='tv')`.
  - `POST /animes` lo usa para **poblar toda la obra como `pendiente`** al crear (fallback a una
    "Temporada 1" si no hay match; se puede desactivar con `autoseasons:false` en el body). El front
    muestra "Creando y buscando temporadas…" mientras tanto.
  - `GET /animes/:id/missing` (dedup contra lo ya cargado por título o portada) alimenta el diálogo
    `#dlgRelated` (checkboxes), reusado en dos modos: "🔎 ¿Faltan?" (temporadas TV) y "🔎 Buscar
    relacionadas" (pelis/OVAs). El alta en lote es `POST /animes/:id/extras`.
- **Portadas por temporada (auto):** al abrir un anime, el front llama a
  `POST /animes/:id/season-covers`, que para cada temporada con `cover_url` NULL resuelve y
  **persiste** su portada (idempotente; si AniList falla la deja en NULL para reintentar). El front
  actualiza las miniaturas en el lugar, sin re-render, para no pisar ediciones. Cada temporada tiene
  además su campo de portada editable con botón 🔍 manual.
- `seed.js`: importa `Anime ordenado.txt` y, si existe `data/anime-metadata.json`, aplica sus
  **merges** (une temporadas mal separadas), géneros y portada. **Mantiene los títulos del
  usuario** (no los reemplaza por el romaji). Todo entra como `completado`, 1 vista. Exporta
  `applyMerges/metaFor/hintGenres` (funciones puras) para verificar el pipeline sin base.
- `parseAnimeList.js`: parser de la lista — extrae título, puntaje `[x/10]`, nota entre
  paréntesis y agrupa temporadas por marcadores (`2`, `II`, `2da temporada`, `Movie`…). **Es la
  lógica cubierta por tests** (`test/parse.test.js`).

## Frontend (`public/`, vanilla)

- `app.js`: `fetch` contra `/api`; construye DOM con un mini `h()` (evita `innerHTML`, salvo las
  cards del grid). `runLookup()` autocompleta portada/géneros/sinopsis/año/estudio al salir del campo
  Título (nuevo anime) y con el botón 🔍 (detalle). Las `<img>` de portada usan
  `referrerpolicy="no-referrer"`.
- **Acciones rápidas en la card** (`quickBar` sobre la portada, se revela al hover): según la
  temporada en foco (`focus_*`), "▶ +1" avanza un episodio con barrita de progreso, o "👁 +1 vista"
  suma un rewatch si ya está completada — **sin abrir el detalle** (recarga solo el grid + stats).
- Un único `<dialog>` de detalle se re-renderiza entero tras cada mutación (`refresh()`),
  preservando el scroll. El detalle **separa por `kind`**: sección "Temporadas" (kind `tv`, con
  etiqueta `T{n}`) y sección "Películas y OVAs" (kind `movie`/`ova`, con etiqueta de tipo en vez
  de número; **no cuentan como temporada**). Cada sección tiene su botón de alta (`＋ Temporada` /
  `＋ Película / OVA`); el tipo igual se puede cambiar después con el select "Tipo". Cada temporada
  muestra una **barra de progreso de episodios** con "▶ +1 ep" (`episodeStep`).
- **Recomendados** (botón ✨ en el toolbar → `#dlgRecs`): grid de sugerencias con portada, géneros,
  puntaje de AniList y link; "＋ Agregar" crea el anime (dispara el franchise).

## Pipeline de metadata de AniList (`scripts/*.mjs`, se corren a mano)

Generan/actualizan `data/anime-metadata.json`, que consume `seed.js`. Reproducible en 3 pasadas:
1. `fetch-metadata.mjs`: busca cada serie por título → géneros (genres + tags como Isekai/Harem),
   portada, y **detecta merges** (mismo id de AniList o relación SEQUEL/PREQUEL directa).
2. `rescue-metadata.mjs`: reintenta los sin-match con variantes del título.
3. `manual-fixes.mjs`: correcciones curadas (typos; títulos en **inglés** —el search de AniList
   es sensible a la segmentación, ej. `Bouken-sha`, `Shien-shoku`—; e **ids verificados a mano**).
   Recalcula los merges.

Los merges se revisan siempre (hubo 1 falso positivo por prefijo compartido). Tras regenerar el
JSON, `npm run setup` lo vuelca a la base.
