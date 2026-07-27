#!/usr/bin/env bash
# Prints this machine's LAN IP — the address an iPhone on the same network uses
# to reach `next dev` (:3000) and the Express API (:4000).
#
# Resolves via the default route rather than assuming en0: on this Mac the
# active interface is en5, and it changes with Wi-Fi vs. wired vs. tethering.
# Used by docs/CAPACITOR.md and when refreshing .env.native-dev.local.
set -euo pipefail

interface=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')

if [ -z "$interface" ]; then
  echo "No default route — this machine is offline." >&2
  exit 1
fi

address=$(ipconfig getifaddr "$interface" 2>/dev/null || true)

if [ -z "$address" ]; then
  echo "Interface $interface has no IPv4 address." >&2
  exit 1
fi

echo "$address"
