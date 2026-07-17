// Espera a que PostgreSQL acepte conexiones y crea el esquema + importa la lista
// SOLO si la base está vacía. Si ya hay datos, NO toca nada (no borra ni duplica).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool, DB_MODE } from '../src/db.js';
import { seed } from '../src/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function waitForDb(retries = 60) {
  // La base embebida (pglite) no "arranca de a poco": si falla, es un error
  // real y reintentar solo lo esconde — mejor mostrarlo de una.
  if (DB_MODE === 'pglite') return pool.query('SELECT 1');
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      if (i === 0) console.log('Esperando a que PostgreSQL esté listo…');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('PostgreSQL no respondió a tiempo.');
}

async function isInitialized() {
  // to_regclass devuelve NULL (sin error) si la tabla no existe.
  const { rows } = await pool.query("SELECT to_regclass('public.anime') IS NOT NULL AS ok");
  return rows[0].ok;
}

// Aplica migraciones idempotentes sobre una base ya creada, SIN borrar datos.
async function runMigrations() {
  const sql = await readFile(path.join(__dirname, '..', 'db', 'migrations.sql'), 'utf8');
  await pool.query(sql);
}

try {
  await waitForDb();
  if (await isInitialized()) {
    await runMigrations();
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM anime');
    console.log(`✔ Base lista (${rows[0].n} animes). No toco los datos.`);
  } else {
    console.log('Base nueva: creando esquema…');
    const sql = await readFile(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await pool.query(sql);
    try {
      await seed();
    } catch (err) {
      // Sin "Anime ordenado.txt" no hay nada que importar: la base queda vacía
      // y los animes se cargan desde la web (instalaciones de otras personas).
      if (err.code !== 'ENOENT') throw err;
      console.log('✔ Base vacía lista (no hay lista para importar). Cargá tus animes desde la página.');
    }
  }
} catch (err) {
  console.error('✖', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
