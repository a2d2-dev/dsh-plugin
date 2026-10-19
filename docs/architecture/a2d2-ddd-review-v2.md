# A²D² DDD 架构设计 · 第一阶段评审修订稿 v2

> **本轮目的**：按 LF 的反馈统一 Project、Project Agent、Task、DSH 会话/子会话、工作目录和绑定/执行锁的含义，并连带修订场景、边界、规则和实现映射。
>
> **范围仍为第一阶段评审**：5 个场景、统一语言、子域与限界上下文三张主图及配套表。本轮不提前冻结聚合、完整状态机或跨边界时序。旧稿与原型保留；本稿中的新模型是 **拟调整方案**，不是已部署能力。
>
> **证据基线**：A²D² 插件 `6c9ccb6f0d5d2caea7275fc798caf36436af4f69`；DSH 源码 `a45068d2ec03326c800c68c9bdcd47508e3ccb9c`；GitHub 官方 Projects/Issue 文档及本次只读 GraphQL 输入类型检查。没有运行 CLI Agent、修改 GitHub 工作项、部署或改变真实执行状态。

## 1. 这次调整的主线

### 1.1 相对上一版的变化

| LF 的反馈 | 本轮采用的建模口径 | 对后续对象的影响 |
| --- | --- | --- |
| Project 是否对齐 GitHub Project | **建议对齐 GitHub Projects v2**，以 Project 节点身份识别业务项目。Repository 独立建模 | 一个项目可关联多个仓库的任务；同一个 Issue 可以被多个 Project 展示，不能因此复制任务或重复抢占执行 |
| CEO 是否放到 Project 下 | **所有业务 Agent 都作为 Project Agent**；CEO 是项目 Agent 的角色之一 | 不再从“任务主会话”倒推出固定 CEO 身份。角色、任务负责人、会话执行实例分开 |
| DSH 的会话、子会话、工作目录需要明确 | DSH 是执行载体；Task、Project Agent、“主会话”是 A²D² 的业务身份或关联 | 工作目录成为显式执行资源；不能用 cwd 代替 Project，也不能认为任意 CLI 进程天然是子会话 |
| CLI Agent 尽量统一到 DSH subagent | 统一委派入口与结果契约，复用已有 provider；按能力区分 one-shot 与持久子会话 | 不额外建立一套“CLI任务系统”；持久身份、续聊、取消、结果回传及恢复需逐项落实 |
| Binding 放 Issue 上，类似锁 | **业务归属和接续摘要在 GitHub 可见；真正互斥由执行协调器保证** | 拆开“指派给谁”“当前由哪次会话执行”“谁持有有效执行权”，不把标签或评论本身当原子锁 |

这会改变旧 [ADR 0002][A02] / [ADR 0004][A04] 中的部分身份范围，但保留其寿命原则：业务任务和 Agent 身份不能寄存在一次会话里。旧 [ADR 0003][A03] 的“tracker承载任务事实”继续保留；“插件绝不写tracker”若采用自动发布执行摘要，则需增加一个严格限定的例外，不能默默改变。

### 1.2 两条基本约束

1. **业务归属与执行载体分离**：Project Agent 可以有多个会话；会话换代不创造新的 Project Agent，也不改变 Issue 的任务身份。
2. **可见记录与互斥机制分离**：GitHub 上看到“已认领”不等于执行器已持有排他资格。有效执行必须通过单一协调权威检查，不能由“最后一条评论”决定。

**实现状态仍分四类**：已实现、已有设计但未实现、拟调整、待确认。方法规则、技术约束、外部事实与静态风险另外标识，不能混成一个“支持”结论。

## 2. 统一语言与对象关系

### 2.1 业务对象

| 术语 | 修订后的定义 / 身份 | 关系与边界 | 现状与依据 |
| --- | --- | --- | --- |
| **Project 业务项目** | 对齐 GitHub Project，以稳定 Project node ID 为身份；owner/number/URL供展示 | 组织目标、工作流及项目 Agent；不是代码仓库，也不是一个目录 | **拟调整**；GitHub Project 可在用户或组织范围规划多来源工作，[官方说明][GH-project] |
| **Repository 代码仓库** | GitHub repository 身份；owner/name是可读定位 | 一个 Project 可用多个 Repository；一个 Repository 可为多个 Project 提供 Issue和代码 | **拟调整**为独立对象；当前插件把项目根与仓库混用，[当前解析][I-project-root] |
| **Task 任务** | 以 GitHub Issue node ID为稳定引用，repo + number为可读地址 | 目标、规格、验收在Issue。Project列表里的同一Issue仍是同一个Task；Draft item 转为Issue前不进入自动执行 | 业务任务以Issue为准沿用 [ADR 0003][A03]；跨Project稳定寻址 **拟调整** |
| **Project Membership 项目收录关系** | `(projectId, issueId)`，对应Project item | 表达项目收录/视图位置，不授予执行权；同Issue可有多个收录关系 | GitHub Projects提供此类关系；本地插件尚无该业务索引，[官方说明][GH-project] |
| **Project Agent 项目Agent** | `(projectId, agentId)`；含角色、指令配置、模型/执行后端策略、能力和权限约束 | 属于Project；独立于Session。不同项目的同名Agent不共享业务身份 | **拟调整**；当前 [ADR 0004][A04] 为全局三类Agent，当前账本只有sessionId与角色名 |
| **Role Template 角色模板** | 可复用的职责和默认配置，例如CEO、工程师、评审 | 全局可提供模板，Project据此实例化Agent；共享模板不等于共享Agent身份 | **拟调整**；复用既有角色内容，不重新发明其职责 |
| **CEO** | 一个Project Agent承担的协调角色：项目内分派、设计讨论、复核、推进与收口 | CEO不再是特殊领域实体，也不是特殊DSH会话类型；同样通过会话执行 | **拟调整**，替代“某Task的mainSession必然推导CEO”的硬编码 |
| **Task Assignment 任务指派** | Task在某执行Project中交给某Project Agent负责的业务决定 | 同一Issue可以被多Project观察，但默认只有一个活动执行Project/负责人。负责人可委派多名工作者 | **拟调整**；GitHub可见存储方案见第7节；负责Agent不必固定叫CEO |
| **Workflow / Stage** | Project选用工作流；阶段描述Task做到哪一步 | 阶段不等于会话代次。阶段先选择项目内Agent，再决定执行载体与后端 | 工作流规则复用技能；身份范围 **拟调整**，[ADR 0005][A05]、[ADR 0006][A06] |
| **Subtask 子任务** | 业务任务分解形成的另一个Issue，保留父子任务关系 | “需要独立设计”影响交互能力需求，不要求引入特殊子CEO类型；子任务与子会话不是同一种关系 | 复用原两种执行方式；去特殊化表达 **拟调整** |
| **Completion 完成** | 负责Agent根据任务标准核实验收、同步并关闭Issue，再声明本地执行完成 | 不把 `complete_task` 重新解释为“仅交付、待验收”；谁有权收口由项目策略/授权决定 | 完成顺序保留 [CEO职责][CEO-complete]，执行主体泛化为负责Agent属于 **拟调整** |

