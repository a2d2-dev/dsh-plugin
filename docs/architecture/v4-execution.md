# v4 Task 执行观察与安全接续架构

## 背景

#138 复用固定 base `a8ee660eeae8fdbfc1d41bedca22bb97dedac602` 已有 Task 启动、owner/epoch、固定 operation/successor/material、take、retired 和只读历史。根因是旧 `task.execution` 只投影当前 execution/status，维护边界只观察当前会话的人类问题和原生子会话，未遍历关联执行者及其作业。

## 目标

- 按 TaskRef、ExecutionId、显式 SessionAssociation 与宿主 catalog 连接真实执行者。
- 独立子 Task 保留独立入口、负责人和验收；原生子会话保留宿主父子关系。
- 相关当前、评审、关联、退休会话及原生后代的作业均观察真实 owner。
- 返回、输出交付、模型消费、业务验收分别呈现；未知事实不转为成功。
- 接续 body 仅在真实维护边界、结算状态明确时执行；复用已有固定后继与重试机制。

### 非目标

不重写运行器，不创建聊天壳，不写完成 outbox、自然语言计划或业务 Issue，不部署或重启现有服务。共享应用查询与 Issue 面板由 SourceA 接线。

## 架构

### 概要设计

WorkApplication 提供 Task 和其显式会话关联，DshWorkExecutionHost 经 RuntimeHost 只读适配宿主公开 SessionQuery、agents 和 jobs。`buildExecutionGraph` 只做领域投影，独立子 Task 从授权查询结果加入 `childTasks`，不加入父 Task 维护围栏。

### 组件模块

| 模块 | 职责 | 权威输入与输出 |
| --- | --- | --- |
| `work-execution/observation.ts` | 浏览器安全的 ExecutionGraph/ExecutionObservation 合同及纯投影 | TaskRef、ExecutionId、owner/epoch、显式关联、宿主事实 → graph |
| `work-execution/job-observation.ts` | 正式 job 只读接口适配；不存在 read 方法；`settleUncollectedJob` 是「可达结算／不可达提醒」的唯一判定 | jobs.list/observe(owner) → owner/epoch/instance/terminal delivery；未交付作业 → blocker 或 reminder |
| `task-runtime/host.ts::executionFacts` | 公共观察适配；不改变旧 runner 方法语义 | SessionQuery + 当前 live Agent 状态 + jobs → ObservedSession |
| `DshWorkExecutionHost.observation` | 遍历当前、退休、关联、评审和真实 native descendants | 显式范围 → sessions/blockers/reminders/limitations/settlement |
| `DshWorkExecutionHost.maintain` | 在维护窗口持有当前与相关 live Agent 的 maintenance fence，重读结算事实后执行 body | settled 才允许 body |

### 身份与状态

- graph 的协调权只来自 execution.owner/epoch/session；打开评审或历史不会改变控制会话。
- 每个原生后代来自父日志 `subagent/catalog.childId`，不按标题或创建时间猜归属。
- `jobs.list(owner)` 会含 unowned，适配器显式过滤 `job.owner === owner`。不列全宿主会话或全宿主作业。
- Job `registryEpoch`/`instanceId` 只接受宿主公开 observation；裸 id 不与旧 registry 事实匹配。
- job.status 描述执行返回；delivery 描述终态输出交付；result 描述模型消费（没有证明即 unknown）；acceptance 保持 unassessed。
- 原生 continuable 结果沿用已有维护规则：明确 senderSessionId 的 `subagent-settled` 已进入父 user/message，并覆盖最近 turn/end。这里时间只比较已知同一 child 的结算事件，不推断归属。one-shot 返回不声称 consumed；其父工具必须在真实维护边界已收口，后台结果另由 job 交付围栏保护。
- 历史 turn failure 是 attempt/result 事实，不仅因失败文本持续阻塞当前。未结算子执行与应交付输出才构成安全阻塞。
- 可达性只看 `availability`：`live`、`history` 或旧宿主未标注为可达；`lost`（registry 实例已不存在且终态未收取）为不可达。可达作业未交付仍产生 `job-unsettled`／`job-result-unknown`；不可达作业只写入有界 `reminders`，不产生 blocker、不影响 `settlement`，也不阻塞接续。
- `job-observation-unavailable` 表示宿主缺少正式 `jobs.observe` 能力，是宿主能力契约缺口，仍为 blocker，不属于作业不可达。此时不再并列发出「注册表实例已不可达」提醒：能力缺口已经说明交付无法证明，两者并列会自相矛盾。
- 宿主**完全没有** jobs 服务（`disabled`）时，作业事实只能来自会话 journal，没有 `jobs.list` 可用于证明可达性；这类作业仍写入有界提醒（仍然只提醒、不阻断），并在 `limitations` 记录「宿主未提供 jobs 服务」这一限定。

### 宿主研究与公开缺口

只读核查宿主 checkout `/data/src/github.com/deepseek-ai/deepseek-harness-dev`，未编辑或部署宿主。主要一手来源：

- `packages/jobs/jobs/src/index.ts:117–148`：list/get/readAt 为观察；read 推进 model cursor，首次终态读返回 producer result。
- `packages/jobs/jobs/src/types.ts:16–30,126–137`：真实 owner 与 result 属宿主；observer 不应代读 result。
- `packages/jobs/jobs-local/src/index.ts:1–8,76–95`：registry、cursor、resultDelivered 为 process-local 内存。
- `packages/jobs/tool-jobs/src/index.ts:271–307,336–346`：通知由宿主投递，原始通知 source 仅 kind，不含稳定 job 身份；job_output 调用真正 consuming read。
- `packages/core/agent-loop/src/tool-calls.ts:282–289`：持久 tool/result 含 message/error/meta，不持久 value，故不能从 canonical value.job 反推已交付。

