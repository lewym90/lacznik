// Łącznik — strona dla osoby, która dostała link (bez logowania).
const API = (localStorage.getItem('lacznik.api') || 'https://188-68-247-201.sslip.io/lacznik-api').replace(/\/+$/, '');
const app = document.getElementById('app');
const id = (location.hash.slice(1).match(/^[A-Za-z0-9_-]{20,40}/) || [''])[0];
const KLUCZ = 'lacznik.link.' + id;
let t = sessionStorage.getItem(KLUCZ) || '';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SC = {
  plik: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  foto: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/>',
  pobierz: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', klodka: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  zegar: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', ok: '<path d="M5 12l4 4 10-10"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
};
const ik = (n) => `<svg class="ik" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${SC[n] || ''}</svg>`;
function odmiana(n, a, b, c) { const m10 = n % 10, m100 = n % 100; return n === 1 ? a : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) ? b : c; }
function rozmiar(b) {
  if (b < 1024) return `${b} B`; if (b < 1024 ** 2) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(b < 10 * 1024 ** 2 ? 1 : 0).replace('.', ',')} MB`;
  return `${(b / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
}
function kiedyDo(w) {
  const r = w - Date.now();
  if (r < 3600e3) return `za ${Math.max(1, Math.round(r / 60e3))} min`;
  if (r < 48 * 3600e3) { const h = Math.round(r / 3600e3); return `za ${h} ${odmiana(h, 'godzinę', 'godziny', 'godzin')}`; }
  const d = Math.round(r / 86400e3); return `za ${d} ${odmiana(d, 'dzień', 'dni', 'dni')}`;
}
const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const jestApple = iOS || /Macintosh/.test(navigator.userAgent);
const naKomputerze = /Windows|Linux|CrOS/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent);
const potrzebaZgodnej = (p) => (!jestApple && /^image\/hei[cf]$/.test(p.mime || '')) || (naKomputerze && /^video\//.test(p.mime || '') && (p.kodek === 'hevc' || (!p.kodek && /quicktime/.test(p.mime))));
const qs = () => (t ? `t=${encodeURIComponent(t)}` : '');
const adres = (sciezka, extra = '') => `${API}/publiczne/${id}${sciezka}?${[qs(), extra].filter(Boolean).join('&')}`;
const czekaj = (ms) => new Promise((ok) => setTimeout(ok, ms));
function pobierz(href) { const a = document.createElement('a'); a.href = href; a.rel = 'noopener'; document.body.append(a); a.click(); a.remove(); }

const naglowek = `<div class="znak"><div class="logo" aria-hidden="true"></div><div class="napis">Łącznik</div></div>`;
function ekran(html) { app.innerHTML = `<div class="ramka">${naglowek}${html}<p class="stopka-publ">Udostępnione przez Łącznik · pliki nie są publiczne, ten link znasz tylko Ty</p></div>`; }
function blad(tytul, tekst) { ekran(`<div class="karta" style="align-items:center;text-align:center;padding:28px 22px"><div class="znaczek plik" style="width:56px;height:56px">${ik('zegar')}</div><h1 style="font-size:22px">${esc(tytul)}</h1><p style="margin:0;color:var(--szary)">${esc(tekst)}</p></div>`); }

async function wczytaj() {
  if (!id) return blad('Nieprawidłowy link', 'Sprawdź, czy skopiowałeś cały adres.');
  let d;
  try { const r = await fetch(adres('')); d = await r.json(); if (!r.ok) return blad('Link nie działa', d.blad || 'Ten link wygasł albo został już wykorzystany.'); }
  catch { return blad('Brak połączenia', 'Nie udało się połączyć z serwerem. Spróbuj za chwilę.'); }
  if (d.haslo && !d.pliki) return ekranHasla(d);
  pokazPliki(d);
}

function ekranHasla(d, komunikat = '') {
  ekran(`<form class="karta" id="f" novalidate style="padding:22px;gap:16px">
    <div style="display:flex;gap:12px;align-items:center"><div class="znaczek kod">${ik('klodka')}</div><div><h1 style="font-size:21px">Pliki chronione hasłem</h1><div class="meta">Link wygaśnie ${kiedyDo(d.wygasa)}</div></div></div>
    ${komunikat ? `<div class="blad" role="alert">${esc(komunikat)}</div>` : ''}
    <div class="pole"><label for="h">Hasło</label><input class="wej" id="h" type="password" autocomplete="off" autofocus></div>
    <button class="p glowny" type="submit" style="height:50px">Otwórz</button></form>`);
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const r = await fetch(`${API}/publiczne/${id}/otworz`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ haslo: document.getElementById('h').value }) });
    const o = await r.json().catch(() => ({}));
    if (!r.ok) return ekranHasla(d, o.blad || 'Nieprawidłowe hasło.');
    t = o.t; sessionStorage.setItem(KLUCZ, t); wczytaj();
  };
}

