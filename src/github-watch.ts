/**
 * GitHub watch: wake a session when a pull request it waits on merges, closes,
 * finishes CI, or gets a review decision.
 *
 * The a2d2 hooks service (`hooks.a2d2.dev`, repository a2d2-dev/a2d2-services)
 * reads PR state as the a2d2-bot GitHub App and pushes changes over an outbound
 * WebSocket, so this plugin needs no public address and never polls GitHub. It
 * keeps the list of watches and what each session was last told
 * (`~/.dsh/a2d2/github-watches.json`), compares every state it receives with
 * that, and injects a message into the session on a difference.
 *
 * This is its own mount row because cordis loads a plugin only once every
 * service it declares exists, and this row needs live sessions and the session
 * controller.
 *
 * @module @deepseek-ai/dsh-a2d2/src/github-watch
 */

import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm/message'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { repoOfCwd } from './github-remote.ts'
import { DEFAULT_RELAY_URL } from './github-watch/relay.ts'
import { WatchStore } from './github-watch/store.ts'
import { Watcher } from './github-watch/watcher.ts'
import type { Inject, WatchResult } from './github-watch/watcher.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A pull request this session watches changed state. */
    'a2d2-github-watch': { kind: 'a2d2-github-watch'; repo: string; pr: number } & ContextFormed
  }
}

/** Cordis plugin name of the GitHub watch half. */
export const name = 'a2d2-github-watch'

/** Services needed to register the tool and wake sessions. */
export const inject = ['tools', 'agents', 'sessions', 'sessionController']

/** Name of the tool that starts watching a pull request. */
export const GITHUB_WATCH_TOOL = 'github_watch'

/** Plugin configuration for the GitHub watch mount row. */
export interface Config {
  /** Base URL of the a2d2 hooks service; defaults to https://hooks.a2d2.dev. */
  readonly relayUrl?: string
  /** Directory holding the watch list; defaults to ~/.dsh/a2d2. */
  readonly homeDir?: string
}

interface AgentsService {
  list(): readonly Agent[]
}

interface SessionController {
  resolveAgent(sessionId: SessionId): Promise<{ readonly agent: Agent } | { readonly error: { readonly code?: string; readonly message?: string } }>
}

interface SessionsService {
  flush(session: Agent['session']): Promise<boolean>
}

export { parseGitHubRemote, repoOfCwd } from './github-remote.ts'

const run = promisify(execFile)

/** The user's GitHub token, as `gh` holds it; GH_TOKEN / GITHUB_TOKEN as fallbacks. */
async function githubToken(): Promise<string> {
  try {
    const { stdout } = await run('gh', ['auth', 'token'], { timeout: 10_000 })
    if (stdout.trim() !== '') return stdout.trim()
  } catch {
    // fall through to the environment
  }
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  if (token) return token
  throw new Error('no GitHub token: run `gh auth login` or set GH_TOKEN')
}

const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/

function resultText(repo: string, pr: number, result: WatchResult): string {
  switch (result.status) {
    case 'watching':
      return `Watching ${repo}#${pr} (now ${result.state.state}, CI ${result.state.checks ?? 'none'}, review ${result.state.review ?? 'none'}). `
        + 'This session will receive a message when its state changes; there is no need to poll or wait in a loop.'
    case 'ended':
      return `${repo}#${pr} is already ${result.state.state}; nothing to watch.`
    case 'pending':
      return `Watch on ${repo}#${pr} registered, but ${result.message}.`
    case 'not_installed':
      return `Cannot watch ${repo}: ${result.message}. Ask the user to install the a2d2-bot GitHub App: ${result.installUrl}`
    case 'denied':
      return `Cannot watch ${repo}: ${result.message}.`
  }
}

