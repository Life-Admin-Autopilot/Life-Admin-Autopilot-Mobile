#!/usr/bin/env bash
# Preflight for "is the iOS build actually wired to the backend I just started?"
#
#   ./scripts/check-ios-backend.sh           # check the current ios/ state
#   npm run ios:check                        # same thing
#   ./scripts/check-ios-backend.sh --device  # assert it works on a real iPhone,
#                                            # not just the Simulator
#   ./scripts/check-ios-backend.sh --url URL # check a backend you name instead
#                                            # of the one baked into the bundle
#
# The failure this exists to catch is silent: `cap:sync:prod` and `cap:sync:dev`
# bake NEXT_PUBLIC_API_URL into the JS bundle at BUILD time, so the running app
# has no idea the backend moved. You get a spinner and a network error, not a
# config error. Everything below is read from what iOS will ACTUALLY load
# (ios/App/App/), never from what the env files merely intend.
#
# Read-only: it diagnoses and prints the fix, it never edits.
# Exit 0 = safe to run. Exit 1 = at least one blocking failure.
set -uo pipefail

cd "$(dirname "$0")/.."

PLIST="ios/App/App/Info.plist"
PLIST_BUDDY="/usr/libexec/PlistBuddy"
IOS_PUBLIC="ios/App/App/public"
IOS_CAP_CONFIG="ios/App/App/capacitor.config.json"

# --device turns "localhost backend" from a Simulator-only caveat into a hard
# failure — a physical iPhone resolves localhost to itself, so the call never
# leaves the phone.
TARGET_DEVICE=0
# --url skips reading the bundle and checks a URL you name instead. Use it to
# validate a backend BEFORE syncing a build against it.
URL_OVERRIDE=''
while [ $# -gt 0 ]; do
  case "$1" in
    --device) TARGET_DEVICE=1 ;;
    --simulator) TARGET_DEVICE=0 ;;
    --url) shift; URL_OVERRIDE="${1:-}"; [ -n "$URL_OVERRIDE" ] || { echo "--url needs a value" >&2; exit 1; } ;;
    --url=*) URL_OVERRIDE="${1#--url=}" ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
  shift
done

if [ -t 1 ]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
  BLUE=$'\033[34m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; DIM=''; BOLD=''; RESET=''
fi

FAILURES=0
WARNINGS=0

section() { printf '\n%s%s%s\n' "$BOLD" "$1" "$RESET"; }
pass()    { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn()    { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$1"; WARNINGS=$((WARNINGS + 1)); }
fail()    { printf '  %s✗%s %s\n' "$RED" "$RESET" "$1"; FAILURES=$((FAILURES + 1)); }
hint()    { printf '    %s→ %s%s\n' "$DIM" "$1" "$RESET"; }
info()    { printf '  %s·%s %s\n' "$BLUE" "$RESET" "$1"; }

die() { printf '\n%s✗ %s%s\n' "$RED" "$1" "$RESET"; exit 1; }

# --- env-file readers ------------------------------------------------------
# Last assignment wins (dotenv semantics); strips inline comments and quotes.
read_env() {
  local key="$1" file="$2" value
  [ -f "$file" ] || return 1
  value=$(grep -E "^[[:space:]]*${key}=" "$file" 2>/dev/null | tail -1) || return 1
  [ -n "$value" ] || return 1
  value="${value#*=}"
  value="${value%%#*}"
  value=$(printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")
  [ -n "$value" ] || return 1
  printf '%s' "$value"
}

url_host() { printf '%s' "$1" | sed -E 's#^[a-z]+://##; s#/.*##; s#:[0-9]+$##'; }

# The API URL a RUNNING `next dev` is actually serving, read out of the JS it
# emits. Next inlines NEXT_PUBLIC_* at build time, so the chunks are the only
# place that reflects process-env overrides (what `npm run app` uses) as well as
# .env files. Prints nothing if the server is down or nothing matches.
served_api_url() {
  local origin="$1" html chunk found
  html=$(curl -sf -m 5 "$origin/" 2>/dev/null) || return 0

  # App-code chunks only. Vendor bundles carry unrelated http:// literals, and
  # the first match across everything would be a coin flip.
  for chunk in $(printf '%s' "$html" \
    | grep -oE '/_next/static/chunks/[a-zA-Z0-9_./-]+\.js' \
    | grep -vE '/chunks/(0w8k|turbopack)' | sort -u); do
    found=$(curl -sf -m 5 "$origin$chunk" 2>/dev/null \
      | grep -oE 'https?://[a-zA-Z0-9._-]+(:[0-9]+)?/?"' \
      | sed -E 's#/?"$##' \
      | grep -E ':[0-9]{2,5}$' \
      | grep -v ":$(printf '%s' "$origin" | sed -nE 's#.*:([0-9]+)$#\1#p')\$" \
      | sort -u | head -1)
    [ -n "$found" ] && { printf '%s' "${found%/}"; return 0; }
  done
}

url_port() {
  local url="$1" port
  port=$(printf '%s' "$url" | sed -nE 's#^[a-z]+://[^/]*:([0-9]+).*#\1#p')
  if [ -n "$port" ]; then printf '%s' "$port"; return; fi
  case "$url" in https://*) printf '443' ;; *) printf '80' ;; esac
}

is_private_host() {
  case "$1" in
    10.*|192.168.*|127.*|localhost|*.local) return 0 ;;
    172.1[6-9].*|172.2[0-9].*|172.3[01].*) return 0 ;;
    *) return 1 ;;
  esac
}

