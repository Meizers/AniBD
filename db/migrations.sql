-- Migraciones NO destructivas: se corren en cada arranque (scripts/ensure-db.js)
-- sobre una base que YA tiene datos. Cada sentencia debe ser idempotente
-- (IF NOT EXISTS / IF EXISTS) para poder aplicarse muchas veces sin romper nada.

-- Portada propia por temporada (antes la portada vivía sólo a nivel serie).
ALTER TABLE season ADD COLUMN IF NOT EXISTS cover_url TEXT;

-- Sumar a la vista el conteo de temporadas TV vs pelis/OVAs. CREATE OR REPLACE
-- agrega las columnas nuevas al final (idempotente, no destructivo).
CREATE OR REPLACE VIEW anime_stats AS
SELECT
  a.id                                             AS anime_id,
  COUNT(s.id)                                      AS season_count,
  COUNT(s.score)                                   AS rated_seasons,
  ROUND(AVG(s.score)::numeric, 2)                  AS avg_score,
  COALESCE(SUM(s.times_watched), 0)                AS total_watches,
  COUNT(*) FILTER (WHERE s.status = 'completado')  AS completed_count,
  COUNT(*) FILTER (WHERE s.status = 'en_progreso') AS watching_count,
  COUNT(*) FILTER (WHERE s.status = 'pendiente')   AS pending_count,
  COUNT(*) FILTER (WHERE s.kind = 'tv')            AS tv_count,
  COUNT(*) FILTER (WHERE s.kind IN ('movie', 'ova')) AS extra_count
FROM anime a
LEFT JOIN season s ON s.anime_id = a.id
GROUP BY a.id;

-- Progreso por episodios y duración por episodio (para "+1 ep" y tiempo total).
ALTER TABLE season ADD COLUMN IF NOT EXISTS watched_episodes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE season ADD COLUMN IF NOT EXISTS duration INTEGER;

-- Metadata extra de la serie (autocompletada desde AniList al crear/editar).
ALTER TABLE anime ADD COLUMN IF NOT EXISTS year   INTEGER;
ALTER TABLE anime ADD COLUMN IF NOT EXISTS studio TEXT;

-- Búsqueda que ignora mayúsculas Y acentos, sin depender de la extensión
-- `unaccent`. IMMUTABLE, idempotente (CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION anibd_unaccent(t text) RETURNS text AS $fn$
  SELECT translate(lower(coalesce(t, '')),
    'áàäâãéèëêíìïîóòöôõúùûüñç',
    'aaaaaeeeeiiiiooooouuuunc')
$fn$ LANGUAGE sql IMMUTABLE;
