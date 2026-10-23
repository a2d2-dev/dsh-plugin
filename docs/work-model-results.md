# Model work tool results (#209)

Model responses are projections of application results. Persistence, GUI queries and runtime authorization retain complete records. `work_control status` remains callable after startup and returns coordinator identity as a boolean, epoch, Task/specification versions and a specification availability/version marker. It never returns Task or Execution bodies. Supply `known_specification_version` from startup or a completed explicit read to distinguish current from changed material; without it compare the returned version to startup. Missing material is always flagged.

`work_report` returns `saved`, actual stage, Task/specification/report versions and execution/control state. Saving a report is distinct from accepting completion; completion gates run before the projection, and precise permission, conflict and acceptance failures pass through unchanged. The submitted summary, evidence and report body are not echoed.

`work_organize` returns the action, save result and versions. `source-children` success means the complete observed native-child scope passed existing checks; it does not accept child completion. Local child creation remains forbidden on this baseline (`local-subtask-not-supported`); native sub-issues are created/imported through the existing source route.

`work_read` is the explicit current-coordinator detail path. Choose `specification` (goal, current specification including every criterion, linked children and accepted native scope), `progress`, `sources`, or `continuation`. Obtain `expected_version` from status. Each response contains at most 2,000 UTF-16 content units, `totalCharacters`, `revision`, `complete`, and (when incomplete) `nextCursor`. Concatenate `content` from every page, then parse the resulting JSON; never interpret a partial specification as the full constraints. Later pages require the original revision and Task version. Task version conflicts, content revision changes and stale epochs reject the read so it can restart. Every page checks the real current Session. The regression budget is 16,384 UTF-8 bytes per detail response, allowing JSON escaping. `work_related_issue` remains the trusted fresh source observation route; existing GUI/history queries retain full records.

Startup/continuation material includes specification version and explicit missing-material markers. Status accepts `known_specification_version`; `changed` and `missing` require an explicit specification read. Missing criteria must be resolved from accepted source/user decisions, never invented. This protocol does not add a storage flag or change completion gates.

Normal status responses have a 2,048 UTF-8 byte regression budget. Errors retain their exact code, message and conflict version. A status receipt is not lasting authority: every write rechecks the real calling Session and epoch.

## Regression evidence

`tests/work-compact-results.spec.ts` constructs a fixed multilingual/escaped payload via public commands, adds nine large specification revisions, and performs three real DSH Session handoffs (four Sessions). It measures the same full application results that the old tools serialized and the new public tool responses. No host-output truncation is used. The actual host lifecycle, persistence, tool runtime, authority fencing and completion gates run; the model transport uses the existing deterministic `contract/selected` adapter, so this is not a live external-provider/deployment acceptance.

| Tool | Initial full chars / UTF-8 bytes | Large-history full chars / UTF-8 bytes | Initial compact chars / bytes | Large-history compact chars / bytes |
| --- | ---: | ---: | ---: | ---: |
| status | 20,305 / 52,325 | 506,946 / 890,976 | 123 / 123 | 125 / 125 |
| report | 20,590 / 52,610 | 507,011 / 891,041 | 164 / 164 | 167 / 167 |
| organize | 28,800 / 76,830 | 524,019 / 920,049 | 189 / 189 | 192 / 192 |

For the incident mix (3 status + 4 report + 1 organize), the large fixture totals 4,072,901 chars / 7,157,141 UTF-8 bytes before projection and 1,235 chars / bytes after projection. These are exact serialized sizes for the regression fixture, distinct from the incident's observed 399,445 characters. There is no token estimate. Budgets assert at most 2,048 bytes per ordinary response and at most 10 bytes of metadata growth between initial and large history; all current specification content can be reconstructed through explicit paginated reads. Runtime timing/UUIDs may change metadata lengths slightly.
