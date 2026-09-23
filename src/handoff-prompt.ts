/**
 * The first prompt a successor session receives when it takes a handoff.
 *
 * The prompt is produced by the plugin rather than typed by a person, so it
 * states where it came from and what the successor is expected to do with it.
 * It carries the document body and nothing else — the front matter exists so
 * `take` can validate the file, and reading it back to the model would only
 * spend the successor's context on fields it cannot act on.
 *
 * @module @deepseek-ai/dsh-a2d2/src/handoff-prompt
 */

import type { HandoffDocument } from './handoff-document.ts'

/**
 * Render the successor's first prompt from a handoff document.
 *
 * The body is trimmed the same way `renderHandoffDocument` trims it, so a
 * document rewritten after redaction carries the same text into the prompt as it
 * does into the committed file.
 * @param document - the handoff document being taken.
 * @returns the prompt text.
 */
export function handoffPrompt(document: HandoffDocument): string {
  return [
    'Continue the work described below.',
    '',
    '---',
    '',
    document.body.trim(),
    '',
    '---',
    '',
    'Continue with the focus above.',
  ].join('\n')
}
