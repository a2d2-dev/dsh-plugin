import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SKILLS_ROOT,
  defaultSkillsRootCandidates,
  readSkillSource,
  resolveSkillsRoot,
  skillDescription,
} from '../src/skill-source.ts'

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
  it('reads the front-matter description verbatim, unquoting a quoted value', () => {
    expect(skillDescription('---\nname: x\ndescription: 编排契约。\n---\nbody')).toBe('编排契约。')
    expect(skillDescription('---\ndescription: "Quoted: yes"\n---\n')).toBe('Quoted: yes')
  })

  it('returns undefined without front matter or a description', () => {
    expect(skillDescription('description: not front matter')).toBeUndefined()
    expect(skillDescription('---\nname: x\n---\ndescription: body')).toBeUndefined()
  })

  it('orders environment and conventional skill-root candidates', () => {
    expect(defaultSkillsRootCandidates({
      DSH_SKILLS_ROOT: '/skills/environment',
      CODEX_HOME: '/opt/codex',
    }, '/home/tester')).toEqual([
      '/skills/environment',
      '/home/tester/.agents/skills',
      '/opt/codex/skills',
      '/home/tester/.codex/skills',
    ])
  })

  it('selects the first candidate containing the requested skill', () => {
    const candidates = ['/skills/first', '/skills/second', '/skills/third']
    const pathExists = vi.fn((path: string) => path === '/skills/second/handoff/SKILL.md')

    expect(resolveSkillsRoot(undefined, { candidates, pathExists })).toBe('/skills/second')
    expect(pathExists.mock.calls.flat()).toEqual([
      '/skills/first/handoff/SKILL.md',
      '/skills/first/handoff',
      '/skills/second/handoff/SKILL.md',
    ])
  })

  it('falls back to the conventional root when no candidate contains the skill', () => {
    const pathExists = vi.fn(() => false)

    expect(resolveSkillsRoot(undefined, { candidates: ['/skills/empty'], pathExists }))
      .toBe(DEFAULT_SKILLS_ROOT)
  })

  it('uses an explicit root without probing candidates', () => {
    const pathExists = vi.fn(() => true)

    expect(resolveSkillsRoot('/skills/configured', {
      candidates: ['/skills/auto'],
      pathExists,
    })).toBe('/skills/configured')
    expect(pathExists).not.toHaveBeenCalled()
  })

  it('reads SKILL.md and explicitly linked local markdown resources without rewriting them', async () => {
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
    await writeFile(join(directory, 'SKILL.md'), skill, 'utf8')
    await writeFile(join(directory, 'references', 'FIRST.md'), first, 'utf8')

    expect(await readSkillSource('handoff', root)).toEqual({
      status: 'loaded',
      skill,
      resources: [
        { path: 'references/FIRST.md', content: first },
      ],
    })
  })

  it('loads ask-matt from an isolated fixture without treating prose mentions as resources', async () => {
    const root = await tempRoot()
    const directory = join(root, 'ask-matt')
    await mkdir(directory, { recursive: true })
    const skill = [
      '# Ask Matt',
      '',
      'Read [the phase guide](PHASE-BOUNDARIES.md).',
      'CONTEXT.md and AGENTS.md are prose mentions, not linked resources.',
      '',
    ].join('\n')
    const boundaries = '# Phase boundaries\n\nFixture decision tree.\n'
    await writeFile(join(directory, 'SKILL.md'), skill, 'utf8')
    await writeFile(join(directory, 'PHASE-BOUNDARIES.md'), boundaries, 'utf8')

    await expect(readSkillSource('ask-matt', root)).resolves.toEqual({
      status: 'loaded',
      skill,
      resources: [{ path: 'PHASE-BOUNDARIES.md', content: boundaries }],
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
