# 🌸 AniBD — tu base de datos de animes

App web personal para llevar el registro de tus animes: **pendientes**, **en progreso**,
**completados**, con **puntuación y notas por temporada**, **géneros filtrables**, cantidad
de **veces vistas** y **promedio general por serie** (por ejemplo, Date A Live junta sus 6
temporadas y te muestra el promedio de todas).

Stack: **Node.js (Express) + PostgreSQL**. Frontend en HTML/CSS/JS sin dependencias.

---

## ▶ Uso rápido — un solo botón

Tenés un botón **AniBD** en el menú de aplicaciones y en el escritorio (ícono de florcita 🌸).
Al abrirlo, con un click:

1. Enciende Docker (la primera vez te pide la contraseña con un diálogo gráfico),
2. Levanta PostgreSQL,
3. Inicializa la base **solo si está vacía** (nunca borra tus datos),
4. Arranca el servidor y **abre el navegador** en http://localhost:3000.

**Cerrás la ventana de la terminal (o Ctrl+C) y se apaga TODO** (servidor + base). Tus datos
quedan guardados en el volumen de Docker para la próxima.

No hace falta ninguna preparación previa. La **primera** vez tarda un poco más porque descarga
la imagen de PostgreSQL. Equivale a correr:

```bash
./anibd.sh        # o:  npm run go
```

> Reinstalar el botón (si moviste el proyecto): `cp AniBD.desktop ~/.local/share/applications/`

---

## 💿 Modo portable (Windows / sin Docker)

