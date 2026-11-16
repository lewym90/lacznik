# Łącznik

Przerzucanie plików, zdjęć, notatek, linków i kodów między własnymi urządzeniami. Wrzucasz na jednym, a na drugim pojawia się od razu.

- Aplikacja: https://lewym90.github.io/lacznik/ (PWA, ikona na ekranie: iPhone, Android, Windows, Mac)
- Serwer: `serwer/` (Node 24, bez bibliotek, SQLite), na VPS pod `https://188-68-247-201.sslip.io/lacznik-api`

## Instalacja i aktualizacja serwera (Termius, jako root)

```
curl -fsSL https://raw.githubusercontent.com/lewym90/lacznik/main/serwer/install.sh | bash
```

Przy pierwszej instalacji skrypt zapyta o hasło. Zmiana hasła później: `lacznik-haslo`.

## Zasady

- Jedno wspólne hasło. Każde urządzenie wpisuje je raz i zostaje połączone na stałe; można je odłączyć w Ustawieniach.
- Rzeczy znikają po 14 dniach, kody po godzinie. Przypięte zostają.
- Limity: 5 GB łącznie, 2 GB na plik. Gdy na dysku serwera zostaje mniej niż 3 GB, pliki nie są przyjmowane.
- Rzecz wysłana na jedno urządzenie widzi tylko ono i nadawca.

## Testy

```
node test/serwer.test.mjs
```
