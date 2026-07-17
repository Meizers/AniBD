// Consulta puntual a AniList para autocompletar portada y géneros por título.
// Se usa al crear un anime y desde el endpoint /api/lookup.

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

// Campos livianos: alcanzan para el desplegable de sugerencias mientras se escribe.
const CARD_FIELDS = `id title{romaji english} genres tags{name rank} coverImage{extraLarge large medium} siteUrl averageScore`;
// Campos completos: suman sinopsis, año, estudio, episodios y duración para
// autocompletar al crear y para las recomendaciones.
const FULL_FIELDS = `${CARD_FIELDS} description(asHtml:false) episodes duration seasonYear startDate{year} studios(isMain:true){nodes{name}}`;
// Un solo resultado (el mejor match) para autocompletar al crear/editar.
const QUERY = `query($s:String){Media(search:$s,type:ANIME,sort:SEARCH_MATCH){${FULL_FIELDS}}}`;
// Varios resultados para el desplegable de sugerencias mientras se escribe.
const SEARCH_QUERY = `query($s:String,$n:Int){Page(perPage:$n){media(search:$s,type:ANIME,sort:SEARCH_MATCH){${CARD_FIELDS}}}}`;
// Recomendaciones de AniList para un título (ordenadas por cuánto las votó la comunidad).
const REC_QUERY = `query($s:String,$n:Int){Media(search:$s,type:ANIME,sort:SEARCH_MATCH){id recommendations(sort:RATING_DESC,perPage:$n){nodes{rating mediaRecommendation{${FULL_FIELDS}}}}}}`;

function mapGenres(media) {
  const set = new Set();
  for (const g of media.genres || []) if (GENRE_ES[g]) set.add(GENRE_ES[g]);
  for (const t of media.tags || []) if (t.rank >= 70 && TAG_ES[t.name]) set.add(TAG_ES[t.name]);
  return [...set];
}

// AniList devuelve la sinopsis con HTML (<br>, <i>…). La dejamos en texto plano.
function stripHtml(s) {
  if (!s) return null;
  const out = String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return out || null;
}

// Da forma común a un Media de AniList. `thumb_url` es una imagen chica para la
// lista de sugerencias; `cover_url` es la grande que se guarda como portada.
// Los campos de metadata (description/episodes/…) quedan en null si el query era
// liviano y no los pidió.
function mapMedia(m) {
  return {
    id: m.id,
    romaji: m.title.romaji,
    english: m.title.english,
    cover_url: m.coverImage?.extraLarge || m.coverImage?.large || m.coverImage?.medium || null,
    thumb_url: m.coverImage?.medium || m.coverImage?.large || null,
    genres: mapGenres(m),
    siteUrl: m.siteUrl,
    averageScore: m.averageScore ?? null,
    description: stripHtml(m.description),
    episodes: m.episodes ?? null,
    duration: m.duration ?? null,
    year: m.seasonYear ?? m.startDate?.year ?? null,
    studio: m.studios?.nodes?.[0]?.name ?? null,
  };
}

