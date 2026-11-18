#!/usr/bin/env bash
# Instaluje (albo aktualizuje) serwer Łącznika obok istniejących aplikacji.
# Dodaje tylko: /opt/lacznik (własny Node + kod), /var/lib/lacznik (baza i pliki), /etc/lacznik.env,
# użytkownika systemowego lacznik, usługę lacznik, polecenie lacznik-haslo i własną trasę w /etc/caddy/conf.d.
# Niczego innego nie zmienia. Przy błędzie trasy Caddy wycofuje ją.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1
DIR=/opt/lacznik
DANE=/var/lib/lacznik
PORT=18910

pytaj_o_haslo() {
  local H1 H2 O W=""
  if ! ( : </dev/tty ) 2>/dev/null; then
    echo "Nie mogę zapytać o hasło (brak terminala). Ustaw je poleceniem: lacznik-haslo"; return 0
  fi
  exec 3</dev/tty
  while :; do
    read -rsp "Wymyśl hasło do Łącznika (min. 4 znaki): " H1 <&3; echo
    [ "${#H1}" -ge 4 ] || { echo "Za krótkie, spróbuj jeszcze raz."; continue; }
    read -rsp "Wpisz je jeszcze raz: " H2 <&3; echo
    [ "$H1" = "$H2" ] && break
    echo "Hasła się różnią, spróbuj jeszcze raz."
  done
  if [ "${1:-}" = "zmiana" ]; then
    read -rp "Odłączyć wszystkie połączone urządzenia? Każde będzie musiało wpisać nowe hasło. (t/N): " O <&3
    [[ "$O" =~ ^[tT] ]] && W=--wyloguj-wszystkie
  fi
  exec 3<&-
  printf '%s' "$H1" | runuser -u lacznik -- env LACZNIK_DANE="$DANE" "$DIR/node/bin/node" --no-warnings "$DIR/app/ustaw-haslo.mjs" $W
}