printf '%sKitto — iOS ⇄ backend preflight%s\n' "$BOLD" "$RESET"
printf '%sTarget: %s%s\n' "$DIM" "$([ "$TARGET_DEVICE" -eq 1 ] && echo 'physical iPhone' || echo 'Simulator (pass --device for a real phone)')" "$RESET"

# --- 1. the native project exists and has been synced ----------------------
section '1. Native project'

[ -d ios ] || die "No ios/ directory. Run: npx cap add ios"
[ -f "$PLIST" ] || die "Missing $PLIST — the ios/ project is incomplete. Run: npx cap add ios"
pass "ios/ project present"

LIVE_RELOAD_URL=''
if [ -f "$IOS_CAP_CONFIG" ]; then
  LIVE_RELOAD_URL=$(node -e "
    try { const c = require('./$IOS_CAP_CONFIG'); process.stdout.write((c.server && c.server.url) || '') }
    catch { process.stdout.write('') }
  " 2>/dev/null)
fi

# --- 2. what the app will actually call ------------------------------------
section '2. API URL baked into the build'

# Candidates come from the env profiles, so a match also tells us WHICH profile
# produced the bundle — far more useful than a bare URL.
declare -a CAND_URLS=() CAND_FILES=()
for f in .env.native-dev.local .env.production .env.local .env; do
  v=$(read_env NEXT_PUBLIC_API_URL "$f") || continue
  v="${v%/}"
  dup=0
  for existing in "${CAND_URLS[@]:-}"; do [ "$existing" = "$v" ] && dup=1; done
  [ "$dup" -eq 1 ] && continue
  CAND_URLS+=("$v")
  CAND_FILES+=("$f")
done

API_URL=''
API_SOURCE=''

if [ -n "$URL_OVERRIDE" ]; then
  API_URL="${URL_OVERRIDE%/}"; API_SOURCE='--url override'
  pass "API URL: ${BOLD}${API_URL}${RESET}  ${DIM}(--url override, bundle NOT inspected)${RESET}"
  warn "Checking a URL you named, not what the build actually contains"
elif [ -n "$LIVE_RELOAD_URL" ]; then
  # Live-reload: the webview loads from `next dev`, so the API URL comes from
  # whatever env file that RUNNING server read at startup — not from the bundle.
  info "Live-reload is active — webview loads from $LIVE_RELOAD_URL"

  # Ask the RUNNING dev server, not the env files. `npm run app` passes
  # NEXT_PUBLIC_API_URL as a process env var (which Next prefers over .env
  # files) precisely so it never has to rewrite .env.local — so a file read here
  # reports localhost and invents two blocking failures that do not exist.
  # Next inlines NEXT_PUBLIC_* into the JS chunks, so the served bundle is the
  # only ground truth, exactly like the bundle grep the static branch does below.
  API_URL=$(served_api_url "$LIVE_RELOAD_URL")

  if [ -n "$API_URL" ]; then
    API_SOURCE='served by the running `next dev`'
    pass "API URL: ${BOLD}${API_URL}${RESET}  ${DIM}(${API_SOURCE})${RESET}"
  else
    # Falling back to the files is still worth doing — the dev server may simply
    # not be running yet — but say so, so a stale answer is never mistaken for a
    # measured one.
    for f in .env.local .env; do
      v=$(read_env NEXT_PUBLIC_API_URL "$f") || continue
      API_URL="${v%/}"; API_SOURCE="$f"
      break
    done

    if [ -z "$API_URL" ]; then
      fail "No NEXT_PUBLIC_API_URL in .env.local or .env — the dev server has nothing to serve"
      hint "Set NEXT_PUBLIC_API_URL in .env.local"
    else
      warn "Could not read the API URL from the running dev server — falling back to $API_SOURCE"
      hint "Start it with \`npm run app\` (or \`npm run dev\`) for a measured answer instead of a guessed one"
      pass "API URL: ${BOLD}${API_URL}${RESET}  ${DIM}(from ${API_SOURCE}, NOT verified against the running server)${RESET}"
    fi
  fi
else
  [ -d "$IOS_PUBLIC" ] || die "No $IOS_PUBLIC — the web build was never synced. Run: npm run cap:sync:dev"

  i=0
  for cand in "${CAND_URLS[@]:-}"; do
    if grep -rqF "$cand" "$IOS_PUBLIC" 2>/dev/null; then
      API_URL="$cand"; API_SOURCE="${CAND_FILES[$i]}"
      break
    fi
    i=$((i + 1))
  done

  if [ -z "$API_URL" ]; then
    # No known profile matched — surface whatever is in there so the mismatch
    # is visible rather than mysterious.
    found=$(grep -rhoE 'https?://[a-zA-Z0-9._-]+:[0-9]{2,5}' "$IOS_PUBLIC" 2>/dev/null | sort -u | head -5 | tr '\n' ' ')
    fail "Could not find any known NEXT_PUBLIC_API_URL in the synced bundle"
    [ -n "$found" ] && hint "URLs present in the bundle: $found"
    hint "Rebuild and sync: npm run cap:sync:dev"
  else
    pass "API URL: ${BOLD}${API_URL}${RESET}  ${DIM}(baked from ${API_SOURCE})${RESET}"
  fi
fi

[ -n "$API_URL" ] || { printf '\n%sCannot continue without an API URL.%s\n' "$RED" "$RESET"; exit 1; }

API_HOST=$(url_host "$API_URL")
API_PORT=$(url_port "$API_URL")

# The placeholder prod URL reaching a native build is always a mistake.
if [ "$API_HOST" = "api.example.com" ]; then
  fail "The bundle points at the api.example.com PLACEHOLDER — no real backend is there"
  hint "For device/simulator dev run: npm run cap:sync:dev"
  hint "Or set a real URL in .env.production before a prod sync"
fi

# --- 3. the backend is up on that port -------------------------------------
section '3. Backend on port '"$API_PORT"

# Everything below splits on this: a LAN/loopback host means the backend is the
# local Express server (probe it, compare its PORT), a public host means it is a
# deployment (probe the URL itself, server/.env is irrelevant).
IS_LOCAL_BACKEND=0
is_private_host "$API_HOST" && IS_LOCAL_BACKEND=1

SERVER_PORT=$(read_env PORT server/.env) || SERVER_PORT=4000

probe_health() {
  curl -sS -m 4 -o /dev/null -w '%{http_code}' "$1/health" 2>/dev/null
}

HEALTH_BODY=''
LOOPBACK_CODE=''

if [ "$IS_LOCAL_BACKEND" -eq 0 ]; then
  info "Remote backend ${API_HOST} — server/.env (PORT=${SERVER_PORT}) does not apply"
  REMOTE_CODE=$(probe_health "$API_URL")
  if [ "$REMOTE_CODE" = "200" ]; then
    pass "Remote backend answering (200 /health)"
  elif [ "$REMOTE_CODE" = "000" ] || [ -z "$REMOTE_CODE" ]; then
    fail "No response from ${API_URL}/health — DNS, TLS, or the host is down"
  else
    fail "${API_URL}/health returned HTTP ${REMOTE_CODE}"
  fi
else
  # server/.env describes the NODE backend. The .NET port (docs/TESTING.md, and
  # what `npm run app` starts) is a different server on a different port, so a
  # disagreement is only a failure when nothing is actually listening — if the
  # app's port answers /health, the app's port is right regardless of what
  # server/.env wants.
  if [ "$SERVER_PORT" = "$API_PORT" ]; then
    pass "App port :${API_PORT} matches server/.env PORT=${SERVER_PORT}"
  elif [ "$(probe_health "http://127.0.0.1:${API_PORT}")" = "200" ]; then
    info "App calls :${API_PORT}; server/.env says PORT=${SERVER_PORT} — a different backend is on :${API_PORT}, and it is answering"
  else
    fail "Port mismatch: the app calls :${API_PORT}, nothing is listening there, and server/.env says PORT=${SERVER_PORT}"
    hint "Start the backend on :${API_PORT}, or point NEXT_PUBLIC_API_URL at :${SERVER_PORT} and re-sync"
  fi

  HEALTH_BODY=$(curl -sS -m 4 "http://127.0.0.1:${API_PORT}/health" 2>/dev/null)
  LOOPBACK_CODE=$(probe_health "http://127.0.0.1:${API_PORT}")

  if [ "$LOOPBACK_CODE" = "200" ]; then
    pass "Backend answering on 127.0.0.1:${API_PORT} (200 /health)"
  elif [ "$LOOPBACK_CODE" = "503" ]; then
    fail "Backend is up but /health says degraded — Mongo is not connected"
    hint "Response: $HEALTH_BODY"
    hint "Start Mongo (brew services start mongodb-community) or check MONGODB_URI in server/.env"
  elif [ -n "$LOOPBACK_CODE" ] && [ "$LOOPBACK_CODE" != "000" ]; then
    fail "Something is on :${API_PORT} but /health returned HTTP ${LOOPBACK_CODE}"
    occupant=$(lsof -nP -iTCP:"${API_PORT}" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1" (pid "$2")"}')
    [ -n "$occupant" ] && hint "Listening process: $occupant — is that the Kitto server?"
  else
    fail "Nothing is listening on port ${API_PORT}"
    hint "Start it: cd server && npm run dev"
  fi

  if printf '%s' "$HEALTH_BODY" | grep -q '"db":"connected"'; then
    pass "Mongo connected"
  fi
fi

# --- 4. reachable from the device ------------------------------------------
section '4. Reachability from the device'

LAN_IP=$(./scripts/lan-ip.sh 2>/dev/null) || LAN_IP=''

if [ "$API_HOST" = "localhost" ] || [ "$API_HOST" = "127.0.0.1" ]; then
  if [ "$TARGET_DEVICE" -eq 1 ]; then
    fail "API host is ${API_HOST} — on a physical iPhone that resolves to the PHONE, not your Mac"
    [ -n "$LAN_IP" ] && hint "Set NEXT_PUBLIC_API_URL=http://${LAN_IP}:${API_PORT} in .env.native-dev.local, then: npm run cap:sync:dev"
  else
    pass "localhost works on the Simulator (it shares the Mac's network stack)"
    warn "This build will NOT work on a physical iPhone"
  fi
elif is_private_host "$API_HOST"; then
  if [ -z "$LAN_IP" ]; then
    warn "Could not determine this Mac's LAN IP (offline?) — skipping the IP-drift check"
  elif [ "$API_HOST" = "$LAN_IP" ]; then
    pass "API host ${API_HOST} matches this Mac's current LAN IP"
  else
    fail "LAN IP drift: the app calls ${API_HOST}, but this Mac is now ${LAN_IP}"
    hint "Update NEXT_PUBLIC_API_URL in .env.native-dev.local to http://${LAN_IP}:${API_PORT}, then: npm run cap:sync:dev"
  fi

  # Proves the server bound 0.0.0.0 and no firewall is in the way — a loopback
  # 200 says nothing about either.
  if [ -n "$LAN_IP" ]; then
    LAN_CODE=$(probe_health "http://${LAN_IP}:${API_PORT}")
    if [ "$LAN_CODE" = "200" ] || [ "$LAN_CODE" = "503" ]; then
      pass "Backend reachable over the LAN at ${LAN_IP}:${API_PORT}"
    else
      fail "Backend is NOT reachable at ${LAN_IP}:${API_PORT} — the phone can't reach it either"
      hint "The server may be bound to 127.0.0.1 only, or macOS is blocking incoming connections for node"
    fi
  fi
else
  pass "Remote host ${API_HOST} — reachable from any network, no LAN requirement"
fi

# Live-reload adds a second hop: the webview itself must load over the LAN.
if [ -n "$LIVE_RELOAD_URL" ]; then
  LR_HOST=$(url_host "$LIVE_RELOAD_URL")
  LR_PORT=$(url_port "$LIVE_RELOAD_URL")
  LR_CODE=$(curl -sS -m 4 -o /dev/null -w '%{http_code}' "$LIVE_RELOAD_URL" 2>/dev/null)
  if [ "$LR_CODE" = "200" ]; then
    pass "Live-reload server answering at ${LIVE_RELOAD_URL}"
  else
    fail "Live-reload server at ${LIVE_RELOAD_URL} is not responding (got '${LR_CODE:-nothing}')"
    hint "Start it: npm run dev"
  fi
  if [ "$TARGET_DEVICE" -eq 1 ] && { [ "$LR_HOST" = "localhost" ] || [ "$LR_HOST" = "127.0.0.1" ]; }; then
    fail "Live-reload URL is ${LR_HOST} — a physical iPhone cannot load the app from it"
    [ -n "$LAN_IP" ] && hint "npm run ios:dev resolves the LAN IP automatically; re-run it"
  fi
  if [ -n "$LAN_IP" ] && [ "$LR_HOST" != "$LAN_IP" ] && is_private_host "$LR_HOST" && [ "$LR_HOST" != "localhost" ]; then
    warn "Live-reload host ${LR_HOST} is not this Mac's current LAN IP (${LAN_IP})"
  fi
  LIVE_ORIGIN="${LIVE_RELOAD_URL%/}"
  [ -n "$LR_PORT" ] || LIVE_ORIGIN="$LIVE_ORIGIN"
fi

# --- 5. CORS ----------------------------------------------------------------
section '5. CORS allowlist'

# In live-reload the webview's origin becomes the dev-server origin; otherwise
# WKWebView sends capacitor://localhost.
if [ -n "$LIVE_RELOAD_URL" ]; then
  WEBVIEW_ORIGIN="${LIVE_RELOAD_URL%/}"
else
  WEBVIEW_ORIGIN='capacitor://localhost'
fi

CORS_CONFIGURED=$(read_env CORS_ORIGINS server/.env) || CORS_CONFIGURED=''

# Prefer asking the RUNNING server: server/.env may have been edited since it
# booted, and the allowlist is only read at startup.
CORS_PROBE_URL=''
if [ "$IS_LOCAL_BACKEND" -eq 1 ] && { [ "$LOOPBACK_CODE" = "200" ] || [ "$LOOPBACK_CODE" = "503" ]; }; then
  CORS_PROBE_URL="http://127.0.0.1:${API_PORT}"
elif [ "$IS_LOCAL_BACKEND" -eq 0 ] && [ "${REMOTE_CODE:-}" = "200" ]; then
  CORS_PROBE_URL="$API_URL"
fi

if [ -n "$CORS_PROBE_URL" ]; then
  ACAO=$(curl -sS -m 4 -D - -o /dev/null -H "Origin: ${WEBVIEW_ORIGIN}" \
    "${CORS_PROBE_URL}/health" 2>/dev/null \
    | grep -i '^access-control-allow-origin:' | tr -d '\r' | sed 's/^[^:]*:[[:space:]]*//')
  if [ -n "$ACAO" ]; then
    pass "Running server accepts Origin ${WEBVIEW_ORIGIN}"
  else
    fail "Running server REJECTS Origin ${WEBVIEW_ORIGIN} — every request from the app will fail"
    hint "Add it to CORS_ORIGINS in server/.env, then restart the server"
    [ -n "$CORS_CONFIGURED" ] && hint "Currently: ${CORS_CONFIGURED}"
  fi
elif [ "$IS_LOCAL_BACKEND" -eq 1 ]; then
  info "Server not reachable — checking server/.env statically instead"
  case ",${CORS_CONFIGURED}," in
    *",${WEBVIEW_ORIGIN},"*) pass "CORS_ORIGINS lists ${WEBVIEW_ORIGIN}" ;;
    *) fail "CORS_ORIGINS does not list ${WEBVIEW_ORIGIN}"; hint "Add it in server/.env" ;;
  esac
