#!/bin/bash
# Redeploy the existing preview instance (dsh-a2d2-v3-preview / 18782) with a
# prepared profile that installs a new product tgz. Keeps DSH_HOME, sessions,
# storages and the account credentials; keeps the host and launcher unchanged.
set -uo pipefail

PREP=${1:?prepared profile directory}
EXPECT=${2:?expected client sha256}
PREV=/data/_dsh-dev/previews/a2d2-v3-121
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT=$PREV/artifacts/redeploy-$STAMP
mkdir -p "$OUT"
LOG=$OUT/redeploy.log
say() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$LOG"; }
http() { curl -s -o /dev/null -w '%{http_code}' --max-time 4 http://10.126.126.12:18782/ 2>/dev/null; }
wait_healthy() { local n=$1 code; for _ in $(seq 1 "$n"); do code=$(http); { [ "$code" = "200" ] || [ "$code" = "401" ]; } && return 0; sleep 1; done; return 1; }

say "prep=$PREP expect=$EXPECT out=$OUT"
[ -d "$PREP/node_modules/dsh-a2d2" ] || { say "FATAL prepared profile missing plugin"; exit 1; }
got=$(sha256sum "$PREP/node_modules/dsh-a2d2/lib/client.js" | cut -d' ' -f1)
[ "$got" = "$EXPECT" ] || { say "FATAL prepared client sha $got != $EXPECT"; exit 1; }
say "pre: supervisor $(supervisorctl status dsh-a2d2-v3-preview 2>&1 | tr -s ' ') http=$(http)"

inventory() { { find "$PREV/home/sessions" -type f | sort; find "$PREV/home/storages" -type f -exec sha256sum {} \; | sort; } > "$1" 2>&1; }
inventory "$OUT/pre.txt"
cp -a "$PREV/home/profiles/web" "$OUT/backup-profile-web"
say "backup written"

restore() {
  say "ROLLBACK: restoring previous profile"
  rm -rf "$PREV/home/profiles/web"
  cp -a "$OUT/backup-profile-web" "$PREV/home/profiles/web"
  supervisorctl restart dsh-a2d2-v3-preview >>"$LOG" 2>&1
  wait_healthy 120 && say "ROLLBACK: preview serving http=$(http)" || say "ROLLBACK: preview NOT healthy"
}

rm -rf "$PREV/home/profiles/web"
cp -a "$PREP" "$PREV/home/profiles/web" || { restore; say "FATAL copy profile"; exit 1; }
say "installed client $(sha256sum "$PREV/home/profiles/web/node_modules/dsh-a2d2/lib/client.js" | cut -d' ' -f1)"
supervisorctl restart dsh-a2d2-v3-preview >>"$LOG" 2>&1
if ! wait_healthy 180; then
  tail -40 "$PREV/logs/supervisor.log" >>"$LOG" 2>&1
  restore
  say "FATAL preview not healthy"
  exit 1
fi
say "healthy http=$(http) run=$(tr -d '\n' < "$PREV/current-run.json" | head -c 300)"
inventory "$OUT/post.txt"
if diff -u "$OUT/pre.txt" "$OUT/post.txt" > "$OUT/diff.txt"; then say "retention: sessions/storages identical"; else say "retention: differs (new files allowed), see diff.txt"; fi
say "RESULT=redeployed"