main() {
[ "$(id -u)" -eq 0 ] || { echo "Uruchom jako root."; exit 1; }
command -v caddy >/dev/null || { echo "STOP: ten skrypt wymaga działającego Caddy."; exit 2; }
CF=/etc/caddy/Caddyfile
grep -q 'conf.d' "$CF" || { echo "STOP: Caddyfile nie wczytuje conf.d. Nic nie zmieniam."; exit 2; }
IP=$(curl -4fsS https://api.ipify.org)
HOST="${IP//./-}.sslip.io"
if ss -ltnpH "( sport = :$PORT )" | grep -q . && ! systemctl is-active --quiet lacznik; then
  echo "STOP: port $PORT jest zajęty przez inną aplikację. Nic nie zmieniam."; exit 2
fi
WOLNE=$(df --output=avail -B1 / | tail -1)
[ "$WOLNE" -gt $((4 * 1024 * 1024 * 1024)) ] || { echo "STOP: na dysku jest mniej niż 4 GB wolnego. Nic nie zmieniam."; exit 2; }

mkdir -p "$DIR" "$DANE"

# --- narzędzia do wersji zgodnych (HEIC → JPG, filmy z iPhone'a → MP4); doinstalowywane tylko, jeśli ich brak ---
BRAK=()
command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null || BRAK+=(ffmpeg)
command -v heif-convert >/dev/null || BRAK+=(libheif-examples)
if [ ${#BRAK[@]} -gt 0 ] || ! { dpkg -s libheif-plugin-libde265 >/dev/null 2>&1 || ! apt-cache show libheif-plugin-libde265 >/dev/null 2>&1; }; then
  echo "Doinstalowuję narzędzia do zdjęć HEIC i filmów z iPhone'a (inne aplikacje ich nie tracą)..."
  apt-get update -qq >/dev/null 2>&1 || true
  apt-cache show libheif-plugin-libde265 >/dev/null 2>&1 && BRAK+=(libheif-plugin-libde265)
  timeout 900 apt-get install -y -qq --no-install-recommends "${BRAK[@]}" >/dev/null 2>&1 || echo "UWAGA: nie udało się doinstalować: ${BRAK[*]} (Łącznik działa, tylko bez zamiany HEIC/filmów)"
fi

# --- własny Node (nie dotyka systemowego ani innych aplikacji) ---
case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) echo "STOP: nieznany procesor $(uname -m)"; exit 2 ;; esac
NODE="$DIR/node/bin/node"
if [ ! -x "$NODE" ] || [ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  echo "Pobieram Node.js 24 (tylko dla Łącznika)..."
  TMPN=$(mktemp -d)
  curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$TMPN/SUMS"
  FILE=$(grep -o "node-v[0-9.]*-linux-$ARCH.tar.xz" "$TMPN/SUMS" | head -1)
  curl -fsSL "https://nodejs.org/dist/latest-v24.x/$FILE" -o "$TMPN/$FILE"
  (cd "$TMPN" && grep " $FILE\$" SUMS | sha256sum -c - >/dev/null) || { echo "STOP: suma kontrolna Node się nie zgadza."; exit 2; }
  rm -rf "$DIR/node"; mkdir -p "$DIR/node"
  tar -xJf "$TMPN/$FILE" -C "$DIR/node" --strip-components=1
  rm -rf "$TMPN"
fi
echo "Node: $("$NODE" -v)"

# --- kod serwera z GitHuba ---
echo "Pobieram najnowszą wersję z GitHuba..."
TMP=$(mktemp -d)
curl -fsSL https://codeload.github.com/lewym90/lacznik/tar.gz/main | tar -xz -C "$TMP"
rm -rf "$DIR/app"; mkdir -p "$DIR/app"
cp -r "$TMP"/lacznik-main/serwer/. "$DIR/app/"
rm -rf "$TMP"

# --- konto systemowe i dane ---
id lacznik >/dev/null 2>&1 || useradd --system --no-create-home --home-dir "$DANE" --shell /usr/sbin/nologin lacznik
chown -R lacznik:lacznik "$DANE"; chmod 750 "$DANE"
[ -f /etc/lacznik.env ] || ( umask 077; printf 'PORT=%s\nLACZNIK_DANE=%s\n' "$PORT" "$DANE" > /etc/lacznik.env )

cat > /etc/systemd/system/lacznik.service <<EOF
[Unit]
Description=Łącznik — przerzucanie rzeczy między urządzeniami
After=network-online.target
[Service]
User=lacznik
Group=lacznik
EnvironmentFile=/etc/lacznik.env
WorkingDirectory=$DIR/app
ExecStart=$NODE --no-warnings $DIR/app/lacznik.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DANE
ProtectHome=true
PrivateTmp=true
MemoryMax=1200M
[Install]
WantedBy=multi-user.target
EOF

# --- polecenie do zmiany hasła ---
cat > /usr/local/bin/lacznik-haslo <<EOF
#!/usr/bin/env bash
# Zmienia wspólne hasło Łącznika.
set -euo pipefail
[ "\$(id -u)" -eq 0 ] || { echo "Uruchom jako root."; exit 1; }
DIR=$DIR; DANE=$DANE
$(declare -f pytaj_o_haslo)
pytaj_o_haslo zmiana
EOF
chmod 755 /usr/local/bin/lacznik-haslo

# --- trasa w Caddy: tylko własny plik w conf.d ---
LC=/etc/caddy/conf.d/lacznik.caddy
printf 'handle_path /lacznik-api/* {\n\treverse_proxy 127.0.0.1:%s {\n\t\tflush_interval -1\n\t}\n}\n' "$PORT" > "$LC"
chown --reference="$CF" "$LC"; chmod 644 "$LC"
if ! caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1; then rm -f "$LC"; echo "STOP: Caddy nie przyjął trasy. Wycofałem ją, nic się nie zmieniło."; exit 2; fi

systemctl daemon-reload
systemctl enable lacznik >/dev/null 2>&1
systemctl restart lacznik
if ! systemctl reload caddy; then
  rm -f "$LC"; systemctl reload caddy 2>/dev/null || true
  echo "STOP: Caddy nie przeładował konfiguracji. Wycofałem trasę Łącznika, Twoje aplikacje działają jak wcześniej."
  journalctl -u caddy -n 3 --no-pager | cut -c1-200; exit 2
fi

sleep 3
echo
if curl -fsS --max-time 20 "https://$HOST/lacznik-api/zdrowie" -o /tmp/lacznik-zdrowie.json; then
  echo "Status: OK  $(cat /tmp/lacznik-zdrowie.json)"
  if grep -q '"haslo":false' /tmp/lacznik-zdrowie.json; then
    echo
    echo "=============================================="
    echo "  Teraz ustaw hasło do Łącznika."
    echo "  Litery nie będą widoczne przy wpisywaniu, to normalne."
    echo "=============================================="
    pytaj_o_haslo
  else
    echo "Hasło jest już ustawione. Zmienisz je poleceniem: lacznik-haslo"
  fi
else
  echo "Status: BŁĄD, https://$HOST/lacznik-api/zdrowie nie odpowiada."
  journalctl -u lacznik -n 15 --no-pager
fi
echo; echo "Twoje pozostałe aplikacje:"
for u in "https://$HOST/midgard-api/zdrowie" "https://$HOST/smart-home-push/health" "https://planer.$HOST/" "https://dom.$HOST/" "https://$HOST/nav-tts/" "https://$HOST/trendo-api/zdrowie"; do
  echo "  $(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$u")  $u"
done
echo; echo "Wolne miejsce na dysku: $(df -h --output=avail / | tail -1 | tr -d ' ')"
echo "Aplikacja: https://lewym90.github.io/lacznik/"
echo; echo "ŁĄCZNIK GOTOWY"
}
main </dev/null
