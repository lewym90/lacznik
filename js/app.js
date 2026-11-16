// Łącznik — aplikacja. Bez bibliotek.
const WERSJA = '1.0.0';
const API = (localStorage.getItem('lacznik.api') || 'https://188-68-247-201.sslip.io/lacznik-api').replace(/\/+$/, '');
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');

// ---------- stan ----------
const S = {
  token: localStorage.getItem('lacznik.token'),
  ja: JSON.parse(localStorage.getItem('lacznik.ja') || 'null'),
  urzadzenia: [], rzeczy: [], miejsce: null, vapid: null,
  filtr: 'wszystko', szukaj: '', wybrana: null,
  do: localStorage.getItem('lacznik.do') || '',
  wymuszonyRodzaj: null, zalaczniki: [], wysylki: [],
  polaczony: false, nowe: new Set(), zaladowano: false,
};
const odebraneWyslane = new Set();
const bloby = new Map();
let zrodlo = null;

// ---------- ikony ----------
const SCIEZKI = {
  kod: '<rect x="3" y="7" width="18" height="10" rx="2.5"/><path d="M7.5 12h.01M12 12h.01M16.5 12h.01"/>',
  foto: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  notatka: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 10h7M9 14h7M9 18h4"/>',
  plik: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', wyslij: '<path d="M5 12h13M13 6l6 6-6 6"/>',
  kopiuj: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  pinezka: '<path d="M12 17v5M8 3h8l-1 6 3 4H6l3-4z"/>', ok: '<path d="M5 12l4 4 10-10"/>', dol: '<path d="M6 9l6 6 6-6"/>',
  szukaj: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>', telefon: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
  tablet: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M11 18h2"/>', laptop: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 19h18"/>',
  pobierz: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', udostepnij: '<path d="M12 3v12M7 8l5-5 5 5M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/>',
  kosz: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', zegar: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  wgore: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>', siatka: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  ustawienia: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>', wiecej: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  dzwonek: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>', oko: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  otworz: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', lewo: '<path d="M15 6l-6 6 6 6"/>', prawo: '<path d="M9 6l6 6-6 6"/>',
  wklej: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/>', wszystkie: '<rect x="2" y="6" width="9" height="12" rx="2"/><rect x="13" y="4" width="9" height="16" rx="2"/>',
  skrot: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>', wyloguj: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
};
const ik = (n) => `<svg class="ik" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${SCIEZKI[n] || ''}</svg>`;

// ---------- pomocnicze ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dotyk = matchMedia('(pointer: coarse)').matches;
const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const zainstalowana = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function odmiana(n, a, b, c) { const m10 = n % 10, m100 = n % 100; return n === 1 ? a : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) ? b : c; }
function rozmiar(b) {
  if (b < 1024) return `${b} B`; if (b < 1024 ** 2) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(b < 10 * 1024 ** 2 ? 1 : 0).replace('.', ',')} MB`;
  return `${(b / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
}
const MIES = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const gg = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
function kiedy(t) {
  const r = Date.now() - t, d = new Date(t), dzis = new Date();
  if (r < 45e3) return 'teraz';
  if (r < 3600e3) return `${Math.round(r / 60e3)} min temu`;
  if (d.toDateString() === dzis.toDateString()) return r < 4 * 3600e3 ? `${Math.round(r / 3600e3)} godz. temu` : `dziś, ${gg(d)}`;
  const wcz = new Date(dzis); wcz.setDate(dzis.getDate() - 1);
  if (d.toDateString() === wcz.toDateString()) return `wczoraj, ${gg(d)}`;
  return `${d.getDate()} ${MIES[d.getMonth()]}, ${gg(d)}`;
}
function zniknie(t) {
  if (!t) return 'Przypięte na stałe';
  const r = t - Date.now();
  if (r <= 60e3) return 'Zaraz zniknie';
  if (r < 3600e3) return `Zniknie za ${Math.ceil(r / 60e3)} min`;
  if (r < 48 * 3600e3) { const h = Math.round(r / 3600e3); return `Zniknie za ${h} ${odmiana(h, 'godzinę', 'godziny', 'godzin')}`; }
  const d = Math.round(r / 86400e3); return `Zniknie za ${d} ${odmiana(d, 'dzień', 'dni', 'dni')}`;
}
const bezOgonkow = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
const nazwaUrz = (id) => (id == null ? 'Wszystkie' : (S.urzadzenia.find((u) => u.id === id)?.nazwa || 'Odłączone urządzenie'));
const ikUrz = (typ) => ({ iphone: 'telefon', android: 'telefon', ipad: 'tablet', tablet: 'tablet', windows: 'laptop', mac: 'laptop', linux: 'laptop', skrot: 'skrot' }[typ] || 'telefon');
const jestMedia = (r) => r.rodzaj === 'plik' && /^(image|video)\//.test(r.mime || '');
const jestFilm = (r) => /^video\//.test(r.mime || '');
const wyswietlalny = (r) => /^image\/(jpeg|png|gif|webp|avif)$/.test(r.mime) || (iOS && /^image\/hei[cf]$/.test(r.mime));
const url = (p) => API + p;

function wykryjUrzadzenie() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return { typ: 'iphone', nazwa: 'iPhone' };
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return { typ: 'ipad', nazwa: 'iPad' };
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? { typ: 'android', nazwa: 'Telefon z Androidem' } : { typ: 'tablet', nazwa: 'Tablet' };
  if (/Windows/.test(ua)) return { typ: 'windows', nazwa: 'Laptop' };
  if (/Macintosh/.test(ua)) return { typ: 'mac', nazwa: 'Mac' };
  if (/Linux/.test(ua)) return { typ: 'linux', nazwa: 'Komputer' };
  return { typ: 'inne', nazwa: 'Urządzenie' };
}

class BladAPI extends Error { constructor(m, s, b) { super(m); this.status = s; this.dane = b; } }
async function api(sciezka, { metoda = 'GET', json, cialo, sygnal } = {}) {
  const h = { Authorization: `Bearer ${S.token}` };
  if (json !== undefined) h['Content-Type'] = 'application/json';
  let r;
  try { r = await fetch(url(sciezka), { method: metoda, headers: h, body: json !== undefined ? JSON.stringify(json) : cialo, signal: sygnal }); }
  catch (e) { throw new BladAPI('Brak połączenia z serwerem.', 0); }
  let b = null; try { b = await r.json(); } catch {}
  if (r.status === 401 && S.token) { wyloguj('To urządzenie zostało odłączone. Połącz je ponownie hasłem.'); throw new BladAPI('Odłączone', 401); }
  if (!r.ok) throw new BladAPI(b?.blad || `Błąd ${r.status}`, r.status, b);
  return b;
}

