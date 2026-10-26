import { expect, it } from 'vitest'
import { validateScreening } from '../src/work-screening.ts'

const basis = { instruction: '只处理缺陷', candidates: [{ nodeId: 'I1', number: 1, title: 'Bug', body: 'Reproducible failure', repository: { owner: 'acme', repository: 'repo' }, labels: [], assignees: [] }] }
it.each([
  { decisions: [] },
  { decisions: [{ nodeId: 'foreign', matches: true, reason: '范围外' }] },
  { decisions: [{ nodeId: 'I1', matches: true, reason: '匹配' }, { nodeId: 'I1', matches: false, reason: '重复' }] },
  { decisions: [{ nodeId: 'I1', matches: 'true', reason: '类型错误' }] },
  { decisions: [{ nodeId: 'I1', matches: true, reason: '' }] },
])('rejects incomplete, foreign, duplicate or malformed screening decisions: %j', output => {
  expect(() => validateScreening(output, basis)).toThrow()
})
it('accepts an explicit rejection with its reason', () => {
  expect(validateScreening({ decisions: [{ nodeId: 'I1', matches: false, reason: '缺少可复现步骤' }] }, basis).decisions[0]!.matches).toBe(false)
})
