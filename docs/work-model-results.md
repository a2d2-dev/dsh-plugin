# Model work tool results (#209)

Model responses are projections of application results. Persistence, GUI queries and runtime authorization retain complete records. `work_control status` remains callable after startup and returns coordinator identity as a boolean, epoch, Task/specification versions and a specification availability/version marker. It never returns Task or Execution bodies. Supply `known_specification_version` from startup or a completed explicit read to distinguish current from changed material; without it compare the returned version to startup. Missing material is always flagged.

Normal status responses have a 2,048 UTF-8 byte regression budget. Errors retain their exact code, message and conflict version. A status receipt is not lasting authority: every write rechecks the real calling Session and epoch.
