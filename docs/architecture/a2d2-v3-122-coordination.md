# #122 第一阶段：TaskRef 执行协调后端

## 背景

固定 base 为 `1f562b107ad9adc046b1f0bb01929185b5c7d234`，分支 `feat/a2d2-v3-02-coordination`，PR base 为 `spec/dsh-control-panel-v3`。原 WorkApplication 只有 completed 领域回执和只读资源端口，没有 ExecutionId、双向协调约束或宿主副作用恢复记录。旧 issue-bound writer/runner 保持原权威，本阶段没有修改它们。

**模型恢复规则修订（#250）：** 本文保留该阶段的实现与验证记录。“模型兼容”不再要求已有会话与启动模型快照相等。当前目标以 [ADR 0005](../adr/0005-execution-context-and-provider-capabilities.md)、[ADR 0009](../adr/0009-a2d2-settings-live-in-a-settings-namespace-with-own-page.md)和 [ADR 0011](../adr/0011-explicit-task-runtime-owns-execution-and-recovery.md)为准：同一会话可以切换模型，恢复采用宿主当前有效选择。历史相等检查不能作为继续限制用户切换模型的依据；运行时修复与回归仍由 #250 跟踪。

## 目标

以公开 `WorkApplication.execute/query` 为已在规格确认的行为接缝，完成一次本地 Task 的启动、真实宿主创建/兼容复用、固定 kickoff、TaskRef 控制与消息恢复。`completed` 表示应用命令事实已保存；只有真实宿主观察说明模型是否运行，不把 accepted/creating/ready 当作模型执行。

### 非目标与整票缺口

本阶段不交付客户端 UI、浏览器产品验收、活动旧记录迁移、自动 token 策略、完成 outbox 或来源队列。第 02 票的完整手动接续 prepare/write/create/take/deliver、固定后继、接任围栏及历史只读投影仍是必须完成的后续 AC，不由本阶段裁剪。不要据本阶段声称 #122 整票完成。

## 架构

### 概要设计

沿用独立 work-v3.json writer，在同一个真实文件锁事务中记录 Project Agent 指派、ExecutionId、TaskRef、owner/epoch、固定 SessionRef、资源、请求配置及 kickoff。Task 和 Session 的两个方向唯一性由同一快照事务判断。宿主副作用使用独立 Execution lease，领域快照锁不跨宿主创建、网络模型目录查询或维护等待。

### 组件模块

| 组件 | 职责 | 权威数据与依赖 |
| --- | --- | --- |
| WorkApplication | 严格命令/查询、可信 actor、版本与 owner/epoch、接受、重放、协调 | work-v3.json；atomic-write |
| WorkExecution | 固定执行、Project Agent、会话、请求策略/实际环境、阶段、控制与事件 | executions；空缺省兼容 #121 数据 |
| DshWorkHost | 真实资源、会话观察与生产执行端口装配 | workspaceRegistry、SessionPersistence |
| DshWorkExecutionHost | 能力/候选准入、冷 Session、Controller/preset、维护、真实投递与消费观察 | 公开 DSH 0.2.0-rc.2 服务 |
| RuntimeHost | 稳定 message ID 的 send/flush/readback、维护中的 inbox 唤醒 | 复用已有 task-runtime/host，未重写旧运行器 |

### 一致性与执行环境

`task.start` 先检查真实服务、sandbox-aware filesystem/shell、实际 workspace、preset、模型目录/解析与权限候选，再进入原子预约。新执行只允许继承的 Agent preset/权限默认，模型来自真实可路由目录且满足 Project Agent.modelCandidates；空候选表示继承宿主目录。浏览器提交的选择不是实际目录或提权授权。请求资源还须已属于当前 Project。已接受执行保存自己的策略快照，不因继承默认随后改变而静默重配。

相同 commandId/原内容重放同一个接受事实；不同点击同配置汇合到原 ExecutionId/owner/epoch/session，已有执行不因 Task.version 改变另起 owner。不同配置具名 execution-conflict。Execution lease 被另一消费者持有时返回已持久化的当前 accepted/creating 事实，不把长宿主调用变成第二个创建者，也不阻塞新的输入保存。仅精确识别公开 atomic-write 当前无 errno 的 lease-contention Error；其他 I/O/快照错误继续失败，不当作空库。