#142 冻结的最小正式宿主合同：

```ts
observe(id, caller): {
  job, registryEpoch, instanceId,
  terminalResult: 'not-terminal' | 'pending' | 'collected'
}
// read 返回 receipt；job_output 保存标准 meta.jobReceipt。
// terminalRead: 'not-terminal' | 'first' | 'repeat'
```

观察不能改变 cursor。`collected` 只证明终态输出已交付，不能证明模型理解或业务验收。旧 rc.2 包缺 observe 时，图为 unknown、维护明确拒绝；禁止解析输出文本作 fallback。宿主补丁及匹配产物尚需最终 #141 在既有实例验证。

跨重启使用正式 `jobs/registered`、`jobs/settled`、`jobs/collected` Session 事件，data 为公开 `JobObservationRecord`（与 observe 返回相同字段）。插件通过 SessionQuery 读取，以 `(registryEpoch, instanceId, job.id)` 合并，当前 registry 缺失的未交付旧实例为 lost/unknown；已交付旧实例为 history。宿主使用新增公开 appendIgnorable 写入 log-only 事件并通过 sessions.flush 持久化；该宿主补丁尚待匹配产物实测，插件不得把未部署的能力当成运行实例已有能力。

### 聊天公开槽位

宿主 `packages/client/ui-conversation/src/client/contract/slots.ts:156–195` 提供 header actions/list、conversation.view/list 和 input.dock/list。`apply.ts:180–191` 从 view 注册生成原生 tabs，轨迹仍遵守宿主 developerTools 设置。

`ConversationSession.tsx:70–134` 在 blank/hideChrome 隐藏 header actions；`ConversationHeader.tsx:15–24` 明确 blank 判定。关联任务在非 blank header 使用紧凑入口，blank 保留 input.dock。接续使用原生 conversation.view，保留原生标题、composer、控件与草稿，不替换 header，不自动发送。

## 场景

### SourceA 公共接线

1. WorkApplication 构造已接 `host.execution?.connectObservation?`，从真实工作存储校验完整 TaskRef、ExecutionId、owner、epoch、currentSession 后返回对应 Task.sessions；缺 resolver 或校验失败为 unknown，不能拿空数组证明范围完整。独立子 Task 不加入此范围。唯一受控例外是已有原语 take 已提交而 intake seal 未保存的恢复：同一 operation 的精确 retired source/epoch 可被维护以完成 seal，同时真正 current successor 进入相关维护围栏，不恢复旧段协调权。
2. WorkCompleted 新增 `executionGraph?: ExecutionGraph`，task.execution/task.detail 查询调用 host.observation(execution) 后 `buildExecutionGraph({task,execution,observation,children})`。
3. children 通过父 Task.children 完整 ref 查询对应 Task/Execution，保留独立 owner；Issue 负责人来自已有真实 source 投影。
4. UI 以 graph/controller props 接入新独立组件，SourceA 独占共享 work types/schema/query、work-panel/controller/styles 的编辑：
   - `ExecutionSessions({graph,onOpenTask?,onEnterTask?,onOpenSession?,onReadHistory?})`：分别接 openTask、openCurrentTask、openSession、现有只读 history 方法。
   - `ExecutionContinuation({graph?,execution?,policy?,busy?,completed?,onContinue?})`：只显示参数与接续动作，不重复提供策略编辑入口。Issue 顶部唯一设置按钮由 SourceA 复用已有编辑器；Tab 使用此组件。
   - 原生 `ExecutionSessionWorkEntry` 由 index 注册 header actions 与 blank dock；`ExecutionConversationContinuation` 注册 `conversation.view/a2d2-continuation`，不修改 WorkPanel 当前选择、宿主标题或草稿。点击接续前重新读取 Task 完整 ref、实际 execution/session 和 owner/epoch，后端再次校验。
   - 无真实 graph 时明确“相关执行结算未知”，不制造空图安全状态。

数据走向：权威工作存储 → 明确观察范围 → 宿主公开只读事实 → graph → Issue／原生聊天。查询不执行 collect、不启动或接管会话。

### 接续后查看当前处理会话

原生聊天中的“进入当前处理会话”调用 `WorkPanelController.openCurrentTask(ref, signal)`，每次点击重新查询 `task.detail`。导航只使用响应的 `execution.session`，校验响应 Task 与 execution 的完整 TaskRef、非空 sessionId/runtimeId、实际 `actual` 和 session runtime 一致后，调用原生会话导航。`execution.state` 描述执行状态，不是查看资格：failed 的已创建当前会话仍可查看；打开不会发送 command、恢复执行或改变 owner/epoch，也不会回退到 retired 会话。

挂载生命周期取消、后续点击替代读取及面板导航代次变化会丢弃迟到成功响应。读取失败由现有原生入口呈现错误。没有当前执行或无法证明实际会话身份时拒绝进入。自动启动入口的 `currentSession()` 状态筛选不属于这个显式查看入口，本次保持其现有启动行为。

