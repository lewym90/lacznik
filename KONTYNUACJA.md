# Łącznik — notatki do kontynuacji

## Decyzje właściciela
- Cel: szybkie przerzucanie konkretnych rzeczy między jego urządzeniami i telefonem narzeczonej (iPhone x2, tablet z Androidem, laptop z Windows). To NIE jest kopia zapasowa ani zamiennik Dysku Google.
- Ma działać na każdym urządzeniu z przeglądarką, także przyszłym (np. Android).
- Logowanie: JEDNO wspólne hasło ustawione na serwerze, bez kont. Urządzenie wpisuje hasło raz i nigdy się nie wylogowuje (można je odłączyć w Ustawieniach).
- Wygląd: styl 3 „Jasny i świetlisty” (projekt „Łącznik — 3 style”), plus wersja nocna według systemu. Ikona i dwie ilustracje (logowanie, pusty ekran) to grafiki właściciela.
- Limity: 5 GB łącznie, 2 GB na plik, zawsze min. 3 GB wolnego na dysku serwera. Rzeczy znikają po 14 dniach, kody po godzinie, przypięte zostają.

## Technika
- Strona: GitHub Pages (main, root). `index.html`, `css/app.css`, `js/app.js`, `sw.js`, `manifest.webmanifest`. Wersja w 4 miejscach: `js/app.js` (WERSJA), `sw.js` (WERSJA), `index.html` (?v=), `serwer/lacznik.mjs` (WERSJA).
- Serwer: `serwer/lacznik.mjs`, Node 24 bez bibliotek (node:http, node:sqlite, crypto). Port 127.0.0.1:18910, usługa `lacznik` (użytkownik lacznik, ProtectSystem=strict, MemoryMax=300M), kod /opt/lacznik/app, Node /opt/lacznik/node, dane /var/lib/lacznik (lacznik.db, pliki/, miniatury/, wysylki/). Trasa Caddy /etc/caddy/conf.d/lacznik.caddy → https://188-68-247-201.sslip.io/lacznik-api (flush_interval -1 dla SSE).
- Instalacja/aktualizacja: `curl -fsSL https://raw.githubusercontent.com/lewym90/lacznik/main/serwer/install.sh | bash`. Hasło: `lacznik-haslo` (scrypt w tabeli ustawienia, opcjonalnie odłącza wszystkie urządzenia).
- Na serwerze są inne aplikacje właściciela. Nigdy nie ruszać Caddyfile ani cudzych plików w conf.d. Zajęte porty m.in. 8002, 8787–8797, 18123, 18787–18789, 18871, 18890, 18900.
- Na żywo: SSE `/na-zywo?t=TOKEN`. Pliki: wysyłka w kawałkach 8 MB z wznawianiem (`/wysylki`), miniatury robi urządzenie (canvas), serwer nie przetwarza zdjęć ani filmów. Adresy plików podpisane HMAC na urządzenie (`/plik/ID?u=&k=`), z obsługą Range (filmy).
- Powiadomienia: własna implementacja Web Push (VAPID ES256 + aes128gcm), sprawdzona w testach biblioteką http_ece. Push nie idzie do urządzenia, które ma aplikację na ekranie.
- Menu Udostępnij: Android/Windows przez `share_target` w manifeście (obsługa w sw.js). iPhone: właściciel uznał Skrót iOS za zbyt trudny, instrukcja usunięta z aplikacji (1.1.0); na iPhonie wysyła się przez „+” w Łączniku. Endpoint `/udostepnij` i `/klucz-skrotu` zostały na serwerze.
- Foldery (1.1.0): rzecz `rodzaj='folder'` + pliki z kolumnami `folder` i `sciezka` (podfoldery), `gotowy=0` podczas wysyłania, push dopiero po `/foldery/:id/koniec`. Przypinanie i usuwanie folderu obejmuje pliki. Limit 4 GB i 5000 plików na folder. Pobieranie hybrydowe (decyzja właściciela): gdzie jest `showDirectoryPicker` (Chrome/Edge na komputerze, Chrome na Androidzie) zapis całego folderu z podfolderami; gdzie nie ma (iPhone) ZIP z `/folder-zip/:id` (bez kompresji, CRC liczone przy wysyłce, długość znana z góry).
- Testy serwera: `node test/serwer.test.mjs` (opcjonalnie z http_ece w node_modules).

