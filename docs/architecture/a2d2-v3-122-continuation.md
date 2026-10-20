# #122 第二阶段：模型控制与执行连续性

## 背景

本分支从固定 `b14ed4175a7ca9e807f0ba1f483803d96ba5acbe` 开始，最终 PR/review 集成 base 为 `1f562b107ad9adc046b1f0bb01929185b5c7d234`，目标 `spec/dsh-control-panel-v3`。第一阶段的 WorkApplication 已提供真实 HTTP 工作命令，但没有注册到 ToolRuntime 的生产模型工具；Session actor 的 task.control 同步进入 ensure/settle，不能供正在运行的模型工具安全自 wait/pause。

当前文档记录 B1。B2 的 TaskRef 五步手动接续与 B3 的退休围栏/历史投影仍待实现；#122 整票 AC 没有缩减，也没有据 B1 声称完成。

## 目标

- 模型通过真实 ToolRunContext.agent/session 控制自己的当前 Task，调用者不能提供 actor、owner 或任意 TaskRef。
- progress/status 只读写本地事实，不产生模型请求；wait/pause 先持久 accepted，再在真实 loop idle/维护边界应用。
- accepted 后进程/Context 丢失可以恢复同一控制意图；waiting/paused 不空推，主动暂停必须显式 resume。
- 本地浏览不依赖 tools、Agent 或模型服务，不增加普通用户必经配置。

### 非目标及未完成 AC

B1 不实现手动接续、完整 prepare/write/create/take/deliver、退休 Session 的持久失权、历史只读投影或客户端 UI。下文“B2 前置整合检查点”记录后续选择性整合；独立 fixture 生命周期补丁 `1608832` 不改变原 5 秒预算或既有断言。

## 架构

### 概要设计

work-plugin 自动通过可选 `tools` 注入注册 `work_control`，通过独立可选 `agents` 注入安装控制恢复消费者。两者独立卸载；查询和领域记录入口不要求任何活 Agent。工具体只完成本地身份解析、锁内校验和持久接受，不等待自身 runMaintenance。

真实 DSH 0.2.0-rc.2 loop 的 runMaintenance 在 active work 时拒绝。恢复消费者使用公开 agent/status 的 idle 通知和 250ms 的宿主恢复扫描；扫描只推进已经持久化、control.status=accepted 的意图，且跳过 running Agent。ensure/settle 在 Agent.whenIdle 后通过公开 runMaintenance 取得真实维护边界。查询不会启动消费者或触发模型。

### 组件模块

| 组件 | 职责 | 权威/依赖 |
| --- | --- | --- |
| work_control | 接收 action/text/可选 expected_epoch；从真实 exec.agent 取得 Session 和 callId | ToolRuntime；无自建 actor/owner 参数 |
| WorkApplication.sessionControl | 按真实 runtime+Session 解析当前 TaskRef、ProjectAgent、ExecutionId、owner/epoch；status 返回当前事实，写入复用 execute | work-v3.json |
| WorkApplication.execute | 在同一个文件锁中再次核验 Session/Agent 与 owner/epoch；保存命令回执；Session control 在 accepted 后返回 | 既有领域事务与 ledger |
| WorkApplication.reconcileControls | 恢复持久 accepted 控制，不创建新控制意图；使用原 execution lease | WorkExecutionHost |
| installWorkControlRecovery | 启动/idle/定时恢复，卸载清理 timer、listener，并 join 在途扫描 | 可选 agents 注入 |
| DshWorkExecutionHost | 真实 whenIdle/runMaintenance、冷恢复、原 ID 投递/消费 | 既有 DSH 执行适配 |

### 数据与信任边界

1. ToolRuntime 提供真实 exec.agent 与 callId，工具检查 Agent/Session identity 一致。runtimeId 来自服务端持久身份。
2. sessionControl 查询当前协调关系，服务器取得 TaskRef、ExecutionId、负责 Agent、owner 与 epoch。工具没有 actor、owner 或 TaskRef 参数；额外模型字段不会授予权力。
3. 可选 expected_epoch 仅作为写入前置条件，不能授予协调权。未提供时使用服务器读到的 epoch；提供时由原 execute 的同一写锁验证，过期返回 stale-execution-authority。actor 的 Session 与 ProjectAgent 仍来自服务器。
4. 稳定 commandId 为 runtimeId/SessionId/callId 元组的 SHA-256，长度有界，避免拼接歧义。execute 在回读旧回执前先校验真实当前 actor/epoch。
5. 模型控制完成持久写入后返回 status=completed、execution.control.status=accepted；completed 在这里表示接受事实已保存。安全维护后 control.status=applied，state 变 waiting/paused/ready。progress 不进入维护。
6. 接受期间重启，恢复消费者重新读取同一记录与 commandId，沿既有 ensure/settle 恢复。没有浏览器定时器、空 prompt、替身维护边界或模型续跑循环。

