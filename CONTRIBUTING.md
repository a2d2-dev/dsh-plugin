# Contributing to A²D² for DSH

English and Chinese contributions are welcome. Use [Issues](https://github.com/a2d2-dev/dsh-plugin/issues) for reproducible bugs and proposed changes, and [SECURITY.md](SECURITY.md) for vulnerabilities.

## Development

Use Node.js 22 or 24 and pnpm 10.26.2, as pinned in `package.json`. Start from current `main`; it contains the integrated work panel and is the source for future releases.

```sh
git clone https://github.com/a2d2-dev/dsh-plugin.git
cd dsh-plugin
corepack enable
pnpm install --frozen-lockfile
pnpm verify:repository
pnpm typecheck
pnpm test
pnpm test:node
```

`pnpm test` runs Vitest specs; `pnpm test:node` also exercises the acceptance-harness contract using Node's test runner. Tests must not read personal credentials, depend on a developer's authenticated `gh`, or contact live model providers. Native subprocess/PTY dependencies may report ignored install scripts; enable them only when a specific host integration requires them, rather than approving every dependency script.

After committing, run `pnpm verify:pack-exports`. It deliberately rejects a dirty tree, builds a clean archive of committed HEAD, installs its tarball into an empty project and imports public Node entrypoints. `pnpm pack` runs the build itself through `prepack`; build output stays out of Git.

## Dependency updates / 依赖更新

Dependency updates are maintained manually. Dependabot version updates for npm and GitHub Actions are disabled by removing the repository's Dependabot configuration, and Dependabot security update PRs are disabled in repository settings. Security alerts are managed separately. Submit focused dependency PRs with the checks above; re-enabling automatic PRs requires an explicit maintainer decision. Existing Dependabot PRs #231–#239 are retained for manual review under [Issue #262](https://github.com/a2d2-dev/dsh-plugin/issues/262).

依赖由维护者手动更新。本仓库通过移除 Dependabot 配置停用 npm 和 GitHub Actions 定时更新，并在仓库设置中关闭 Dependabot 安全更新自动 PR。安全告警单独管理。提交依赖更新 PR 时运行上述检查；重新启用自动 PR 须由维护者明确决定。已有 Dependabot PR #231–#239 保留供人工按需审阅，处理记录见 [Issue #262](https://github.com/a2d2-dev/dsh-plugin/issues/262)。

## Pull requests

- Branch from current `main` and target `main`. Explain the concrete problem, resulting behavior and validation; link the relevant Issue.
- Keep changes focused. Update both README languages when user-facing installation or behavior changes. Respect the domain language in `CONTEXT.md` and decisions in `docs/adr/`.
- Add regression coverage at the real failing boundary for behavior changes. Describe host/browser validation separately from unit tests. Avoid arbitrary timeout increases or production fallbacks that conceal failures.
- Pass Node 22/24 checks, package verification and the secret scan. An open Issue can already be accepted; consult its Project status and evidence before repeating completed work.
- Preserve user messages, task identities, acceptance evidence and permission boundaries. Do not put local DSH state, credentials, private source snapshots or screenshots in this source repository.

Screenshots, Chinese test reports and A²D² project test information belong in the designated [a2d2-dev/project evidence repository](https://github.com/a2d2-dev/project), under `dsh-plugin/`. It is private; public contributors may attach a sanitized minimal example to their PR instead. Each report should record purpose, steps, observed results, source commit and limitations. See [test evidence](docs/testing.md).

## Compatibility and releases

A passing build does not prove compatibility with a stock public DSH host. Root/browser/handoff initialization uses the public `Agent.model.current/select` API, retaining the verified legacy `sessionController.selectLocalModel` path; subagent dispatch has a separate activation contract. The unmodified official source build `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` (`0.2.1-rc.3`) has Session/model and jobs integration evidence, while the same-version npm host lacks the required model APIs. Record the exact tested host and consult [release requirements](docs/releasing.md).

Maintainers merge verified PRs and remove their remote branches when no longer needed. Existing local worktrees and unmerged branches must be checked before any batch cleanup. Releases use immutable version tags on `main`; the candidate workflow does not publish to npm or change repository visibility.

## Contribution terms

By submitting a contribution, you confirm you have the right to contribute it under this repository's Apache-2.0 license. Keep third-party license notices and identify reused code and its source. No contributor license agreement or signed-off-by requirement is currently configured. Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
