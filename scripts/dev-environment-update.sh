#!/usr/bin/env bash
# Build the currently linked development plugin and restart only the dev server.
set -euo pipefail

export PATH="/root/.nvm/versions/node/v22.23.1/bin:$PATH"
dev_home=/data/_dsh-dev
dev_runtime=/data/src/github.com/deepseek-ai/deepseek-harness-dev
dev_plugin=/data/src/github.com/a2d2-dev/dsh-plugin.worktrees/task-runtime-phase1
service=dsh-dev-web-server

if [[ ${1:-} != '' && ${1:-} != '--runtime' ]] || (( $# > 1 )); then
  printf 'Usage: %s [--runtime]\n' "$0" >&2
  exit 2
fi

exec 9>"$dev_home/update.lock"
flock -n 9 || { printf 'Another dev update is running.\n' >&2; exit 1; }

python3 - "$dev_home" "$dev_runtime" "$dev_plugin" <<'PY'
import json
from pathlib import Path
import sys

home, runtime, plugin = map(Path, sys.argv[1:])
assert home.resolve() == home, 'Development home must not point elsewhere'
assert runtime.resolve() == runtime, 'Development runtime must not point elsewhere'
assert plugin.resolve() == plugin, 'Development plugin must not point elsewhere'
manifest = json.loads((home / 'profiles/web/package.json').read_text())
assert manifest['dependencies']['dsh-a2d2'] == f'link:{plugin}'
installed = home / 'profiles/web/node_modules/dsh-a2d2'
assert installed.resolve() == plugin, 'Profile must resolve the development plugin'
PY

# A failed build leaves dev stopped, so the process cannot consume half-written
# artifacts. Correct the build and rerun this command to restore the service.
python3 - "$service" <<'PY'
import subprocess
import sys

service = sys.argv[1]
status = subprocess.run(['supervisorctl', 'status', service], text=True, capture_output=True)
parts = status.stdout.split()
if len(parts) < 2 or parts[0] != service:
    raise SystemExit('Development service is not registered with supervisor')
if parts[1] in {'RUNNING', 'STARTING'}:
    subprocess.run(['supervisorctl', 'stop', service], check=True)
elif parts[1] not in {'STOPPED', 'EXITED', 'FATAL', 'BACKOFF'}:
    raise SystemExit(f'Unexpected development service state: {parts[1]}')
PY
if [[ ${1:-} == '--runtime' ]]; then
  (cd "$dev_runtime" && pnpm build)
fi
(cd "$dev_plugin" && pnpm build)
supervisorctl start "$service"
supervisorctl status "$service"
