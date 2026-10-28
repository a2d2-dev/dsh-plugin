---
title: '#281 交接授权来源与继承'
type: bugfix
created: '2026-10-28'
status: in-progress
baseline_commit: 3cd4ad6
context: []
---

## Intent

**Problem:** #3335 的前任 Agent 在普通 GUI 新会话提示词中新增只读及禁止重新禁用插件的限制；后任把该 Agent 生成内容误认为 LF 的限制，重复要求授权。原始工具拒绝只涉及向已完成 Task 写材料，不涉及业务插件启停。

**Approach:** 明确交接材料的 Agent 作者与授权依据，保留既有业务操作、真实用户限制及恢复义务；使用带来源的正式交接消息，维护阶段限制只在该阶段生效。补原案例语义回归和真实模型验证。

## Boundaries & Constraints

- 保留 Issue #281 四项验收，不修改历史会话，不接管 #3335，不实际操作其业务插件。
- 保留真实用户不卸载、指定环境、不修改排除竞态范围的边界。
- 用户明确暂停/停止/收紧授权继续有效；已完成 Task 的终态保持有效，不能绕过工具拒绝或伪造新执行身份。
- 普通 GUI 输入无法独立证明实际作者，原案例通过上游工具调用辨认。不能声称修复正式 /handoff 就等于复现当日 GUI 路径。
- 不引入内容关键词过滤、自动放宽权限或授权推断引擎。

## I/O & Edge-Case Matrix

| 场景 | 输入 | 期望 |
| --- | --- | --- |
| 原案例 | 已授权禁用/观察/恢复；只读是历史工作现状；不卸载 | 传递已有授权及恢复义务，不生成新的禁止启停或重新索权 |
| 真实收紧 | 用户后来明确只允许只读 | 保留消息依据和范围，停止被限制的业务动作 |
| 维护接收 | 仅接收材料后停止 | 回执后停止；正式业务恢复后按原授权推进 |
| Task 终态 | task-completed 工具拒绝 | 保留终态事实，不推导为 LF 禁止业务测试 |
| 来源 | 插件生成 prepare/take | 标注插件/源会话来源，正文说明 Agent 编写，不冒充 LF 新指令 |

## Code Map

- `src/handoff-instruction.ts`：生成请求。
- `src/handoff-prompt.ts`：后继首条提示词。
- `src/command.ts`、`src/message-source.ts`：正式交接消息来源。
- `src/work-execution/continuation.ts`：受管接续材料及维护接收提示词。
- `ceo/AGENTS.md`：创建/接收交接的执行约定。
- `tests/handoff-*.spec.ts`、`tests/work-continuation.spec.ts`：实际入口回归。

## Tasks & Acceptance

- [x] 记录原始传播链，分别标注真实用户、工具约束和 Agent 推断。
- [x] 对实际生成/接收入口补回归，先见失败再修复。
- [x] 修复生成契约和消息来源，保留真实限制与恢复义务。
- [ ] 开发实例用真实模型验证原案例和真实只读限制对照，完成相关自动检查。
- [ ] 提交、推送、合并，回读验收与 Issue/Project 状态；Issue 最终关闭由 LF 完成。

**Acceptance Criteria:**

1. Given 原始会话日志，when 核实生成、发送、接收和误归因，then 限制来源可复核并明确区分角色。
2. Given 已授权目标插件禁用、观察及恢复，when 交接后正式继续业务，then 不新增无依据限制，不重复索要已有授权。
3. Given 用户真实不卸载等限制，when 生成和接收交接，then 准确保留遵守；真实后续只读指令仍有效。
4. Given 本案例材料和维护接收阶段，when 回归验证，then 后继能推进必要测试且保留测试后恢复要求；维护回执停止不误扩展成永久只读。

## Verification

- `pnpm exec vitest run tests/handoff-instruction.spec.ts tests/handoff-command.spec.ts tests/handoff-service.spec.ts tests/work-continuation.spec.ts`
- `pnpm typecheck`，构建与实际开发 profile 验证。
- 原始历史回放与真实模型语义结果分别记录，不能用固定断言或模板测试冒充模型行为证明。

## Spec Change Log

2026-10-28：从原始日志确认当日为普通 GUI 交接，不把 /handoff 固定模板归为原事件来源；修复覆盖今后正式入口及交接约定。
