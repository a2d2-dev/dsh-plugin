# v4 Task 完成架构

## 背景

`work_report` 已校验当前规格、逐项证据、阻塞、拆解和独立子 Task。此前成功只保存进度与 wait，没有完成操作，也未阻止普通 Task 恢复推进。

## 目标

- 同一事务提交验收、稳定完成操作、收口意图和父结果。
- 普通与 continuous Task 完成后均拒绝新的推进、改规格及 resume；历史可读。
- 外部同步独立恢复，绝不重建 Task 或启动模型。

### 非目标

旧 complete_task、来源目录、PR 语义、生产部署。

## 架构

### 概要设计

WorkApplication 通过共享 [Work DAO](work-dao.md) 的事务写入 `work-v3.json`。已有验收检查成立后，`commitCompletion` 在同一快照内保存 Task.completion、父 Task.childCompletions 和父执行的稳定 result inbox 事件。事务提交前没有通知或远端副作用。

### 架构设计

CompletionOperation 保存 operationId、commandId、规格版本、executionId、owner、epoch 和时间。完成后 Task 写命令与自动推进 guard 均检查完成事实，旧版当前规格 done 也保持终态。原生人工对话继续可用：已经获准的本轮仍可处理工具结果并给出最终回复，后续人工消息进入原会话并得到回应；各个 Task 写操作独立校验权限和终态。相同 command 重放返回原回执，新的完成报告不会重建操作。父结果事件使用 completion:<operationId> 去重；父尚无执行时结果保存在领域 Task，开始时才入 inbox；事件投递、消费与父自己的验收分别成立。

### 组件模块

| 组件 | 职责 | 状态归属 |
| --- | --- | --- |
| work-progress | 保留既有验收检查并提交完成 | Task.progress |
| work-completion | 稳定操作、父结果、终态判断 | Task.completion / childCompletions |
| WorkApplication / WorkDao | 业务授权与执行栅栏 / 共享快照、锁与原子持久化 | work-v3.json + immutable archive |

### 数据流程

协调会话 → sessionReport → owner/epoch 校验 → 既有验收 → 同事务完成及父 inbox → 原子写入 → 宿主按原有投递回执处理。

## 场景

### 接入与本地验收

在本工作树运行：

```sh
pnpm exec vitest run tests/work-progress.spec.ts
```

公共 work_report 接受当前规格证据，task.detail 返回 completion。新 WorkApplication 实例读取同一 operationId；sessionControl resume 返回 task-completed，stage 保持 done。父自身仍须通过全部标准与必要子工作校验。

### 中断与恢复

提交前中断无完成事实或通知；提交后重放读取原命令回执。父结果随完成一起保存，不存在通知成功但子完成未落盘的窗口。closeout 初始 pending，必须由正式宿主结算能力证明相关委派和 job 已收齐后才能标记 settled；idle 不能替代结算证明。

## 外部关闭与收口恢复

`work_report.report.closeExternal: true` 仅在 done 且已存在唯一 accepted canonical binding 时保存关闭意图。默认纯本地完成，远端 Open 不改变本地验收。关闭目标从 accepted binding 的 nodeId、repository、number、assignees、updatedAt 固定下来；命令不接受外部 URL 或凭据。宿主 GitHubSource 读取自己的凭据，使用固定 GraphQL closeIssue mutation，clientMutationId 为稳定 operationId。它不承诺 GitHub 提供 compare-and-swap 或按 clientMutationId 去重；预观察与远端 mutation 之间仍有平台并发窗口，显式补同步再次观察冲突。

每个外部操作有文件 lease，跨应用实例串行；网络不持有 work-v3.json writer lock。调用 mutation **之前**先持久化 unknown。重启或重试先 detail：已 Closed 则记 closed；Open 且负责人、版本仍匹配才允许再次 close；已确认 Closed 后看到 Open 标记 remote-reopened；负责人变化标记 remote-assignees-changed。unknown 重写设有持久退避（30 秒至 5 分钟），其间仍可观察已关闭回执；conflict/error 不自动重写，使用新命令身份明确补同步；保存已处理 retry command 集合，包含跨新重试之后的旧命令重放，均不重复 write。远端观察、unknown、error、closed 与本地完成及 closeout 独立保存。没有外部关闭意图时绝不关闭 Issue。

`WorkApplication.reconcileCompletions()` 由既有 reconcileControls 生命周期调用，恢复 pending/unknown 外部操作和待收口操作；它不调用 ensure、deliver 或 wake。写入口 `task.completion-sync` 复用现有 operator 或真实当前 Session/agent 授权，并校验 executionId/owner/epoch。旧 task.reconcile 在已完成 Task 上路由到完成恢复，不再创建或驱动模型。

收口复用 #138 的正式 host 接缝：`observation(execution).settlement === 'settled'` 后进入 `maintain(execution, body)`，维护边界内重新读取 owner/epoch 与 settlement，再原子提交 closeout.settled。maintain 本身是相关执行者安全结算且日志 flush 的权威屏障；body 不嵌套调用 settle（后者会再次申请维护锁）。旧 settle 仅用于非维护中的 wait/pause 控制。缺 observation/maintain、pending、unknown 均保留具名 pending。宿主收口异常最多自动尝试三次，保留退避与 error，显式补收口才恢复；continuous 原有 recoveryBlocked 同步保留。完成的 continuous dispatch slot 也须等待此 settled，不能仅因 idle 释放。构造时 connectObservation 注册读取已持久关联会话的受信 scope，校验实际 execution/ref/owner/epoch/current Session；本分支声明与 B 结构兼容的最小 observation 输入；#138 合入真实 host 后才具备端到端收口能力，不能把当前旧 host 当成该证明。

