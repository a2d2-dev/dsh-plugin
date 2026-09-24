/**
 * The turn that writes handoff continuation content.
 *
 * The document's content is the handing-off session's own account of the work,
 * because that session is the only writer that holds the conversation in
 * context. The host injects the writable handoff skill source verbatim, then
 * supplies only invocation parameters owned by the plugin.
 *
 * @module @deepseek-ai/dsh-a2d2/src/handoff-instruction
 */

import { createHash } from 'node:crypto'
import {
  HANDOFF_SUMMARY_END,
  HANDOFF_SUMMARY_START,
} from './handoff-document.ts'
import type { LoadedSkillSource, SkillSource } from './skill-source.ts'

/** Approximate maximum characters for the successor's continuation content. */
export const HANDOFF_SUMMARY_MAX_CHARS = 4000

/**
 * Render the instruction for one handoff.
 *
 * @param path - absolute path of the skeleton document to fill in.
 * @param focus - what the next session is for, absent for a generic handoff.
 * @param skillSource - verbatim handoff skill source, or its missing signal.
 * @returns the text of the queued turn.
 */
export function handoffInstruction(
  path: string,
  focus: string | undefined,
  skillSource: SkillSource,
): string {
  const source = skillSource.status === 'loaded'
    ? renderSkillSource(skillSource)
    : 'The handoff skill source was not available. Write the minimum continuation content a fresh agent needs to continue.'
  const parameters = {
    documentPath: path,
    contentRegion: {
      startMarker: HANDOFF_SUMMARY_START,
      endMarker: HANDOFF_SUMMARY_END,
    },
    focus: focus ?? null,
    approximateCharacterLimit: HANDOFF_SUMMARY_MAX_CHARS,
  }
  return [
    'What you write will become the successor session\'s first message and remain in its context on every later turn.',
    '',
    source,
    '',
    'Invocation parameters:',
    JSON.stringify(parameters, null, 2),
  ].join('\n')
}

function verbatimBlock(opening: string, content: string, closing: string): string {
  return `${opening}\n${content}${content.endsWith('\n') ? '' : '\n'}${closing}`
}

function boundaryNonce(source: LoadedSkillSource): string {
  const parts = [source.skill, ...source.resources.flatMap(resource => [resource.path, resource.content])]
  const seed = parts.map(part => `${Buffer.byteLength(part, 'utf8')}:${part}`).join('\n')
  const digest = createHash('sha256').update(seed).digest('hex').slice(0, 16)
  for (let attempt = 0; ; attempt += 1) {
    const nonce = attempt === 0 ? digest : `${digest}-${attempt.toString(36)}`
    if (parts.every(part => !part.includes(nonce))) return nonce
  }
}

function renderSkillSource(source: LoadedSkillSource): string {
  const nonce = boundaryNonce(source)
  const blocks = [verbatimBlock(
    `<<<HANDOFF-SKILL-SOURCE:${nonce}>>>`,
    source.skill,
    `<<<END-HANDOFF-SKILL-SOURCE:${nonce}>>>`,
  )]
  for (const resource of source.resources) {
    blocks.push(verbatimBlock(
      `<<<HANDOFF-SKILL-RESOURCE:${nonce}>>>`,
      `path=${JSON.stringify(resource.path)}\n${resource.content}`,
      `<<<END-HANDOFF-SKILL-RESOURCE:${nonce}>>>`,
    ))
  }
  return blocks.join('\n\n')
}
