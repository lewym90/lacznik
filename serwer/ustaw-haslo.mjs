// Ustawia wspólne hasło Łącznika. Hasło czyta ze standardowego wejścia (nie trafia do historii poleceń).
// Użycie: printf '%s' "$HASLO" | LACZNIK_DANE=/var/lib/lacznik node ustaw-haslo.mjs [--wyloguj-wszystkie]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DANE = process.env.LACZNIK_DANE || './dane';
fs.mkdirSync(DANE, { recursive: true });
const haslo = fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '');
if (haslo.length < 4) { console.error('Hasło musi mieć co najmniej 4 znaki.'); process.exit(1); }
const db = new DatabaseSync(path.join(DANE, 'lacznik.db'));
db.exec('PRAGMA busy_timeout = 4000; CREATE TABLE IF NOT EXISTS ustawienia (klucz TEXT PRIMARY KEY, wartosc TEXT NOT NULL);');
const sol = crypto.randomBytes(16);
const h = crypto.scryptSync(haslo, sol, 64, { N: 16384, r: 8, p: 1 });
db.prepare("INSERT INTO ustawienia (klucz, wartosc) VALUES ('haslo', ?) ON CONFLICT(klucz) DO UPDATE SET wartosc = excluded.wartosc")
  .run(`scrypt$${sol.toString('base64')}$${h.toString('base64')}`);
if (process.argv.includes('--wyloguj-wszystkie')) {
  try { const n = db.prepare('DELETE FROM urzadzenia').run().changes; console.log(`Odłączono urządzeń: ${n}`); } catch { /* tabela jeszcze nie istnieje */ }
}
console.log('Hasło ustawione.');