else
  warn "Remote backend unreachable — cannot verify it accepts Origin ${WEBVIEW_ORIGIN}"
fi

# The live-reload origin is not used by a bundled build, so this is a warning
# rather than a failure — but ios:dev fails outright without it, so check it now.
#
# Probe the RUNNING server rather than reading server/.env: the allowlist is
# read once at boot, so an edited-but-not-restarted server still rejects the
# origin while the file looks correct. A static check would report a false
# all-clear in exactly the case people hit most.
if [ -n "$LAN_IP" ] && [ -z "$LIVE_RELOAD_URL" ]; then
  LR_ORIGIN="http://${LAN_IP}:3000"
  if [ -n "$CORS_PROBE_URL" ]; then
    LR_ACAO=$(curl -sS -m 4 -D - -o /dev/null -H "Origin: ${LR_ORIGIN}" \
      "${CORS_PROBE_URL}/health" 2>/dev/null \
      | grep -i '^access-control-allow-origin:' | tr -d '\r' | sed 's/^[^:]*:[[:space:]]*//')
    if [ -n "$LR_ACAO" ]; then
      pass "Running server also accepts ${LR_ORIGIN} (live-reload ready)"
    else
      warn "Running server rejects ${LR_ORIGIN} — npm run ios:dev would fail every request"
      if printf '%s' "$CORS_CONFIGURED" | grep -qF "${LR_ORIGIN}"; then
        hint "server/.env already lists it — the server has not been RESTARTED since the edit"
      else
        hint "Add ${LR_ORIGIN} to CORS_ORIGINS in server/.env, then restart the server"
        [ -n "$CORS_CONFIGURED" ] && hint "Currently: ${CORS_CONFIGURED}"
      fi
    fi
  elif [ -n "$CORS_CONFIGURED" ] && ! printf '%s' "$CORS_CONFIGURED" | grep -qF "${LR_ORIGIN}"; then
    warn "CORS_ORIGINS does not list ${LR_ORIGIN} — live-reload (ios:dev) would fail"
    hint "Harmless for bundled builds; add it in server/.env before using ios:dev"
  fi
