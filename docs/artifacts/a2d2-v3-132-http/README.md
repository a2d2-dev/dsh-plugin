# HTTP work flow repair (#132)

Ordinary HTTP at `http://10.126.126.12:18782/` exposes `crypto.getRandomValues` but not `crypto.randomUUID`. The previous UI threw before sending its work command. Both browser command identities and new breakdown block identities now use the same CSPRNG UUID v4 helper. The existing pending command map retains an identity on an unknown network result and clears it after a completed response.

`resources.list` adds an optional, read-only owner projection from accepted Projects, restricted to resources returned by the host. Create/attach forms show the owning Project and disable occupied options. Creating an independent local Project remains the default. Persisted resource identities, snapshot schema, authorization and server uniqueness checks are unchanged.

Behavior tests use native CSPRNG capability with `randomUUID` absent, controller submit/retry, actual production form callbacks backed by WorkApplication, and reopened public work queries. Each new behavior was observed failing before its implementation. These source tests do not substitute for the original HTTP browser acceptance.

## Source verification

- New behavior scope: 25/25 passed; both TypeScript configurations and source/declaration builds exited 0; all 13 Node package exports passed.
- First full default-worker run: 692/700, exit 1, with eight timing failures (runtime/host timeouts, existing form waitFor and socket-close timing) while compilation was also running.
- Full `vitest run --maxWorkers=2`: 699/700, exit 1; only the existing `handles ambiguous permissions` runtime test exceeded its unchanged 5-second limit.
- Isolated unchanged remaining test (`--maxWorkers=1 -t 'handles ambiguous permissions'`): 1 passed, 32 skipped, exit 0, 3.35 seconds. No claim of an entirely green full-suite invocation.

## Build and deployment boundary

Use installed `tsc` for both typechecks and declaration builds, `tsdown` for the source bundle, and `node scripts/verify-pack-exports.mjs` for all 13 Node exports. Initial `pnpm exec` dependency verification reported `ERR_PNPM_IGNORED_BUILDS` for subprocess-local/koffi/node-pty; approval policy was not changed. Running installed tools distinguishes source validation from that dependency warning.

Deploy only the `dsh-a2d2-v3-preview` supervisor program after review of the source SHA and tgz. Keep the old tgz (`81466a33342c0256873bbf30dac693ee0cff2c075246a4ad859d94663ce0a82b`) and the old launcher/profile manifest/lockfile. Place the new package at a unique versioned tgz path, update only the web profile's file dependency and install it with scripts disabled; update the launcher's package SHA metadata. Restart only that supervisor program. Preserve home, workspace, records, sessions, model guard, HTTP origin and all prior failure evidence.

Before replacement, capture private backups plus hashes/IDs of existing Project/Task/Agent/receipt records and session files. After replacement and UI checks, require all existing records and sessions to remain identical, including association references. For rollback, restore the profile manifest/lockfile and launcher, install the original retained file dependency and restart the same program; do not roll back or replace user data.

Browser acceptance must use agent-browser on the exact ordinary HTTP origin, with native insecure-context capabilities and no API injection: create an explicitly named test Project without a directory, create a Task, revise its specification, add/save a breakdown block, reload, and verify durable results. Read-only public queries may verify saved facts, never create the acceptance records. Record screenshots, installed package/bundle SHA, retained-data hashes and zero model gateway/adapter calls. The user's unsaved `abcd` has no persisted historical record to recover.