let komTimer;
function komunikat(t, ikona = 'ok') {
  document.querySelectorAll('.komunikat').forEach((k) => k.remove());
  const el = document.createElement('div'); el.className = 'komunikat'; el.setAttribute('role', 'status');
  el.innerHTML = `${ik(ikona)}<span>${esc(t)}</span>`; document.body.append(el);
  clearTimeout(komTimer); komTimer = setTimeout(() => el.remove(), 2600);
}
async function kopiuj(t, co = 'Skopiowano') {
  try { await navigator.clipboard.writeText(t); }
  catch { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  komunikat(co); navigator.vibrate?.(8);
}

// ---------- logowanie ----------
function ekranLogowania(blad = '') {
  zamknijNaZywo();
  const u = wykryjUrzadzenie();
  app.innerHTML = `
  <main id="logowanie">
    <form class="ramka" id="f-log" novalidate>
      <div class="ilu" role="img" aria-label="Telefony i tablet połączone świetlną wstęgą"></div>
      <div class="znak"><div class="logo" aria-hidden="true"></div><h1 class="napis" style="margin:0">Łącznik</h1></div>
      <p class="podtytul">Twoje rzeczy od razu na każdym urządzeniu</p>
      ${blad ? `<div class="blad" role="alert">${esc(blad)}</div>` : ''}
      <div class="pole"><label for="haslo">Hasło</label>
        <div class="wej-z-ik"><input class="wej" id="haslo" type="password" autocomplete="current-password" required autofocus>
        <button type="button" class="ikb bez" id="pokaz" aria-label="Pokaż hasło">${ik('oko')}</button></div></div>
      <div class="pole"><label for="nazwa">Nazwa tego urządzenia</label>
        <input class="wej" id="nazwa" type="text" maxlength="40" value="${esc(u.nazwa)}" autocomplete="off"></div>
      <button class="p glowny" type="submit" id="polacz">Połącz to urządzenie</button>
    </form>
  </main>`;
  $('#pokaz').onclick = () => { const h = $('#haslo'); h.type = h.type === 'password' ? 'text' : 'password'; };
  $('#f-log').onsubmit = async (e) => {
    e.preventDefault();
    const haslo = $('#haslo').value; if (!haslo) return $('#haslo').focus();
    const b = $('#polacz'); b.disabled = true; b.textContent = 'Łączę…';
    try {
      const r = await fetch(url('/polacz'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ haslo, nazwa: $('#nazwa').value.trim() || u.nazwa, typ: u.typ }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.blad || 'Nie udało się połączyć.');
      S.token = d.token; S.ja = { id: d.id, nazwa: d.nazwa, typ: d.typ };
      localStorage.setItem('lacznik.token', d.token); localStorage.setItem('lacznik.ja', JSON.stringify(S.ja));
      start();
    } catch (er) { ekranLogowania(er.message === 'Failed to fetch' ? 'Brak połączenia z serwerem.' : er.message); }
  };
}
function wyloguj(powod = '') {
  localStorage.removeItem('lacznik.token'); localStorage.removeItem('lacznik.ja');
  S.token = null; S.ja = null; S.rzeczy = []; S.zaladowano = false;
  ekranLogowania(powod);
}

// ---------- szkielet ----------
const FILTRY = [['wszystko', 'Wszystko', 'siatka'], ['zdjecia', 'Zdjęcia', 'foto'], ['pliki', 'Pliki', 'plik'], ['notatki', 'Notatki', 'notatka'],
  ['linki', 'Linki', 'link'], ['kody', 'Kody', 'kod'], ['przypiete', 'Przypięte', 'pinezka']];
const pasuje = (r, f) => f === 'wszystko' || (f === 'zdjecia' && jestMedia(r)) || (f === 'pliki' && r.rodzaj === 'plik' && !jestMedia(r))
  || (f === 'notatki' && r.rodzaj === 'notatka') || (f === 'linki' && r.rodzaj === 'link') || (f === 'kody' && r.rodzaj === 'kod') || (f === 'przypiete' && r.przypiete);

function szkielet() {
  app.innerHTML = `
  <div id="glowny">
    <aside class="bok" aria-label="Menu">
      <div class="znak"><div class="logo" aria-hidden="true"></div><div class="napis">Łącznik</div></div>
      <nav class="nawig" aria-label="Kategorie" id="nawig"></nav>
      <div style="display:flex;flex-direction:column;gap:4px"><h3>Urządzenia</h3><div id="urz-bok"></div></div>
      <div class="stopka"><div class="karta" id="miejsce-bok"></div>
        <button class="p cichy" data-a="ustawienia" style="justify-content:flex-start">${ik('ustawienia')}Ustawienia</button></div>
    </aside>
    <main class="srodek">
      <header class="gora" id="gora">
        <div class="rzad tylko-tel">
          <div class="znak"><div class="logo" aria-hidden="true"></div><div class="napis">Łącznik</div></div>
          <div class="narz"><div class="miejsce" id="miejsce-tel"></div>
            <button class="ikb bez" data-a="pokaz-szukaj" aria-label="Szukaj">${ik('szukaj')}</button>
            <button class="ikb bez" data-a="ustawienia" aria-label="Ustawienia">${ik('ustawienia')}</button></div>
        </div>
        <div class="rzad tylko-lap"><h1 class="tytul-sekcji" id="tytul-sekcji">Wszystko</h1>
          <label class="szukaj" style="flex:0 1 320px"><span class="sr">Szukaj</span>${ik('szukaj')}<input type="search" id="szukaj-lap" placeholder="Szukaj we wszystkim"></label></div>
        <label class="szukaj ukryte" id="szukaj-tel-r"><span class="sr">Szukaj</span>${ik('szukaj')}<input type="search" id="szukaj-tel" placeholder="Szukaj"></label>
        <div class="rzad tylko-tel" style="justify-content:flex-start"><div class="stan-pol" id="stan-pol"></div></div>
        <div class="chipy" id="chipy" role="toolbar" aria-label="Filtry"></div>
      </header>
      <div id="baner"></div>
      <div class="strefa tylko-lap">${ik('wgore')}<span>Upuść pliki w dowolnym miejscu okna albo wklej <kbd>Ctrl</kbd>+<kbd>V</kbd></span></div>
      <div id="lista" aria-live="polite"></div>
      <div id="pusto"></div>
      <form class="pisz" id="pisz" autocomplete="off">
        <div class="pud">
          <div class="zalaczniki ukryte" id="zalaczniki"></div>
          <div class="rzad">
            <button type="button" class="ikb mie" data-a="dodaj-plik" aria-label="Dodaj zdjęcia lub pliki">${ik('plus')}</button>
            <label for="tekst" class="sr">Wiadomość</label>
            <textarea id="tekst" rows="1" placeholder="Wklej lub napisz…" enterkeyhint="send"></textarea>
            <button type="submit" class="ikb akc" id="wyslij" aria-label="Wyślij" disabled>${ik('wyslij')}</button>
          </div>
          <div class="opcje"><button type="button" class="wybor" data-a="wybierz-do" id="do-przycisk"></button>
            <span id="rodzaj-miejsce"></span>
            ${dotyk && navigator.clipboard?.readText ? `<button type="button" class="wybor" data-a="wklej" style="margin-left:auto">${ik('wklej')}Wklej</button>` : ''}</div>
        </div>
        <input type="file" id="wybor-plikow" multiple class="ukryte">
      </form>
    </main>
    <aside class="podglad" id="podglad" aria-label="Podgląd"></aside>
  </div>`;
  podepnijZdarzenia();
}

// ---------- rysowanie ----------
function widoczneRzeczy() {
  const q = bezOgonkow(S.szukaj.trim());
  return S.rzeczy.filter((r) => pasuje(r, S.filtr) && (!q || bezOgonkow([r.tekst, r.tytul, r.url, r.nazwa, r.odNazwa, r.strona].join(' ')).includes(q)))
    .sort((a, b) => b.utworzone - a.utworzone);
}
function grupuj(lista) {
  const out = [];
  for (const r of lista) {
    const ost = out[out.length - 1];
    if (ost && ost.typ === 'media' && jestMedia(r) && r.od === ost.el[0].od && r.do === ost.el[0].do && Math.abs(ost.el[ost.el.length - 1].utworzone - r.utworzone) < 180e3 && ost.el.length < 30) ost.el.push(r);
    else out.push({ typ: jestMedia(r) ? 'media' : 'jedna', el: [r] });
  }
  for (const g of out) { g.klucz = g.el[0].id; g.el.sort((a, b) => a.utworzone - b.utworzone); }
  return out;
}
function opisMediow(el) {
  const z = el.filter((r) => !jestFilm(r)).length, f = el.length - z;
  if (el.length === 1) return el[0].nazwa;
  const cz = []; if (z) cz.push(`${z} ${odmiana(z, 'zdjęcie', 'zdjęcia', 'zdjęć')}`); if (f) cz.push(`${f} ${odmiana(f, 'film', 'filmy', 'filmów')}`);
  return cz.join(' i ');
}
function meta(r) {
  const od = esc(r.odNazwa);
  return `${od} → ${esc(nazwaUrz(r.do))} · <span data-czas="${r.utworzone}">${kiedy(r.utworzone)}</span>`;
}
function stopka(r, el = [r]) {
  if (r.od === S.ja?.id) {
    const kto = new Set(); el.forEach((x) => Object.keys(x.odebrane || {}).forEach((k) => kto.add(Number(k))));
    const nazwy = [...kto].map((id) => S.urzadzenia.find((u) => u.id === id)?.nazwa).filter(Boolean);
    if (nazwy.length) return `<div class="dol"><span class="ok">${ik('ok')}</span><span>Odebrano: ${esc(nazwy.join(', '))}</span></div>`;
  }
  return `<div class="dol">${ik(r.przypiete ? 'pinezka' : 'zegar')}<span data-wygasa="${r.wygasa ?? ''}">${zniknie(r.wygasa)}</span></div>`;
}
const glowa = (rodzaj, tytul, r) => `<div class="glowa"><div class="znaczek ${rodzaj}">${ik(rodzaj === 'foto' && jestFilm(r) ? 'film' : rodzaj)}</div>
  <div class="opis"><div class="tyt">${tytul}</div><div class="meta">${meta(r)}</div></div>
  ${r.przypiete ? `<span class="przyp" aria-label="Przypięte">${ik('pinezka')}</span>` : ''}
  <button class="ikb bez" data-a="menu" data-id="${r.id}" aria-label="Więcej opcji">${ik('wiecej')}</button></div>`;

function kartaHTML(g) {
  const r = g.el[0];
  const wyb = S.wybrana === g.klucz ? ' wybrana' : '';
  const klik = matchMedia('(min-width: 1280px)').matches ? ' klik' : '';
  if (g.typ === 'media') {
    const n = g.el.length, pokaz = g.el.slice(0, 4), kl = n === 1 ? 'n1' : n === 2 ? 'n2' : n === 3 ? '' : 'n4';
    const mini = pokaz.map((x, i) => `<button class="mini" data-a="przegladaj" data-id="${x.id}" data-grupa="${g.klucz}" aria-label="Otwórz ${esc(x.nazwa)}">
      <span class="zast">${ik(jestFilm(x) ? 'film' : 'foto')}</span>
      ${x.miniatura || wyswietlalny(x) ? `<img loading="lazy" decoding="async" alt="" src="${esc(url(x.miniatura || x.plik))}" onload="this.classList.add('z')">` : ''}
      ${jestFilm(x) ? `<span class="film">${ik('film')}Film</span>` : ''}
      ${i === 3 && n > 4 ? `<span class="wiecej">+${n - 4}</span>` : ''}</button>`).join('');
    return `<article class="karta pelna${wyb}${klik}" data-klucz="${g.klucz}">${glowa('foto', esc(opisMediow(g.el)), r)}
      <div class="siatka ${kl}">${mini}</div>
      <div class="rzad-akcji">${stopka(r, g.el)}<div class="akcje">
        <button class="p maly" data-a="zapisz" data-grupa="${g.klucz}">${ik(iOS ? 'udostepnij' : 'pobierz')}${iOS ? 'Zapisz' : n > 1 ? 'Pobierz wszystkie' : 'Pobierz'}</button></div></div></article>`;
  }
  if (r.rodzaj === 'kod') {
    const t = r.tekst.trim();
    return `<article class="karta${wyb}${klik}" data-klucz="${g.klucz}">${glowa('kod', 'Kod', r)}
      <div class="rzad-akcji"><div class="kod-wart${t.length > 9 ? ' dlugi' : ''}">${esc(t)}</div>
      <button class="p glowny" data-a="kopiuj" data-id="${r.id}">${ik('kopiuj')}Kopiuj</button></div>${stopka(r)}</article>`;
  }
  if (r.rodzaj === 'link') {
    let host = r.url; try { host = new URL(r.url).hostname.replace(/^www\./, ''); } catch {}
    return `<article class="karta${wyb}${klik}" data-klucz="${g.klucz}">${glowa('link', esc(r.tytul || host), r)}
      <div class="adres"><span>${esc(r.url.replace(/^https?:\/\/(www\.)?/, ''))}</span><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${ik('otworz')}Otwórz</a></div>
      <div class="rzad-akcji">${stopka(r)}<div class="akcje"><button class="p maly" data-a="kopiuj" data-id="${r.id}">${ik('kopiuj')}Kopiuj</button></div></div></article>`;
  }
  if (r.rodzaj === 'notatka') {
    const dluga = r.tekst.length > 420 || r.tekst.split('\n').length > 8;
    return `<article class="karta${wyb}${klik}" data-klucz="${g.klucz}">${glowa('notatka', 'Notatka', r)}
      <div class="tresc${dluga ? ' zwin' : ''}">${esc(r.tekst)}</div>
      <div class="rzad-akcji">${stopka(r)}<div class="akcje">${dluga ? `<button class="p maly cichy" data-a="rozwin">Pokaż całość</button>` : ''}
      <button class="p maly" data-a="kopiuj" data-id="${r.id}">${ik('kopiuj')}Kopiuj</button></div></div></article>`;
  }
  // inny plik
  return `<article class="karta${wyb}${klik}" data-klucz="${g.klucz}">${glowa('plik', esc(r.nazwa), r)}
    <div class="rzad-akcji"><div class="dol" style="font-size:13px">${rozmiar(r.rozmiar)}${r.mime && r.mime !== 'application/octet-stream' ? ' · ' + esc(r.mime.split('/')[1].split('.').pop().toUpperCase().slice(0, 8)) : ''}</div>
    <div class="akcje"><a class="p maly" href="${esc(url(r.plik))}" target="_blank" rel="noopener">${ik('otworz')}Otwórz</a>
    <button class="p maly" data-a="zapisz" data-id="${r.id}">${ik(iOS ? 'udostepnij' : 'pobierz')}${iOS ? 'Zapisz' : 'Pobierz'}</button></div></div>${stopka(r)}</article>`;
}
function wysylkaHTML(w) {
  const proc = Math.round(w.postep * 100);
  const stan = w.blad ? `<span style="color:var(--czerwony)">${esc(w.blad)}</span>` : w.czeka ? 'Czekam na połączenie…' : w.postep >= 1 ? 'Kończę…' : `Wysyłam · ${proc}%`;
  return `<article class="karta wysylana pelna" data-klucz="w-${w.lid}">
    <div class="glowa"><div class="znaczek ${/^(image|video)\//.test(w.mime) ? 'foto' : 'plik'}">${ik(/^video\//.test(w.mime) ? 'film' : /^image\//.test(w.mime) ? 'foto' : 'plik')}</div>
    <div class="opis"><div class="tyt">${esc(w.nazwa)}</div><div class="meta">${rozmiar(w.rozmiar)} → ${esc(nazwaUrz(w.do))} · ${stan}</div></div>
    <button class="ikb bez" data-a="anuluj" data-lid="${w.lid}" aria-label="Anuluj wysyłanie">${ik('x')}</button></div>
    <div class="postep" role="progressbar" aria-valuenow="${proc}" aria-valuemin="0" aria-valuemax="100" aria-label="Postęp wysyłania"><i style="width:${proc}%"></i></div></article>`;
}

function rysujListe() {
  const lista = $('#lista'); if (!lista) return;
  const grupy = grupuj(widoczneRzeczy());
  const elementy = [...S.wysylki.map((w) => ({ klucz: 'w-' + w.lid, html: wysylkaHTML(w) })), ...grupy.map((g) => ({ klucz: g.klucz, html: kartaHTML(g), g }))];
  const stare = new Map([...lista.children].map((e) => [e.dataset.klucz, e]));
  const tmp = document.createElement('div');
  let poprz = null;
  for (const e of elementy) {
    let el = stare.get(e.klucz);
    if (!el || el._html !== e.html) {
      tmp.innerHTML = e.html; const nowy = tmp.firstElementChild; nowy._html = e.html;
      if (el) { el.replaceWith(nowy); } el = nowy;
      if (S.nowe.has(e.klucz)) { el.classList.add('nowa'); S.nowe.delete(e.klucz); }
    }
    stare.delete(e.klucz);
    const cel = poprz ? poprz.nextSibling : lista.firstChild;
    if (cel !== el) lista.insertBefore(el, cel);
    poprz = el;
  }
  for (const el of stare.values()) el.remove();
  const pusto = $('#pusto');
  if (!elementy.length && S.zaladowano) {
    const filtr = S.filtr !== 'wszystko' || S.szukaj;
    pusto.innerHTML = `<div class="pusto">${filtr ? '' : '<div class="ilu" role="img" aria-label="Telefon, tablet i laptop połączone świetlną linią"></div>'}
      <h2>${filtr ? 'Nic tu nie pasuje' : 'Nic tu jeszcze nie ma'}</h2>
      <p>${filtr ? 'Zmień filtr albo wyszukiwanie.' : 'Wklej tekst, link albo kod, albo dodaj zdjęcia i pliki. Pojawią się od razu na Twoich urządzeniach.'}</p></div>`;
  } else pusto.innerHTML = '';
  oznaczOdebrane();
}
function rysujFiltry() {
  const licz = (f) => S.rzeczy.filter((r) => pasuje(r, f)).length;
  $('#chipy').innerHTML = FILTRY.map(([k, n]) => `<button class="chip" data-a="filtr" data-f="${k}" aria-pressed="${S.filtr === k}">${n}${k !== 'wszystko' && licz(k) ? ` <span class="ile">${licz(k)}</span>` : ''}</button>`).join('');
  $('#nawig').innerHTML = FILTRY.map(([k, n, i]) => `<button data-a="filtr" data-f="${k}" aria-pressed="${S.filtr === k}">${ik(i)}<span>${n}</span><i>${licz(k)}</i></button>`).join('');
  $('#tytul-sekcji').textContent = FILTRY.find((f) => f[0] === S.filtr)[1];
}
function rysujMiejsce() {
  const m = S.miejsce; if (!m) return;
  const proc = Math.min(100, Math.round((m.uzyte / m.limit) * 100));
  const h = `<div class="liczby"><span>${rozmiar(m.uzyte)} z ${rozmiar(m.limit)}</span></div><div class="pasek"><i style="width:${Math.max(proc, 2)}%"></i></div>`;
  $('#miejsce-tel').innerHTML = h;
  $('#miejsce-bok').innerHTML = `<div class="miejsce"><div class="liczby"><span>${rozmiar(m.uzyte)} z ${rozmiar(m.limit)}</span><span>${proc}%</span></div><div class="pasek"><i style="width:${Math.max(proc, 2)}%"></i></div></div>`;
}
function rysujUrzadzenia() {
  const inne = S.urzadzenia.filter((u) => u.typ !== 'skrot');
  const online = inne.filter((u) => u.online && u.id !== S.ja?.id).length;
  $('#stan-pol').innerHTML = `<span class="kropka${S.polaczony ? ' on' : ''}"></span>${S.polaczony ? `${esc(S.ja?.nazwa || '')} · połączono` : 'Łączę z serwerem…'}${online ? ` · ${online} ${odmiana(online, 'inne urządzenie', 'inne urządzenia', 'innych urządzeń')} online` : ''}`;
  $('#urz-bok').innerHTML = inne.map((u) => `<div class="urz">${ik(ikUrz(u.typ))}<div class="t"><b>${esc(u.nazwa)}</b><span>${u.id === S.ja?.id ? 'to urządzenie' : u.online ? 'aktywne teraz' : kiedy(u.ostatnio)}</span></div>
    <span class="kropka${u.online || u.id === S.ja?.id ? ' on' : ''}"></span></div>`).join('');
  const d = S.do && S.urzadzenia.some((u) => String(u.id) === String(S.do)) ? Number(S.do) : null;
  if (S.do && d == null) { S.do = ''; localStorage.removeItem('lacznik.do'); }
  $('#do-przycisk').innerHTML = `Do: <b>${d == null ? 'Wszystkie urządzenia' : esc(nazwaUrz(d))}</b>${ik('dol')}`;
}
function rysujBaner() {
  const b = $('#baner'); if (!b) return;
  if (S.miejsce && !S.miejsce.przyjmuje) b.innerHTML = `<div class="baner">${ik('zegar')}Miejsce się kończy. Nowe pliki nie będą przyjmowane, dopóki czegoś nie usuniesz.</div>`;
  else if (iOS && !zainstalowana) b.innerHTML = `<div class="baner">${ik('udostepnij')}<span>Dodaj Łącznik do ekranu: stuknij Udostępnij, potem „Do ekranu początkowego”.</span></div>`;
  else b.innerHTML = '';
}
function rysujPodglad() {
  const p = $('#podglad'); if (!p || !matchMedia('(min-width: 1280px)').matches) return;
  const g = grupuj(widoczneRzeczy()).find((x) => x.klucz === S.wybrana) || null;
  if (!g) { p.innerHTML = `<div class="etyk">Podgląd</div><div class="nic">Kliknij coś na liście, żeby zobaczyć to tutaj.</div>`; return; }
  const r = g.el[0];
  let duzy = '', nazwa = '', akcje = '';
  if (g.typ === 'media') {
    duzy = jestFilm(r) ? `<video src="${esc(url(r.plik))}" controls playsinline preload="metadata" ${r.miniatura ? `poster="${esc(url(r.miniatura))}"` : ''}></video>`
      : `<img alt="${esc(r.nazwa)}" src="${esc(url(wyswietlalny(r) ? r.plik : r.miniatura || r.plik))}" data-a="przegladaj" data-id="${r.id}" data-grupa="${g.klucz}">`;
    duzy = `<div class="duzy">${duzy}</div>`; nazwa = g.el.length > 1 ? `${esc(r.nazwa)} <span style="color:var(--szary);font-weight:600;font-size:14px">· 1 z ${g.el.length}</span>` : esc(r.nazwa);
    akcje = `<button class="p glowny" data-a="zapisz" data-grupa="${g.klucz}">${ik('pobierz')}${g.el.length > 1 ? 'Pobierz wszystkie' : 'Pobierz'}</button>`;
  } else if (r.rodzaj === 'plik') {
    duzy = r.mime === 'application/pdf' ? `<div class="duzy" style="min-height:420px"><iframe title="${esc(r.nazwa)}" src="${esc(url(r.plik))}" style="width:100%;height:420px;border:0"></iframe></div>` : `<div class="duzy"><div class="znaczek plik" style="width:72px;height:72px">${ik('plik')}</div></div>`;
    nazwa = esc(r.nazwa); akcje = `<a class="p" href="${esc(url(r.plik))}" target="_blank" rel="noopener">${ik('otworz')}Otwórz</a><button class="p glowny" data-a="zapisz" data-id="${r.id}">${ik('pobierz')}Pobierz</button>`;
  } else if (r.rodzaj === 'link') {
    duzy = `<div class="duzy tekst"><div class="tresc">${esc(r.url)}</div></div>`; nazwa = esc(r.tytul || 'Link');
    akcje = `<a class="p glowny" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${ik('otworz')}Otwórz</a><button class="p" data-a="kopiuj" data-id="${r.id}">${ik('kopiuj')}Kopiuj</button>`;
  } else {
    duzy = `<div class="duzy tekst"><div class="tresc"${r.rodzaj === 'kod' ? ' style="font-size:40px;font-weight:800;letter-spacing:.08em"' : ''}>${esc(r.tekst)}</div></div>`;
    nazwa = r.rodzaj === 'kod' ? 'Kod' : 'Notatka'; akcje = `<button class="p glowny" data-a="kopiuj" data-id="${r.id}">${ik('kopiuj')}Kopiuj</button>`;
  }
  const odeb = Object.entries(g.el.reduce((a, x) => Object.assign(a, x.odebrane || {}), {})).map(([id, t]) => `${esc(nazwaUrz(Number(id)))} ${gg(new Date(t))}`).join(' · ');
  p.innerHTML = `<div class="etyk">Podgląd</div>${duzy}<div class="nazwa">${nazwa}</div>${r.rodzaj === 'plik' ? `<div class="meta">${rozmiar(g.el.reduce((a, x) => a + x.rozmiar, 0))}</div>` : ''}
    <div class="akcje">${akcje}<button class="p" data-a="przypnij" data-id="${r.id}">${ik('pinezka')}${r.przypiete ? 'Odepnij' : 'Przypnij'}</button>
    <button class="p uwaga" data-a="usun" data-id="${r.id}">${ik('kosz')}Usuń</button></div>
    <div class="fakty"><div class="fakt"><span>Od</span><span>${esc(r.odNazwa)} · ${gg(new Date(r.utworzone))}</span></div>
    <div class="fakt"><span>Do</span><span>${esc(r.do == null ? 'Wszystkie urządzenia' : nazwaUrz(r.do))}</span></div>
    ${odeb ? `<div class="fakt"><span>Odebrano</span><span>${odeb}</span></div>` : ''}
    <div class="fakt"><span>Zniknie</span><span>${r.wygasa ? zniknie(r.wygasa).replace('Zniknie ', '') + ' · przypnij, by zachować' : 'nigdy, przypięte'}</span></div></div>`;
}
function rysuj() {
  if (!$('#glowny')) return;
  if (!S.wybrana && matchMedia('(min-width: 1280px)').matches) S.wybrana = grupuj(widoczneRzeczy())[0]?.klucz || null;
  rysujFiltry(); rysujMiejsce(); rysujUrzadzenia(); rysujBaner(); rysujListe(); rysujPodglad();
}

function oznaczOdebrane() {
  if (document.visibilityState !== 'visible' || !S.ja) return;
  for (const r of S.rzeczy) {
    if (r.od === S.ja.id || odebraneWyslane.has(r.id) || (r.odebrane && r.odebrane[S.ja.id])) continue;
    odebraneWyslane.add(r.id);
    api(`/rzeczy/${r.id}/odebrane`, { metoda: 'POST' }).catch(() => odebraneWyslane.delete(r.id));
  }
}

// ---------- dane i na żywo ----------
async function wczytajStan() {
  const s = await api('/stan');
  S.ja = s.ja; localStorage.setItem('lacznik.ja', JSON.stringify(s.ja));
  S.urzadzenia = s.urzadzenia; S.rzeczy = s.rzeczy; S.miejsce = s.miejsce; S.vapid = s.vapid; S.zaladowano = true;
  rysuj(); odnowPush();
}
function zamknijNaZywo() { if (zrodlo) { zrodlo.close(); zrodlo = null; } }
function naZywo() {
  zamknijNaZywo();
  const es = new EventSource(url(`/na-zywo?t=${encodeURIComponent(S.token)}`));
  zrodlo = es;
  es.onopen = () => { S.polaczony = true; rysujUrzadzenia(); };
  es.onerror = () => {
    S.polaczony = false; rysujUrzadzenia();
    if (es.readyState === EventSource.CLOSED) setTimeout(() => { if (zrodlo === es && S.token) { wczytajStan().then(naZywo).catch(() => setTimeout(naZywo, 5000)); } }, 3000);
  };
  es.addEventListener('rzecz', (e) => {
    const r = JSON.parse(e.data); const i = S.rzeczy.findIndex((x) => x.id === r.id);
    if (i >= 0) S.rzeczy[i] = r;
    else {
      S.rzeczy.push(r);
      if (r.od !== S.ja?.id) { S.nowe.add(grupuj(widoczneRzeczy()).find((g) => g.el.some((x) => x.id === r.id))?.klucz || r.id); navigator.vibrate?.(12); }
    }
    rysuj();
  });
  es.addEventListener('usun', (e) => { const { id } = JSON.parse(e.data); S.rzeczy = S.rzeczy.filter((x) => x.id !== id); if (S.wybrana === id) S.wybrana = null; rysuj(); });
  es.addEventListener('urzadzenia', (e) => { S.urzadzenia = JSON.parse(e.data); rysujUrzadzenia(); if ($('#ark-ust')) arkuszUstawien(true); });
  es.addEventListener('miejsce', (e) => { S.miejsce = JSON.parse(e.data); rysujMiejsce(); rysujBaner(); });
  es.addEventListener('wylogowano', () => wyloguj('To urządzenie zostało odłączone. Połącz je ponownie hasłem.'));
}
document.addEventListener('visibilitychange', () => {
  if (!S.token || !$('#glowny')) return;
  const w = document.visibilityState === 'visible';
  api('/obecnosc', { metoda: 'POST', json: { widoczny: w } }).catch(() => {});
  if (w) { wczytajStan().catch(() => {}); if (!zrodlo || zrodlo.readyState === EventSource.CLOSED) naZywo(); oznaczOdebrane(); }
});
window.addEventListener('online', () => { if (S.token && $('#glowny')) { wczytajStan().catch(() => {}); naZywo(); wznowWysylki(); } });
setInterval(() => {
  document.querySelectorAll('[data-czas]').forEach((e) => { e.textContent = kiedy(Number(e.dataset.czas)); });
  document.querySelectorAll('[data-wygasa]').forEach((e) => { e.textContent = zniknie(Number(e.dataset.wygasa) || null); });
}, 30e3);

// ---------- pisanie i wysyłanie ----------
function rozpoznaj(t) {
  t = t.trim();
  if (/^https?:\/\/\S+$/i.test(t) || /^www\.\S+\.[a-z]{2,}\S*$/i.test(t)) return 'link';
  const bez = t.replace(/[\s-]/g, '');
  if (/^\d{4,10}$/.test(bez) && t.length <= 14) return 'kod';
  if (/^[A-Za-z0-9]{6,16}$/.test(t) && /\d/.test(t) && /[A-Za-z]/.test(t)) return 'kod';
  return 'notatka';
}
const OPIS_RODZ = { kod: ['kod', 'Kod · zniknie po godzinie'], link: ['link', 'Link'], notatka: ['notatka', 'Notatka'] };
function odswiezPisanie() {
  const ta = $('#tekst'); if (!ta) return;
  ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 168) + 'px';
  const t = ta.value.trim();
  const r = t ? (S.wymuszonyRodzaj || rozpoznaj(t)) : null;
  $('#rodzaj-miejsce').innerHTML = r ? `<button type="button" class="rodzaj ${r}" data-a="zmien-rodzaj" title="Stuknij, żeby zmienić">${ik(OPIS_RODZ[r][0])}${OPIS_RODZ[r][1]}</button>` : '';
  $('#wyslij').disabled = !t && !S.zalaczniki.length;
  const z = $('#zalaczniki');
  z.classList.toggle('ukryte', !S.zalaczniki.length);
  z.innerHTML = S.zalaczniki.map((p, i) => `<div class="zal">${p.podglad ? `<img alt="" src="${p.podglad}">` : ik(/^video\//.test(p.plik.type) ? 'film' : 'plik')}
    <span class="nz">${esc(p.plik.name)}</span><button type="button" class="x" data-a="usun-zal" data-i="${i}" aria-label="Usuń ${esc(p.plik.name)}">${ik('x')}</button></div>`).join('');
}
function dodajZalaczniki(pliki) {
  for (const plik of pliki) {
    if (!plik || !plik.size) continue;
    const z = { plik, podglad: /^image\/(jpeg|png|gif|webp|avif|heic|heif)$/.test(plik.type) ? URL.createObjectURL(plik) : null };
    S.zalaczniki.push(z);
  }
  odswiezPisanie();
  if (!dotyk) $('#tekst').focus();
}
async function wyslij() {
  const ta = $('#tekst'); const tekst = ta.value; const doId = S.do ? Number(S.do) : null;
  const zal = S.zalaczniki.splice(0);
  ta.value = ''; const wym = S.wymuszonyRodzaj; S.wymuszonyRodzaj = null; odswiezPisanie();
  for (const z of zal) { if (z.podglad) setTimeout(() => URL.revokeObjectURL(z.podglad), 30e3); kolejkuj(z.plik, doId); }
  if (tekst.trim()) {
    try {
      const r = await api('/rzeczy', { metoda: 'POST', json: { tekst, do: doId, rodzaj: wym || undefined } });
      if (!S.rzeczy.some((x) => x.id === r.id)) S.rzeczy.push(r);
      if (S.filtr !== 'wszystko' && !pasuje(r, S.filtr)) S.filtr = 'wszystko';
      S.nowe.add(r.id); rysuj(); window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { ta.value = tekst; odswiezPisanie(); komunikat(e.message, 'x'); }
  }
}

// miniatura robiona na urządzeniu (serwer nie przerabia zdjęć ani filmów)
function miniatura(plik) {
  return new Promise((ok) => {
    const koniec = (x) => { clearTimeout(t); ok(x); }; const t = setTimeout(() => ok(null), 9000);
    const rysuj = (src, w, h) => {
      const s = Math.min(1, 640 / Math.max(w, h)); const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      try { koniec({ dane: c.toDataURL('image/jpeg', 0.8), szer: w, wys: h }); } catch { koniec(null); }
    };
    const u = URL.createObjectURL(plik);
    if (/^image\//.test(plik.type)) {
      const im = new Image(); im.onload = () => { rysuj(im, im.naturalWidth, im.naturalHeight); URL.revokeObjectURL(u); }; im.onerror = () => { URL.revokeObjectURL(u); koniec(null); }; im.src = u;
    } else if (/^video\//.test(plik.type)) {
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.onloadeddata = () => { v.currentTime = Math.min(0.6, (v.duration || 1) / 3); };
      v.onseeked = () => { rysuj(v, v.videoWidth, v.videoHeight); URL.revokeObjectURL(u); };
      v.onerror = () => { URL.revokeObjectURL(u); koniec(null); }; v.src = u;
    } else { URL.revokeObjectURL(u); koniec(null); }
  });
}
let licznikW = 0, aktywne = 0;
function kolejkuj(plik, doId) {
  const w = { lid: ++licznikW, plik, nazwa: plik.name || 'plik', rozmiar: plik.size, mime: plik.type || '', do: doId, postep: 0, id: null, blad: null, czeka: false, anulowane: false };
  if (S.miejsce && plik.size > S.miejsce.maxPlik) w.blad = `Za duży — limit to ${rozmiar(S.miejsce.maxPlik)}`;
  S.wysylki.unshift(w); rysujListe(); window.scrollTo({ top: 0, behavior: 'smooth' });
  pompuj();
}
function pompuj() {
  while (aktywne < 2) {
    const w = [...S.wysylki].reverse().find((x) => !x.start && !x.blad && !x.anulowane); if (!w) return;
    w.start = true; aktywne++;
    wysylaj(w).finally(() => { aktywne--; pompuj(); });
  }
}
const czekaj = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function wysylaj(w) {
  const odswiez = () => { const el = document.querySelector(`[data-klucz="w-${w.lid}"]`); if (el) { const n = wysylkaHTML(w); if (el._html !== n) rysujListe(); } };
  try {
    w.mini = /^(image|video)\//.test(w.mime) ? await miniatura(w.plik) : null;
    let proba = 0;
    for (;;) {
      if (w.anulowane) return;
      try {
        if (!w.id) { const r = await api('/wysylki', { metoda: 'POST', json: { nazwa: w.nazwa, mime: w.mime, rozmiar: w.rozmiar, do: w.do } }); w.id = r.id; w.kawalek = r.kawalek; w.od = 0; }
        else { const r = await api(`/wysylki/${w.id}`); w.od = r.odebrano; }
        w.czeka = false; odswiez();
        while (w.od < w.rozmiar) {
          if (w.anulowane) return;
          const kaw = w.plik.slice(w.od, Math.min(w.rozmiar, w.od + w.kawalek));
          const r = await new Promise((ok, zle) => {
            const x = new XMLHttpRequest(); w.xhr = x;
            x.open('PUT', url(`/wysylki/${w.id}?od=${w.od}`)); x.setRequestHeader('Authorization', `Bearer ${S.token}`);
            x.upload.onprogress = (e) => { w.postep = Math.min(0.995, (w.od + e.loaded) / w.rozmiar); odswiez(); };
            x.onload = () => { let b = {}; try { b = JSON.parse(x.responseText); } catch {} if (x.status === 200 || x.status === 409) ok(b); else zle(new BladAPI(b.blad || `Błąd ${x.status}`, x.status)); };
            x.onerror = () => zle(new BladAPI('Brak połączenia', 0)); x.onabort = () => zle(new BladAPI('Anulowano', -1));
            x.send(kaw);
          });
          w.od = r.odebrano; w.postep = w.od / w.rozmiar; proba = 0; odswiez();
        }
        w.postep = 1; odswiez();
        const r = await api(`/wysylki/${w.id}/koniec`, { metoda: 'POST', json: { miniatura: w.mini?.dane, szer: w.mini?.szer, wys: w.mini?.wys } });
        S.wysylki = S.wysylki.filter((x) => x !== w);
        if (!S.rzeczy.some((x) => x.id === r.id)) S.rzeczy.push(r);
        rysuj(); return;
      } catch (e) {
        if (w.anulowane || e.status === -1) return;
        if (e.status && e.status !== 0 && e.status < 500 && e.status !== 409) { w.blad = e.message; odswiez(); rysujListe(); return; }
        if (e.status === 507) { w.blad = e.message; rysujListe(); return; }
        w.czeka = true; odswiez(); rysujListe();
        await czekaj(Math.min(30000, 2000 * 2 ** proba++));
      }
    }
  } catch (e) { w.blad = e.message || 'Błąd'; rysujListe(); }
}
function wznowWysylki() { S.wysylki.forEach((w) => { if (w.czeka) w.czeka = false; }); }

// ---------- zapisywanie, udostępnianie ----------
async function blob(r) {
  if (bloby.has(r.id)) return bloby.get(r.id);
  const odp = await fetch(url(r.plik)); if (!odp.ok) throw new Error('Nie udało się pobrać pliku.');
  const b = await odp.blob(); bloby.set(r.id, b); return b;
}
function pobierzLinkiem(r) { const a = document.createElement('a'); a.href = url(r.plik) + '&pobierz=1'; a.download = r.nazwa; a.rel = 'noopener'; document.body.append(a); a.click(); a.remove(); }
async function zapisz(rzeczy) {
  if (navigator.canShare && (iOS || dotyk)) {
    const gotowe = rzeczy.every((r) => bloby.has(r.id));
    try {
      if (!gotowe) komunikat('Przygotowuję…', 'pobierz');
      const pliki = await Promise.all(rzeczy.map(async (r) => new File([await blob(r)], r.nazwa, { type: r.mime })));
      if (navigator.canShare({ files: pliki })) {
        try { await navigator.share({ files: pliki }); return; }
        catch (e) { if (e.name === 'AbortError') return; if (e.name === 'NotAllowedError') { komunikat('Gotowe — stuknij „Zapisz” jeszcze raz', 'ok'); return; } }
      }
    } catch (e) { komunikat(e.message, 'x'); return; }
  }
  rzeczy.forEach((r, i) => setTimeout(() => pobierzLinkiem(r), i * 400));
}

// ---------- przeglądarka zdjęć i filmów ----------
function przegladaj(grupaKlucz, id) {
  const g = grupuj(widoczneRzeczy()).find((x) => x.klucz === grupaKlucz); if (!g) return;
  let i = Math.max(0, g.el.findIndex((x) => x.id === id));
  const el = document.createElement('div'); el.className = 'przegladarka'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Podgląd');
  const pokaz = () => {
    const r = g.el[i];
    const media = jestFilm(r) ? `<video src="${esc(url(r.plik))}" controls playsinline autoplay ${r.miniatura ? `poster="${esc(url(r.miniatura))}"` : ''}></video>`
      : `<img alt="${esc(r.nazwa)}" src="${esc(url(wyswietlalny(r) ? r.plik : r.miniatura || r.plik))}">`;
    el.innerHTML = `<div class="pas g"><button class="ikb" data-p="zamknij" aria-label="Zamknij">${ik('x')}</button><div class="nazwa">${esc(r.nazwa)}${g.el.length > 1 ? ` · ${i + 1} z ${g.el.length}` : ''}</div>
      <button class="ikb" data-p="menu" aria-label="Więcej opcji">${ik('wiecej')}</button></div>
      <div class="scena">${media}</div>
      ${g.el.length > 1 && !dotyk ? `<button class="ikb str l" data-p="poprz" aria-label="Poprzednie">${ik('lewo')}</button><button class="ikb str p2" data-p="nast" aria-label="Następne">${ik('prawo')}</button>` : ''}
      <div class="pas d"><button class="p glowny" data-p="zapisz">${ik(iOS ? 'udostepnij' : 'pobierz')}${iOS ? 'Zapisz' : 'Pobierz'}</button></div>`;
    if (iOS) blob(r).catch(() => {});
  };
  const zamknij = () => { el.remove(); document.removeEventListener('keydown', klaw); };
  const idz = (d) => { if (g.el.length > 1) { i = (i + d + g.el.length) % g.el.length; pokaz(); } };
  const klaw = (e) => { if (e.key === 'Escape') zamknij(); if (e.key === 'ArrowLeft') idz(-1); if (e.key === 'ArrowRight') idz(1); };
  el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-p]')?.dataset.p;
    if (a === 'zamknij') zamknij(); else if (a === 'poprz') idz(-1); else if (a === 'nast') idz(1);
    else if (a === 'zapisz') zapisz([g.el[i]]); else if (a === 'menu') menuRzeczy(g.el[i], zamknij);
  });
  let x0 = null, y0 = null;
  el.addEventListener('touchstart', (e) => { if (e.touches.length === 1) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; } }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) idz(dx < 0 ? 1 : -1); else if (dy > 110 && Math.abs(dy) > Math.abs(dx)) zamknij();
  });
  document.addEventListener('keydown', klaw);
  pokaz(); document.body.append(el);
}