### 2.2 执行、资源及关联对象

| 术语 | 修订后的定义 / 身份 | 保证与边界 | 当前实现对应 |
| --- | --- | --- | --- |
| **Session 会话** | DSH持久会话记录，由 `(runtimeId, sessionId)` 定位 | 是Project Agent的一次执行载体；A²D²不新增另一种DSH会话类型 | [SessionHeader][DSH-session]；runtimeId跨实例寻址为 **拟调整** |
| **Child Session 子会话** | 具有父子会话关系、宿主可管理的DSH会话 | parent关系是执行委派关系，不证明业务任务父子关系；不能用进程ID冒充 | [子会话创建][DSH-child]、[子代理目录登记][DSH-start] |
| **Agent Session Association** | Project Agent与DSH会话的关联 | 一个Agent可对应多个会话；会话内不静默更换业务身份。Project协调会话可以讨论多个Task，但不能被多个独立任务循环无序驱动 | **拟调整**；现有 [SessionAgentStore][I-session-agent]需要加入project/agent身份 |
| **Control Session 协调会话** | 对某次任务执行具有协调职责的会话引用；“主会话”保留为界面简称 | 是普通Session在关联中的角色，不是DSH新实体；同一Project Agent不必为每个任务复制身份 | **拟调整**；现有task.mainSession仍为单任务绑定且推导CEO |
| **Task Execution 任务执行记录** | 某Task的一次实际推进记录，关联负责Agent、协调会话、委派执行和资源 | 返工、恢复、重开何时算新一次执行留第二阶段；不以Project item或CLI PID为身份 | **拟调整**；当前RunRecord是部分基础，不等价于完整目标模型 |
| **Binding 绑定** | 持久记录业务身份与执行载体的对应关系：ProjectAgent↔Session，TaskExecution↔协调会话/委派 | Binding本身不等于锁；任务指派可以早于会话创建，也可以跨会话存续 | **拟调整**；当前 `bind_main_session` 仍只写本地任务主会话 |
| **Execution Lock 执行锁 / 执行资格** | 单一协调权威为Task授予的有效协调权，关联owner与递增执行epoch/fence | 一项Task只有一个有效协调权，但可以有多个经授权的工作者。过期epoch不得开始新的受控副作用 | **拟调整**的目标契约；现有owner文件锁与pre-step围栏只覆盖本地运行记录 |
| **Working Directory 工作目录** | `(runtime/host, canonical absolute path)`；任务执行使用的实际目录 | 不代表Project或Task身份；一次bash workdir覆盖不改变Session.header.cwd | [SessionHeader][DSH-session]、[bash目录处理][DSH-bash-cwd] |
| **Checkout / Worktree** | 某Repository在某host上的检出副本，含branch/commit和路径 | Repository可有多个检出；Project Agent的协调目录可不是目标代码仓库；实际写代码的执行需明确目标检出 | **拟调整**为显式资源引用；原模板已有锁定worktree和核验分支要求，[派发模板][I-templates] |
| **Execution Context 执行环境** | 每次执行选定的host、cwd、checkout、preset及有效权限 | 派发前校验；同目录不代表同项目。父cwd继承只是宿主默认，不能替代资源选择规则 | 当前root-session可继承装配；目标资源契约 **拟调整**，[I-root]、[DSH-child] |
| **DSH Workspace** | 宿主为规范化目录维护的稳定UUID记录与会话成员关系 | 不是GitHubProject；也不只是随意的UI分组。成员校验要求session cwd与workspace路径匹配 | **已实现**宿主事实，[Workspace类型][DSH-workspace]；不提升为业务项目 |
| **Execution Backend / Provider** | Agent执行采用的后端，例如DSH native spawn或Codex/Claude provider | 负责可声明的调用/取消/结果契约；角色身份不由后端决定 | DSH已有provider扩展；A²D²目标策略选择 **拟调整** |
| **CLI Run** | 外部进程/SDK的一次运行，使用native run/thread id | 是执行技术事实，不是独立业务Agent类型，也不当然具有DSH持久子会话 | 现有产品provider为one-shot，[Codex][DSH-codex]、[Claude][DSH-claude] |
| **Handoff / Generation** | 会话执行载体交接及运行器交接计数 | Task、ProjectAgent、工作流阶段不因换代改变；共享协调会话换代要处理全部相关Task引用 | 现有计数初值0、deliver提交后+1；多任务关联切换 **拟调整**，[I-rotate] |
| **Task Event / Delivery** | 发给业务Task/执行关联的事件，以及其接受、排队、投递、消费记录 | 不能按旧cwd或旧会话永久寻址；原生DSH结算仍有固定父会话的现有限制 | 当前projectRoot+task地址与持久收件箱 **已实现**；新稳定身份映射 **拟调整** |

### 2.3 一组贯穿全文的示例

以下为模型示意，不是真实创建或修改命令：

```text
GitHub Project P：DSH A²D²
  Repository：dsh-plugin、deepseek-harness
  Project Agent：P/ceo、P/engineer、P/reviewer
  Task：dsh-plugin#112（Issue身份稳定；可同时出现在其他Project）
    执行Project：P；负责Agent：P/ceo
    协调会话：runtime-A / session-X
    委派：P/engineer → 子会话或one-shot provider run
    代码资源：runtime-A / checkout=dsh-plugin@feature / cwd=/work/plugin-feature

P/ceo 换到 session-Y：Agent和Task都不换身份，只更新受控执行关联。
另一Project收录同一Issue：可以展示，但不能独立再取得一份有效执行锁。
```

## 3. 五个核心业务场景（修订）

![图1：修订后的业务场景](diagrams/a2d2-ddd-v2/01-business.svg)

[图1查看/导出](diagrams/a2d2-ddd-v2/01-business.html) · [可编辑图源](diagrams/a2d2-ddd-v2/01-business.workflow.json)

图表达目标业务路径；下面每个场景分别列出现有入口与拟调整契约。不要把图上“写Issue归属”“申请执行锁”当作已有工具名。

### 3.1 场景、命令、规则、结果表

