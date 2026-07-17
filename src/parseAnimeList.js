// Parser del archivo "Anime ordenado.txt".
//
// Convierte cada línea en una entrada { title, note, score } y luego agrupa
// las temporadas de una misma serie (p.ej. "date a live", "date a live 2",
// "Date A Live IV", "date a live pelicula"...) en una sola serie con varias
// temporadas. Es una importación "best effort": el agrupado no es perfecto,
// pero deja todo editable desde la app.

const ROMAN = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

// Marcadores de temporada/película que aparecen al FINAL del título.
// Orden importante: primero los más específicos (multi-palabra), al final
// los genéricos (número o romano suelto).
const SEASON_PATTERNS = [
  { re: /\s*[:\-–—]?\s*(\d{1,2})(?:st|nd|rd|th)\s+season$/i, num: (m) => +m[1], type: 'tv' },
  { re: /\s*[:\-–—]?\s*season\s+(\d{1,2})$/i, num: (m) => +m[1], type: 'tv' },
  { re: /\s*[:\-–—]?\s*part\s+(\d{1,2})$/i, num: (m) => +m[1], type: 'tv' },
  { re: /\s*[:\-–—]?\s*(\d{1,2})(?:da|ra|ta|va|nd|st|rd|th)?\s+temporada$/i, num: (m) => +m[1], type: 'tv' },
  { re: /\s*[:\-–—]?\s*temporada\s+(\d{1,2})$/i, num: (m) => +m[1], type: 'tv' },
  { re: /\s*[:\-–—]?\s*(?:the\s+)?movie$/i, num: () => 90, type: 'movie' },
  { re: /\s*[:\-–—]?\s*(?:pel[ií]cula|gekijouban)$/i, num: () => 90, type: 'movie' },
  { re: /\s*[:\-–—]?\s*ova$/i, num: () => 80, type: 'ova' },
  { re: /\s*[:\-–—]\s*r(\d{1,2})$/i, num: (m) => +m[1], type: 'tv' }, // ":R2"
  { re: /\s+s(\d{1,2})$/i, num: (m) => +m[1], type: 'tv' }, // "S2"
  { re: /\s+(ii|iii|iv|v|vi|vii|viii|ix|x)$/i, num: (m) => ROMAN[m[1].toLowerCase()], type: 'tv' },
  { re: /\s+(\d{1,2})$/, num: (m) => +m[1], type: 'tv' }, // entero suelto al final
];

// Dado un título ya limpio (sin puntaje ni nota) devuelve la "base" de la serie
// más el número/tipo de temporada detectado.
export function detectSeason(cleanTitle) {
  const base0 = cleanTitle.replace(/[.\s]+$/, '');
  for (const p of SEASON_PATTERNS) {
    const m = base0.match(p.re);
    if (m && m.index > 0) {
      const base = base0.slice(0, m.index).replace(/[\s:–—-]+$/, '').trim();
      const sort = p.num(m);
      if (base && Number.isFinite(sort)) return { base, sort, type: p.type };
    }
  }
  return { base: base0.trim(), sort: 1, type: 'tv' };
}

// Clave de agrupado: minúsculas, sin puntuación, espacios colapsados.
export function seriesKey(base) {
  return base
    .toLowerCase()
    .replace(/[.:;,!¡?¿'"’`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parsea una línea suelta. Devuelve null (línea vacía),
// { sectionHeader } (p.ej. "MANHWA") o { title, note, score }.
export function parseLine(raw) {
  if (raw == null) return null;
  let line = raw.replace(/^\s*\d+[.)]\s+/, '').trim(); // por si la lista viene numerada
  if (!line) return null;

  if (/^[A-ZÁÉÍÓÚÑÜ]{3,}$/.test(line)) return { sectionHeader: line };

  let score = null;
  const sc = line.match(/\[\s*(\d{1,2})\s*\/\s*10\s*\]/);
  if (sc) {
    score = Math.min(10, Number(sc[1]));
    line = line.replace(sc[0], ' ');
  }

  // Nota entre paréntesis: del primer "(" al último ")" (soporta paréntesis anidados).
  let note = null;
  const open = line.indexOf('(');
  if (open !== -1) {
    const close = line.lastIndexOf(')');
    if (close > open) {
      note = line.slice(open + 1, close).replace(/\s+/g, ' ').trim() || null;
      line = line.slice(0, open) + ' ' + line.slice(close + 1);
    }
  }

  const title = line.replace(/\s+/g, ' ').trim();
  if (!title) return null;
  return { title, note, score };
}

// Parsea el contenido completo y devuelve un array de series:
//   { key, title, section, seasons: [{ number, label, note, score, type }] }
export function parseAnimeList(content) {
  const lines = content.split(/\r?\n/);
  const series = new Map();
  let section = null;

  for (const raw of lines) {
    const parsed = parseLine(raw);
    if (!parsed) continue;
    if (parsed.sectionHeader) {
      section = titleCaseSection(parsed.sectionHeader);
      continue;
    }

    const { base, sort, type } = detectSeason(parsed.title);
    const key = seriesKey(base) + (section ? `|${section}` : '');
    if (!series.has(key)) {
      series.set(key, { key, title: base, section, seasons: [], _seen: new Set() });
    }
    const s = series.get(key);

    const dedupeKey = parsed.title.toLowerCase();
    if (s._seen.has(dedupeKey)) continue; // ignora líneas repetidas idénticas
    s._seen.add(dedupeKey);

    if (base.length < s.title.length) s.title = base; // el nombre más corto/limpio gana
    s.seasons.push({ label: parsed.title, note: parsed.note, score: parsed.score, sort, type });
  }

  const result = [];
  for (const s of series.values()) {
    s.seasons.sort((a, b) => a.sort - b.sort);
    s.seasons.forEach((se, i) => {
      se.number = i + 1;
    });
    delete s._seen;
    result.push(s);
  }
  return result;
}

function titleCaseSection(s) {
  return s.charAt(0) + s.slice(1).toLowerCase(); // "MANHWA" -> "Manhwa"
}
