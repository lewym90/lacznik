// Testy serwera Łącznika: node test/serwer.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

const KAT = fs.mkdtempSync(path.join(os.tmpdir(), 'lacznik-'));
const PORT = 18000 + Math.floor(Math.random() * 900);
const API = `http://127.0.0.1:${PORT}`;
const SERWER = new URL('../serwer/lacznik.mjs', import.meta.url).pathname;
const env = { ...process.env, PORT, LACZNIK_DANE: KAT, LACZNIK_LIMIT: String(3 * 1024 * 1024), LACZNIK_MAX_PLIK: String(2 * 1024 * 1024), LACZNIK_MIN_WOLNE: '1' };

execFileSync('node', [new URL('../serwer/ustaw-haslo.mjs', import.meta.url).pathname], { input: 'Tajne Haslo 1', env });
const proc = spawn('node', ['--no-warnings', SERWER], { env, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok) => proc.stdout.once('data', ok));

const ok = (n) => console.log('  ✓', n);
async function j(sciezka, opt = {}, token) {
  const r = await fetch(API + sciezka, { ...opt, headers: { ...(opt.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opt.json ? { 'Content-Type': 'application/json' } : {}) },
    body: opt.json ? JSON.stringify(opt.json) : opt.body });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
  return { s: r.status, b, h: r.headers };
}