## 场景

### 已安装 work-plugin 的宿主接入模型工具

前置：现有 work-plugin 已挂载，ToolRuntime 可用；不需要新增配置行。没有 ToolRuntime/Agent 的本地项目浏览继续通过原 HTTP 入口工作。

```ts
// 由真实模型工具调用，Session/Task/owner 从服务器解析。
await work_control({ action: 'status' })
await work_control({ action: 'progress', text: '已确认本地验收标准与执行证据' })
```

status 返回当前 execution 和非激活式 executionRuntime；progress 更新 execution.progress，模型请求计数不增加。真实外 Session 或缺少 calling Agent 的调用拒绝。生产 work-plugin 可选注册测试真实挂载 SystemPrompt+ToolRuntime，证明工具随服务到达注册、无 Agent 时拒绝，并保留无模型项目查询。

### 模型在当前 turn 自 wait / pause

```ts
await work_control({ action: 'wait', text: '需要确认下一项验收决定' })
// 主动暂停同样持久接受：
await work_control({ action: 'pause', text: '等待明确恢复授权' })
```

工具先返回包含 accepted 的真实 tool/result；下一个普通 pre-step 受既有权威 gate 阻止，turn/end.reason.kind=blocked，表示受控阻止推进。消费者在 idle 后通过真实 runMaintenance 保存 applied。新原生输入以完整 UserMessage 和原 ID 保留在 Task inbox，不触发新模型请求。

### 显式恢复并消费保留输入

```ts
// UI 使用现有受信任 operator 命令；模型工具也有 resume 动作。
await app.execute({ type: 'task.control', commandId, ref,
  executionId, owner, epoch, action: 'resume', text: '采用已确认决定继续' }, operator)
await app.query({ type: 'task.execution', ref }, operator)
```

并发 lease 下命令可能先返回已接受快照；应观察 control.status=applied、事件 delivery 及真实 turn，不能把当时 Agent.whenIdle 当作异步输入已消费。恢复只投递既有完整消息，不以空 prompt 唤醒。验证断言第二次真实模型请求包含原 UserMessage ID；消费仍不代表业务验收。

### accepted 后 Context 丢失

真实 ToolRuntime+AgentLoop 已保存 pause accepted，在恢复消费者运行前销毁 Context；重新挂载持久化和执行服务，再安装恢复消费者。最终查询仍为同 ExecutionId、SessionRef、owner/epoch 与原 control.commandId，state=paused、control.status=applied。真实持久 Session 数保持 1；重启后的模型请求为 0。该测试关闭的是可选消费者窗口，领域记录、loop 和持久化没有 fake。

## 验证

已批准测试接缝沿用父规格的 WorkApplication.execute/query、真实 ToolRuntime+AgentLoop、生产 work-plugin 注册。模型输出为规格允许的确定性外部适配，领域文件锁、日志、维护和宿主生命周期均使用真实实现。

红测先证明：缺少生产工具模块；实际模型 wait 持久 accepted 后没有消费者应用；真实 ToolRuntime 的过期 expected_epoch 被忽略并写入进展。最终实现分别接入生产工具、独立恢复消费者与锁内 epoch 前置条件。测试开发期间两处错误的原生事件 envelope 和 UserMessage 调用形式已依据真实公开 API 修正；没有为追绿删断言、增加测试超时或改 fixture 生命周期。

定向验证：`pnpm exec vitest run tests/work-execution.spec.ts tests/work-host.spec.ts -t 'real model self-|real tool identity|real tool accepted|registers the production model tool'` 退出 0，5 通过、17 未选。

完整执行 `pnpm exec vitest run tests/work.spec.ts tests/work-execution.spec.ts tests/work-host.spec.ts tests/work-process.spec.ts tests/task-runtime.spec.ts` 退出 1：work 四文件 35/35 通过、0 skip；legacy runtime 32 通过、1 失败。唯一失败是原 `tests/task-runtime.spec.ts:470` 的 slow-successor-creation 用例，在原 5000ms 预算超时。随后仅独立运行该原用例，仍退出 1（1 失败、32 未选），没有扩大预算、改原断言或 fixture。它仍是本轮未解决的回归验证缺口，不据源码差异宣称首因已确定。B1 只改新 work 模块；旧 runner/host/root-session 测试路径未改。