| 场景 | 参与者与动作 | 命令/入口层次 | 关键规则 | 结果与当前对应 |
| --- | --- | --- | --- | --- |
| S1 选Project并认领任务 | LF/项目协调Agent选择Project、目标Issue和负责ProjectAgent，发布归属并申请执行资格 | **拟议业务命令**：指派任务、认领执行；当前仍为 `bind_main_session` + `/task-runtime start` | R01项目稳定身份；R02同Issue单协调权；R03绑定与启动分离 | GitHub可见业务归属；运行器持执行资格；当前没有ProjectAgent寻址和远程绑定发布 |
| S2 统一委派 | 负责Agent选择项目内执行Agent、工作目录、所需交互/恢复能力，再选择DSH入口 | 当前 `dispatch_subagent` / `open_subtask`；DSH `subagents.start` 或continuable入口；业务接口统一为拟议 | R04角色无特例；R05能力匹配；R06资源校验 | 执行记录关联Issue、ProjectAgent、session或run，结果回到有效协调者 |
| S3 协调会话换代 | 上下文或轮数触发；换执行载体但保留ProjectAgent和Task身份 | 当前 `/task-runtime rotate`；项目Agent共享会话的批量关联恢复尚无实现 | R07唯一有效执行epoch；R08阶段独立；R09相关任务引用不丢失 | 新会话接任、旧会话失效；GitHub摘要更新只反映实际已提交事实 |
| S4 等待、消息与故障恢复 | LF输入、子执行完成、外部事件、进程中断或重启 | 当前运行器inbox与recover；目标事件按Task/Execution身份寻址 | R10投递层次分开；R11按能力恢复；R12锁与外部记录不伪装原子 | 原生会话回读恢复；CLI仅在能力满足时resume，否则核对副作用后重试或阻塞 |
| S5 验收与收口 | 有收口权限的负责Agent核对验收、同步结果并关闭Issue，结束执行、通知父任务 | 现有方法 `gh issue close` → `complete_task`；目标去除“必须固定CEO角色名”的推导 | R13完成顺序保留；R14可见完成与执行释放可追踪 | 任务完成、执行记录收口、锁释放及通知分开记事实；不增加三个手工审批按钮 |

### 3.2 S1：项目、负责人、目录、执行资格分别建立

**目标流程**：选择GitHubProject → 读取或创建Issue并收录项目 → 选择ProjectAgent → 记录TaskAssignment → 选择实际执行资源 → 通过协调器认领 → 创建/关联会话并显式启动。

**规则与结果**：

- Project选择是显式的，不能只从cwd猜测；同仓库可能服务多个Project。
- Issue在多个Project中出现时，收录关系不会产生第二项Task。执行资格默认按Issue稳定身份仲裁，不按 `(projectId, issueId)` 各锁各的。
- 同一个ProjectAgent可负责多个Task。协调会话如果服务多个Task，所有工具命令和事件必须显式带Task/Execution引用；不能再仅用“当前session对应哪个唯一Task”推断。
- 不能让多个task-runtime循环同时无序驱动同一协调会话。目标需要会话级串行调度/队列；具体方案在第二阶段确定。若该能力尚未实现，运行前应拒绝共享驱动，而不是悄悄并发。
- 执行前选定 `host + cwd + checkout + permissions`。在Project协调目录聊天不等于获得任意仓库工作目录的写权限。

**当前对照**：[bindMainSession][I-bind]按路径解析本地Task，并要求一个session最多绑定一个Task；[start][I-start]建立本地RunRecord，要求workspace。当前没有上面的Project选择、ProjectAgent或跨项目执行仲裁。它们都标为拟调整，不以改文案冒充完成。

### 3.3 S2：角色统一，执行载体按能力选择

**目标流程**：负责Agent判断工作需要 → 选择Project内Agent和资源 → 检查交互、续聊、取消、权限与恢复能力 → 通过DSH委派接口启动 → 保存任务与执行关联 → 复核结果。

| 需要 | 推荐载体 | 与旧设计的对应 | 不允许的推断 |
| --- | --- | --- | --- |
| 需要持续与LF讨论 | 可交互DSH会话；所属Agent可为CEO或其他具备相应职责的项目Agent | 原“独立设计子任务” | “只有CEO能有根会话”不是DSH事实 |
| 可非交互实施/评审，需要继续对话或宿主恢复 | DSH持久可续聊子会话 | 原spawn/continuable派发 | 子会话parent不能直接当业务Task.parent |
| 一次性外部能力，无需续聊 | DSH one-shot CLI/SDK provider | DSH已有Codex/Claude等provider基础 | one-shot run.id不能当作持久sessionId展示 |
| 需要CLI能力且还要求完整子会话历史/恢复 | 扩展适配契约后再启用，或选择已有满足能力的native后端 | 目标收敛方向 | 不能用bash跑CLI后补一个标签就声称已统一 |

**目录约束**：当前DSH子会话默认继承父cwd；Codex/Claude provider也从父session cwd取目录。把worktree路径写进prompt，或某次bash执行cd，并不会改变会话header。跨仓库/工作树派发需一个明确的执行环境建立步骤：宿主允许的cwd选择接口、在正确cwd建立执行父会话后委派，或补充正式适配能力。具体采用哪种方式需实现验证；本稿不虚构已支持任意child cwd覆盖。[DSH-child]、[DSH-codex]、[DSH-bash-cwd]

**当前对照**：A²D²的 [dispatchSubagent][I-dispatch]固定选择 `spawn`，角色来自全局表，目标Issue只自动进入label；[openSubtask][I-open]创建独立根会话并绑定为CEO。统一业务身份/接口需要实质重构，而不只是改类型名称。

### 3.4 S3：交接的是会话，不是项目Agent身份

**目标流程**：进入安全边界 → 记录接续材料及固定后继身份 → 创建继任会话 → 协调器提交关联/执行epoch变化 → 围栏拒绝旧执行 → 发布Issue摘要 → 投递接续消息。

若一个ProjectAgent的协调会话同时服务多个Task，交接影响的是一组执行关联。必须保留受影响的Task集合和恢复进度；中断后不能只接续其中一个而遗失其他任务。不要通过修改GitHub一条comment，就宣称多个本地执行记录已原子切换。

**当前已实现**：单Task的prepare/write/create/take/deliver、固定后继、preset/权限继承、旧会话pre-step围栏。当前generation初始0，deliver提交后加一，take时current可能已经变化。[I-rotate]、[I-guard]

**当前限制继续保留**：原生未结算子代理会阻挡交接；独立活动子任务/GitHub等待只在部分自动分支阻止续跑，并不是所有显式rotate的硬条件。CLI one-shot若不进入持久子会话catalog，现有 `unsettledChildren` 不能自动覆盖它；统一入口后须补跟踪范围。[I-host-children]、[DSH-start]