### 补同步命令

通过既有受信 work transport 发送（字段取自最新 task.detail）：

```ts
await app.execute({
  type: 'task.completion-sync', commandId: 'a-new-retry-id', ref,
  executionId: execution.id, owner: execution.owner, epoch: execution.epoch,
}, trustedActor)
```

只观察/恢复既有 operation；completion.operationId、Task、Execution 和 Session 均保持原身份。外部错误不会退回 in-progress。已完成 Task 的新报告、改规格、resume、自动输入推进、接续及重新 start 均拒绝。人工对话可继续使用普通宿主工具，不能借人工输入隐式重开 Task、重复父通知或远端关闭。

### 完成后交代、追问与重启

**前置条件**：当前协调会话通过全部验收，`work_report(stage=done)` 已返回成功。

**操作**：让本轮模型给出最终交代；在原会话发送人工追问。重启后打开同一会话再追问，不执行 Task resume。回归入口：

```sh
pnpm exec vitest run tests/work-completion-native.spec.ts
```

**状态呈现**：本轮最终 `assistant/message` 出现在成功的 `tool/result` 之后；人工追问以原消息 ID 和正文各保存一次，并有后续实际 `assistant/message`。读取 JSONL 历史能回读两者，重建 DSH Context 本身没有模型请求；人工追问触发新请求，其后 reconciliation 不增加请求。

**数据走向**：人工消息 → 原生 DSH loop → 模型与普通宿主工具 → JSONL `user/message` / `assistant/message`。Task 完成事实继续由 Work DAO 保存，人工对话不改 operationId、executionId、owner、epoch 或当前 Session。

**完成判据**：普通宿主工具仍可使用，明确的 Task resume 返回 `task-completed`。真实 job_output 组合回归同时检查人工追问后的父完成记录仍为一条、外部关闭调用仍为一次，队列下一项保持独立等待；验证入口为 `scripts/verify-v4-completion-host.mjs`，需提供匹配宿主制品目录。

## UI 接线

当前 `src/client/work-panel.tsx` 已将组件接入详情概览，并通过 controller 的 `syncCompletion` 使用既有受信 transport；完成状态、远端状态和补同步独立呈现。以下是该接线的最小接口示例：

```tsx
<CompletionStatus
  task={detail.task!}
  execution={detail.execution}
  remoteState={detail.bindings?.[0]?.lastObserved.state}
  busy={busy}
  error={error}
  onSync={async command => {
    // 使用原有受信 work command transport；完成后重读 task.detail。
    await executeExistingWorkCommand(command)
    await refreshExistingTaskDetail()
  }}
/>
```

`executeExistingWorkCommand`/`refreshExistingTaskDetail` 是接线示意占位名称，非新 API。组件自身不创建模型、不拼 URL、不读取凭据。`completionSyncCommand` 只产生 task.completion-sync，携带当前 owner/epoch。宿主面板负责展示命令失败、busy 与刷新；同一次网络重试应复用已生成命令的 commandId。状态文本分别为本地已验收、远端 Open/Closed、关闭待同步/失败/结果未知/冲突/已关闭，以及执行收口待处理/已安全收口。

## 初期分支验证记录（历史）

以下记录保留早期中间票的验证范围和组合过程；其中待接线、待宿主集成的表述反映当时状态。当前接线见上文，已指定的原生完成及追问回归可按场景命令重跑。

- 首条公共 progress 完成测试已先红（无 completion）再绿，7 个 progress 合同通过。
- 本地公共命令父子完成、重放父结果去重、原生终态 guard、host unknown→settled、外部 lost receipt/reopen/assignee conflict 合同通过。
- 确定性 GitHub fetch 合同证明仅固定 node mutation、宿主凭据和 unknown 回执分类；没有发送真实 GitHub Issue mutation。
- 独立组件的 6 条静态渲染／命令合同及宿主与客户端 typecheck 通过。
- 此中间票不改面板接线、不启动服务、不重启 18781/18782。真实既有实例桌面/窄屏 agent-browser 截图与正式 host job 结算的浏览器验证交 #141；本分支未验证，不以静态渲染冒充浏览器验收。

组合验证：D 修复提交 2d08735 与 B 固定阶段提交 e6ca554 在本锁定工作树临时无提交合并后，真实 work-continuous-integration 两项均通过（完成放槽 3687ms、接续 2603ms；未调整 timeout）。随后 merge --abort 保持 D 分支独立。此前真实超时暴露 maintain→settle 嵌套维护风险，已以权威 maintain 屏障修复；独立基线旧 host 缺 observation 时仍保守 pending。确定性 continuous 合同使用显式宿主结算回执，含 missing/unknown 即使 idle 也不放槽的负向合同。B 后续补相关执行者 flush 与最终 #141 仍需组合验证。