验证命令：`TMPDIR="$PWD/.local/tmp" corepack pnpm exec vitest run tests/client/session-handoff-entry.spec.ts`。#225 在真实控制器入口已记录 failed 误拒绝的红测及绿测；GUI 截图、部署与原任务点击由父 #223 验证，控制器测试不替代运行实例验收。

### 准备接续与失败重试

操作沿用 `task.continue`。固定 operation 与 successor 先保留，准备不修改当前入口。`maintain` 等当前 idle，取得 source maintenance 并 flush；观察相关执行者，再对其 live idle Agent 取得 maintenance 并逐一 flush，最后重读公开事实。如果获取锁时出现新的相关 live 执行者，先补锁与 flush 再重读。body 已在这一持久屏障内，禁止再次调用 settle/whenIdle/runMaintenance 造成嵌套等待。pending/unknown 拒绝 body，释放维护窗口，让原生工具继续结算。settled 才进入已有 take；失败重试复用原 operation/successor，不另建入口。不可达作业只提醒，不计入这里的 pending/unknown。

### waiting/paused 仅换会话与步骤恢复（#274）

**前置条件**：真实 source 已 idle，Task 尚未验收完成；命令携带当前 execution/owner/epoch。普通聊天、页面、完成及归档不授予业务调度资格。

**操作**：显式提交 `task.continue`。插件持久保存唯一 operation、固定 successor、materialRequestId 与 kickoffId；原 source 仍是业务协调者。waiting/paused 保留 state、完整 control（原因及恢复条件）、Task/Execution/owner、全部规格与验收。continuous 维护不领取 slot、不写 resumeRequested；接任不把等待/暂停设为 ready。

**步骤与数据走向**：

1. 插件读取完整执行范围。遇到可达终态 pending jobs，在任何 executor maintenance 锁外，将 `collection:<operation>:<request>` 请求发给准确 owner Session。准入同时绑定 operation、准确会话、固定 request 与 collect 步骤；tools.guard 只允许这些 job 的正式 job_output，不允许业务工具或嵌套分派。running/unknown/权限拒绝等保留具体阻塞。
2. 正式 Agent loop 提交真实 tool/call、tool/result；插件 flush 准确 owner 后复查公开交付事实，以 owner/job/registryEpoch/instanceId 识别同一结果。消费后无结果、无 Session 提交和空重读保留 pending，不伪造 collected。持久 collections 保存执行者、目标 jobs、请求交付/消费和核实结果。
3. 结算后请求 source 仅调用 work_continuation_material。保存材料绑定 TaskRef、execution、source、epoch、specificationVersion 与已观察结果身份集合；补收或结果变化后重新请求材料。插件在相关 executor maintenance 锁内再次读取事实与材料新鲜度，通过后才创建固定 successor。
4. source maintenance 内调用公开 goals.disarm(exactLiveAgent)，再 goals.get 核实 activation=disarmed 且 Goal id/phase/revision 未改变。无能力时精确记录宿主边界；不伪造人类 pause/resume、不 complete/blocked 未完成 Goal。正式事务才增加一次 epoch，并将 source 写为 retired。独立浏览器协作交接不具有此原生事务或自动 Goal 转移能力，须进入受控流程。
5. 新操作保存 `protocolVersion=1`。缺少该字段的旧 `delivered` 保留历史终态和无读取凭据的事实，查询、冷加载和恢复均不自动重开或补标 received；旧未完结操作才在正常恢复中采用新屏障。对历史终态显式再次接续，会保留原历史并创建新的固定 operation。`taken` 后投递固定内容，`delivered` 仅表示投递事实。后继只调用 work_continuation_received，声明准确 operation/material command/epoch；插件 flush 并从其真实 Session 回读成功的 tool/call、tool/result，才进入 `received`。单独声明、deliver 返回、消费消息均不足以确认可读。
6. received 后按原业务控制处理后续输入。waiting/paused 后继继续等待；正常可推进执行才投递业务下一步，并继续服从 continuous slot 与所有原权限。相同 successor/operation/material/epoch 的成功回执可重放；保留原始读取凭据和业务事件，不重新接任或调度。

**失败与恢复**：插件的 idle 事件、启动检查及既有低频恢复循环持续负责推进。已消费但缺材料、缺收取结果或缺读取回执时保留具体 error 和准确执行者，不重复空推；新的显式 task.continue 为缺失步骤生成新请求，保留 operation/successor/kickoff 与 epoch。创建/接任/投递失回执通过已固定身份与正式日志回读恢复，接任只提交一次。真实 Goal 的 activation 只退役旧会话，不承诺在后继自动 rearm。

**完成判据**：当前协调记录指向固定 successor、epoch 恰增一次、正式收到并可读的材料已核实、原控制及槽位资格保留。后端测试与正式 jobs/Goal lane 使用明确的隔离 fixture，不能替代父 #270 要求的既有 GUI 实测；本切片不部署或改动任何真实业务 Task。

### 原生子会话结算维护（PR #282 R1）

接续 reservation 会关闭普通自动业务轮次，但原生 child 的最新结算仍须进入准确父 Session 的 `user/message`。`settle` 维护步读取父 `subagent/catalog`、child 的 `origin/parentSession/descriptor`、最新 `turn/end` 与原生通知首次 durable inbox insertion，绑定同一 operation、准确 parent/child、endSeq 和 messageId；重放旧通知不能刷新其首次入箱时间。该轮只准入核验过的完整通知，所有工具（含嵌套工具）均被围栏拒绝。任意维护 marker 不取得此准入。插件持久保存 settlements 的交付进度，恢复检查可经原生 inbox 重投尚未消费的原通知；只有正式父日志消费并覆盖 child 最新结束后，原生结果门才解除。jobs 和 child 最新结束身份一起构成材料新鲜度，不能复用旧结算材料。