/**
 * Register the `github_watch` tool and resume stored watches.
 * @param ctx - context carrying tools, live agents, sessions, and the session controller.
 * @param config - optional service URL and storage directory.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const agents = ctx.get('agents') as unknown as AgentsService
  const sessions = ctx.get('sessions') as unknown as SessionsService
  const controller = ctx.get('sessionController') as unknown as SessionController
  const log = (message: string) => (ctx as unknown as { logger?: { warn(m: string): void } }).logger?.warn(message)

  const injectMessage: Inject = async (sessionId, message, watch) => {
    if (watch?.task) {
      const runtime = ctx.get('a2d2TaskRuntime')?.runner
      const id = `github:${watch.repo.toLowerCase()}:${watch.pr}:${watch.session}:${watch.since}:${(watch.revision ?? 0) + 1}`
      if (await runtime?.enqueue(watch.task, id, message.text)) return 'delivered'
      const task = await ctx.get('a2d2')?.readTask(watch.task.projectRoot, watch.task.task)
      if (task?.issue) sessionId = task.issue.mainSession
    }
    let agent = agents.list().find(candidate => candidate.id === sessionId)
    if (agent === undefined) {
      const resolved = await controller.resolveAgent(sessionId as SessionId)
      if ('error' in resolved) {
        if (resolved.error.code === 'session/not-found') return 'gone'
        throw new Error(resolved.error.message ?? resolved.error.code ?? 'session unavailable')
      }
      agent = resolved.agent
    }
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: message.text }],
      source: { kind: 'a2d2-github-watch', repo: message.repo, pr: message.pr, form: 'notice', summary: boundContextSummary(message.summary) },
    }))
    await sessions.flush(agent.session)
    return 'delivered'
  }

  const watcher = new Watcher({
    store: new WatchStore(config.homeDir ?? join(homedir(), '.dsh', 'a2d2')),
    relay: { baseUrl: config.relayUrl ?? DEFAULT_RELAY_URL, token: githubToken },
    inject: injectMessage,
    log,
  })

  ctx.effect(() => {
    void watcher.start().catch(error => log(`github watch: resuming stored watches failed: ${String(error)}`))
    return () => watcher.stop()
  }, 'a2d2 github watcher')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: GITHUB_WATCH_TOOL,
    description: 'Watch a GitHub pull request and get a message in this session when it merges, closes, finishes CI, '
      + 'or gets a review decision — instead of polling or waiting in a loop. Returns the current state. '
      + 'The watch ends by itself once the PR is merged or closed. Needs the a2d2-bot GitHub App on the repository.',
    parameters: {
      pr: { type: 'integer', required: true, description: 'Pull request number.' },
      repo: { type: 'string', description: 'Repository as owner/name; defaults to the session working directory\'s GitHub origin.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repo: { type: 'string', required: true },
          pr: { type: 'integer', required: true },
          status: { type: 'string', required: true },
          state: { type: 'string' },
          checks: { type: 'string' },
          review: { type: 'string' },
          install_url: { type: 'string' },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error(`${GITHUB_WATCH_TOOL} requires a calling agent session`)
      const repo = args.repo ?? await repoOfCwd(agent.session.header.cwd ?? '')
      if (repo === undefined || !REPO_PATTERN.test(repo)) {
        throw new Error('repo must be "owner/name"; the working directory has no github.com origin to default to')
      }
      if (!Number.isSafeInteger(args.pr) || args.pr <= 0) throw new Error('pr must be a positive integer')
      const cwd = agent.session.header.cwd ?? ''
      const a2d2 = ctx.get('a2d2')
      const task = a2d2 ? await a2d2.taskOfMainSession(cwd, agent.id) : undefined
      const address = task && a2d2 ? { projectRoot: await a2d2.projectRoot(cwd), task: task.id } : undefined
      const result = await watcher.watch(repo, args.pr, agent.id, address)
      const state = 'state' in result ? result.state : undefined
      return {
        repo,
        pr: args.pr,
        status: result.status,
        ...(state === undefined ? {} : { state: state.state, ...(state.checks ? { checks: state.checks } : {}), ...(state.review ? { review: state.review } : {}) }),
        ...(result.status === 'not_installed' ? { install_url: result.installUrl } : {}),
        message: resultText(repo, args.pr, result),
      }
    },
    presentCall: args => ({ card: 'generic', title: `Watch ${args.repo ?? 'PR'} #${args.pr}`, kind: 'other', rawInput: args }),
  })), 'a2d2 github_watch tool registration')
}
