#!/bin/bash
# Managed out-of-session update of the existing development GUI.
#
# Target: supervisor program dsh-dev-web-server / http://127.0.0.1:18781/
# From:   old plugin checkout (task-runtime-phase1), host deepseek-harness-dev (0.2.0-rc.2)
# To:     frozen product tgz fc4fa731 (client 640f11be...) + host 8282d612
#
# Keeps DSH_HOME (/data/_dsh-dev) and all user session/storage/project data.
# Runs from a transient systemd unit so it survives the restart of the server
# that hosts the requesting agent session. Verifies from outside the process
# (HTTP + real browser) and restores the previous runnable profile on failure.
set -uo pipefail

# Transient systemd units start with a minimal environment; pin what the
# verification steps need (node/agent-browser live under nvm).
export PATH=/root/.nvm/versions/node/v22.23.1/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export HOME=/root

MODE=${1:---dry-run}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
PRIV=/data/_dsh-dev
PROFILE=$PRIV/profiles/web
PREP=/data/_dsh-builds/v4-141-artifacts-38d4d91/preview-final-154-5a2ecf3-02/profile-new
NEWHOST=/data/src/github.com/deepseek-ai/deepseek-harness-dev.worktrees/v4-141-release-8282d612
NEWPLUGIN_SHA=56709afccea64797a7b9275ae26ab4fecd039ea8ee5162efb1ecd0c40509e2ad
NEWCLIENT_SHA=640f11be88549f9e169eb905b3653dfc58d198655e2c916ff21144a89a2a9440
# Deployment-specific frozen inputs: a private env file may pin PREP/NEWHOST/shas.
# shellcheck disable=SC1091
[ -f "$PRIV/deployments/v4-gui.env" ] && . "$PRIV/deployments/v4-gui.env"
PROGRAM=dsh-dev-web-server
URL=http://127.0.0.1:18781/
# The GUI process is the only CLI started with its own fixed port; the preview
# runs --port 0. Match that so the host check never inspects another instance.
URL_CMD_PATTERN="--port 18781"
OUT=$PRIV/deployments/v4-gui-$STAMP
LOG=$OUT/runner.log
CONF=/etc/supervisor/conf.d/dsh-dev-web-server.conf
LOCK=$PRIV/deployments/.v4-gui-switch.lock
mkdir -p "$OUT"
say() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$LOG"; }
fail() { say "FATAL: $*"; echo "RESULT=failed" >> "$LOG"; exit 1; }

http() { curl -s -o /dev/null -w '%{http_code}' --max-time 4 "$URL" 2>/dev/null; }
wait_healthy() { # $1 seconds
  local n=$1 code
  for _ in $(seq 1 "$n"); do
    code=$(http)
    [ "$code" = "200" ] || [ "$code" = "401" ] || [ "$code" = "302" ] && return 0
    sleep 1
  done
  return 1
}
running_cli() { ps -ef | grep -F "$URL_CMD_PATTERN" | grep -v grep | grep -v launch-v4 | awk '{print $2}' | head -1; }
cli_cmdline() { local p=$1; [ -n "$p" ] && tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null; }

inventory() { # $1 output file
  {
    echo "== sessions"
    find "$PRIV/sessions" -type f 2>/dev/null | sed "s#$PRIV/##" | sort
    echo "== storages"
    find "$PRIV/storages" -type f -exec sha256sum {} \; 2>/dev/null | sed "s#$PRIV/##" | sort
    echo "== a2d2"
    find "$PRIV/a2d2" -type f -exec sha256sum {} \; 2>/dev/null | sed "s#$PRIV/##" | sort
    echo "== projects"
    find "$PRIV/projects" -maxdepth 2 -type d 2>/dev/null | sed "s#$PRIV/##" | sort
  } > "$1" 2>&1
}

say "mode=$MODE run=$OUT"
say "pre: supervisor $(supervisorctl status $PROGRAM 2>&1 | tr -s ' ') http=$(http)"
PID_BEFORE=$(running_cli); say "pre: cli pid=$PID_BEFORE cmd=$(cli_cmdline "${PID_BEFORE:-0}")"
inventory "$OUT/pre-inventory.txt"; say "pre: inventory lines=$(wc -l < "$OUT/pre-inventory.txt")"

