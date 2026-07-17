// AniBD "portable": todo-en-uno SIN Docker, usando PostgreSQL embebido (PGlite).
// Crea/actualiza la base si hace falta, levanta el server y abre el navegador.
// Cerrar la ventana (o Ctrl+C) apaga todo; los datos quedan en la carpeta de
// datos del sistema (ver pgliteDataDir en src/db.js). Lo usa AniBD.bat en
// Windows y sirve igual en Linux/Mac: `node scripts/launch.js`.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

process.env.ANIBD_DB ||= 'pglite';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 3000;
const URL = `http://localhost:${PORT}`;

let child;
const node = (args) => (child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' }));

// Salir con código 0 ante Ctrl+C / cierre de la ventana: sin esto, Node termina
// "por señal" en vez de con una salida limpia, y algunas terminales (p.ej.
// Konsole) dejan la ventana abierta "por si hay que leer un error".
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  child?.kill();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);

// 1) Esquema/migraciones (solo toca lo que falte; no borra datos).
await new Promise((resolve, reject) => {
  node(['scripts/ensure-db.js']).on('exit', (code) =>
    code === 0 ? resolve() : reject(new Error('No se pudo preparar la base de datos.')),
  );
});

// 2) Servidor web.
node(['--env-file-if-exists=.env', 'src/server.js']);
child.on('exit', (code) => { if (!shuttingDown) process.exit(code ?? 0); });

// 3) Abrir el navegador cuando el server responda.
for (let i = 0; i < 80; i++) {
  try {
    await fetch(URL);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
const open =
  process.platform === 'win32' ? ['cmd', ['/c', 'start', '', URL]]
  : process.platform === 'darwin' ? ['open', [URL]]
  : ['xdg-open', [URL]];
try {
  spawn(open[0], open[1], { stdio: 'ignore', detached: true }).unref();
} catch {
  // Sin navegador que abrir: la URL igual queda impresa por el server.
}

console.log('\nCerrá esta ventana (o Ctrl+C) para apagar AniBD. Tus datos quedan guardados.');