### 3.5 S4：按任务与执行身份恢复，不能按进程名字猜测

**目标寻址**：事件带Task身份、执行记录/委派ID及需要的epoch，接收者由协调器解析。父Task关系、父Session关系、ProjectAgent身份分别保存，不能互相替代。

| 中断或输入 | 目标行为 | 当前依据与差距 |
| --- | --- | --- |
| 等LF输入 | 保存问题与任务范围；收到对应输入后继续 | 原生问题与运行器等待已有；共享Project协调会话需明确问题属于哪个Task |
| 原生子会话结算 | 保留宿主parent关系，结果关联回Task；父会话交接由安全边界处理 | 现有settlement不等于持久离线outbox，不承诺父离线时必达 |
| CLI one-shot结束 | 保存真实exit/stopReason、native run id、输出和清理结果；据此复核任务结果 | 已有provider结果与dispose基础；bash job completed/exit0不等于验收通过 |
| CLI中断或宿主重启 | 能resume则按provider契约恢复；不支持时明确阻塞/核查副作用后新run重试 | 当前产品provider不是持久可续聊子会话；不可自动承诺resume |
| GitHub摘要发布失败 | 保留已提交协调事实与待发布记录；不得声称“已在Issue更新” | 需要持久outbox与版本投影，当前尚无自动Binding发布 |
| 租约/执行资格不明 | 新执行不启动；旧执行须按可验证持权和围栏策略处理 | 目标仲裁契约待设计；当前只支持本地owner锁范围 |

事件“已接收”“已入队”“进入模型日志”“业务已处理”仍须分别观察。重试不承诺外部副作用恰好一次；运行器目前也没有覆盖所有失败路径的统一deadline或最大重试次数。

### 3.6 S5：完成定义保留，角色归属调整

保留既有方法顺序：验收通过 → 同步最终证据 → 按授权关闭Issue → 声明执行完成 → 通知父Task。这里的业务责任由**项目策略授予收口权限的负责Agent**承担，CEO是默认协调角色之一，不是工具内部唯一身份来源。

GitHub关闭、本地执行收口、执行锁释放、父通知投递不是同一事务。目标流程需有完成操作身份及可恢复的发布/通知进度。不能因为标签已经变成done就释放所有实际写进程，也不能把某个CLI进程退出当作Task完成。

当前 [completeTask][I-complete]仍只接受本地主会话：不校验GitHub验收/关闭，运行器父路径先入队后写done；无运行器时先done再直接通知。父可能已经交接、暂停/受阻记录可能不立刻同步runtime.done。这些缺口保留为第二阶段时序和一致性设计输入。

## 4. 子域全景与分类依据

![图2：修订后的子域全景](diagrams/a2d2-ddd-v2/02-subdomains.svg)

[图2查看/导出](diagrams/a2d2-ddd-v2/02-subdomains.html) · [可编辑图源](diagrams/a2d2-ddd-v2/02-subdomains.architecture.json)

| 子域 | 职责 | 分类 / 理由 | 本轮变化 |
| --- | --- | --- | --- |
| D1 项目任务推进与协作 | Project中的任务组织、负责人选择、阶段推进、分派与验收 | 核心；减少LF管理成本的业务差异化 | 不再把Project约化为Repository；项目Agent统一负责工作 |
| D2 执行协调与连续性 | 执行锁、会话关联、委派追踪、交接、事件恢复 | 核心；任务跨会话/进程持续推进的保证 | 绑定、GitHub摘要、执行锁分层；覆盖CLI run能力差异 |
| D3 项目Agent与策略 | 项目Agent身份、模板、模型/provider、能力及配置 | 支撑；为核心工作提供可替换执行者 | 全局角色模板复用，但具体业务Agent归Project |
| D4 观察与人机介入 | Project任务页、Issue可见状态、会话历史与工作目录 | 支撑；呈现业务与执行事实 | 显示Project/Repo/cwd三个维度，不从目录反推业务身份 |
| D5 项目与工作项跟踪 | GitHub Project、Issue、父子关系、结构化字段与时间线 | 通用外部能力；复用GitHub而非自建tracker | 增加TaskAssignment与执行摘要的规范写入/读取契约 |
| D6 通用执行与资源 | DSH会话、子会话、cwd/workspace、工具、provider与子进程 | 通用外部能力；复用宿主执行生命周期 | CLI走provider接入；不另建业务上的CLI Agent类别 |

分类仍不等于服务拆分。D1/D2暂在同一候选执行协调上下文，以避免业务认领、执行持权和接续各自宣称不同owner。

## 5. 限界上下文与协作关系

![图3：修订后的上下文映射](diagrams/a2d2-ddd-v2/03-contexts.svg)

[图3查看/导出](diagrams/a2d2-ddd-v2/03-contexts.html) · [可编辑图源](diagrams/a2d2-ddd-v2/03-contexts.architecture.json)

BC名称是候选语义边界，不是要求新建微服务。图中C编号对应下表；GitHub上可见，不等于在那里完成了执行互斥。

### 5.1 上下文职责与对象所有权

| 上下文 | 拥有的职责/模型 | 边界依据 | 不应承担的事 |
| --- | --- | --- | --- |
| **BC-P 项目Agent配置** | ProjectAgent身份、角色模板、职责、能力与模型/provider策略；通过projectId关联GitHub项目 | 配置与职责的生命周期长于会话；Project Agent不是宿主运行时Agent句柄 | 不从cwd推断项目；不决定Issue已验收；不直接抢占任务执行 |
| **BC-O 任务归属与执行协调** | TaskAssignment应用流程、Binding、TaskExecution、执行锁、委派/交接/投递过程 | 每个Issue的有效协调权需统一仲裁；共享会话也需一个有序驱动者 | 不复制tracker全部任务内容；不把评论更新当原子锁；不直接改DSH私有存储 |
| **BC-T 项目与工作项（外部GitHub）** | Project/Item、Repository/Issue、业务归属记录、结果和可见执行摘要 | GitHub作为人和Agent共享的业务协作记录 | 不保证任意自定义标签/评论天然提供CAS或排他执行 |
| **BC-H 会话执行（外部DSH）** | Session、子会话关系、cwd/workspace、工具、原生执行与provider生命周期 | 对A²D²暴露明确的会话/运行契约，不理解ProjectAgent业务职责 | 不以DSH父子会话关系定义业务子任务；不自动把bash CLI识别成子会话 |
| **查询/交互投影** | 组合Project、Issue、Agent、会话及工作目录事实；提交受控命令 | 没有新的独立业务写模型，暂不独立BC | 不凭label、PID或模型自然语言猜测真实执行归属 |
| **CLI/SDK provider适配面** | 将外部运行映射到DSH已声明的执行能力、错误、结果、取消和必要持久记录 | 是BC-H与外部产品之间的技术/防腐适配，不单建业务上下文 | 不伪造DSH会话历史或假称具备continuable能力 |

