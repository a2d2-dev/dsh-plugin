/**
 * Project-local session Agent records.
 *
 * Main sessions are derived from task issue bindings and are not written here;
 * this ledger records sessions created directly as a named A2D2 Agent, such as
 * dispatched subagents and browser-created sessions.
 *
 * @module @deepseek-ai/dsh-a2d2/src/session-agents
 */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { STAGE_AGENTS } from './stage-agents.ts'
import type { StageAgent } from './stage-agents.ts'

/** Path segments appended to a project root to reach the session Agent ledger. */
export const SESSION_AGENTS_FILE_SEGMENTS = ['.dsh', 'a2d2', 'session-agents.yaml'] as const

/** Document schema version written by this build. */
export const SESSION_AGENTS_DOCUMENT_VERSION = 1

export interface SessionAgentRecord {
  readonly sessionId: SessionId
  readonly agent: StageAgent
}

export interface SessionAgentsDocument {
  readonly version: typeof SESSION_AGENTS_DOCUMENT_VERSION
  readonly sessions: readonly SessionAgentRecord[]
}

export type SessionAgentsDocumentErrorCode = 'malformed' | 'unsupported-version' | 'duplicate-session'

/** A session Agent ledger this build refuses to read. */
export class SessionAgentsDocumentError extends Error {
  override readonly name = 'SessionAgentsDocumentError'
  readonly code: SessionAgentsDocumentErrorCode

  constructor(code: SessionAgentsDocumentErrorCode, message: string) {
    super(`a2d2: ${message}`)
    this.code = code
  }
}

const AGENT_SET = new Set<string>(STAGE_AGENTS)

function malformed(message: string): SessionAgentsDocumentError {
  return new SessionAgentsDocumentError('malformed', message)
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw malformed(`${field} must be a mapping`)
  }
  return value as Record<string, unknown>
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw malformed(`${field} must be a non-empty string`)
  }
  return value
}

function parseRecord(value: unknown, index: number): SessionAgentRecord {
  const record = asRecord(value, `sessions[${index}]`)
  const agent = requiredString(record, 'agent')
  if (!AGENT_SET.has(agent)) throw malformed(`sessions[${index}].agent must be one of ${STAGE_AGENTS.join(', ')}`)
  return {
    sessionId: requiredString(record, 'id') as SessionId,
    agent: agent as StageAgent,
  }
}

/** Parse and validate a session Agent ledger. */
export function parseSessionAgentsDocument(text: string): SessionAgentsDocument {
  let raw: unknown
  try {
    raw = parseYaml(text)
  } catch (error) {
    throw malformed(`session Agent ledger is not valid YAML: ${(error as Error).message}`)
  }
  const record = asRecord(raw, 'document')
  const version = record.version
  if (version !== SESSION_AGENTS_DOCUMENT_VERSION) {
    throw new SessionAgentsDocumentError(
      'unsupported-version',
      `session Agent ledger declares version ${String(version)}; this build reads version ${SESSION_AGENTS_DOCUMENT_VERSION}`,
    )
  }
  if (record.sessions !== undefined && !Array.isArray(record.sessions)) {
    throw malformed('sessions must be a sequence')
  }
  const sessions = ((record.sessions ?? []) as unknown[]).map(parseRecord)
  const seen = new Set<string>()
  for (const entry of sessions) {
    if (seen.has(entry.sessionId)) {
      throw new SessionAgentsDocumentError('duplicate-session', `session Agent ledger records session "${entry.sessionId}" more than once`)
    }
    seen.add(entry.sessionId)
  }
  return { version: SESSION_AGENTS_DOCUMENT_VERSION, sessions }
}

/** Render a session Agent ledger in canonical field order. */
export function renderSessionAgentsDocument(document: SessionAgentsDocument): string {
  return stringifyYaml({
    version: SESSION_AGENTS_DOCUMENT_VERSION,
    sessions: document.sessions.map(entry => ({ id: entry.sessionId, agent: entry.agent })),
  }, { lineWidth: 0 })
}

/** Absolute session Agent ledger path for a project. */
export function sessionAgentsFile(projectRoot: string): string {
  return join(projectRoot, ...SESSION_AGENTS_FILE_SEGMENTS)
}

/** File-backed session Agent ledger for one deployment. */
export class SessionAgentStore {
  async read(projectRoot: string): Promise<SessionAgentsDocument> {
    const path = sessionAgentsFile(projectRoot)
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: SESSION_AGENTS_DOCUMENT_VERSION, sessions: [] }
      }
      throw error
    }
    return parseSessionAgentsDocument(text)
  }

  async agentOf(projectRoot: string, sessionId: SessionId): Promise<StageAgent | undefined> {
    return (await this.read(projectRoot)).sessions.find(entry => entry.sessionId === sessionId)?.agent
  }

  async record(projectRoot: string, sessionId: SessionId, agent: StageAgent): Promise<void> {
    const path = sessionAgentsFile(projectRoot)
    await mkdir(dirname(path), { recursive: true })
    await withFileLock(path, async () => {
      const document = await this.read(projectRoot)
      const existing = document.sessions.find(entry => entry.sessionId === sessionId)
      if (existing !== undefined) {
        if (existing.agent === agent) return
        throw new SessionAgentsDocumentError(
          'duplicate-session',
          `session Agent ledger already recorded session "${sessionId}" as ${existing.agent}`,
        )
      }
      const sessions = [...document.sessions, { sessionId, agent }]
      sessions.sort((left, right) => left.sessionId.localeCompare(right.sessionId))
      await writeFileAtomic(path, renderSessionAgentsDocument({ version: SESSION_AGENTS_DOCUMENT_VERSION, sessions }), {
        mode: 0o600,
        dirMode: 0o700,
      })
    })
  }
}