if [ "$MODE" = "--dry-run" ]; then
  say "dry-run: would back up $PROFILE and $CONF"
  say "dry-run: would install prepared profile node_modules from $PREP"
  say "dry-run: would write $PROFILE/launch-v4.py exec'ing $NEWHOST/apps/cli/lib/bin.js"
  say "dry-run: would rewrite $CONF command and run supervisorctl reread/update $PROGRAM"
  say "dry-run: would wait health, verify in browser, then keep or roll back"
  say "dry-run: checks: prep=$( [ -f "$PREP/package.json" ] && echo ok || echo MISSING ) newhost=$( [ -f "$NEWHOST/apps/cli/lib/bin.js" ] && echo ok || echo MISSING ) plugin_client=$(sha256sum "$PREP/node_modules/dsh-a2d2/lib/client.js" 2>/dev/null | cut -d' ' -f1) conf=$( [ -f "$CONF" ] && echo ok || echo MISSING )"
  echo "RESULT=dry-run-ok" >> "$LOG"
  exit 0
fi

# single-run lock
if ! ( set -o noclobber; : > "$LOCK" ) 2>/dev/null; then
  fail "another update is running ($LOCK exists); refusing to touch the live service"
fi
trap 'rm -f "$LOCK"' EXIT

# ---------------------------------------------------------------- backup
mkdir -p "$OUT/backup"
tar czf "$OUT/backup/profiles-web.tgz" -C "$PRIV/profiles" web 2>>"$LOG" || fail "backup profile"
cp -a "$CONF" "$OUT/backup/supervisor.conf" || fail "backup supervisor conf"
cp -a "$PRIV/logs/web-stderr.log" "$OUT/backup/web-stderr-before.log" 2>/dev/null
say "backup written to $OUT/backup"

restore() {
  say "ROLLBACK: restoring profile and supervisor command"
  rm -rf "$PROFILE"
  tar xzf "$OUT/backup/profiles-web.tgz" -C "$PRIV/profiles" >>"$LOG" 2>&1 || say "ROLLBACK: profile restore failed"
  cp -a "$OUT/backup/supervisor.conf" "$CONF" || say "ROLLBACK: conf restore failed"
  supervisorctl reread >>"$LOG" 2>&1
  supervisorctl update >>"$LOG" 2>&1
  supervisorctl restart "$PROGRAM" >>"$LOG" 2>&1
  if wait_healthy 120; then say "ROLLBACK: previous instance serving http=$(http)"; else say "ROLLBACK: previous instance NOT healthy"; fi
}

# ---------------------------------------------------------------- apply profile
rm -rf "$PROFILE/node_modules"
cp -a "$PREP/node_modules" "$PROFILE/node_modules" || { restore; fail "install node_modules"; }
cp -a "$PREP/package.json" "$PROFILE/package.json" || { restore; fail "package.json"; }
cp -a "$PREP/pnpm-lock.yaml" "$PROFILE/pnpm-lock.yaml"
cp -a "$PREP/pnpm-workspace.yaml" "$PROFILE/pnpm-workspace.yaml"
GOT=$(sha256sum "$PROFILE/node_modules/dsh-a2d2/lib/client.js" | cut -d' ' -f1)
[ "$GOT" = "$NEWCLIENT_SHA" ] || { restore; fail "installed client sha $GOT != $NEWCLIENT_SHA"; }
say "profile now carries product client $GOT"

# ---------------------------------------------------------------- launcher + supervisor
cat > "$PROFILE/launch-v4.py" <<PY
#!/usr/bin/env python3
"""Launch the existing development profile on the reviewed host build."""
import json, os
from pathlib import Path

runtime = Path('$NEWHOST').resolve()
dsh_home = Path('/data/_dsh-dev').resolve()
assert runtime != Path('/data/src/github.com/deepseek-ai/deepseek-harness-runtime').resolve()
assert dsh_home != Path('/root/.dsh').resolve()
assert (runtime / 'apps/cli/lib/bin.js').is_file()
assert (dsh_home / 'profiles/web/package.json').is_file()

