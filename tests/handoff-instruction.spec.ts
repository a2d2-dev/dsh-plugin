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

      <handoff-skill-source>
      ---
      name: handoff
      ---

      Redact the lantern rule exactly.
      </handoff-skill-source>

      <handoff-skill-resource path=\"DETAILS.md\">
      # Details

      Do not duplicate the compass.
      </handoff-skill-resource>

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
})