**真实晚到结果场景**：source idle 时启动正式 continuable child，以真实工具确定性挂起；先 `task.continue` 预留 operation，再释放 child。`Subagents` 自行生成结算通知，测试不直接创建通知或 append user/message。Node 22.23.1 下 `pnpm exec vitest run --project host tests/work-completion-native.spec.ts -t 'running native child'` 在修复前 ready/waiting/paused 三项均失败：准确父 user/message 数量为 0（exit 1，`.local/issue-274/r1/red-late-child-contract.log`）。首个 fixture 参数错误单列 `.local/issue-274/r1/red-late-child.log`，不算产品红灯。修复后完整同文件 5/5 通过（exit 0，`.local/issue-274/r1/green-late-child-attempt.log`），保留 control、owner 与 operation/successor，最终 received 且 epoch=2；正常控制执行原 next，waiting/paused 不写业务进展。第二条 job 补收与最终回归结果另记，不以该阶段通过代替全部验收。

**同批输入与安全负例**：真实 Agent inbox 的 nextStep 自动输入与 nextTurn 原生通知会一起被 claim。最初只允许整批均为 subagent-settled，三种控制仍拒绝必要通知（exit 1，`.local/issue-274/r1/red-mixed-claimed-native.log`）。现在按准确通知子集准入；其余输入保留完整 payload 和稳定身份到业务 events，不设置 resumeRequested；宿主只将获准通知写入这次模型输入。正式模型在 settle 轮尝试 work_control 或业务分派工具时，真实 tool/result 为 isError，分派体未执行；已消费旧通知、错误 child 与伪 settle marker 逐项拒绝且没有新模型请求。

Node 24.22.1 下 `TMPDIR="$PWD/.local/tmp" pnpm exec vitest run --configLoader runner --no-cache --maxWorkers=1 --project host tests/work-completion-native.spec.ts tests/work-continuous-integration.spec.ts` 完整 2 文件 / 10 项通过，exit 0（`.local/issue-274/r1/green-native-continuous.log`）。ready 实际沿原 next 写进展，waiting/paused 保留 control/state；真实 continuous 两种 hold 场景保持 slots、resumeRequested/explicitResumeRequested 未写，固定 operation/successor、epoch 只增一次。测试等待真实 whenIdle 后直接核验日志，没有扩大 timeout 或添加 skip。

**returned child 的两个 pending jobs 能力边界**：不能把内存观察实验当成正式 Session 测试。匹配依赖的真实 native child 工具先创建准确 owner 的两个 completed jobs，Subagents 自行退役 activation 并发送旧结算通知；父消费后，LocalJobs 已删除两个记录，`jobs.get` 拒绝、观察 jobs=[]，普通 SessionController 对该 child 冷恢复返回 owned-by-subagent-routing。能力负例见同一 native suite；最初尝试构造该前置的失败单列 `.local/issue-274/r1/red-child-jobs.log`、`child-jobs-prerequisite.log`，不算产品红灯。

同一边界已在指定干净官方 HEAD `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` / 0.2.1-rc.3、Node 24.22.1 上用真实 startActivation、Agent loop、Jobs registry、正式父 user/message 与 flush 独立复核（exit 0，`.local/issue-274/r1/official-native-capability-attempt.log`）。两个准确 owner 作业只在 child 活跃时可达，返回后均移除；没有 job_output 或伪造 collected。该结果是公开宿主能力负例，**不是“补收两个 returned-child pending 结果并接任”的通过证据**。已有普通 owner 两 job 的正式补收 lane 继续单独验证；当前不通过改 DSH、假注册表、人类输入或私有路由制造此场景。

保留的测试诊断：`.local/issue-274/r1/red-mixed-native.log` 的 followup FIFO 为两个独立 turn，本身不构成同批红灯；真正同批红灯使用 inject(nextStep)。`green-mixed-security-attempt.log` 首次含可选 control 字段断言错误及三个伪输入并排后停驻 FIFO；逐个拒绝确认后，`mixed-security-take-diagnostic.log` 的材料延迟也已消除。`green-native-final.log` 曾有一条默认 expect.poll 观察期未等到慢模型轮次，随后改为已知输入的真实 whenIdle 收口再核原断言，未更改测试预算。

### 已验收任务的接续入口

原生会话「A²D² 接续」与 Issue「接续」页从 `task.detail` 的 `task.completion`、`progress.completion` 或 `progress.processingState === 'completed'` 读取 Task 完成事实，传入 `ExecutionContinuation.completed`。完成后保留置灰的「准备接续」，并显示「任务阶段：done（已验收完成）」和「任务已验收完成，不能继续接续」。该参数即使与 handler 同时传入也会禁用动作；handler 仍由当前协调关联等既有资格判断提供，缺少 handler 不伪造可用能力，未完成的历史或评审会话沿用隐藏行为。原生会话 Completed/idle、Goal 与 GitHub closed 均不推断 Task 完成；完成显示不改变 owner、epoch 或 Task 状态。

