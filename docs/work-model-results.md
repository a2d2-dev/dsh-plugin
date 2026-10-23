# Model work tool results (#209)

Model responses are projections of application results. Persistence, GUI queries and runtime authorization retain complete records. `work_control status` remains callable after startup and returns coordinator identity as a boolean, epoch, Task/specification versions and a specification availability/version marker. It never returns Task or Execution bodies. Supply `known_specification_version` from startup or a completed explicit read to distinguish current from changed material; without it compare the returned version to startup. Missing material is always flagged.

`work_report` returns `saved`, actual stage, Task/specification/report versions and execution/control state. Saving a report is distinct from accepting completion; completion gates run before the projection, and precise permission, conflict and acceptance failures pass through unchanged. The submitted summary, evidence and report body are not echoed.

`work_organize` returns the action, save result and versions. `source-children` success means the complete observed native-child scope passed existing checks; it does not accept child completion. Local child creation remains forbidden on this baseline (`local-subtask-not-supported`); native sub-issues are created/imported through the existing source route.

Normal status responses have a 2,048 UTF-8 byte regression budget. Errors retain their exact code, message and conflict version. A status receipt is not lasting authority: every write rechecks the real calling Session and epoch.