fi

# --- 6. App Transport Security ---------------------------------------------
section '6. iOS App Transport Security'

plist_bool() { "$PLIST_BUDDY" -c "Print :$1" "$PLIST" 2>/dev/null; }

ATS_LOCAL=$(plist_bool 'NSAppTransportSecurity:NSAllowsLocalNetworking')
ATS_LOCAL_DESC=$(plist_bool 'NSLocalNetworkUsageDescription')

case "$API_URL" in
  http://*)
    if [ "$ATS_LOCAL" = "true" ]; then
      pass "NSAllowsLocalNetworking is set — plaintext http:// to the LAN is permitted"
    else
      fail "API URL is plaintext http:// but NSAllowsLocalNetworking is not set — iOS will block every call"
      hint "Run: ./scripts/patch-ios-plist.sh --local-http"
    fi
    if [ -n "$ATS_LOCAL_DESC" ]; then
      pass "NSLocalNetworkUsageDescription present (iOS 14+ needs it to even prompt)"
    else
      fail "NSLocalNetworkUsageDescription missing — iOS 14+ fails the first LAN call instead of prompting"
      hint "Run: ./scripts/patch-ios-plist.sh --local-http"
    fi
    ;;
  https://*)
    pass "API URL is https:// — no ATS exception needed"
    if [ "$ATS_LOCAL" = "true" ]; then
      warn "ATS is still relaxed from a --local-http run — do NOT ship this build"
      hint "Re-patch clean: ./scripts/patch-ios-plist.sh"
    fi
    ;;
