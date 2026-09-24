import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readSkillSource } from '../src/skill-source.ts'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'a2d2-skills-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('skill source', () => {
  it('reads SKILL.md and local markdown resources in declaration order without rewriting them', async () => {
    const root = await tempRoot()
    const directory = join(root, 'handoff')
    await mkdir(join(directory, 'references'), { recursive: true })
    const skill = [
      '---',
      'name: handoff',
      'description: FRONT-MATTER.md is metadata, not a declared resource.',
      '---',
      '',
      'Read [the first guide](references/FIRST.md), then `SECOND.md`.',
      'The first guide is also references/FIRST.md.',
      '',
    ].join('\n')
    const first = '# First\n\nKeep this exact.\n'
    const second = '# Second\n\nKeep this exact too.\n'
    await writeFile(join(directory, 'SKILL.md'), skill, 'utf8')
    await writeFile(join(directory, 'references', 'FIRST.md'), first, 'utf8')
    await writeFile(join(directory, 'SECOND.md'), second, 'utf8')

    expect(await readSkillSource('handoff', root)).toEqual({
      status: 'loaded',
      skill,
      resources: [
        { path: 'references/FIRST.md', content: first },
        { path: 'SECOND.md', content: second },
      ],
    })
  })

  it('returns an explicit missing signal when SKILL.md is unavailable', async () => {
    const root = await tempRoot()
    await expect(readSkillSource('handoff', root)).resolves.toEqual({ status: 'missing' })
  })

  it('fails loudly when a declared local markdown resource is unavailable', async () => {
    const root = await tempRoot()
    const directory = join(root, 'handoff')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), 'Read [the guide](MISSING.md).\n', 'utf8')

    await expect(readSkillSource('handoff', root)).rejects.toThrow(/MISSING\.md/)
  })
})
