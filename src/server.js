import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, DB_MODE } from './db.js';
import api from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use('/api', api);
app.use(express.static(path.join(__dirname, '..', 'public')));

// Nada matcheó: evita que la request quede colgada.
app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Endpoint no encontrado.' });
  res.status(404).send('No encontrado');
});

// Traducción de errores de PostgreSQL / handlers a códigos HTTP.
app.use((err, req, res, _next) => {
  const byCode = { 23505: 409, 23514: 400, 23503: 400, '22P02': 400, ECONNREFUSED: 503 };
  const status = err.status || byCode[err.code] || 500;
  const messages = {
    23505: 'Ya existe un registro con esos datos (duplicado).',
    23514: 'Algún valor está fuera de rango (revisá el puntaje 0-10).',
    23503: 'Referencia inválida.',
    '22P02': 'Formato de dato inválido.',
    ECONNREFUSED: 'No hay conexión con PostgreSQL. ¿Está levantada la base? (ver README.md)',
  };
  if (status === 500) console.error(err);
  const msg = err.status ? err.message : messages[err.code] || err.message || 'Error interno.';
  res.status(status).json({ error: msg });
});

const port = process.env.PORT || 3000;

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log(DB_MODE === 'pglite' ? '✔ Base embebida lista (PGlite)' : '✔ Conectado a PostgreSQL');
  } catch (err) {
    console.error('\n✖ No pude conectar a la base de datos.');
    console.error('  ' + err.message);
    if (DB_MODE === 'postgres') {
      console.error('  Verificá DATABASE_URL y que la base esté levantada (ver README.md).\n');
    }
  }
  app.listen(port, () => {
    console.log(`\n  AniBD escuchando en  →  http://localhost:${port}\n`);
  });
}

start();
