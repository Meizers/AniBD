import os from 'node:os';
import path from 'node:path';

// Dos modos de base de datos, misma interfaz (pool.query / tx / query):
//  - postgres (default): pg Pool contra DATABASE_URL (o el contenedor Docker local).
//  - pglite (ANIBD_DB=pglite): PostgreSQL embebido (WASM) dentro del proceso, sin
//    Docker ni servidor; los datos viven en una carpeta local. Es el modo que usa
//    scripts/launch.js / AniBD.bat (instalación "portable" para Windows y amigos).
// ANIBD_DB=pglite tiene prioridad sobre DATABASE_URL.
export const DB_MODE = process.env.ANIBD_DB === 'pglite' ? 'pglite' : 'postgres';

// Carpeta de datos del modo pglite. Separada del proyecto a propósito: así se
// puede borrar/reemplazar la carpeta de la app sin perder la base.
export function pgliteDataDir() {
  if (process.env.ANIBD_DATA_DIR) return process.env.ANIBD_DATA_DIR;
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'AniBD', 'pgdata');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'AniBD', 'pgdata');
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'anibd', 'pgdata');
}

let pool;
let tx;

if (DB_MODE === 'postgres') {
  const { default: pg } = await import('pg');

  pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL || 'postgres://anibd:anibd@localhost:5432/anibd',
  });

  // Ejecuta fn dentro de una transacción (commit/rollback automáticos).
  tx = async function tx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };
} else {
  const { PGlite } = await import('@electric-sql/pglite');
  const { mkdirSync } = await import('node:fs');
  // PGlite crea la carpeta final pero no las intermedias (mkdir no recursivo).
  const dataDir = pgliteDataDir();
  mkdirSync(dataDir, { recursive: true });
  const db = new PGlite(dataDir);

  // Devuelve resultados con la forma de pg ({ rows, rowCount }). PGlite reporta
  // los UPDATE/DELETE sin RETURNING en affectedRows, no en rows.
  const normalize = (res) => {
    const rows = res?.rows ?? [];
    return { rows, rowCount: rows.length > 0 ? rows.length : (res?.affectedRows ?? 0) };
  };

  // Sin parámetros va por exec(), que acepta varios statements (schema.sql,
  // migrations.sql); query() de PGlite es de statement único.
  const run = async (target, text, params) => {
    if (params && params.length) return normalize(await target.query(text, params));
    const results = await target.exec(text);
    return normalize(results[results.length - 1]);
  };

  pool = {
    query: (text, params) => run(db, text, params),
    end: () => db.close(),
  };

  tx = function tx(fn) {
    return db.transaction((t) => fn({ query: (text, params) => run(t, text, params) }));
  };
}

export { pool, tx };

export function query(text, params) {
  return pool.query(text, params);
}