function pokazPliki(d) {
  const wiele = d.pliki.length > 1, tylkoCalosc = d.jednorazowy && wiele;
  const typIk = (p) => (/^video\//.test(p.mime) ? 'film' : /^image\//.test(p.mime) ? 'foto' : 'plik');
  const wiersze = d.pliki.map((p) => `<div class="wiersz-pliku">
      <div class="mini-p">${p.mini ? `<img alt="" loading="lazy" src="${esc(adres(`/mini/${p.id}`))}">` : ik(typIk(p))}</div>
      <div class="t"><b>${esc(p.nazwa)}</b><span>${rozmiar(p.rozmiar)}${potrzebaZgodnej(p) ? ` · pobierze się jako ${/^video\//.test(p.mime) ? 'MP4' : 'JPG'}` : ''}</span></div>
      ${tylkoCalosc ? '' : `<button class="p maly" data-p="${esc(p.id)}">${ik('pobierz')}Pobierz</button>`}</div>`).join('');
  ekran(`<h1>${esc(d.nazwa)}</h1>
    <div class="podinfo">${d.pliki.length} ${odmiana(d.pliki.length, 'plik', 'pliki', 'plików')} · ${rozmiar(d.suma)} · link wygaśnie ${kiedyDo(d.wygasa)}</div>
    ${d.jednorazowy ? `<div class="baner" style="margin:0">${ik('zegar')}<span>Link jednorazowy: po pobraniu przestanie działać.${tylkoCalosc ? ' Pobierzesz całość jako jeden plik ZIP.' : ''}</span></div>` : ''}
    ${wiele ? `<button class="p glowny" id="calosc" style="height:54px;font-size:16px">${ik('pobierz')}Pobierz wszystko (ZIP, ${rozmiar(d.suma)})</button>` : ''}
    <div class="karta" style="padding:6px">${wiersze}</div>
    ${!wiele ? `<button class="p glowny" data-p="${esc(d.pliki[0].id)}" style="height:54px;font-size:16px">${ik('pobierz')}Pobierz</button>` : ''}`);
  const po = () => { if (d.jednorazowy) setTimeout(() => blad('Pobieranie ruszyło', 'To był link jednorazowy, więc właśnie przestał działać. Plik zapisze się w Pobranych.'), 1200); };
  document.getElementById('calosc')?.addEventListener('click', () => { pobierz(adres('/zip')); po(); });
  app.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', async () => {
    const p = d.pliki.find((x) => x.id === b.dataset.p);
    if (potrzebaZgodnej(p)) {
      b.disabled = true; const stary = b.innerHTML;
      try {
        let s = await (await fetch(adres(`/konwersja/${p.id}`), { method: 'POST' })).json();
        while (s.stan === 'czeka' || s.stan === 'trwa') { b.textContent = `Przygotowuję ${Math.round((s.postep || 0) * 100)}%`; await czekaj(1200); s = await (await fetch(adres(`/konwersja/${p.id}`))).json(); }
        b.disabled = false; b.innerHTML = stary;
        if (s.stan === 'gotowe') { pobierz(`${API}${s.url}?${[qs(), 'pobierz=1'].filter(Boolean).join('&')}`); po(); return; }
      } catch { b.disabled = false; b.innerHTML = stary; }
    }
    pobierz(adres(`/plik/${p.id}`, 'pobierz=1')); po();
  }));
}

window.addEventListener("hashchange", () => location.reload());
wczytaj();
