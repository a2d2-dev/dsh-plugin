/** Authorization survives a context transfer; transport never rewrites its source. */
export const HANDOFF_AUTHORITY_RULES = [
  'Authorization provenance: preserve the original authorized work, necessary test actions, explicit user limits and restoration obligations.',
  'For each limit, cite the original user messages or local log references and its applicable scope; distinguish user decisions, system/tool constraints, Agent inferences and work already performed. Keep missing evidence explicit.',
  'Already performed read-only checks, receive-and-stop maintenance, and terminal Task refusals describe those operations; they do not create a business prohibition. Respect the actual host boundary and terminal state without expanding them into a user restriction.',
  'Honor later explicit user restrictions, pauses and stops. Verify conflicting Agent claims against original messages before attributing them to the human; do not invent a prohibition or ask the human to repeat an existing authorization.',
].join('\n')
