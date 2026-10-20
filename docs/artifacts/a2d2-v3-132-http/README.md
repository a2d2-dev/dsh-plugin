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

Before replacement, capture configuration backups plus hashes/IDs of existing Project/Task/Agent/receipt records and session files. After replacement, require identical existing records and session bytes. After UI checks, compare existing work records and original session bytes again; diagnose any append separately, including association references. For rollback, restore the profile manifest/lockfile and launcher, install the original retained file dependency and restart the same program; do not roll back or replace user data.

Browser acceptance must use agent-browser on the exact ordinary HTTP origin, with native insecure-context capabilities and no API injection: create an explicitly named test Project without a directory, create a Task, revise its specification, add/save a breakdown block, reload, and verify durable results. Read-only public queries may verify saved facts, never create the acceptance records. Record screenshots, installed package/bundle SHA, retained-data hashes and zero model gateway/adapter calls. The user's unsaved `abcd` has no persisted historical record to recover.

## Deployed HTTP acceptance (2026-10-20)

Source commit `1d0facef2f24f98e0dda31f86d57f97f87977b0d` was reviewed by the parent before installation. The new versioned package is `/data/_dsh-dev/previews/a2d2-v3-121/artifacts/http132-1d0face/dsh-a2d2-0.0.1.tgz`, SHA256 `3ba6225b0da7eb20f05724b4c686ba058d6f52d8e41bd98964ae566a10e22767`. Installation exited 0; installed client SHA256 equals the built client: `f8d77443584a553a7bab124866f3f0e9775d5bca3a347be4f3e9e2e1fca2b7e5`.

Only `dsh-a2d2-v3-preview` restarted. Final supervisor state: RUNNING, launcher PID `2636008`, child PID `2636015`, run ID `16c5b50f-86f7-442c-827b-cfd776ce9090`. Rollback manifest/lockfile/launcher remain under the preview's `evidence/http-fix-132/rollback`; old tgz and original `http-regression` red evidence are retained. No data snapshot was restored.

The agent-browser session `a2d2-http132` used exactly `http://10.126.126.12:18782/`, Chrome 150 native `isSecureContext=false`, `randomUUID=undefined`, `getRandomValues=function`. Its actual main-process arguments contain no insecure-origin exception or disable-web-security flag. No Crypto override, API mock, injected successful write, HTTPS or loopback substitute was used. The local password was handled only inside the automation process, and is excluded from evidence/Git. Only this owned browser was closed.

Actual visible UI actions created Project `验收_HTTP132_20261020_独立项目` (`1b3fd2f7-a492-4c1d-a965-7e7f8cc5cc58`) with no resources and Task `验收_HTTP132_20261020_工作` (`3e00a048-42b1-48dd-ae22-d6655c06779d`). The UI then saved specification version 2, added and saved block `d14c97ce-4a8c-47ec-8680-0bcd14e942d3`, and reloaded the whole page. Normal navigation reopened the saved task, specification and block. Read-only public queries subsequently verified task version 3, preserved specification version 1 history, and UUID v4 block/command identities. The Node verification script performed zero writes. Native dropdown UI labels the existing workspace owner and disables selection; independent local creation remains selected by default.

| Evidence | Result |
| --- | --- |
| [Owner dropdown](10-owner-dropdown-disabled.png) | Owning Project visible, occupied option disabled |
| [Reloaded specification](08-reloaded-specification.png) | Saved version 2 visible after full reload |
| [Reloaded breakdown](09-reloaded-breakdown.png) | Saved block visible after full reload |
| [Native HTTP and flags](browser-native-owner-and-flags.json) | Insecure context preserved; no exceptions or mocks |
| [Read-only saved-fact verdict](read-only-verdict.json) | Expected versions, history, UUIDs, owner, and `abcd` absence |
| [Before hashes](before-retention.json), [immediately after restart](after-retention.json), [final retention](final-retention.json) | Existing Project/Agent/2 Tasks/5 receipts retain every record hash and ID; associations unchanged |
| [Session byte diagnosis](session-byte-diagnosis.json) | Original 337 compressed bytes retain their exact SHA as a prefix; host appended only 80 bytes of `session/end-seed` on opening the existing native session |
| [Strict whole-file hash failure](retention-strict-failure.json) | Retained explicitly; final whole-file hash differs due to that observed append, never reported as identical |

Final counts are 2 Projects, 2 Agents, 3 Tasks and 9 receipts, reflecting only the explicitly named acceptance Project/Task and their four UI commands. Session file paths/IDs remain the same. Model gateway and adapter counters remain **0** before and after; no new model messages were sent.

Two browser automation waits required correction: page reload presents the host Preview Notice before panel navigation, and an accessibility label is not visible text for `wait --text`. The notice was accepted through its ordinary Continue button; the incorrect label wait was cancelled and current controls were inspected. The first off-screen add-block attempt showed no block and no browser error; scrolling the real control into view and clicking produced the block. No product/store workaround was applied. Original failures and all local screenshots/scripts remain in the private preview evidence directory.
