import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseLine, detectSeason, seriesKey, parseAnimeList } from '../src/parseAnimeList.js';

test('parseLine: extrae título, nota y puntaje', () => {
  const r = parseLine('Sono Bisque Doll wa Koi wo Suru (cosplayer) [9/10]');
  assert.equal(r.title, 'Sono Bisque Doll wa Koi wo Suru');
  assert.equal(r.note, 'cosplayer');
  assert.equal(r.score, 9);
});

test('parseLine: línea vacía -> null', () => {
  assert.equal(parseLine('   '), null);
});

test('parseLine: encabezado de sección', () => {
  assert.deepEqual(parseLine('MANHWA'), { sectionHeader: 'MANHWA' });
});

test('parseLine: soporta paréntesis anidados en la nota', () => {
  const r = parseLine('Dosanko Gal (conocio una gal en hojaio (no se como se escribe) )');
  assert.equal(r.title, 'Dosanko Gal');
  assert.match(r.note, /no se como se escribe/);
});

test('detectSeason: número árabe al final', () => {
  assert.deepEqual(detectSeason('date a live 2'), { base: 'date a live', sort: 2, type: 'tv' });
});

test('detectSeason: número romano', () => {
  const d = detectSeason('Date A Live IV');
  assert.equal(d.base, 'Date A Live');
  assert.equal(d.sort, 4);
});

test('detectSeason: película', () => {
  assert.equal(detectSeason('date a live pelicula').type, 'movie');
});

test('detectSeason: "2da temporada"', () => {
  assert.equal(detectSeason('Sono Bisque Doll wa Koi wo Suru 2da temporada').sort, 2);
});

test('detectSeason: no corta el "100" de Mob Psycho 100', () => {
  assert.equal(detectSeason('Mob Psycho 100').base, 'Mob Psycho 100');
});

test('integración: Date A Live se agrupa en 6 temporadas', async () => {
  const p = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'Anime ordenado.txt');
  const series = parseAnimeList(await readFile(p, 'utf8'));
  const dal = series.find((s) => seriesKey(s.title) === 'date a live');
  assert.ok(dal, 'debería existir la serie Date A Live');
  assert.equal(dal.seasons.length, 6);
});
