// Łącznik — serwer. Bez zewnętrznych bibliotek: node:http, node:sqlite, node:crypto.
// Jedno wspólne hasło, urządzenia połączone na stałe, rzeczy (notatki, linki, kody, pliki),
// wysyłanie plików w kawałkach z wznawianiem, zmiany na żywo (SSE), powiadomienia Web Push.
// Uruchomienie: PORT=18910 LACZNIK_DANE=/var/lib/lacznik node lacznik.mjs
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

export const WERSJA = '1.3.0';
const PORT = Number(process.env.PORT || 18910);
const DANE = process.env.LACZNIK_DANE || './dane';
const ORIGINS = (process.env.LACZNIK_ORIGINS || 'https://lewym90.github.io,http://localhost:8765,http://127.0.0.1:8765').split(',');
const GB = 1024 ** 3;
const LIMIT = Number(process.env.LACZNIK_LIMIT || 5 * GB);          // łącznie na wszystkie pliki
const MAX_PLIK = Number(process.env.LACZNIK_MAX_PLIK || 2 * GB);    // jeden plik
const MIN_WOLNE = Number(process.env.LACZNIK_MIN_WOLNE || 3 * GB);  // tyle zawsze zostaje wolnego na dysku serwera
const KAWALEK = 8 * 1024 * 1024;
const DNI = 86400e3;
const ZYCIE = 14 * DNI;   // zwykłe rzeczy
const ZYCIE_KOD = 3600e3; // kody
const MAX_JSON = 1024 * 1024;

const P_PLIKI = path.join(DANE, 'pliki');
const P_MINI = path.join(DANE, 'miniatury');
const P_TMP = path.join(DANE, 'wysylki');
const P_KONW = path.join(DANE, 'konwersje');
for (const d of [DANE, P_PLIKI, P_MINI, P_TMP, P_KONW]) fs.mkdirSync(d, { recursive: true });