观察/评审关联不授协调资格。用户明确选择当前 Task 自己的 compatible related Session 时可复用，已有非空会话的目录/preset/模型/有效权限必须兼容且历史前缀不变。review 或其他 Task 的关联拒绝隐式升级。legacy.map 的 Task 保守拒绝启动；复用已有 Session 还要求真实旧 A²D² authority 可查询，并拒绝已绑定的旧 main Session，不移除旧 writer/runner 约束。

### 真实局部模型装配

锁定 `@deepseek-ai/dsh-api-session-controller@0.2.0-rc.2` 的 selectModel 在公开包 `lib/types/commands.js:145–168` 调用 agentDefaultModel.saveSelection。本实现不调用这个入口。公开 dsh-agent 主导出 installModelSelection 位于 `lib/types/index.d.ts:15`、`model-selection.d.ts:31–49`，Controller 自己使用它。

真实红测证明：Controller 已安装的外层 selector 会覆盖之后追加的 selector，实际请求变成 default。最终通过公开 sessions.prepare、sessionPersistence.create/SessionHandle.append/close 为固定冷 Session 保存公开 model/selection 事件，再经 SessionController.create adopt，由 Controller 恢复它自己的 selector 和完整 preset。没有私有 Controller 调用、替身 selectLocalModel 或直接改写 JSONL。仅当本执行保留的新建身份的冷日志为空时，使用公开 open(write)/append 修复 header-only 断点；已有非空配置不覆盖。

本适配声明 optional 精确 Controller peer 0.2.0-rc.2；本地工作只读入口不要求装载该服务。运行前拒绝已知不同包版本，创建后仍核对固定 Session ID。真实宿主可以从另一物理模块副本提供同样公开合同，不做 instanceof 身份判断；版本号也不能单独证明语义，实际目标 artifact 仍需组合合同与浏览器 lane 验证。0.2.1-rc.2 的调查明确显示 create 已改为 blank reuse，不能直接当作已支持的 fixed-ID 适配。

四个真实未知回执窗口为：header flush、model/selection append+flush、Controller.create+Session flush、kickoff 实际消费。均在实际跨边界副作用完成后注入异常，随后销毁 Context 并冷重建。恢复复用同 ExecutionId、SessionRef、owner/epoch、kickoff ID；真实持久 Session 数为 1，前后模型请求合计为 1。

### 控制与输入

WorkActor 只能由可信入口构造。HTTP 继续使用宿主 operator=true，浏览器不能传 actor。可信模型适配可以使用 operator=false、宿主 SessionRef 和 ProjectAgentId；仅当前 Agent/current Session 在匹配 ExecutionId/owner/epoch 下可写自己的控制事实。授权在回读 ledger 前及领域写事务内检查，复制 owner token 的外 Session 或 stale epoch 拒绝。

progress 只保存进展，不调用模型。wait/pause/resume 先保存 accepted 控制意图，再经真实 runMaintenance 到安全边界记录 applied；暂停不冒称在途副作用已被撤销。waiting/paused 保留 owner 与会话，新 Task input/result 先保存 accepted，显式 resume 才投递。事件 delivery=accepted/delivered/consumed 与 acceptance=unassessed 分开，消费不是业务验收。

真实 loop 在 pre-step reject 前已从 native inbox 移除 offered batch，单靠拒绝会丢掉未消费的 native 输入。现通过公开 agent/pre-step 把原完整消息及原 ID 同事务保存在 Task inbox 后拒绝，冷/暖宿主都装配同一权威 gate；resume 使用同一 RuntimeHost.send/flush/readback 投递原消息。没有用空 prompt 恢复，也不放开 owner 检查。tools/pre-execute 同样检查当前已接受的暂停/等待边界；领域命令另有提交锁内的 caller/owner/epoch 校验。

## 场景与客户端合同

### 取得真实选择并开始处理