### 5.2 协作关系与读写责任

| 编号 | 关系与时点 | 保证主体 | 当前 / 目标 |
| --- | --- | --- | --- |
| C1 BC-O ↔ BC-T | 读取Project/Issue；发布业务指派和执行摘要；收口时同步业务结果 | 负责Agent决定业务动作；受控发布器维护执行记录，版本由协调器产生 | 当前主要CEO使用gh；自动执行摘要发布 **拟调整**，需修订原“不由插件写tracker”范围 |
| C2 BC-T → BC-O | Issue/Project归属变更、外部PR状态和工作项事件 | watcher/适配器翻译稳定ID；协调器验证与当前执行的关系 | 当前PR任务事件已有；Project归属与人工改指派的调和 **拟调整** |
| C3 BC-P → BC-O | 选择负责/执行Agent，装配身份、模型/provider及能力策略 | 项目策略校验、创建时装配、身份不可静默替换 | 当前全局角色表；ProjectAgent快照与继承 **拟调整** |
| C4 BC-O → BC-H | 创建/关联会话、派发、停止、恢复；给定真实执行目录 | DSH公开接口及适配器；BC-O检查执行资格、任务ID与资源 | 现有spawn及根会话能力可复用；显式Task引用与跨cwd契约需补 |
| C5 BC-H → BC-O | 会话消息、工具结果、子执行结算、取消与中断 | 宿主记录技术事实；协调器关联Task/Agent并复核业务结果 | 原生settlement与任务inbox语义不同，不能合并为“必达一次” |
| C6 各事实源 → 投影 | 查询项目任务、负责人、会话代次、实际目录、同步滞后 | 查询层展示来源/时间/一致性状态 | 当前本地单目录面板不等于目标Project视图 |
| C7 BC-H ↔ CLI/SDK | 统一subagent入口，按provider执行一次性运行或持久子会话适配 | provider能力声明和宿主生命周期管理 | one-shot已有；完整子会话统一仍需能力扩展和验证 |

### 5.3 为什么这样划分

- **Project不是目录边界**：项目可能跨仓库，Agent可能在一个协调目录组织多个工作目录。只有稳定Project身份能承载组织和职责。
- **Agent不是会话边界**：把CEO放在Project里，与工程师/评审同样建模，能消除“主会话一绑定就变成CEO”的隐含特例。会话只是Agent的执行实例。
- **Binding不是一致性边界**：记录“谁负责”和真正让旧执行者停止是两件事。GitHub用于共同可见，执行协调器用于排他与恢复。
- **CLI不是新的业务域**：后端差异进入provider能力和执行记录，不让业务层同时管理DSH子会话、bash进程和CLI会话三套互不对应的任务树。
- **聚合尚不由目录或文件决定**：Project包含Agent不意味着整个Project和所有任务必须放进一个大聚合。下一阶段从指派唯一性、执行锁、会话关联等不变量确定提交范围。

## 6. 关键规则：谁保证、何时保证

| 编号 | 修订规则 | 保证主体 / 时点 | 当前与目标差异 |
| --- | --- | --- | --- |
| R01 | Project、Repo、Issue、cwd各有身份，不能互相替代 | 项目选择与资源解析入口，在建立关联和每次跨资源执行前 | 目标规则；当前projectRoot寻址待迁移 |
| R02 | 同一Issue默认只有一份有效协调权，不因多个Project收录而复制 | 执行协调器，在认领、续期/验证、交接和受控副作用前 | 现有本地owner锁不构成跨runtime/跨Project全局保证 |
| R03 | TaskAssignment、Binding、执行资格、start分别成立 | 业务指派发布器与运行器入口 | 绑定不等于启动的既有规则保留；GitHub发布机制待实现 |
| R04 | CEO等Agent均归Project；会话不反向定义业务身份 | 项目配置与身份装配，在选择和启动Agent时 | 旧全局角色/主会话推导CEO需调整 |
| R05 | 交互、续聊、恢复、目录和取消能力必须匹配执行需求 | 委派入口，创建之前；provider不支持则拒绝或显式降级 | DSH已有capability检查；A²D²后端选择和完整CLI子会话尚未接齐 |
| R06 | cwd和checkout是显式资源；prompt中的路径不构成宿主目录变更 | 执行环境解析器 + DSH权限体系，派发前及工具调用时 | 当前子会话继承cwd；目标跨仓库派发不能依赖裸cd |
| R07 | 执行锁唯一的是协调权，允许受授权的多个工作者并行 | 协调器授予epoch，所有受控执行入口验证；取消需收敛外部进程 | 当前pre-step围栏可复用，但不能宣称能原子撤销任意外部副作用 |
| R08 | 会话换代不改变Task、ProjectAgent或业务Stage | 交接器在固定后继创建和接任提交时；业务阶段由负责Agent判断 | 单Task机制已有；新身份范围和共享会话换代待调整 |
| R09 | 一会话服务多个Task时，事件带Task引用、驱动需有序，交接不丢任务集合 | 会话级协调调度与持久接续操作 | **拟调整**；当前反向唯一性限制和独立task循环不能直接放开 |
| R10 | 接受、入队、消费、业务成功分别记事实 | inbox/provider/宿主日志/负责Agent各在对应时点 | 原生、外部one-shot、任务inbox当前保证不同 |
| R11 | 能力不足的CLI不得假称可恢复子会话；取消/重试不能重复副作用 | provider与恢复器，在中断、结果处理和新run启动前 | one-shot可以统一入口；完整trace/cold resume待补 |
| R12 | GitHub摘要与执行锁不是原子双写，迟到/重复发布不得倒退执行epoch | 协调器、持久outbox、单写入者发布器；发布及回读时 | 目标契约；GitHub API未被证实提供所需CAS，不能靠评论实现互斥 |
| R13 | 验收通过后同步/关Issue再声明完成，负责Agent必须有收口权限 | 负责Agent的方法规则；技术入口验证身份/权限边界 | 保留完成含义；当前工具不检查远端验收事实 |
| R14 | 完成、释放执行资格、父通知均需可恢复，旧接收者不能当有效当前指针 | BC-O完成流程；父接收者在投递时按契约验证 | 现有两条通知路径有失败窗口，第二阶段设计补偿/去重 |