验证入口：`TMPDIR="$PWD/.local/tmp" corepack pnpm exec vitest run tests/client/execution-components.spec.ts tests/client/execution-continuation-render.spec.ts`。组件渲染验证完成按钮、状态提示及当前／历史资格，不执行真实 `task.continue`。

### 作业返回与收取

用户或执行者通过原生 job_output 读取真实终态输出，宿主 pending → collected。graph 仅下次观察该状态，消费仍 unknown、验收仍 unassessed。图没有“标记消费”按钮。旧宿主无 observe 时显示能力缺失；完全没有 jobs 服务时额外显示 `limitations`。最终切匹配 #142 产物后验证这一解除路径。

完成门禁只对可达作业强制结算（#201）。评审子会话结束、registry 实例释放后，其作业既不能 `job_output` 也不能 `job_kill`，此时 `availability: lost`：门禁降级为提醒，`work_report(stage=done)` 的成功结果带 `reminders`，graph 与 `limitations` 并列展示，接续 `maintain` 也不再等待它。这兑现 #142「真实收取后能解除等待，不能形成不可解除的永久阻塞」；提醒仍说明结果无法收取，不以提醒代替取证或业务验收。提醒是一条清洗过、总长不超过 320 码点的单行文本：label 取首个可见行（去除 ANSI 与 C0/C1 控制字符、按码点截断），并带上执行者会话 id；journal 记录停留在运行中的作业会明确说“记录停留在运行中”，不谎称已有终态结果。

## #141 源码整合检查点

候选分支已接通 `task.detail` / `task.execution` 的 `executionGraph`。当前及独立子 Task 的执行都按完整 TaskRef 读取；查询只调用公开 observation，不收取 job、不驱动模型。原生子 Issue 另存 `nativeIssues`，保留 canonical Task 入口、独立 owner/epoch/session；未观察完整要求时呈现 `unread`，已观察而无执行时为 `not-started`，负责人未观察时明确未知。后续来源未返回关系字段时，已接受／已观察的关系保留并标注最后已知时间，不能把缺字段解释成没有子工作。显式读取要求可以建立对应仓库来源，但不会导入 Task；canonical 子工作使用原有完整项目导航。迟到回复经过导航代次检查，不替换新选中的 Task。原生关系不加入父会话维护围栏。

Issue 详情使用 ExecutionSessions、ExecutionContinuation 与 CompletionStatus；自动接续编辑器只在详情顶部出现。原生 header / blank dock / continuation view 保留 B 注册。持续委托通过稳定 client/source props 接来源工具栏，资源保存不会启用计划。普通 HTTP 的命令身份统一使用既有 browserUUID；完成补同步通过既有 submit transport 保留未知回执的 commandId。

公开组合验证：`corepack pnpm@10.26.2 exec vitest run tests/work-continuous.spec.ts -t 'keeps native Issue children|returns the authoritative execution graph'` 两项通过，均先记录相关红测；工作台渲染合同及 HTTP 委托控制器合同先红后绿。此处是源码／组件合同证据，既有实例交互和匹配 #142 宿主仍未验证，不表示已部署。

## 验证


### #141 组合组件浏览器记录

通过 `A2D2_INTEGRATED_ARTIFACTS=1 corepack pnpm@10.26.2 exec vitest run tests/client/v4-integrated-render.spec.ts tests/client/v4-source-render.spec.ts` 生成 `.local/v4-integrated` 内的 file 页面，显式标注合成合同夹具、非运行实例、未部署。agent-browser 检查来源导航／右侧委托、执行图／原生未读子项及窄屏布局。截图为 `source-desktop.png`、`source-mobile.png`、`execution-desktop.png`、`execution-mobile.png`、`delegation-mobile.png`，仅保存在现有忽略目录，不进入发布包。

实际展开委托暴露了响应式 flex 问题：390px viewport 下面板只有 37.359375px。浏览器宽度断言先红，修复展开项的整行 flex basis 后，同一断言返回 width 343、viewport 390、document 375，窄屏内容正常显示。仅检查页面总宽度不足以证明可用。当前截图证明组件布局，不能替代原生宿主草稿、真实模型、GitHub 关闭与匹配 #142 能力的交互验收。

验证审计：一次 14 文件 80 项组合为 79 pass / 1 fail，无超时。失败来自新增 native Issue 测试的嵌套精确匹配遗漏完整引用字段；保留原红并补全预期引用后，两项 graph 公开合同定点通过。此前测试与 typecheck 串联，后者成功掩盖了前者失败的最终 shell 状态；后续逐命令核验。之后原生关系字段缺失、迟到导航、完成事实缺少可选进展投影、未知聚合显示零等具体红测均已修复并定点复验；没有调 timeout、删断言或 skip。

### 组件浏览器记录（中间票）

目的：核实独立执行组件的真实样式、结果语义及窄屏布局，不冒充已部署宿主。

步骤：运行 `A2D2_EXECUTION_ARTIFACTS=1 pnpm exec vitest run tests/client/execution-components.spec.ts`，测试用实际组件与样式生成 `.artifacts/v4-execution/component-contract.html`；页面明确标注“合同测试夹具，非运行实例数据”。通过 agent-browser 打开本地 file 页，分别在 1280×1200 和 390×844 截图，未启动 Web 服务或重启 18781/18782。

