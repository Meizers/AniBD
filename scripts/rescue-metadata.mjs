// Segunda pasada: intenta rescatar los animes que quedaron SIN MATCH probando
// variantes del título (sin comillas, recortado, typos comunes) y recalcula los
// merges sobre todo el dataset. Se corre después de fetch-metadata.mjs:
//     node scripts/rescue-metadata.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'data', 'anime-metadata.json');

const GENRE_ES = {
  Action: 'Acción', Adventure: 'Aventura', Comedy: 'Comedia', Drama: 'Drama',
  Ecchi: 'Ecchi', Fantasy: 'Fantasía', Horror: 'Terror', 'Mahou Shoujo': 'Magia',
  Mecha: 'Mecha', Music: 'Música', Mystery: 'Misterio', Psychological: 'Psicológico',
  Romance: 'Romance', 'Sci-Fi': 'Ciencia ficción', 'Slice of Life': 'Slice of Life',
  Sports: 'Deportes', Supernatural: 'Sobrenatural', Thriller: 'Suspenso',
};
const TAG_ES = {
  Isekai: 'Isekai', Harem: 'Harem', 'Reverse Harem': 'Harem', Vampire: 'Vampiros',
  Magic: 'Magia', School: 'Escolar', Military: 'Militar', Historical: 'Histórico',
};
const QUERY = `query($s:String){Media(search:$s,type:ANIME,sort:SEARCH_MATCH){id title{romaji english} synonyms genres tags{name rank} coverImage{extraLarge large color} format siteUrl relations{edges{relationType node{id}}}}}`;

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
function pickGenres(media) {
  const set = new Set();
  for (const g of media.genres || []) if (GENRE_ES[g]) set.add(GENRE_ES[g]);
  for (const t of media.tags || []) if (t.rank >= 70 && TAG_ES[t.name]) set.add(TAG_ES[t.name]);
  return [...set];
}
async function search(s) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch('https://graphql.anilist.co', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: QUERY, variables: { s } }),
      });
    } catch { await sleep(1500); continue; }
    if (res.status === 429) { const ra = Number(res.headers.get('retry-after') || '5'); await sleep((ra + 1) * 1000); continue; }
    if (res.status >= 500) { await sleep(1500); continue; }
    const j = await res.json().catch(() => null);
    if (Number(res.headers.get('x-ratelimit-remaining') || '99') <= 2) await sleep(3000);
    if (j && j.data && j.data.Media !== undefined) return j.data.Media;
    return null;
  }
  return null;
}

const TYPOS = [[/shipuden/i, 'Shippuden'], [/^kate\b/i, 'fate'], [/clock work/i, 'clockwork'], [/yosuca/i, 'yosuga'], [/gotoubun/i, '5-toubun']];
function variants(title) {
  const v = new Set();
  const base = title.replace(/["'\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  v.add(base);
  let typo = base;
  for (const [re, to] of TYPOS) typo = typo.replace(re, to);
  if (typo !== base) v.add(typo);
  const cut = base.split(/\s*[:\-–]\s*| Movie| Episodio| Season/i)[0].trim();
  if (cut.length > 3) v.add(cut);
  const w = base.split(' ');
  if (w.length > 6) v.add(w.slice(0, 6).join(' '));
  if (w.length > 4) v.add(w.slice(0, 4).join(' '));
  return [...v].filter(Boolean);
}

async function main() {
  const d = JSON.parse(await readFile(OUT, 'utf8'));
  const s = d.series;
  const pend = Object.keys(s).filter((k) => !s[k].matched);
  console.log(`A rescatar: ${pend.length}`);

  let rescued = 0;
  for (const k of pend) {
    const title = s[k].title;
    let best = null;
    for (const q of variants(title)) {
      const media = await search(q);
      await sleep(650);
      if (!media) continue;
      const conf = Math.max(
        overlap(title, media.title.romaji),
        overlap(title, media.title.english || ''),
        ...(media.synonyms || []).map((x) => overlap(title, x))
      );
      if (!best || conf > best.conf) best = { conf, media };
      if (conf >= 0.7) break;
    }
    if (best && best.conf >= 0.45) {
      const m = best.media;
      s[k] = {
        ...s[k], matched: true, anilistId: m.id, romaji: m.title.romaji, english: m.title.english,
        genres: pickGenres(m), cover: m.coverImage?.extraLarge || m.coverImage?.large || null,
        color: m.coverImage?.color || null, format: m.format, siteUrl: m.siteUrl,
        confidence: Number(best.conf.toFixed(2)),
        relIds: (m.relations?.edges || []).filter((e) => e.relationType === 'SEQUEL' || e.relationType === 'PREQUEL').map((e) => ({ type: e.relationType, id: e.node.id })),
        rescued: true,
      };
      rescued++;
      console.log(`  ✔ ${best.conf.toFixed(2)}  ${title}  ->  ${m.title.romaji}`);
    } else {
      console.log(`  ·  sin match  ${title}`);
    }
  }

  // Recalcular merges sobre TODO el dataset.
  const idToKeys = new Map();
  for (const [k, rec] of Object.entries(s)) {
    if (!rec.matched || !rec.anilistId) continue;
    if (!idToKeys.has(rec.anilistId)) idToKeys.set(rec.anilistId, new Set());
    idToKeys.get(rec.anilistId).add(k);
  }
  const parent = {};
  const find = (x) => (parent[x] === undefined ? (parent[x] = x) : parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (const k of Object.keys(s)) find(k);
  for (const keys of idToKeys.values()) { const a = [...keys]; for (let j = 1; j < a.length; j++) union(a[0], a[j]); }
  for (const [k, rec] of Object.entries(s)) {
    if (!rec.matched || rec.confidence < 0.5) continue;
    for (const r of rec.relIds || []) {
      const keys = idToKeys.get(r.id);
      if (keys) for (const k2 of keys) if (k2 !== k && s[k2]?.confidence >= 0.5) union(k, k2);
    }
  }
  const groups = {};
  for (const k of Object.keys(s)) (groups[find(k)] ??= []).push(k);
  d.merges = Object.values(groups).filter((g) => g.length > 1).map((g) => g.sort());
  d.generated = new Date().toISOString();

  await writeFile(OUT, JSON.stringify(d, null, 2));
  const matched = Object.values(s).filter((x) => x.matched).length;
  console.log(`\n✔ Rescatados: ${rescued}. Con match ahora: ${matched}/${Object.keys(s).length}. Merges: ${d.merges.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
