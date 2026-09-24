/**
 * Host-side loading of writable skill sources.
 *
 * A skill is injected as authored rather than translated into plugin-owned
 * guidance. Local markdown resources named by the skill body follow the main
 * file in declaration order, so the skill remains the only source of rules.
 *
 * @module @deepseek-ai/dsh-a2d2/src/skill-source
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/** Conventional host directory containing installed skills. */
export const DEFAULT_SKILLS_ROOT = join(homedir(), '.agents', 'skills')

/** Injectable inputs for deterministic skill-root resolution. */
export interface SkillsRootResolutionOptions {
  readonly candidates?: readonly string[]
  readonly pathExists?: (path: string) => boolean
  readonly skillName?: string
}

/** Ordered conventional locations in which a host may already have skills installed. */
export function defaultSkillsRootCandidates(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): readonly string[] {
  const candidates = [
    environment.DSH_SKILLS_ROOT,
    join(homeDirectory, '.agents', 'skills'),
    environment.CODEX_HOME === undefined ? undefined : join(environment.CODEX_HOME, 'skills'),
    join(homeDirectory, '.codex', 'skills'),
  ]
  const seen = new Set<string>()
  return candidates.flatMap((candidate) => {
    if (candidate === undefined || !isAbsolute(candidate) || seen.has(candidate)) return []
    seen.add(candidate)
    return [candidate]
  })
}

/** Resolve an explicit skill root or probe conventional roots in priority order. */
export function resolveSkillsRoot(
  configuredRoot: string | undefined,
  options: SkillsRootResolutionOptions = {},
): string {
  if (configuredRoot !== undefined) return configuredRoot
  const candidates = options.candidates ?? defaultSkillsRootCandidates()
  const pathExists = options.pathExists ?? existsSync
  const skillName = options.skillName ?? 'handoff'
  for (const candidate of candidates) {
    const skillDirectory = join(candidate, skillName)
    if (pathExists(join(skillDirectory, 'SKILL.md')) || pathExists(skillDirectory)) return candidate
  }
  return DEFAULT_SKILLS_ROOT
}

/** One markdown resource referenced by a skill, unchanged from disk. */
export interface SkillResource {
  /** Path as declared by the skill, relative to SKILL.md. */
  readonly path: string
  /** Complete UTF-8 file contents. */
  readonly content: string
}

/** A skill source and all markdown resources its body declares. */
export interface LoadedSkillSource {
  readonly status: 'loaded'
  /** Complete SKILL.md contents. */
  readonly skill: string
  /** Referenced resources, deduplicated in first-declaration order. */
  readonly resources: readonly SkillResource[]
}

/** Explicit signal that the requested skill has no readable SKILL.md. */
export interface MissingSkillSource {
  readonly status: 'missing'
}

/** Result of reading one installed skill. */
export type SkillSource = LoadedSkillSource | MissingSkillSource

interface LocatedReference {
  readonly index: number
  readonly path: string
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function localMarkdownPath(raw: string): string | undefined {
  const unwrapped = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw
  const path = unwrapped.split(/[?#]/u, 1)[0]
  if (path === undefined || path === '' || !path.toLowerCase().endsWith('.md')) return undefined
  if (isAbsolute(path) || /^[a-z][a-z\d+.-]*:/iu.test(path)) return undefined
  return path
}

function skillBody(markdown: string): string {
  const frontMatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u.exec(markdown)
  return frontMatter === null ? markdown : markdown.slice(frontMatter[0].length)
}

// TODO(ticket 03): prose .md mentions are overmatched; before ask-matt injection, accept only explicit markdown-link declarations (see boundary-card ticket 03).
/** Find markdown links and bare markdown filenames without reordering either form. */
function declaredMarkdownResources(markdown: string): readonly string[] {
  const references: LocatedReference[] = []
  const linkRanges: Array<readonly [number, number]> = []
  const linkPattern = /!?\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\s*\)/gu
  for (const match of markdown.matchAll(linkPattern)) {
    const raw = match[1]
    if (match.index === undefined || raw === undefined) continue
    linkRanges.push([match.index, match.index + match[0].length])
    const path = localMarkdownPath(raw)
    if (path !== undefined) references.push({ index: match.index, path })
  }

  const barePattern = /(?:^|[^\w./-])((?:\.{1,2}\/)?(?:[\w.-]+\/)*[\w.-]+\.md)(?=$|[^\w./-])/gimu
  for (const match of markdown.matchAll(barePattern)) {
    if (match.index === undefined || match[1] === undefined) continue
    const index = match.index + match[0].indexOf(match[1])
    if (linkRanges.some(([start, end]) => index >= start && index < end)) continue
    references.push({ index, path: match[1] })
  }

  references.sort((left, right) => left.index - right.index)
  const seen = new Set<string>()
  return references.flatMap((reference) => {
    if (seen.has(reference.path)) return []
    seen.add(reference.path)
    return [reference.path]
  })
}

/**
 * Read one installed skill and the local markdown resources declared by it.
 *
 * Only an absent SKILL.md is a normal degraded result. A referenced resource
 * that cannot be read means the installed source is incomplete and fails
 * loudly instead of silently injecting a partial rule set.
 *
 * @param name - installed skill directory name.
 * @param skillsRoot - explicit directory containing installed skills; omitted to probe conventional roots.
 * @returns the verbatim source, or an explicit missing signal.
 */
export async function readSkillSource(
  name: string,
  skillsRoot?: string,
): Promise<SkillSource> {
  const resolvedSkillsRoot = resolveSkillsRoot(skillsRoot, { skillName: name })
  const skillPath = resolve(resolvedSkillsRoot, name, 'SKILL.md')
  let skill: string
  try {
    skill = await readFile(skillPath, 'utf8')
  } catch (error) {
    if (isMissing(error)) return { status: 'missing' }
    throw error
  }

  const directory = dirname(skillPath)
  const resources: SkillResource[] = []
  const seenResourcePaths = new Set<string>()
  for (const path of declaredMarkdownResources(skillBody(skill))) {
    const resourcePath = resolve(directory, path)
    if (resourcePath === skillPath || seenResourcePaths.has(resourcePath)) continue
    seenResourcePaths.add(resourcePath)
    try {
      resources.push({ path, content: await readFile(resourcePath, 'utf8') })
    } catch (error) {
      throw new Error(`a2d2: handoff skill resource "${path}" could not be read`, { cause: error })
    }
  }
  return { status: 'loaded', skill, resources }
}