最终 `pnpm typecheck && git diff --check` 退出 0；backend/client 类型与补丁格式分别通过。独立 `pnpm verify:pack-exports` 退出 0：执行 src-only backend/client declaration build 和 tsdown，安装真实 tgz 后验证 13 个 Node 导出。没有改 package/依赖/打包入口。

## B1 后续交接

下一片从本分支 B1 提交继续，不能重置到第一阶段或其他 checkout。保留本次 19 项 execution 用例和真实 fs/bash sandbox 装配。

1. 选择性整合已接受的 `1608832` fixture scope 生命周期补丁（不能用其旧 base 整文件覆盖，不能恢复旧 Shell override），保留原 5 秒负向与全部旧断言；当前 legacy slow-successor 超时单列验证缺口。
2. 整合独立 host-admission 分支的最小服务获取修复，复核真实 plugin Context 的实际 managed execution；不复制其环境诊断、不接管 18780/18781。
3. B2 从旧 `src/task-runtime/runner.ts` 抽取或共享 prepare/write/create/take/deliver 的深层恢复机制；固定 operation/source/successor/profile/完整 UserMessage ID，新权威采用 TaskRef/ExecutionId/owner/epoch。源材料须含本地目标、规格、具体决定、证据、未完项和下一步。take 在真实维护边界原子更新 current/retired/epoch 与双向占用，完整覆盖副作用已发生但回执丢失窗口。
4. B3 以 base-owned 持久 guard 覆盖退休冷 Session、native inbox/维护排队输入与迟到工具锁内提交；独立消费者卸载后仍 fail-closed。历史查询只走真实 SessionQuery.observeSession/inspect，有 TaskRef/SessionRef 关系与 runtime/workspace 校验及分页/裁剪。公开 DTO 给 UI 分支，普通 follow/openSession 不算只读历史。
5. 每片串行验证后立即 commit/push 并报告 SHA；本阶段没有创建 PR、合并、部署或修改宿主。最后仍须分别 typecheck 与 src-only build/pack，并完整报告整票未满足 AC。

## B2 前置整合检查点：生产 Context

本片从 `9f52e9754e4959477b01b1bbf2b29d4b7609c217` 开始，选择性整合独立宿主分支 `fc6b376` → `9b448075` 的产品修复和生产插件回归。保留 B1 ensure/settle 的 `whenIdle`、真实模型工具注册及全部 19 项 execution 行为。没有整文件覆盖旧基线。

生产 work-plugin Context 仅声明浏览服务依赖，直接访问 workspaceRegistry 等执行服务会抛 `without inject`，此前被包装为 `host-admission-failed`。DshWorkExecutionHost 现在通过公开动态 `ctx.get` 取得执行服务，并在预约前核对 Controller 的 create/inspect/modelCatalog/resolveAgent；共享 RuntimeHost.flush 同样动态取得 sessions。fixture 通过 `ctx.plugin(SessionController)` 装配真实静态依赖，保留真实 fs/bash sandbox、workspace 参数和局部模型选择。

核心场景仍通过公开 `task.start` / `task.execution`：缺 create 或 modelCatalog 时 HTTP400 `host-capability-unavailable`，不保存 execution、不创建 Session、不调用模型；能力恢复后 ready/actual 对应选定目录与权限，kickoff 一次，重试保持同 Execution/Session，宿主默认模型不变。本片未启动 Web server，也未接管 18780/18781。

本轮先运行原生产 Context 回归，退出1：1失败、3未选，实际 HTTP400 admission。修复后定向退出0：1通过、3未选。串行运行四个 work 文件退出0：36/36通过、0未选，包括原19 execution用例。首次 pnpm 启动前依赖自检报告 ignored native builds；Vitest 仍实际启动并给出上述红断言，随后使用本地 Node 入口，未修改依赖、lockfile 或脚本批准策略。

独立产品 lane 的真实 tgz HTTP + TaskRef 单调用预算证据归 `b93604a3702def9a54f9a36a198b39c4f216e68e`，其旧红证据保留在源提交；该 lane 不作为本片集成 artifact 的产品验证。最终产品 lane 须重新构建本分支真实 tgz，再执行 UI/start/current 导航。B2/B3 全部 AC 仍保留。
