/**
 * The turn that writes a handoff summary.
 *
 * The document's content is the handing-off session's own account of the work,
 * because that session is the only writer that holds the conversation in
 * context. The plugin therefore queues one ordinary turn instead of projecting
 * the transcript, and this module owns the text of that turn. It is model-facing
 * prose: it states the task from the model's perspective, names the exact region
 * to replace, and keeps the plugin's own contract out of the summary itself.
 *
 * @module @deepseek-ai/dsh-a2d2/src/handoff-instruction
 */

import {
  HANDOFF_SUMMARY_END,
  HANDOFF_SUMMARY_PLACEHOLDER,
  HANDOFF_SUMMARY_START,
} from './handoff-document.ts'

/** Most characters the successor's first prompt should carry the summary in. */
export const HANDOFF_SUMMARY_MAX_CHARS = 4000

/**
 * Render the instruction for one handoff.
 *
 * @param path - absolute path of the skeleton document to fill in.
 * @param focus - what the next session is for, absent for a generic handoff.
 * @returns the text of the queued turn.
 */
export function handoffInstruction(path: string, focus: string | undefined): string {
  return [
    'The user asked to hand this session off to a successor session.',
    '',
    'Write the handoff summary yourself, following the `handoff` skill — load that',
    'skill if you have a skill tool. Its rules:',
    '',
    '- Summarise this conversation for a fresh agent that continues the work. Compress:',
    '  the goal, what is done, the current state, what is next, the files and paths that',
    '  matter, and any decision left open or blocker. Do not quote or paste the',
    '  conversation into the summary.',
    '- Do not repeat content another artifact already records (specs, plans, ADRs,',
    '  issues, commits, diffs). Reference it by path or URL instead.',
    '- Redact secrets: API keys, tokens, passwords, personal data.',
    '',
    'The plugin already wrote the document at',
    '',
    `  ${path}`,
    '',
    `Replace the line between \`${HANDOFF_SUMMARY_START}\` and \`${HANDOFF_SUMMARY_END}\` —`,
    `currently \`${HANDOFF_SUMMARY_PLACEHOLDER}\` — with that summary, and change nothing else in the`,
    'file: the front matter and the surrounding sections are the plugin\'s, and the',
    'successor\'s validation reads them.',
    '',
    `Keep the summary under about ${HANDOFF_SUMMARY_MAX_CHARS} characters: the successor receives`,
    'it as its first prompt and carries every character of it for the rest of its work.',
    '',
    focus === undefined
      ? 'No focus was given, so summarise the work as it stands.'
      : `What the next session is for: ${focus}`,
  ].join('\n')
}
