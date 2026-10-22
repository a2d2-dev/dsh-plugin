#!/bin/bash
# Switch the existing preview instance (dsh-a2d2-v3-preview / 18782) from the
# restored a450 rollback to the approved v4 candidate (host 8282d612 + plug
# fc4fa731). Keeps DSH_HOME and all session data in place; keeps a runnable
# rollback copy and restores it automatically when the new instance fails to
# become ready.
set -uo pipefail

PREV=/data/_dsh-dev/previews/a2d2-v3-121
ART=/data/_dsh-builds/v4-141-artifacts-38d4d91/preview-final-154-5a2ecf3-02
STAMP=$(date +%Y%m%d-%H%M%S)
RUN=/tmp/v4-switch/$STAMP
BK=$RUN/backup
mkdir -p "$RUN" "$BK"
L="$RUN/switch.log"
say() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$L"; }

say "run=$RUN"
say "pre: supervisor status: $(supervisorctl status dsh-a2d2-v3-preview 2>&1 | tr -s ' ')"
say "pre: http=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://10.126.126.12:18782/)"
say "pre: client sha of running plugin tgz = $(sha256sum /data/_dsh-dev/previews/a2d2-v3-121/home/profiles/web/node_modules/dsh-a2d2/lib/client.js 2>/dev/null | cut -d' ' -f1)"

# pre-state inventory for the retention comparison
{
  echo "== sessions"
  find "$PREV/home/sessions" -maxdepth 3 -type f | sed "s#$PREV/##" | sort
  echo "== storages"
  find "$PREV/home/storages" -type f -exec sha256sum {} \; | sed "s#$PREV/##" | sort
  echo "== a2d2"
  find "$PREV/home/a2d2" -type f -exec sha256sum {} \; | sed "s#$PREV/##" | sort
} > "$RUN/pre-state.txt" 2>&1
say "pre-state files=$(wc -l < "$RUN/pre-state.txt")"

# 1. backup the live rollback profile + launcher + runtime config
cp -a "$PREV/home/profiles/web" "$BK/profiles-web" || { say "FATAL backup profile"; exit 2; }
cp -a "$PREV/launch.mjs" "$BK/launch.mjs"
cp -a "$PREV/.v4-141-runtime.private.json" "$BK/runtime.private.json"
say "backup -> $BK"

restore_rollback() {
  say "ROLLBACK: restoring rollback profile + launcher"
  rm -rf "$PREV/home/profiles/web"
  cp -a "$BK/profiles-web" "$PREV/home/profiles/web"
  cp -a "$BK/launch.mjs" "$PREV/launch.mjs"
  cp -a "$BK/runtime.private.json" "$PREV/.v4-141-runtime.private.json"
  supervisorctl restart dsh-a2d2-v3-preview >>"$L" 2>&1
  for i in $(seq 1 40); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://10.126.126.12:18782/ 2>/dev/null)
    if [ "$code" = "401" ] || [ "$code" = "200" ]; then say "ROLLBACK: preview serving http=$code"; return 0; fi
    sleep 1
  done
  say "ROLLBACK: preview did not come back"
  return 1
}

# 2. install the approved candidate profile (fresh node_modules from the frozen tgz)
rm -rf "$PREV/home/profiles/web"
cp -a "$ART/profile-new" "$PREV/home/profiles/web" || { say "FATAL copy profile"; restore_rollback; exit 3; }
cp -a "$ART/launcher-new.mjs" "$PREV/launch.mjs"
cp -a "$ART/runtime-new.private.json" "$PREV/.v4-141-runtime.private.json"
say "candidate installed: plugin=$(sha256sum "$PREV/home/profiles/web/node_modules/dsh-a2d2/lib/client.js" | cut -d' ' -f1)"

# 3. restart through supervisor (single TERM to the launcher, which forwards once)
supervisorctl restart dsh-a2d2-v3-preview >>"$L" 2>&1
say "restart issued"

# 4. wait for readiness: current-run.json rewritten with the new host commit and HTTP answering
ok=0
for i in $(seq 1 90); do
  sleep 1
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://10.126.126.12:18782/ 2>/dev/null)
  host=$(python3 -c "import json;print(json.load(open('$PREV/current-run.json')).get('hostCommit',''))" 2>/dev/null)
  if { [ "$code" = "401" ] || [ "$code" = "200" ]; } && [ "$host" = "8282d61299a04f60555f9ce473af174bbe161b02" ]; then ok=1; break; fi
done
say "readiness ok=$ok http=$code host=$host after ${i}s"
say "post current-run: $(cat "$PREV/current-run.json" 2>/dev/null | tr -d '\n' | head -c 400)"
tail -n 12 "$PREV/home/profiles/web/.v4-141-web.private.log" >>"$L" 2>&1

if [ "$ok" != "1" ]; then
  say "FAILED: candidate not ready"
  tail -n 60 "$PREV/logs/supervisor.log" >>"$L" 2>&1
  restore_rollback
  echo "RESULT=failed-rolled-back" | tee -a "$L"
  exit 4
fi

# 5. retention comparison
{
  echo "== sessions"
  find "$PREV/home/sessions" -maxdepth 3 -type f | sed "s#$PREV/##" | sort
  echo "== storages"
  find "$PREV/home/storages" -type f -exec sha256sum {} \; | sed "s#$PREV/##" | sort
  echo "== a2d2"
  find "$PREV/home/a2d2" -type f -exec sha256sum {} \; | sed "s#$PREV/##" | sort
} > "$RUN/post-state.txt" 2>&1
if diff -u "$RUN/pre-state.txt" "$RUN/post-state.txt" > "$RUN/state-diff.txt"; then
  say "retention: session/storage/a2d2 files identical"
else
  say "retention: differences (expected only for new run records) see state-diff.txt"
fi

echo "RESULT=switched-to-candidate" | tee -a "$L"