esac

# --- 7. sync freshness ------------------------------------------------------
section '7. Sync freshness'

if [ -n "$URL_OVERRIDE" ]; then
  info "Skipped — --url bypasses the bundle"
elif [ -n "$LIVE_RELOAD_URL" ]; then
  info "Live-reload serves the web app directly — the bundled copy is not used"
elif [ -d out ] && [ -d "$IOS_PUBLIC" ]; then
  if grep -rqF "$API_URL" out 2>/dev/null; then
    pass "out/ and ios/ agree on ${API_URL}"
  else
    out_url=$(for c in "${CAND_URLS[@]:-}"; do grep -rqF "$c" out 2>/dev/null && { printf '%s' "$c"; break; }; done)
    fail "out/ was rebuilt with ${out_url:-a different URL} but ios/ still has ${API_URL}"
    hint "Run: npx cap sync ios"
  fi
  if [ "$IOS_PUBLIC/index.html" -ot "out/index.html" ]; then
    warn "ios/ copy is older than out/ — an unsynced rebuild happened"
    hint "Run: npx cap sync ios"
  fi
fi

# --- 8. deep-link scheme ----------------------------------------------------
# Not a port, but the same class of bug: a backend↔iOS contract that only
# breaks at runtime. The server mints <scheme>:// links for email verification
# and the Google OAuth return leg; if the plist doesn't register that scheme,
# every one of those links opens nothing.
section '8. Deep-link scheme'