记录：桌面 `.artifacts/v4-execution/desktop.png`，窄屏 `.artifacts/v4-execution/mobile.png`。实际浏览器窄屏检查返回 `{width:390, scrollWidth:390, body:390}`。已核对图片，owner、独立子工作入口、输出已交付／消费未知／未验收和 200,000／12,000 参数均可见。截图和本地夹具未纳入提交，作为验证证据保留。

本阶段真实公开宿主 header/dock artifact 与组件注册测试 8/8 通过；typecheck、build 和 pack exports 检查通过。原有 continuation 的 17 项一次串行 15 通过／2 项默认 5000ms 超时，随后仅对应两项 targeted 复验 2/2 通过；新增权威 connector 后，source-take 恢复通过，source-seal 一次超时且 cleanup retained，隔离 checkpoint 诊断一次完整通过（3413ms），未改 timeout／断言。重型边界测试的 jobs case 也出现一次默认超时／清理 hook 超时；此前多次通过。环境采样 load≈29、当秒 CPU user75%/sys10%，不能仅据此裁定根因；最终整合须在受控环境复核这些疑点，不能把编译通过当全部验收通过。

仍未验证：与 #142 patched jobs 包的完整组合、job_output 真实终态交付解除围栏及 foreground remove 的收口、匹配宿主 journal 的跨重启回读、SourceA 公共图查询／Issue 唯一策略入口接线，以及 #141 在既有实例的真实子会话／job／模型接续和原生草稿交互。宿主应用壳和运行 checkout 未编辑。


```sh
pnpm exec vitest run tests/work-execution-observation.spec.ts
pnpm exec vitest run tests/work-execution-boundary.spec.ts --maxWorkers=1
pnpm exec vitest run tests/work-continuation.spec.ts --maxWorkers=1
pnpm typecheck
pnpm verify:pack-exports
```

已记录第一条 graph 测试缺模块红 → 1/1 绿；真实 SessionController scope/maintenance 测试缺 connectObservation 红 → 绿。完整结果随实现提交及最终汇报记录，不以编译成功替代浏览器验收。首次 pnpm install 因 ignored build scripts exit 1；未授权脚本。corepack pnpm10 因 store v10/v11 不同 exit 1；随后现有 pnpm add --ignore-scripts 安装三项已授权 jobs 测试依赖 exit 0。相关测试并行时有超时，后续采用 maxWorkers=1 隔离，不增加 timeout、不 skip。


## #274 后端实施验证（2026-10-26）

**目的**：验证插件持续持有推进责任、waiting/paused 仅换会话保留业务控制、准确 owner 正式补收后刷新材料、真实读取回执、受控 Goal activation 退役及既有回归。本段是后端与正式宿主接口证据；父 #270 的现有 GUI 全流程验收仍待前端 #275 和集成验收切片。

**基线与环境**：指定 worktree 分支 `feat/270-lifecycle-control` 从 `9c2b91e5c4b8235c1ec4db0bff0a8acb3bb8283c` 快进到实际 base `09d5685ab9bc475d13ea41615a9b3a9653889041`，保留 #273。`pnpm install --frozen-lockfile` exit 0，锁文件未改；主 checkout 的锁文件不同，未借用其依赖。普通 lane 使用 Node 22.23.1 / pnpm 10.26.2，official lane 使用 Node 24.22.1、官方干净构建 `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` / 0.2.1-rc.3。

**步骤**：以下命令均在唯一实施 worktree 运行，日志保留在其忽略目录 `.local/issue-274/`。最终 unit/host 分项目顺序执行；临时 fixture 使用本树 `.local/tmp`，不使用 tmpfs，不变更测试断言或 timeout。

```sh
pnpm install --frozen-lockfile

TMPDIR="$PWD/.local/tmp" pnpm exec vitest run --configLoader runner --no-cache --maxWorkers=1 --project unit \
  tests/work-continuous.spec.ts tests/work-execution-jobs.spec.ts \
  tests/work-execution-lost-job.spec.ts tests/work-execution-official-jobs.spec.ts \
  tests/work-execution-observation.spec.ts tests/client/execution-continuation-render.spec.ts \
  tests/client/execution-components.spec.ts tests/client/session-handoff-entry.spec.ts

TMPDIR="$PWD/.local/tmp" pnpm exec vitest run --configLoader runner --no-cache --maxWorkers=1 --project host \
  tests/work-continuation.spec.ts tests/work-execution.spec.ts tests/work-execution-boundary.spec.ts \
  tests/work-goal-replay.spec.ts tests/work-continuous-integration.spec.ts tests/work-execution-lifecycle.spec.ts

pnpm typecheck

PATH=/root/.nvm/versions/node/v24.22.1/bin:$PATH \
TMPDIR="$PWD/.local/tmp" \
DSH_OFFICIAL_HOST_ROOT=/data/src/github.com/deepseek-ai/deepseek-harness-dev.worktrees/dsh-upgrade-latest-20261024 \
node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache --config tests/official-jobs.config.ts
```

**红→绿记录**：

