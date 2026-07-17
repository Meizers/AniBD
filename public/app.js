'use strict';

// ------------------------------------------------------------------ helpers ---
const $ = (sel) => document.querySelector(sel);

const STATUS = {
  pendiente: { label: 'Pendiente', cls: 'st-pend' },
  en_progreso: { label: 'En progreso', cls: 'st-prog' },
  completado: { label: 'Completado', cls: 'st-done' },
  en_pausa: { label: 'En pausa', cls: 'st-hold' },
  abandonado: { label: 'Abandonado', cls: 'st-drop' },
};
const KIND = { tv: 'TV', movie: 'Película', ova: 'OVA' };

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

function fmtScore(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// Mini "hyperscript" para armar nodos sin innerHTML.
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

let toastTimer;
function toast(msg, type = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

// -------------------------------------------------------------------- state ---
const state = { filters: { search: '', genre: '', status: '', sort: 'title' }, genres: [] };

// -------------------------------------------------------------------- stats ---
async function loadStats() {
  try {
    const s = await api('/stats');
    $('#stats').replaceChildren(
      stat(s.animes, 'animes'),
      stat(s.completadas, 'completadas'),
      stat(s.en_progreso, 'en curso'),
      stat(s.pendientes, 'pendientes'),
      stat(fmtScore(s.avg_score), 'prom. global', true),
      stat(s.total_watches, 'vistas')
    );
  } catch { /* la BD puede no estar todavía */ }
}
function stat(value, label, accent) {
  return h('div', { class: 'stat' + (accent ? ' accent' : '') }, h('b', {}, value), h('span', {}, label));
}

// ------------------------------------------------------------------- genres ---
async function loadGenres() {
  try {
    state.genres = await api('/genres');
    const sel = $('#fGenre');
    const current = sel.value;
    sel.replaceChildren(h('option', { value: '' }, 'Todos los géneros'));
    for (const g of state.genres) {
      sel.append(h('option', { value: g.name }, `${g.name} (${g.anime_count})`));
    }
    sel.value = current;
  } catch { /* la BD puede no estar todavía */ }
}

// -------------------------------------------------------------------- grid ---
async function loadAnimes() {
  const { search, genre, status, sort } = state.filters;
  const qs = new URLSearchParams();
  if (search) qs.set('search', search);
  if (genre) qs.set('genre', genre);
  if (status) qs.set('status', status);
  if (sort) qs.set('sort', sort);

  const grid = $('#grid');
  try {
    const animes = await api('/animes?' + qs.toString());
    $('#count').textContent = `${animes.length} anime${animes.length === 1 ? '' : 's'}`;
    $('#empty').hidden = animes.length > 0;
    grid.innerHTML = animes.map(cardHtml).join('');
  } catch (e) {
    grid.innerHTML = '';
    $('#count').textContent = '';
    $('#empty').hidden = false;
    $('#empty').textContent = 'No pude cargar los animes: ' + e.message;
  }
}

// Acción rápida sobre la temporada "en foco" (sin abrir el detalle): si estás
// viéndola o está pendiente, "▶ +1" avanza un episodio; si ya la terminaste,
// "👁 +1 vista" suma un rewatch. Aparece al pasar el mouse por la portada.
function quickBar(a) {
  if (!a.focus_id) return '';
  const st = a.focus_status;
  if (st === 'completado') {
    return `<div class="q-bar">
      <button class="q-act" data-season="${a.focus_id}" data-act="watch" title="Sumar una vista (rewatch)">👁 +1 vista</button>
    </div>`;
  }
  if (st === 'en_progreso' || st === 'pendiente') {
    const total = a.focus_total;
    const watched = a.focus_watched ?? 0;
    const pct = total ? Math.min(100, Math.round((watched / total) * 100)) : 0;
    const num = total ? `${watched}/${total}` : `ep ${watched + 1}`;
    return `<div class="q-bar">
      <button class="q-act" data-season="${a.focus_id}" data-act="ep" title="Ver un episodio más">▶ +1</button>
      <div class="q-track"><span class="q-fill" style="width:${pct}%"></span></div>
      <span class="q-num">${num}</span>
    </div>`;
  }
  return '';
}

function cardHtml(a) {
  const chips =
    (a.genres || []).map((g) => `<span class="chip" data-genre="${esc(g)}">${esc(g)}</span>`).join('') ||
    '<span class="chip empty">sin género</span>';
  const pills = [];
  if (a.completed_count) pills.push(`<span class="pill st-done">${a.completed_count} ✓</span>`);
  if (a.watching_count) pills.push(`<span class="pill st-prog">${a.watching_count} ▶</span>`);
  if (a.pending_count) pills.push(`<span class="pill st-pend">${a.pending_count} •</span>`);

  const poster = a.cover_url
    ? `<img class="poster-img" src="${esc(a.cover_url)}" alt="${esc(a.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
    : `<div class="poster-ph">${esc((a.title[0] || '?').toUpperCase())}</div>`;
  return `<article class="card" data-id="${a.id}" tabindex="0">
    <div class="poster">
      ${poster}
      <span class="score ${a.avg_score == null ? 'muted' : ''}" title="Promedio general">${fmtScore(a.avg_score)}</span>
      ${quickBar(a)}
    </div>
    <div class="card-body">
      <h3 title="${esc(a.title)}">${esc(a.title)}</h3>
      <div class="chips">${chips}</div>
      <div class="card-foot">
        <span class="meta" title="Temporadas"><span class="ic">📺</span>${a.tv_count}</span>
        ${a.extra_count ? `<span class="meta" title="Películas y OVAs"><span class="ic">🎬</span>${a.extra_count}</span>` : ''}
        <span class="meta" title="Veces vistas en total"><span class="ic">👁</span>${a.total_watches}</span>
        <span class="pills">${pills.join('')}</span>
      </div>
    </div>
  </article>`;
}

// ----------------------------------------------------------- detalle / edición ---
const dlg = $('#dlgAnime');
let currentId = null;

async function openAnime(id) {
  currentId = id;
  let a;
  try {
    a = await api('/animes/' + id);
  } catch (e) {
    return toast(e.message, 'err');
  }
  renderDetail(a);
  if (!dlg.open) dlg.showModal();
  autofillSeasonCovers(a);
}

// Al abrir un anime, completa en AniList (y persiste) la portada de las temporadas
// que no tengan una. Actualiza las miniaturas en el lugar, sin re-renderizar, para
// no pisar ediciones en curso. Silencioso ante errores.
async function autofillSeasonCovers(a) {
  if (!a.seasons?.some((s) => !s.cover_url)) return;
  let resp;
  try {
    resp = await api(`/animes/${a.id}/season-covers`, { method: 'POST' });
  } catch {
    return;
  }
  if (currentId !== a.id || !dlg.open) return;   // el usuario ya cambió de anime
  for (const { id, cover_url } of resp.updated || []) {
    const node = dlg.querySelector(`.season[data-id="${id}"]`);
    if (!node) continue;
    const cover = node.querySelector('.s-cover');
    if (cover && !cover.value.trim()) cover.value = cover_url;
    const thumb = node.querySelector('.s-thumb');
    if (thumb) fillThumb(thumb, cover_url);
  }
}

async function refresh() {
  if (currentId != null) {
    const scroll = dlg.querySelector('.detail-body')?.scrollTop ?? 0;
    const a = await api('/animes/' + currentId);
    renderDetail(a);
    const body = dlg.querySelector('.detail-body');
    if (body) body.scrollTop = scroll;
  }
  loadAnimes();
  loadStats();
  loadGenres();
}

function renderDetail(a) {
  const poster = a.cover_url
    ? h('img', { src: a.cover_url, alt: a.title, referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() })
    : h('div', { class: 'poster-ph' }, (a.title[0] || '?').toUpperCase());

  const titleInput = h('input', { id: 'a-title', value: a.title });
  // Sugerencias al reescribir el título; completa portada/géneros si están vacíos.
  attachAutocomplete(titleInput, (r) => {
    titleInput.value = r.romaji || r.english || titleInput.value;
    if (r.cover_url && !$('#a-cover').value.trim()) $('#a-cover').value = r.cover_url;
    if (r.genres?.length && !$('#a-genres').value.trim()) $('#a-genres').value = r.genres.join(', ');
  });

  const head = h('div', { class: 'detail-head' },
    h('div', { class: 'detail-poster' },
      poster,
      h('span', { class: 'score ' + (a.avg_score == null ? 'muted' : ''), title: 'Promedio general' }, fmtScore(a.avg_score))
    ),
    h('div', { class: 'title-wrap' },
      h('h2', { style: 'margin:0' }, titleInput),
      h('div', { class: 'meta-grid' },
        h('label', { class: 'full' }, 'Géneros (coma)',
          h('input', { id: 'a-genres', value: (a.genres || []).join(', '), placeholder: 'Romance, Acción…' })
        ),
        h('label', { class: 'full' }, 'Portada (URL)',
          h('div', { class: 'cover-row' },
            h('input', { id: 'a-cover', value: a.cover_url || '', placeholder: 'https://…' }),
            h('button', {
              type: 'button', class: 'btn small', title: 'Buscar en AniList (portada, géneros, año, estudio, sinopsis)',
              onclick: async () => {
                const r = await runLookup($('#a-title').value, $('#a-cover'), $('#a-genres'), null);
                if (r) {
                  if (r.year && !$('#a-year').value) $('#a-year').value = r.year;
                  if (r.studio && !$('#a-studio').value.trim()) $('#a-studio').value = r.studio;
                  if (r.description && !$('#a-synopsis').value.trim()) $('#a-synopsis').value = r.description;
                }
                toast(r ? 'Datos encontrados ✓ (tocá Guardar cambios)' : 'Sin resultados en AniList', r ? 'ok' : 'err');
              },
            }, '🔍')
          )
        ),
        h('label', {}, 'Año',
          h('input', { id: 'a-year', type: 'number', min: '1900', value: a.year ?? '', placeholder: '2013' })
        ),
        h('label', {}, 'Estudio',
          h('input', { id: 'a-studio', value: a.studio || '', placeholder: 'Estudio de animación' })
        ),
        h('label', { class: 'full' }, 'Sinopsis',
          h('textarea', { id: 'a-synopsis', rows: '2' }, a.synopsis || '')
        )
      ),
      h('div', { class: 'season-actions' },
        h('button', { class: 'btn primary small', onclick: saveAnime }, 'Guardar cambios'),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn danger small', onclick: () => removeAnime(a.id, a.title) }, 'Eliminar anime')
      )
    ),
    h('button', { class: 'x', title: 'Cerrar', onclick: () => dlg.close() }, '✕')
  );

  const avg = a.avg_score == null ? '—' : fmtScore(a.avg_score);
  // Las películas y OVAs no son temporadas: van en su propia sección.
  const tvSeasons = a.seasons.filter((s) => (s.kind || 'tv') === 'tv');
  const extras = a.seasons.filter((s) => s.kind === 'movie' || s.kind === 'ova');

  const seasonsTitle = h('div', { class: 'sec-title' },
    h('h3', {}, 'Temporadas',
      h('span', { class: 'sub' }, `${tvSeasons.length} · promedio ${avg} (${a.rated_seasons} puntuadas)`)),
    h('div', { class: 'sec-actions' },
      h('button', { class: 'btn small', title: 'Buscar temporadas que te falten en AniList', onclick: () => openRelated(a.id, 'tv') }, '🔎 ¿Faltan?'),
      h('button', { class: 'btn small', onclick: () => addSeason(a.id, 'tv') }, '＋ Temporada')
    )
  );

  const extrasTitle = h('div', { class: 'sec-title' },
    h('h3', {}, 'Películas y OVAs',
      h('span', { class: 'sub' }, `${extras.length}`)),
    h('div', { class: 'sec-actions' },
      h('button', { class: 'btn small', onclick: () => openRelated(a.id, 'extras') }, '🔎 Buscar relacionadas'),
      h('button', { class: 'btn small', onclick: () => addSeason(a.id, 'movie') }, '＋ Película / OVA')
    )
  );

  const body = h('div', { class: 'detail-body' },
    seasonsTitle,
    ...tvSeasons.map((s, i) => seasonEl(s, i + 1)),
    extrasTitle,
    ...extras.map((s) => seasonEl(s))
  );

  dlg.replaceChildren(h('div', { class: 'detail' }, head, body));
}

// Barra de progreso de episodios (vistos / total).
function epProgressEl(s) {
  const total = s.total_episodes;
  const watched = s.watched_episodes ?? 0;
  const pct = total ? Math.min(100, Math.round((watched / total) * 100)) : 0;
  const label = total ? `${watched} / ${total} ep · ${pct}%` : `${watched} ep vistos`;
  return h('div', { class: 'ep-progress' },
    h('button', { class: 'btn small ep-plus', title: 'Ver un episodio más', onclick: () => episodeStep(s.id, 1) }, '▶ +1 ep'),
    h('div', { class: 'ep-bar' }, h('span', { class: 'ep-fill', style: `width:${pct}%` })),
    h('span', { class: 'ep-label' }, label)
  );
}

// Rellena un contenedor con la miniatura de portada (o un placeholder).
function fillThumb(wrap, url) {
  wrap.replaceChildren(
    url
      ? h('img', { src: url, referrerpolicy: 'no-referrer', alt: '', onerror: (e) => fillThumb(wrap, null) })
      : h('span', { class: 'ph' }, '🎬')
  );
}

// `displayNum` es la posición entre las temporadas TV (T1, T2…), contigua aunque
// el `number` interno tenga huecos por películas/OVAs intercaladas.
function seasonEl(s, displayNum) {
  const field = (label, input) => h('label', {}, label, input);
  const opt = (map, val) =>
    Object.entries(map).map(([v, m]) =>
      h('option', { value: v, ...(v === val ? { selected: true } : {}) }, m.label ?? m));

  const kindSel = h('select', { class: 's-kind' }, ...opt(KIND, s.kind));
  const statusSel = h('select', { class: 's-status' }, ...opt(STATUS, s.status));

  const titleInput = h('input', { class: 's-title', value: s.title || '', placeholder: 'Título de la temporada' });
  const coverInput = h('input', { class: 's-cover', value: s.cover_url || '', placeholder: 'https://…' });
  const thumb = h('div', { class: 's-thumb' });
  fillThumb(thumb, s.cover_url);
  // Mantener la miniatura sincronizada con la URL al escribir/pegar.
  coverInput.addEventListener('input', () => fillThumb(thumb, coverInput.value.trim()));

  // Buscar portada en AniList por el título de la temporada (o el de la serie).
  const lookupBtn = h('button', {
    type: 'button', class: 'season-cover-btn', title: 'Buscar portada en AniList',
    onclick: async () => {
      const q = titleInput.value.trim();
      const useSeries = !q || /^temporada\s*\d+$/i.test(q);
      const title = useSeries ? ($('#a-title')?.value.trim() || q) : q;
      coverInput.value = '';                       // forzar que el lookup la complete
      const r = await runLookup(title, coverInput, null, null);
      fillThumb(thumb, coverInput.value.trim());
      toast(r ? 'Portada encontrada ✓ (tocá Guardar)' : 'Sin resultados en AniList', r ? 'ok' : 'err');
    },
  }, '🔍');

  // Al elegir una sugerencia: completar título (si estaba vacío) y portada.
  attachAutocomplete(titleInput, (r) => {
    if (r.romaji && !titleInput.value.trim()) titleInput.value = r.romaji;
    if (r.cover_url) { coverInput.value = r.cover_url; fillThumb(thumb, r.cover_url); }
  });

  const badge =
    s.kind === 'movie' ? h('span', { class: 'season-badge kind-extra' }, '🎬 Película')
    : s.kind === 'ova' ? h('span', { class: 'season-badge kind-extra' }, '📀 OVA')
    : h('span', { class: 'season-badge' }, `T${displayNum ?? s.number}`);

  return h('div', { class: 'season', 'data-id': s.id },
    h('div', { class: 'season-poster' }, thumb, badge, lookupBtn),
    h('div', { class: 'season-main' },
      titleInput,
      epProgressEl(s),
      h('div', { class: 'season-grid' },
        field('Estado', statusSel),
        field('Tipo', kindSel),
        field('Puntuación (0-10)', h('input', { class: 's-score', type: 'number', min: '0', max: '10', step: '0.5', value: s.score ?? '' })),
        field('Veces vista', h('div', { class: 'watch-field' },
          h('input', { class: 's-watched', type: 'number', min: '0', value: s.times_watched ?? 0 }),
          h('button', { class: 'btn small', title: 'Sumar una vista', onclick: () => watchOnce(s.id) }, '+1')
        )),
        field('Episodio actual', h('input', { class: 's-watched-eps', type: 'number', min: '0', value: s.watched_episodes ?? 0 })),
        field('Episodios (total)', h('input', { class: 's-eps', type: 'number', min: '0', value: s.total_episodes ?? '' })),
        field('Duración (min/ep)', h('input', { class: 's-duration', type: 'number', min: '0', value: s.duration ?? '' })),
        field('Empezada', h('input', { class: 's-start', type: 'date', value: s.started_at ? s.started_at.slice(0, 10) : '' })),
        field('Terminada', h('input', { class: 's-finish', type: 'date', value: s.finished_at ? s.finished_at.slice(0, 10) : '' })),
        h('label', { class: 'full' }, 'Portada (URL)', coverInput),
        h('label', { class: 'full' }, 'Notas / observaciones',
          h('textarea', { class: 's-notes', rows: '2' }, s.notes || ''))
      ),
      h('div', { class: 'season-actions' },
        h('button', { class: 'btn primary small', onclick: (e) => saveSeason(e, s.id) }, 'Guardar'),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn danger small', onclick: () => removeSeason(s.id) }, 'Eliminar')
      )
    )
  );
}

// ------------------------------------------------------------------ acciones ---
async function saveAnime() {
  const genres = $('#a-genres').value.split(',').map((x) => x.trim()).filter(Boolean);
  try {
    await api('/animes/' + currentId, {
      method: 'PATCH',
      body: {
        title: $('#a-title').value.trim(),
        synopsis: $('#a-synopsis').value,
        cover_url: $('#a-cover').value.trim(),
        year: $('#a-year').value,
        studio: $('#a-studio').value.trim(),
        genres,
      },
    });
    toast('Guardado ✓');
    await refresh();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function removeAnime(id, title) {
  if (!confirm(`¿Eliminar "${title}" y todas sus temporadas?`)) return;
  try {
    await api('/animes/' + id, { method: 'DELETE' });
    dlg.close();
    currentId = null;
    toast('Anime eliminado');
    loadAnimes(); loadStats(); loadGenres();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function addSeason(animeId, kind = 'tv') {
  try {
    // sin "number": el servidor calcula el siguiente (MAX+1), evita colisiones.
    // El título por defecto ("Temporada N" / "Película" / "OVA") lo pone el server.
    await api(`/animes/${animeId}/seasons`, { method: 'POST', body: kind === 'tv' ? {} : { kind } });
    toast(kind === 'tv' ? 'Temporada agregada ✓' : 'Película / OVA agregada ✓ (elegí el tipo)');
    await refresh();
  } catch (e) {
    toast(e.message, 'err');
  }
}

function seasonPayload(node) {
  const val = (sel) => node.querySelector(sel).value;
  return {
    title: val('.s-title'),
    cover_url: val('.s-cover'),
    kind: val('.s-kind'),
    status: val('.s-status'),
    score: val('.s-score'),
    times_watched: val('.s-watched'),
    watched_episodes: val('.s-watched-eps'),
    total_episodes: val('.s-eps'),
    duration: val('.s-duration'),
    started_at: val('.s-start'),
    finished_at: val('.s-finish'),
    notes: val('.s-notes'),
  };
}

async function saveSeason(e, id) {
  const node = e.target.closest('.season');
  try {
    await api('/seasons/' + id, { method: 'PATCH', body: seasonPayload(node) });
    toast('Temporada guardada ✓');
    await refresh();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function watchOnce(id) {
  try {
    await api(`/seasons/${id}/watch`, { method: 'POST' });
    toast('¡Otra vista sumada! 👁');
    await refresh();
  } catch (e) {
    toast(e.message, 'err');
  }
}

// Avanza (o retrocede) el progreso de episodios y refresca el detalle. El server
// ajusta el estado solo (en_progreso al arrancar, completado al llegar al final).
async function episodeStep(id, delta) {
  try {
    const s = await api(`/seasons/${id}/episode`, { method: 'POST', body: { delta } });
    if (s.status === 'completado') toast('¡Temporada completada! 🎉');
    await refresh();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function removeSeason(id) {
  if (!confirm('¿Eliminar esta temporada?')) return;
  try {
    await api('/seasons/' + id, { method: 'DELETE' });
    toast('Temporada eliminada');
    await refresh();
  } catch (e) {
    toast(e.message, 'err');
  }
}

// Autocompletar portada/géneros desde AniList por título. Devuelve el match o null.
async function runLookup(title, coverInput, genresInput, statusEl) {
  const t = (title || '').trim();
  if (!t) return null;
  if (statusEl) statusEl.textContent = '🔍 Buscando en AniList…';
  let r;
  try {
    r = await api('/lookup?title=' + encodeURIComponent(t));
  } catch {
    if (statusEl) statusEl.textContent = 'No pude consultar AniList.';
    return null;
  }
  if (!r.found) {
    if (statusEl) statusEl.textContent = 'Sin resultados en AniList — poné la portada a mano.';
    return null;
  }
  if (coverInput && !coverInput.value.trim() && r.cover_url) coverInput.value = r.cover_url;
  if (genresInput && !genresInput.value.trim() && r.genres?.length) genresInput.value = r.genres.join(', ');
  if (statusEl) {
    statusEl.replaceChildren(
      h('span', {}, `✓ ${r.romaji || 'encontrado'}`),
      r.cover_url ? h('img', { class: 'lookup-thumb', src: r.cover_url, referrerpolicy: 'no-referrer', alt: '' }) : ''
    );
  }
  return r;
}

// ---------------------------------------- franchise faltante (temporadas/extras) ---
const dlgRelated = $('#dlgRelated');
let relatedAnimeId = null;
let relatedMode = 'extras';       // 'tv' = temporadas faltantes | 'extras' = pelis/OVAs
let relatedResults = [];

// El endpoint /missing trae TODO el franchise faltante; filtramos según el modo.
async function openRelated(animeId, mode = 'extras') {
  relatedAnimeId = animeId;
  relatedMode = mode;
  relatedResults = [];
  renderRelated({ loading: true });
  if (!dlgRelated.open) dlgRelated.showModal();
  let data;
  try {
    data = await api(`/animes/${animeId}/missing`);
  } catch (e) {
    if (relatedAnimeId === animeId) renderRelated({ error: e.message });
    return;
  }
  if (relatedAnimeId !== animeId) return;   // se cerró o se abrió otro
  const all = data.results || [];
  relatedResults = mode === 'tv' ? all.filter((r) => r.kind === 'tv') : all.filter((r) => r.kind !== 'tv');
  renderRelated({});
}

function kindBadge(kind) {
  return kind === 'movie' ? '🎬 Película' : kind === 'ova' ? '📀 OVA' : '📺 Temporada';
}

function relatedRow(r, i) {
  const eps = r.episodes ? ` · ${r.episodes} ep` : '';
  const sub = kindBadge(r.kind) + eps + (r.english && r.english !== r.romaji ? ' · ' + r.english : '');
  return h('label', { class: 'related-item' },
    h('input', { type: 'checkbox', class: 'r-check', checked: true, 'data-i': i }),
    r.thumb_url
      ? h('img', { class: 'related-thumb', src: r.thumb_url, referrerpolicy: 'no-referrer', alt: '' })
      : h('div', { class: 'related-thumb ph' }, '🎬'),
    h('div', { class: 'related-meta' },
      h('span', { class: 'related-title' }, r.romaji || r.english || '—'),
      h('span', { class: 'related-sub' }, sub)
    )
  );
}

function renderRelated({ loading, error }) {
  const tv = relatedMode === 'tv';
  const heading = tv ? 'Temporadas que te faltan' : 'Películas y OVAs relacionadas';
  const emptyMsg = tv
    ? 'No encontré temporadas nuevas: estás al día 🌸'
    : 'No encontré películas ni OVAs nuevas relacionadas. 🌸';
  const close = h('button', { class: 'x', title: 'Cerrar', onclick: () => dlgRelated.close() }, '✕');
  let content, foot;
  if (loading) {
    content = h('p', { class: 'related-msg' }, '🔍 Buscando en AniList… (puede tardar unos segundos)');
  } else if (error) {
    content = h('p', { class: 'related-msg err' }, 'No pude buscar: ' + error);
  } else if (!relatedResults.length) {
    content = h('p', { class: 'related-msg' }, emptyMsg);
  } else {
    content = h('div', { class: 'related-list' }, ...relatedResults.map(relatedRow));
    foot = h('div', { class: 'form-actions' },
      h('button', { class: 'btn ghost', onclick: () => dlgRelated.close() }, 'Cancelar'),
      h('button', { class: 'btn primary', onclick: addSelectedRelated }, 'Agregar seleccionadas')
    );
  }
  dlgRelated.replaceChildren(
    h('div', { class: 'related' },
      h('div', { class: 'related-head' }, h('h2', {}, heading), close),
      content,
      foot
    )
  );
}

async function addSelectedRelated() {
  const items = [...dlgRelated.querySelectorAll('.r-check')]
    .filter((c) => c.checked)
    .map((c) => relatedResults[Number(c.dataset.i)])
    .filter(Boolean)
    .map((r) => ({
      title: r.romaji || r.english, kind: r.kind, cover_url: r.cover_url,
      total_episodes: r.episodes, duration: r.duration,
    }));
  if (!items.length) { dlgRelated.close(); return; }
  try {
    const { added } = await api(`/animes/${relatedAnimeId}/extras`, { method: 'POST', body: { items } });
    dlgRelated.close();
    toast(`${added} agregada${added === 1 ? '' : 's'} ✓`);
    await refresh();
  } catch (e) {
    toast(e.message, 'err');
  }
}

dlgRelated.addEventListener('click', (e) => { if (e.target === dlgRelated) dlgRelated.close(); });

// ------------------------------------------------------------ recomendaciones ---
const dlgRecs = $('#dlgRecs');
let recResults = [];
let recSeeds = [];

async function openRecs() {
  recResults = [];
  recSeeds = [];
  renderRecs({ loading: true });
  if (!dlgRecs.open) dlgRecs.showModal();
  let data;
  try {
    data = await api('/recommendations');
  } catch (e) {
    renderRecs({ error: e.message });
    return;
  }
  recResults = data.results || [];
  recSeeds = data.seeds || [];
  renderRecs({});
}

function recCard(r, i) {
  return h('div', { class: 'rec-card' },
    r.thumb_url
      ? h('img', { class: 'rec-thumb', src: r.thumb_url, referrerpolicy: 'no-referrer', alt: '' })
      : h('div', { class: 'rec-thumb ph' }, '🎬'),
    h('div', { class: 'rec-body' },
      h('span', { class: 'rec-title', title: r.english || '' }, r.romaji || r.english || '—'),
      h('div', { class: 'rec-tags' }, ...(r.genres || []).slice(0, 3).map((g) => h('span', { class: 'chip' }, g))),
      h('div', { class: 'rec-foot' },
        r.averageScore ? h('span', { class: 'rec-score', title: 'Puntaje en AniList' }, `★ ${(r.averageScore / 10).toFixed(1)}`) : '',
        r.siteUrl ? h('a', { class: 'rec-link', href: r.siteUrl, target: '_blank', rel: 'noopener' }, 'AniList ↗') : '',
        h('span', { class: 'grow' }),
        h('button', { class: 'btn primary small', onclick: (e) => addRec(e, i) }, '＋ Agregar')
      )
    )
  );
}

function renderRecs({ loading, error }) {
  const close = h('button', { class: 'x', title: 'Cerrar', onclick: () => dlgRecs.close() }, '✕');
  let content;
  if (loading) {
    content = h('p', { class: 'related-msg' }, '✨ Buscando recomendaciones en AniList…');
  } else if (error) {
    content = h('p', { class: 'related-msg err' }, 'No pude buscar: ' + error);
  } else if (!recResults.length) {
    content = h('p', { class: 'related-msg' },
      recSeeds.length
        ? 'No encontré recomendaciones nuevas (quizás ya tenés todo 🌸).'
        : 'Puntuá algunas series primero y te recomiendo según tus gustos ✨.');
  } else {
    content = h('div', { class: 'rec-grid' }, ...recResults.map(recCard));
  }
  const sub = recSeeds.length
    ? h('p', { class: 'rec-sub' }, 'Basado en: ' + recSeeds.slice(0, 6).join(', '))
    : '';
  dlgRecs.replaceChildren(
    h('div', { class: 'related' },
      h('div', { class: 'related-head' }, h('h2', {}, '✨ Recomendados para vos'), close),
      sub,
      content
    )
  );
}

// Agregar una recomendación = crear el anime (dispara la búsqueda del franchise).
async function addRec(e, i) {
  const r = recResults[i];
  if (!r) return;
  const btn = e.target;
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Agregando…';
  try {
    const created = await api('/animes', { method: 'POST', body: { title: r.romaji || r.english } });
    toast(`"${created.title}" agregado ✓`);
    recResults.splice(i, 1);
    renderRecs({});
    await loadAnimes();
    loadStats();
    loadGenres();
  } catch (err) {
    toast(err.message, 'err');
    btn.disabled = false;
    btn.textContent = prev;
  }
}

$('#btnRecs').addEventListener('click', openRecs);
dlgRecs.addEventListener('click', (e) => { if (e.target === dlgRecs) dlgRecs.close(); });

// ------------------------------------------------------- autocompletar (AniList) ---
// Un único menú flotante compartido por todos los inputs con sugerencias.
// Se posiciona con `fixed` bajo el input; se agrega al <dialog> activo para que
// aparezca por encima del modal (top layer) y no lo recorte el scroll interno.
const acMenu = h('div', { class: 'ac-menu', role: 'listbox' });
acMenu.hidden = true;
let acItems = [];
let acActive = -1;
let acPick = null;
let acInput = null;

function acPosition() {
  if (!acInput) return;
  const r = acInput.getBoundingClientRect();
  acMenu.style.left = r.left + 'px';
  acMenu.style.top = r.bottom + 4 + 'px';
  acMenu.style.width = r.width + 'px';
}

function acHide() {
  acMenu.hidden = true;
  acItems = []; acActive = -1; acPick = null; acInput = null;
}

function acRender() {
  acMenu.replaceChildren(
    ...acItems.map((r, i) =>
      h('div', {
        class: 'ac-item' + (i === acActive ? ' active' : ''),
        role: 'option',
        // mousedown (no click) para elegir antes de que el input pierda foco.
        onmousedown: (e) => { e.preventDefault(); acChoose(i); },
      },
        r.thumb_url
          ? h('img', { class: 'ac-thumb', src: r.thumb_url, referrerpolicy: 'no-referrer', alt: '' })
          : h('div', { class: 'ac-thumb ph' }, '🎬'),
        h('div', { class: 'ac-meta' },
          h('span', { class: 'ac-title' }, r.romaji || r.english || '—'),
          r.english && r.english !== r.romaji ? h('span', { class: 'ac-sub' }, r.english) : ''
        )
      )
    )
  );
}

function acChoose(i) {
  const r = acItems[i];
  const cb = acPick;
  acHide();
  if (r && cb) cb(r);
}

function acShow(input, results, onPick) {
  acInput = input; acItems = results; acActive = -1; acPick = onPick;
  const host = input.closest('dialog') || document.body;
  if (acMenu.parentNode !== host) host.appendChild(acMenu);
  acRender();
  acPosition();
  acMenu.hidden = false;
}

// Conecta un <input> de título con el desplegable de sugerencias de AniList.
function attachAutocomplete(input, onPick) {
  let timer;
  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { if (acInput === input) acHide(); return; }
    timer = setTimeout(async () => {
      let data;
      try { data = await api('/search?title=' + encodeURIComponent(q)); }
      catch { return; }
      // El foco pudo cambiar mientras esperábamos la red.
      if (document.activeElement !== input) return;
      const results = data.results || [];
      if (results.length) acShow(input, results, onPick);
      else if (acInput === input) acHide();
    }, 220);
  });
  input.addEventListener('keydown', (e) => {
    if (acMenu.hidden || acInput !== input) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); acActive = Math.min(acActive + 1, acItems.length - 1); acRender(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); acActive = Math.max(acActive - 1, 0); acRender(); }
    else if (e.key === 'Enter' && acActive >= 0) { e.preventDefault(); acChoose(acActive); }
    else if (e.key === 'Escape') { acHide(); }
    else if (e.key === 'Tab') { acHide(); }
  });
}

// Cerrar al clickear fuera del menú y del input activo. Usamos mousedown-afuera
// (no `blur`) para que interactuar con el propio menú —incluida su barra de
// scroll— NO lo cierre.
document.addEventListener('mousedown', (e) => {
  if (acMenu.hidden) return;
  if (acMenu.contains(e.target) || e.target === acInput) return;
  acHide();
});

// El menú es `fixed`. Si el scroll ocurre DENTRO del menú (rueda del mouse sobre
// la lista) no hay que hacer nada: se desliza solo. Si el scroll es externo
// (la página o el diálogo), reubicamos el menú bajo el input en vez de cerrarlo.
window.addEventListener('resize', () => { if (!acMenu.hidden) acPosition(); });
window.addEventListener('scroll', (e) => {
  if (acMenu.hidden || acMenu.contains(e.target)) return;
  acPosition();
}, true);

// Si se cierra cualquier diálogo, resetear el estado del autocompletado.
for (const d of document.querySelectorAll('dialog')) d.addEventListener('close', acHide);

// -------------------------------------------------------------------- eventos ---
$('#grid').addEventListener('click', (e) => {
  const q = e.target.closest('.q-act');
  if (q) { e.stopPropagation(); handleQuick(q); return; }
  const chip = e.target.closest('.chip[data-genre]');
  if (chip) {
    $('#fGenre').value = chip.dataset.genre;
    state.filters.genre = chip.dataset.genre;
    loadAnimes();
    return;
  }
  const card = e.target.closest('.card');
  if (card) openAnime(card.dataset.id);
});

// Acción rápida desde la card (sin abrir el detalle): avanzar un episodio de la
// temporada en foco, o sumar una vista si ya está completada.
async function handleQuick(btn) {
  const id = btn.dataset.season;
  btn.disabled = true;
  try {
    if (btn.dataset.act === 'ep') {
      const s = await api(`/seasons/${id}/episode`, { method: 'POST', body: { delta: 1 } });
      toast(s.status === 'completado' ? '¡Temporada completada! 🎉' : `Episodio ${s.watched_episodes} ✓`);
    } else {
      await api(`/seasons/${id}/watch`, { method: 'POST' });
      toast('¡Otra vista sumada! 👁');
    }
    await loadAnimes();
    loadStats();
  } catch (e) {
    toast(e.message, 'err');
    btn.disabled = false;
  }
}
$('#grid').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const card = e.target.closest('.card');
    if (card) openAnime(card.dataset.id);
  }
});

let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.filters.search = e.target.value.trim();
    loadAnimes();
  }, 250);
});
$('#fGenre').addEventListener('change', (e) => { state.filters.genre = e.target.value; loadAnimes(); });
$('#fStatus').addEventListener('change', (e) => { state.filters.status = e.target.value; loadAnimes(); });
$('#fSort').addEventListener('change', (e) => { state.filters.sort = e.target.value; loadAnimes(); });

// Cerrar el diálogo al hacer click en el backdrop.
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

// Nuevo anime
$('#btnNew').addEventListener('click', () => {
  $('#formNew').reset();
  $('#newLookup').textContent = '';
  $('#dlgNew').showModal();
});
// Al salir del campo Título, autocompletar portada, géneros y sinopsis.
$('#formNew [name="title"]').addEventListener('blur', async (e) => {
  const r = await runLookup(e.target.value, $('#formNew [name="cover_url"]'), $('#formNew [name="genres"]'), $('#newLookup'));
  const syn = $('#formNew [name="synopsis"]');
  if (r?.description && !syn.value.trim()) syn.value = r.description;
});
// Sugerencias mientras se escribe el título del anime nuevo.
attachAutocomplete($('#formNew [name="title"]'), (r) => {
  $('#formNew [name="title"]').value = r.romaji || r.english || '';
  if (r.cover_url) $('#formNew [name="cover_url"]').value = r.cover_url;
  if (r.genres?.length) $('#formNew [name="genres"]').value = r.genres.join(', ');
  $('#newLookup').replaceChildren(
    h('span', {}, `✓ ${r.romaji || 'seleccionado'}`),
    r.cover_url ? h('img', { class: 'lookup-thumb', src: r.cover_url, referrerpolicy: 'no-referrer', alt: '' }) : ''
  );
});
$('#formNew').addEventListener('submit', async (e) => {
  const btn = e.submitter;
  if (btn && btn.value === 'cancel') return;
  e.preventDefault();
  const fd = new FormData(e.target);
  const title = String(fd.get('title')).trim();
  if (!title) return;
  const genres = String(fd.get('genres') || '').split(',').map((x) => x.trim()).filter(Boolean);

  // Crear tarda unos segundos: además busca el franchise en AniList.
  const okBtn = e.target.querySelector('button[value="ok"]');
  const prevText = okBtn.textContent;
  okBtn.disabled = true;
  okBtn.textContent = 'Creando y buscando temporadas…';
  try {
    const created = await api('/animes', {
      method: 'POST',
      body: { title, genres, synopsis: fd.get('synopsis'), cover_url: fd.get('cover_url') },
    });
    $('#dlgNew').close();
    const n = created.seasons?.length || 0;
    toast(`Anime creado ✓ (${n} entrada${n === 1 ? '' : 's'} pendientes)`);
    await loadAnimes(); loadStats(); loadGenres();
    openAnime(created.id);
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    okBtn.disabled = false;
    okBtn.textContent = prevText;
  }
});

// ---------------------------------------------------------------------- init ---
loadStats();
loadGenres();
loadAnimes();