SERVER_SCHEME=$(read_env APP_DEEP_LINK_SCHEME server/.env) || SERVER_SCHEME='kitto'
PLIST_SCHEME=$("$PLIST_BUDDY" -c 'Print :CFBundleURLTypes:0:CFBundleURLSchemes:0' "$PLIST" 2>/dev/null)

if [ -z "$PLIST_SCHEME" ]; then
  fail "No CFBundleURLSchemes registered — every ${SERVER_SCHEME}:// link the server sends opens nothing"
  hint "Run: ./scripts/patch-ios-plist.sh"
elif [ "$PLIST_SCHEME" = "$SERVER_SCHEME" ]; then
  pass "Scheme matches: ${SERVER_SCHEME}://"
else
  fail "Scheme mismatch: server mints ${SERVER_SCHEME}:// but iOS registers ${PLIST_SCHEME}://"
  hint "Set APP_DEEP_LINK_SCHEME=${PLIST_SCHEME} in server/.env and restart, or re-register in patch-ios-plist.sh"
fi

# --- summary ----------------------------------------------------------------
printf '\n'
if [ "$FAILURES" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
  printf '%s✓ All checks passed — the iOS build is wired to %s%s\n' "$GREEN" "$API_URL" "$RESET"
elif [ "$FAILURES" -eq 0 ]; then
  printf '%s✓ No blockers%s (%d warning(s)) — the iOS build should reach %s\n' "$GREEN" "$RESET" "$WARNINGS" "$API_URL"
else
  printf '%s✗ %d blocking issue(s)%s, %d warning(s). The app will not reach the backend as-is.\n' \
    "$RED" "$FAILURES" "$RESET" "$WARNINGS"
  exit 1
fi
