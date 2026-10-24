# Security policy

## Supported code

This project is prerelease software. Security fixes are developed on `main`; the latest prerelease is the only release line considered for backports. Older development branches and the differently named `dsh-a2d2` v0.0.1 package are not maintained release lines. Host capabilities must be verified independently of the declared DSH version range.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/a2d2-dev/dsh-plugin/security/advisories/new) when that repository feature is available. If access or repository policy prevents using it, open a minimal Issue titled “Private security contact requested” without exploit details, logs, tokens or affected personal data; a maintainer must establish a private reporting channel before sensitive material is shared. A public issue is not a place to send the report itself. No response-time SLA is promised.

Include the affected package and host versions, reproduction conditions, impact and a minimal sanitized example. Do not send real credentials, session archives, private Issue bodies or screenshots containing personal data. Coordinate disclosure with maintainers and upstream DSH when its host behavior is involved.

## Credentials and external services

GitHub source access uses the local `gh` CLI's authentication. Optional `github_watch` obtains a GitHub token through `gh auth token`, falling back to `GH_TOKEN`/`GITHUB_TOKEN`, and sends it in an Authorization header to the configured relay to obtain a subscription ticket. The default operator is the A²D² project at `https://hooks.a2d2.dev`; enable that feature only if you trust the operator with this credential. A self-hosted relay can be selected with `relayUrl`. The browser does not receive source credentials.

Use least-privilege tokens and keep DSH authentication enabled. Browser routes rely on the host's authenticated connection checks. A plugin runs with the permissions of its host process; installation is a code-trust decision. Model providers, optional workflow skills and notification providers have their own trust boundaries.

## Release privacy

Secret scanning does not establish that screenshots, model prompts or private project records are safe to publish. Test information belongs in the private [a2d2-dev/project](https://github.com/a2d2-dev/project) repository. Removing a file from `main` does not erase old branches, tags, PR references or release attachments. Complete the [publication gates](docs/releasing.md#公开发布门槛) before making the source repository public. Rotate a credential if a real exposure is confirmed; do not print it in a cleanup report.
