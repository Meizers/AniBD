import { Router } from 'express';
import { pool, tx } from './db.js';
import { lookup, search, seasonCover, walkFranchise, recommend } from './anilist.js';

const router = Router();

export const STATUSES = ['pendiente', 'en_progreso', 'completado', 'en_pausa', 'abandonado'];
export const KINDS = ['tv', 'movie', 'ova'];

// Envuelve handlers async para que los errores caigan en el middleware de error.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// '' o undefined -> null; opcionalmente castea (p.ej. Number).
function clean(v, cast) {
  if (v === undefined || v === null || v === '') return null;
  return cast ? cast(v) : v;
}

// SELECT reutilizable: anime + estadísticas + array de géneros + la temporada
// "en foco" (para las acciones rápidas de la card): la que estás viendo, o la
// próxima pendiente, o —si ya terminaste todo— la última completada.
const ANIME_SELECT = `
  SELECT a.id, a.title, a.synopsis, a.cover_url, a.year, a.studio,
         a.created_at, a.updated_at,
         st.season_count, st.tv_count, st.extra_count, st.rated_seasons,
         st.avg_score, st.total_watches,
         st.completed_count, st.watching_count, st.pending_count,
         nx.id AS focus_id, nx.number AS focus_number, nx.kind AS focus_kind,
         nx.status AS focus_status, nx.watched_episodes AS focus_watched,
         nx.total_episodes AS focus_total,
         COALESCE(gg.genres, ARRAY[]::text[]) AS genres
    FROM anime a
    JOIN anime_stats st ON st.anime_id = a.id
    LEFT JOIN LATERAL (
      SELECT s.id, s.number, s.kind, s.status, s.watched_episodes, s.total_episodes
        FROM season s
       WHERE s.anime_id = a.id
       ORDER BY array_position(
                  ARRAY['en_progreso','pendiente','completado','en_pausa','abandonado']::text[],
                  s.status::text),
                s.number
       LIMIT 1
    ) nx ON true
    LEFT JOIN (
      SELECT ag.anime_id, array_agg(g.name ORDER BY g.name) AS genres
        FROM anime_genre ag JOIN genre g ON g.id = ag.genre_id
       GROUP BY ag.anime_id
    ) gg ON gg.anime_id = a.id`;

