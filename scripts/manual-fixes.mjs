// Tercera pasada: correcciones manuales para los títulos con typos / incompletos
// que no matchearon en AniList. Actualiza data/anime-metadata.json y recalcula
// los merges. Correr después del fetch/rescue:  node scripts/manual-fixes.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'data', 'anime-metadata.json');

// Título del usuario (o parte) -> término de búsqueda correcto en AniList.
const FIXES = [
  // typos / romaji que AniList sí encuentra
  [/naruto shipuden/i, 'Naruto Shippuuden'],
  [/yosuca no sora/i, 'Yosuga no Sora'],
  [/kissxsis/i, 'Kiss x Sis'],
  [/rakudai kishi no calvary/i, 'Rakudai Kishi no Cavalry'],
  [/shuumatsu no walk/i, 'Shuumatsu no Valkyrie'],
  [/strike the blood ll/i, 'Strike the Blood II'],
  [/mashiro-iro symphony/i, 'Mashiro-iro Symphony'],
  [/megami no caf/i, 'Megami no Cafe Terrace'],
  [/sayounara ryuusei/i, 'Sayonara Ryuusei, Konnichiwa Jinsei'],
  // estos AniList solo los encuentra por su título en INGLÉS
  [/monster musume no oishasan/i, 'Monster Girl Doctor'],
  [/seiken gakuin no makentsukai/i, 'The Demon Sword Master of Excalibur Academy'],
  [/tensei shitara dainana ouji/i, 'Reincarnated as the 7th Prince'],
  [/hazurewaku no/i, 'Failure Frame'],
  [/ore ga ojousama/i, 'Shomin Sample'],
  [/mizu zokusei no mahoutsukai/i, 'The Water Magician'],
  [/maougun saikyou no majutsushi/i, "The Strongest Magician in the Demon Lord's Army"],
];

// Casos verificados a mano donde la búsqueda por texto no sirve: se fija el id.
const FIXES_BY_ID = [
  [/arknights.*fuyukomori/i, 158895], // Arknights: Touin Kiro (Perish in Frost) = 冬隠帰路
  [/akuyaku reijou tensei ojisan/i, 172453], // Akuyaku Reijou Tensei Oji-san
  [/shiromadoushi/i, 179885], // Yuusha Party ... Shiro Madoushi (White Mage)
  [/one room.*hiatari/i, 169927], // One Room, Hi Atari Futsuu, Tenshi Tsuki.
  [/shinmai ossan boukensha/i, 163292], // Shinmai Ossan Bouken-sha ...
  [/saikyou no shienshoku/i, 177104], // Saikyou no Shien-shoku [Wajutsushi] ...
  [/jugador.*regreso/i, 153284], // manhwa: "After Ten Millennia in Hell" (The Player Who Returned 10,000 Years Later)
];

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
const FIELDS = `id title{romaji english} synonyms genres tags{name rank} coverImage{extraLarge large color} format siteUrl relations{edges{relationType node{id}}}`;
const QUERY_SEARCH = `query($s:String){Media(search:$s,type:ANIME,sort:SEARCH_MATCH){${FIELDS}}}`;
const QUERY_ID = `query($id:Int){Media(id:$id){${FIELDS}}}`;

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
async function gql(query, variables) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch('https://graphql.anilist.co', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
    } catch { await sleep(1500); continue; }
    if (res.status === 429) { await sleep((Number(res.headers.get('retry-after') || '5') + 1) * 1000); continue; }
    if (res.status >= 500) { await sleep(1500); continue; }
    const j = await res.json().catch(() => null);
    if (Number(res.headers.get('x-ratelimit-remaining') || '99') <= 2) await sleep(3000);
    if (j && j.data && j.data.Media !== undefined) return j.data.Media;
    return null;
  }
  return null;
}

function record(prev, media, conf) {
  return {
    ...prev, matched: true, anilistId: media.id, romaji: media.title.romaji, english: media.title.english,
    genres: pickGenres(media), cover: media.coverImage?.extraLarge || media.coverImage?.large || null,
    color: media.coverImage?.color || null, format: media.format, siteUrl: media.siteUrl,
    confidence: Number(conf.toFixed(2)),
    relIds: (media.relations?.edges || []).filter((e) => e.relationType === 'SEQUEL' || e.relationType === 'PREQUEL').map((e) => ({ type: e.relationType, id: e.node.id })),
    fixed: true,
  };
}

async function main() {
  const d = JSON.parse(await readFile(OUT, 'utf8'));
  const s = d.series;
  const pend = Object.keys(s).filter((k) => !s[k].matched);

  let fixed = 0;
  for (const k of pend) {
    const title = s[k].title;
    const byId = FIXES_BY_ID.find(([re]) => re.test(title));
    if (byId) {
      const media = await gql(QUERY_ID, { id: byId[1] });
      await sleep(650);
      if (!media) { console.log(`  ✗  id ${byId[1]} no respondió  ${title}`); continue; }
      s[k] = record(s[k], media, 1); // verificado a mano
      fixed++;
      console.log(`  ✔  [id]  ${title}  ->  ${media.title.romaji}`);
      continue;
    }
    const rule = FIXES.find(([re]) => re.test(title));
    if (!rule) { console.log(`  ·  sin regla   ${title}`); continue; }
    const media = await gql(QUERY_SEARCH, { s: rule[1] });
    await sleep(650);
    if (!media) { console.log(`  ✗  no encontrado  ${title}  (buscó "${rule[1]}")`); continue; }
    const conf = Math.max(
      overlap(rule[1], media.title.romaji),
      overlap(rule[1], media.title.english || ''),
      ...(media.synonyms || []).map((x) => overlap(rule[1], x))
    );
    if (conf < 0.5) { console.log(`  ✗  dudoso ${conf.toFixed(2)}  ${title} -> ${media.title.romaji}`); continue; }
    s[k] = record(s[k], media, conf);
    fixed++;
    console.log(`  ✔  ${conf.toFixed(2)}  ${title}  ->  ${media.title.romaji}`);
  }

  // Recalcular merges sobre todo el dataset.
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
  console.log(`\n✔ Corregidos: ${fixed}. Con match ahora: ${matched}/${Object.keys(s).length}. Merges: ${d.merges.length}`);
  const still = Object.keys(s).filter((k) => !s[k].matched).map((k) => s[k].title);
  console.log(`Sin portada (${still.length}): ${still.join(' | ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
