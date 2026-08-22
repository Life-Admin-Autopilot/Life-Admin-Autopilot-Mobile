#!/usr/bin/env bash
# Prints this machine's LAN IP — the address a phone on the same network uses to
# reach `next dev` (:3000) and the API (:4000).
#
# A THIN WRAPPER over lan-ip.mjs, which is the one implementation. This file used
# to resolve the default route itself with `route -n get default` and
# `ipconfig getifaddr`, neither of which exists outside macOS: on Windows it
# exited 1 with "No default route — this machine is offline" on a machine that
# was plainly online. `ios:dev` interpolates this script's stdout, so the failure
# produced CAP_LIVE_RELOAD_URL=http://:3000 rather than an error anyone saw.
#
# The two implementations had also drifted — lan-ip.mjs skips virtual adapters
# (Docker, WSL, Hyper-V) and ranks the private ranges, and this one did neither,
# so on the same machine they could legitimately disagree. One of them had to go.
set -euo pipefail

exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lan-ip.mjs" "$@"
