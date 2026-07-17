-- Esquema de AniBD (PostgreSQL).
-- Re-ejecutable: borra y recrea todo. NO correr en una base con datos reales
-- salvo que quieras resetear.

DROP TABLE IF EXISTS anime_genre CASCADE;
DROP TABLE IF EXISTS season      CASCADE;
DROP TABLE IF EXISTS genre       CASCADE;
DROP TABLE IF EXISTS anime       CASCADE;
DROP VIEW  IF EXISTS anime_stats CASCADE;
DROP TYPE  IF EXISTS watch_status CASCADE;

-- Estado de visionado. Vive a nivel de TEMPORADA (podés tener la T1 completada
-- y la T2 pendiente).
CREATE TYPE watch_status AS ENUM (
  'pendiente', 'en_progreso', 'completado', 'en_pausa', 'abandonado'
);

-- Una "serie" completa (p.ej. Date A Live). Es el contenedor de temporadas.
CREATE TABLE anime (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  synopsis   TEXT,
  cover_url  TEXT,
  year       INTEGER,   -- año de estreno (autocompletado desde AniList)
  studio     TEXT,      -- estudio principal (autocompletado desde AniList)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Título único sin distinguir mayúsculas.
CREATE UNIQUE INDEX anime_title_key ON anime (lower(title));

-- Los géneros van a nivel de serie.
CREATE TABLE genre (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE UNIQUE INDEX genre_name_key ON genre (lower(name));

CREATE TABLE anime_genre (
  anime_id INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  genre_id INTEGER NOT NULL REFERENCES genre(id) ON DELETE CASCADE,
  PRIMARY KEY (anime_id, genre_id)
);

-- Cada temporada/película/OVA tiene su propia puntuación, notas, estado y
-- cantidad de veces vista, de forma INDEPENDIENTE.
CREATE TABLE season (
  id             SERIAL PRIMARY KEY,
  anime_id       INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  number         INTEGER NOT NULL DEFAULT 1,
  title          TEXT,
  cover_url      TEXT,                          -- portada propia de la temporada
  kind           TEXT NOT NULL DEFAULT 'tv',   -- tv | movie | ova
  status         watch_status NOT NULL DEFAULT 'pendiente',
  total_episodes INTEGER CHECK (total_episodes IS NULL OR total_episodes >= 0),
  watched_episodes INTEGER NOT NULL DEFAULT 0 CHECK (watched_episodes >= 0),  -- progreso
  duration       INTEGER,                      -- minutos por episodio (AniList)
  times_watched  INTEGER NOT NULL DEFAULT 0 CHECK (times_watched >= 0),
  score          NUMERIC(4,1) CHECK (score IS NULL OR (score >= 0 AND score <= 10)),
  notes          TEXT,
  started_at     DATE,
  finished_at    DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (anime_id, number)
);
CREATE INDEX season_anime_id_idx ON season (anime_id);
CREATE INDEX season_status_idx   ON season (status);

-- Mantiene updated_at al día.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER anime_touch  BEFORE UPDATE ON anime
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER season_touch BEFORE UPDATE ON season
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Normaliza texto para búsquedas que ignoran mayúsculas Y acentos, sin depender
-- de la extensión `unaccent` (que no siempre está disponible). IMMUTABLE.
CREATE OR REPLACE FUNCTION anibd_unaccent(t text) RETURNS text AS $fn$
  SELECT translate(lower(coalesce(t, '')),
    'áàäâãéèëêíìïîóòöôõúùûüñç',
    'aaaaaeeeeiiiiooooouuuunc')
$fn$ LANGUAGE sql IMMUTABLE;

-- Estadísticas agregadas por serie: acá vive el PROMEDIO general de cada anime
-- (promedio de las puntuaciones de sus temporadas puntuadas).
CREATE VIEW anime_stats AS
SELECT
  a.id                                             AS anime_id,
  COUNT(s.id)                                      AS season_count,
  COUNT(s.score)                                   AS rated_seasons,
  ROUND(AVG(s.score)::numeric, 2)                  AS avg_score,
  COALESCE(SUM(s.times_watched), 0)                AS total_watches,
  COUNT(*) FILTER (WHERE s.status = 'completado')  AS completed_count,
  COUNT(*) FILTER (WHERE s.status = 'en_progreso') AS watching_count,
  COUNT(*) FILTER (WHERE s.status = 'pendiente')   AS pending_count,
  -- Sólo temporadas TV cuentan como "temporadas"; pelis/OVAs van aparte.
  COUNT(*) FILTER (WHERE s.kind = 'tv')            AS tv_count,
  COUNT(*) FILTER (WHERE s.kind IN ('movie', 'ova')) AS extra_count
FROM anime a
LEFT JOIN season s ON s.anime_id = a.id
GROUP BY a.id;
