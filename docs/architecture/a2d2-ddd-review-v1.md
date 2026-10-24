# A²D² DDD 架构设计 · 第一阶段评审稿

> **历史评审材料**：保留当时的讨论与固定提交证据，不作为并行的当前规范。当前领域定义见 [CONTEXT](../../CONTEXT.md)，当前决策见 [ADR](../adr/)。本轮已按 LF 指示直接替换冲突 ADR；本文中的“拟调整”“旧 ADR”及固定提交链接描述原评审时点。

> **状态：供业务场景、统一语言和边界评审；不是新的已批准领域契约。**
>
> 本稿复用既有领域模型，不重新定义一套任务系统。事实基线为插件提交 `6c9ccb6f0d5d2caea7275fc798caf36436af4f69`；文档分支为 `docs/a2d2-ddd-review-v1`。所有“当前实现”结论来自该提交的静态源码核对，不代表本轮重新完成运行验收。
>
> 按 LF 要求分两阶段交付：本轮包含 **5 个核心业务场景、统一语言、子域全景、限界上下文映射、规则责任及初步实现映射**。边界评审后再完善 **核心领域模型与聚合主图、状态图、关键时序图、完整一致性及实现映射**。后者在本文第 11 节列出范围，本轮不先行定稿。

## 1. 背景、目标与阅读方式

### 1.1 背景

LF 希望围绕任务推进工作，不必手动管理每次派发、会话交接和结果接续。上下文会满、会话可能中断、模型路由可能失效，但任务的目标、已定结论及负责人关系不能随之消失。既有 [ADR 0001][A01] 记录了这一业务动机，[ADR 0002][A02] 已按寿命划分“目标层 / 执行层”。

此前存在三条相互关联但不能混为一谈的设计线：