// ---------- arkusze ----------
function arkusz(html, { id = '', poZamknieciu } = {}) {
  document.querySelectorAll('.zaslona').forEach((z) => z.remove());
  const z = document.createElement('div'); z.className = 'zaslona';
  z.innerHTML = `<div class="arkusz" role="dialog" aria-modal="true" ${id ? `id="${id}"` : ''}><div class="uchwyt"></div>
    <button class="ikb bez zamknij" data-a="zamknij-ark" aria-label="Zamknij">${ik('x')}</button>${html}</div>`;
  const zamknij = () => { z.remove(); document.removeEventListener('keydown', esc_); poZamknieciu?.(); };
  const esc_ = (e) => { if (e.key === 'Escape') zamknij(); };
  z.addEventListener('click', (e) => { if (e.target === z || e.target.closest('[data-a="zamknij-ark"]')) zamknij(); });
  document.addEventListener('keydown', esc_);
  document.body.append(z); z._zamknij = zamknij;
  return z;
}
const zamknijArkusz = () => document.querySelectorAll('.zaslona').forEach((z) => z._zamknij?.());
function potwierdz(tytul, tekst, przycisk) {
  return new Promise((ok) => {
    let wynik = false;
    const z = arkusz(`<h2>${esc(tytul)}</h2><p>${esc(tekst)}</p><div class="akcje" style="margin-top:18px;justify-content:flex-end">
      <button class="p" data-w="nie">Anuluj</button><button class="p glowny" data-w="tak" style="background:var(--czerwony);border-color:var(--czerwony);color:#fff">${esc(przycisk)}</button></div>`, { poZamknieciu: () => ok(wynik) });
    z.addEventListener('click', (e) => { const w = e.target.closest('[data-w]')?.dataset.w; if (w) { wynik = w === 'tak'; z._zamknij(); } });
  });
}
function arkuszDo() {
  const opcje = [{ id: '', nazwa: 'Wszystkie urządzenia', opis: 'Pojawi się wszędzie', ik: 'wszystkie' },
    ...S.urzadzenia.filter((u) => u.id !== S.ja?.id && u.typ !== 'skrot').map((u) => ({ id: String(u.id), nazwa: u.nazwa, opis: u.online ? 'aktywne teraz' : `ostatnio ${kiedy(u.ostatnio)}`, ik: ikUrz(u.typ) }))];
  const z = arkusz(`<h2>Wyślij do</h2><p>Rzecz wysłana na jedno urządzenie pokaże się tylko tam i tutaj.</p>
    <div class="lista-op" role="radiogroup" style="margin-top:12px">${opcje.map((o) => `<button class="op" role="radio" aria-checked="${String(S.do) === o.id}" data-do="${o.id}">
    <span class="znaczek">${ik(o.ik)}</span><span class="t"><b>${esc(o.nazwa)}</b><span>${esc(o.opis)}</span></span>${String(S.do) === o.id ? `<span class="ptaszek">${ik('ok')}</span>` : ''}</button>`).join('')}</div>`);
  z.addEventListener('click', (e) => {
    const b = e.target.closest('[data-do]'); if (!b) return;
    S.do = b.dataset.do; if (S.do) localStorage.setItem('lacznik.do', S.do); else localStorage.removeItem('lacznik.do');
    rysujUrzadzenia(); z._zamknij();
  });
}
function menuRzeczy(r, poAkcji) {
  const g = grupuj(widoczneRzeczy()).find((x) => x.el.some((y) => y.id === r.id));
  const el = g?.typ === 'media' ? g.el : [r];
  const tekst = r.rodzaj === 'link' ? r.url : r.tekst;
  const z = arkusz(`<h2>${esc(r.rodzaj === 'plik' ? (el.length > 1 ? opisMediow(el) : r.nazwa) : r.rodzaj === 'link' ? (r.tytul || 'Link') : r.rodzaj === 'kod' ? 'Kod' : 'Notatka')}</h2>
    <p>${esc(r.odNazwa)} → ${esc(r.do == null ? 'Wszystkie urządzenia' : nazwaUrz(r.do))} · ${kiedy(r.utworzone)}</p>
    <div class="lista-op" style="margin-top:12px">
      ${tekst ? `<button class="op" data-m="kopiuj"><span class="znaczek">${ik('kopiuj')}</span><span class="t"><b>Kopiuj</b></span></button>` : ''}
      ${r.rodzaj === 'plik' ? `<button class="op" data-m="zapisz"><span class="znaczek">${ik(iOS ? 'udostepnij' : 'pobierz')}</span><span class="t"><b>${iOS ? 'Zapisz lub udostępnij' : 'Pobierz'}</b><span>${rozmiar(el.reduce((a, x) => a + x.rozmiar, 0))}</span></span></button>` : ''}
      <button class="op" data-m="przypnij"><span class="znaczek">${ik('pinezka')}</span><span class="t"><b>${r.przypiete ? 'Odepnij' : 'Przypnij'}</b><span>${r.przypiete ? 'Wróci do zwykłego znikania' : 'Zostanie na stałe, nie zniknie sama'}</span></span></button>
      <button class="op" data-m="usun" style="color:var(--czerwony)"><span class="znaczek" style="color:var(--czerwony)">${ik('kosz')}</span><span class="t"><b>Usuń ze wszystkich urządzeń</b></span></button>
    </div>`);
  z.addEventListener('click', async (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m; if (!m) return;
    z._zamknij();
    if (m === 'kopiuj') kopiuj(tekst);
    if (m === 'zapisz') zapisz(el);
    if (m === 'przypnij') przypnij(el, !r.przypiete);
    if (m === 'usun') { if (await usun(el)) poAkcji?.(); }
  });
}
async function przypnij(el, tak) {
  try { for (const r of el) { const n = await api(`/rzeczy/${r.id}`, { metoda: 'PATCH', json: { przypiete: tak } }); const i = S.rzeczy.findIndex((x) => x.id === n.id); if (i >= 0) S.rzeczy[i] = n; } rysuj(); komunikat(tak ? 'Przypięte' : 'Odpięte', 'pinezka'); }
  catch (e) { komunikat(e.message, 'x'); }
}
async function usun(el) {
  const ok = await potwierdz('Usunąć?', el.length > 1 ? `${opisMediow(el)} zniknie ze wszystkich urządzeń.` : 'Zniknie ze wszystkich urządzeń.', 'Usuń');
  if (!ok) return false;
  try { for (const r of el) { await api(`/rzeczy/${r.id}`, { metoda: 'DELETE' }); S.rzeczy = S.rzeczy.filter((x) => x.id !== r.id); } S.wybrana = null; rysuj(); komunikat('Usunięte', 'kosz'); return true; }
  catch (e) { komunikat(e.message, 'x'); return false; }
}

