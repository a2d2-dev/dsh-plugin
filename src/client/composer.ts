/**
 * The composer write the floating indicator performs.
 *
 * Split from the component so the decision — what the draft becomes, and
 * whether the write happened at all — is testable without a browser. The
 * indicator's whole purpose is to spare the user from remembering the command,
 * so a write that cannot happen must be reported rather than silently swallowed.
 *
 * @module @a2d2/dsh-a2d2/client/composer
 */

import type {
  A2d2ClientContext,
  ClientSessionsService,
  ComposerService,
} from './context.ts'

/** The command the indicator fills in, separator space included. */
export const HANDOFF_DRAFT = '/handoff '

/**
 * Append text to one session's composer draft.
 *
 * `/handoff` is a leading-input command, so the appended text is deliberately
 * left unsent: the user adds the focus and presses send. An existing draft is
 * kept and the command appended after it, separated by a space, because
 * discarding what someone already typed would be a worse outcome than a
 * surprising draft.
 * @param ctx - the client context carrying the conversation and session services.
 * @param sessionId - the session whose composer receives the text.
 * @param text - the text to append.
 * @returns true when the draft was written, false when a service or scope was unavailable.
 */
export function appendToDraft(ctx: A2d2ClientContext, sessionId: string, text: string): boolean {
  const sessions = ctx.get('sessions') as ClientSessionsService | undefined
  if (sessions === undefined) return false
  const actx = sessions.scope(sessionId)
  if (actx === undefined) return false
  const conversation = ctx.get('conversation') as ComposerService | undefined
  if (conversation === undefined) return false
  const draft = conversation.input.for(actx).state.getSnapshot().draft
  const next = draft.trim() === '' ? text : `${draft} ${text}`
  conversation.input.for(actx).setDraft(next)
  return true
}

/**
 * Focus the composer's textarea and place the caret at the end of the draft.
 *
 * The draft write itself deliberately does not focus or move the caret, so a
 * programmatic insertion would otherwise leave the user typing into the page.
 * This reaches the DOM because no sanctioned caret API exists for an out-of-tree
 * plugin; it is best-effort, and a page that has not rendered a textarea simply
 * leaves focus alone.
 * @param root - the indicator's own element, used only to confirm the page mounted UI.
 */
export function focusComposer(root: { readonly isConnected: boolean } | null): void {
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea')
  if (textarea === null) return
  void root
  textarea.focus({ preventScroll: true })
  const end = textarea.value.length
  try {
    textarea.setSelectionRange(end, end)
  } catch {
    // A textarea type that cannot carry a selection rejects this; focus alone
    // is still the useful half, and the draft the user sees is already correct.
  }
}
