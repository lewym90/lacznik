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
import { DatabaseSync } from 'node:sqlite';

export const WERSJA = '1.0.0';
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
for (const d of [DANE, P_PLIKI, P_MINI, P_TMP]) fs.mkdirSync(d, { recursive: true });

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
function dlaKlienta(r, devId) {
  const o = {
    id: r.id, rodzaj: r.rodzaj, tekst: r.tekst, tytul: r.tytul, url: r.url, strona: r.strona,
    od: r.od, odNazwa: r.od_nazwa, odTyp: r.od_typ, do: r.do_id, utworzone: r.utworzone, wygasa: r.wygasa,
    przypiete: !!r.przypiete, odebrane: JSON.parse(r.odebrane || '{}'),
  };
  if (r.rodzaj === 'plik') {
    const k = podpis(r.id, devId);
    Object.assign(o, { nazwa: r.nazwa, mime: r.mime, rozmiar: r.rozmiar, szer: r.szer, wys: r.wys,
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
function nadajRzecz(r) { nadaj('rzecz', (dev) => (widoczna(r, dev) ? dlaKlienta(r, dev) : undefined)); }
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
function dodajRzecz(r) {
  db.prepare(`INSERT INTO rzeczy (id, rodzaj, tekst, tytul, url, strona, nazwa, mime, rozmiar, szer, wys, mini, od, od_nazwa, od_typ, do_id, utworzone, wygasa, przypiete, odebrane)
    VALUES (:id, :rodzaj, :tekst, :tytul, :url, :strona, :nazwa, :mime, :rozmiar, :szer, :wys, :mini, :od, :od_nazwa, :od_typ, :do_id, :utworzone, :wygasa, 0, '{}')`).run({
    tekst: null, tytul: null, url: null, strona: null, nazwa: null, mime: null, rozmiar: 0, szer: null, wys: null, mini: 0, ...r });
  const z = db.prepare('SELECT * FROM rzeczy WHERE id = ?').get(r.id);
  nadajRzecz(z); powiadom(z);
  if (r.rodzaj === 'plik') nadajMiejsce();
  return z;
}
function usunRzecz(r) {
  db.prepare('DELETE FROM rzeczy WHERE id = ?').run(r.id);
  if (r.rodzaj === 'plik') {
    fs.rm(path.join(P_PLIKI, r.id), { force: true }, () => {});
    fs.rm(path.join(P_MINI, r.id + '.jpg'), { force: true }, () => {});
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

// ---------- sprzątanie ----------
function sprzataj() {
  for (const r of db.prepare('SELECT * FROM rzeczy WHERE przypiete = 0 AND wygasa IS NOT NULL AND wygasa < ?').all(teraz())) usunRzecz(r);
  for (const w of db.prepare('SELECT * FROM wysylki WHERE utworzona < ?').all(teraz() - DNI)) {
    db.prepare('DELETE FROM wysylki WHERE id = ?').run(w.id); fs.rm(path.join(P_TMP, w.id), { force: true }, () => {});
  }
  // osierocone pliki (np. po awarii)
  const znane = new Set(db.prepare("SELECT id FROM rzeczy WHERE rodzaj = 'plik'").all().map((r) => r.id));
  for (const f of fs.readdirSync(P_PLIKI)) if (!znane.has(f)) fs.rm(path.join(P_PLIKI, f), { force: true }, () => {});
  for (const f of fs.readdirSync(P_MINI)) if (!znane.has(f.replace(/\.jpg$/, ''))) fs.rm(path.join(P_MINI, f), { force: true }, () => {});
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

  if (p === '/zdrowie' || p === '/') return send(200, { ok: true, wersja: WERSJA, haslo: !!ust('haslo'), urzadzenia: db.prepare('SELECT COUNT(*) AS n FROM urzadzenia').get().n });

  if (p === '/polacz' && req.method === 'POST') {
    const blok = zablokowany(ip);
    if (blok) return send(429, { blad: `Za dużo błędnych prób. Spróbuj za ${blok} min.` });
    const b = await czytajJSON(req);
    const zapis = ust('haslo');
    if (!zapis) return send(503, { blad: 'Hasło nie jest jeszcze ustawione na serwerze.' });
    if (!sprawdzHaslo(b.haslo, zapis)) { nieudana(ip); return send(401, { blad: 'Nieprawidłowe hasło.' }); }
    proby.delete(ip);
    const token = losowe(32);
    const nazwa = czystaNazwa(b.nazwa) || 'Urządzenie';
    const typ = TYPY.includes(b.typ) ? b.typ : 'inne';
    const t = teraz();
    const r = db.prepare('INSERT INTO urzadzenia (token, nazwa, typ, utworzone, ostatnio) VALUES (?, ?, ?, ?, ?)').run(sha(token), nazwa, typ, t, t);
    nadajUrzadzenia();
    return send(200, { token, id: Number(r.lastInsertRowid), nazwa, typ });
  }

  // pliki i miniatury: adres podpisany dla konkretnego urządzenia (działa w <img>/<video>)
  const mp = /^\/(plik|miniatura)\/([A-Za-z0-9_-]{6,20})$/.exec(p);
  if (mp && (req.method === 'GET' || req.method === 'HEAD')) {
    const devId = Number(u.searchParams.get('u'));
    const k = String(u.searchParams.get('k') || '');
    const ok = k.length === 32 && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(podpis(mp[2], devId).padEnd(32).slice(0, 32)));
    const dev = ok && db.prepare('SELECT id FROM urzadzenia WHERE id = ?').get(devId);
    const r = dev && db.prepare("SELECT * FROM rzeczy WHERE id = ? AND rodzaj = 'plik'").get(mp[2]);
    if (!r || !widoczna(r, devId)) return send(404, { blad: 'Nie ma takiego pliku.' });
    if (mp[1] === 'miniatura') return wyslijPlik(req, res, path.join(P_MINI, r.id + '.jpg'), 'image/jpeg', null, false, nag);
    return wyslijPlik(req, res, path.join(P_PLIKI, r.id), r.mime, r.nazwa, u.searchParams.get('pobierz') === '1', nag);
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
    const rzeczy = db.prepare('SELECT * FROM rzeczy ORDER BY utworzone DESC').all().filter((r) => widoczna(r, dev.id)).map((r) => dlaKlienta(r, dev.id));
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
        db.prepare('UPDATE rzeczy SET przypiete = ?, wygasa = ? WHERE id = ?').run(b.przypiete ? 1 : 0, wyg, r.id);
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
    db.prepare('INSERT INTO wysylki (id, nazwa, mime, rozmiar, od, do_id, utworzona) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, nazwa, mime, rozmiar, dev.id, adresDo(dev, b.do), teraz());
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
      fs.renameSync(tmp, path.join(P_PLIKI, id));
      db.prepare('DELETE FROM wysylki WHERE id = ?').run(w.id);
      const t = teraz();
      const r = dodajRzecz({ id, rodzaj: 'plik', nazwa: w.nazwa, mime: w.mime, rozmiar: w.rozmiar,
        szer: Number.isFinite(+b.szer) ? Math.round(+b.szer) : null, wys: Number.isFinite(+b.wys) ? Math.round(+b.wys) : null, mini,
        od: dev.id, od_nazwa: dev.nazwa, od_typ: dev.typ, do_id: w.do_id, utworzone: t, wygasa: t + ZYCIE });
      return send(200, dlaKlienta(r, dev.id));
    }
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
    dodajRzecz({ id, rodzaj: 'plik', nazwa, mime, rozmiar: n, od: dev.id, od_nazwa: dev.nazwa, od_typ: dev.typ, do_id: adresDo(dev, u.searchParams.get('do')), utworzone: t, wygasa: t + ZYCIE });
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
