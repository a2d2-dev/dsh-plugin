# #122 第一阶段：TaskRef 执行协调后端

## 背景

固定 base 为 `1f562b107ad9adc046b1f0bb01929185b5c7d234`，分支 `feat/a2d2-v3-02-coordination`，PR base 为 `spec/dsh-control-panel-v3`。原 WorkApplication 只有 completed 领域回执和只读 WorkHost，没有执行资格或宿主副作用恢复记录；旧 issue-bound runner 保持原权威。

## 目标

公开 `WorkApplication.execute/query` 是已在规格确认的测试接缝。第一切片在同一个真实文件锁事务保存 Project Agent 指派、ExecutionId、TaskRef、owner/epoch、固定 SessionRef 与请求配置；`completed` 仅表示命令事实已保存，`execution.state=accepted` 明确不表示宿主运行。

### 非目标

本阶段不交付 UI、活动旧记录迁移、自动 token 策略、完成 outbox、来源队列。整票仍需要手动接续完整 prepare/write/create/take/deliver 与历史只读投影，后续不得裁剪这些 AC。

## 架构

### 概要设计

沿用 work-v3.json 独立 writer，在快照增加可向后读取的 executions 空缺省。Task 与 Session 的两个方向唯一性在同一个 withFileLock 下判断。失败不提交新事实；legacy.map 的工作保守拒绝启动，保持旧 writer/runner。

### 组件模块

| 组件 | 职责 | 状态归属 |
| --- | --- | --- |
| WorkApplication | 严格命令、授权、预约、查询与命令重放 | work-v3.json |
| WorkExecution | 稳定执行、Agent、owner/epoch、请求与实际环境、可恢复阶段 | executions |
| DshWorkHost | 当前只读资源端口；后续增加真实执行适配 | 真实公开 DSH 服务 |

### 数据流程

`task.start` → 校验领域、项目资源、Agent coordination 能力、旧记录边界 → 原子预留 Task 与 Session → 保存 accepted 历史和命令回执。相同 commandId 原内容重放相同回执；不同点击同配置汇合到同一执行，不因 expectedVersion 已变化而另建 owner。不同配置明确 execution-conflict。观察/评审会话不通过 start 隐式获得协调资格。

## 场景

### 开始与重载查询

前置：已保存 Project、Project Agent、Task，资源来自 WorkHost.resources 并已归属项目。

```ts
await app.execute({ type: 'task.start', commandId, ref, expectedVersion: 1,
  agentId, resource, agentPreset: 'workspace-agent',
  model: { provider: 'fixture', model: 'model' }, permissionPreset: 'read-only' }, operator)
await app.query({ type: 'task.execution', ref }, operator)
```

观察 accepted 与固定 execution/session 身份；尚未创建宿主或调用模型。数据由公开应用保存至同一快照；重建应用可读。

### 宿主能力基线与下一片

现有锁定包 `@deepseek-ai/dsh-api-session-controller@0.2.0-rc.2` 的公开 selectModel 在 `lib/types/commands.js:145–168` 安装会话模型后调用 agentDefaultModel.saveSelection，会修改全局默认。旧 task-runtime 测试装配用 Object.defineProperty 提供 selectLocalModel 替身，不可当作本票真实宿主证据。已查得候选 0.2.1-rc.2 要求全套 0.2.1-rc.2 peers 与 cordis ~4.0.5，禁止单包混装或修改现有 18780/18781。真实宿主合同 lane 将隔离装配一致基线；生产缺失会话本地接口须在副作用前显式拒绝。

## 验证

第一条行为红测：`pnpm exec vitest run tests/work-execution.spec.ts`，退出 1，因 task.start 返回 invalid-command 而非 accepted 执行。实现后执行相同测试及 tests/work.spec.ts：2 文件 9/9 通过，0 skip，退出 0。typecheck 与 git diff --check 均退出 0。

`pnpm install --frozen-lockfile` 实际完成 207 包安装，但因忽略 @deepseek-ai/dsh-subprocess-local/koffi/node-pty 构建脚本退出 1；未更改批准策略，不把此退出包装成安装完全成功。
