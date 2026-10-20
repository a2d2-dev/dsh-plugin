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

## 真实宿主合同切片

公开端口 WorkExecutionHost 定义只读 check、固定身份 ensure、settle、deliver/observe；DshWorkHost 在生产构造中接入 DshWorkExecutionHost。start 在任何领域/Session写入前做能力、实际workspace、preset、模型解析和permission候选检查；短快照事务保存 accepted，独立 Execution 锁跨宿主副作用，creating/ready/failed各自落盘。failed 保留固定 execution/session/owner/epoch，重试只恢复这一身份。

锁定 0.2.0-rc.2 的真实局部模型接口是 dsh-agent 主导出 installModelSelection（lib/types/index.d.ts:15、model-selection.d.ts:31–49）。第一次直接追加 selector 的真实合同失败：实际模型变成 default，证明 Controller 外层监听器会覆盖新监听器。最终不追加第二套selector：通过公开 sessions.prepare、sessionPersistence.create/SessionHandle.append/close 为固定冷Session保存公开 model/selection 事件，然后 SessionController.create adopt；Controller恢复自己的selection投影和公开preset装配。没有调用 selectModel/saveSelection、私有controller字段或改写JSONL。宿主实际request与request/header为selected，全局真实agentDefaultModel.currentSelection仍为default。

TaskRef control/input/reconcile需 executionId/owner/epoch，进展保存为独立事实；wait/pause/resume先保存accepted意图，再经真实runMaintenance到安全边界记录applied。pre-step从权威快照核对owner/epoch和暂停等待状态，等待不空推。事件身份在接受时固定，RuntimeHost公开send/flush/readback复用；accepted/delivered/consumed与acceptance=unassessed区分。慢创建不持有领域快照锁，创建期间输入可先提交。

2026-10-19：`pnpm exec vitest run tests/work-execution.spec.ts` 6/6通过，0skip，退出0；包含真实loop/preset/JSONL/WorkspaceRegistry/AgentDefaultModel。传输注册和附件目录仅是装配边界，Controller/模型选择/持久化不是替身。回执丢失注入在真实Controller.create完成且Session flush后抛错，随后销毁Context重建；同commandId恢复同execution/session/owner/epoch，持久Session只有1项，未发起模型。并发两个Task抢同一真实Session仅一个成功，另一session-in-use。

额外覆盖真实header持久化与model/selection持久化后回执丢失：header-only红测恢复后实际路由错误为default，退出1；修复为仅对本执行保留的新建身份、空冷日志使用公开open(write)/append补齐同一selection，Controller adopt后真实请求selected。三窗口均冷重建、Session数=1且owner/epoch固定；未把单纯成功后杀进程冒称未知回执窗口。

`pnpm add -D @deepseek-ai/dsh-agent-default-model@0.2.0-rc.2 --ignore-scripts`退出0，只增加真实默认模型合同服务的直接devDependency；随后pnpm peers check退出1，指出base已有subagent-activation@0.2.1-rc.2等与0.2.0 peers不一致，未引入新的跨版本执行装配。调查候选0.2.1-rc.2的隔离安装退出0，但该版本仍无selectLocalModel且create语义改为blank reuse，不采用；新建调查目录经绝对路径核验后已移除。生产依赖版本保持原baseline。

## 验证

第一条行为红测：`pnpm exec vitest run tests/work-execution.spec.ts`，退出 1，因 task.start 返回 invalid-command 而非 accepted 执行。实现后执行相同测试及 tests/work.spec.ts：2 文件 9/9 通过，0 skip，退出 0。typecheck 与 git diff --check 均退出 0。

`pnpm install --frozen-lockfile` 实际完成 207 包安装，但因忽略 @deepseek-ai/dsh-subprocess-local/koffi/node-pty 构建脚本退出 1；未更改批准策略，不把此退出包装成安装完全成功。
