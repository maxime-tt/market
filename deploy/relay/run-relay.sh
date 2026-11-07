#!/usr/bin/env bash
# Start the Slice 1 auction-event relay on loopback.
#
# The relay is `nak serve` (fiatjaf's Nostr Army Knife): an in-memory NIP-01
# relay used purely as transport for kinds 28640/28641/28642.  It is NOT a source
# of truth -- the CometBFT chain is -- so it is safe to run empty and to restart:
# an observer catches up from the chain's per-event Operations keys, and any
# event still held by the live relay is replayed on resubscribe.
#
# Usage:
#   deploy/relay/run-relay.sh                     # 127.0.0.1:7777 (POC_RELAY_URL default)
#   RELAY_PORT=7778 deploy/relay/run-relay.sh     # another port
#   RELAY_EVENTS=/path/seed.jsonl deploy/relay/run-relay.sh   # preload a batch
#
# This script starts a foreground process (exec), so systemd/`&`/the caller owns
# its lifecycle.  It does not touch the running auctions-mvp-demo.service.
set -euo pipefail

RELAY_HOST="${RELAY_HOST:-127.0.0.1}"
RELAY_PORT="${RELAY_PORT:-7777}"

# Locate nak: honour NAK_BINARY, else the usual per-user install path, else PATH.
NAK_BINARY="${NAK_BINARY:-}"
if [[ -z "${NAK_BINARY}" ]]; then
  if [[ -x "${HOME}/.local/bin/nak" ]]; then
    NAK_BINARY="${HOME}/.local/bin/nak"
  elif command -v nak >/dev/null 2>&1; then
    NAK_BINARY="$(command -v nak)"
  else
    echo "run-relay: nak not found; install it or set NAK_BINARY" >&2
    exit 1
  fi
fi

# Loopback only.  The relay carries signed events with no auth (fake-money demo);
# exposing it off-host is a deliberate act, not a default.
if [[ "${RELAY_HOST}" != "127.0.0.1" && "${RELAY_HOST}" != "::1" ]]; then
  echo "run-relay: refusing non-loopback host ${RELAY_HOST} (set nothing; the relay is loopback-only by policy)" >&2
  exit 1
fi

args=(serve --hostname "${RELAY_HOST}" --port "${RELAY_PORT}")
if [[ -n "${RELAY_EVENTS:-}" ]]; then
  # Optional persistence variant: nak serve can preload a jsonl batch on start.
  # Use it when a run needs the relay to come up with a known event set; the
  # default (empty) is correct for a live demo because the chain is durable.
  if [[ ! -r "${RELAY_EVENTS}" ]]; then
    echo "run-relay: RELAY_EVENTS=${RELAY_EVENTS} is not readable" >&2
    exit 1
  fi
  args+=(--events "${RELAY_EVENTS}")
fi

echo "run-relay: starting ${NAK_BINARY} ${args[*]} (ws://${RELAY_HOST}:${RELAY_PORT})"
exec "${NAK_BINARY}" "${args[@]}"