| 行为 | 首个真实失败 | 实施后的验证 |
| --- | --- | --- |
| waiting/paused 仅换会话 | 两项返回 continuation-not-ready | 两项完成接任并确认 received，state/control/owner 保留、epoch 只增一次 |
| 投递与可读分别确认 | delivered 无读取结果时不能达到 received | 真实 Session 成功 tool/result + flush 后达到 received |
| 插件组织两个终态 pending jobs | 只返回 continuation-waiting-executions，没有补收步骤 | 官方 registry + 正式 model step/job_output + Session commit/flush 均真实完成 |
| 补收后材料刷新 | 旧 materialRequestId 被复用，已消费请求不能再次运行 | 保留 operation/successor，新材料请求到达 source，旧材料不复用 |
| 随机维护 marker 不恢复业务 | 被拒 marker 仍进入业务 inbox | 生命周期输入从业务 inbox 排除，不能写 resumeRequested |
| 正常 source 仍欠材料时的业务准入 | 无关自动输入从 2 次模型请求增加到 4 次 | 仅固定维护步骤获准，未完成步骤不放行业务轮次 |
| Goal 退役 | 没有公开生命周期接线方法 | 官方 goals.disarm 精确 live Agent，get 核实 active/revision 不变且 activation=disarmed；真实 Goal driver 不再产生旧轮次 |

补充回归覆盖：材料请求消费但无保存、五个创建/接任/封口/投递失回执点、脱敏失败、两个真实后继、模型与 reasoning effort 恢复、慢详情刷新；missing/failed-commit 读取结果冷恢复保留同一 operation/successor/epoch；continuous waiting/paused 不领取 slot、不请求 resume。正式 lane 还断言消费后提交失败与空重读保持 pending、显式重试只更换步骤请求，不重建身份；缺少 goals.disarm 精确返回 capability-unavailable 且不改 Goal。

**阶段记录（09d5685 基线）**：unit 8 文件 / 151 项、host 6 文件 / 71 项均通过，两个命令各 exit 0（`.local/issue-274/unit-final.log`、`.local/issue-274/host-final.log`）；随后 pnpm typecheck exit 0（`.local/issue-274/types-final.log`）。official-jobs 1 个完整场景通过，exit 0，包括真实材料读取工具的官方注册和提交兼容验证。后续最新主干与历史 delivered 兼容复核另记最终交付结果。

**保留的失败记录**：前两次组合执行分别出现 work-continuous 的不同普通 unit 用例超出既有 5 秒预算，并在超时清理时出现 ENOTEMPTY；没有修改这些用例的 timeout 或断言。分项目最终 unit 151 项全部通过，证明该批断言可完成；不将前两次失败改写成通过。另一次新测试把 it.each 回调第二参数误当 context，已修正测试；一次新 fixture 的 callId 清理顺序错误、一处可选 observation 类型断言和新增 received 的前端穷尽映射均已修正并复验。

**范围与未验证项**：生产改动限定 Work 后端、接续 host/tools/types/schema 与文档；前端只有 received phase 标签和对应终点/接任判断的必要兼容，没有实施 #275 UX。普通真实控制器/Session fixture 证明完整接任；official lane 的已接任 fixture 仅用于隔离读取工具与 Session commit 边界，不能声称该 fixture 验证了真实 GUI 接任。未部署、未构建发布产物、未启动替代服务、未修改 DSH 本体或其他 checkout，未操作 #265/#182/#2104 的真实业务状态。独立浏览器协作仍须进入正式受控接续；没有跨会话 Goal 自动迁移或 rearm 承诺。父 #270 仍不能据本切片判定全部完成。

### 恢复收尾：历史终态与正常推进

**目的与现场**：前实施会话在最终交付前退出。恢复首检为 `00d20bcf9caccf9d9bfa8c373332855b20165e7d`（合入 main `f80ab103d13882efbc370bbb119e1c7dcf01a9e1`），恰有交接列出的 10 个未提交文件，全部保留。本节记录恢复会话新执行的验证，不将先前阶段结果当作当前 head 最终验收。

**根因与行为**：旧协议以 delivered 为终态，直接改为 received 才结束会让 reconcile 重开历史记录；新操作用 protocolVersion=1 进入读取屏障，旧 delivered 保留原始事实。正常操作确认读取后，还须投递 continuation-business 事件，才会执行材料中的 next；waiting/paused 不生成该业务事件。

**步骤与记录**：使用 Node 24.22.1、本树依赖及 `.local/tmp`，先运行现有两项行为测试，4/4 通过（exit 0）。为核实回归敏感性，在同一工作树逐项临时撤去关键行为并立即恢复：移除历史 delivered 终态判定时，三项冷恢复均因实际新增 continuation-read-unconfirmed 失败（exit 1，`.local/issue-274/recovery-red-legacy-behavior.log`）；移除 received 后业务事件时，正常后继虽为 ready/received，却没有写入原 next 的 progress（1 项失败，exit 1，`recovery-red-next-step.log`）。未修改断言或 timeout 来制造通过。

```sh
PATH=/root/.nvm/versions/node/v24.22.1/bin:$PATH TMPDIR="$PWD/.local/tmp" \
  pnpm exec vitest run --configLoader runner --no-cache --project host \
  tests/work-continuation.spec.ts \
  -t 'legacy delivered|automatically executes the accepted next step|explicitly replaces'
```

恢复原实现后，上述命令 6/6 通过（exit 0，`.local/issue-274/recovery-green-priority.log`）。历史 ready/waiting/paused 冷加载及重复 reconcile 均保留整个 operation/control、无新模型请求或伪读取确认；新显式接续归档旧操作并生成新身份。正常后继通过真实模型步骤调用 work_control(progress) 执行原 next，而 waiting/paused 在 received 后保持停止。最终隔离回归和正式宿主结果在完成后另记；此阶段不构成父票 GUI 验收。