// ---------- powiadomienia ----------
const b64u8 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
const pushDostepny = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
async function wlaczPowiadomienia() {
  if (!pushDostepny()) { komunikat(iOS && !zainstalowana ? 'Najpierw dodaj Łącznik do ekranu początkowego' : 'Ta przeglądarka nie obsługuje powiadomień', 'x'); return false; }
  const zg = await Notification.requestPermission();
  if (zg !== 'granted') { komunikat('Powiadomienia są zablokowane w ustawieniach', 'x'); return false; }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u8(S.vapid) });
  await api('/push', { metoda: 'POST', json: { subskrypcja: sub.toJSON() } });
  S.ja.push = true; komunikat('Powiadomienia włączone', 'dzwonek'); return true;
}
async function odnowPush() {
  try {
    if (!pushDostepny() || Notification.permission !== 'granted' || !S.vapid) return;
    const reg = await navigator.serviceWorker.ready; let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u8(S.vapid) });
    if (!S.ja.push) await api('/push', { metoda: 'POST', json: { subskrypcja: sub.toJSON() } });
  } catch {}
}

// ---------- ustawienia ----------
let kluczSkrotu = null;
function arkuszUstawien(odswiez = false) {
  const ja = S.urzadzenia.find((u) => u.id === S.ja?.id) || S.ja;
  const pushTu = pushDostepny() && Notification.permission === 'granted' && ja?.push;
  const urz = S.urzadzenia.map((u) => `<div class="wiersz-ust"><span class="znaczek" style="background:var(--pow2);color:var(--szary);border:1px solid var(--linia)">${ik(ikUrz(u.typ))}</span>
    <div class="t"><b>${esc(u.nazwa)}${u.id === S.ja?.id ? ' <span style="color:var(--akcent);font-size:12px">· to urządzenie</span>' : ''}</b>
    <span>${u.typ === 'skrot' ? 'Skrót iOS · ' : ''}${u.online ? 'aktywne teraz' : 'ostatnio ' + kiedy(u.ostatnio)}${u.push ? ' · powiadomienia' : ''}</span></div>
    ${u.id === S.ja?.id ? `<button class="p maly" data-u="zmien-nazwe">Zmień nazwę</button>` : `<button class="p maly uwaga" data-u="odlacz" data-id="${u.id}">Odłącz</button>`}</div>`).join('');
  const skrot = iOS || !dotyk ? `<h3>Menu „Udostępnij” na iPhonie</h3>
    <p>Na iPhonie Łącznik dodasz do menu Udostępnij przez aplikację Skróty. Ustawiasz to raz, potem w Zdjęciach i Plikach stukasz Udostępnij → Łącznik.</p>
    ${kluczSkrotu ? `<ol class="kroki">
      <li>Otwórz aplikację <b>Skróty</b>, stuknij <b>+</b> w prawym górnym rogu.</li>
      <li>Stuknij nazwę skrótu na górze → <b>Zmień nazwę</b>, wpisz <b>Łącznik</b>.</li>
      <li>Stuknij ikonę <b>ⓘ</b> na dole (albo strzałkę przy nazwie → <b>Szczegóły</b>), włącz <b>Pokaż w arkuszu udostępniania</b>, wróć.</li>
      <li>Na górze pojawi się „Odbiera <b>dowolne</b> z arkusza udostępniania”. Stuknij <b>dowolne</b> i zostaw zaznaczone tylko: <b>Obrazy</b>, <b>Multimedia</b>, <b>Pliki</b>, <b>PDF</b>.</li>
      <li>Stuknij <b>Dodaj czynność</b>, wyszukaj <b>Powtórz z każdym</b> i dodaj. Powinno tam stać „Powtórz z każdym elementem w <b>Dane wejściowe skrótu</b>”.</li>
      <li>Do środka pętli dodaj czynność <b>Pobierz zawartość adresu URL</b> (wyszukaj „URL”). W polu adresu wklej:<div class="kopiuj-pole"><code>${esc(API)}/udostepnij</code><button class="ikb bez" data-u="kop" data-t="${esc(API)}/udostepnij" aria-label="Kopiuj adres">${ik('kopiuj')}</button></div></li>
      <li>Rozwiń tę czynność (strzałka <b>›</b>). <b>Metoda</b>: POST. <b>Nagłówki</b>: dodaj nagłówek, klucz <b>Authorization</b>, wartość:<div class="kopiuj-pole"><code>Bearer ${esc(kluczSkrotu)}</code><button class="ikb bez" data-u="kop" data-t="Bearer ${esc(kluczSkrotu)}" aria-label="Kopiuj wartość">${ik('kopiuj')}</button></div></li>
      <li><b>Treść żądania</b>: wybierz <b>Plik</b>, a w polu Plik wybierz zmienną <b>Powtórzony element</b>.</li>
      <li>Pod pętlą dodaj czynność <b>Pokaż powiadomienie</b> z tekstem „Wysłano do Łącznika”. Stuknij <b>Gotowe</b>.</li>
      <li>Sprawdź: w Zdjęciach zaznacz zdjęcie → Udostępnij → <b>Łącznik</b>. Za pierwszym razem iPhone zapyta o zgodę na połączenie, stuknij <b>Zawsze pozwalaj</b>.</li></ol>
      <p>Linki i tekst: w dowolnej aplikacji stuknij Kopiuj, a w Łączniku przycisk <b>Wklej</b>.</p>`
      : `<button class="p glowny" data-u="klucz" style="margin-top:6px">${ik('skrot')}Pokaż instrukcję i utwórz klucz</button>`}` : '';
  const instal = !zainstalowana ? `<h3>Ikona na ekranie</h3><p>${iOS ? 'W Safari stuknij Udostępnij (kwadrat ze strzałką), potem „Do ekranu początkowego”. Dopiero wtedy działają powiadomienia.'
    : /Android/.test(navigator.userAgent) ? 'W Chrome stuknij ⋮ w prawym górnym rogu, potem „Dodaj do ekranu głównego” → „Zainstaluj”. Wtedy Łącznik pojawi się też w menu Udostępnij.'
    : 'W Edge albo Chrome kliknij ikonę instalacji na końcu paska adresu (monitor ze strzałką) albo menu ⋯ → Aplikacje → Zainstaluj. Łącznik dostanie własne okno i ikonę na pasku zadań.'}</p>` : '';
  const html = `<h2>Ustawienia</h2>
    <h3>Powiadomienia</h3>
    <div class="wiersz-ust"><span class="znaczek" style="background:var(--miekki);color:var(--akcent)">${ik('dzwonek')}</span>
      <div class="t"><b>${pushTu ? 'Włączone na tym urządzeniu' : 'Wyłączone na tym urządzeniu'}</b><span>Gdy Łącznik jest zamknięty, dostaniesz powiadomienie o nowej rzeczy.</span></div>
      ${pushTu ? `<button class="p maly" data-u="test-push">Wyślij próbne</button>` : `<button class="p maly glowny" data-u="push">Włącz</button>`}</div>
    <h3>Urządzenia</h3>${urz}
    ${skrot}${instal}
    <h3>To urządzenie</h3>
    <div class="wiersz-ust"><div class="t"><b>Rozłącz to urządzenie</b><span>Żeby wrócić, wpiszesz hasło jeszcze raz.</span></div><button class="p maly uwaga" data-u="wyloguj">${ik('wyloguj')}Rozłącz</button></div>
    <p style="margin-top:18px;font-size:12.5px">Łącznik ${WERSJA} · rzeczy znikają same po 14 dniach, kody po godzinie, przypięte zostają.</p>`;
  if (odswiez) { const a = $('#ark-ust'); if (a) { const sc = a.scrollTop; a.innerHTML = `<div class="uchwyt"></div><button class="ikb bez zamknij" data-a="zamknij-ark" aria-label="Zamknij">${ik('x')}</button>${html}`; a.scrollTop = sc; } return; }
  const z = arkusz(html, { id: 'ark-ust' });
  z.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-u]'); if (!b) return; const u = b.dataset.u;
    if (u === 'kop') return kopiuj(b.dataset.t);
    if (u === 'push') { b.disabled = true; try { if (await wlaczPowiadomienia()) await wczytajStan(); } catch (er) { komunikat(er.message, 'x'); } arkuszUstawien(true); }
    if (u === 'test-push') { try { await api('/push/test', { metoda: 'POST' }); komunikat('Wysłano próbne powiadomienie', 'dzwonek'); } catch (er) { komunikat(er.message, 'x'); } }
    if (u === 'klucz') { try { const r = await api('/klucz-skrotu', { metoda: 'POST', json: { nazwa: `${S.ja.nazwa} (Skrót)` } }); kluczSkrotu = r.klucz; arkuszUstawien(true); } catch (er) { komunikat(er.message, 'x'); } }
    if (u === 'odlacz') {
      const cel = S.urzadzenia.find((x) => x.id === Number(b.dataset.id));
      if (await potwierdz('Odłączyć urządzenie?', `„${cel?.nazwa}” przestanie mieć dostęp. Żeby wróciło, trzeba będzie wpisać hasło.`, 'Odłącz')) {
        try { await api(`/urzadzenia/${b.dataset.id}`, { metoda: 'DELETE' }); komunikat('Odłączone'); } catch (er) { komunikat(er.message, 'x'); }
      }
      arkuszUstawien();
    }
    if (u === 'zmien-nazwe') {
      const n = prompt('Nowa nazwa tego urządzenia', S.ja.nazwa); if (!n || !n.trim()) return;
      try { await api(`/urzadzenia/${S.ja.id}`, { metoda: 'PATCH', json: { nazwa: n.trim() } }); S.ja.nazwa = n.trim().slice(0, 40); localStorage.setItem('lacznik.ja', JSON.stringify(S.ja)); await wczytajStan(); arkuszUstawien(true); } catch (er) { komunikat(er.message, 'x'); }
    }
    if (u === 'wyloguj') {
      if (await potwierdz('Rozłączyć to urządzenie?', 'Żeby wrócić, wpiszesz hasło jeszcze raz.', 'Rozłącz')) {
        try { await api(`/urzadzenia/${S.ja.id}`, { metoda: 'DELETE' }); } catch {}
        wyloguj();
      } else arkuszUstawien();
    }
  });
}

