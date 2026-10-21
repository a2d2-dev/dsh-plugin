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
| `work-execution/job-observation.ts` | 正式 job 只读接口适配；不存在 read 方法 | jobs.list/observe(owner) → owner/epoch/instance/terminal delivery |
| `task-runtime/host.ts::executionFacts` | 公共观察适配；不改变旧 runner 方法语义 | SessionQuery + 当前 live Agent 状态 + jobs → ObservedSession |
| `DshWorkExecutionHost.observation` | 遍历当前、退休、关联、评审和真实 native descendants | 显式范围 → sessions/blockers/limitations/settlement |
| `DshWorkExecutionHost.maintain` | 在维护窗口持有当前与相关 live Agent 的 maintenance fence，重读结算事实后执行 body | settled 才允许 body |

### 身份与状态

- graph 的协调权只来自 execution.owner/epoch/session；打开评审或历史不会改变控制会话。
- 每个原生后代来自父日志 `subagent/catalog.childId`，不按标题或创建时间猜归属。
- `jobs.list(owner)` 会含 unowned，适配器显式过滤 `job.owner === owner`。不列全宿主会话或全宿主作业。
- Job `registryEpoch`/`instanceId` 只接受宿主公开 observation；裸 id 不与旧 registry 事实匹配。
- job.status 描述执行返回；delivery 描述终态输出交付；result 描述模型消费（没有证明即 unknown）；acceptance 保持 unassessed。
- 原生 continuable 结果沿用已有维护规则：明确 senderSessionId 的 `subagent-settled` 已进入父 user/message，并覆盖最近 turn/end。这里时间只比较已知同一 child 的结算事件，不推断归属。one-shot 返回不声称 consumed；其父工具必须在真实维护边界已收口，后台结果另由 job 交付围栏保护。
- 历史 turn failure 是 attempt/result 事实，不仅因失败文本持续阻塞当前。未结算子执行与应交付输出才构成安全阻塞。

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

1. WorkApplication 构造时调用 `host.execution?.connectObservation?.(async execution => 对应Task.sessions)`；该 resolver 必须核对完整 TaskRef，只返回明确关联，不能纳入独立子 Task。
2. WorkCompleted 新增 `executionGraph?: ExecutionGraph`，task.execution/task.detail 查询调用 host.observation(execution) 后 `buildExecutionGraph({task,execution,observation,children})`。
3. children 通过父 Task.children 完整 ref 查询对应 Task/Execution，保留独立 owner；Issue 负责人来自已有真实 source 投影。
4. UI 以 graph/controller props 接入新独立组件，SourceA 独占共享 work types/schema/query、work-panel/controller/styles 的编辑。

数据走向：权威工作存储 → 明确观察范围 → 宿主公开只读事实 → graph → Issue／原生聊天。查询不执行 collect、不启动或接管会话。

### 准备接续与失败重试

操作沿用 `task.continue`。固定 operation 与 successor 先保留，准备不修改当前入口。`maintain` 等当前 idle，取得 source maintenance；观察相关执行者，再对其 live idle Agent 取得 maintenance，最后重读公开事实。pending/unknown 拒绝 body，释放维护窗口，让原生工具继续结算。settled 才进入已有 take；失败重试复用原 operation/successor，不另建入口。

### 作业返回与收取

用户或执行者通过原生 job_output 读取真实终态输出，宿主 pending → collected。graph 仅下次观察该状态，消费仍 unknown、验收仍 unassessed。图没有“标记消费”按钮。旧宿主无 observe 时显示能力缺失；最终切匹配 #142 产物后验证这一解除路径。

## 验证

工作目录固定为本 v4-execution worktree。

```sh
pnpm exec vitest run tests/work-execution-observation.spec.ts
pnpm exec vitest run tests/work-execution-boundary.spec.ts --maxWorkers=1
pnpm exec vitest run tests/work-continuation.spec.ts --maxWorkers=1
pnpm typecheck
pnpm verify:pack-exports
```

已记录第一条 graph 测试缺模块红 → 1/1 绿；真实 SessionController scope/maintenance 测试缺 connectObservation 红 → 绿。完整结果随实现提交及最终汇报记录，不以编译成功替代浏览器验收。首次 pnpm install 因 ignored build scripts exit 1；未授权脚本。corepack pnpm10 因 store v10/v11 不同 exit 1；随后现有 pnpm add --ignore-scripts 安装三项已授权 jobs 测试依赖 exit 0。相关测试并行时有超时，后续采用 maxWorkers=1 隔离，不增加 timeout、不 skip。