验收清单的重复读取确认另有真实红→绿：在成功提交且进入 received 后，重放同一准确回执原先返回 stale-continuation-receipt（exit 1，`recovery-red-receipt-replay.log`）。修复只让该已确认终态返回同一成功结果，仍核对准确 successor/operation/material/epoch，并保留原 readable 与整个 execution。定点 `-t 'keeps delivery distinct'` 1/1 通过（exit 0，`recovery-green-receipt-replay.log`）；重复确认不会新增业务事件或再次接任。

### 恢复后的最终后端验证

**目的**：对最终代码提交 `eabdd628a1aec7a4b7e10f1cabd15089b1d6ed05` 重新验收，不使用旧会话最后未知结果或旧基线成功替代。本轮从本树已安装的 frozen-lock 依赖运行；锁文件未改。后续提交仅补充本验证文档。

**步骤**：沿用上节完整 unit/host 文件清单，显式指定 `--configLoader runner --no-cache --maxWorkers=1 --project unit` 或 `--project host`；两项目与 official lane 顺序运行，PATH 指向 Node 24.22.1，TMPDIR 为本树 ext2/ext3 的 `.local/tmp`。`pnpm typecheck` 也在最终代码上执行。official 命令仍指定上节相同的 DSH_OFFICIAL_HOST_ROOT，场景内部断言正式 checkout 干净、HEAD 与版本一致。

| 检查 | 结果 | 退出码 | 忽略目录中的原始日志 |
| --- | --- | --- | --- |
| unit：continuous、jobs/正式收取/失联/观察、三个相关客户端组件文件 | 8 文件，151 项通过 | 0 | `.local/issue-274/recovery-unit-eabdd62.log` |
| host：continuation、execution、boundary、Goal replay、continuous integration、lifecycle | 6 文件，84 项通过 | 0 | `.local/issue-274/recovery-host-final.log` |
| pnpm typecheck | 后端与客户端 tsc 均通过 | 0 | `.local/issue-274/recovery-typecheck-final.log` |
| official-jobs.config.ts | 1 个完整场景通过，9318ms | 0 | `.local/issue-274/recovery-official-final.log` |
| pnpm verify:repository | 元数据、10 个 mount rows 与源排除规则通过 | 0 | `.local/issue-274/recovery-repository.log` |
| pnpm test:node | 28 项通过，2 项既有可选 real-host 测试按默认条件跳过 | 0 | `.local/issue-274/recovery-node.log` |

**记录**：host 的 execution 38 项包含主干 #277 的 live/cold、create/reuse、danger-full-access/read-only 权限恢复；continuation 34 项包含历史终态、真实 next、材料请求刷新、读取失败冷恢复与成功回执重放。official provenance 为 Node v24.22.1、HEAD `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`、0.2.1-rc.3；真实准确 owner 正式补收、Session 提交/flush、读取工具、失败提交与空重读仍 pending、Goal activation 不改持久状态均通过。所有本会话验证作业的退出结果均通过正式 job_output 收取；未跨 owner 操作旧作业。

前述指定的 unit/host/official 回归没有非预期测试失败、超时或 ENOTEMPTY；先前两次组合失败记录仍保留，未修改 timeout、断言或配置，也不据本轮通过推断旧超时根因。这里只验证所列后端和组件合同，没有执行完整仓库 pnpm test 或既有 GUI 实测；完整前端、真实浏览器协作方式与 #259/#268 原完整模式仍待 #275/#276，不提前确认父票全部验收。

### 全仓 CI 的读取屏障配套回归

首次推送代码提交 eabdd62 的全仓 CI [40306215804](https://github.com/a2d2-dev/dsh-plugin/actions/runs/40306215804) 在 Node 22/24 均为 3 fail / 1434 pass，失败不是超时：work-compact-results 的多代接续在 delivered 后继续写下一代规格，触发 continuation-in-progress；work-source-freeze 的父/子两项仍以 delivered 为解冻点，且夹具未注册新读取工具。原失败日志保留在 `.local/issue-274/ci-eabdd62-failed.log`。相同三项在本地原样复现（exit 1，`recovery-red-ci-contract.log`）。

修正只补足真实测试步骤：注册该准确应用的正式 Work 工具，等待后继成功读取工具结果，再由插件 reconcile 确认 received 后继续规格更新或来源导入；delivered 仍保留中间态断言，来源回归新增读取确认前依旧冻结的断言。生产准入、回执屏障、大小上限与原关系端点断言均保留，没有扩大测试 timeout 或新增跳过。

以下完整两文件回归 16/16 通过，exit 0（`.local/issue-274/recovery-green-ci-contract.log`），包含原大回执上限与父/子两端关系断言：

```sh
PATH=/root/.nvm/versions/node/v24.22.1/bin:$PATH TMPDIR="$PWD/.local/tmp" \
  pnpm exec vitest run --configLoader runner --no-cache --maxWorkers=1 --project host \
  tests/work-compact-results.spec.ts tests/work-source-freeze.spec.ts
```

已提交源码 `6e15e4e` 的 `pnpm verify:pack-exports` 也通过，exit 0（`.local/issue-274/recovery-pack-final.log`）：临时 git archive 构建含 32 个导出目标与两个 sidecar，安装 tarball 后 15 个 Node 入口均可 import，编译产物未进入工作树提交。本次后续只改测试与本文；远端全仓 CI 状态由交付 PR 链接回读。