前置：已保存 Project/Project Agent/Task，资源来自真实 WorkHost.resources 且已接入 Project。

```ts
const choices = await app.query({ type: 'task.execution-options', ref }, operator)
if (choices.status !== 'completed' || !choices.executionOptions) throw new Error('Execution choices unavailable')
// completed.executionOptions:
// { agentId, resources, agentPresets, models, permissionPresets, defaults }
// UI 从这些真实候选填充选择，不能猜 cwd/model/preset/permission。
const result = await app.execute({ type: 'task.start', commandId, ref, expectedVersion,
  agentId: choices.executionOptions.agentId, resource: selectedResource,
  agentPreset: selectedPreset, model: selectedModel,
  permissionPreset: selectedPermission }, operator)
```

这是单个用户意图。应用同事务保存 `kickoff:${executionId}` 和完整本地目标、规格、验收、Agent 指令，创建/恢复宿主后自动投递；UI 不应另外生成随机 task.input 来补启动。ready 表示宿主已装配，events 显示消息确认点；并发消费者可能先得到 accepted/creating，随后按 TaskRef 查询。

### 查询与当前会话入口

```ts
await app.query({ type: 'task.execution', ref }, operator)
await app.query({ type: 'task.detail', ref }, operator)
await app.query({ type: 'session.work', session }, operator)
```

前两个入口包含 execution 及非激活式 executionRuntime=running/idle/inactive；current Session 来自 execution.session，不能取最近打开的会话。session.work 返回 purpose=control 的真实当前关联与 ExecutionId/epoch，related/review 保留观察用途。查询不恢复 Agent、不产生 prompt。历史只读投影和接任后的旧会话围栏待后续阶段，不据普通宿主导航冒称历史只读。

### 进展、等待、暂停、恢复与输入

```ts
const fence = { ref, executionId, owner, epoch }
await app.execute({ type: 'task.control', commandId, ...fence,
  action: 'progress', text: '已完成的具体进展' }, actor)
// action 还包括 wait / pause / resume；text 保存理由或待确认问题。
await app.execute({ type: 'task.input', commandId: inputId, ...fence,
  kind: 'input', text: '用户补充信息' }, operator) // kind 也可为 result
await app.execute({ type: 'task.reconcile', commandId: recoveryId, ...fence }, operator)
```

控制版本使用 executionId/owner/epoch，规格编辑仍用 Task.expectedVersion。reconcile 恢复已接受的同一个操作/消息，不另建执行。通过 task.input 投递的自动工作在 waiting/paused 时只接受，显式 resume 后按原调度投递；原生人工对话始终可用，不要求恢复 Task。错误查看 execution.error，accepted 控制与 applied 控制分别查看 execution.control.status/history。旧版门禁保存在 Task inbox 的人工消息，在该会话下一次人工输入时按原 ID 恢复；实际 user/message 日志用于去重，不伪造消费，不主动重放 Goal 或恢复业务任务。

## 验证与证据边界

行为红测依次揭示：task.start 缺失返回 invalid-command；追加 selector 被 Controller 覆盖；header-only 恢复路由变 default；可信自身 Session actor 被误拒；缺少 kickoff 导致 start 后 0 请求；缺少 choices 返回 invalid-query；原 fixture 的 LocalFileSystem 不执行 read-only、实际 write 成功；native rejected batch 被 loop 移除；慢宿主下已接受 replay 等待 Execution 锁。均保留断言并针对根因修正，没有提高测试预算。

fixture 组合真实 SessionController、AgentLoop、JsonlSessionPersistence、SessionQuery、WorkspaceRegistry、AgentPresets、AgentDefaultModel、fs-sandbox、bash-sandbox、sandbox-local、权限与工具服务。仅模型输出确定性适配；typert 注册及附件目录是传输装配边界。fixture 已移除先前 Shell.sandboxMode override。真实 read 在与宿主默认 cwd 不同的选定 workspace 取得正确 marker；真实 read-only write 返回 tool error 且文件不存在。shell provider 已实际装配，但本阶段没有执行 OS shell containment 合同，不能把 filesystem policy 验证扩张为 OS 隔离证明。