## 7. Binding 放在哪里：业务归属、执行摘要、执行锁分层

### 7.1 推荐载体与职责

| 载体 | 适合存什么 | 不适合承担什么 | 建议 |
| --- | --- | --- | --- |
| GitHub Issue标签 | 粗粒度分类、待处理提示、执行方式标记 | projectAgent/session/epoch等结构化身份；原子排他锁 | 保留可读标记，不做唯一归属真相源 |
| Project custom fields | 本Project视图里的阶段、负责Agent展示、执行摘要链接 | 跨Project的唯一执行权；所有Project共享的单一Issue记录 | 做项目视图投影；不同Project字段值不能各自启动任务 |
| Organization-level Issue fields | 跨仓库、跨Project一致的Issue级业务元数据 | 没有额外契约的多字段事务、抢占锁 | **优先评估**作为TaskAssignment结构化载体；需确认组织功能、字段类型、权限和API可用性 |
| 稳定的机器维护Issue评论 | 一个可定位、可读、带schema/version的执行摘要：project/agent/session/执行ID/epoch/更新时间及指向证据的链接 | 根据“最后一条评论”自动抢占；把可编辑正文当不可篡改锁 | **建议作为接续摘要兼容载体**；记录commentId与写入者，仅维护自己的区块，不覆盖人的规格正文 |
| Issue时间线评论 | 指派、交接、恢复、验收等重要业务事件 | 高频心跳、每轮日志、锁续期 | 继续只发布必要事件，链接当前摘要而不复制全部状态 |
| 本地/共享执行协调存储 | 执行锁、原子owner/epoch检查、持久操作、pending outbox | 替代GitHub存全部任务目标和验收 | 保留执行机制；单机和多机采用何种存储由第二阶段明确 |

GitHub官方区分了 **Project custom fields** 与 **organization-level Issue fields**；后者是组织级定义、可在多个仓库和Project中使用的Issue元数据。本稿不再假设Issue只能用标签或正文存信息。[GH-project-fields]、[GH-issue-fields]

### 7.2 为什么“写在Issue上”还不等于拿到了锁

本次只读检查了 `UpdateIssueInput`、`UpdateIssueCommentInput`、`UpdateProjectV2ItemFieldValueInput`、`SetIssueFieldValueInput` 的GraphQL字段：未看到可直接用于本方案的 `expectedVersion`、`expectedOwner` 或原子“仅在无人持有时认领”前置条件。`clientMutationId` 的schema说明是客户端标识，不足以证明互斥或副作用去重。[GH-issues-api]、[GH-projects-api]

这不等于断言GitHub所有API都不支持任何条件写入；它表示**我们尚无证据可以把这些更新接口当执行锁原语**。ETag读取缓存也不能未经验证就当写入CAS。GitHub的“Lock issue/conversation”是讨论管理能力，不是独占Agent执行的业务锁。

两个执行器完全可能同时读到“空闲”，分别写入自己的评论或字段，然后都开始执行。因此推荐：

1. 所有自动认领先经同一个协调权威授予资格；当前单机可以只允许一个协调器，多runtime则必须共享仲裁能力。
2. GitHub保存业务指派及已经提交执行事实的可见摘要；本地/共享协调存储保存互斥和恢复状态。
3. 新认领/接任必须取得有效执行资格，并按协议确认必要的归属发布；发布失败时不能声称已建立可恢复的共享绑定。
4. 当前会话持权与GitHub同步滞后分别展示。网络中断期间允许什么动作、如何撤销旧资格、何时暂停，由第二阶段定义；不能仅靠GitHub短暂不可达就另起一位执行者。
5. 人工修改归属表示新的业务意图，必须经协调器调和、停止/转移旧执行权后再启动新执行；直接编辑comment不应绕过围栏。

**边界**：epoch字段只有在协调器原子授予且所有相关执行入口验证时才有意义。仅把数字写到Issue评论里，不会自动产生fencing能力；运行中的外部工具也不一定可即时撤销。

### 7.3 一条建议的执行摘要结构

以下是拟议字段，不是GitHub原生对象或已实现存储格式。它只描述可恢复执行事实，执行锁本身仍由协调器保证：

```yaml
schema: a2d2-execution/v1
issueId: ISSUE_NODE_ID
executionProjectId: PROJECT_NODE_ID
responsibleAgentId: PROJECT_AGENT_ID
executionId: EXECUTION_ID
coordinatorId: COORDINATOR_ID
controlSession:
  runtimeId: DSH_RUNTIME_ID
  sessionId: SESSION_ID
executionEpoch: 12
status: running
resources:
  repositoryId: REPOSITORY_NODE_ID
  checkoutRef: CHECKOUT_ID
  directoryRef: RUNTIME_SCOPED_DIRECTORY_ID
updatedAt: TIMESTAMP
```

绝对目录、凭据、原始prompt或工具日志不默认发布到公开Issue；按仓库可见性使用资源引用或可读摘要。技术上“能写入元数据”不意味着应复制完整运行存储。

## 8. CLI Agent 如何收敛到 DSH subagent

### 8.1 已确认能力与限制

| 路径 | DSH源码事实 | 能力界限 | 设计处理 |
| --- | --- | --- | --- |
| bash启动CLI | shell job记录父会话、命令、输出和取消；不会按命令名识别Agent | 没有自动child catalog、持久子会话、continuable inbox；job completed不代表Agent成功 | 不作为统一任务委派的正常入口，仅作显式低层工具或临时诊断 |
| native spawn/fork | DSH有原生子会话及continuation管理 | 具体cwd、权限和父子回传受宿主契约限制 | 作为持久子会话基线能力 |
| Codex/Claude产品provider | Codex `app-server --stdio`；Claude官方Agent SDK/CLI，均由subprocess管理 | 当前是one-shot，不继承父上下文，无 `prepareContinuable`；默认standard产品工具disabled | 可先统一到DSH委派入口，但不声称当前GUI已启用或已实现持久子会话 |
| ACP provider | 配置外部命令/参数，要求ACP协议 | 不是任意CLI自动变子会话 | 作为协议兼容后端选择 |
| 完整CLI子会话 | 需要稳定DSH子会话身份、native thread映射、历史、续聊和恢复 | 当前out-of-process run的 `localAgent` 可为空；仅有SessionId类型的run.id不证明会话存在 | **已有统一方向，具体适配待设计/实现**，不能通过改标签解决 |

依据：[bash][DSH-bash]、[SubagentRun/Provider类型][DSH-provider]、[注册子目录条件][DSH-start]、[外部运行句柄][DSH-out-of-process]、[产品默认配置][DSH-preset]。本次未查询运行中注册表，所以“源码有provider”与“当前18780可用”保持分开。