// ---------- zdarzenia ----------
function podepnijZdarzenia() {
  const ta = $('#tekst');
  ta.addEventListener('input', () => { S.wymuszonyRodzaj = null; odswiezPisanie(); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !dotyk && !e.isComposing) { e.preventDefault(); if (!$('#wyslij').disabled) wyslij(); } });
  $('#pisz').addEventListener('submit', (e) => { e.preventDefault(); wyslij(); });
  $('#wybor-plikow').addEventListener('change', (e) => { dodajZalaczniki([...e.target.files]); e.target.value = ''; });
  const szukaj = (e) => { S.szukaj = e.target.value; S.wybrana = null; rysuj(); };
  $('#szukaj-lap').addEventListener('input', szukaj); $('#szukaj-tel').addEventListener('input', szukaj);
  app.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) {
      const k = e.target.closest('.karta.klik');
      if (k && !e.target.closest('a,button') && k.dataset.klucz && !k.dataset.klucz.startsWith('w-')) { S.wybrana = k.dataset.klucz; rysujListe(); rysujPodglad(); }
      return;
    }
    const a = b.dataset.a, id = b.dataset.id, r = id ? S.rzeczy.find((x) => x.id === id) : null;
    if (a === 'filtr') { S.filtr = b.dataset.f; S.wybrana = null; rysuj(); window.scrollTo({ top: 0 }); }
    else if (a === 'kopiuj' && r) kopiuj(r.rodzaj === 'link' ? r.url : r.rodzaj === 'kod' ? r.tekst.trim() : r.tekst, r.rodzaj === 'kod' ? 'Kod skopiowany' : 'Skopiowano');
    else if (a === 'menu' && r) menuRzeczy(r);
    else if (a === 'przegladaj') { if (matchMedia('(min-width: 1280px)').matches && S.wybrana !== b.dataset.grupa && b.classList.contains('mini')) { S.wybrana = b.dataset.grupa; rysujListe(); rysujPodglad(); } else przegladaj(b.dataset.grupa, id); }
    else if (a === 'zapisz') { const g = b.dataset.grupa ? grupuj(widoczneRzeczy()).find((x) => x.klucz === b.dataset.grupa) : null; zapisz(g ? g.el : r ? [r] : []); }
    else if (a === 'rozwin') { const t = b.closest('.karta').querySelector('.tresc'); t.classList.toggle('zwin'); b.textContent = t.classList.contains('zwin') ? 'Pokaż całość' : 'Zwiń'; }
    else if (a === 'przypnij' && r) { const g = grupuj(widoczneRzeczy()).find((x) => x.el.some((y) => y.id === r.id)); przypnij(g?.typ === 'media' ? g.el : [r], !r.przypiete); }
    else if (a === 'usun' && r) { const g = grupuj(widoczneRzeczy()).find((x) => x.el.some((y) => y.id === r.id)); usun(g?.typ === 'media' ? g.el : [r]); }
    else if (a === 'dodaj-plik') $('#wybor-plikow').click();
    else if (a === 'usun-zal') { const [z] = S.zalaczniki.splice(Number(b.dataset.i), 1); if (z?.podglad) URL.revokeObjectURL(z.podglad); odswiezPisanie(); }
    else if (a === 'wybierz-do') arkuszDo();
    else if (a === 'zmien-rodzaj') {
      const t = $('#tekst').value.trim(); const mozliwe = ['notatka', 'kod', ...(/^(https?:\/\/|www\.)\S+$/i.test(t) ? ['link'] : [])];
      const teraz = S.wymuszonyRodzaj || rozpoznaj(t); S.wymuszonyRodzaj = mozliwe[(mozliwe.indexOf(teraz) + 1) % mozliwe.length]; odswiezPisanie();
    }
    else if (a === 'wklej') { try { const t = await navigator.clipboard.readText(); if (t) { const ta2 = $('#tekst'); ta2.value = ta2.value ? ta2.value + '\n' + t : t; S.wymuszonyRodzaj = null; odswiezPisanie(); } } catch { $('#tekst').focus(); komunikat('Przytrzymaj pole i wybierz „Wklej”', 'wklej'); } }
    else if (a === 'anuluj') { const w = S.wysylki.find((x) => x.lid === Number(b.dataset.lid)); if (w) { w.anulowane = true; w.xhr?.abort(); if (w.id) api(`/wysylki/${w.id}`, { metoda: 'DELETE' }).catch(() => {}); S.wysylki = S.wysylki.filter((x) => x !== w); rysujListe(); } }
    else if (a === 'ustawienia') arkuszUstawien();
    else if (a === 'pokaz-szukaj') { const s = $('#szukaj-tel-r'); s.classList.toggle('ukryte'); if (!s.classList.contains('ukryte')) $('#szukaj-tel').focus(); else { $('#szukaj-tel').value = ''; S.szukaj = ''; rysuj(); } }
  });
  window.addEventListener('scroll', () => $('#gora')?.classList.toggle('przewiniete', scrollY > 4), { passive: true });
}
// wklejanie plików i tekstu (Ctrl+V w dowolnym miejscu)
document.addEventListener('paste', (e) => {
  if (!$('#glowny') || document.querySelector('.zaslona, .przegladarka')) return;
  const pliki = [...(e.clipboardData?.files || [])];
  if (pliki.length) { e.preventDefault(); dodajZalaczniki(pliki); return; }
  const cel = e.target; if (cel.closest && cel.closest('input, textarea')) return;
  const t = e.clipboardData?.getData('text'); if (t) { e.preventDefault(); const ta = $('#tekst'); ta.value = t; S.wymuszonyRodzaj = null; odswiezPisanie(); ta.focus(); }
});
// przeciąganie plików na okno
let licznikPrzec = 0;
const maPliki = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!maPliki(e) || !$('#glowny')) return; e.preventDefault();
  if (licznikPrzec++ === 0) { const d = document.createElement('div'); d.className = 'upusc'; d.innerHTML = `${ik('wgore')}<span>Upuść, żeby wysłać</span>`; document.body.append(d); }
});
window.addEventListener('dragover', (e) => { if (maPliki(e)) e.preventDefault(); });
window.addEventListener('dragleave', (e) => { if (!maPliki(e)) return; if (--licznikPrzec <= 0) { licznikPrzec = 0; document.querySelector('.upusc')?.remove(); } });
window.addEventListener('drop', (e) => {
  if (!maPliki(e)) return; e.preventDefault(); licznikPrzec = 0; document.querySelector('.upusc')?.remove();
  if ($('#glowny')) dodajZalaczniki([...e.dataTransfer.files]);
});
matchMedia('(min-width: 1280px)').addEventListener('change', () => rysuj());

