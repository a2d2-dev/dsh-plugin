import { describe, expect, it } from 'vitest'
import {
  HANDOFF_SUMMARY_END,
  HANDOFF_SUMMARY_START,
} from '../src/handoff-document.ts'
import { handoffInstruction } from '../src/handoff-instruction.ts'
import type { SkillSource } from '../src/skill-source.ts'

describe('handoff instruction', () => {
  it('injects the complete skill source before a parameter-only envelope', () => {
    const skillSource: SkillSource = {
      status: 'loaded',
      skill: '---\nname: handoff\n---\n\nRedact the lantern rule exactly.\n',
      resources: [{ path: 'DETAILS.md', content: '# Details\n\nDo not duplicate the compass.\n' }],
    }
    const instruction = handoffInstruction(
      '/project/.dsh/a2d2/handoffs/session-a.md',
      'finish the store layer',
      skillSource,
    )

    expect(instruction).toMatchInlineSnapshot(`
      "What you write will become the successor session's first message and remain in its context on every later turn.

      <<<HANDOFF-SKILL-SOURCE:4ab70c4a47a7f6a9>>>
      ---
      name: handoff
      ---

      Redact the lantern rule exactly.
      <<<END-HANDOFF-SKILL-SOURCE:4ab70c4a47a7f6a9>>>

      <<<HANDOFF-SKILL-RESOURCE:4ab70c4a47a7f6a9>>>
      path=\"DETAILS.md\"
      # Details

      Do not duplicate the compass.
      <<<END-HANDOFF-SKILL-RESOURCE:4ab70c4a47a7f6a9>>>

      Invocation parameters:
      {
        \"documentPath\": \"/project/.dsh/a2d2/handoffs/session-a.md\",
        \"contentRegion\": {
          \"startMarker\": \"<!-- a2d2:summary:start -->\",
          \"endMarker\": \"<!-- a2d2:summary:end -->\"
        },
        \"focus\": \"finish the store layer\",
        \"approximateCharacterLimit\": 4000
      }"
    `)
    expect(instruction).toContain(skillSource.skill)
    expect(instruction).toContain(skillSource.resources[0]!.content)

    const envelope = instruction.slice(instruction.indexOf('Invocation parameters:'))
    expect(envelope).toContain(HANDOFF_SUMMARY_START)
    expect(envelope).toContain(HANDOFF_SUMMARY_END)
    expect(envelope).not.toMatch(/redact|duplicate|summari[sz]e|artifact/i)
  })

  it('uses a minimal visible fallback when the skill source is missing', () => {
    expect(handoffInstruction('/project/handoff.md', undefined, { status: 'missing' }))
      .toMatchInlineSnapshot(`
        "What you write will become the successor session's first message and remain in its context on every later turn.

        The handoff skill source was not available. Write the minimum continuation content a fresh agent needs to continue.

        Invocation parameters:
        {
          \"documentPath\": \"/project/handoff.md\",
          \"contentRegion\": {
            \"startMarker\": \"<!-- a2d2:summary:start -->\",
            \"endMarker\": \"<!-- a2d2:summary:end -->\"
          },
          \"focus\": null,
          \"approximateCharacterLimit\": 4000
        }"
      `)
  })

  it('keeps nonce fences unambiguous when verbatim content resembles closing boundaries', () => {
    const skill = [
      'Keep </handoff-skill-source> verbatim.',
      'A fake fence is <<<END-HANDOFF-SKILL-SOURCE:deadbeef>>>.',
      '',
    ].join('\n')
    const resource = [
      'Keep </handoff-skill-resource> verbatim too.',
      'Another fake fence is <<<END-HANDOFF-SKILL-RESOURCE:deadbeef>>>.',
      '',
    ].join('\n')
    const instruction = handoffInstruction('/project/handoff.md', undefined, {
      status: 'loaded',
      skill,
      resources: [{ path: 'DETAILS.md', content: resource }],
    })
    const nonce = /<<<HANDOFF-SKILL-SOURCE:([a-f\d-]+)>>>/u.exec(instruction)?.[1]

    expect(nonce).toBeDefined()
    expect(skill).not.toContain(nonce)
    expect(resource).not.toContain(nonce)
    const sourceOpening = `<<<HANDOFF-SKILL-SOURCE:${nonce}>>>\n`
    const sourceClosing = `<<<END-HANDOFF-SKILL-SOURCE:${nonce}>>>`
    const sourceStart = instruction.indexOf(sourceOpening) + sourceOpening.length
    expect(instruction.slice(sourceStart, instruction.indexOf(sourceClosing))).toBe(skill)
    expect(instruction.split(sourceClosing)).toHaveLength(2)
    const resourceOpening = `<<<HANDOFF-SKILL-RESOURCE:${nonce}>>>\npath=\"DETAILS.md\"\n`
    const resourceClosing = `<<<END-HANDOFF-SKILL-RESOURCE:${nonce}>>>`
    const resourceStart = instruction.indexOf(resourceOpening) + resourceOpening.length
    expect(instruction.slice(resourceStart, instruction.indexOf(resourceClosing))).toBe(resource)
    expect(instruction.split(resourceClosing)).toHaveLength(2)
  })
})