export const db = new DatabaseSync(path.join(DANE, 'lacznik.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 4000;
  CREATE TABLE IF NOT EXISTS ustawienia (klucz TEXT PRIMARY KEY, wartosc TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS urzadzenia (
    id INTEGER PRIMARY KEY, token TEXT NOT NULL UNIQUE, nazwa TEXT NOT NULL, typ TEXT NOT NULL,
    utworzone INTEGER NOT NULL, ostatnio INTEGER NOT NULL, push TEXT);
  CREATE TABLE IF NOT EXISTS rzeczy (
    id TEXT PRIMARY KEY, rodzaj TEXT NOT NULL, tekst TEXT, tytul TEXT, url TEXT, strona TEXT,
    nazwa TEXT, mime TEXT, rozmiar INTEGER NOT NULL DEFAULT 0, szer INTEGER, wys INTEGER, mini INTEGER NOT NULL DEFAULT 0,
    od INTEGER, od_nazwa TEXT NOT NULL, od_typ TEXT, do_id INTEGER, utworzone INTEGER NOT NULL, wygasa INTEGER,
    przypiete INTEGER NOT NULL DEFAULT 0, odebrane TEXT NOT NULL DEFAULT '{}');
  CREATE INDEX IF NOT EXISTS rzeczy_czas ON rzeczy(utworzone);
  CREATE TABLE IF NOT EXISTS wysylki (
    id TEXT PRIMARY KEY, nazwa TEXT NOT NULL, mime TEXT NOT NULL, rozmiar INTEGER NOT NULL,
    od INTEGER NOT NULL, do_id INTEGER, utworzona INTEGER NOT NULL);
`);
// 1.1.0: foldery
for (const sql of ['ALTER TABLE rzeczy ADD COLUMN folder TEXT', 'ALTER TABLE rzeczy ADD COLUMN sciezka TEXT', 'ALTER TABLE rzeczy ADD COLUMN crc INTEGER',
  'ALTER TABLE rzeczy ADD COLUMN gotowy INTEGER NOT NULL DEFAULT 1', 'ALTER TABLE wysylki ADD COLUMN folder TEXT', 'ALTER TABLE wysylki ADD COLUMN sciezka TEXT', 'ALTER TABLE rzeczy ADD COLUMN kodek TEXT']) {
  try { db.exec(sql); } catch { /* kolumna już jest */ }
}
db.exec('CREATE INDEX IF NOT EXISTS rzeczy_folder ON rzeczy(folder)');
db.exec(`CREATE TABLE IF NOT EXISTS linki (id TEXT PRIMARY KEY, rzeczy TEXT NOT NULL, od INTEGER, utworzony INTEGER NOT NULL, wygasa INTEGER NOT NULL,
  jednorazowy INTEGER NOT NULL DEFAULT 0, haslo TEXT, uzyty INTEGER NOT NULL DEFAULT 0, pobrania INTEGER NOT NULL DEFAULT 0)`);
const MAX_FOLDER = 4_000_000_000; // ZIP bez rozszerzenia ZIP64

const teraz = () => Date.now();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const losowe = (n = 12) => crypto.randomBytes(n).toString('base64url');
const ust = (k) => db.prepare('SELECT wartosc FROM ustawienia WHERE klucz = ?').get(k)?.wartosc ?? null;
const ustaw = (k, v) => db.prepare('INSERT INTO ustawienia (klucz, wartosc) VALUES (?, ?) ON CONFLICT(klucz) DO UPDATE SET wartosc = excluded.wartosc').run(k, v);

// ---------- hasło (scrypt) ----------
export function hashHasla(haslo) {
  const sol = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(haslo), sol, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${sol.toString('base64')}$${h.toString('base64')}`;
}
function sprawdzHaslo(haslo, zapis) {
  const [alg, s, h] = String(zapis || '').split('$');
  if (alg !== 'scrypt' || !s || !h) return false;
  const oczek = Buffer.from(h, 'base64');
  const got = crypto.scryptSync(String(haslo), Buffer.from(s, 'base64'), oczek.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(oczek, got);
}

// sekret do podpisywania adresów plików (adres działa tylko dla połączonego urządzenia)
if (!ust('sekret')) ustaw('sekret', losowe(32));
const SEKRET = ust('sekret');
const podpis = (id, dev) => crypto.createHmac('sha256', SEKRET).update(`${id}|${dev}`).digest('base64url').slice(0, 32);

// ---------- Web Push (VAPID + aes128gcm, RFC 8291/8292) bez bibliotek ----------
if (!ust('vapid_priv')) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  ustaw('vapid_priv', privateKey.export({ format: 'pem', type: 'pkcs8' }));
  ustaw('vapid_pub', publicKey.export({ format: 'der', type: 'spki' }).subarray(-65).toString('base64url'));
}
const VAPID_PRIV = crypto.createPrivateKey(ust('vapid_priv'));
export const VAPID_PUB = ust('vapid_pub');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();

export function szyfrujPush(dane, p256dh, auth) {
  const ua = Buffer.from(p256dh, 'base64url');
  const sekretAuth = Buffer.from(auth, 'base64url');
  const ecdh = crypto.createECDH('prime256v1');
  const asPub = ecdh.generateKeys();
  const wspolny = ecdh.computeSecret(ua);
  const prkKey = hmac(sekretAuth, wspolny);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub, Buffer.from([1])]));
  const sol = crypto.randomBytes(16);
  const prk = hmac(sol, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const zaszyfr = Buffer.concat([c.update(Buffer.concat([Buffer.from(dane), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([sol, rs, Buffer.from([asPub.length]), asPub, zaszyfr]);
}
function jwtVapid(aud) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const tresc = `${b({ typ: 'JWT', alg: 'ES256' })}.${b({ aud, exp: Math.floor(teraz() / 1000) + 12 * 3600, sub: 'mailto:lacznik@localhost' })}`;
  const sig = crypto.sign('sha256', Buffer.from(tresc), { key: VAPID_PRIV, dsaEncoding: 'ieee-p1363' });
  return `${tresc}.${sig.toString('base64url')}`;
}
async function wyslijPush(dev, dane) {
  let sub; try { sub = JSON.parse(dev.push); } catch { return; }
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return;
  try {
    const u = new URL(sub.endpoint);
    if (u.protocol !== 'https:') return;
    const r = await fetch(sub.endpoint, {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `vapid t=${jwtVapid(u.origin)}, k=${VAPID_PUB}`, 'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' },
      body: szyfrujPush(JSON.stringify(dane), sub.keys.p256dh, sub.keys.auth),
    });
    if (r.status === 404 || r.status === 410) db.prepare('UPDATE urzadzenia SET push = NULL WHERE id = ?').run(dev.id);
  } catch { /* sieć — następnym razem */ }
}

// ---------- pomocnicze ----------
function ipKlienta(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return xf.length ? xf[xf.length - 1] : req.socket.remoteAddress || '?';
}
const proby = new Map();
const OKNO = 15 * 60e3, MAX_PROB = 8;
function zablokowany(ip) {
  const p = proby.get(ip); if (!p) return 0;
  if (teraz() - p.t > OKNO) { proby.delete(ip); return 0; }
  return p.n >= MAX_PROB ? Math.ceil((OKNO - (teraz() - p.t)) / 60e3) : 0;
}
function nieudana(ip) { const p = proby.get(ip); if (!p || teraz() - p.t > OKNO) proby.set(ip, { n: 1, t: teraz() }); else p.n++; }

function urzadzenieZTokenu(t) {
  if (!t) return null;
  const d = db.prepare('SELECT * FROM urzadzenia WHERE token = ?').get(sha(String(t)));
  if (d && teraz() - d.ostatnio > 60e3) { db.prepare('UPDATE urzadzenia SET ostatnio = ? WHERE id = ?').run(teraz(), d.id); d.ostatnio = teraz(); }
  return d || null;
}
const czystaNazwa = (s, dl = 40) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, dl);
const TYPY = ['iphone', 'ipad', 'android', 'tablet', 'windows', 'mac', 'linux', 'skrot', 'inne'];

function wolneNaDysku() { try { const s = fs.statfsSync(DANE); return s.bavail * s.bsize; } catch { return Infinity; } }
function uzyte() {
  const a = db.prepare("SELECT COALESCE(SUM(rozmiar),0) AS s FROM rzeczy WHERE rodzaj = 'plik'").get().s;
  const b = db.prepare('SELECT COALESCE(SUM(rozmiar),0) AS s FROM wysylki').get().s;
  return a + b;
}
function miejsce() {
  const u = uzyte(), wolne = wolneNaDysku();
  return { uzyte: u, limit: LIMIT, maxPlik: MAX_PLIK, przyjmuje: wolne > MIN_WOLNE && u < LIMIT };
}
function czyMiejsce(rozmiar) {
  if (rozmiar > MAX_PLIK) return `Plik jest za duży. Limit to ${Math.round(MAX_PLIK / GB)} GB.`;
  if (uzyte() + rozmiar > LIMIT) return `Brak miejsca w Łączniku (limit ${Math.round(LIMIT / GB)} GB). Usuń coś albo poczekaj, aż stare rzeczy znikną.`;
  if (wolneNaDysku() - rozmiar < MIN_WOLNE) return 'Na serwerze kończy się miejsce, więc Łącznik wstrzymał przyjmowanie plików, żeby nie zaszkodzić innym aplikacjom.';
  return null;
}

const widoczna = (r, devId) => r.do_id == null || r.do_id === devId || r.od === devId;
function aktywneLinki() {
  const m = new Map();
  for (const l of db.prepare('SELECT rzeczy FROM linki WHERE uzyty = 0 AND wygasa > ?').all(teraz())) for (const id of JSON.parse(l.rzeczy)) m.set(id, (m.get(id) || 0) + 1);
  return m;
}
function dlaKlienta(r, devId, linki = null) {
  const o = {
    id: r.id, rodzaj: r.rodzaj, tekst: r.tekst, tytul: r.tytul, url: r.url, strona: r.strona,
    od: r.od, odNazwa: r.od_nazwa, odTyp: r.od_typ, do: r.do_id, utworzone: r.utworzone, wygasa: r.wygasa,
    przypiete: !!r.przypiete, odebrane: JSON.parse(r.odebrane || '{}'), folder: r.folder || null, sciezka: r.sciezka || null,
    linki: r.folder ? 0 : (linki || aktywneLinki()).get(r.id) || 0,
  };
  if (r.rodzaj === 'folder') Object.assign(o, { nazwa: r.nazwa, rozmiar: r.rozmiar, gotowy: !!r.gotowy, zip: `/folder-zip/${r.id}?u=${devId}&k=${podpis(r.id, devId)}` });
  if (r.rodzaj === 'plik') {
    const k = podpis(r.id, devId);
    Object.assign(o, { nazwa: r.nazwa, mime: r.mime, rozmiar: r.rozmiar, szer: r.szer, wys: r.wys, kodek: r.kodek || null,
      plik: `/plik/${r.id}?u=${devId}&k=${k}`, miniatura: r.mini ? `/miniatura/${r.id}?u=${devId}&k=${k}` : null });
  }
  return o;
}
const listaUrzadzen = () => db.prepare('SELECT id, nazwa, typ, utworzone, ostatnio, push IS NOT NULL AS push FROM urzadzenia ORDER BY utworzone').all()
  .map((d) => ({ ...d, push: !!d.push, online: [...polaczenia].some((c) => c.dev === d.id) }));

// ---------- na żywo (SSE) ----------
const polaczenia = new Set(); // { res, dev }
const widoczne = new Map();   // dev -> czy aplikacja jest teraz na ekranie
function nadaj(zdarzenie, fn) {
  for (const c of polaczenia) {
    const dane = fn(c.dev);
    if (dane === undefined) continue;
    try { c.res.write(`event: ${zdarzenie}\ndata: ${JSON.stringify(dane)}\n\n`); } catch { /* zamknięte */ }
  }
}
const nadajUrzadzenia = () => nadaj('urzadzenia', () => listaUrzadzen());
const nadajMiejsce = () => { const m = miejsce(); nadaj('miejsce', () => m); };
function nadajRzecz(r) { const l = aktywneLinki(); nadaj('rzecz', (dev) => (widoczna(r, dev) ? dlaKlienta(r, dev, l) : undefined)); }
function nadajUsun(r) { nadaj('usun', (dev) => (widoczna(r, dev) ? { id: r.id } : undefined)); }
setInterval(() => {
  for (const c of polaczenia) {
    const jest = db.prepare('SELECT 1 FROM urzadzenia WHERE id = ?').get(c.dev);
    if (!jest) { try { c.res.write('event: wylogowano\ndata: {}\n\n'); c.res.end(); } catch {} polaczenia.delete(c); continue; }
    try { c.res.write(': ping\n\n'); } catch {}
  }
}, 25e3).unref();

function opisPush(r) {
  if (r.rodzaj === 'kod') return 'Nowy kod';
  if (r.rodzaj === 'folder') { const n = db.prepare('SELECT COUNT(*) AS n FROM rzeczy WHERE folder = ?').get(r.id).n; return `Folder: ${r.nazwa} (${n} ${n === 1 ? 'plik' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'pliki' : 'plików'})`; }
  if (r.rodzaj === 'link') return r.tytul || r.url;
  if (r.rodzaj === 'notatka') return (r.tekst || '').slice(0, 140);
  if (String(r.mime).startsWith('image/')) return `Zdjęcie: ${r.nazwa}`;
  if (String(r.mime).startsWith('video/')) return `Film: ${r.nazwa}`;
  return `Plik: ${r.nazwa}`;
}
function powiadom(r) {
  const naEkranie = new Set([...polaczenia].map((c) => c.dev).filter((d) => widoczne.get(d)));
  for (const d of db.prepare('SELECT * FROM urzadzenia WHERE push IS NOT NULL').all()) {
    if (d.id === r.od || !widoczna(r, d.id) || naEkranie.has(d.id)) continue;
    wyslijPush(d, { tytul: `Od: ${r.od_nazwa}`, tresc: opisPush(r), id: r.id, tag: r.id });
  }
}

// ---------- rozpoznawanie treści ----------
const RE_URL = /^(https?:\/\/[^\s]+)$/i;
export function rozpoznaj(tekst) {
  const t = String(tekst || '').trim();
  if (RE_URL.test(t) && t.length < 4000) return 'link';
  if (/^www\.[^\s]+\.[a-z]{2,}[^\s]*$/i.test(t)) return 'link';
  const bez = t.replace(/[\s-]/g, '');
  if (/^\d{4,10}$/.test(bez) && t.length <= 14) return 'kod';
  if (/^[A-Za-z0-9]{6,16}$/.test(t) && /\d/.test(t) && /[A-Za-z]/.test(t)) return 'kod';
  return 'notatka';
}

// tytuł strony dla linku — z ochroną przed adresami w sieci wewnętrznej
function prywatnyIP(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const l = ip.toLowerCase();
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('::ffff:') && prywatnyIP(l.slice(7));
}
const ENC = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const dekoduj = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENC[e.toLowerCase()] ?? m;
}).replace(/\s+/g, ' ').trim();
async function pobierzTytul(adres) {
  let url = adres;
  for (let i = 0; i < 4; i++) {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    const adresy = await dns.lookup(u.hostname, { all: true });
    if (!adresy.length || adresy.some((a) => prywatnyIP(a.address))) return null;
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Lacznik/1.0)', Accept: 'text/html', 'Accept-Language': 'pl,en;q=0.7' } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = new URL(r.headers.get('location'), url).href; continue; }
    if (!String(r.headers.get('content-type')).includes('html')) return null;
    const reader = r.body.getReader(); let html = '', n = 0;
    while (n < 400000) { const { value, done } = await reader.read(); if (done) break; n += value.length; html += Buffer.from(value).toString('utf8'); if (/<\/head>/i.test(html)) break; }
    reader.cancel().catch(() => {});
    const meta = (p) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']+)`, 'i'))?.[1]
      || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${p}["']`, 'i'))?.[1];
    const tytul = meta('og:title') || html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1];
    return tytul ? { tytul: dekoduj(tytul).slice(0, 200), strona: meta('og:site_name') ? dekoduj(meta('og:site_name')).slice(0, 80) : null } : null;
  }
  return null;
}

