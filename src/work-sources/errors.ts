import type { SourceFailure } from './types.ts'
export class SourceError extends Error implements SourceFailure {
  constructor(readonly code: string, message: string, readonly retryAt?: string) { super(message) }
}