// rzeczy przysłane z menu „Udostępnij” (Android, Windows) — odłożone przez service worker
async function odbierzUdostepnione() {
  if (!new URLSearchParams(location.search).has('udostepnione')) return;
  history.replaceState(null, '', location.pathname);
  try {
    const c = await caches.open('lacznik-udostepnione'); const o = await c.match('./udostepnione/opis'); if (!o) return;
    const opis = await o.json(); const pliki = [];
    for (const p of opis.pliki) { const r = await c.match(p.k); if (r) pliki.push(new File([await r.blob()], p.nazwa || 'plik', { type: p.typ })); }
    await caches.delete('lacznik-udostepnione');
    if (opis.tekst) { $('#tekst').value = opis.tekst; S.wymuszonyRodzaj = null; }
    dodajZalaczniki(pliki); odswiezPisanie();
    komunikat('Wybierz, dokąd wysłać, i stuknij strzałkę', 'udostepnij');
  } catch {}
}
function pokazRzecz(id) {
  if (!id) return; S.filtr = 'wszystko'; S.szukaj = '';
  const g = grupuj(widoczneRzeczy()).find((x) => x.el.some((y) => y.id === id)); if (!g) return;
  S.wybrana = g.klucz; S.nowe.add(g.klucz); rysuj();
  document.querySelector(`[data-klucz="${g.klucz}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.rzecz) wczytajStan().then(() => pokazRzecz(e.data.rzecz)).catch(() => {}); });

// ---------- start ----------
async function start() {
  if (!S.token) return ekranLogowania();
  szkielet(); rysuj(); odswiezPisanie();
  try { await wczytajStan(); } catch (e) { if (e.status !== 401) { S.zaladowano = true; rysuj(); komunikat(e.message, 'x'); } }
  if (!S.token) return;
  naZywo();
  odbierzUdostepnione();
  const p = new URLSearchParams(location.search).get('rzecz');
  if (p) { history.replaceState(null, '', location.pathname); pokazRzecz(p); }
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
start();