// ----------------------------------------------------------------- GÉNEROS ---
router.get('/genres', wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT g.id, g.name, COUNT(ag.anime_id)::int AS anime_count
      FROM genre g
      LEFT JOIN anime_genre ag ON ag.genre_id = g.id
     GROUP BY g.id
     ORDER BY g.name`);
  res.json(rows);
}));

router.post('/genres', wrap(async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) throw httpError(400, 'El nombre del género es obligatorio.');
  const { rows } = await pool.query(
    'INSERT INTO genre (name) VALUES ($1) RETURNING id, name',
    [name]
  );
  res.status(201).json(rows[0]);
}));

router.delete('/genres/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM genre WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

// ------------------------------------------------------------------ LOOKUP ---
// Busca portada y géneros en AniList para un título (autocompletar).
router.get('/lookup', wrap(async (req, res) => {
  const found = await lookup(req.query.title);
  res.json(found ? { found: true, ...found } : { found: false });
}));

// Sugerencias mientras se escribe: varias coincidencias de AniList.
router.get('/search', wrap(async (req, res) => {
  const results = await search(req.query.title, 8);
  res.json({ results });
}));

// ------------------------------------------------------------------ ANIMES ---
router.get('/animes', wrap(async (req, res) => {
  const { genre, status, search, sort } = req.query;
  const where = [];
  const params = [];
  const add = (sql, val) => {
    params.push(val);
    where.push(sql.replaceAll('$$', `$${params.length}`));
  };

  if (genre) {
    add(
      'a.id IN (SELECT ag.anime_id FROM anime_genre ag JOIN genre g ON g.id = ag.genre_id WHERE lower(g.name) = lower($$))',
      genre
    );
  }
  if (status) {
    if (!STATUSES.includes(status)) throw httpError(400, `Estado inválido: ${status}`);
    add('a.id IN (SELECT anime_id FROM season WHERE status = $$)', status);
  }
  // Busca por el título de la serie O por el de cualquier temporada/peli/OVA
  // (así "date a bullet" encuentra "Date A Live"). Ignora mayúsculas y acentos
  // vía anibd_unaccent ("cancion" encuentra "Canción").
  if (search) {
    add(
      `(anibd_unaccent(a.title) LIKE anibd_unaccent($$)
        OR EXISTS (SELECT 1 FROM season s
                    WHERE s.anime_id = a.id AND anibd_unaccent(s.title) LIKE anibd_unaccent($$)))`,
      `%${search}%`
    );
  }

  const orderMap = {
    title: 'a.title ASC',
    score: 'st.avg_score DESC NULLS LAST, a.title ASC',
    watches: 'st.total_watches DESC, a.title ASC',
    seasons: 'st.season_count DESC, a.title ASC',
    recent: 'a.created_at DESC',
  };
  const orderBy = orderMap[sort] || orderMap.title;

  const { rows } = await pool.query(
    `${ANIME_SELECT}
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY ${orderBy}`,
    params
  );
  res.json(rows);
}));

async function getAnimeDetail(id) {
  const { rows } = await pool.query(`${ANIME_SELECT} WHERE a.id = $1`, [id]);
  if (!rows[0]) return null;
  const anime = rows[0];
  const { rows: seasons } = await pool.query(
    'SELECT * FROM season WHERE anime_id = $1 ORDER BY number',
    [id]
  );
  anime.seasons = seasons;
  return anime;
}

router.get('/animes/:id', wrap(async (req, res) => {
  const anime = await getAnimeDetail(req.params.id);
  if (!anime) throw httpError(404, 'Anime no encontrado.');
  res.json(anime);
}));

// Reemplaza el set de géneros de un anime (crea los que no existan).
async function setGenres(client, animeId, names) {
  await client.query('DELETE FROM anime_genre WHERE anime_id = $1', [animeId]);
  const seen = new Set();
  for (const raw of names) {
    const name = String(raw).trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const g = await client.query(
      `INSERT INTO genre (name) VALUES ($1)
       ON CONFLICT (lower(name)) DO UPDATE SET name = genre.name
       RETURNING id`,
      [name]
    );
    await client.query(
      'INSERT INTO anime_genre (anime_id, genre_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [animeId, g.rows[0].id]
    );
  }
}

router.post('/animes', wrap(async (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  if (!title) throw httpError(400, 'El título es obligatorio.');
  let synopsis = clean(req.body.synopsis);
  let coverUrl = clean(req.body.cover_url);
  let year = clean(req.body.year, Number);
  let studio = clean(req.body.studio);
  let genres = Array.isArray(req.body.genres) ? req.body.genres : [];

  // Autocompletar desde AniList lo que no vino (portada, géneros, sinopsis,
  // año y estudio).
  if (!coverUrl || !synopsis || !year || !studio || genres.length === 0) {
    const found = await lookup(title);
    if (found) {
      if (!coverUrl) coverUrl = found.cover_url;
      if (!synopsis) synopsis = found.description;
      if (!year) year = found.year;
      if (!studio) studio = found.studio;
      if (genres.length === 0 && found.genres.length) genres = found.genres;
    }
  }

  // Descubrir todo el franchise (temporadas + películas + OVAs) para dejarlo
  // cargado como pendiente. Salvo que se pida explícitamente no hacerlo.
  const franchise = req.body?.autoseasons === false ? [] : await walkFranchise(title);

  const id = await tx(async (c) => {
    const { rows } = await c.query(
      'INSERT INTO anime (title, synopsis, cover_url, year, studio) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [title, synopsis, coverUrl, year, studio]
    );
    const animeId = rows[0].id;
    await setGenres(c, animeId, genres);

    if (franchise.length) {
      // Toda la obra en orden de estreno, como PENDIENTE (probable que la vea).
      let number = 0;
      for (const e of franchise) {
        number++;
        await c.query(
          `INSERT INTO season (anime_id, number, title, cover_url, kind, total_episodes, duration, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente')
           ON CONFLICT (anime_id, number) DO NOTHING`,
          [animeId, number, e.romaji || e.english, e.cover_url, e.kind, e.episodes, e.duration]
        );
      }
    } else {
      // Sin match en AniList: al menos una Temporada 1 pendiente.
      await c.query(
        `INSERT INTO season (anime_id, number, title, status)
         VALUES ($1, 1, 'Temporada 1', 'pendiente')`,
        [animeId]
      );
    }
    return animeId;
  });

  res.status(201).json(await getAnimeDetail(id));
}));

router.patch('/animes/:id', wrap(async (req, res) => {
  const id = req.params.id;
  const fields = [];
  const params = [];
  for (const key of ['title', 'synopsis', 'cover_url', 'year', 'studio']) {
    if (key in req.body) {
      const value =
        key === 'title' ? String(req.body[key]).trim()
        : key === 'year' ? clean(req.body[key], Number)
        : clean(req.body[key]);
      if (key === 'title' && !value) throw httpError(400, 'El título no puede quedar vacío.');
      params.push(value);
      fields.push(`${key} = $${params.length}`);
    }
  }
  await tx(async (c) => {
    if (fields.length) {
      params.push(id);
      const r = await c.query(
        `UPDATE anime SET ${fields.join(', ')} WHERE id = $${params.length}`,
        params
      );
      if (r.rowCount === 0) throw httpError(404, 'Anime no encontrado.');
    }
    if (Array.isArray(req.body.genres)) await setGenres(c, id, req.body.genres);
  });
  res.json(await getAnimeDetail(id));
}));

router.delete('/animes/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM anime WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

// -------------------------------------------------------------- TEMPORADAS ---
// Construye SET dinámico para PATCH de temporada.
function seasonPatch(body) {
  const cols = {
    number: (v) => Number(v),
    title: (v) => clean(v),
    cover_url: (v) => clean(v),
    kind: (v) => {
      if (!KINDS.includes(v)) throw httpError(400, `Tipo inválido: ${v}`);
      return v;
    },
    status: (v) => {
      if (!STATUSES.includes(v)) throw httpError(400, `Estado inválido: ${v}`);
      return v;
    },
    total_episodes: (v) => clean(v, Number),
    watched_episodes: (v) => (v === '' || v == null ? 0 : Number(v)),
    duration: (v) => clean(v, Number),
    times_watched: (v) => (v === '' || v == null ? 0 : Number(v)),
    score: (v) => clean(v, Number),
    notes: (v) => clean(v),
    started_at: (v) => clean(v),
    finished_at: (v) => clean(v),
  };
  const fields = [];
  const params = [];
  for (const [key, cast] of Object.entries(cols)) {
    if (key in body) {
      params.push(cast(body[key]));
      fields.push(`${key} = $${params.length}`);
    }
  }
  return { fields, params };
}

router.post('/animes/:id/seasons', wrap(async (req, res) => {
  const animeId = Number(req.params.id);
  const exists = await pool.query('SELECT 1 FROM anime WHERE id = $1', [animeId]);
  if (!exists.rowCount) throw httpError(404, 'Anime no encontrado.');

  const b = req.body || {};
  let number = b.number;
  if (number === undefined || number === null || number === '') {
    const { rows } = await pool.query(
      'SELECT COALESCE(MAX(number), 0) + 1 AS n FROM season WHERE anime_id = $1',
      [animeId]
    );
    number = rows[0].n;
  }

  const kind = KINDS.includes(b.kind) ? b.kind : 'tv';
  const defaultTitle = kind === 'movie' ? 'Película' : kind === 'ova' ? 'OVA' : `Temporada ${number}`;

  const cols = ['anime_id', 'number', 'title', 'cover_url', 'kind', 'status', 'total_episodes',
    'watched_episodes', 'duration', 'times_watched', 'score', 'notes', 'started_at', 'finished_at'];
  const vals = [
    animeId,
    Number(number),
    b.title ?? defaultTitle,
    clean(b.cover_url),
    kind,
    STATUSES.includes(b.status) ? b.status : 'pendiente',
    clean(b.total_episodes, Number),
    b.watched_episodes === '' || b.watched_episodes == null ? 0 : Number(b.watched_episodes),
    clean(b.duration, Number),
    b.times_watched === '' || b.times_watched == null ? 0 : Number(b.times_watched),
    clean(b.score, Number),
    clean(b.notes),
    clean(b.started_at),
    clean(b.finished_at),
  ];
  const { rows } = await pool.query(
    `INSERT INTO season (${cols.join(', ')})
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING *`,
    vals
  );
  res.status(201).json(rows[0]);
}));

// Autocompleta desde AniList la portada de cada temporada que aún no tenga una,
// y la persiste. Idempotente: sólo toca las que están en NULL. Devuelve las que
// consiguió resolver para que el front actualice las miniaturas al vuelo.
router.post('/animes/:id/season-covers', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { rows: aRows } = await pool.query('SELECT title, cover_url FROM anime WHERE id = $1', [id]);
  if (!aRows[0]) throw httpError(404, 'Anime no encontrado.');
  const { title: animeTitle, cover_url: animeCover } = aRows[0];

  const { rows: seasons } = await pool.query(
    'SELECT id, number, title, kind FROM season WHERE anime_id = $1 AND cover_url IS NULL ORDER BY number',
    [id]
  );

  const updated = [];
  for (const s of seasons) {
    const cover = await seasonCover(animeTitle, s, animeCover);
    if (!cover) continue;
    await pool.query('UPDATE season SET cover_url = $2 WHERE id = $1', [s.id, cover]);
    updated.push({ id: s.id, cover_url: cover });
  }
  res.json({ updated });
}));

// Busca en AniList TODO el franchise (temporadas TV + películas + OVAs) y
// devuelve lo que AÚN no está cargado (dedup por título o por portada ya
// guardada). No agrega nada; el front filtra por tipo según desde dónde se pida.
router.get('/animes/:id/missing', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { rows: aRows } = await pool.query('SELECT title FROM anime WHERE id = $1', [id]);
  if (!aRows[0]) throw httpError(404, 'Anime no encontrado.');

  const candidates = await walkFranchise(aRows[0].title);
  const { rows: seasons } = await pool.query('SELECT title, cover_url FROM season WHERE anime_id = $1', [id]);
  const titles = new Set(seasons.map((s) => (s.title || '').trim().toLowerCase()).filter(Boolean));
  const covers = new Set(seasons.map((s) => s.cover_url).filter(Boolean));

  const results = candidates.filter((c) => {
    const r = (c.romaji || '').trim().toLowerCase();
    const e = (c.english || '').trim().toLowerCase();
    if (r && titles.has(r)) return false;
    if (e && titles.has(e)) return false;
    if (c.cover_url && covers.has(c.cover_url)) return false;
    return true;
  });
  res.json({ results });
}));

// Agrega en lote las entradas elegidas (temporada TV / película / OVA, cada una
// como su propia "temporada", en estado pendiente). Numera secuencial en una tx.
router.post('/animes/:id/extras', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const exists = await pool.query('SELECT 1 FROM anime WHERE id = $1', [id]);
  if (!exists.rowCount) throw httpError(404, 'Anime no encontrado.');

  const added = await tx(async (c) => {
    let n = 0;
    for (const it of items) {
      const title = String(it?.title ?? '').trim();
      if (!title) continue;
      const kind = KINDS.includes(it.kind) ? it.kind : 'ova';
      const { rows } = await c.query(
        'SELECT COALESCE(MAX(number), 0) + 1 AS n FROM season WHERE anime_id = $1',
        [id]
      );
      const r = await c.query(
        `INSERT INTO season (anime_id, number, title, cover_url, kind, total_episodes, duration, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente')
         ON CONFLICT (anime_id, number) DO NOTHING`,
        [id, rows[0].n, title, clean(it.cover_url), kind, clean(it.total_episodes, Number), clean(it.duration, Number)]
      );
      n += r.rowCount;
    }
    return n;
  });
  res.status(201).json({ added });
}));

router.patch('/seasons/:id', wrap(async (req, res) => {
  const { fields, params } = seasonPatch(req.body || {});
  if (!fields.length) throw httpError(400, 'Nada para actualizar.');
  params.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE season SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (!rows[0]) throw httpError(404, 'Temporada no encontrada.');
  res.json(rows[0]);
}));

router.delete('/seasons/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM season WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

// Sumar una vista (rewatch).
router.post('/seasons/:id/watch', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'UPDATE season SET times_watched = times_watched + 1 WHERE id = $1 RETURNING *',
    [req.params.id]
  );
  if (!rows[0]) throw httpError(404, 'Temporada no encontrada.');
  res.json(rows[0]);
}));

// Avanzar (o retroceder) el progreso de episodios. Ajusta el estado solo:
// arrancar -> en_progreso (fija started_at); llegar al final -> completado
// (fija finished_at). No pisa un estado en_pausa/abandonado puesto a mano.
router.post('/seasons/:id/episode', wrap(async (req, res) => {
  const delta = Number.isFinite(Number(req.body?.delta)) ? Number(req.body.delta) : 1;
  const { rows: cur } = await pool.query('SELECT * FROM season WHERE id = $1', [req.params.id]);
  const s = cur[0];
  if (!s) throw httpError(404, 'Temporada no encontrada.');

  const total = s.total_episodes;
  let watched = (s.watched_episodes || 0) + delta;
  if (watched < 0) watched = 0;
  if (total != null && watched > total) watched = total;

  let status = s.status;
  let started = s.started_at;
  let finished = s.finished_at;
  const locked = status === 'en_pausa' || status === 'abandonado';
  if (total != null && total > 0 && watched >= total) {
    if (!locked) status = 'completado';
    if (!finished) finished = new Date().toISOString().slice(0, 10);
  } else if (watched > 0) {
    if (!locked && status !== 'completado') status = 'en_progreso';
    if (!started) started = new Date().toISOString().slice(0, 10);
  } else if (watched === 0 && !locked && status === 'en_progreso') {
    status = 'pendiente';
  }

  const { rows } = await pool.query(
    `UPDATE season SET watched_episodes = $2, status = $3, started_at = $4, finished_at = $5
       WHERE id = $1 RETURNING *`,
    [s.id, watched, status, started, finished]
  );
  res.json(rows[0]);
}));

// --------------------------------------------------------- RECOMENDACIONES ---
// Sugiere series nuevas a partir de tus mejor puntuadas (recomendaciones de la
// comunidad de AniList), excluyendo lo que ya tenés cargado.
router.get('/recommendations', wrap(async (req, res) => {
  const { rows: seeds } = await pool.query(`
    SELECT a.title
      FROM anime a JOIN anime_stats st ON st.anime_id = a.id
     WHERE st.avg_score IS NOT NULL
     ORDER BY st.avg_score DESC, st.total_watches DESC, a.title
     LIMIT 6`);
  if (!seeds.length) return res.json({ results: [], seeds: [] });

  const recs = await recommend(seeds.map((s) => s.title));

  // Excluir lo que ya tengas (por título de serie o de cualquier temporada).
  const { rows: existing } = await pool.query(
    `SELECT lower(title) AS t FROM anime
     UNION SELECT lower(title) FROM season WHERE title IS NOT NULL`
  );
  const have = new Set(existing.map((r) => r.t));
  const results = recs
    .filter((r) => {
      const ro = (r.romaji || '').toLowerCase();
      const en = (r.english || '').toLowerCase();
      return !(ro && have.has(ro)) && !(en && have.has(en));
    })
    .slice(0, 24);

  res.json({ results, seeds: seeds.map((s) => s.title) });
}));

// ------------------------------------------------------------------- STATS ---
router.get('/stats', wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM anime)::int                                         AS animes,
      (SELECT COUNT(*) FROM season)::int                                        AS seasons,
      (SELECT COUNT(*) FROM season WHERE status = 'completado')::int            AS completadas,
      (SELECT COUNT(*) FROM season WHERE status = 'en_progreso')::int           AS en_progreso,
      (SELECT COUNT(*) FROM season WHERE status = 'pendiente')::int             AS pendientes,
      (SELECT ROUND(AVG(score)::numeric, 2) FROM season WHERE score IS NOT NULL) AS avg_score,
      (SELECT COALESCE(SUM(times_watched), 0)::int FROM season)                 AS total_watches`);
  res.json(rows[0]);
}));

export default router;
