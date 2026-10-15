#!/usr/bin/env python3
"""Launch the isolated development profile through the supported DSH CLI."""

import json
import os
from pathlib import Path


runtime = Path('/data/src/github.com/deepseek-ai/deepseek-harness-dev').resolve()
dsh_home = Path('/data/_dsh-dev').resolve()
assert runtime != Path('/data/src/github.com/deepseek-ai/deepseek-harness-runtime').resolve()
assert dsh_home != Path('/root/.dsh').resolve()
assert (runtime / 'apps/cli/src/bin.ts').is_file()
assert (dsh_home / 'profiles/web/package.json').is_file()

# Only explicitly copied model credentials enter this new process. This file is
# private deployment state and is never part of the repository.
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
    'NODE_OPTIONS': '--max-old-space-size=4096 --dns-result-order=ipv4first --no-network-family-autoselection',
})
os.chdir(runtime)
node = '/root/.nvm/versions/node/v22.23.1/bin/node'
# This is the public `dsh` source CLI (the exact `pnpm dsh` script), not an
# internal web-app entry. It avoids Corepack downloading into the empty cache.
os.execve(node, [node, '--import', 'tsx/esm', 'apps/cli/src/bin.ts', 'web',
                 '--port', '18781',
                 '--trusted-host', '10.126.126.12:18780', '--no-open'], environment)
