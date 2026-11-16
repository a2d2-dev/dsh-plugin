# Grok Bot remains an external tool collaborator

**Status:** Accepted

## Context

The DSH plugin `Lniosy/dsh-tool-grok-bot` already provides model-facing tools for listing Grok Bots, asking one, and collecting its asynchronous reply. It keeps the Grok account, API protocol, cloud computer and memory outside A²D². The package is MIT licensed and exposes these capabilities through the DSH tool registry, not a host-side service API.

A²D² needs a small settings entry for the default target and an opt-in instruction limited to the current managed Task coordinator Session. It must not claim that a remote Bot owns a DSH session, Project Agent identity, child Task or acceptance decision.

## Decision

- Keep `dsh-tool-grok-bot` a separate optional DSH plugin; A²D² detects its public `grok_bot_list`, `grok_bot_ask` and `grok_bot_wait` tool schemas and does not bundle it as a dependency.
- Save only `enabled` and `defaultBot` in the `a2d2-bot` settings namespace. The browser route uses DSH connection authentication and revision checks; it never reads or stores Grok credentials and never sends a Bot message.
- Add guidance only while a session is the current coordinator of an incomplete managed Task, and only when the integration is enabled and the companion tools are present. Recheck at each turn so a transferred Session loses the guidance.
- Ask and wait through the companion's normal model-facing tools. The Grok Bot remains an external collaborator; the CEO reviews its reply before treating it as evidence or reporting completion.

## Consequences

- A profile without `dsh-tool-grok-bot` keeps all existing A²D² behavior; the settings page reports the missing tools.
- Bot authentication and the Grok API remain owned by the companion plugin.
- Bot calls remain visible in the existing DSH conversation. They do not create a child Session or require fabricated execution identity in the Task tree.
- The settings page can confirm tool registration, but not account login; `grok_bot_status` remains the companion's account check.