真实 AgentDefaultModel.currentSelection、实际 request/header 和 provider/model 路由已断言。带 configEditor 的宿主默认配置文件持久化未在本 fixture 验证；实现没有调用 global saveSelection，不据 programmatic fixture 假称真实 GUI profile 已验证。模型语义质量、浏览器、18780/18781 本阶段未验证/未修改。

2026-10-19 本会话验证记录：

| 命令 | 真实退出 | 通过/skip 或产物证据 |
| --- | --- | --- |
| pnpm exec vitest run tests/work.spec.ts tests/work-execution.spec.ts tests/work-host.spec.ts tests/work-process.spec.ts | 0 | 4 文件 30/30 通过、0 skip |
| pnpm typecheck | 0 | backend/client 均通过 |
| git diff --check | 0 | 补丁格式通过 |
| pnpm verify:pack-exports | 0 | 独立 src-only build、真实 tgz 安装、13 个 Node 导出 import 通过 |
| pnpm exec vitest run tests/work-execution.spec.ts -t 'runs on the selected' | 0 | 加强后的实际 system prompt 变量/公共 Session projection/model 路由一致断言：1 通过、14 未选 |

更早全组29/29绿后的 typecheck 曾退出2，暴露native readonly和严格数组索引类型，已修；最终build不依赖tests偶然导入，Dsh-host有显式type-only service augmentation。慢创建定向红测退出1；非阻塞lease修复后定向2通过、13未选。最初慢创建红测的测试辅助分支曾未等待第二个请求导致ENOTEMPTY，现该用例显式收集它自己启动的全部Promise，不提高5秒预算或删断言；通用超时fixture生命周期诊断/修复由主会话另片处理，不能将本会话30/30绿归因成原始偶发超时首因已确定。部分定向命令的skip只是 -t 未选择，不算全组通过。

移除不可靠 instanceof 检查后，打包导出验证退出0；模型变量/projection加强断言定向通过。21:31 末次全组仍为4文件30/30通过、0skip，后续backend/client typecheck及git diff --check均退出0，才进入提交步骤。

依赖安装：首次 frozen install 完成 207 包，但因 ignored subprocess-local/koffi/node-pty 构建脚本退出1；未更改批准策略。真实默认模型与三个 sandbox devDependency 均固定0.2.0-rc.2，安装 --ignore-scripts 退出0。peer check退出1，指出 base 已有 subagent-activation@0.2.1-rc.2 等与0.2.0 peers不一致，未用升级/混装替代本票真实执行路径。候选0.2.1-rc.2调查仍没有selectLocalModel且create语义变为blank reuse，未采用；仅本次新建调查目录核对绝对路径后已移除。

最终 `pnpm install --lockfile-only --ignore-scripts` 亦因同一 ignored-build 规则退出1，故该组合命令后段未执行；随后单独运行相关30测试/typecheck/diff及pack验证，均以上表真实退出为准。没有通过批准native脚本、扩大超时或修改断言来消除安装器的失败。

## 后续交接

当前生产入口是受信任 HTTP UI 命令；没有新增注册到模型工具目录的适配器。Session actor 的真实合同覆盖进展、外 Session 与过时代次拒绝；从正在执行的模型工具内自调用等待/暂停的维护调度尚未验证，后续模型工具接线必须在返回后进入安全维护，不能在当前工具体里等待自己的维护边界。

以 ExecutionRef(TaskRef+ExecutionId)、WorkExecution.owner/epoch/session、稳定事件 ID 和 WorkExecutionHost 的 check/ensure/settle/deliver/observe/connect 端口接入后续功能。手动接续应复用旧 runner 的 prepare/write/create/take/deliver 深层机制并抽取权威读/受围栏 take；不能再另造完整平行恢复器，也不能通过旧 issue.mainSession 声称新 TaskRef take 已实现。历史必须用不激活 Agent 的真实 SessionQuery/inspect 投影并校验映射。新旧会话回同一工作、完整接任围栏与浏览器产品证据仍由后续阶段完成。