AniBD también corre **sin Docker ni PostgreSQL instalado**: con `ANIBD_DB=pglite` usa
[PGlite](https://pglite.dev) (PostgreSQL embebido dentro de Node) y guarda los datos en una
carpeta local, **fuera del proyecto** (así podés borrar/actualizar la carpeta de la app sin
perder nada):

- Windows: `%APPDATA%\AniBD\pgdata` · Linux: `~/.local/share/anibd/pgdata` · Mac:
  `~/Library/Application Support/AniBD/pgdata`. Se cambia con `ANIBD_DATA_DIR`.
- Backup = copiar esa carpeta.

Para usarlo: **doble click en `AniBD.bat`** (Windows) o `npm run lite` (cualquier SO). Hace lo
mismo que el botón AniBD pero sin Docker: prepara la base si hace falta, levanta el server y
abre el navegador; cerrar la ventana apaga todo.

**Para pasárselo a alguien**: armá un ZIP sin tu lista ni las dependencias —

```bash
7z a -tzip AniBD.zip . '-xr!node_modules' '-x!.claude' '-x!Anime ordenado.txt' '-x!.env' '-x!data' '-x!AniBD.zip'
```

— y del otro lado solo necesitan **Node.js** y seguir [`GUIA-INSTALACION.html`](GUIA-INSTALACION.html)
(instalar Node, descomprimir, doble click en `AniBD.bat`; `Crear-acceso-directo.bat` les deja
el acceso directo con la florcita —`AniBD.ico`— en el Escritorio). Sin tu lista, la base arranca
vacía y cada uno carga sus animes desde la web (el buscador autocompleta todo desde AniList).

> Ambos modos conviven: sin `ANIBD_DB` todo sigue usando PostgreSQL/Docker como siempre.

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

- **Node.js ≥ 20.6** (tenés v24 ✔). Ya trae todo; no hace falta nada más de JS.
- **PostgreSQL** corriendo en algún lado. Abajo tenés dos formas de conseguirlo.

---

## 1) Levantar PostgreSQL — modo manual

> Si usás el **botón AniBD** (sección de arriba) no necesitás nada de esto: hace todo solo.
> Esta sección es por si querés levantar las cosas a mano.

Elegí **una** opción.

### Opción A — Docker (recomendada)

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

---

## 2) Configurar y preparar la app

```bash
cp .env.example .env      # ajustá DATABASE_URL si usás otra clave/host
npm install               # ya hecho, pero por las dudas
npm run setup             # crea las tablas e importa "Anime ordenado.txt"
```

`npm run setup` = crea el esquema **+** importa tu lista. Si solo querés una parte:

- `npm run db:schema` → crea/reinicia las tablas (⚠️ borra lo que haya).
- `npm run db:seed` → importa la lista de nuevo (no duplica).

---

## 3) Usar la app

```bash
npm start                 # o "npm run dev" para autorecarga
```

Abrí **http://localhost:3000**.

Desde ahí podés: buscar, filtrar por **género** y **estado**, ordenar (mejor puntaje, más
visto…), crear animes, agregar temporadas, puntuar, dejar notas y sumar "veces vista" con
el botón **+1**. Clic en un chip de género para filtrar rápido.

---

## Sobre la importación de tu lista

Tu archivo `Anime ordenado.txt` se importa automáticamente, en dos pasos:

1. **Parseo** de cada línea: título, **puntaje** `[8/10]`, **nota** entre paréntesis y un primer
   agrupado de **temporadas** de una misma serie.
2. **Enriquecimiento con [AniList](https://anilist.co)** (`npm run fetch`, necesita internet):
   por cada serie trae **géneros reales** (incluye *tags* como Isekai/Harem), la **portada**, y
   usa las relaciones **secuela/precuela** para **unir temporadas** que el parseo dejó separadas.
   Queda cacheado en `data/anime-metadata.json`.

Si un anime no está en AniList, cae al etiquetado por palabras clave y queda sin portada (lo
completás a mano desde la app). Todo entra como **completado** con 1 vista (era tu pila de "ya
vistos"); ajustá lo que quieras desde la interfaz.

### Volver a generar con géneros y portadas

```bash
npm run fetch     # 1) consulta AniList (~4 min) -> data/anime-metadata.json
npm run setup     # 2) recrea la base usando esa metadata  (⚠ reimporta desde cero)
```

> El **botón AniBD** ya hace el paso 2 solo la primera vez (si el archivo de metadata existe).
> Si ya tenías la base creada, corré los dos comandos de arriba para aplicar los cambios.

---

## Scripts

| Comando            | Qué hace                                            |
|--------------------|-----------------------------------------------------|
| `npm run lite`     | Todo-en-uno SIN Docker (PGlite embebido)            |
| `npm start`        | Levanta el servidor web                             |
| `npm run dev`      | Igual, con autorecarga (`--watch`)                  |
| `npm run setup`    | Crea el esquema **e** importa la lista              |
| `npm run db:schema`| Solo crea/reinicia las tablas                       |
| `npm run db:seed`  | Solo importa la lista                               |
| `npm run fetch`    | Trae géneros y portadas desde AniList (internet)    |
| `npm test`         | Tests del parser de la lista                        |

---

## API (por si querés integrarla con otra cosa)

```
GET    /api/stats
GET    /api/genres                POST /api/genres              DELETE /api/genres/:id
GET    /api/animes?genre=&status=&search=&sort=
POST   /api/animes               GET /api/animes/:id
PATCH  /api/animes/:id           DELETE /api/animes/:id
POST   /api/animes/:id/seasons
PATCH  /api/seasons/:id          DELETE /api/seasons/:id
POST   /api/seasons/:id/watch    (suma una vista)
```

---

## Estructura

```
AniBD/
├── db/schema.sql            Esquema PostgreSQL (tablas, vista de promedios, triggers)
├── src/
│   ├── server.js            Servidor Express + estáticos
│   ├── routes.js            API REST
│   ├── db.js                Pool de conexión
│   ├── parseAnimeList.js    Parser de "Anime ordenado.txt"
│   └── seed.js              Importación a la base
├── scripts/db.js            CLI: schema / seed / setup
├── public/                  Frontend (index.html, styles.css, app.js)
└── test/parse.test.js       Tests del parser
```