// ---------- rzeczy ----------
function dodajRzecz(r, { cicho = false } = {}) {
  db.prepare(`INSERT INTO rzeczy (id, rodzaj, tekst, tytul, url, strona, nazwa, mime, rozmiar, szer, wys, mini, od, od_nazwa, od_typ, do_id, utworzone, wygasa, przypiete, odebrane, folder, sciezka, crc, gotowy)
    VALUES (:id, :rodzaj, :tekst, :tytul, :url, :strona, :nazwa, :mime, :rozmiar, :szer, :wys, :mini, :od, :od_nazwa, :od_typ, :do_id, :utworzone, :wygasa, :przypiete, '{}', :folder, :sciezka, :crc, :gotowy)`).run({
    tekst: null, tytul: null, url: null, strona: null, nazwa: null, mime: null, rozmiar: 0, szer: null, wys: null, mini: 0, przypiete: 0, folder: null, sciezka: null, crc: null, gotowy: 1, ...r });
  const z = db.prepare('SELECT * FROM rzeczy WHERE id = ?').get(r.id);
  nadajRzecz(z); if (!cicho) powiadom(z);
  if (r.rodzaj === 'plik') nadajMiejsce();
  return z;
}
function usunRzecz(r) {
  if (r.rodzaj === 'folder') for (const d of db.prepare('SELECT * FROM rzeczy WHERE folder = ?').all(r.id)) usunRzecz(d);
  db.prepare('DELETE FROM rzeczy WHERE id = ?').run(r.id);
  if (r.rodzaj === 'plik') {
    fs.rm(path.join(P_PLIKI, r.id), { force: true }, () => {});
    fs.rm(path.join(P_MINI, r.id + '.jpg'), { force: true }, () => {});
    for (const e of ['jpg', 'mp4']) fs.rm(path.join(P_KONW, `${r.id}.${e}`), { force: true }, () => {});
  }
  nadajUsun(r);
  if (r.rodzaj === 'plik') nadajMiejsce();
}
function adresDo(dev, doId) {
  if (doId == null || doId === '' || doId === 'wszystkie') return null;
  const d = db.prepare('SELECT id FROM urzadzenia WHERE id = ?').get(Number(doId));
  return d ? d.id : null;
}
function nowaTekstowa(dev, body) {
  const tekst = String(body.tekst ?? '').replace(/\r\n/g, '\n');
  if (!tekst.trim()) throw Object.assign(new Error('Pusta wiadomość'), { kod: 400 });
  if (tekst.length > 100000) throw Object.assign(new Error('Tekst jest za długi (maks. 100 000 znaków).'), { kod: 413 });
  let rodzaj = ['notatka', 'link', 'kod'].includes(body.rodzaj) ? body.rodzaj : rozpoznaj(tekst);
  let url = null;
  if (rodzaj === 'link') {
    url = tekst.trim();
    if (/^www\./i.test(url)) url = 'https://' + url;
    try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) throw 0; url = u.href; } catch { rodzaj = 'notatka'; url = null; }
  }
  const t = teraz();
  const r = dodajRzecz({ id: losowe(9), rodzaj, tekst: rodzaj === 'link' ? null : tekst, url, od: dev.id, od_nazwa: dev.nazwa, od_typ: dev.typ,
    do_id: adresDo(dev, body.do), utworzone: t, wygasa: t + (rodzaj === 'kod' ? ZYCIE_KOD : ZYCIE) });
  if (rodzaj === 'link') {
    pobierzTytul(url).then((x) => {
      if (!x) return;
      db.prepare('UPDATE rzeczy SET tytul = ?, strona = ? WHERE id = ?').run(x.tytul, x.strona, r.id);
      const z = db.prepare('SELECT * FROM rzeczy WHERE id = ?').get(r.id); if (z) nadajRzecz(z);
    }).catch(() => {});
  }
  return r;
}