### 8.2 统一入口的最小契约

| 契约 | 必须记录/保证的内容 | 不满足时 |
| --- | --- | --- |
| 业务关联 | projectId、agentId、issueId、executionId、delegationId | 不允许只用label、PID猜测任务关系 |
| 执行身份 | runtime/session或one-shot run、native thread/session id；明确是否持久 | one-shot独立标识，不能出现虚构的“打开子会话”链接 |
| 工作目录 | host、实际cwd、checkout、有效权限，继承/覆盖规则可追踪 | 不默默使用协调Agent目录执行另一仓库任务 |
| 结果 | accepted、terminal result、真实stopReason、输出与诊断、业务复核 | exit0、job completed仅作为技术结果 |
| 取消 | 取消启动、中断当前turn、dispose进程树分开；幂等并确认真实退出 | 明确unsupported，不能只杀父shell留下后台执行 |
| 消息与父回传 | 主动消息与结算通知分开；目标、稳定ID、重试和离线补投策略 | 不声称所有provider都能send_message或父离线必达 |
| 恢复 | 会话历史/配置回读、native上下文是否可恢复、已发生副作用核查 | 无resume能力就进入阻塞或经确认的新run重试 |
| 交接期间安全性 | 未结算执行必须可枚举；旧owner失效不等于子进程已停止 | 扩展运行器的未结算检查，不能仅依赖native catalog |

结论：**统一到DSH subagent入口是可行且已有基础的方向；统一成“所有后端都是可续聊、可恢复的DSH子会话”仍需要额外实现。** 业务Agent模型统一，不要求假装后端能力相同。

## 9. 领域到实现的映射（修订）

