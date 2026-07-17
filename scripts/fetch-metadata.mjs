// Consulta AniList (GraphQL, sin API key) por cada serie de "Anime ordenado.txt"
// y arma data/anime-metadata.json con: géneros (en español), portada, y sugerencias
// de agrupamiento (temporadas que quedaron separadas). Se corre a mano:
//     node scripts/fetch-metadata.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseAnimeList } from '../src/parseAnimeList.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'anime-metadata.json');

// AniList devuelve los géneros en inglés -> los paso a mi catálogo en español.
const GENRE_ES = {
  Action: 'Acción', Adventure: 'Aventura', Comedy: 'Comedia', Drama: 'Drama',
  Ecchi: 'Ecchi', Fantasy: 'Fantasía', Horror: 'Terror', 'Mahou Shoujo': 'Magia',
  Mecha: 'Mecha', Music: 'Música', Mystery: 'Misterio', Psychological: 'Psicológico',
  Romance: 'Romance', 'Sci-Fi': 'Ciencia ficción', 'Slice of Life': 'Slice of Life',
  Sports: 'Deportes', Supernatural: 'Sobrenatural', Thriller: 'Suspenso',
};
// Algunos "tags" de AniList valen como género (con rank alto son confiables).
const TAG_ES = {
  Isekai: 'Isekai', Harem: 'Harem', 'Reverse Harem': 'Harem', Vampire: 'Vampiros',
  Magic: 'Magia', School: 'Escolar', Military: 'Militar', Historical: 'Histórico',
};

const QUERY = `query($s:String){Media(search:$s,type:ANIME,sort:SEARCH_MATCH){id title{romaji english} synonyms genres tags{name rank} coverImage{extraLarge large color} format siteUrl relations{edges{relationType node{id title{romaji} format}}}}}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const toks = (s) => new Set(norm(s).split(' ').filter(Boolean));
function overlap(a, b) {
  const A = toks(a), B = toks(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const t of A) if (B.has(t)) n++;
  return n / Math.min(A.size, B.size);
}

async function search(s) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: QUERY, variables: { s } }),
      });
    } catch {
      await sleep(1500);
      continue;
    }
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after') || '5');
      console.error(`  · rate limit, espero ${ra}s`);
      await sleep((ra + 1) * 1000);
      continue;
    }
    if (res.status >= 500) { await sleep(1500); continue; }
    const j = await res.json().catch(() => null);
    if (Number(res.headers.get('x-ratelimit-remaining') || '99') <= 2) await sleep(3000);
    if (j && j.data && j.data.Media !== undefined) return j.data.Media;
    return null;
  }
  return null;
}

function pickGenres(media) {
  const set = new Set();
  for (const g of media.genres || []) if (GENRE_ES[g]) set.add(GENRE_ES[g]);
  for (const t of media.tags || []) if (t.rank >= 70 && TAG_ES[t.name]) set.add(TAG_ES[t.name]);
  return [...set];
}

async function saveOut(out, merges = []) {
  await mkdir(path.join(ROOT, 'data'), { recursive: true });
  await writeFile(OUT, JSON.stringify({ generated: new Date().toISOString(), series: out, merges }, null, 2));
}

async function main() {
  const content = await readFile(path.join(ROOT, 'Anime ordenado.txt'), 'utf8');
  const series = parseAnimeList(content);
  const out = {};
  const idToKeys = new Map();

  let i = 0;
  for (const s of series) {
    i++;
    const media = await search(s.title);
    if (!media) {
      out[s.key] = { title: s.title, matched: false, genres: [], cover: null };
      console.log(`[${i}/${series.length}] SIN MATCH   ${s.title}`);
    } else {
      const conf = Math.max(
        overlap(s.title, media.title.romaji),
        overlap(s.title, media.title.english || ''),
        ...(media.synonyms || []).map((sy) => overlap(s.title, sy))
      );
      const genres = pickGenres(media);
      out[s.key] = {
        title: s.title,
        matched: true,
        anilistId: media.id,
        romaji: media.title.romaji,
        english: media.title.english,
        genres,
        cover: media.coverImage?.extraLarge || media.coverImage?.large || null,
        color: media.coverImage?.color || null,
        format: media.format,
        siteUrl: media.siteUrl,
        confidence: Number(conf.toFixed(2)),
        relIds: (media.relations?.edges || [])
          .filter((e) => e.relationType === 'SEQUEL' || e.relationType === 'PREQUEL')
          .map((e) => ({ type: e.relationType, id: e.node.id })),
      };
      if (!idToKeys.has(media.id)) idToKeys.set(media.id, new Set());
      idToKeys.get(media.id).add(s.key);
      console.log(`[${i}/${series.length}] ${conf.toFixed(2)}  ${s.title}  ->  ${media.title.romaji}  {${genres.join(', ')}}`);
    }
    if (i % 25 === 0) await saveOut(out);
    await sleep(700);
  }

  // --- Agrupar series que en realidad son la misma (union-find) ---
  const parent = {};
  const find = (x) => (parent[x] === undefined ? (parent[x] = x) : parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (const k of Object.keys(out)) find(k);

  // (1) mismo id de AniList -> misma serie (señal fuerte)
  for (const keys of idToKeys.values()) {
    const arr = [...keys];
    for (let j = 1; j < arr.length; j++) union(arr[0], arr[j]);
  }
  // (2) relación SEQUEL/PREQUEL directa hacia el match de otra serie mía (alta confianza)
  for (const [k, rec] of Object.entries(out)) {
    if (!rec.matched || rec.confidence < 0.5) continue;
    for (const r of rec.relIds || []) {
      const keys = idToKeys.get(r.id);
      if (keys) for (const k2 of keys) if (k2 !== k && out[k2]?.confidence >= 0.5) union(k, k2);
    }
  }

  const groups = {};
  for (const k of Object.keys(out)) (groups[find(k)] ??= []).push(k);
  const merges = Object.values(groups)
    .filter((g) => g.length > 1)
    .map((g) => g.sort());

  await saveOut(out, merges);
  const matched = Object.values(out).filter((x) => x.matched).length;
  console.log(`\n✔ ${OUT}`);
  console.log(`  series: ${Object.keys(out).length} · con match: ${matched} · grupos a unir: ${merges.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