// rozpoznawanie rodzaju pliku po pierwszych bajtach (dla Skrótu iOS, który nie podaje nazwy)
export function rozpoznajPlik(buf) {
  const h = buf.subarray(0, 16), s = h.toString('latin1');
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return ['image/jpeg', 'jpg'];
  if (s.startsWith('\x89PNG')) return ['image/png', 'png'];
  if (s.startsWith('GIF8')) return ['image/gif', 'gif'];
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return ['image/webp', 'webp'];
  if (s.startsWith('%PDF')) return ['application/pdf', 'pdf'];
  if (s.slice(4, 8) === 'ftyp') {
    const b = s.slice(8, 12);
    if (/hei|mif1|msf1|hev/.test(b)) return ['image/heic', 'heic'];
    if (b === 'qt  ') return ['video/quicktime', 'mov'];
    return ['video/mp4', 'mp4'];
  }
  if (s.startsWith('PK\x03\x04')) return ['application/zip', 'zip'];
  return ['application/octet-stream', 'bin'];
}
const MIME_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', webm: 'video/webm', pdf: 'application/pdf', txt: 'text/plain', mp3: 'audio/mpeg', m4a: 'audio/mp4',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip: 'application/zip' };
const czystaNazwaPliku = (s) => czystaNazwa(String(s || '').replace(/[\\/:*?"|]/g, '_'), 160) || 'plik';

// ---------- foldery: ścieżki, CRC, ZIP ----------
function czystaSciezka(s, nazwa) {
  const cz = String(s || '').replace(/\\/g, '/').split('/').map((x) => x.trim()).filter((x) => x && x !== '.' && x !== '..')
    .map((x) => czystaNazwa(x.replace(/[\\/:*?"|]/g, '_'), 160)).filter(Boolean);
  const wynik = cz.join('/').slice(0, 500);
  return wynik || nazwa;
}
function crcPliku(plik) {
  return new Promise((ok, zle) => {
    let c = 0;
    fs.createReadStream(plik, { highWaterMark: 1024 * 1024 }).on('data', (d) => { c = zlib.crc32(d, c); }).on('end', () => ok(c >>> 0)).on('error', zle);
  });
}
function dosCzas(t) {
  const d = new Date(t);
  return { czas: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    data: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
// ---------- szyfrowanie ZIP ----------
// „zgodny” = klasyczne szyfrowanie ZIP (ZipCrypto), otwiera się w Eksploratorze Windows.
// „mocny” = AES-256 w formacie WinZip AE-2 (7-Zip, aplikacje do ZIP na telefonie).
const TAB_CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
class ZipCrypto {
  constructor(haslo) { this.k0 = 305419896; this.k1 = 591751049; this.k2 = 878082192; for (const b of Buffer.from(haslo, 'utf8')) this.akt(b); }
  akt(b) {
    this.k0 = TAB_CRC[(this.k0 ^ b) & 0xff] ^ (this.k0 >>> 8);
    this.k1 = (Math.imul((this.k1 + (this.k0 & 0xff)) | 0, 134775813) + 1) | 0;
    this.k2 = TAB_CRC[(this.k2 ^ (this.k1 >>> 24)) & 0xff] ^ (this.k2 >>> 8);
  }
  szyfruj(buf) {
    const out = Buffer.allocUnsafe(buf.length);
    let k0 = this.k0, k1 = this.k1, k2 = this.k2;
    for (let i = 0; i < buf.length; i++) {
      const t = (k2 | 2) & 0xffff, p = buf[i];
      out[i] = p ^ ((Math.imul(t, t ^ 1) >>> 8) & 0xff);
      k0 = TAB_CRC[(k0 ^ p) & 0xff] ^ (k0 >>> 8);
      k1 = (Math.imul((k1 + (k0 & 0xff)) | 0, 134775813) + 1) | 0;
      k2 = TAB_CRC[(k2 ^ (k1 >>> 24)) & 0xff] ^ (k2 >>> 8);
    }
    this.k0 = k0; this.k1 = k1; this.k2 = k2;
    return out;
  }
}
class ZipAES {
  constructor(haslo) {
    this.sol = crypto.randomBytes(16);
    const k = crypto.pbkdf2Sync(Buffer.from(haslo, 'utf8'), this.sol, 1000, 66, 'sha1');
    this.ecb = crypto.createCipheriv('aes-256-ecb', k.subarray(0, 32), null); this.ecb.setAutoPadding(false);
    this.mac = crypto.createHmac('sha1', k.subarray(32, 64));
    this.weryf = k.subarray(64, 66);
    this.licznik = 1n; this.reszta = Buffer.alloc(0);
  }
  strumien(n) { // n bajtów strumienia klucza (licznik little-endian od 1, jak w WinZip)
    const bloki = Math.ceil(n / 16), b = Buffer.alloc(bloki * 16);
    for (let i = 0; i < bloki; i++) b.writeBigUInt64LE(this.licznik++, i * 16);
    return this.ecb.update(b);
  }
  szyfruj(buf) {
    let ks = this.reszta;
    if (ks.length < buf.length) ks = Buffer.concat([ks, this.strumien(buf.length - ks.length)]);
    const out = Buffer.allocUnsafe(buf.length);
    for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ ks[i];
    this.reszta = ks.subarray(buf.length);
    this.mac.update(out);
    return out;
  }
}
const NAD_SZYFR = { brak: 0, zgodny: 12, mocny: 16 + 2 + 10 };

// ZIP bez kompresji (metoda „store”), znane CRC i rozmiary, nazwy w UTF-8, długość znana z góry.
// wpisy: [{ r, nazwa }]; tryb: 'brak' | 'zgodny' | 'mocny'
function wyslijZip(req, res, nazwaZip, wpisy, nag, tryb = 'brak', haslo = '') {
  const lista = wpisy.map((x) => ({ ...x, nb: Buffer.from(x.nazwa, 'utf8'), dc: dosCzas(x.r.utworzone) }));
  const dod = NAD_SZYFR[tryb], ext = tryb === 'mocny' ? 11 : 0;
  let dl = 22;
  for (const x of lista) dl += 30 + x.nb.length + ext + x.r.rozmiar + dod + 46 + x.nb.length + ext;
  res.writeHead(200, { ...nag, 'Content-Type': 'application/zip', 'Content-Length': dl, 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nazwaZip)}` });
  if (req.method === 'HEAD') return res.end();
  (async () => {
    let off = 0; const centralny = [];
    const pisz = (b) => new Promise((ok) => { if (res.write(b)) ok(); else res.once('drain', ok); });
    for (const x of lista) {
      const flagi = 0x0800 | (tryb !== 'brak' ? 1 : 0), metoda = tryb === 'mocny' ? 99 : 0, wersja = tryb === 'mocny' ? 51 : 20;
      const crc = tryb === 'mocny' ? 0 : x.r.crc >>> 0, wSkr = x.r.rozmiar + dod;
      const extra = Buffer.alloc(ext);
      if (ext) { extra.writeUInt16LE(0x9901, 0); extra.writeUInt16LE(7, 2); extra.writeUInt16LE(2, 4); extra.write('AE', 6, 'latin1'); extra.writeUInt8(3, 8); extra.writeUInt16LE(0, 9); }
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(wersja, 4); lh.writeUInt16LE(flagi, 6); lh.writeUInt16LE(metoda, 8);
      lh.writeUInt16LE(x.dc.czas, 10); lh.writeUInt16LE(x.dc.data, 12); lh.writeUInt32LE(crc, 14);
      lh.writeUInt32LE(wSkr, 18); lh.writeUInt32LE(x.r.rozmiar, 22); lh.writeUInt16LE(x.nb.length, 26); lh.writeUInt16LE(ext, 28);
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(wersja, 4); ch.writeUInt16LE(wersja, 6); ch.writeUInt16LE(flagi, 8); ch.writeUInt16LE(metoda, 10);
      ch.writeUInt16LE(x.dc.czas, 12); ch.writeUInt16LE(x.dc.data, 14); ch.writeUInt32LE(crc, 16);
      ch.writeUInt32LE(wSkr, 20); ch.writeUInt32LE(x.r.rozmiar, 24); ch.writeUInt16LE(x.nb.length, 28); ch.writeUInt16LE(ext, 30);
      ch.writeUInt32LE(off, 42);
      centralny.push(Buffer.concat([ch, x.nb, extra]));
      await pisz(Buffer.concat([lh, x.nb, extra]));
      let szyfr = null;
      if (tryb === 'zgodny') { szyfr = new ZipCrypto(haslo); const nag12 = crypto.randomBytes(12); nag12[11] = (x.r.crc >>> 24) & 0xff; await pisz(szyfr.szyfruj(nag12)); }
      if (tryb === 'mocny') { szyfr = new ZipAES(haslo); await pisz(Buffer.concat([szyfr.sol, szyfr.weryf])); }
      for await (const kaw of fs.createReadStream(path.join(P_PLIKI, x.r.id), { highWaterMark: 1024 * 1024 })) {
        if (res.destroyed) return;
        await pisz(szyfr ? szyfr.szyfruj(kaw) : kaw);
      }
      if (tryb === 'mocny') await pisz(szyfr.mac.digest().subarray(0, 10));
      off += 30 + x.nb.length + ext + wSkr;
    }
    const cd = Buffer.concat(centralny);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(lista.length, 8); end.writeUInt16LE(lista.length, 10);
    end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
    await pisz(cd); res.end(end);
  })().catch(() => { try { res.destroy(); } catch {} });
}
const wpisyFolderu = (f) => db.prepare('SELECT * FROM rzeczy WHERE folder = ? ORDER BY sciezka').all(f.id).map((r) => ({ r, nazwa: `${f.nazwa}/${r.sciezka || r.nazwa}` }));

// zlecenia zaszyfrowanego ZIP-a: hasło tylko w pamięci, najwyżej 10 minut
const zlecenia = new Map();
setInterval(() => { for (const [k, z] of zlecenia) if (z.wygasa < teraz()) zlecenia.delete(k); }, 60e3).unref();

// ---------- wersje zgodne: HEIC → JPG, film HEVC (iPhone) → MP4 H.264 ----------
const jestNarzedzie = (c) => { try { return spawnSync('sh', ['-c', `command -v ${c}`]).status === 0; } catch { return false; } };
const NARZ = { heif: jestNarzedzie('heif-convert'), ffmpeg: jestNarzedzie('ffmpeg'), ffprobe: jestNarzedzie('ffprobe') };
function sonda(plik) {
  return new Promise((ok) => {
    if (!NARZ.ffprobe) return ok(null);
    const p = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name:format=duration', '-of', 'json', plik]);
    let o = ''; const t = setTimeout(() => p.kill('SIGKILL'), 30e3);
    p.stdout.on('data', (d) => { o += d; });
    p.on('close', () => { clearTimeout(t); try { const j = JSON.parse(o); ok({ kodek: j.streams?.[0]?.codec_name || null, czas: Number(j.format?.duration) || 0 }); } catch { ok(null); } });
    p.on('error', () => { clearTimeout(t); ok(null); });
  });
}
async function wykryjKodek(r) {
  if (!r || !/^video\//.test(r.mime || '')) return;
  const s = await sonda(path.join(P_PLIKI, r.id));
  if (!s?.kodek) return;
  db.prepare('UPDATE rzeczy SET kodek = ? WHERE id = ?').run(s.kodek, r.id);
  const z = db.prepare('SELECT * FROM rzeczy WHERE id = ?').get(r.id); if (z) nadajRzecz(z);
}
const celKonw = (r) => (/^image\/hei[cf]$/.test(r.mime || '') ? 'jpg' : /^video\//.test(r.mime || '') ? 'mp4' : null);
const plikKonw = (r, e) => path.join(P_KONW, `${r.id}.${e}`);
const nazwaKonw = (r, e) => r.nazwa.replace(/\.[^.]+$/, '') + '.' + e;
const KONW = new Map();
const kolejkaKonw = { jpg: [], mp4: [] }; const pracuje = { jpg: 0, mp4: 0 }; const ILE = { jpg: 2, mp4: 1 };
function stanKonw(r) {
  const e = celKonw(r);
  if (!e) return { stan: 'niepotrzebna' };
  if (e === 'mp4' && r.kodek && r.kodek !== 'hevc') return { stan: 'niepotrzebna' };
  if (fs.existsSync(plikKonw(r, e))) return { stan: 'gotowe', ext: e, nazwa: nazwaKonw(r, e) };
  return KONW.get(r.id) || { stan: 'brak' };
}
async function zlecKonw(r) {
  const e = celKonw(r);
  if (!e) return { stan: 'niepotrzebna' };
  if (e === 'mp4') {
    if (!NARZ.ffmpeg || !NARZ.ffprobe) return { stan: 'brak-narzedzi', blad: 'Na serwerze brakuje programu do przerabiania filmów.' };
    if (!r.kodek) { const s = await sonda(path.join(P_PLIKI, r.id)); if (s?.kodek) { r.kodek = s.kodek; db.prepare('UPDATE rzeczy SET kodek = ? WHERE id = ?').run(s.kodek, r.id); } }
  } else if (!NARZ.heif) return { stan: 'brak-narzedzi', blad: 'Na serwerze brakuje programu do przerabiania zdjęć HEIC.' };
  const s = stanKonw(r);
  if (s.stan !== 'brak' && s.stan !== 'blad') return s;
  if (wolneNaDysku() - r.rozmiar * 1.5 < MIN_WOLNE) return { stan: 'blad', blad: 'Za mało miejsca na serwerze, żeby przerobić ten plik.' };
  const k = { stan: 'czeka', postep: 0, ext: e };
  KONW.set(r.id, k); kolejkaKonw[e].push(r.id); pompujKonw();
  return k;
}
function pompujKonw() {
  for (const e of ['jpg', 'mp4']) while (pracuje[e] < ILE[e] && kolejkaKonw[e].length) {
    const id = kolejkaKonw[e].shift(); pracuje[e]++;
    wykonajKonw(id, e).finally(() => { pracuje[e]--; pompujKonw(); });
  }
}
async function wykonajKonw(id, e) {
  const r = db.prepare('SELECT * FROM rzeczy WHERE id = ?').get(id); const k = KONW.get(id);
  if (!r || !k) { KONW.delete(id); return; }
  k.stan = 'trwa';
  const wej = path.join(P_PLIKI, r.id), cel = plikKonw(r, e), tmp = path.join(P_KONW, `${r.id}.tmp.${e}`);
  let args;
  if (e === 'jpg') args = ['heif-convert', '-q', '90', wej, tmp];
  else {
    const s = await sonda(wej); k.czas = s?.czas || 0;
    args = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-y', '-i', wej, '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-vf', "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))'",
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-threads', '2', '-f', 'mp4', tmp];
  }
  await new Promise((ok) => {
    const p = spawn('nice', ['-n', '19', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    const limit = setTimeout(() => p.kill('SIGKILL'), 3 * 3600e3);
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.stdout.on('data', (d) => { const m = [...String(d).matchAll(/out_time_(?:us|ms)=(\d+)/g)].pop(); if (m && k.czas) k.postep = Math.min(0.99, Number(m[1]) / 1e6 / k.czas); });
    p.on('close', (kod) => {
      clearTimeout(limit);
      let ok2 = false; try { ok2 = kod === 0 && fs.statSync(tmp).size > 0; } catch {}
      if (ok2 && db.prepare('SELECT 1 FROM rzeczy WHERE id = ?').get(id)) { fs.renameSync(tmp, cel); KONW.delete(id); }
      else { fs.rm(tmp, { force: true }, () => {}); k.stan = 'blad'; k.blad = 'Nie udało się przerobić tego pliku.'; if (kod) console.error('konwersja', id, err.slice(-300)); setTimeout(() => KONW.delete(id), 10 * 60e3); }
      ok();
    });
    p.on('error', () => { clearTimeout(limit); k.stan = 'blad'; k.blad = 'Brak programu do przerabiania.'; ok(); });
  });
}
function opisKonw(r, s, adres) { return { ...s, mime: s.ext === 'jpg' ? 'image/jpeg' : s.ext === 'mp4' ? 'video/mp4' : undefined, nazwa: s.ext ? nazwaKonw(r, s.ext) : undefined, url: s.stan === 'gotowe' ? adres : undefined }; }

// ---------- linki dla osób spoza domu ----------
const linkAktywny = (id) => { const l = db.prepare('SELECT * FROM linki WHERE id = ?').get(id); return l && !l.uzyty && l.wygasa > teraz() ? l : null; };
const tokenLinku = (l, exp) => `${exp}.${crypto.createHmac('sha256', SEKRET).update(`link|${l.id}|${exp}`).digest('base64url').slice(0, 32)}`;
function dostepDoLinku(l, t) {
  if (!l.haslo) return true;
  t = String(t || ''); const exp = Number(t.split('.')[0]);
  if (!exp || exp < teraz()) return false;
  const wz = tokenLinku(l, exp);
  return wz.length === t.length && crypto.timingSafeEqual(Buffer.from(wz), Buffer.from(t));
}
function plikiLinku(l) {
  const out = [];
  for (const id of JSON.parse(l.rzeczy)) {
    const r = db.prepare('SELECT * FROM rzeczy WHERE id = ?').get(id);
    if (!r) continue;
    if (r.rodzaj === 'folder') out.push(...wpisyFolderu(r)); else if (r.rodzaj === 'plik') out.push({ r, nazwa: r.nazwa });
  }
  return out;
}
async function uzupelnijCrc(wpisy) {
  for (const w of wpisy) if (w.r.crc == null) { w.r.crc = await crcPliku(path.join(P_PLIKI, w.r.id)); db.prepare('UPDATE rzeczy SET crc = ? WHERE id = ?').run(w.r.crc, w.r.id); }
  const zajete = new Set();
  for (const w of wpisy) { let n = w.nazwa, i = 2; while (zajete.has(n)) n = w.nazwa.replace(/(\.[^./]+)?$/, ` (${i++})$1`); zajete.add(n); w.nazwa = n; }
  return wpisy;
}
function zuzyjPoPobraniu(l, res) {
  res.on('finish', () => {
    if (res.statusCode !== 200) return;
    db.prepare('UPDATE linki SET pobrania = pobrania + 1, uzyty = CASE WHEN jednorazowy = 1 THEN 1 ELSE uzyty END WHERE id = ?').run(l.id);
    if (l.jednorazowy) for (const id of JSON.parse(l.rzeczy)) { const z = db.prepare('SELECT * FROM rzeczy WHERE id = ?').get(id); if (z) nadajRzecz(z); }
  });
}

// ---------- dołączanie nowego urządzenia kodem (QR) ----------
const zaproszenia = new Map();
const ALF = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normKod = (k) => { const s = String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : ''; };
setInterval(() => { for (const [k, z] of zaproszenia) if (z.wygasa < teraz()) zaproszenia.delete(k); }, 60e3).unref();

// ---------- sprzątanie ----------
function sprzataj() {
  for (const r of db.prepare('SELECT * FROM rzeczy WHERE przypiete = 0 AND wygasa IS NOT NULL AND wygasa < ?').all(teraz())) usunRzecz(r);
  for (const r of db.prepare("SELECT * FROM rzeczy WHERE rodzaj = 'folder' AND gotowy = 0 AND utworzone < ?").all(teraz() - DNI)) usunRzecz(r);
  for (const r of db.prepare("SELECT * FROM rzeczy WHERE folder IS NOT NULL AND folder NOT IN (SELECT id FROM rzeczy WHERE rodzaj = 'folder')").all()) usunRzecz(r);
  for (const w of db.prepare('SELECT * FROM wysylki WHERE utworzona < ?').all(teraz() - DNI)) {
    db.prepare('DELETE FROM wysylki WHERE id = ?').run(w.id); fs.rm(path.join(P_TMP, w.id), { force: true }, () => {});
  }
  // osierocone pliki (np. po awarii)
  const znane = new Set(db.prepare("SELECT id FROM rzeczy WHERE rodzaj = 'plik'").all().map((r) => r.id));
  for (const f of fs.readdirSync(P_PLIKI)) if (!znane.has(f)) fs.rm(path.join(P_PLIKI, f), { force: true }, () => {});
  for (const f of fs.readdirSync(P_MINI)) if (!znane.has(f.replace(/\.jpg$/, ''))) fs.rm(path.join(P_MINI, f), { force: true }, () => {});
  for (const f of fs.readdirSync(P_KONW)) {
    const id = f.split('.')[0]; let st; try { st = fs.statSync(path.join(P_KONW, f)); } catch { continue; }
    if (!znane.has(id) || (f.includes('.tmp.') && !KONW.has(id) && teraz() - st.mtimeMs > DNI)) fs.rm(path.join(P_KONW, f), { force: true }, () => {});
  }
  db.prepare('DELETE FROM linki WHERE wygasa < ? OR uzyty = 1').run(teraz() - DNI);
  const wys = new Set(db.prepare('SELECT id FROM wysylki').all().map((w) => w.id));
  for (const f of fs.readdirSync(P_TMP)) if (!wys.has(f)) fs.rm(path.join(P_TMP, f), { force: true }, () => {});
}

// ---------- HTTP ----------
function cors(req) {
  const o = req.headers.origin;
  const h = { 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Nazwa', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range', Vary: 'Origin' };
  if (o && ORIGINS.includes(o)) h['Access-Control-Allow-Origin'] = o;
  return h;
}
function czytajJSON(req) {
  return new Promise((ok, zle) => {
    const k = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > MAX_JSON) { zle(Object.assign(new Error('Za duże'), { kod: 413 })); req.destroy(); } else k.push(c); });
    req.on('end', () => { try { ok(n ? JSON.parse(Buffer.concat(k).toString('utf8')) : {}); } catch { zle(Object.assign(new Error('Zły JSON'), { kod: 400 })); } });
    req.on('error', zle);
  });
}
function czytajSurowe(req, max) {
  return new Promise((ok, zle) => {
    const k = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > max) { zle(Object.assign(new Error('Za duży kawałek'), { kod: 413 })); req.destroy(); } else k.push(c); });
    req.on('end', () => ok(Buffer.concat(k)));
    req.on('error', zle);
  });
}

function wyslijPlik(req, res, plik, mime, nazwa, pobierz, naglowki) {
  let st; try { st = fs.statSync(plik); } catch { res.writeHead(404, naglowki); return res.end(); }
  const rozm = st.size;
  const h = { ...naglowki, 'Content-Type': mime || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox" };
  if (nazwa) h['Content-Disposition'] = `${pobierz ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(nazwa)}`;
  const zakres = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (zakres && (zakres[1] || zakres[2])) {
    let a = zakres[1] ? Number(zakres[1]) : rozm - Number(zakres[2]);
    let b = zakres[1] && zakres[2] ? Number(zakres[2]) : rozm - 1;
    a = Math.max(0, a); b = Math.min(b, rozm - 1);
    if (a > b) { res.writeHead(416, { ...h, 'Content-Range': `bytes */${rozm}` }); return res.end(); }
    res.writeHead(206, { ...h, 'Content-Range': `bytes ${a}-${b}/${rozm}`, 'Content-Length': b - a + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(plik, { start: a, end: b }).pipe(res);
  }
  res.writeHead(200, { ...h, 'Content-Length': rozm });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(plik).pipe(res);
}

async function obsluz(req, res) {
  const nag = cors(req);
  const send = (kod, obj) => { res.writeHead(kod, { ...nag, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'OPTIONS') { res.writeHead(204, nag); return res.end(); }
  const u = new URL(req.url, 'http://x');
  const p = u.pathname.replace(/\/+$/, '') || '/';
  const ip = ipKlienta(req);

  if (p === '/zdrowie' || p === '/') return send(200, { ok: true, wersja: WERSJA, haslo: !!ust('haslo'), narzedzia: NARZ, urzadzenia: db.prepare('SELECT COUNT(*) AS n FROM urzadzenia').get().n });

  if (p === '/polacz' && req.method === 'POST') {
    const blok = zablokowany(ip);
    if (blok) return send(429, { blad: `Za dużo błędnych prób. Spróbuj za ${blok} min.` });
    const b = await czytajJSON(req);
    const zapis = ust('haslo');
    if (b.kod) {
      const kod = normKod(b.kod), z = zaproszenia.get(kod);
      if (!z || z.wygasa < teraz()) { nieudana(ip); return send(401, { blad: 'Kod jest nieprawidłowy albo wygasł. Wygeneruj nowy na innym urządzeniu.' }); }
    } else {
      if (!zapis) return send(503, { blad: 'Hasło nie jest jeszcze ustawione na serwerze.' });
      if (!sprawdzHaslo(b.haslo, zapis)) { nieudana(ip); return send(401, { blad: 'Nieprawidłowe hasło.' }); }
    }
    proby.delete(ip);
    const token = losowe(32);
    const nazwa = czystaNazwa(b.nazwa) || 'Urządzenie';
    const typ = TYPY.includes(b.typ) ? b.typ : 'inne';
    const t = teraz();
    const r = db.prepare('INSERT INTO urzadzenia (token, nazwa, typ, utworzone, ostatnio) VALUES (?, ?, ?, ?, ?)').run(sha(token), nazwa, typ, t, t);
    nadajUrzadzenia();
    return send(200, { token, id: Number(r.lastInsertRowid), nazwa, typ });
  }

  // ----- publiczne linki (bez logowania) -----
  const ml = /^\/publiczne\/([A-Za-z0-9_-]{20,40})(?:\/(otworz|zip|plik|mini|konw|konwersja)(?:\/([A-Za-z0-9_-]{6,20}))?)?$/.exec(p);
  if (ml) {
    const l = linkAktywny(ml[1]);
    if (!l) return send(404, { blad: 'Ten link wygasł albo został już wykorzystany.' });
    const co = ml[2], fid = ml[3];
    if (co === 'otworz' && req.method === 'POST') {
      const klucz = `link:${l.id}:${ip}`, blok = zablokowany(klucz);
      if (blok) return send(429, { blad: `Za dużo błędnych prób. Spróbuj za ${blok} min.` });
      const b = await czytajJSON(req);
      if (l.haslo && !sprawdzHaslo(b.haslo, l.haslo)) { nieudana(klucz); return send(401, { blad: 'Nieprawidłowe hasło.' }); }
      proby.delete(klucz);
      return send(200, { t: l.haslo ? tokenLinku(l, teraz() + 2 * 3600e3) : '' });
    }
    const t = u.searchParams.get('t');
    if (!dostepDoLinku(l, t)) return send(co ? 403 : 200, co ? { blad: 'Najpierw wpisz hasło.' } : { haslo: true, wygasa: l.wygasa });
    const wpisy = plikiLinku(l);
    if (!wpisy.length) return send(404, { blad: 'Tych plików już nie ma.' });
    const top = JSON.parse(l.rzeczy).map((id) => db.prepare('SELECT * FROM rzeczy WHERE id = ?').get(id)).filter(Boolean);
    const nazwaZip = top.length === 1 && top[0].rodzaj === 'folder' ? top[0].nazwa : wpisy.length === 1 ? wpisy[0].r.nazwa.replace(/\.[^.]+$/, '') : 'Udostępnione pliki';
    if (!co && (req.method === 'GET' || req.method === 'HEAD')) {
      return send(200, { wygasa: l.wygasa, jednorazowy: !!l.jednorazowy, haslo: !!l.haslo, nazwa: nazwaZip, suma: wpisy.reduce((a, w) => a + w.r.rozmiar, 0),
        pliki: wpisy.map((w) => ({ id: w.r.id, nazwa: w.nazwa, rozmiar: w.r.rozmiar, mime: w.r.mime, mini: !!w.r.mini, kodek: w.r.kodek || null, konw: celKonw(w.r) })) });
    }
    if (co === 'zip' && (req.method === 'GET' || req.method === 'HEAD')) {
      if (req.method === 'GET') zuzyjPoPobraniu(l, res);
      return wyslijZip(req, res, nazwaZip + '.zip', await uzupelnijCrc(wpisy), nag);
    }
    const w = wpisy.find((x) => x.r.id === fid);
    if (!w) return send(404, { blad: 'Nie ma takiego pliku.' });
    if (co === 'mini') return wyslijPlik(req, res, path.join(P_MINI, w.r.id + '.jpg'), 'image/jpeg', null, false, nag);
    if (co === 'konwersja') return send(200, opisKonw(w.r, req.method === 'POST' ? await zlecKonw(w.r) : stanKonw(w.r), `/publiczne/${l.id}/konw/${w.r.id}`));
    if (co === 'plik' || co === 'konw') {
      const pobierz = u.searchParams.get('pobierz') === '1';
      if (l.jednorazowy && wpisy.length > 1) return send(403, { blad: 'Ten link pozwala pobrać tylko całość naraz.' });
      if (l.jednorazowy && !pobierz) return send(403, { blad: 'Ten link jest jednorazowy — można tylko pobrać plik.' });
      if (pobierz && req.method === 'GET' && !req.headers.range) zuzyjPoPobraniu(l, res);
      if (co === 'konw') {
        const s = stanKonw(w.r); if (s.stan !== 'gotowe') return send(409, { blad: 'Wersja zgodna nie jest jeszcze gotowa.' });
        return wyslijPlik(req, res, plikKonw(w.r, s.ext), s.ext === 'jpg' ? 'image/jpeg' : 'video/mp4', nazwaKonw(w.r, s.ext), pobierz, nag);
      }
      return wyslijPlik(req, res, path.join(P_PLIKI, w.r.id), w.r.mime, w.nazwa.split('/').pop(), pobierz, nag);
    }
    return send(405, { blad: 'Niedozwolone.' });
  }

  // pliki i miniatury: adres podpisany dla konkretnego urządzenia (działa w <img>/<video>)
  const mp = /^\/(plik|miniatura|konw)\/([A-Za-z0-9_-]{6,20})$/.exec(p);
  if (mp && (req.method === 'GET' || req.method === 'HEAD')) {
    const devId = Number(u.searchParams.get('u'));
    const k = String(u.searchParams.get('k') || '');
    const ok = k.length === 32 && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(podpis(mp[2], devId).padEnd(32).slice(0, 32)));
    const dev = ok && db.prepare('SELECT id FROM urzadzenia WHERE id = ?').get(devId);
    const r = dev && db.prepare("SELECT * FROM rzeczy WHERE id = ? AND rodzaj = 'plik'").get(mp[2]);
    if (!r || !widoczna(r, devId)) return send(404, { blad: 'Nie ma takiego pliku.' });
    if (mp[1] === 'miniatura') return wyslijPlik(req, res, path.join(P_MINI, r.id + '.jpg'), 'image/jpeg', null, false, nag);
    if (mp[1] === 'konw') {
      const s = stanKonw(r); if (s.stan !== 'gotowe') return send(409, { blad: 'Wersja zgodna nie jest jeszcze gotowa.' });
      return wyslijPlik(req, res, plikKonw(r, s.ext), s.ext === 'jpg' ? 'image/jpeg' : 'video/mp4', nazwaKonw(r, s.ext), u.searchParams.get('pobierz') === '1', nag);
    }
    return wyslijPlik(req, res, path.join(P_PLIKI, r.id), r.mime, r.nazwa, u.searchParams.get('pobierz') === '1', nag);
  }
  const mzs = /^\/zip-szyfrowany\/([A-Za-z0-9_-]{20,64})$/.exec(p);
  if (mzs && (req.method === 'GET' || req.method === 'HEAD')) {
    const z = zlecenia.get(mzs[1]);
    if (!z || z.wygasa < teraz() || !db.prepare('SELECT 1 FROM urzadzenia WHERE id = ?').get(z.dev)) return send(404, { blad: 'Link wygasł. Zaszyfruj jeszcze raz.' });
    const wpisy = [];
    for (const id of z.ids) {
      const r = db.prepare('SELECT * FROM rzeczy WHERE id = ?').get(id);
      if (!r || !widoczna(r, z.dev)) continue;
      if (r.rodzaj === 'folder') wpisy.push(...wpisyFolderu(r)); else if (r.rodzaj === 'plik') wpisy.push({ r, nazwa: r.nazwa });
    }
    if (!wpisy.length) return send(404, { blad: 'Tych plików już nie ma.' });
    return wyslijZip(req, res, z.nazwa, await uzupelnijCrc(wpisy), nag, z.tryb, z.haslo);
  }
  const mz = /^\/folder-zip\/([A-Za-z0-9_-]{6,20})$/.exec(p);
  if (mz && (req.method === 'GET' || req.method === 'HEAD')) {
    const devId = Number(u.searchParams.get('u'));
    const k = String(u.searchParams.get('k') || '');
    const ok = k.length === 32 && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(podpis(mz[1], devId)));
    const dev = ok && db.prepare('SELECT id FROM urzadzenia WHERE id = ?').get(devId);
    const f = dev && db.prepare("SELECT * FROM rzeczy WHERE id = ? AND rodzaj = 'folder'").get(mz[1]);
    if (!f || !widoczna(f, devId)) return send(404, { blad: 'Nie ma takiego folderu.' });
    return wyslijZip(req, res, f.nazwa + '.zip', await uzupelnijCrc(wpisyFolderu(f)), nag);
  }

  // na żywo — EventSource nie wysyła nagłówków, więc token w adresie
  if (p === '/na-zywo' && req.method === 'GET') {
    const dev = urzadzenieZTokenu(u.searchParams.get('t'));
    if (!dev) return send(401, { blad: 'Urządzenie nie jest połączone.' });
    res.writeHead(200, { ...nag, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    const c = { res, dev: dev.id };
    polaczenia.add(c);
    widoczne.set(dev.id, true);
    nadajUrzadzenia();
    req.on('close', () => { polaczenia.delete(c); if (![...polaczenia].some((x) => x.dev === dev.id)) widoczne.delete(dev.id); nadajUrzadzenia(); });
    return;
  }

  // wszystko dalej wymaga połączonego urządzenia
  const auth = String(req.headers.authorization || '');
  const dev = urzadzenieZTokenu(auth.startsWith('Bearer ') ? auth.slice(7) : null);
  if (!dev) return send(401, { blad: 'Urządzenie nie jest połączone.' });

  if (p === '/stan' && req.method === 'GET') {
    const l = aktywneLinki();
    const rzeczy = db.prepare('SELECT * FROM rzeczy ORDER BY utworzone DESC').all().filter((r) => widoczna(r, dev.id)).map((r) => dlaKlienta(r, dev.id, l));
    return send(200, { wersja: WERSJA, ja: { id: dev.id, nazwa: dev.nazwa, typ: dev.typ, push: !!dev.push }, urzadzenia: listaUrzadzen(), rzeczy, miejsce: miejsce(), vapid: VAPID_PUB });
  }

  if (p === '/obecnosc' && req.method === 'POST') {
    const b = await czytajJSON(req); widoczne.set(dev.id, !!b.widoczny); return send(200, { ok: true });
  }

  if (p === '/rzeczy' && req.method === 'POST') {
    const r = nowaTekstowa(dev, await czytajJSON(req));
    return send(200, dlaKlienta(r, dev.id));
  }
  const mr = /^\/rzeczy\/([A-Za-z0-9_-]{6,20})(\/odebrane)?$/.exec(p);
  if (mr) {
    const r = db.prepare('SELECT * FROM rzeczy WHERE id = ?').get(mr[1]);
    if (!r || !widoczna(r, dev.id)) return send(404, { blad: 'Tej rzeczy już nie ma.' });
    if (mr[2] && req.method === 'POST') {
      if (r.od === dev.id) return send(200, { ok: true });
      const o = JSON.parse(r.odebrane || '{}');
      if (!o[dev.id]) {
        o[dev.id] = teraz();
        db.prepare('UPDATE rzeczy SET odebrane = ? WHERE id = ?').run(JSON.stringify(o), r.id);
        nadajRzecz({ ...r, odebrane: JSON.stringify(o) });
      }
      return send(200, { ok: true });
    }
    if (req.method === 'PATCH') {
      const b = await czytajJSON(req);
      if (typeof b.przypiete === 'boolean') {
        const wyg = b.przypiete ? null : teraz() + (r.rodzaj === 'kod' ? ZYCIE_KOD : ZYCIE);
        db.prepare('UPDATE rzeczy SET przypiete = ?, wygasa = ? WHERE id = ? OR folder = ?').run(b.przypiete ? 1 : 0, wyg, r.id, r.id);
        if (r.rodzaj === 'folder') for (const d of db.prepare('SELECT * FROM rzeczy WHERE folder = ?').all(r.id)) nadajRzecz(d);
      }
      const z = db.prepare('SELECT * FROM rzeczy WHERE id = ?').get(r.id);
      nadajRzecz(z);
      return send(200, dlaKlienta(z, dev.id));
    }
    if (req.method === 'DELETE') { usunRzecz(r); return send(200, { ok: true }); }
  }

  // ----- wysyłanie plików w kawałkach -----
  if (p === '/wysylki' && req.method === 'POST') {
    const b = await czytajJSON(req);
    const rozmiar = Math.floor(Number(b.rozmiar));
    if (!(rozmiar > 0)) return send(400, { blad: 'Pusty plik.' });
    const brak = czyMiejsce(rozmiar);
    if (brak) return send(507, { blad: brak });
    const id = losowe(9);
    const nazwa = czystaNazwaPliku(b.nazwa);
    const ext = nazwa.split('.').pop().toLowerCase();
    const mime = /^[\w.+-]+\/[\w.+-]+$/.test(String(b.mime || '')) ? String(b.mime) : (MIME_EXT[ext] || 'application/octet-stream');
    let folder = null, sciezka = null;
    if (b.folder) {
      const f = db.prepare("SELECT * FROM rzeczy WHERE id = ? AND rodzaj = 'folder' AND od = ? AND gotowy = 0").get(String(b.folder), dev.id);
      if (!f) return send(404, { blad: 'Folder nie istnieje albo jest już zamknięty.' });
      folder = f.id; sciezka = czystaSciezka(b.sciezka, nazwa);
    }
    db.prepare('INSERT INTO wysylki (id, nazwa, mime, rozmiar, od, do_id, utworzona, folder, sciezka) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, nazwa, mime, rozmiar, dev.id, folder ? db.prepare('SELECT do_id FROM rzeczy WHERE id = ?').get(folder).do_id : adresDo(dev, b.do), teraz(), folder, sciezka);
    fs.writeFileSync(path.join(P_TMP, id), '');
    return send(200, { id, kawalek: KAWALEK, odebrano: 0 });
  }
  const mw = /^\/wysylki\/([A-Za-z0-9_-]{6,20})(\/koniec)?$/.exec(p);
  if (mw) {
    const w = db.prepare('SELECT * FROM wysylki WHERE id = ? AND od = ?').get(mw[1], dev.id);
    if (!w) return send(404, { blad: 'Nie ma takiej wysyłki (mogła wygasnąć po dobie).' });
    const tmp = path.join(P_TMP, w.id);
    const ile = () => { try { return fs.statSync(tmp).size; } catch { return 0; } };
    if (!mw[2] && req.method === 'GET') return send(200, { odebrano: ile() });
    if (!mw[2] && req.method === 'DELETE') { db.prepare('DELETE FROM wysylki WHERE id = ?').run(w.id); fs.rm(tmp, { force: true }, () => {}); return send(200, { ok: true }); }
    if (!mw[2] && req.method === 'PUT') {
      const od = Number(u.searchParams.get('od'));
      const teraz_ = ile();
      if (od !== teraz_) { req.resume(); return send(409, { odebrano: teraz_ }); }
      const buf = await czytajSurowe(req, KAWALEK + 1024);
      if (teraz_ + buf.length > w.rozmiar) return send(400, { blad: 'Plik jest większy niż zapowiedziano.' });
      if (wolneNaDysku() - buf.length < MIN_WOLNE) return send(507, { blad: 'Na serwerze kończy się miejsce, wysyłanie wstrzymane.' });
      await fsp.appendFile(tmp, buf);
      return send(200, { odebrano: teraz_ + buf.length });
    }
    if (mw[2] && req.method === 'POST') {
      const b = await czytajJSON(req);
      if (ile() !== w.rozmiar) return send(409, { odebrano: ile(), blad: 'Plik nie dotarł w całości.' });
      const id = losowe(9);
      let mini = 0;
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.miniatura || ''));
      if (m && m[1].length < 600000) { fs.writeFileSync(path.join(P_MINI, id + '.jpg'), Buffer.from(m[1], 'base64')); mini = 1; }
      const cel = path.join(P_PLIKI, id);
      fs.renameSync(tmp, cel);
      db.prepare('DELETE FROM wysylki WHERE id = ?').run(w.id);
      const t = teraz();
      const f = w.folder ? db.prepare('SELECT * FROM rzeczy WHERE id = ?').get(w.folder) : null;
      if (w.folder && !f) { fs.rm(cel, { force: true }, () => {}); return send(404, { blad: 'Folder został usunięty.' }); }
      const r = dodajRzecz({ id, rodzaj: 'plik', nazwa: w.nazwa, mime: w.mime, rozmiar: w.rozmiar,
        szer: Number.isFinite(+b.szer) ? Math.round(+b.szer) : null, wys: Number.isFinite(+b.wys) ? Math.round(+b.wys) : null, mini,
        od: dev.id, od_nazwa: dev.nazwa, od_typ: dev.typ, do_id: w.do_id, utworzone: t, wygasa: f ? f.wygasa : t + ZYCIE, przypiete: f ? f.przypiete : 0,
        folder: f ? f.id : null, sciezka: f ? w.sciezka : null, crc: await crcPliku(cel) }, { cicho: !!f });
      wykryjKodek(r).catch(() => {});
      return send(200, dlaKlienta(r, dev.id));
    }
  }

  // ----- wersja zgodna (JPG/MP4) -----
  const mk = /^\/konwersja\/([A-Za-z0-9_-]{6,20})$/.exec(p);
  if (mk) {
    const r = db.prepare("SELECT * FROM rzeczy WHERE id = ? AND rodzaj = 'plik'").get(mk[1]);
    if (!r || !widoczna(r, dev.id)) return send(404, { blad: 'Nie ma takiego pliku.' });
    const s = req.method === 'POST' ? await zlecKonw(r) : stanKonw(r);
    return send(200, opisKonw(r, s, `/konw/${r.id}?u=${dev.id}&k=${podpis(r.id, dev.id)}`));
  }

  // ----- linki dla innych -----
  if (p === '/linki' && req.method === 'POST') {
    const b = await czytajJSON(req);
    const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(String))].slice(0, 500);
    const rz = ids.map((id) => db.prepare('SELECT * FROM rzeczy WHERE id = ?').get(id)).filter((r) => r && widoczna(r, dev.id) && !r.folder && (r.rodzaj === 'plik' || (r.rodzaj === 'folder' && r.gotowy)));
    if (!rz.length) return send(404, { blad: 'Nie ma czego udostępnić.' });
    const godz = [1, 24, 168].includes(Number(b.godziny)) ? Number(b.godziny) : 24;
    let haslo = null;
    if (b.haslo) { if (String(b.haslo).length < 4) return send(400, { blad: 'Hasło musi mieć co najmniej 4 znaki.' }); haslo = hashHasla(String(b.haslo)); }
    const id = losowe(18), t = teraz();
    db.prepare('INSERT INTO linki (id, rzeczy, od, utworzony, wygasa, jednorazowy, haslo) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, JSON.stringify(rz.map((r) => r.id)), dev.id, t, t + godz * 3600e3, b.jednorazowy ? 1 : 0, haslo);
    for (const r of rz) nadajRzecz(r);
    return send(200, { id, wygasa: t + godz * 3600e3, jednorazowy: !!b.jednorazowy, haslo: !!haslo });
  }
  if (p === '/linki' && req.method === 'GET') {
    const rid = String(u.searchParams.get('rzecz') || '');
    const lista = db.prepare('SELECT * FROM linki WHERE uzyty = 0 AND wygasa > ? ORDER BY utworzony DESC').all(teraz())
      .filter((l) => JSON.parse(l.rzeczy).includes(rid)).map((l) => ({ id: l.id, wygasa: l.wygasa, jednorazowy: !!l.jednorazowy, haslo: !!l.haslo, pobrania: l.pobrania }));
    return send(200, { linki: lista });
  }
  const mlk = /^\/linki\/([A-Za-z0-9_-]{20,40})$/.exec(p);
  if (mlk && req.method === 'DELETE') {
    const l = db.prepare('SELECT * FROM linki WHERE id = ?').get(mlk[1]);
    if (!l) return send(404, { blad: 'Nie ma takiego linku.' });
    db.prepare('DELETE FROM linki WHERE id = ?').run(l.id);
    for (const id of JSON.parse(l.rzeczy)) { const z = db.prepare('SELECT * FROM rzeczy WHERE id = ?').get(id); if (z) nadajRzecz(z); }
    return send(200, { ok: true });
  }

  // ----- kod do dołączenia nowego urządzenia -----
  if (p === '/zaproszenie' && req.method === 'POST') {
    let kod; do { const b = crypto.randomBytes(8); kod = normKod([...b].map((x) => ALF[x % 32]).join('')); } while (zaproszenia.has(kod));
    const wygasa = teraz() + 10 * 60e3;
    zaproszenia.set(kod, { wygasa, od: dev.id });
    return send(200, { kod, wygasa });
  }

  // ----- zaszyfrowany ZIP -----
  if (p === '/zip-szyfrowany' && req.method === 'POST') {
    const b = await czytajJSON(req);
    const haslo = String(b.haslo || '');
    if (haslo.length < 4 || haslo.length > 200) return send(400, { blad: 'Hasło musi mieć od 4 do 200 znaków.' });
    const tryb = b.tryb === 'zgodny' ? 'zgodny' : 'mocny';
    const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(String))].slice(0, 500);
    const rz = ids.map((id) => db.prepare('SELECT * FROM rzeczy WHERE id = ?').get(id)).filter((r) => r && widoczna(r, dev.id) && (r.rodzaj === 'plik' || (r.rodzaj === 'folder' && r.gotowy)));
    if (!rz.length) return send(404, { blad: 'Nie ma czego spakować.' });
    let suma = 0;
    for (const r of rz) suma += r.rodzaj === 'folder' ? db.prepare('SELECT COALESCE(SUM(rozmiar),0) AS s FROM rzeczy WHERE folder = ?').get(r.id).s : r.rozmiar;
    if (suma > MAX_FOLDER) return send(413, { blad: 'Za dużo naraz. Zaszyfrowany ZIP może mieć najwyżej 4 GB.' });
    const d = new Date(), z2 = (x) => String(x).padStart(2, '0');
    const baza = rz.length === 1 ? (rz[0].rodzaj === 'folder' ? rz[0].nazwa : rz[0].nazwa.replace(/\.[^.]+$/, '')) : `Łącznik ${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())}`;
    const id = losowe(24);
    zlecenia.set(id, { ids: rz.map((r) => r.id), haslo, tryb, dev: dev.id, nazwa: `${baza} (zaszyfrowany).zip`, wygasa: teraz() + 10 * 60e3 });
    return send(200, { url: `/zip-szyfrowany/${id}`, nazwa: `${baza} (zaszyfrowany).zip`, rozmiar: suma });
  }

  // ----- foldery -----
  if (p === '/foldery' && req.method === 'POST') {
    const b = await czytajJSON(req);
    const rozmiar = Math.floor(Number(b.rozmiar)), liczba = Math.floor(Number(b.liczba));
    if (!(rozmiar > 0) || !(liczba > 0)) return send(400, { blad: 'Pusty folder.' });
    if (liczba > 5000) return send(413, { blad: 'Za dużo plików w folderze (maks. 5000).' });
    if (rozmiar > MAX_FOLDER) return send(507, { blad: 'Folder jest za duży. Limit to 4 GB na jeden folder.' });
    const brak = czyMiejsce(Math.min(rozmiar, MAX_PLIK));
    if (brak || uzyte() + rozmiar > LIMIT) return send(507, { blad: brak || `Brak miejsca w Łączniku (limit ${Math.round(LIMIT / GB)} GB). Usuń coś albo poczekaj, aż stare rzeczy znikną.` });
    const t = teraz();
    const r = dodajRzecz({ id: losowe(9), rodzaj: 'folder', nazwa: czystaNazwaPliku(b.nazwa) || 'Folder', rozmiar, od: dev.id, od_nazwa: dev.nazwa, od_typ: dev.typ,
      do_id: adresDo(dev, b.do), utworzone: t, wygasa: t + ZYCIE, gotowy: 0 }, { cicho: true });
    return send(200, dlaKlienta(r, dev.id));
  }
  const mf = /^\/foldery\/([A-Za-z0-9_-]{6,20})\/koniec$/.exec(p);
  if (mf && req.method === 'POST') {
    const f = db.prepare("SELECT * FROM rzeczy WHERE id = ? AND rodzaj = 'folder' AND od = ?").get(mf[1], dev.id);
    if (!f) return send(404, { blad: 'Nie ma takiego folderu.' });
    const suma = db.prepare('SELECT COALESCE(SUM(rozmiar),0) AS s, COUNT(*) AS n FROM rzeczy WHERE folder = ?').get(f.id);
    if (!suma.n) { usunRzecz(f); return send(400, { blad: 'Żaden plik z folderu nie dotarł.' }); }
    db.prepare('UPDATE rzeczy SET gotowy = 1, rozmiar = ? WHERE id = ?').run(suma.s, f.id);
    const z = db.prepare('SELECT * FROM rzeczy WHERE id = ?').get(f.id);
    nadajRzecz(z); if (!f.gotowy) powiadom(z); nadajMiejsce();
    return send(200, dlaKlienta(z, dev.id));
  }

  // ----- Skrót iOS: surowe dane w treści żądania (plik albo tekst) -----
  if (p === '/udostepnij' && req.method === 'POST') {
    const typ = String(req.headers['content-type'] || '');
    const dl = Number(req.headers['content-length'] || 0);
    if (/^(text\/plain|application\/json)/.test(typ) && dl < MAX_JSON) {
      const surowe = (await czytajSurowe(req, MAX_JSON)).toString('utf8');
      let tekst = surowe;
      if (typ.startsWith('application/json')) { try { const j = JSON.parse(surowe); tekst = j.tekst ?? j.text ?? j.url ?? surowe; } catch {} }
      const r = nowaTekstowa(dev, { tekst, do: u.searchParams.get('do') });
      return send(200, { ok: true, id: r.id });
    }
    if (dl) { const brak = czyMiejsce(dl); if (brak) { req.resume(); return send(507, { blad: brak }); } }
    else if (!miejsce().przyjmuje) { req.resume(); return send(507, { blad: 'Brak miejsca.' }); }
    const id = losowe(9);
    const cel = path.join(P_PLIKI, id);
    const out = fs.createWriteStream(cel);
    let n = 0, pocz = null, przerwane = false;
    await new Promise((ok, zle) => {
      req.on('data', (c) => {
        if (!pocz) pocz = Buffer.from(c.subarray(0, 32));
        n += c.length;
        if (n > MAX_PLIK || (n % (64 * 1024 * 1024) < c.length && wolneNaDysku() < MIN_WOLNE)) { przerwane = true; req.destroy(); out.destroy(); return ok(); }
        if (!out.write(c)) { req.pause(); out.once('drain', () => req.resume()); }
      });
      req.on('end', () => out.end(ok));
      req.on('error', zle); out.on('error', zle);
    }).catch(() => { przerwane = true; });
    if (przerwane || !n) { fs.rm(cel, { force: true }, () => {}); return send(przerwane ? 507 : 400, { blad: przerwane ? 'Plik za duży albo brak miejsca.' : 'Nic nie dotarło.' }); }
    const [mimeS, extS] = rozpoznajPlik(pocz);
    let nazwa = czystaNazwaPliku(decodeURIComponent(String(req.headers['x-nazwa'] || u.searchParams.get('nazwa') || '')));
    if (nazwa === 'plik') {
      const d = new Date(); const z = (x) => String(x).padStart(2, '0');
      nazwa = `${mimeS.startsWith('image/') ? 'Zdjęcie' : mimeS.startsWith('video/') ? 'Film' : 'Plik'} ${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}.${z(d.getMinutes())}.${z(d.getSeconds())}`;
    }
    if (!/\.[a-z][a-z0-9]{1,4}$/i.test(nazwa)) nazwa += '.' + extS;
    const ext = nazwa.split('.').pop().toLowerCase();
    const mime = mimeS !== 'application/octet-stream' ? mimeS : (MIME_EXT[ext] || (/^[\w.+-]+\/[\w.+-]+$/.test(typ) ? typ : mimeS));
    const t = teraz();
    wykryjKodek(dodajRzecz({ id, rodzaj: 'plik', nazwa, mime, rozmiar: n, od: dev.id, od_nazwa: dev.nazwa, od_typ: dev.typ, do_id: adresDo(dev, u.searchParams.get('do')), utworzone: t, wygasa: t + ZYCIE })).catch(() => {});
    return send(200, { ok: true, id });
  }

  // ----- powiadomienia -----
  if (p === '/push' && req.method === 'POST') {
    const b = await czytajJSON(req);
    const s = b.subskrypcja;
    if (!s?.endpoint || !s.keys?.p256dh || !s.keys?.auth || !/^https:\/\//.test(s.endpoint)) return send(400, { blad: 'Zła subskrypcja.' });
    db.prepare('UPDATE urzadzenia SET push = ? WHERE id = ?').run(JSON.stringify({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }), dev.id);
    nadajUrzadzenia();
    return send(200, { ok: true });
  }
  if (p === '/push' && req.method === 'DELETE') { db.prepare('UPDATE urzadzenia SET push = NULL WHERE id = ?').run(dev.id); nadajUrzadzenia(); return send(200, { ok: true }); }
  if (p === '/push/test' && req.method === 'POST') {
    const d = db.prepare('SELECT * FROM urzadzenia WHERE id = ?').get(dev.id);
    if (!d.push) return send(400, { blad: 'Powiadomienia nie są włączone na tym urządzeniu.' });
    await wyslijPush(d, { tytul: 'Łącznik', tresc: 'Powiadomienia działają.', id: null, tag: 'test' });
    return send(200, { ok: true });
  }

  // ----- urządzenia -----
  if (p === '/klucz-skrotu' && req.method === 'POST') {
    // osobne „urządzenie” dla Skrótu iOS — można je odłączyć niezależnie od telefonu
    const b = await czytajJSON(req);
    const token = losowe(32), t = teraz();
    const nazwa = czystaNazwa(b.nazwa) || `${dev.nazwa} (Skrót)`;
    db.prepare('INSERT INTO urzadzenia (token, nazwa, typ, utworzone, ostatnio) VALUES (?, ?, ?, ?, ?)').run(sha(token), nazwa, 'skrot', t, t);
    nadajUrzadzenia();
    return send(200, { klucz: token, nazwa });
  }
  const mu = /^\/urzadzenia\/(\d+)$/.exec(p);
  if (mu) {
    const cel = db.prepare('SELECT * FROM urzadzenia WHERE id = ?').get(Number(mu[1]));
    if (!cel) return send(404, { blad: 'Nie ma takiego urządzenia.' });
    if (req.method === 'PATCH') {
      const b = await czytajJSON(req);
      const nazwa = czystaNazwa(b.nazwa);
      if (!nazwa) return send(400, { blad: 'Podaj nazwę.' });
      db.prepare('UPDATE urzadzenia SET nazwa = ? WHERE id = ?').run(nazwa, cel.id);
      db.prepare('UPDATE rzeczy SET od_nazwa = ? WHERE od = ?').run(nazwa, cel.id);
      nadajUrzadzenia();
      return send(200, { ok: true });
    }
    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM urzadzenia WHERE id = ?').run(cel.id);
      db.prepare('UPDATE rzeczy SET do_id = NULL WHERE do_id = ?').run(cel.id);
      for (const c of polaczenia) if (c.dev === cel.id) { try { c.res.write('event: wylogowano\ndata: {}\n\n'); c.res.end(); } catch {} polaczenia.delete(c); }
      nadajUrzadzenia();
      return send(200, { ok: true });
    }
  }

  return send(404, { blad: 'Nie ma takiego adresu.' });
}

export const serwer = http.createServer((req, res) => {
  obsluz(req, res).catch((e) => {
    if (res.headersSent) { try { res.end(); } catch {} return; }
    const kod = e.kod || 500;
    if (kod === 500) console.error(e);
    res.writeHead(kod, { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ blad: kod === 500 ? 'Błąd serwera.' : e.message }));
  });
});
serwer.requestTimeout = 0; // duże kawałki na wolnym łączu
serwer.headersTimeout = 60e3;

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  sprzataj();
  setInterval(sprzataj, 10 * 60e3).unref();
  serwer.listen(PORT, '127.0.0.1', () => console.log(`Łącznik ${WERSJA} na 127.0.0.1:${PORT}, dane: ${DANE}`));
}
export { sprzataj, ustaw };
