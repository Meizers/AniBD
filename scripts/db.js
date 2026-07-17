// CLI para preparar la base:
//   node scripts/db.js schema   -> crea/reinicia el esquema
//   node scripts/db.js seed     -> importa "Anime ordenado.txt"
//   node scripts/db.js setup    -> schema + seed (default)
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from '../src/db.js';
import { seed } from '../src/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runSchema() {
  const sql = await readFile(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('✔ Esquema creado.');
}

async function check() {
  const { rows: [c] } = await pool.query(
    'SELECT COUNT(*)::int AS total, COUNT(cover_url)::int AS con_portada FROM anime'
  );
  console.log(`Animes: ${c.total} · con portada: ${c.con_portada} · sin portada: ${c.total - c.con_portada}`);
  const { rows } = await pool.query('SELECT title FROM anime WHERE cover_url IS NOT NULL LIMIT 3');
  for (const r of rows) console.log(`  ✓ ${r.title}`);
  if (c.total > 0 && c.con_portada === 0) {
    console.log('\n⚠ Ningún anime tiene portada: la base se sembró sin la metadata de AniList.');
    console.log('  Solución:  npm run setup   (reimporta con portadas y géneros)');
  }
}

const cmd = process.argv[2] || 'setup';
const valid = ['schema', 'seed', 'setup'];

try {
  if (cmd === 'check') {
    await check();
  } else if (valid.includes(cmd)) {
    if (cmd === 'schema' || cmd === 'setup') await runSchema();
    if (cmd === 'seed' || cmd === 'setup') await seed();
    console.log('Listo. 🌸');
  } else {
    console.log('Uso: node scripts/db.js [schema|seed|setup|check]');
  }
} catch (err) {
  console.error('✖ Error:', err.message);
  if (err.code === 'ECONNREFUSED' || /ECONNREFUSED|ENOTFOUND|password|connect/i.test(err.message)) {
    console.error('  ¿Está levantada la base? Revisá DATABASE_URL (ver README.md).');
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
