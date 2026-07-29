#!/usr/bin/env bash
# Reapplies Info.plist keys that `npx cap add ios` / `npx cap sync` cannot
# preserve. `ios/` is gitignored and fully regenerated (docs/CAPACITOR.md), so
# every native permission string has to live here or it is silently lost on the
# next regenerate — taking the feature that depends on it down with it.
#
#   ./scripts/patch-ios-plist.sh                # product keys only (prod-safe)
#   ./scripts/patch-ios-plist.sh --local-http   # + plaintext-LAN dev concession
#
# Idempotent: every key is deleted before being re-added, so repeated runs
# converge rather than erroring on "key already exists".
set -euo pipefail

PLIST="ios/App/App/Info.plist"
PLIST_BUDDY="/usr/libexec/PlistBuddy"
ALLOW_LOCAL_HTTP=0

for arg in "$@"; do
  case "$arg" in
    --local-http) ALLOW_LOCAL_HTTP=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

if [ ! -f "$PLIST" ]; then
  echo "Missing $PLIST — run 'npx cap add ios' first." >&2
  exit 1
fi

# Delete-then-add keeps this idempotent. PlistBuddy exits non-zero when the key
# is absent, which is the normal first-run case, so the delete is best-effort.
set_string() {
  "$PLIST_BUDDY" -c "Delete :$1" "$PLIST" 2>/dev/null || true
  "$PLIST_BUDDY" -c "Add :$1 string $2" "$PLIST"
}

# --- Product keys (always applied; safe to ship) ---------------------------

# Home-screen name. Capacitor writes appName here at `cap add` time only, so a
# later appName change in capacitor.config.ts does not reach an existing ios/
# project — this keeps the two in sync on every sync.
set_string CFBundleDisplayName "Kitto"

# @capacitor/camera, document scanning (lib/documentScan/useCaptureSource.ts).
#
# All THREE keys are mandatory, even though the flow only ever uses
# CameraSource.Camera and never touches the photo library. The plugin's
# checkUsageDescriptions() walks *every* case of CameraPropertyListKeys and
# rejects the call if any one is absent — it does not look at which source was
# requested. Drop either photo-library key and "Take a photo" fails with
# "You are missing NS…UsageDescription… Camera will not function without it",
# which the UI surfaced as a generic "Could not process that scan."
set_string NSCameraUsageDescription \
  "Kitto uses your camera to scan documents so it can pull out bills, appointments, and deadlines."
set_string NSPhotoLibraryAddUsageDescription \
  "Kitto saves document scans to your photo library only when you ask it to."
set_string NSPhotoLibraryUsageDescription \
  "Kitto can attach a bill, letter, or form you already have saved in your photo library."

# Voice capture (lib/ai/useVoiceRecorder.ts) goes through the WebView's
# getUserMedia rather than a native plugin, but iOS does not care which layer
# asks: Capacitor's WKUIDelegate auto-grants the WebKit-level request
# (WebViewDelegationHandler.swift), which then triggers the real TCC prompt.
# Without this key iOS TERMINATES the app the instant the mic is touched —
# it reads as "recording is broken", not as a missing permission string.
set_string NSMicrophoneUsageDescription \
  "Kitto uses your microphone so you can speak a note or a question instead of typing it."

# Custom URL scheme — the ONLY way anything gets back into the app from outside
# it. Two flows depend on it:
#
#   * Email verification (server/src/lib/authFlows.ts mints kitto:// links).
#   * Google OAuth, whose consent screen MUST open in the system browser —
#     Google returns `disallowed_useragent` inside a WKWebView — so the return
#     leg is a deep link and nothing else.
#
# This was never registered, which means every kitto:// link minted so far has
# opened nothing at all. Keep the value in step with APP_DEEP_LINK_SCHEME in
# server/src/env.ts; they are two halves of one contract.
"$PLIST_BUDDY" -c "Delete :CFBundleURLTypes" "$PLIST" 2>/dev/null || true
"$PLIST_BUDDY" -c "Add :CFBundleURLTypes array" "$PLIST"
"$PLIST_BUDDY" -c "Add :CFBundleURLTypes:0 dict" "$PLIST"
"$PLIST_BUDDY" -c "Add :CFBundleURLTypes:0:CFBundleURLName string com.kitto.app" "$PLIST"
"$PLIST_BUDDY" -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PLIST"
"$PLIST_BUDDY" -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string kitto" "$PLIST"

if [ "$ALLOW_LOCAL_HTTP" -eq 0 ]; then
  echo "Patched $PLIST (product keys only)."
  exit 0
fi

# --- Dev-only: reach a plaintext backend on the LAN ------------------------
# App Transport Security blocks http:// by default. NSAllowsLocalNetworking
# permits it for RFC 1918 / link-local / .local hosts ONLY, so this does not
# open up plaintext to the public internet the way a bare NSAllowsArbitraryLoads
# would. NSAllowsArbitraryLoads is still required alongside it as the pre-iOS 10
# fallback; iOS 10+ ignores it whenever NSAllowsLocalNetworking is present.
#
# NOTE: `server.cleartext` in capacitor.config.ts does NOT cover this — that
# option is Android-only. iOS needs these keys.
"$PLIST_BUDDY" -c "Delete :NSAppTransportSecurity" "$PLIST" 2>/dev/null || true
"$PLIST_BUDDY" -c "Add :NSAppTransportSecurity dict" "$PLIST"
"$PLIST_BUDDY" -c "Add :NSAppTransportSecurity:NSAllowsArbitraryLoads bool true" "$PLIST"
"$PLIST_BUDDY" -c "Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true" "$PLIST"

# iOS 14+ gates local-network access behind a user prompt. Without this string
# the first request to the Mac's LAN IP fails instead of prompting.
set_string NSLocalNetworkUsageDescription \
  "Kitto connects to the development server running on your computer over the local network."

echo "Patched $PLIST (product keys + local-HTTP dev concession)."
echo "Do NOT ship a build made with --local-http: it relaxes App Transport Security."