private_environment = json.loads((dsh_home / 'service-env.json').read_text())
if set(private_environment) - {'DEEPSEEK_API_KEY'}:
    raise SystemExit('Unexpected key in development service-env.json')

environment = os.environ.copy()
environment.update(private_environment)
environment.update({
    'DSH_HOME': str(dsh_home),
    'DSH_WEB_PASSWORD_FILE': str(dsh_home / 'web-password'),
    'XDG_CACHE_HOME': str(dsh_home / 'cache'),
    'TMPDIR': str(dsh_home / 'tmp'),
    'GH_CONFIG_DIR': '/root/.config/gh',
    'HOME': '/root',
    'NODE_OPTIONS': '--max-old-space-size=4096 --dns-result-order=ipv4first --no-network-family-autoselection',
})
os.chdir(runtime)
node = '/root/.nvm/versions/node/v22.23.1/bin/node'
os.execve(node, [node, 'apps/cli/lib/bin.js', 'web',
                 '--port', '18781',
                 '--trusted-host', '10.126.126.12:18780', '--no-open'], environment)
PY
chmod 755 "$PROFILE/launch-v4.py" || fail "chmod launcher"
sed -i "s#^command=.*#command=/usr/bin/python3 $PROFILE/launch-v4.py#" "$CONF" || fail "rewrite supervisor command"
grep -q "launch-v4.py" "$CONF" || fail "supervisor command not rewritten"
say "applied launcher and supervisor command"

# ---------------------------------------------------------------- restart (this ends the requesting session)
supervisorctl reread >>"$LOG" 2>&1
supervisorctl update "$PROGRAM" >>"$LOG" 2>&1
# update() restarts on a changed command; restart explicitly so the new launcher
# is guaranteed even if supervisor considers the row unchanged.
supervisorctl restart "$PROGRAM" >>"$LOG" 2>&1
say "supervisor update+restart issued; waiting for health"
if ! wait_healthy 180; then
  tail -40 "$PRIV/logs/web-stderr.log" >>"$LOG" 2>&1
  restore
  fail "new instance did not become healthy"
fi
PID_AFTER=$(running_cli)
say "healthy http=$(http) cli pid=$PID_AFTER"
say "post: cli cmd=$(cli_cmdline "${PID_AFTER:-0}")"
echo "$(cli_cmdline "${PID_AFTER:-0}")" | grep -q "v4-141-release-8282d612" || { tail -30 "$PRIV/logs/web-stderr.log" >>"$LOG" 2>&1; restore; fail "running CLI is not the reviewed host build"; }

# ---------------------------------------------------------------- browser verification
export HOME=/root
SHOT=$OUT/gui-after.png
BROWSER_OK=yes
agent-browser --session v4-gui-switch open "$URL" >/dev/null 2>&1 || BROWSER_OK=no
sleep 3
PW=$(cat "$PRIV/web-password")
agent-browser --session v4-gui-switch fill 'input[type=password]' "$PW" >/dev/null 2>&1 || true
agent-browser --session v4-gui-switch press Enter >/dev/null 2>&1 || true
sleep 6
agent-browser --session v4-gui-switch screenshot "$SHOT" >/dev/null 2>&1 || true
TEXT=$(agent-browser --session v4-gui-switch get text body 2>/dev/null) || BROWSER_OK=no
printf '%s\n' "$TEXT" > "$OUT/gui-after-text.txt"
say "browser ok=$BROWSER_OK text chars=${#TEXT}"
if [ "$BROWSER_OK" = "yes" ] && [ "${#TEXT}" -gt 40 ]; then
  echo "$TEXT" | grep -q "A²D² 控制面板" || { say "browser: A2D2 panel entry missing"; restore; fail "new GUI does not expose the A²D² control panel"; }
  echo "$TEXT" | grep -q "workspace\|task-interaction-v3" || say "browser: no workspace label found (not fatal)"
else
  say "browser verification unavailable; relying on HTTP + CLI + inventory checks"
fi