try {
  let r = await j('/zdrowie'); assert.equal(r.s, 200); assert.equal(r.b.haslo, true); ok('zdrowie');
  r = await j('/polacz', { method: 'POST', json: { haslo: 'zle', nazwa: 'X' } }); assert.equal(r.s, 401); ok('złe hasło odrzucone');
  r = await j('/stan', {}, 'nieistniejacy'); assert.equal(r.s, 401); ok('bez połączenia brak dostępu');
  const A = (await j('/polacz', { method: 'POST', json: { haslo: 'Tajne Haslo 1', nazwa: 'Mój iPhone', typ: 'iphone' } })).b;
  const B = (await j('/polacz', { method: 'POST', json: { haslo: 'Tajne Haslo 1', nazwa: 'Tablet', typ: 'android' } })).b;
  const C = (await j('/polacz', { method: 'POST', json: { haslo: 'Tajne Haslo 1', nazwa: 'Laptop', typ: 'windows' } })).b;
  assert.ok(A.token && B.token && C.token); ok('trzy urządzenia połączone');

  // SSE na tablecie
  const zdarzenia = [];
  const ac = new AbortController();
  fetch(`${API}/na-zywo?t=${B.token}`, { signal: ac.signal }).then(async (res) => {
    const rd = res.body.getReader(); let buf = '';
    for (;;) { const { value, done } = await rd.read(); if (done) break; buf += Buffer.from(value).toString();
      let i; while ((i = buf.indexOf('\n\n')) >= 0) { const blok = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /event: (\w+)/.exec(blok)?.[1]; const d = /data: (.*)/.exec(blok)?.[1]; if (ev) zdarzenia.push({ ev, d: JSON.parse(d) }); } }
  }).catch(() => {});
  await new Promise((s) => setTimeout(s, 200));

  r = await j('/rzeczy', { method: 'POST', json: { tekst: '482 913' } }, A.token); assert.equal(r.b.rodzaj, 'kod'); assert.ok(r.b.wygasa - r.b.utworzone <= 3600e3 + 5); ok('kod rozpoznany, znika po godzinie');
  r = await j('/rzeczy', { method: 'POST', json: { tekst: 'https://example.com/a?b=1' } }, A.token); assert.equal(r.b.rodzaj, 'link'); assert.equal(r.b.url, 'https://example.com/a?b=1'); ok('link rozpoznany');
  r = await j('/rzeczy', { method: 'POST', json: { tekst: 'Na sobotę: wino, sery' } }, A.token); assert.equal(r.b.rodzaj, 'notatka'); ok('notatka');
  r = await j('/rzeczy', { method: 'POST', json: { tekst: 'Tylko dla laptopa', do: C.id } }, A.token); const prywatna = r.b.id;
  await new Promise((s) => setTimeout(s, 150));
  assert.ok(zdarzenia.filter((z) => z.ev === 'rzecz').length >= 3, 'tablet dostaje zmiany na żywo');
  assert.ok(!zdarzenia.some((z) => z.ev === 'rzecz' && z.d.id === prywatna), 'tablet nie widzi rzeczy dla laptopa');
  ok('na żywo: tablet dostaje nowe rzeczy, nie widzi cudzych');
  let sB = (await j('/stan', {}, B.token)).b; let sC = (await j('/stan', {}, C.token)).b;
  assert.ok(!sB.rzeczy.some((x) => x.id === prywatna)); assert.ok(sC.rzeczy.some((x) => x.id === prywatna)); ok('wysyłka na jedno urządzenie');

  // wysyłanie pliku w kawałkach z wznowieniem
  const dane = crypto.randomBytes(1_500_000);
  r = await j('/wysylki', { method: 'POST', json: { nazwa: 'zdjecie.jpg', mime: 'image/jpeg', rozmiar: dane.length } }, A.token);
  const w = r.b; assert.ok(w.id);
  r = await j(`/wysylki/${w.id}?od=0`, { method: 'PUT', body: dane.subarray(0, 600_000) }, A.token); assert.equal(r.b.odebrano, 600_000);
  r = await j(`/wysylki/${w.id}?od=0`, { method: 'PUT', body: dane.subarray(0, 600_000) }, A.token); assert.equal(r.s, 409); assert.equal(r.b.odebrano, 600_000);
  r = await j(`/wysylki/${w.id}`, {}, A.token); assert.equal(r.b.odebrano, 600_000);
  r = await j(`/wysylki/${w.id}?od=600000`, { method: 'PUT', body: dane.subarray(600_000) }, A.token); assert.equal(r.b.odebrano, dane.length);
  const mini = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
  r = await j(`/wysylki/${w.id}/koniec`, { method: 'POST', json: { miniatura: mini, szer: 400, wys: 300 } }, A.token);
  const plik = r.b; assert.equal(plik.rodzaj, 'plik'); assert.ok(plik.miniatura); ok('plik wysłany w kawałkach, z wznowieniem');
  sB = (await j('/stan', {}, B.token)).b; const pB = sB.rzeczy.find((x) => x.id === plik.id);
  let f = await fetch(API + pB.plik); assert.equal(f.status, 200); assert.ok(Buffer.from(await f.arrayBuffer()).equals(dane));
  f = await fetch(API + pB.plik, { headers: { Range: 'bytes=100-199' } }); assert.equal(f.status, 206); assert.ok(Buffer.from(await f.arrayBuffer()).equals(dane.subarray(100, 200)));
  f = await fetch(API + pB.plik.replace(/k=[^&]+/, 'k=' + 'x'.repeat(32))); assert.equal(f.status, 404);
  f = await fetch(API + pB.miniatura); assert.equal(f.status, 200);
  ok('pobieranie pliku, zakresy (filmy), podpisane adresy');

  // limity
  r = await j('/wysylki', { method: 'POST', json: { nazwa: 'duzy.mp4', rozmiar: 2_500_000 } }, A.token); assert.equal(r.s, 507); ok('za duży plik odrzucony');
  r = await j('/wysylki', { method: 'POST', json: { nazwa: 'b.bin', rozmiar: 1_700_000 } }, A.token); assert.equal(r.s, 507); ok('limit miejsca pilnowany');

  // Skrót iOS: surowy JPEG bez nazwy
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(5000)]);
  r = await j('/udostepnij', { method: 'POST', body: jpg, headers: { 'Content-Type': 'application/octet-stream' } }, A.token);
  assert.equal(r.s, 200);
  sB = (await j('/stan', {}, B.token)).b; const zs = sB.rzeczy.find((x) => x.id === r.b.id);
  assert.equal(zs.mime, 'image/jpeg'); assert.match(zs.nazwa, /^Zdjęcie .*\.jpg$/); ok('Skrót iOS: zdjęcie bez nazwy rozpoznane');
  r = await j('/udostepnij', { method: 'POST', body: 'https://example.org', headers: { 'Content-Type': 'text/plain' } }, A.token);
  sB = (await j('/stan', {}, B.token)).b; assert.equal(sB.rzeczy.find((x) => x.id === r.b.id).rodzaj, 'link'); ok('Skrót iOS: link jako tekst');

  // odebrane, przypinanie, usuwanie
  await j(`/rzeczy/${plik.id}/odebrane`, { method: 'POST' }, B.token);
  let sA = (await j('/stan', {}, A.token)).b; assert.ok(sA.rzeczy.find((x) => x.id === plik.id).odebrane[B.id]); ok('„Odebrano” zapisane');
  r = await j(`/rzeczy/${plik.id}`, { method: 'PATCH', json: { przypiete: true } }, B.token); assert.equal(r.b.przypiete, true); assert.equal(r.b.wygasa, null); ok('przypięte zostaje na stałe');
  r = await j(`/rzeczy/${prywatna}`, { method: 'DELETE' }, B.token); assert.equal(r.s, 404); ok('nie można usunąć cudzej niewidocznej rzeczy');

  // urządzenia
  r = await j(`/urzadzenia/${C.id}`, { method: 'PATCH', json: { nazwa: 'Laptop Windows' } }, A.token); assert.equal(r.s, 200);
  r = await j(`/urzadzenia/${C.id}`, { method: 'DELETE' }, A.token); assert.equal(r.s, 200);
  r = await j('/stan', {}, C.token); assert.equal(r.s, 401); ok('zdalne odłączenie urządzenia');
  const k = (await j('/klucz-skrotu', { method: 'POST', json: {} }, A.token)).b; assert.ok(k.klucz); r = await j('/stan', {}, k.klucz); assert.equal(r.s, 200); ok('klucz do Skrótu');

  // blokada po 8 błędnych próbach
  for (let i = 0; i < 8; i++) await j('/polacz', { method: 'POST', json: { haslo: 'x' + i } });
  r = await j('/polacz', { method: 'POST', json: { haslo: 'Tajne Haslo 1' } }); assert.equal(r.s, 429); ok('blokada po 8 błędnych próbach');

  // CORS
  f = await fetch(API + '/stan', { method: 'OPTIONS', headers: { Origin: 'https://lewym90.github.io', 'Access-Control-Request-Method': 'GET' } });
  assert.equal(f.headers.get('access-control-allow-origin'), 'https://lewym90.github.io');
  f = await fetch(API + '/stan', { method: 'OPTIONS', headers: { Origin: 'https://zly.example' } }); assert.equal(f.headers.get('access-control-allow-origin'), null); ok('CORS tylko dla aplikacji');
  ac.abort();
} finally {
  proc.kill();
}

// Web Push: szyfrowanie zgodne z RFC 8291 — sprawdzenie niezależną biblioteką http_ece (tylko w testach)
process.env.LACZNIK_DANE = KAT;
const { szyfrujPush, VAPID_PUB } = await import('../serwer/lacznik.mjs');
let ece; try { ece = (await import('http_ece')).default; } catch {}
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const authS = crypto.randomBytes(16);
const zaszyfr = szyfrujPush('{"tresc":"Zażółć gęślą jaźń"}', ua.getPublicKey().toString('base64url'), authS.toString('base64url'));
if (ece) {
  const jawne = ece.decrypt(zaszyfr, { version: 'aes128gcm', privateKey: ua, authSecret: authS });
  assert.equal(jawne.toString(), '{"tresc":"Zażółć gęślą jaźń"}'); ok('Web Push: szyfrowanie potwierdzone biblioteką http_ece');
} else console.log('  (pominięto sprawdzenie http_ece — brak biblioteki)');
assert.equal(Buffer.from(VAPID_PUB, 'base64url').length, 65); ok('klucz VAPID poprawny');
fs.rmSync(KAT, { recursive: true, force: true });
console.log('WSZYSTKO OK');
process.exit(0);
