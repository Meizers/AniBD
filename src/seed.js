import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool, tx } from './db.js';
import { parseAnimeList } from './parseAnimeList.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIST_PATH = process.env.ANIME_LIST_PATH || path.join(__dirname, '..', 'Anime ordenado.txt');
const META_PATH = process.env.ANIME_META_PATH || path.join(__dirname, '..', 'data', 'anime-metadata.json');

// Catálogo base de géneros (la metadata puede sumar otros).
const GENRES = [
  'Acción', 'Aventura', 'Comedia', 'Drama', 'Romance', 'Ecchi', 'Harem', 'Isekai',
  'Fantasía', 'Ciencia ficción', 'Mecha', 'Sobrenatural', 'Terror', 'Misterio',
  'Psicológico', 'Slice of Life', 'Deportes', 'Magia', 'Shounen', 'Seinen', 'Shoujo',
  'Vampiros', 'Escolar', 'Militar', 'Histórico', 'Música', 'Suspenso', 'Manhwa',
];

// Fallback por palabras clave si un anime no tiene match en AniList.
const GENRE_HINTS = [
  [/\bisekai\b|otro mundo|reencarn|renace|renaci/i, 'Isekai'],
  [/\bharem\b/i, 'Harem'],
  [/\bmecha\b|robot/i, 'Mecha'],
  [/vampir/i, 'Vampiros'],
  [/\bmag(o|a|ia|os|as)\b|hechic|bruja|conjur/i, 'Magia'],
  [/rey demonio|maou/i, 'Fantasía'],
];

export function hintGenres(series) {
  const set = new Set();
  const hay = [series.title, ...series.seasons.map((s) => `${s.label} ${s.note ?? ''}`)].join(' ');
  for (const [re, g] of GENRE_HINTS) if (re.test(hay)) set.add(g);
  return [...set];
}

async function loadMeta() {
  try {
    return JSON.parse(await readFile(META_PATH, 'utf8'));
  } catch {
    return null;
  }
}

// Une las "series" que la metadata marcó como la misma (temporadas separadas por
// el parser). Usa como nombre el título más corto del grupo (suele ser la base).
export function applyMerges(series, meta) {
  if (!meta?.merges?.length) return series.map((s) => ({ ...s, keys: [s.key] }));
  const groupOf = new Map();
  meta.merges.forEach((group, gi) => group.forEach((k) => groupOf.set(k, gi)));

  const byGroup = new Map();
  const result = [];
  for (const s of series) {
    const gi = groupOf.get(s.key);
    if (gi === undefined) {
      result.push({ title: s.title, section: s.section, seasons: s.seasons, keys: [s.key] });
      continue;
    }
    if (!byGroup.has(gi)) {
      const merged = { title: s.title, section: s.section, seasons: [], keys: [] };
      byGroup.set(gi, merged);
      result.push(merged);
    }
    const m = byGroup.get(gi);
    m.keys.push(s.key);
    m.seasons.push(...s.seasons);
    if (s.title.length < m.title.length) m.title = s.title;
    if (!m.section && s.section) m.section = s.section;
  }
  for (const s of result) s.seasons.forEach((se, i) => { se.number = i + 1; });
  return result;
}

// Consolida géneros y portada desde la metadata para un anime (1 o más keys).
export function metaFor(keys, meta) {
  const genres = new Set();
  let cover = null;
  for (const k of keys) {
    const m = meta?.series?.[k];
    if (!m || !m.matched) continue;
    for (const g of m.genres || []) genres.add(g);
    if (m.cover && !cover) cover = m.cover;
  }
  return { genres: [...genres], cover };
}

export async function seed() {
  const content = await readFile(LIST_PATH, 'utf8');
  const meta = await loadMeta();
  const series = applyMerges(parseAnimeList(content), meta);

  // Arma los datos por anime y junta todos los géneros que se van a usar.
  const usedGenres = new Set(GENRES);
  const animes = series.map((s) => {
    const m = metaFor(s.keys, meta);
    const genreSet = new Set(m.genres);
    if (s.section === 'Manhwa') genreSet.add('Manhwa');
    if (genreSet.size === 0) for (const g of hintGenres(s)) genreSet.add(g);
    for (const g of genreSet) usedGenres.add(g);
    return { title: s.title, cover: m.cover, genres: [...genreSet], seasons: s.seasons };
  });

  // 1) Catálogo de géneros (incluye lo que trajo la metadata).
  await tx(async (c) => {
    for (const name of usedGenres) {
      await c.query('INSERT INTO genre (name) VALUES ($1) ON CONFLICT (lower(name)) DO NOTHING', [name]);
    }
  });
  const { rows: gRows } = await pool.query('SELECT id, lower(name) AS name FROM genre');
  const genreId = new Map(gRows.map((r) => [r.name, r.id]));

  // 2) Animes + géneros + portada + temporadas (todo como 'completado', 1 vista).
  let animeN = 0;
  let seasonN = 0;
  for (const a of animes) {
    await tx(async (c) => {
      const ins = await c.query(
        `INSERT INTO anime (title, cover_url) VALUES ($1, $2)
         ON CONFLICT (lower(title)) DO NOTHING
         RETURNING id`,
        [a.title, a.cover]
      );
      let animeId = ins.rows[0]?.id;
      if (animeId) {
        animeN++;
      } else {
        const found = await c.query('SELECT id FROM anime WHERE lower(title) = lower($1)', [a.title]);
        animeId = found.rows[0].id;
        if (a.cover) {
          await c.query('UPDATE anime SET cover_url = COALESCE(cover_url, $2) WHERE id = $1', [animeId, a.cover]);
        }
      }

      for (const g of a.genres) {
        const gid = genreId.get(g.toLowerCase());
        if (gid) {
          await c.query(
            'INSERT INTO anime_genre (anime_id, genre_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [animeId, gid]
          );
        }
      }

      for (const se of a.seasons) {
        const r = await c.query(
          `INSERT INTO season (anime_id, number, title, kind, status, times_watched, score, notes)
           VALUES ($1, $2, $3, $4, 'completado', 1, $5, $6)
           ON CONFLICT (anime_id, number) DO NOTHING`,
          [animeId, se.number, se.label, se.type, se.score, se.note]
        );
        seasonN += r.rowCount;
      }
    });
  }

  const withMeta = meta ? ' con géneros y portadas de AniList' : ' (sin metadata; corré primero: npm run fetch)';
  console.log(`✔ Sembrado: ${animeN} animes, ${seasonN} temporadas, ${usedGenres.size} géneros${withMeta}.`);
}