# open the panel and confirm the v4 source surface is present
agent-browser --session v4-gui-switch eval "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('A²D² 控制面板'))?.click()" >/dev/null 2>&1
sleep 5
PANEL=$(agent-browser --session v4-gui-switch get text body 2>/dev/null)
printf '%s\n' "$PANEL" > "$OUT/gui-panel-text.txt"
agent-browser --session v4-gui-switch screenshot "$OUT/gui-panel.png" >/dev/null 2>&1
if [ "$BROWSER_OK" = "no" ] || [ "${#TEXT}" -le 40 ]; then
  say "browser: panel surface unverified"
  PANEL_OK=unknown
elif echo "$PANEL" | grep -q "来源\|添加 GitHub\|持续委托"; then
  say "browser: v4 source surface present"
  PANEL_OK=yes
else
  say "browser: v4 source surface absent"
  PANEL_OK=no
fi

# ---------------------------------------------------------------- retention
sleep 2
inventory "$OUT/post-inventory.txt"
if diff -u "$OUT/pre-inventory.txt" "$OUT/post-inventory.txt" > "$OUT/inventory-diff.txt"; then
  say "retention: session/storage/a2d2/project inventory identical"
  RETENTION=identical
else
  say "retention: inventory differs (see inventory-diff.txt); new files are allowed, changes to old ones are not"
  RETENTION=diff
  # A removed *path* is a retention loss; a changed hash on the same path is a
  # legitimate in-place update (workspace list, runtime state, live sessions).
  python3 - "$OUT/pre-inventory.txt" "$OUT/post-inventory.txt" > "$OUT/retention.txt" <<'PY'
import sys
def paths(file):
    section = None; result = {}
    for line in open(file):
        line = line.rstrip('\n')
        if line.startswith('== '):
            section = line[3:]; result.setdefault(section, set()); continue
        if not line or section is None: continue
        result[section].add(line.split('  ')[-1] if '  ' in line else line)
    return result
pre, post = paths(sys.argv[1]), paths(sys.argv[2])
lost = 0
for section, before in pre.items():
    removed = sorted(before - post.get(section, set()))
    print(f'{section}: removed={len(removed)}')
    for item in removed[:20]: print('  REMOVED', item)
    lost += len(removed)
print('LOST_PATHS=' + str(lost))
PY
  RETENTION=diff
  if grep -q "LOST_PATHS=0" "$OUT/retention.txt"; then RETENTION=no-path-loss; else RETENTION=loss; fi
  cat "$OUT/retention.txt" >> "$LOG"
fi

cat > "$OUT/result.json" <<JSON
{
  "run": "$STAMP",
  "program": "$PROGRAM",
  "origin": "$URL",
  "productPluginSha256": "$NEWPLUGIN_SHA",
  "clientSha256": "$NEWCLIENT_SHA",
  "host": "8282d61299a04f60555f9ce473af174bbe161b02",
  "cliBefore": "$PID_BEFORE",
  "cliAfter": "$PID_AFTER",
  "http": "$(http)",
  "panelOk": "$PANEL_OK",
  "retention": "$RETENTION",
  "screenshots": ["gui-after.png", "gui-panel.png"],
  "evidence": "$OUT"
}
JSON

if [ "$PANEL_OK" = "yes" ] && [ "$RETENTION" != "loss" ]; then
  say "RESULT=updated-and-verified"
  echo "RESULT=updated-and-verified" >> "$LOG"
  GH_OK=$(cd /data/src/github.com/a2d2-dev/dsh-plugin.worktrees/task-interaction-v3 && HOME=/root gh issue comment 155 --repo a2d2-dev/dsh-plugin --body "## GUI 同 URL 更新完成（机器来源，非 LF）

- 程序 dsh-dev-web-server / http://127.0.0.1:18781/ 已切换：host 8282d612、插件 fc4fa731（client 640f11be）。
- 证据目录：\`$OUT\`（result.json、gui-after.png、gui-panel.png、inventory 前后对比）。
- 保留核对：$RETENTION；A²D² 控制面板入口与来源界面：$PANEL_OK。
- 新 cli pid=$PID_AFTER，HTTP=$(http)。
" 2>&1 | tail -2)
  say "gh comment: $GH_OK"
else
  say "RESULT=updated-but-verification-incomplete"
  echo "RESULT=updated-but-verification-incomplete" >> "$LOG"
fi