1. **领域共识与第一代任务机制**：任务以 Issue 为准、主会话由 CEO 承担、两类子任务执行方式。见 [Issue #41][Q41]；其[确认记录][Q41-confirm]记载 LF 合并 PR #43 后确认当时共识。
2. **阶段 → Agent → 模型及配置交互**：见 [Issue #70][Q70] 和 [ADR 0004][A04]、[ADR 0005][A05]、[ADR 0009][A09]。该 Issue 另明确指出旧任务视图原型属于后续工作，不能与已落地配置页等同。
3. **显式托管的任务运行器**：见 [一期规格][SPEC-runtime]、[ADR 0011][A11]。它增加执行权管理、自动接续、事件收件箱和恢复，未交付新的跨项目任务整页。

旧 HTML 设计已描述左上方、与“插件 / 自动化任务”并列的任务入口，及任务列表、详情和接续展示；但 [Issue #70][Q70] 明确标注该原型未纳入当时实施范围，且“站 / 第 N 阶段”与统一语言冲突。近期 v2 原型只用于检验理解，其新增验收分层和历史消息入口不构成已确认规则。

### 1.2 目标与非目标

本轮要能够沿 S1–S5 回答：

- 业务上发生了什么，哪些动作由 LF、CEO、插件或 DSH 保证？
- 同一个词在目标层、执行层、外部系统中是否有不同含义？
- 为什么选择这些子域、候选上下文边界，而不直接按文件或微服务切分？
- 规则在哪里检查、何时生效，哪些仍依赖 CEO 遵循方法？
- 哪些事实来自已有决定、当前代码、未实施设计或本次提议？

**非目标**：本轮不修改产品代码，不部署，不改变 tracker 写权限、任务完成标准、角色体系或生产任务；不将原型交互当作可用 API；不设计第二个 tracker；不提前冻结聚合边界或发布新的 ADR。

### 1.3 两条独立的标记轴

| 轴 | 值 | 解释 |
| --- | --- | --- |
| 设计与实现状态 | **已实现** | 基线代码中可定位；不隐含已实测，也不隐含所有并发路径有保证 |
| 设计与实现状态 | **已有设计但未实现** | 有规格、ADR 或原型依据，基线缺少相应实现；若只是设计稿，不能推断已获实施批准 |
| 设计与实现状态 | **拟调整** | 本轮提出的边界、表达或修订建议，尚未修改既有规则 |
| 设计与实现状态 | **待确认** | 证据不能定论，或需要明确业务取舍 |
| 保证强度 | **方法规则** | CEO 按职责、技能、SOUL 和证据执行；提示词不是数据库约束 |
| 保证强度 | **技术约束** | 工具入口、锁内检查、执行围栏、持久记录或宿主 API 强制 |
| 保证强度 | **外部事实** | GitHub、DSH 等上游持有事实；A²D² 读取或通过正式接口请求改变 |
| 保证强度 | **静态风险推导** | 从调用和锁顺序推导出的缺口；本轮未做故障或竞态复现 |

**阅读路线**：先读第 2 节统一语言，再沿第 3 节场景和 R 编号检查第 6 节责任表，最后评审第 4–5 节边界以及第 9 节建议。

## 2. 统一语言：复用基线，收窄歧义

词汇的权威定义继续放在 [CONTEXT][GLOSSARY]；下表是本稿使用口径及设计/实现对照，不取代原词汇表。

| 术语 | 本稿含义与身份 | 关系与关键区分 | 依据 / 当前落点 |
| --- | --- | --- | --- |
| 项目 Project | 一个代码仓库及其任务；业务定位使用仓库身份 | 不等同于 DSH workspace，也不能仅凭 Issue 数字跨仓库识别 | [CONTEXT][GLOSSARY]；当前本地记录按解析后的 `projectRoot` 分区 |
| 任务 Task | 需要达成的工作，承载目标和验收，以 tracker 的 Issue 为准 | 不是会话组；同仓库一个 Issue 对应一项任务。主会话变化不产生新任务 | [ADR 0003][A03]；[任务绑定][I-bind] |
| 子任务 Subtask | 任务分解后的另一项任务，也有自己的 Issue | 是业务父子关系；不由 DSH 是否存在 parent session 决定 | [ADR 0003][A03]、[ADR 0005][A05] |
| 工作流 Workflow | 任务推进的方法与阶段规则；当前使用 Matt | 方法可以替换，任务身份不依赖某套工作流 | [ADR 0001][A01]、[ADR 0006][A06] |
| 阶段 Stage | 工作流中的业务步骤，如 `grill`、`implement`、`code-review` | 不是会话编号；不能根据换代次数推断完成比例 | [CONTEXT][GLOSSARY]、[阶段策略][I-stage] |
| Agent | 全局定义的职责身份，加有序模型候选与配置；当前为 CEO、工程师、评审 | 不等于模型，也不等于 DSH 某个运行中的 Agent 句柄 | [ADR 0004][A04] |
| 模型候选 / 实际路由 | 候选是 Agent 配置；provider/model/effort 的实际选择是执行事实 | 配置变更不应被读成历史执行已换模型；可用性按调用场景判断 | [ADR 0004][A04]、[ADR 0009][A09] |
| CEO | 任务主会话的 Agent，负责需要 LF 参与的设计、派发、复核、推进和完成 | 负责业务判断；运行器不会替 CEO 判断成果已满足验收标准 | [CEO 职责][CEO] |
| 会话 Session | 某次执行的持久记录，由 DSH 管理身份与日志 | 一个会话按 A²D² 规则不在中途更换 Agent 身份；普通未绑定会话不自动受任务托管 | [ADR 0005][A05]、[会话 Agent 账本][I-session-agent] |
| 主会话 Main session | 已绑定任务当前的 CEO 执行入口，持有该任务协调权 | 唯一的是主控归属，不是“只能有一个执行者”；可以同时有多个子代理 | [任务绑定][I-bind]、[执行围栏][I-guard] |
| 子代理 Subagent | 由主会话委派、向其回传的执行会话 | 子任务可用子代理执行，也可另有独立 CEO 主会话；两者不能混为一类 | [派发][I-dispatch]、[开子任务][I-open] |
| 绑定 Binding | 将当前会话关联为本地任务记录的主会话 | 不创建 GitHub Issue、不验证 GitHub 父子树、不自动启动后台托管 | [任务绑定][I-bind] |
| 托管运行 Task runtime | LF 显式启用后，由插件管理接续、执行权、等待和恢复 | 与未托管会话的手动交接兼容；重复 start 不是 resume | [运行入口][I-runtime]、[启动与控制][I-start] |
| 主会话换代 Generation | 运行器完成一次交接提交的计数 | 代码初值 `0`；在交接 `deliver` 完成记录后加一。新 `current` 可能先于代次更新；不等于模型已处理完接续消息 | [运行记录][I-run-types]、[交接推进][I-rotate] |
| 交接 Handoff | 转移同一任务的主会话执行归属，携带接续材料 | 普通手动交接与托管交接入口不同；不是业务阶段完成事件 | [ADR 0011][A11]、[交接服务][I-handoff] |
| 任务事件 Task event | 发给任务地址、由有效主会话接收的消息 | GitHub watch / 子任务完成可进入收件箱；DSH 原生子代理结算仍有固定父会话 | [事件存储][I-inbox]、[宿主适配][I-host] |
| 接受 / 入队 / 消费 | 事件被持久接收、消息进入会话队列、消息进入模型请求日志是不同事实 | `notified_parent=true`、watch 注入成功、`Delivery.delivered` 不应都翻译成“模型已处理” | [完成通知][I-complete]、[投递回读][I-host] |
| 完成 Completion | 既有方法要求验收通过、同步/关闭 Issue，再声明本地完成 | 不把 `complete_task` 改名解释为“只交付、待验收”；实现没有替 CEO 校验前置验收事实 | [CEO 职责第 17 行][CEO-complete]、[完成服务][I-complete] |
| 进展 Progress | 业务进展由成果和验收判断；运行器另有重复内容指纹 | 内容变化只是防空转启发式，不能证明业务有效推进 | [ADR 0011][A11]、[进展读取][I-host-progress] |
| 查询投影 Projection | 面向 LF 的任务、会话、阶段和执行事实组合视图 | 不成为新任务真相源；当前面板并非跨项目完整 Issue 清单 | [面板路由][I-panel] |

### 2.1 当前代码里几个同名对象不能直接提升为领域模型

- [代码 `Task`][I-task-types] 有可选 `issue`，保留旧版未绑定会话分组；已绑定类型要求主会话。它是**本地执行关联文档**，不是 GitHub 业务任务的完整副本。
- `Task.state = active / paused / done`、`RunRecord.state` 的六种执行状态、GitHub Issue 的 open/closed、Matt 阶段是不同维度。它们不能无条件合成一个状态枚举。
- [运行记录][I-run-types] 的 `operation.step` 是交接技术步骤，不是 `Stage`。`generation` 从零开始，产品是否显示“第 1 代”可以做展示换算，但不能反向改业务含义。
- [派发实现][I-dispatch] 把目标 Issue 放进 label，并接受 CEO 提供的自包含 prompt，保存子会话 Agent 身份，却不自动为该 Issue 建主会话记录或成员关系。因此“任务树”和“委派树”的完整关联仍有数据契约缺口，不能由 UI 猜测 label 建权威关系。

## 3. 核心业务场景与流程

### 3.1 场景选择与主图

选择 S1–S5，是为了覆盖接入、执行分工、身份转移、异步恢复、完成闭环五个不同的责任边界；配置编辑、成本路由和 UI 美化暂不单列场景。

![图 1：核心业务场景流程](diagrams/a2d2-ddd-v1/01-business.svg)

[可交互查看 / 导出图 1](diagrams/a2d2-ddd-v1/01-business.html) · [可编辑图源](diagrams/a2d2-ddd-v1/01-business.workflow.json)

图中每行是一条代表路径，不要求一次任务依次经历所有行。失败、返工、等待可以反复发生；图的箭头不意味着跨系统事务，也不意味着每一项方法规则都由代码强制。

### 3.2 业务场景、命令、规则与结果总表

| 场景 | 参与者 / 业务触发 | 命令或动作 | 关键规则 | 可观察结果 / 数据流 |
| --- | --- | --- | --- | --- |
| S1 建立任务并选择是否托管 | LF 提出工作；CEO 已准备好任务记录 | `gh issue create` → `bind_main_session`；需要后台运行时 LF 发 `/task-runtime start` | R01 任务以 tracker 为准；R02 主会话绑定唯一；R03 显式启用 | Issue 持有目标；项目本地记录持有主会话；托管后另有运行记录。绑定成功不代表后台启动 |
| S2 分解任务并选择执行方式 | CEO 判断子任务是否仍需独立设计 | `dispatch_subagent({stage,issue,prompt})` 或 `open_subtask({issue})` | R04 两种执行方式；R05 阶段→Agent→模型；R06 只有主会话可操作 | 子代理有固定父会话；独立子任务有自己的 CEO 主会话。结果由父 CEO 复核 |
| S3 上下文或轮数触发主会话交接 | 托管主会话到安全边界；或显式请求交接 | 自动调度；`/task-runtime rotate [focus]`；模型 `task_runtime({action:"rotate"})` | R07 安全交接与执行围栏；R08 固定操作身份；R09 阶段与换代分离 | 本地任务指针转到后继，原会话退出有效执行；接续消息投递后完成运行记录提交 |
| S4 等待外部结果并在中断后接续 | 等 LF、子代理、子任务、PR 事件；宿主进程重启 | `task_runtime(wait-human/wait-event)`；外部事件；宿主自动扫描；必要时 LF `resume` / 特殊 `recover` | R10 等待原因分流；R11 接收/投递去重；R12 有边界的恢复 | 事件先成为持久记录；当前有效主会话恢复接收。受阻与不兼容恢复显式可见 |
| S5 验收通过后收口并通知父任务 | CEO 完成成果复核；验收已成立 | 同步结果 → `gh issue close` → `complete_task({summary})` | R13 业务完成顺序；R14 通知与本地完成的边界 | tracker 关闭、本地完成、父任务收到或排队收到通知是分开的事实；后续运行器停止续跑 |

### 3.3 S1：建立任务与显式后台托管

**前置条件**：在对应项目会话中，GitHub 仓库定位和账号已配置；托管还要求运行器 mount 开启、会话属于 DSH workspace。`issue-number` 是示例占位符，下面步骤本轮未实际执行。

**操作与命令**：

```text
CEO：gh issue create --title "任务标题" --body-file <规格文件>
CEO 模型工具：bind_main_session({issue: <Issue编号>, title: "任务标题"})
LF 在已绑定会话输入：/task-runtime start
只读查询：/task-runtime status
```

对子任务先通过 `open_subtask` 绑定父关系后，使用**无参数** `/task-runtime start`；带编号的 start 会再次尝试绑定，却没有父编号参数，可能与已保存父关系冲突。见 [运行命令][I-runtime]、[绑定检查][I-bind]。

**状态呈现**：未启动时 status 提示未启用；启动后可见 `state=running`、`current`、`workspace`、初始 `generation=0`。同一绑定重复调用不创建新任务；同一运行记录重复 start 不恢复 paused 状态，恢复使用 `/task-runtime resume`。

**数据走向**：CEO → GitHub Issue；当前调用会话 → 本地任务绑定；LF 显式 start → 运行器记录 → 后台驱动。GitHub 任务树与本地绑定不是一个事务。

**完成判据**：Issue 和绑定关系符合业务意图；托管场景中 status 能定位同一项目任务和有效主会话；绑定只代表关联，不暗示 GitHub 已被宿主验证。

**责任与缺口**：相同 Issue 的主会话检查在任务文件锁内；“一个会话至多绑定一个任务”依赖跨文件扫描，未形成跨任务锁。因此相同会话并发绑定不同 Issue 的全局唯一性是**静态风险**，不能将串行检查描述成强一致保证。[I-bind][I-store]

### 3.4 S2：两种子任务执行方式

**前置条件**：调用者是父任务主会话。CEO 先确保目标 Issue、父子关系、范围和标签符合 tracker 规则。

```text
可直接实施：dispatch_subagent({issue: <子Issue>, stage: "implement", prompt: "自包含实施要求"})
仍需独立设计：open_subtask({issue: <子Issue>})
```

| 分支 | 业务意图 | 当前实现的执行关系 | 后续结果处理 |
| --- | --- | --- | --- |
| 直接委派 | 范围足够明确，工程师或评审执行 | DSH parent-child 关系；记录子会话 Agent，目标 Issue 自动进入 label，自包含 prompt 由 CEO 提供；不自动建立该 Issue 的主会话绑定 | DSH 原生子代理结算回到原父会话，CEO 复核结果并更新 tracker |
| 独立子任务 | 子任务需要与 LF 继续设计 | 新建同 workspace 的根会话，继承 preset/权限，按设计阶段选择模型，绑定 child Issue 和 parent Issue | 子任务的 CEO 独立推进；验收完成后 `complete_task` 通知父任务 |

**状态呈现**：工具返回会话 ID、所选模型等信息；独立子任务在本地任务树中有主会话，直接委派的子 Issue 不因此出现在完整本地任务树里。新的独立主会话也不会自动成为后台托管任务。

**数据走向**：CEO 读取工作流规则并选择执行方式 → 对应工具入口校验身份、读取阶段 Agent 表并装配执行 → DSH 创建会话 / 子代理 → 会话身份和 tracker 时间线分别记录。

**完成判据**：目标 Issue 与执行方式相符，执行者身份正确，结果存在明确接收者；“工具成功创建会话”不等于任务实施成功。

**失败与并发边界**：dispatch 每次生成新 child ID，缺少调用级幂等键；身份记录先写，宿主启动失败可能留下无对应执行的身份。open_subtask 是查重→创建→选模型→绑定→首消息，多步骤不原子，重试不能一概视作安全重放。第一阶段将这些列为需后续时序审查的证据，不在本轮修改代码。[I-dispatch][I-open]

### 3.5 S3：主会话交接，任务与阶段保持身份

**前置条件**：任务已显式托管。运行器拥有记录，源会话达到安全空闲边界；原生子代理已结束且必要结算通知已进入父会话日志。

```text
LF：/task-runtime rotate <本次接续重点>
或模型工具：task_runtime({action: "rotate", progress: "接续重点"})
观察：/task-runtime status
```

自动交接使用 `rotateTokens` / `maxAutoTurns` 的运行配置，不把这些阈值解释为业务验收。默认值是配置事实，不是 DDD 业务常量。

**核心路径**：预存固定后继 ID与操作 → prepare → 请求源模型编写接续内容并确认消费 → 保存装配配置并创建/恢复后继 → take → 投递接续消息 → 更新完成代次。操作步骤由 [运行器][I-rotate] 持久化；主会话归属由 [交接服务][I-handoff] 更新。

**状态呈现**：运行状态仍使用既有六种枚举，“交接中”来自 `operation` 及任务 handoff 标记，不新增第七种运行状态。`take` 后任务指针可能已是新会话，而 `generation` 尚未加一；界面应基于操作事实解释过渡态，不能假设两者总在同一事务更新。

**数据走向**：运行记录 → 交接文档 / 源会话日志 → DSH 后继会话 → 本地任务指针 → 运行记录交接提交。后继复用固定身份，继承当前 workspace/preset/权限，不能任意创建未装配的执行实例。

**完成判据**：只有当前主会话可继续推进；接续消息已按持久消息身份入队或在日志可见；业务阶段保持原有意义。此判据不要求后继模型已经完成第一轮工作。

**必须保留的条件差异**：

- 原生未结算子代理是交接的硬阻挡。[I-host-children]
- 自动空闲路径在没有显式 decision 时，才额外检查活动独立子任务和 GitHub 等待；显式 continue 或 rotate 不等价于这个自动分支。[I-advance]
- 因而不能写成“只要任何子任务未完成，就禁止所有主会话交接”。这是 v2 原型需要修正的一项表达。

### 3.6 S4：等待、事件接收与中断恢复

**前置条件**：托管任务已有运行记录；GitHub watch 路径还需 provider/relay 可用且任务关联已登记。浏览器关闭不撤销托管记录。

| 输入 | 正常路径 | 当前可观察事实 | 特殊边界 |
| --- | --- | --- | --- |
| LF 问答 / 显式 wait-human | 记录等待意图，空闲检查后进入 waiting-human；新输入或问题已解除时允许恢复 | status 的 state；DSH 问题及消息日志 | 外部任务 inbox 在 waiting-human 暂缓，但 pre-step 放行逻辑不按全部消息来源证明“只有 LF 可唤醒” |
| 独立子任务完成 / GitHub 状态 | 按任务地址进入持久 inbox；解析当前主会话投递 | 待投递事件、消息 ID、target | 暂存接收、会话入队、模型消费不是同一阶段 |
| 原生子代理结算 | DSH 直接通知原父会话 | subagent catalog / settled 日志 | 不自动改送另一父会话；运行器通过阻挡交接保护这条路径 |
| 宿主进程重启 | 扫描已有运行记录、取得所有权、恢复既有会话与未完成操作 | current / operation / failures / error | 不扫描所有 Issue 并自动接管；完成任务不重新启动工作 |
| 执行受阻 | 报错并保留事实，部分失败触发重试上限 | blocked / error | `/task-runtime resume` 不是通用修复；不兼容旧后继用专门的 `/task-runtime recover` |

**数据走向**：外部事件 → 稳定事件 ID → 独立暂存 inbox → 运行记录 → DSH 队列/日志 → 当前主会话。进程恢复回读持久记录和 DSH 日志；不依赖网页是否在线。[I-inbox][I-host][I-watch]

**完成判据**：任务事件可追踪到当前接收者或明确的等待/失败状态；恢复沿同一操作身份推进，没有宣称外部副作用恰好执行一次。

**失败、超时、重试和恢复边界（先约束后续设计）**：

- 稳定事件/消息 ID 和日志回读用于重试去重；不是跨文件、会话日志、GitHub 的分布式事务。
- `maxFailures` 覆盖部分 advance 异常和失败轮次；所有权获取、运行记录锁、inbox 导入的失败不全部进入同一计数。不能统一写“所有故障最多重试三次”。
- 运行器没有统一的交接或等待截止时间。GitHub watch 首答等待与网络重连、文件锁等待各有机制，不能合称业务执行超时。
- 运行记录锁可覆盖一次慢 advance；独立 inbox 短锁使事件接收与慢创建/投递隔离。ADR 中笼统的“短写锁”应修正文义。
- 同机/PID 命名空间文件锁不支持多机共享执行目录；已有 ADR 不承诺断电 fsync 或绝对一次。

### 3.7 S5：验收与完成，不重新发明三个审批步骤

**前置条件**：CEO 已核对成果、相关子任务及验收证据，实际满足任务标准；关闭权限仍受 LF 授权与 SOUL 约束。

```text
CEO：同步验收结论和最终证据到任务 Issue
CEO：gh issue close <编号> --comment <最终结论>
CEO 模型工具：complete_task({summary: "供父任务使用的完成说明"})
```

上面是 [CEO 既有职责][CEO-complete] 的顺序，不是插件保证 GitHub 已关闭，也不是要求 LF 手工点三次。

**状态呈现与数据走向**：GitHub 记录业务结果；本地任务记录变 done；继续进入 advance 的运行器观察本地 done 后会同步为 done；已经 paused/blocked 的运行记录可能暂保留原运行态，但本地 done 仍通过执行围栏阻止模型继续推进。有父任务时，按具体路径尝试通知其主会话。工具返回的通知字段必须按具体路径解释：

- 父任务有运行记录：先将 `child-complete:<task.id>` 事件入父 inbox，再提交子任务 done；`notified_parent=true` 可能仅表示持久入队，父任务暂停时不会立即投递。
- 无可用父运行路径：先写子任务 done，再尝试恢复父会话并 followup；通知失败可能留下“任务已完成，但父尚未收到”的状态，重复调用可能再次通知。该回退分支只在读取时解析父主会话，等待 resume 后未再次检查父指针；父任务在此期间交接时，通知可能仍进入旧会话。这是静态接收者漂移风险，不能宣称所有路径都保证送达接任者。
- 父 inbox 与子任务 done 是不同提交边界。先入队不等于业务完成事实已经在两个位置原子生效；如果后续写 done 或主会话复查失败，需要明确恢复策略。[I-complete]

**完成判据**：验收事实与 tracker 收口成立，本地执行状态与其一致；父结果接收可查，失败不被返回字段掩盖。不把 child turn end 或模型的一句“完成了”作为验收事实。

**本轮纠偏**：v2 原型的“执行交付→待验收→验收通过→关闭 Issue”只能视为额外展示提议，不能改变 `complete_task` 的既有完成语义。是否需要独立“成果待验收”模型留待确认，不能先加到运行器 done 枚举里。

## 4. 子域全景：按业务能力分类

### 4.1 主图

![图 2：子域全景与分类](diagrams/a2d2-ddd-v1/02-subdomains.svg)

[可交互查看 / 导出图 2](diagrams/a2d2-ddd-v1/02-subdomains.html) · [可编辑图源](diagrams/a2d2-ddd-v1/02-subdomains.architecture.json)

### 4.2 子域职责、分类与依据

分类是本轮架构提议；概念内容复用既有规则。分类判据是对 A²D² 业务价值的差异化程度、规则独特性及外部可复用程度，不是代码量。

| 子域 | 职责与不负责的事 | 分类 | 分类依据 | 当前设计/实现对应 |
| --- | --- | --- | --- | --- |
| D1 任务推进与协作 | 把工作意图落实为任务，决定阶段推进、分解、委派、复核、返工和完成；不自建 GitHub 替代品 | 核心 | LF 要降低的主要管理成本在这里；只有会话工具不足以满足业务 | [CEO 职责][CEO]、[唤醒清单][WAKE]、[ADR 0003][A03]、[ADR 0005][A05]；部分由模型执行，部分由工具校验 |
| D2 跨会话连续执行 | 保持有效主控、交接、等待、消息归属和恢复；不判定业务验收 | 核心 | 目标需跨上下文与进程中断存续；是 A²D² 相对普通聊天的关键能力 | [ADR 0011][A11]、[运行器][I-start]、[交接服务][I-handoff] |
| D3 Agent 策略与装配 | 阶段→Agent→模型候选，两级指令配置及会话身份；不承担业务进度 | 支撑 | 为核心协作提供一致执行身份；组合策略有业务含义，但不是任务推进本身 | [ADR 0004][A04]、[阶段配置][I-stage]、[身份账本][I-session-agent] |
| D4 观察与人机介入 | 展示任务和执行事实、提问、通知、入口导航；不私自修改任务事实源 | 支撑 | 帮助 LF 理解并介入核心流程；多数是查询/应用交互，不必单独建领域上下文 | [面板][I-panel]、[咨询 ADR][A08]、[通知 ADR][A10]；跨项目整页仍为设计 |
| D5 工作项跟踪 | Issue、父子关系、PR、验收证据、业务时间线 | 通用（外部供给） | 复用 GitHub 成熟能力；A²D² 只定义使用语义，不复制存储 | [ADR 0003][A03]；CEO 通过 gh 读写，插件监听部分外部状态 |
| D6 通用执行底座 | 会话、模型调用、工具、权限、workspace、原生委派及消息日志 | 通用（外部供给） | 由 DSH 提供，A²D² 不应另造 AgentLoop 或直接篡改宿主持久文件 | [宿主适配][I-host]、[根会话装配][I-root] |

### 4.3 为什么不直接拆成六个服务

子域是问题空间；上下文是模型适用范围；进程与包是部署和代码组织。三者没有一一对应关系。

D1 的主会话归属与 D2 的执行围栏高度耦合，当前还需对同一个 task/main 指针做联合判断。本轮将它们放在同一候选上下文内部，以应用服务/长流程区分职责，避免为了形式拆出循环依赖。D4 暂是查询和交互投影；没有证据表明它需要独立的任务写模型。D5、D6 则必须承认外部身份、API 和生命周期语义，不能视作本地实体的内部字段。

## 5. 限界上下文：候选内部边界与外部契约

### 5.1 主图及方向约定

![图 3：限界上下文映射](diagrams/a2d2-ddd-v1/03-contexts.svg)

[可交互查看 / 导出图 3](diagrams/a2d2-ddd-v1/03-contexts.html) · [可编辑图源](diagrams/a2d2-ddd-v1/03-contexts.architecture.json)

箭头表示调用或事实传递方向，**不自动代表 DDD 上下游角色**；上游/下游与翻译责任见 C 表。BC-O、BC-P 是本轮候选语义边界：当前仓库仍按单一 context 文档组织，不声称已经实现两个独立服务或独立数据库。

### 5.2 上下文职责、模型所有权与边界理由

| 上下文 / 投影 | 拥有的语义与事实 | 不拥有的内容 | 为什么这样划分 | 现状与拟落点 |
| --- | --- | --- | --- | --- |
| **BC-O 任务编排与连续执行** | 本地任务绑定、主会话归属、委派关系、托管运行、交接操作、任务事件投递；解释业务规则并调用外部能力 | GitHub 的原始 Issue 生命周期；DSH 的会话实现和工具执行；Agent 配置定义的任意更改 | 任务主控归属与执行围栏必须协同；D1/D2 暂不拆上下文，可在内部区分业务应用服务和恢复过程管理 | **拟调整**为清晰模块边界；现有 [任务服务][I-bind]、[运行器][I-start]、[事件存储][I-inbox] 已提供大量机制 |
| **BC-P Agent 策略** | 阶段→Agent 表、Agent 候选与 effort、全局/项目指令规则、配置校验 | 某任务当前处于什么阶段；本次会话实际运行了哪个 provider；任务是否验收 | 配置生命周期、约束与消费者不同；可以给编排提供可校验快照，避免“阶段模型”和“角色配置”成为两套真相 | **拟调整**为独立语义模块；[阶段配置][I-stage]和[配置路由][I-config]已有，现为同进程直接读取 |
| **BC-T 工作项跟踪（外部）** | GitHub Issue / PR 的身份、状态、业务时间线、关联与证据链接 | 本地哪个会话正在运行、某个事件是否进入模型请求 | 外部服务拥有原始工作项事实；本地只保留引用和执行关联，避免第二个 tracker | **已实现**外部依赖；工作规则由 CEO 使用 gh 落实；写入并非插件统一事务 |
| **BC-H 会话执行（外部）** | DSH Session、AgentLoop、模型/工具调用、权限、workspace、原生子代理结算 | Issue 的验收含义、业务阶段是否完成、任务当前工作目标 | DSH 的 Agent/Session 与 A²D² Agent/Task 不同；需要窄适配面翻译身份和错误 | **已实现**公开 API 适配；[RuntimeHost][I-host]、[root-session][I-root]及派发接口兼容 |
| **查询与交互投影（暂非独立 BC）** | 组合本地事实以供显示；提交显式动作到拥有规则的上下文 | 不持有独立任务完成真相，不从模型回复猜测权威状态 | 缺少独立写规则和语言边界，当前按应用读模型更合适 | **已实现**会话侧栏/配置页；**已有设计但未实现**跨项目任务整页 |

**Agent 会话身份放在哪里？** BC-P 定义可选身份及配置；BC-O 在创建/派发时选定，并记录会话承担的身份，BC-H 持有实际执行实例。当前 [SessionAgentStore][I-session-agent] 只记录 sessionId/agent，不能将它误用成业务任务归属表。

### 5.3 上下文协作关系表

| 编号 | 提供方 → 使用方；关系判定 | 交互契约 / 时点 | 翻译与保护责任 | 当前实现与限制 |
| --- | --- | --- | --- | --- |
| C1 | BC-T 上游 → BC-O 下游；客户端遵循外部工作项接口，业务语义由方法层解释 | CEO 按项目上下文 gh 读取、建 Issue、更新现状、关闭 Issue | 解释项目/Issue 身份和验收证据；不要把仓库内数字 ID 当全局身份 | [CEO][CEO]、[tracker 指引][TRACKER]；尚非统一插件防腐层，当前 bind 不验证外部存在性 |
| C2 | BC-T 状态源 → BC-O 事件消费者；适配/防腐层 | GitHub watch relay 状态 → 稳定任务事件 → 当前主会话 | 由 watcher 比较外部状态、生成事件身份，runtime 接受任务地址而不是永久绑定旧会话 | [watch 适配][I-watch]、[watcher][I-watcher]；未托管回退路径不具同等持久消息去重 |
| C3 | BC-P 供给策略 → BC-O 消费者；候选内部客户/供应者关系 | 创建/派发时读取阶段 Agent 与候选；请求前装配指令 | 校验候选、effort 和角色；实际路由属于执行事实；相同配置用于派发和芯片 | [阶段表][I-stage]、[派发][I-dispatch]；当前直接调用，不宣称已有隔离接口或共享内核 |
| C4 | BC-H 上游能力 → BC-O 调用方；公开 API + 适配/防腐层 | 创建/恢复根会话、派子代理、读取投影、flush、followup | 固定身份、继承 workspace/preset/权限，处理版本 API 差异；不直接改私有 registry | [宿主适配][I-host]、[根会话][I-root]；`open_subtask` 仍要求对应宿主具备本地模型选择能力 |
| C5 | BC-H 事实/结算 → BC-O 观察者 | 原生子代理结束、问题状态、turn end、消息消费日志 | 明确结束/结算/入队/消费差异；原生回传绑定父会话，不能假装已被任务 inbox 接管 | [子代理检查][I-host-children]、[执行围栏][I-guard] |
| C6 | BC-O / BC-P → 查询交互投影；只读发布与受控命令 | 当前项目任务视图、运行 status、配置页；未来全局整页 | 图与状态只组合权威事实；写动作回到规则拥有者；通知正文与投递渠道分开 | [面板][I-panel]、[前端注册][I-client]、[通知 ADR][A10]；当前无全局任务查询契约 |

### 5.4 信息权威与跨边界不一致

| 信息 | 权威来源 | 本地副本 / 读模型用途 | 不一致时的处理原则 |
| --- | --- | --- | --- |
| 目标、规格、验收与业务阶段记录 | tracker，由 CEO 按规则维护 | 查询可引用；咨询的阶段预测仅是建议 | 不从会话代次覆盖 Issue 阶段；不能只凭自动运行状态判验收 |
| 当前主会话归属 | 项目本地任务绑定 | tracker 现状里可写入指针便于人查 | Issue 中指针可能滞后；执行授权按本地 binding 与 runtime 联合检查 |
| 托管执行状态与交接步骤 | RuntimeStore | status / 未来页面 | 与任务指针的预期后继不一致时进入错误/恢复路径，不盲目另建主会话 |
| 会话日志、实际运行路由、工具结果 | DSH | 面板与恢复回读 | “配置候选”不能覆盖历史实际路由；宿主日志是消费证据之一 |
| Agent 定义和候选 | 插件配置与两级指令来源 | 装配和展示 | 一次读取/装配按既定规则；候选缺失或不可验证时显式失败 |
| 任务事件的接收与投递进展 | 任务 inbox / runtime 记录；DSH 队列与日志 | UI 可显示接受、排队、消费 | 不把布尔 notified/delivered 统一显示为“处理完成” |

当前运行记录使用项目根路径加本地 task ID 定位，而业务任务以仓库 Issue 定位。多 worktree、项目根解析和仓库映射如何形成稳定任务地址，需要后续一致性分析；本轮不静默把路径身份替换成远程仓库身份。

## 6. 关键规则由谁、何时保证

| 规则 | 业务含义 | 拥有者 / 保证主体 | 生效或检查时点 | 强度与当前证据 |
| --- | --- | --- | --- | --- |
| R01 | 一项任务以 tracker Issue 承载目标与验收 | BC-T 持事实；CEO 维护业务语义 | 建任务、推进、验收、交接前同步 | **方法规则**；[ADR 0003][A03]、[CEO][CEO]；bind 不校验远程 Issue |
| R02 | 同一已绑定任务只有一个主会话；替换通过交接 | BC-O 任务绑定服务 | bind 锁内检查；take 锁内转移 | **技术约束（局部）**；[I-bind]、[I-handoff]；反向“一会话一任务”的跨文件竞态待补 |
| R03 | 后台托管须显式 start，绑定不等于授权无限续跑 | LF 命令入口 + BC-O 运行器 | start；后续 pre-step | **技术约束**；[I-runtime]、[I-start]；子任务根会话不自动托管 |
| R04 | 子任务按是否需要独立设计选择执行方式 | CEO | 分解和委派前 | **方法规则 + 两个技术入口**；[ADR 0005][A05]、[I-open]、[I-dispatch] |
| R05 | 阶段→Agent→模型候选是一条配置链 | BC-P；BC-O 装配消费者 | 配置写入校验；创建/派发及请求前装配 | **技术约束 + 方法语义**；[I-stage]、[I-config]、[I-session-agent] |
| R06 | 只有任务主会话可派发、开子任务、声明完成 | BC-O 服务；托管执行围栏 | 工具服务检查及 pre-step | **技术约束但非所有跨存储操作的单一事务**；[I-dispatch]、[I-open]、[I-complete]、[I-guard] |
| R07 | 托管交接等待安全边界；旧主会话失去执行资格 | BC-O 运行器 + BC-H maintenance/日志 | 交接前、take 后、每次 pre-step | **技术约束**；[I-rotate]、[I-host-children]、[I-guard]；不承诺中途强杀已运行工具 |
| R08 | 同一次交接恢复复用既定操作/后继身份 | BC-O 运行记录 | 外部创建前保存，恢复时回读 | **技术约束**；[I-start]、[I-rotate]；特殊 recover 可以创建受控替代后继，不能泛化到 dispatch/open 的重试 |
| R09 | 会话换代不自动代表业务阶段完成 | CEO 判断业务；运行器只记执行代次 | 阶段裁决 / 完成交接提交分别发生 | **领域规则；当前字段已分离**；[CONTEXT][GLOSSARY]、[I-run-types]；原型用语需跟进 |
| R10 | 等人、等执行结果、暂停、受阻各有原因 | BC-O + BC-H 事实读取 | 每轮后空闲判断、pre-step、新事件 | **技术约束（有分支条件）**；[I-advance]、[I-guard]；显式 decision 可能改变默认等待判据 |
| R11 | 持久接收、投递、消费须可区分并支持重试去重 | BC-O inbox + BC-H 队列/日志 | 入队、导入、固定 target、投递前后 | **技术约束但不跨存储原子**；[I-inbox]、[I-host]；未托管回退能力较弱 |
| R12 | 恢复沿既有事实推进，失败可见 | BC-O 过程管理器 | 启动扫描、周期 recover、失败 turn 处理 | **部分有界重试**；[I-start]、[I-advance]；无统一 deadline，非所有错误计入同一上限 |
| R13 | 验收通过、同步并关 Issue 后再 complete_task | CEO；验收标准来自任务 | complete_task 调用前 | **方法规则**；[CEO-complete]、[WAKE]；插件不查 GitHub / 验收 / 全部子任务状态 |
| R14 | 子任务完成需通知父任务有效主会话 | BC-O completion；BC-H 或任务 inbox 投递 | 完成过程中 | **业务要求 + 非原子技术机制**；[I-complete]；任务地址入队与直接通知路径不同，后者在父交接期间还可能使用已过期接收者 |

## 7. 核心对象候选：先明确职责，不提前指定聚合

本节只给后续聚合设计提供对象清单。**本轮不把一个 TypeScript interface、一份文件或整个任务树直接认定为聚合。**

| 对象或关系 | 业务职责 / 标识 | 当前承载 | 下一阶段需证明的一致性边界 |
| --- | --- | --- | --- |
| 业务任务 / 子任务关系 | 目标、验收、分解；仓库 Issue 身份 | GitHub + CEO 方法 | 与本地关联记录的引用契约、完成与返工语义 |
| 任务执行关联 | 主会话、成员、交接边、父引用；projectRoot + issue-N | [Task / BoundTask][I-task-types] | 同任务唯一主控及跨任务反向唯一性是否同一聚合/索引 |
| 托管运行记录 | 当前执行、等待、故障计数、operation；TaskAddress | [RunRecord][I-run-types] | 与任务指针分两次提交时的合法中间态；是否作为过程管理器持久状态 |
| 交接操作 | source、固定 successor、step、profile、接续消息 | [Rotation][I-run-types]及交接文档 | 恢复点、替代后继、旧主会话围栏、不可回滚副作用 |
| 委派关系 | 父会话、目标任务、阶段、子会话及结果 | DSH 委派 + label/prompt + CEO timeline | 是否补持久任务→执行关系；派发幂等与失败补偿 |
| Agent 定义 / 会话身份 | 策略配置与实际会话身份分离 | 阶段配置 / 身份账本 / 绑定推导 CEO | 配置版本、创建失败记录、历史身份不变式 |
| 任务事件与投递记录 | 稳定事件身份、消息 ID、target、投递进展 | [Delivery / inbox][I-run-types]、[RuntimeStore][I-inbox] | 同步/异步提交顺序、重复事件、完成事件先于 done 的窗口 |

**聚合划分的评审方法（尚未形成结论）**：先从 R02、R07、R08、R11、R14 中找必须一次提交成立的不变量，再画聚合；跨 GitHub、DSH 与本地文件的步骤按长流程和补偿/恢复分析，不能用“大 Task 聚合”宣称覆盖所有外部事务。

## 8. 领域到现有设计/实现的初步映射

本表用于第一阶段边界评审；最终的“对象→聚合→命令/事件→持久化→入口/测试”完整映射在第二阶段补充。状态与保证强度分别表达。

| 领域能力或提议 | 状态 | 当前落点 / 依据 | 限制或需要的变化 |
| --- | --- | --- | --- |
| 目标层 / 执行层、任务以 Issue 为准 | 已实现 | [ADR 0002][A02]、[ADR 0003][A03]、[CEO 指令][CEO]和任务工具 | 包含方法规则；不是所有任务都有本地主会话文档 |
| 绑定主会话及同任务排他 | 已实现 | [bindMainSession][I-bind]、[TaskDocumentStore][I-store] | 单任务锁；跨任务反向唯一性仍有静态竞态风险 |
| 阶段 Agent 表与会话身份 | 已实现 | [stage-agents][I-stage]、[session-agents][I-session-agent]、[配置路由][I-config] | Agent 全局定义；运行事实与候选分开 |
| 派子代理与独立子任务入口 | 已实现 | [dispatchSubagent][I-dispatch]、[openSubtask][I-open] | 不等于端到端幂等派发；未自动建立所有目标 Issue 的执行关联 |
| 显式托管与运行状态 | 已实现 | [task-runtime][I-runtime]、[TaskRunner][I-start] | 默认关闭；start/resume不同；不因 bind 自动接管 |
| 持久交接、后继装配与围栏 | 已实现 | [运行器交接][I-rotate]、[root-session][I-root]、[allowed][I-guard] | 本轮静态核对；不能将历史构建实跑结果归于当前提交 |
| 任务事件收件箱与恢复 | 已实现 | [RuntimeStore][I-inbox]、[RuntimeHost][I-host]、[watch][I-watch] | 不提供跨存储绝对一次；原生 settlement 不改道 |
| complete_task本地完成与父通知 | 已实现 | [完成服务][I-complete]、[CEO 顺序][CEO-complete] | 方法保证验收；工具不查远端关闭；两条通知路径能力不同 |
| 当前项目会话侧栏与配置页 | 已实现 | [面板路由][I-panel]、[前端注册][I-client] | 当前面板按活跃会话解析项目，不是全局 Issue 查询 |
| 左上方跨项目任务整页、CEO计划 | 已有设计但未实现 | [Issue #70 范围外说明][Q70]、旧任务视图原型 | 先对齐统一语言及数据来源，不能直接把本地 Task 列表当全量任务 |
| BC-O / BC-P 内部语义分界 | 拟调整 | 本稿第 4–5 节；依托既有模块 | 不默认拆服务/数据库；需要评审消费者和配置边界 |
| “阶段 / 站 / 代次”、事件送达与完成文案 | 拟调整 | [Issue #70][Q70]、[运行计数][I-rotate]、[完成返回][I-complete] | 修正文案和文档；不能用展示名偷偷改变工具契约 |
| 跨任务唯一性、派发幂等、完成通知提交窗口 | 拟调整 | [I-bind]、[I-open]、[I-dispatch]、[I-complete] | 是后续一致性设计输入；本轮未复现故障，不声称已修复 |
| 独立“待验收”状态、历史消息重定向、撤回交接 | 待确认 | v2 原型探索；既有 [CEO][CEO]、[运行器 ADR][A11] 不等价支持 | 不把原型当现有契约；先明确业务需要、权限和恢复语义 |
| 多 worktree 下稳定项目/任务寻址 | 待确认 | 本地 projectRoot + issue-N；业务仓库 Issue 身份 | 第一阶段确认边界需求；第二阶段核查解析与重命名/迁移一致性 |

## 9. 建议保留、建议调整和待确认

### 9.1 建议保留：已有共识不重新发明

| 编号 | 保留项 | 理由 | 影响 |
| --- | --- | --- | --- |
| K1 | 目标层 / 执行层的寿命划分 | 已由 ADR 给出，能解释换代不改变任务 | 图、词汇、实现映射沿用，不新增同义“目标”实体 |
| K2 | tracker 为业务事实源，插件记录执行关联 | 避免第二个 tracker 和双写验收真相 | 全局页面应聚合事实，而不是扩充本地 Task 复制业务全部字段 |
| K3 | CEO、工程师、评审及两种子任务执行方式 | 已有完整规则与对应工具入口 | 区分任务树、会话交接链、委派树，保留不同返回路径 |
| K4 | 显式启用后台托管 | 避免普通绑定被意外接管；已有技术入口 | UI 展示“已绑定但未托管”应是合法状态 |
| K5 | 验收→同步/关闭 Issue→complete_task | 既有职责明确，保持完成语义 | 不默认引入三个人工闸门；不把执行器停止当验收 |

### 9.2 建议调整：先记录差异，评审后修订原真源

| 编号 | 调整项 | 依据与理由 | 影响 / 本轮处理 |
| --- | --- | --- | --- |
| J1 | 文档区分未托管的事件推进与托管后的自动续跑 | [ADR 0005][A05]的“只靠事件”与 [ADR 0011][A11]新增后台接续适用范围不同 | 需同步词汇/CEO唤醒说明；不删除合法等待，不另造一份工作流规则 |
| J2 | 修正“所有子任务必有主会话”的笼统表达 | [派发][I-dispatch]不绑定目标子Issue；[开子任务][I-open]才建立独立主会话 | 明确规则适用集合，为任务页的数据完整性提供依据 |
| J3 | 修正旧稿与 v2 原型的阶段、完成、交接阻挡表达 | 代次不是阶段；complete不代表待验收；独立子任务与原生子代理的交接规则不同 | 原型需在评审后跟随领域规则，不倒推代码应该支持按钮 |
| J4 | 规范事件接受/入队/消费的对外语义 | 返回字段有重载；runtime和非runtime分支能力不同 | 后续 API/页面兼容设计；不能仅改一个布尔变量名就宣称交付保证增强 |
| J5 | 更精确记录锁、重试和超时范围 | record锁覆盖慢advance；maxFailures不覆盖全部I/O；无统一deadline | 修订过强的文档保证，并将缺口带入后续时序评审 |
| J6 | 优先分析派发/开子任务幂等、反向绑定唯一性和完成通知提交窗口 | S1/S2/S5跨多文件与外部系统，不是单个聚合自然解决 | 第二阶段明确幂等键、校验时点、补偿/恢复方案与验证场景；本轮不改实现 |

### 9.3 本轮需要评审的边界问题

| 编号 | 待确认项 | 本稿建议 | 选择的主要影响 |
| --- | --- | --- | --- |
| B1 | 是否接受 D1+D2 放在 BC-O，Agent策略单列 BC-P 的语义边界？ | 接受候选边界；保持同一插件部署，不急于物理拆分 | 后续聚合和应用服务划分，以此限制规则散落 |
| B2 | 是否继续明确 tracker 是业务任务事实源，插件仅有执行关联与查询投影？ | 保留既有共识；全局视图需要新的查询组合契约 | 避免把本地已绑定任务误当全部任务；需补委派与Issue映射 |
| B3 | “尚未托管 / 托管中 / 已停止”能否与“阶段 / 业务完成”独立表达？ | 独立表达，保留既有完成规则；暂不新增待验收审批模型 | 页面与状态图可真实展示等待和同步差异，不强制用户多确认 |
| B4 | 历史会话补充消息、一键撤回交接是否属于本轮核心模型必要能力？ | 暂列后续交互提议；先稳定当前主控与消息归属规则 | 若纳入，将显著增加执行权回转、并发副作用和消息重定向设计 |

## 10. 第一阶段如何评审与验证

### 10.1 沿场景检查，不以图的数量判断完成

| 检查路线 | 评审要点 | 当前材料 |
| --- | --- | --- |
| S1 → R01/R02/R03 → C1/C4 | 创建业务任务、绑定和启用是否区分？外部存在性由谁核实？ | 场景命令、技术/方法责任、边界表 |
| S2 → R04/R05/R06 → C3/C4/C5 | 子任务与子代理的身份和回传路径是否明确？ | 两分支表、词汇、委派缺口 |
| S3 → R07/R08/R09 → BC-O/BC-H | 执行权何时转移？为什么阶段不跟代次改变？ | 交接路径、过渡态说明、源码落点 |
| S4 → R10/R11/R12 → C2/C5 | 哪些事件跟任务走、哪些绑定父会话？恢复保证到哪一步？ | 输入分类表、超时/重试边界 |
| S5 → R13/R14 → C1/C6 | 验收事实由谁保证？close/local done/通知失败如何区分？ | 既有完成顺序、两条通知路径和静态风险 |

### 10.2 本轮实际执行的核对

- 读取并对照既有 CONTEXT、ADR、CEO 职责/唤醒清单、Issue #41/#70 的原始讨论和任务运行器规格。
- 锁定 `6c9ccb6`，逐场景静态核对入口、条件、持久化顺序和事件路径；两条独立只读核查分别覆盖 S1/S2/S5 与 S3/S4。
- 未启动真实任务、未派生产子代理、未重启服务、未重跑产品测试；未把过去 654/665 项测试或其他构建的历史验收混称本次实测。
- 图源经过 schema / 布局检查，并检查生成图中的引用与可读性。图与正文都以 S/R/C/D/BC 编号关联。

## 11. 评审后的第二阶段范围（本轮未定稿）

| 产物 | 需要解决的具体问题 | 对应场景 / 规则 |
| --- | --- | --- |
| **第 4 类主图：核心领域模型与聚合图** + 对象/业务规则/一致性表 | TaskReference、本地任务关联、运行记录、交接操作、委派与投递记录之间哪些是聚合、哪些是过程状态或值对象；聚合为何这样分 | S1–S5；R02/R06/R08/R11/R14 |
| **状态图与状态转换表** | 区分任务业务完成、本地 task state、runtime 六态及交接五步骤；命令、前置条件、退出动作、禁止转换、重开范围 | S1/S3/S4/S5 |
| **交接关键时序图** | prepare/write/create/take/deliver 的持久点，task指针与runtime不一致窗口，固定后继、权限继承、失败恢复 | S3；R07/R08/R09 |
| **跨边界委派与完成时序图** | dispatch/open的超时和重复调用、身份孤儿、首消息丢失；GitHub关闭→父入队→child done→父消费之间的顺序 | S2/S5；R04/R06/R13/R14 |
| **事件与重启恢复时序图** | 事件进入独立inbox、导入运行记录、投递队列、消费日志；锁冲突、超时、退避、幂等与人工恢复边界 | S4；R10/R11/R12 |
| **完整领域到实现映射** | 从对象/聚合/命令/事件/规则逐项到模块、存储、公开API、查询模型、测试证据与迁移建议；四类状态明确列示 | 全部 |

此阶段应在 B1–B4 评审反馈后推进。不能因为已画出候选 BC，就自动将其变成既定聚合、数据库事务或微服务。

## 附录 A. 图源与重建

本包三张主图均提供 **JSON 可编辑源、独立 HTML 查看/导出页、SVG 静态图**。JSON 是编辑真源，HTML/SVG 是生成物；无需修改产品代码即可改图。HTML 自带明暗主题与导出菜单，离线可查看，字体不可用时回退系统字体。

- [图 1 JSON](diagrams/a2d2-ddd-v1/01-business.workflow.json) · [HTML](diagrams/a2d2-ddd-v1/01-business.html) · [SVG](diagrams/a2d2-ddd-v1/01-business.svg)
- [图 2 JSON](diagrams/a2d2-ddd-v1/02-subdomains.architecture.json) · [HTML](diagrams/a2d2-ddd-v1/02-subdomains.html) · [SVG](diagrams/a2d2-ddd-v1/02-subdomains.svg)
- [图 3 JSON](diagrams/a2d2-ddd-v1/03-contexts.architecture.json) · [HTML](diagrams/a2d2-ddd-v1/03-contexts.html) · [SVG](diagrams/a2d2-ddd-v1/03-contexts.svg)

重建 HTML 示例（需已有 Archify renderer；不是产品服务启动命令）：

```sh
node /root/.agents/skills/archify/bin/archify.mjs render workflow \
  docs/architecture/diagrams/a2d2-ddd-v1/01-business.workflow.json \
  docs/architecture/diagrams/a2d2-ddd-v1/01-business.html
node /root/.agents/skills/archify/bin/archify.mjs check \
  docs/architecture/diagrams/a2d2-ddd-v1/01-business.html
```

另外两图把模式改为 `architecture`。SVG 可从对应 HTML 的导出菜单重新导出。编辑后必须同步静态图，避免正文展示与图源不一致。

## 附录 B. 证据索引

下列 GitHub 源码及 ADR 链接固定到 `6c9ccb6`，防止分支移动造成证据含义变化。Issue 链接用于历史决策溯源；其中旧术语以明确的后续 ADR 为准。源码行锚点提供定位，不把单行视为完整行为证明。

| 证据 | 用途 |
| --- | --- |
| [CONTEXT][GLOSSARY]、[ADR 0001][A01]、[ADR 0002][A02] | 业务动机、统一语言与目标/执行层 |
| [ADR 0003][A03]、[ADR 0004][A04]、[ADR 0005][A05] | 任务事实源、Agent、执行方式 |
| [ADR 0006][A06]、[ADR 0007][A07]、[ADR 0008][A08]、[ADR 0009][A09] | 知识归属、人机动作、咨询和配置 |
| [ADR 0010][A10]、[ADR 0011][A11] | 通知与后台运行扩展 |
| [CEO 职责][CEO]、[WAKE][WAKE]、[tracker指引][TRACKER] | 模型需遵循的方法规则与完成顺序 |
| [Issue #41][Q41]、[确认评论][Q41-confirm]、[Issue #70][Q70] | 领域共识确认、阶段Agent演进、旧原型未实施及术语冲突记录 |
| [一期规格][SPEC-runtime] | 明确本期范围、独立环境与未包含的新UI |
| [任务类型][I-task-types]、[运行类型][I-run-types] | 本地对象不等同完整业务任务；状态维度区别 |
| [任务绑定][I-bind]、[任务文件锁][I-store]、[派发][I-dispatch]、[开子任务][I-open] | S1/S2 及并发/幂等边界 |
| [完成服务][I-complete]、[交接服务][I-handoff] | S3/S5 主指针及通知顺序 |
| [运行入口][I-runtime]、[控制/恢复][I-start]、[推进][I-advance]、[交接][I-rotate]、[围栏][I-guard] | S1/S3/S4 执行流程与保证范围 |
| [事件存储][I-inbox]、[宿主适配][I-host]、[子代理结算检查][I-host-children]、[进展启发式][I-host-progress] | 投递、去重、消费与原生回传 |
| [watch适配][I-watch]、[watcher][I-watcher] | 外部事件到任务地址的转换 |
| [阶段表][I-stage]、[身份账本][I-session-agent]、[配置路由][I-config]、[根会话][I-root] | 策略与执行装配 |
| [面板][I-panel]、[前端注册][I-client] | 已有会话侧栏与配置页；没有完整任务整页实现 |

[GLOSSARY]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/CONTEXT.md
[A01]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/docs/adr/0001-a2d2-plugin-is-the-single-carrier-on-dsh.md
[A02]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/docs/adr/0002-goal-layer-and-execution-layer.md
[A03]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/docs/adr/0003-tasks-live-in-the-tracker.md
[A04]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/docs/adr/0004-agent-is-models-plus-two-level-configuration.md
[A05]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/docs/adr/0005-a-stages-agent-decides-where-it-runs.md
[A06]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/docs/adr/0006-each-piece-of-knowledge-lives-in-one-place.md
[A07]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/docs/adr/0007-humans-decide-the-machine-prepares.md
[A08]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/docs/adr/0008-next-step-consult-is-an-out-of-history-generation.md
[A09]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/docs/adr/0009-a2d2-settings-live-in-a-settings-namespace-with-own-page.md
[A10]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/docs/adr/0010-a2d2-decides-when-lf-is-needed-a-notifier-delivers.md
[A11]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/docs/adr/0011-explicit-task-runtime-owns-execution-and-recovery.md
[CEO]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/ceo/AGENTS.md
[CEO-complete]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/ceo/AGENTS.md#L17
[WAKE]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/ceo/WAKE.md
[TRACKER]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/docs/agents/issue-tracker.md
[Q41]: https://github.com/a2d2-dev/dsh-plugin/issues/41
[Q41-confirm]: https://github.com/a2d2-dev/dsh-plugin/issues/41#issuecomment-5932382143
[Q70]: https://github.com/a2d2-dev/dsh-plugin/issues/70
[SPEC-runtime]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/docs/specs/task-runtime-phase1.md
[I-bind]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/index.ts#L646
[I-store]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/store.ts#L198
[I-open]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/index.ts#L723
[I-dispatch]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/index.ts#L902
[I-complete]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/index.ts#L769
[I-handoff]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/index.ts#L1374
[I-task-types]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/types.ts#L43
[I-run-types]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/task-runtime/types.ts#L6
[I-runtime]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/task-runtime.ts#L65
[I-start]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/task-runtime/runner.ts#L78
[I-advance]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/task-runtime/runner.ts#L239
[I-rotate]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/task-runtime/runner.ts#L352
[I-guard]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/task-runtime/runner.ts#L195
[I-inbox]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/task-runtime/store.ts#L24
[I-host]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/task-runtime/host.ts#L69
[I-host-children]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/task-runtime/host.ts#L98
[I-host-progress]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/task-runtime/host.ts#L140
[I-watch]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/github-watch.ts#L117
[I-watcher]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/github-watch/watcher.ts#L137
[I-stage]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/stage-agents.ts#L109
[I-session-agent]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/session-agents.ts#L142
[I-config]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/config-page.ts
[I-root]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/root-session.ts#L91
[I-panel]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/panel.ts#L135
[I-client]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/client/index.tsx#L60
