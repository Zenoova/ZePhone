#!/usr/bin/env bash
# Runs the PBX interoperability tests (src-tauri/tests/pbx_freeswitch.rs) against a
# throw-away FreeSWITCH instance bound to 127.0.0.1:15060 with a random test password.
#
# Needs: `brew install freeswitch baresip` and `npm run sidecar`. Nothing is installed or
# modified outside a temporary directory, which is removed on exit.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Rust from rustup (Homebrew keeps it keg-only) when it is not already on PATH.
export PATH="$PATH:/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin"
FS_BIN="${FREESWITCH_BIN:-$(command -v freeswitch || true)}"
[[ -x "$FS_BIN" ]] || { echo "FreeSWITCH not found (brew install freeswitch, or set FREESWITCH_BIN)" >&2; exit 1; }
SRC_CONF="${FREESWITCH_CONF:-$(brew --prefix 2>/dev/null || echo /opt/homebrew)/etc/freeswitch}"
[[ -f "$SRC_CONF/vars.xml" ]] || { echo "FreeSWITCH config not found in $SRC_CONF (set FREESWITCH_CONF)" >&2; exit 1; }

PORT=15060
if lsof -nP -iUDP:"$PORT" >/dev/null 2>&1; then
  echo "UDP port $PORT is already in use (another FreeSWITCH?)" >&2
  exit 1
fi
# NB: the path must not contain "--" (FreeSWITCH expands it inside XML comments).
WORK="$(mktemp -d "${TMPDIR:-/tmp}zephone-fs.XXXXXX")"
PASSWORD="Zephone;Test-$RANDOM$RANDOM"
FS_PID=""
cleanup() {
  if [[ -n "$FS_PID" ]]; then
    "$FS_BIN" -stop -run "$WORK/run" >/dev/null 2>&1 || true   # graceful
    sleep 1
    kill -KILL "$FS_PID" 2>/dev/null || true                   # FreeSWITCH ignores SIGTERM in -nf mode
  fi
  [[ -n "${KEEP_WORKDIR:-}" ]] && echo "kept: $WORK" || rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$WORK"/{log,db,run,storage,recordings,cache,scripts,grammar,htdocs}
cp -RL "$SRC_CONF" "$WORK/conf"
# Loopback only, non-default ports, no STUN, no TLS, test password for directory users 1000-1019.
perl -pi -e '
  s{data="default_password=[^"]*"}{data="default_password='"$PASSWORD"'"/>\n  <X-PRE-PROCESS cmd="set" data="local_ip_v4=127.0.0.1"};
  s{data="bind_server_ip=auto"}{data="bind_server_ip=127.0.0.1"};
  s{data="internal_sip_port=\d+"}{data="internal_sip_port='"$PORT"'"};
  s{data="external_sip_port=\d+"}{data="external_sip_port=15080"};
  s{data="external_(rtp|sip)_ip=stun:[^"]*"}{data="external_$1_ip=127.0.0.1"};
  s{data="(internal|external)_ssl_enable=\w+"}{data="$1_ssl_enable=false"};
' "$WORK/conf/vars.xml"

echo "Starting FreeSWITCH on 127.0.0.1:$PORT ..."
"$FS_BIN" -nf -nonat -nonatmap -nocal -nc -conf "$WORK/conf" -log "$WORK/log" -db "$WORK/db" -run "$WORK/run" \
  -recordings "$WORK/recordings" -temp "$WORK/cache" -storage "$WORK/storage" -scripts "$WORK/scripts" \
  -htdocs "$WORK/htdocs" -grammar "$WORK/grammar" >"$WORK/stdout.log" 2>&1 &
FS_PID=$!

for _ in $(seq 1 40); do
  lsof -nP -iUDP:"$PORT" >/dev/null 2>&1 && break
  kill -0 "$FS_PID" 2>/dev/null || { echo "FreeSWITCH exited:" >&2; tail -5 "$WORK/stdout.log" >&2; exit 1; }
  sleep 0.5
done
lsof -nP -iUDP:"$PORT" >/dev/null 2>&1 || { echo "FreeSWITCH did not open UDP $PORT" >&2; exit 1; }

# The socket opens before the core is ready (REGISTER gets "503 Maximum Calls In Progress"
# until then): wait for any other answer (normally the 401 digest challenge).
python3 -I - "$PORT" <<'PY'
import socket, sys, time
port = int(sys.argv[1])
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(("127.0.0.1", 0)); s.settimeout(1)
me = s.getsockname()[1]
def probe(n):
    # A fresh branch/Call-ID each time: reusing them would be seen as a retransmission and
    # FreeSWITCH would just replay its cached "503" answer.
    return (f"REGISTER sip:127.0.0.1 SIP/2.0\r\nVia: SIP/2.0/UDP 127.0.0.1:{me};branch=z9hG4bKzephone{n};rport\r\n"
            f"Max-Forwards: 70\r\nFrom: <sip:1019@127.0.0.1>;tag={n}\r\nTo: <sip:1019@127.0.0.1>\r\n"
            f"Call-ID: zephone-probe-{n}\r\nCSeq: 1 REGISTER\r\nContact: <sip:1019@127.0.0.1:{me}>\r\n"
            f"Expires: 0\r\nContent-Length: 0\r\n\r\n").encode()
deadline = time.time() + 30
n = 0
while time.time() < deadline:
    n += 1
    try:
        s.sendto(probe(n), ("127.0.0.1", port))
        answer = s.recvfrom(2048)[0]
        status = answer.split(b"\r\n", 1)[0]
        if status.startswith(b"SIP/2.0 ") and b" 503 " not in status:
            sys.exit(0)
    except OSError:
        pass
    time.sleep(0.5)
sys.exit("FreeSWITCH never became ready")
PY
echo "FreeSWITCH is ready"

cd "$ROOT/src-tauri"
ZEPHONE_TEST_PBX="127.0.0.1:$PORT" ZEPHONE_TEST_PBX_PASSWORD="$PASSWORD" \
  cargo test --test pbx_freeswitch -- --nocapture --test-threads=1
