#!/bin/bash
# Build the #163 fix into a deployable product artifact and a prepared profile.
set -euo pipefail
SRC=/data/src/github.com/a2d2-dev/dsh-plugin.worktrees/v4-workstore-contention
OUT=/data/_dsh-builds/v4-163
BASE=/data/_dsh-builds/v4-141-artifacts-38d4d91/preview-final-154-5a2ecf3-02/profile-new
mkdir -p "$OUT"
cd "$SRC"
echo "== head: $(git rev-parse --short HEAD) $(git log -1 --format=%s)"
[ -z "$(git status --porcelain)" ] || { echo "worktree not clean"; exit 1; }
echo '== typecheck'
pnpm typecheck
echo '== build'
pnpm build
echo "client sha256: $(sha256sum lib/client.js | cut -d' ' -f1)"
echo '== pack'
rm -f "$OUT"/dsh-a2d2-0.0.1.tgz
npm pack --pack-destination "$OUT" >/dev/null
echo "tgz sha256: $(sha256sum "$OUT/dsh-a2d2-0.0.1.tgz" | cut -d' ' -f1)"
echo '== prepared profile'
rm -rf "$OUT/profile-new"
cp -a "$BASE" "$OUT/profile-new"
rsync -a --delete "$SRC/lib/" "$OUT/profile-new/node_modules/dsh-a2d2/lib/"
cp -a "$SRC/package.json" "$SRC/cordis.patch.yml" "$SRC/dsh.plugin.json" "$OUT/profile-new/node_modules/dsh-a2d2/"
cp -a "$SRC/ceo" "$OUT/profile-new/node_modules/dsh-a2d2/"
python3 - "$OUT" <<'PY'
import json, sys
out = sys.argv[1]
p = f'{out}/profile-new/package.json'
d = json.load(open(p))
d['dependencies']['dsh-a2d2'] = f'file:{out}/dsh-a2d2-0.0.1.tgz'
json.dump(d, open(p, 'w'), indent=2)
print('profile dependency ->', d['dependencies']['dsh-a2d2'])
PY
echo "prepared client sha256: $(sha256sum "$OUT/profile-new/node_modules/dsh-a2d2/lib/client.js" | cut -d' ' -f1)"
echo "prepared server index: $(sha256sum "$OUT/profile-new/node_modules/dsh-a2d2/lib/index.js" | cut -d' ' -f1)"
echo "src index:            $(sha256sum "$SRC/lib/index.js" | cut -d' ' -f1)"