- Zaszyfrowany ZIP (1.2.0): menu „…” → „Zaszyfruj i pobierz” dla pliku, grupy zdjęć albo folderu. Tryby nazwane przez właściciela: „Mocny” (AES-256, WinZip AE-2: PBKDF2-SHA1 1000, AES-CTR z licznikiem LE, HMAC-SHA1 10 B) i „Zgodny ze wszystkimi urządzeniami” (ZipCrypto, otwiera Eksplorator Windows). POST /zip-szyfrowany tworzy zlecenie w pamięci (hasło nigdzie niezapisywane, 10 min), GET /zip-szyfrowany/:id strumieniuje ZIP. CRC liczone przy każdej wysyłce pliku (stare pliki: przy pierwszym szyfrowaniu). Maks. 4 GB. Testy: zipfile (ZipCrypto) i pyzipper (AES).

- 1.3.0 (wybrane przez właściciela z propozycji 1, 3, 4, 5):
  - Link dla osób spoza domu: menu „…” → „Udostępnij link” (plik, zdjęcia, folder). Ważność 1 h / 1 dzień / 7 dni, opcja jednorazowy (po pierwszym pełnym pobraniu; przy wielu plikach tylko ZIP całości), opcjonalne hasło (scrypt, token 2 h). Tabela `linki`. Strona odbiorcy `link.html` + `js/link.js` (adres `…/link.html#ID`), API `/publiczne/:id/...`. Znaczek linku na karcie (pole `linki`).
  - Dołączanie kodem: Ustawienia → „Dodaj urządzenie” → QR (`…/#dolacz=KOD`) i kod 8 znaków, ważny 10 min, wielokrotnego użytku (iPhone: Safari i aplikacja z ekranu mają osobną pamięć). Logowanie: „Mam kod z innego urządzenia”. QR: biblioteka qrcode-generator (MIT) w `js/qrcode.js`.
  - Cofnij po usunięciu: brak pytania, rzecz znika od razu, DELETE po 6 s (albo natychmiast przy zamknięciu aplikacji, keepalive).
  - Wersje zgodne: serwer przerabia HEIC → JPG (heif-convert, libheif + plugin libde265) i filmy HEVC z iPhone'a → MP4 H.264 do 1080p (ffmpeg, veryfast, CRF 22, nice 19, 1 film naraz). Kodek filmu wykrywany ffprobe po wysyłce (`kodek`). Na urządzeniach innych niż Apple HEIC pobiera się jako JPG; na komputerach (Windows/Linux) filmy HEVC jako MP4; w menu „Pobierz oryginał” / „Pobierz jako JPG/MP4”. Folder na laptopie: pytanie „Zamień na JPG i MP4” / „Zostaw oryginały”. Wyniki w /var/lib/lacznik/konwersje, kasowane z rzeczą. Usługa ma MemoryMax=1200M (ffmpeg). Filmy HDR po zamianie mogą mieć nieco bledsze kolory (bez mapowania tonów).

## Stan
- 1.0.0: pierwsza wersja, serwer zainstalowany przez właściciela.
- 1.3.0: link dla innych, dołączanie kodem QR, cofnij usunięcie, wersje zgodne JPG/MP4.
- 1.2.0: zaszyfrowany ZIP (mocny / zgodny ze wszystkimi urządzeniami).
- 1.1.0: foldery (wysyłanie przez „+ → Cały folder” albo przeciągnięcie, jedna karta z listą plików, pobieranie folderu albo ZIP), usunięta instrukcja Skrótu iOS. Aktualizacja serwera tą samą komendą instalacyjną.