| 对象/规则 | 状态 | 依据与落点 | 本轮建议/影响 |
| --- | --- | --- | --- |
| Project=GitHub Project；Repository独立 | 拟调整 | GitHub [Projects][GH-project]；旧 [CONTEXT][GLOSSARY] / [projectRoot][I-project-root]不同 | 全局任务查询、配置归属及存储键需迁移，不能只改UI标题 |
| Issue稳定任务身份与多Project收录 | 拟调整 | GitHub事实可复用；当前本地key为projectRoot+issue-N | 引入显式TaskRef与ProjectMembership；执行锁不得按项目重复授予 |
| Project Agent / 全局角色模板 | 拟调整 | 当前 [ADR 0004][A04]、[阶段表][I-stage]是全局身份 | 项目内实例化身份，保留模板；项目配置不再只覆盖提示词 |
| CEO作为普通ProjectAgent角色 | 拟调整 | 当前主会话绑定推导CEO，[角色账本][I-session-agent]排除主会话 | 不以root/child或工具名称推导角色；校验负责关系和能力 |
| Session/ChildSession/cwd | 已实现 | [SessionHeader][DSH-session]、[child-agent][DSH-child] | 作为底座事实复用，不在业务层造新的DSH会话类型 |
| Workspace目录与成员约束 | 已实现 | [workspace][DSH-workspace] | 修正“只是UI分组”；业务Project不映射单个workspace |
| 显式ExecutionContext与跨cwd派发 | 拟调整 | 当前子会话/provider从父cwd取值 | 需资源建立/校验流程，不能以prompt路径代替 |
| 原生子代理入口和外部one-shot provider | 已实现 | [subagent.start][DSH-start]、[Codex][DSH-codex]、[Claude][DSH-claude] | 仅表示源码能力；产品工具默认禁用，当前GUI启用状态未核实 |
| 所有CLI后端完整持久子会话化 | 待确认 | [out-of-process][DSH-out-of-process]、[Provider契约][DSH-provider] | 需评估持久身份、历史和冷恢复扩展，不属于已实现 |
| 本地bind/main/owner/交接/inbox | 已实现 | [I-bind]、[I-start]、[I-guard]、[I-inbox] | 保留可复用机制；路径身份、单任务会话及硬编码CEO有迁移成本 |
| GitHub Issue上的Assignment与执行摘要 | 拟调整 | Issue字段/Project字段/评论API；当前插件不写这些Binding信息 | 选择兼容载体，增加受控发布器/outbox；修改原写权限边界 |
| 多实例共享仲裁、epoch围栏 | 待确认 | 当前同机文件锁，现有GitHub更新接口未证明可做CAS | 当前不能各runtime各锁一份后宣称全局排他 |
| ProjectAgent共享协调会话的任务调度 | 待确认 | 当前一session绑定一Task；运行器按Task驱动 | 需显式Task引用与会话级串行化；未具备时禁止共享驱动 |
| 项目任务整页与CEO计划 | 已有设计但未实现 | [Issue #70][Q70]及旧原型 | 页面按Project组织，显示Repo/cwd和Agent身份；不从本地任务文件伪造全量视图 |
| 验收→关Issue→本地完成语义 | 已实现 | [CEO方法][CEO-complete]及 [completeTask][I-complete] | 保留业务语义；方法遵循不等于技术验收检查 |
| 通知幂等、完成与锁释放的一致性 | 拟调整 | [I-complete]先后提交和非托管回退窗口 | 保留前稿缺口，后续按新身份与执行锁设计恢复流程 |

## 10. 建议保留、调整与待确认事项

### 10.1 保留

- 目标层/执行层的寿命划分，以及任务内容和验收以tracker为准。
- 任务与会话分离、阶段与换代分离、子任务与子会话分离。
- 显式启动托管、固定后继、持久事件、旧会话执行围栏等现有机制。
- 已验收并按授权收口后再声明完成；不默认增加三个人工确认步骤。

### 10.2 按本轮反馈调整

- 将Project对齐GitHubProject；Repository、Checkout、WorkingDirectory独立表达。
- 将全部业务Agent放到Project下；CEO降为统一Agent模型的一种角色，全局定义变可复用模板。
- 将Binding从“本地Task.mainSession字段”提升为明确关系；GitHub承载可见业务归属和接续摘要，执行协调器保证互斥。
- 任务事件、委派和恢复使用稳定Task/Execution/ProjectAgent引用，逐步替代cwd+issue-number+session推断。
- CLI优先通过DSH provider接入，并显式展示能力缺口，不建立第二套CLI任务树。
- 此变化会触及 [ADR 0003][A03] 的写入职责、[ADR 0004][A04] 的Agent作用域、[ADR 0005][A05] 的执行位置及 [ADR 0011][A11] 的执行寻址。正式批准后修订真源；本轮仅保留新旧差异，不直接改写旧ADR。

### 10.3 本轮的默认建议与仍需落实的选择

| 事项 | 默认建议 | 为什么仍需后续落实 |
| --- | --- | --- |
| Project身份 | GitHub Project node ID；不以仓库名或cwd代替 | 现有目录任务如何迁入项目、无Project任务如何接入，需要迁移策略 |
| 同Issue多Project执行 | 可被多个Project观察，默认一个活动执行Project/负责Agent | 是否存在确需并行独立执行的业务，需要明确另建TaskExecution和资源隔离规则 |
| ProjectAgent会话形态 | Agent可多个会话；项目协调会话可服务多个Task，工具携带TaskRef | 共享调度/交接尚未设计，不能直接解除旧绑定限制 |
| GitHub记录载体 | 优先评估组织Issue字段存Assignment；机器维护评论提供执行摘要；Project字段作视图 | 实际组织字段权限、兼容性及单写入者保障需核对后落地 |
| 真正执行锁 | 单一协调权威；多runtime共享仲裁；GitHub只发布可见镜像 | 存储、CAS/epoch、过期/撤销、网络分区策略需第二阶段明确 |
| CLI收敛深度 | 先统一委派/结果/取消/目录；持久子会话按能力逐步补齐 | 外部产品不一定支持相同续聊/恢复协议，不能靠命名统一 |

## 11. 下一阶段与本轮验证

**下一阶段仍按原约定在边界评审后开展**：

1. 聚合主图：重点评估ProjectAgent配置、TaskAssignment、ExecutionClaim、Execution关联/交接、事件投递哪些必须原子一致；Project包含Agent不意味着单一大聚合。
2. 状态图：指派/认领/运行/交接/受阻/释放与业务完成分开；原生子会话与外部one-shot有不同技术生命周期。
3. 关键时序：GitHub记录与执行锁双写、共享协调会话换代、CLI取消/重启、关闭Issue与完成释放/父通知。逐步列出失败、并发、超时、重试、幂等和恢复。
4. 完整映射与迁移：旧 `projectRoot + issue-N`、全局角色、每任务主会话如何映射新身份；旧记录兼容和跨runtime安全边界。

**本轮核查**：静态读取A²D²与DSH公开接口及默认组合；读取GitHub官方文档；仅查询GraphQL输入类型，没有执行mutation。DSH外部provider是否在18780运行实例实际启用未验证。GitHub已有字段能力不代表当前组织已配置。源码的one-shot能力不等于CLI子会话持久化。

图源为可编辑JSON，HTML为可离线查看/导出的图页，SVG供Markdown内嵌；三者在交付前同步检查。本轮未修改产品代码、实际Project/Issue、模型配置或服务。

## 附录 A. 图源与评审材料

- [业务场景 JSON](diagrams/a2d2-ddd-v2/01-business.workflow.json) · [HTML](diagrams/a2d2-ddd-v2/01-business.html) · [SVG](diagrams/a2d2-ddd-v2/01-business.svg)
- [子域全景 JSON](diagrams/a2d2-ddd-v2/02-subdomains.architecture.json) · [HTML](diagrams/a2d2-ddd-v2/02-subdomains.html) · [SVG](diagrams/a2d2-ddd-v2/02-subdomains.svg)
- [上下文 JSON](diagrams/a2d2-ddd-v2/03-contexts.architecture.json) · [HTML](diagrams/a2d2-ddd-v2/03-contexts.html) · [SVG](diagrams/a2d2-ddd-v2/03-contexts.svg)
- [GitHub能力核查说明](evidence/a2d2-ddd-v2-github-capabilities.json)：只读输入字段观察与官方来源；不构成写入CAS支持证明。

JSON为图的编辑真源，修改后使用Archify对应workflow/architecture renderer重建HTML，再由图页导出SVG。正文的业务/执行状态与图源同步维护。

## 附录 B. 来源及版本解释

A²D²链接固定到 `6c9ccb6`，DSH链接固定到 `a45068d2ec`。Github官方接口文档代表本次读取时的能力说明，不推断组织功能开通状态。旧ADR证明原设计，不能用来声称本稿的新ProjectAgent模型已经实现。

[A02]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/docs/adr/0002-goal-layer-and-execution-layer.md
[A03]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/docs/adr/0003-tasks-live-in-the-tracker.md
[A04]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/docs/adr/0004-agent-is-models-plus-two-level-configuration.md
[A05]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/docs/adr/0005-a-stages-agent-decides-where-it-runs.md
[A06]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/docs/adr/0006-each-piece-of-knowledge-lives-in-one-place.md
[A11]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/docs/adr/0011-explicit-task-runtime-owns-execution-and-recovery.md
[CEO-complete]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/ceo/AGENTS.md#L17
[DSH-bash]: https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/shell/tool-bash/src/index.ts#L273
[DSH-bash-cwd]: https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/shell/tool-bash/src/index.ts#L144
[DSH-child]: https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/subagent/subagent/src/child-agent.ts#L139
[DSH-claude]: https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/subagent/subagent-claude-code/src/index.ts#L73
[DSH-codex]: https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/subagent/subagent-codex/src/index.ts#L63
[DSH-out-of-process]: https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/subagent/subagent/src/out-of-process.ts#L237
[DSH-preset]: https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/bundle/web-app/presets/standard.patch.yml#L103
[DSH-provider]: https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/subagent/subagent/src/types.ts#L299
[DSH-session]: https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/core/session/src/types.ts#L91
[DSH-start]: https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/subagent/subagent/src/index.ts#L559
[DSH-workspace]: https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/workspace/workspace/src/types.ts#L57
[GH-issue-fields]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-issue-fields
[GH-issues-api]: https://docs.github.com/en/graphql/reference/issues
[GH-project]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects
[GH-project-fields]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-text-and-number-fields
[GH-projects-api]: https://docs.github.com/en/graphql/reference/projects
[GLOSSARY]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/CONTEXT.md
[I-bind]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/index.ts#L646
[I-complete]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/index.ts#L769
[I-dispatch]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/index.ts#L902
[I-guard]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/task-runtime/runner.ts#L195
[I-host-children]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/task-runtime/host.ts#L98
[I-inbox]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/task-runtime/store.ts#L24
[I-open]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/index.ts#L723
[I-project-root]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/store.ts#L54
[I-root]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/root-session.ts#L91
[I-rotate]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/task-runtime/runner.ts#L352
[I-session-agent]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/session-agents.ts#L142
[I-stage]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/stage-agents.ts#L109
[I-start]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/task-runtime/runner.ts#L78
[I-templates]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/ceo/DISPATCH_TEMPLATES.md#L3
[Q70]: https://github.com/a2d2-dev/dsh-plugin/issues/70