async function graphql(query, variables) {
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

// Devuelve { id, romaji, english, cover_url, thumb_url, genres, siteUrl } o null.
export async function lookup(title) {
  const s = String(title || '').trim();
  if (!s) return null;
  try {
    const j = await graphql(QUERY, { s });
    const m = j?.data?.Media;
    return m ? mapMedia(m) : null;
  } catch {
    return null;
  }
}

const ROMAN = ['', '', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

// Resuelve la portada de UNA temporada probando consultas de la más específica a
// la más genérica y quedándose con la primera que AniList reconozca:
//   1) el título propio de la temporada (para merges: "Arknights: Reimei Zensou");
//   2) "<serie> II/III…" (TV) o "<serie> Movie/OVA" según el tipo;
//   3) el título de la serie a secas.
// La T1 usa directamente la portada de la serie (misma obra base): sin red.
export async function seasonCover(animeTitle, season, animeCover = null) {
  const title = String(animeTitle || '').trim();
  const label = String(season?.title || '').trim();
  const n = Number(season?.number) || 1;
  const kind = season?.kind || 'tv';

  if (n === 1 && animeCover) return animeCover;

  const queries = [];
  if (label && !/^temporada\s*\d+$/i.test(label)) queries.push(label);
  if (kind === 'movie') queries.push(`${title} Movie`);
  else if (kind === 'ova') queries.push(`${title} OVA`);
  else if (n > 1 && ROMAN[n]) queries.push(`${title} ${ROMAN[n]}`);
  queries.push(title);

  const seen = new Set();
  for (const q of queries) {
    const key = q.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const r = await lookup(q);
    if (r?.cover_url) return r.cover_url;
  }
  // Nada resolvió (típicamente error de red/rate-limit): devolver null deja la
  // temporada en NULL para reintentar en la próxima apertura, en vez de fijarle
  // una portada equivocada.
  return null;
}

// Devuelve hasta `limit` coincidencias (para el autocompletado). Nunca lanza:
// ante cualquier error devuelve [].
export async function search(title, limit = 8) {
  const s = String(title || '').trim();
  if (!s) return [];
  try {
    const j = await graphql(SEARCH_QUERY, { s, n: Math.min(Math.max(1, limit), 15) });
    const media = j?.data?.Page?.media;
    return Array.isArray(media) ? media.map(mapMedia) : [];
  } catch {
    return [];
  }
}

// --- Franchise (temporadas + películas + OVAs relacionadas) ------------------
const NODE_FIELDS = `id type format title{romaji english} coverImage{extraLarge large medium} startDate{year month day} episodes duration siteUrl`;
const FRANCHISE_QUERY = `query($id:Int){Media(id:$id,type:ANIME){${NODE_FIELDS} relations{edges{relationType node{${NODE_FIELDS}}}}}}`;
// Recorremos la línea temporal por SEQUEL/PREQUEL (atraviesa también las OVAs y
// películas intercaladas, que en AniList hacen de "puente" entre temporadas).
const WALK_REL = new Set(['SEQUEL', 'PREQUEL']);
// Sumamos como parte del franchise lo colgado de estas relaciones (internas a la
// obra); evita arrastrar cosas ajenas (ADAPTATION del manga, CHARACTER, etc.).
const COLLECT_REL = new Set(['SEQUEL', 'PREQUEL', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE', 'PARENT', 'SUMMARY']);

// AniList format -> nuestro `kind`. Devuelve null para formatos que ignoramos.
function kindFromFormat(fmt) {
  if (fmt === 'TV' || fmt === 'TV_SHORT') return 'tv';
  if (fmt === 'MOVIE') return 'movie';
  if (fmt === 'OVA' || fmt === 'ONA' || fmt === 'SPECIAL') return 'ova';
  return null;
}

function nodeEntry(n) {
  const kind = kindFromFormat(n.format);
  if (!kind) return null;
  const d = n.startDate || {};
  return {
    anilistId: n.id,
    kind,
    format: n.format,
    romaji: n.title.romaji,
    english: n.title.english,
    cover_url: n.coverImage?.extraLarge || n.coverImage?.large || n.coverImage?.medium || null,
    thumb_url: n.coverImage?.medium || n.coverImage?.large || null,
    episodes: n.episodes ?? null,
    duration: n.duration ?? null,
    siteUrl: n.siteUrl,
    // Clave ordenable por estreno (huecos -> al final).
    dateKey: (d.year || 9999) * 10000 + (d.month || 99) * 100 + (d.day || 99),
  };
}

// Recorre el franchise de `title` (SEQUEL/PREQUEL, BFS acotado por `maxCalls`) y
// devuelve TODAS sus entradas —temporadas TV, películas y OVAs— únicas y
// ordenadas por fecha de estreno. Nunca lanza.
export async function walkFranchise(title, { maxCalls = 20 } = {}) {
  const base = await lookup(title);
  if (!base?.id) return [];
  const seen = new Set([base.id]);
  const queue = [base.id];
  const entries = new Map();
  let calls = 0;
  try {
    while (queue.length && calls < maxCalls) {
      const id = queue.shift();
      calls++;
      const j = await graphql(FRANCHISE_QUERY, { id });
      const m = j?.data?.Media;
      if (!m) continue;
      const self = nodeEntry(m);                 // el propio nodo de la línea temporal
      if (self && !entries.has(m.id)) entries.set(m.id, self);
      for (const e of m.relations?.edges || []) {
        const n = e.node;
        if (!n || n.type !== 'ANIME') continue;
        if (COLLECT_REL.has(e.relationType)) {
          const entry = nodeEntry(n);
          if (entry && !entries.has(n.id)) entries.set(n.id, entry);
        }
        if (WALK_REL.has(e.relationType) && !seen.has(n.id)) {
          seen.add(n.id);
          queue.push(n.id);
        }
      }
    }
  } catch {
    /* devolvemos lo que hayamos juntado hasta el error */
  }
  return [...entries.values()].sort((a, b) => a.dateKey - b.dateKey || a.anilistId - b.anilistId);
}

// Sólo las películas/OVAs del franchise (para el botón "Buscar relacionadas").
export async function relatedExtras(title, opts) {
  return (await walkFranchise(title, opts)).filter((e) => e.kind !== 'tv');
}

// --- Recomendaciones ---------------------------------------------------------
// A partir de una lista de títulos "semilla" (típicamente tus series mejor
// puntuadas), junta las recomendaciones que AniList asocia a cada una y las
// agrega por frecuencia/votos. Devuelve `{ ...mapMedia, votes, seeds }` ordenado
// de más a menos recomendado. Nunca lanza.
export async function recommend(titles, { perSeed = 12, maxSeeds = 6 } = {}) {
  const seeds = [...new Set((titles || []).map((t) => String(t || '').trim()).filter(Boolean))].slice(0, maxSeeds);
  const agg = new Map();
  for (const s of seeds) {
    let j;
    try {
      j = await graphql(REC_QUERY, { s, n: Math.min(Math.max(1, perSeed), 25) });
    } catch {
      continue;
    }
    const nodes = j?.data?.Media?.recommendations?.nodes || [];
    for (const node of nodes) {
      const m = node.mediaRecommendation;
      if (!m || !m.id) continue;
      const cur = agg.get(m.id) || { ...mapMedia(m), votes: 0, seeds: [] };
      cur.votes += Math.max(node.rating || 0, 1);
      if (!cur.seeds.includes(s)) cur.seeds.push(s);
      agg.set(m.id, cur);
    }
  }
  return [...agg.values()].sort(
    (a, b) => b.votes - a.votes || (b.averageScore || 0) - (a.averageScore || 0)
  );
}
