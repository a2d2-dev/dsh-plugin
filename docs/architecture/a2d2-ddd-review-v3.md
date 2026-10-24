# A²D² DDD 架构设计 · 第一阶段评审修订稿 v3

> **历史评审材料**：保留当时的讨论与固定提交证据，不作为并行的当前规范。当前领域定义见 [CONTEXT](../../CONTEXT.md)，当前决策见 [ADR](../adr/)。本轮已按 LF 指示直接替换冲突 ADR；本文中的“拟调整”“旧 ADR”及固定提交链接描述原评审时点。

> **本轮约束：GitHub Issue / Project 不能成为必要条件。** 同一套项目、Agent、任务、指派、执行占用、交接和验收逻辑，必须能够纯本地运行，也能够接入 GitHub 协同。
>
> 本稿替代 v2 中“Project 身份等于 GitHub Project node ID”“Task 身份等于 Issue node ID”“关闭 Issue 是完成的必要前置条件”的目标设计。保留 Project Agent、DSH 会话/子会话、显式工作目录、统一委派和执行锁的建模方向。
>
> **仍处于第一阶段评审**：业务场景、统一语言、子域与上下文边界。聚合主图、完整状态和关键时序在本阶段评审后完善。目标设计标为拟调整，不声称当前插件已经提供完整的无 Issue 任务接口。
>
> **静态实现基线**：插件 `6c9ccb6f0d5d2caea7275fc798caf36436af4f69`；DSH `a45068d2ec03326c800c68c9bdcd47508e3ccb9c`。本轮只改架构文档和图，不改产品或远程工作项。

## 1. 设计原则：领域身份独立，平台只是适配

### 1.1 本地与 GitHub 使用同一套业务模型

- **Project** 是 A²D² 的业务项目，有自己的 `ProjectId`。可关联 GitHub Project，但不依赖它存在。
- **Task** 是业务任务，有自己的 `TaskId`、目标、规格、验收标准和完成事实。可关联 Issue，但不需要先创建 Issue。
- **Project Agent** 归属领域 Project。CEO、工程师、评审是角色，其身份不会随外部平台或会话更换而变化。
- **Repository / Checkout / Working Directory** 是代码和执行资源。Repository 可以是纯本地仓库，甚至一个任务可以不涉及代码仓库。
- **Binding / Execution / Event** 使用领域ID定位。外部链接、Issue编号、Project item、目录路径、PID都不能代替领域身份。
- **GitHub协同**是可选发布/导入能力；移除这一分支后，核心业务流程必须仍然闭合。

“本地运行”在本稿中指工作管理和执行协调不依赖 GitHub；模型运行仍可按配置使用本地或远程模型，并不借此承诺所有模型都离线运行。

### 1.2 选择：本地领域记录 + 可选协同适配，而不是两个任意写入的真相源

本稿建议让**已接受的领域事实**通过 A²D² 的工作记录端口持久化。第一种落地提供本地实现；接入 GitHub 时仍使用同一领域记录与ID，再增加外部映射、发布和受控导入。

这是一个明确选择：GitHub 适配器不直接冒充支持强一致事务的领域数据库。它承载共享可见的工作项，并把外部变更翻译成待校验的输入。外部观察只有经权限、版本和冲突规则处理后，才成为新的领域事实。

因此：

1. 本地模式不是 GitHub 不可用时临时伪造 Issue 的降级模式，而是完整运行方式。
2. GitHub模式也允许未关联Issue的任务正常执行；关联状态和业务状态分开。
3. 外部同步失败可以出现“任务已完成，Issue关闭待同步”，不能伪称远端已经关闭。
4. 本地存储的具体技术可替换；文件/SQLite/其他存储是否满足锁、原子更新及恢复契约，需要后续设计。**本轮不要求为了支持本地而新建独立服务。**

这相对旧 [ADR 0003][A03] 是实质调整：保留“不重复定义两套任务规则”的原则，但不再要求 GitHub 是唯一业务记录来源；领域工作记录本身必须完整。旧 [CEO完成顺序][CEO-complete] 中依赖 `gh issue close` 的部分也要移入可选外部协同流程。

## 2. 统一语言与身份

| 术语 | 平台无关定义 / 身份 | 本地落地 | GitHub协同落地 |
| --- | --- | --- | --- |
| **Project** | 组织目标、工作流和Agent的业务项目；`ProjectId`由领域系统生成并持久保存 | 本地项目记录，可以没有远程仓库 | 通过ExternalBinding关联GitHub Project；节点ID是外部标识 |
| **Task** | 要达成的工作；`TaskId`由领域系统生成，目标、规格、验收与完成记录属于它 | 本地完整任务记录及证据引用 | 通过ExternalBinding关联Issue；repo/number仅是外部可读地址 |
| **Project Membership** | `(projectId, taskId)`，任务被项目组织或展示的关系 | 本地关联记录 | 可投影成Project item；同Task不会因进入多个外部视图而复制 |
| **Project Agent** | `(projectId, agentId)`，项目内职责身份及策略 | 本地配置，复用CEO/工程师/评审角色模板 | 可发布可读负责人摘要；不要求GitHub存在同名用户或机器人 |
| **Role Template / CEO** | 可复用职责模板；CEO是ProjectAgent的一种协调角色 | 由项目策略实例化，靠会话执行 | 外部平台不决定角色身份，也不把原生GitHub AI assignee等同A²D² Agent |
| **Task Assignment** | 任务指派给一个执行Project中的负责Agent | 在领域工作记录中保存 | 可投影成Issue字段/机器维护评论；不是远程锁 |
| **Subtask** | 另一项Task，通过父子任务关系连接 | 直接创建本地子Task，不需要Issue | 可映射成子Issue；外部父子关系缺失/不同属于同步差异 |
| **Workflow / Stage** | Project选择的方法与Task的业务阶段 | 按业务事实推进 | 可投影成Project字段或Issue摘要，字段不能反向凭空推进阶段 |
| **Acceptance / Evidence** | 任务验收标准、结果与证据引用；与provider无关 | 文件、测试结果、git提交、本地评审记录等 | 可增加PR、check run、外部链接；PR不是所有任务的必需对象 |
| **Completion** | 验收成立且有权限的负责Agent确认任务完成，持久保存结果 | 直接完成本地Task并收口执行 | 同一完成事实触发可选Issue关闭/摘要同步；远端失败不伪造本地任务未存在 |
| **Session / Child Session** | DSH会话及其父子执行关系，使用 `(runtimeId, sessionId)` 引用 | 同样使用DSH | 不因关联Issue而变成另一种会话；业务子任务与子会话关系分开 |
| **Control Session** | TaskExecution中的协调会话引用；“主会话”是A²D²的关系名称 | 领域记录关联到DSH会话 | 可发布接续摘要，不以GitHub评论推导运行授权 |
| **Binding** | 业务身份与执行载体的持久关联，如Agent↔Session、Execution↔协调会话 | 完整保存在本地，不依赖外部ID | 按需发布关联的可读投影；绑定内容不因外部解绑而丢失 |
| **Task Execution / Delegation** | 一次任务执行及其委派记录，关联Task/Agent/Session或one-shot run | 使用领域ExecutionId/DelegationId，记录真实结果 | 外部关联仅提供导航和协作，不代替执行身份 |
| **Execution Lock** | 在同一协调域内按TaskId授予的有效协调资格，含owner/epoch | 单机本地协调存储即可实现相应互斥；当前代码机制可部分复用 | 不以Issue标签/评论抢占；多个受管runtime仍须共享协调权威 |
| **Working Directory** | `(host/runtime, canonical path)`，实际执行目录 | 可以是本地工作目录、纯本地仓库或协调目录 | 远程仓库URL/Issue不能代替实际cwd |
| **Repository / Checkout** | 可选代码资源及其本地检出；RepositoryId不等于GitHub repo ID | 纯本地Git仓库也合法；不涉及代码的Task无需伪造仓库 | remote URL、GitHub repo ID只是可选关联；检出仍按host/branch/commit定位 |
| **Execution Context** | 每次执行的host、cwd、checkout、preset、有效权限 | 派发前明确，不能靠prompt中的cd自动改变会话header | 与GitHub是否接入无关；资源权限不因同步模式切换而改变 |
| **DSH Workspace** | 宿主对规范化目录及会话成员的稳定记录 | 保留其真实目录/成员契约 | 不等于领域Project或GitHubProject，[宿主定义][DSH-workspace] |
| **Provider / CLI Run** | DSH原生或外部执行后端的一次运行与能力 | 可用native子会话或CLI provider | 不需要Issue；CLI one-shot也不自动成为持久子会话 |
| **Task Event / Delivery** | 发给Task/Execution的领域事件及投递事实 | 本地inbox、宿主日志和结果 | GitHub事件是可选输入源之一，不是唯一唤醒源 |
| **ExternalBinding** | `domainType/domainId ↔ provider/externalType/externalId`的映射 | 可以没有任何ExternalBinding | 保存Issue/Project节点ID、链接、同步版本和状态；不进入核心ID定义 |
| **Sync State** | 可选外部协同的观察结果，例如未关联、待同步、已同步、冲突、失败、结果未知 | 不参与任务能否存在、指派、执行和完成的判定 | 单独展示；字段及正式状态机在第二阶段确定 |

### 2.1 领域身份的最低要求

- ProjectId、TaskId、AgentId应使用平台无关的稳定标识，UUID等只是实现候选；备份恢复、关联/解绑GitHub、会话换代不能重新生成身份。
- UI可显示本地短号与外部 `repo#number`，但命令、锁、事件和引用都使用TaskId。
- 多Project收录同Task，仍默认只有一个活动执行归属。锁按TaskId仲裁，不按每个项目或Issue副本各自一份。
- 外部导入先查唯一映射索引。同一个GitHub Issue重复导入不得生成第二项Task；发现本地已有不同任务与同一外部对象关联时报告冲突，不自动合并正在执行的任务。
- 上述唯一性保证限于共享同一领域记录与协调权威的受管部署。两个完全独立的安装不能因为都写GitHub评论就自动获得全局互斥；复制数据库也不是迁移执行锁。

### 2.2 不应泄漏到核心命令的参数

```text
核心意图（拟议契约，不是现有CLI命令）：
  创建任务(projectId, title, specification, acceptance)
  指派任务(taskId, projectAgentId)
  启动执行(taskId, executionContextRef)
  委派执行(taskId, projectAgentId, requirements)
  完成任务(taskId, evidence, conclusion)

可选集成意图：
  关联外部工作项(taskId, provider, externalRef)
  发布外部摘要(taskId, committedRevision)
  导入外部变更(externalBindingId, observation)
```

`issue:number`、GitHubProject node ID和`gh`不出现在核心命令的必填参数里。现有工具参数保留在实现差异表中，不能假装改一个术语就已支持新契约。

## 3. 端口与适配：具体落地两种运行方式

### 3.1 最小抽象面

| 端口 / 能力 | 领域所需语义 | 本地实现 | GitHub相关实现 | 明确不承诺 |
| --- | --- | --- | --- | --- |
| **WorkRecordStore** | 保存/查询Project、Task、父子关系、指派、规格、验收事实及领域版本 | 本地持久记录；须提供命令去重和约定范围内的原子更新 | GitHub适配不直接冒充此强一致仓储；可发布其已提交事实并导入观察 | 不把GitHub评论PATCH当数据库CAS |
| **AgentConfigStore** | ProjectAgent身份、模板继承、模型/provider及能力配置 | 本地项目配置与稳定身份索引 | 可选外部配置展示；不要求GitHub用户账户 | 不以外部assignee替代业务Agent身份 |
| **ExecutionCoordinationStore** | 持权、epoch、运行/交接检查点、委派关联、inbox/outbox | 单机实现起步；多runtime按部署需要使用共享权威 | 无GitHub锁实现假设 | 不承诺文件锁跨主机；不把外部投影当锁状态 |
| **ExecutionPort** | 启动/恢复DSH会话、委派、取消、日志/结果回读与能力检查 | 对接DSH公开API及已启用provider | 相同执行端口，不因GitHub模式改业务语义 | one-shot不伪装成可续聊子会话 |
| **CollaborationPort（可选）** | 发布领域事实、导入外部观察、解析外部链接并报告同步状态 | 不安装外部适配器；本地查询与记录已足够 | GitHub适配器负责Project/Issue/PR/评论与领域记录转换 | 不保证远端与本地原子提交或外部副作用恰好一次 |
| **Evidence/Notification适配面** | 保存/引用证据，通知父Task或LF | 本地文件、宿主消息、事件记录 | 可增加PR/check run/Issue链接及外部通知渠道 | 不强制PR、远端CI或外部通知渠道存在 |

这是一套**端口与适配器**设计，不要求六个新服务。几个Store可以先由同一本地存储实现；哪些操作必须同事务提交，将在聚合阶段根据不变量决定，不能仅凭表格认定已经强一致。

### 3.2 两种落地配置

| 项目 | 纯本地模式 | GitHub协同模式 |
| --- | --- | --- |
| 领域项目/任务/Agent | 本地完整记录，独立领域ID | 同一套记录和ID |
| 外部平台依赖 | 无；不需要账号、Issue、GitHub Project或gh | 可选GitHub凭据与适配器；每项Task可以有或没有外部关联 |
| 创建任务 | 直接保存目标/规格/验收，成功后可指派 | 同样先创建领域Task；按需关联已有Issue或请求发布新Issue |
| 业务阶段/指派 | 由领域命令和项目策略改变 | 同样由领域命令改变；外部修改通过导入与冲突处理进入领域 |
| 执行锁/交接/恢复 | 本地/共享协调权威与DSH | 完全相同，不改用GitHub标签抢锁 |
| 评审证据 | 本地输出、文件、测试结果、Git提交等 | 额外支持PR、check run、远端链接 |
| 完成 | 验收通过、保存完成事实、结束执行、通知父Task | 相同完成流程；外部关闭/摘要更新作为可恢复同步动作 |
| 断开GitHub后 | 无影响 | 核心任务仍存在并能按已授权范围运行；仅必须调用GitHub的具体业务动作会受阻 |

“不依赖GitHub”不意味着可以忽略任务本身的约束：如果某项任务的验收明确要求发布GitHub Release或合并PR，网络不可用时该项验收当然不能伪称通过。这是具体任务内容要求，而不是整个任务系统的前置条件。

## 4. 五个核心场景：逐项覆盖本地和GitHub

![图1：不依赖GitHub的业务场景](diagrams/a2d2-ddd-v3/01-business.svg)

[图1查看/导出](diagrams/a2d2-ddd-v3/01-business.html) · [可编辑图源](diagrams/a2d2-ddd-v3/01-business.workflow.json)

### 4.1 场景、命令、规则、结果表

| 场景 | 业务动作与命令意图 | 核心规则 | 纯本地闭环 | GitHub增量 |
| --- | --- | --- | --- | --- |
| S1 创建项目、任务并指派 | 创建Project/Task → 选择ProjectAgent → 保存Assignment/Binding → 显式启动 | R01领域ID独立；R02指派与执行锁分离；R03无外部前置 | 本地记录成功后申请执行资格并建立DSH会话 | 可选发布/关联Project与Issue，失败只影响同步状态 |
| S2 拆分与委派 | 创建子Task → 按阶段选择ProjectAgent、目录和provider → 委派 | R04任务关系与会话关系分离；R05能力匹配；R06资源显式 | 子Task和委派记录直接存在本地，结果回到父Task协调者 | 可选同步子Issue关系或链接PR证据 |
| S3 主会话交接 | 安全边界 → 固定后继 → 接任 → 投递接续内容 | R07唯一协调权；R08身份与阶段不随换代变化；R09共享会话有序 | 全部检查点、指针、消息在本地/DSH恢复，无需访问Issue | 已提交的接任事实可以发布摘要；远端滞后不回滚已确认身份 |
| S4 等待和中断恢复 | 问题/子执行结果/外部观察 → 持久事件 → 恢复或受阻 | R10接受/消费分开；R11按能力恢复；R12同步失败不制造新owner | LF输入、子会话结果、本地评审事件足以驱动；关闭浏览器或重启仍能续接 | GitHub只是额外事件来源；断开后保留外部同步队列 |
| S5 验收与完成 | 核验标准和证据 → 提交Task完成事实 → 收口执行、释放资格并通知父Task | R13验收仍是必要条件；R14外部关闭独立且可观察 | 无Issue也能正常完成，保存结论与历史 | 有关联时排队关闭Issue/更新外部摘要；状态显示是否同步完成 |

### 4.2 S1：没有Repository或Issue也能建立业务任务

**示例**：LF创建本地Project“研发改进”，配置协调Agent，创建Task“梳理模块边界”，规格和验收标准保存在本地。该Task可以只引用一份本地文档目录，不需要GitHub仓库。

**数据走向**：业务入口 → 领域校验/生成稳定ID → WorkRecordStore → 指派 → ExecutionCoordinationStore取得资格 → ExecutionPort创建或关联DSH会话。

**结果**：Task、Assignment、工作目录和执行记录可查询。外部关联集合为空是合法状态，不是错误或待补的必填项。

**当前差距**：现有 [Task类型][I-task-types]允许未绑定Issue的旧任务记录；但 [bindMainSession][I-bind]、[任务运行入口][I-start]、派发/完成方法仍围绕issue编号和BoundTask。当前运行器虽主要执行本地读写、并不主动核实GitHubIssue存在，**用虚构issue编号运行并不能算完整的无Issue领域接口**。

### 4.3 S2：子任务、评审和代码资源都不要求GitHub对象

父Task按业务需要创建子Task。需要LF参与的工作使用可交互会话；非交互工作可通过native持久子会话或CLI one-shot provider执行。输入统一为TaskRef、ProjectAgentRef和ExecutionContext，不把issue编号放到核心必填参数。

**本地结果**：委派执行、评审结论和证据引用写回父Task；代码任务可以只产出本地Git提交或patch。业务“评审”不是GitHub PR review的别名。

**GitHub增量**：适配器可将子Task投影成子Issue、将结果链接到PR/check run；不能因远端还未建子Issue而让本地子Task不存在。

**资源约束保留**：Session.header.cwd、一次bash workdir、Checkout和Workspace仍分开。DSH当前子会话/provider默认继承父cwd；跨目录执行需正式资源建立与校验，不能靠prompt写一个路径就宣称宿主已切换。[DSH-child]、[DSH-bash-cwd]、[DSH-workspace]

### 4.4 S3：交接材料以领域记录为入口

接续材料应包含ProjectId、TaskId、AgentId、ExecutionId及本地规格/证据的可解析引用；有ExternalBinding时才附Issue/PR链接。后继会话不能把“先运行gh issue view”作为理解所有任务的必要第一步。

**本地路径**：固定后继ID和恢复点 → 保存源会话接续内容 → 继承真实执行环境 → 更新受控执行关联 → 投递接续消息。没有外部适配器也能完成。

**GitHub路径**：核心路径相同；投影已提交的交接事件，记录待同步/失败/成功。恢复以领域记录和DSH日志为依据，不从最新一条评论推断有效owner。

如果项目协调会话承载多个Task，交接须保存相关Task集合和恢复进度；任务驱动串行化仍是待补能力，不能简单解除当前“一会话一Task”限制。

### 4.5 S4：外部事件可选，同步冲突与执行故障分开

| 输入或故障 | 核心处理 | GitHub相关处理 |
| --- | --- | --- |
| LF输入或本地问题回答 | 明确关联Task与会话；恢复合法等待状态 | 无需GitHub |
| 子会话/CLI执行结束 | 记录真实结算与证据，负责Agent复核 | 可选发布结果摘要，不把发布成功当验收成功 |
| 宿主中断/重启 | 从运行记录、固定操作身份和DSH日志恢复 | 不要求远端可读才能恢复本地已确认身份 |
| 外部观察迟到/重复 | 由适配器提供来源ID/版本；调和后才生成领域变更 | 同一事件不得重复创建Task；旧外部快照不能倒退领域版本 |
| GitHub发布失败/结果未知 | 保留本地事实与待发布操作，不生成第二位执行者 | unknown须查询/核对远端，不能直接重复创建Issue |
| 外部指派或关闭与本地并发变更 | 显式冲突/调和；涉及执行权时先确保安全再接纳新意图 | 不允许人改标签就绕过本地执行围栏 |

现有Task inbox、消息ID回读和固定后继机制可复用；但其TaskAddress当前依赖projectRoot/issue-N。需要映射到领域TaskRef。DSH原生结算与外部CLI provider的能力差异保持显式；不宣称任意CLI都支持cold resume或父离线必达。

### 4.6 S5：完成Task，外部关闭作为适配动作

**调整后的公共业务顺序**：

1. 有权限的负责Agent核实任务验收标准与必要子工作结果。
2. 持久提交验收结论、证据引用与Task完成事实；这一步不需要Issue。
3. 根据执行状态安全收口、撤销继续推进资格、记录父Task通知；跨存储步骤需可恢复。
4. 如果存在启用的ExternalBinding，再发布完成摘要或关闭相应外部工作项。

**两个同时可能成立的事实**：`Task已完成`，`GitHub关闭待同步`。UI必须分别显示，不为等待外部确认而持续无意义驱动模型，也不宣称Issue已经关闭。

如果Task的验收本身要求某个远端操作完成，该证据仍需在第1步核实。可选协同“关闭关联Issue”与任务内容要求“合并PR/发布版本”不是同一条件。

旧 [CEO指令][CEO-complete] 要求先关闭Issue再 `complete_task`，这是GitHub绑定设计留下的方法耦合；本轮明确建议修订为上述公共业务顺序。不是把“完成”降级为“只交付、还没验收”。

## 5. 子域全景：任务规则归领域核

![图2：平台无关子域全景](diagrams/a2d2-ddd-v3/02-subdomains.svg)

[图2查看/导出](diagrams/a2d2-ddd-v3/02-subdomains.html) · [可编辑图源](diagrams/a2d2-ddd-v3/02-subdomains.architecture.json)

| 子域/支撑能力 | 职责 | 分类与依据 | 与v2相比 |
| --- | --- | --- | --- |
| D1 项目任务管理与推进 | 领域Project/Task、指派、阶段、规格、验收和完成 | 核心；业务规则与平台无关，不能寄存在Issue概念中 | 任务记录语义回归A²D²领域，不再由GitHub定义 |
| D2 执行协调与连续性 | 持权、执行关联、委派、交接、事件和恢复 | 核心；跨会话连续推进的差异化 | 全部按领域ID寻址，无Issue仍有完整执行资格 |
| D3 项目Agent与策略 | 项目身份下的Agent、角色模板和后端能力 | 支撑；配置服务于任务执行 | ProjectAgent的projectId改为领域ProjectId |
| D4 观察与人机介入 | 本地任务视图、会话历史、目录、问题、同步状态 | 支撑；提供统一可观察界面 | 本地视图是完整入口，不再要求先有GitHub视图 |
| D5 工作记录与协同适配 | 工作记录持久化、外部映射/发布/导入 | 支撑能力；通用存储/API为机制，领域规则仍由D1/D2拥有 | 不再把“GitHub工作项跟踪”列成不可缺的外部业务核心 |
| D6 通用执行底座 | DSH会话、子会话、工具、cwd、provider、子进程 | 通用外部能力；不重新造宿主 | 与是否使用GitHub无关，CLI仍通过DSH能力适配 |

持久化适配是技术边界，不意味着一个数据库就是一个限界上下文。图中的分组也不要求拆成六个服务。

## 6. 限界上下文与端口映射

![图3：领域核、本地记录和可选GitHub协同](diagrams/a2d2-ddd-v3/03-contexts.svg)

[图3查看/导出](diagrams/a2d2-ddd-v3/03-contexts.html) · [可编辑图源](diagrams/a2d2-ddd-v3/03-contexts.architecture.json)

图中C2、C4/C5连线汇总调用与回传，具体方向见表。本地持久化和协同端口是适配面，不被误标成新的业务上下文。

### 6.1 上下文职责与划分理由

| 上下文/适配面 | 拥有的语义 | 为什么这样划分 | 不拥有的内容 |
| --- | --- | --- | --- |
| **BC-O 工作管理与执行协调** | Task的业务规则、已接受工作事实、指派与有效执行协调；内部区分业务应用服务和恢复过程 | 没有GitHub仍需确定“什么工作、谁负责、是否完成”；执行归属与任务命令需一致协作 | GitHub字段细节、CLI协议、DSH私有日志实现 |
| **BC-P 项目Agent策略** | ProjectAgent身份、模板、指令、模型/provider与能力策略 | 配置生命周期长于会话，不取决于外部平台账号 | 具体Task验收事实和执行锁授予 |
| **BC-H DSH会话执行（外部）** | Session、ChildSession、cwd/workspace、模型/工具/provider运行事实 | 宿主持有真实执行生命周期；A²D²以端口翻译业务引用 | Project/Task业务身份与验收含义 |
| **可选外部协同上下文** | GitHub Project/Issue/PR的外部身份和状态 | 是外部系统自己的语义；通过防腐适配转换为观察/发布，而非强制域模型 | A²D² TaskId、有效执行owner和本地业务原子提交 |
| **本地持久化适配** | 按端口契约存储领域和协调记录 | 保证核心脱离外部平台可运行；技术实现可替换 | 不另定义第二套任务状态规则 |
| **查询/交互投影** | 组合领域事实、执行事实、外部同步事实 | 统一界面需明确事实来源；不设新的独立写模型 | 不以Issue URL缺失判Task不存在 |

**为何没有把GitHub直接作为WorkRecordStore的替代数据库？** 当前已核查的Issue/评论/Project字段更新接口没有足够证据支持领域需要的原子抢占或版本比较写。强行将它们包成同一个强一致Repository接口，会掩盖能力差异。本稿采用独立领域记录加可选协同适配，使两种运行方式共享同一业务保证；以后更换WorkRecordStore实现仍必须满足同一契约。

### 6.2 协作关系

| 编号 | 方向与契约 | 谁保证 / 时点 | 两种模式的差异 |
| --- | --- | --- | --- |
| C1 BC-O ↔ 领域存储适配 | 保存、查询、版本检查、命令去重及约定提交范围 | 领域服务校验；Store在提交时保证其明确契约 | 两种模式都存在；当前推荐本地持久化实现 |
| C2 BC-O ↔ CollaborationPort | 发布已提交领域变更；把外部观察转为待校验的领域命令 | 本地outbox、适配器来源/版本、核心冲突调和 | 本地模式不安装外部适配器；无调用不是错误 |
| C3 BC-P → BC-O | 提供项目Agent身份与策略快照 | 配置校验、创建/派发时装配 | 与GitHub无关 |
| C4 BC-O → BC-H | 使用TaskRef/AgentRef关联真实会话、目录、委派和取消 | 核心执行资格检查 + DSH公开API | 与GitHub无关 |
| C5 BC-H → BC-O | 结果、消费日志、结算、取消和中断事实 | 宿主技术记录；负责Agent复核业务结果 | CLI one-shot与native子会话区别保留 |
| C6 CollaborationPort ↔ GitHub | ExternalBinding映射、Issue/Project/评论发布、远端变更导入 | GitHub适配器、权限与同步策略 | 仅GitHub协同模式出现；其错误不伪装成核心数据库失败 |
| C7 BC-H ↔ CLI/SDK provider | 执行后端能力、身份、工作目录、取消和结果 | provider契约与宿主管理 | 不要求Issue；持久子会话化仍需额外适配 |

## 7. 关键规则与一致性责任

| 规则 | 内容 | 保证主体 / 时点 | 实现状态 |
| --- | --- | --- | --- |
| R01 | Project/Task/Agent拥有平台无关ID，外部引用可为空 | 领域创建入口与Store，创建和恢复时 | 拟调整；当前issue-N/projectRoot不满足完整目标 |
| R02 | 指派、Binding、执行资格、启动分开 | 业务应用服务/协调器，在指派、认领、启动时 | 绑定不等于start已有；新领域身份需接入 |
| R03 | 核心创建/指派/交接/完成不得要求Issue或gh | 核心命令与端口依赖检查；本地场景验收 | 拟调整；禁止用虚构Issue“实现”本地模式 |
| R04 | 子Task关系、子会话关系、ProjectAgent身份分别记录 | 分解/委派入口，持久化时 | 旧两类执行方式可复用，目标关联需补齐 |
| R05 | provider能力满足交互/续聊/恢复/取消需求 | 执行入口，创建前 | DSH已有能力检查；A²D²策略与CLI完整会话化需补 |
| R06 | 工作目录和检出显式，不能从GitHub项目或prompt路径推断 | ExecutionContext解析与权限检查，派发/工具执行前 | 宿主cwd事实已有；跨目录编排拟调整 |
| R07 | 同一Task只授予一个有效协调资格，允许受控并行工作者 | 同一协调权威，在认领、交接和受控副作用前 | 本地机制可复用；多机共享和强围栏不假定已实现 |
| R08 | 会话换代不改变Task、Agent或业务阶段 | 交接过程和领域身份校验 | 原交接基础已有，新引用需改造 |
| R09 | 共享协调会话的Task显式寻址并有序驱动 | 会话级调度与任务事件入口 | 待确认具体方案，不能直接放开旧一会话一Task |
| R10 | 接受、入队、消费、验收成功分别记事实 | Store、inbox、DSH、负责Agent各自时点 | 部分技术基础已有，统一查询语义拟调整 |
| R11 | 无resume能力的CLI不声称可冷恢复；重试前核查副作用 | provider适配与恢复器 | 已有one-shot基础，完整恢复能力待补 |
| R12 | 外部同步不能授予执行权，也不能让过期快照倒退核心事实 | 适配器 + 核心版本/权限调和，在导入与发布时 | 拟调整；不能把GitHub评论当CAS |
| R13 | Task完成必须有验收事实，但不以关闭Issue为普遍前提 | 有权限的负责Agent确认；领域服务持久提交 | 保留验收要求，修订旧GitHub强依赖顺序 |
| R14 | 完成、执行释放、父通知和外部同步可恢复且状态可分辨 | 完成长流程与inbox/outbox | 当前存在多提交窗口；正式聚合/时序阶段补足 |

**事实权威表**：

| 事实 | 权威记录 | 外部/查询侧含义 |
| --- | --- | --- |
| 已接受的任务目标、规格、指派、阶段、验收和完成 | WorkRecordStore的领域版本 | GitHub是协同表示与外部输入源；外部变更未经接纳不是已提交领域事实 |
| 当前执行owner/epoch、交接步骤、待投递事件 | ExecutionCoordinationStore | Issue评论或字段只是可见摘要，不具有授权效力 |
| 会话/子会话真实运行与消息消费 | DSH日志及provider结果 | 配置候选、进程退出或外部label不能代替真实运行证据 |
| GitHub Issue是否已关闭、PR检查结果 | GitHub自身 | 本地保存最后观察和同步进展，不能伪称远端已成功 |
| 外部与领域身份的关联 | ExternalBinding映射及唯一索引 | 外部URL变化/解绑不能重建Task身份 |

这不是允许两边无条件互相覆盖：一边持有已接受的领域事实，另一边持有自己的外部工作项事实；发生差异时走明确调和流程。

## 8. 本地与GitHub的关联、同步和切换

### 8.1 ExternalBinding的最低语义

```yaml
# 拟议示例；非现有产品配置
projectId: project-uuid
agentId: agent-uuid
taskId: task-uuid
# 上述对象独立存在；下列映射可以完全没有
externalBinding:
  provider: github
  domainType: task
  domainId: task-uuid
  externalType: issue
  externalId: github-issue-node-id
  displayUrl: https://github.com/owner/repo/issues/112
  lastPublishedDomainRevision: 8
  lastObservedExternalRevision: opaque-observation
  syncStatus: pending
```

核心对象不要求issueId字段。外部标识属于适配记录，不作为TaskId类型的另一种分支。Project、Repository关联也使用相同原则。

### 8.2 发布、导入和冲突

- **发布**：本地命令提交后保存待发布操作及稳定operationId；适配器发布对应版本，回写成功/失败/结果未知。outbox和领域变更是否共事务必须在实现契约中保证，不能图上画一条箭头就假定。
- **远端创建结果未知**：先核对已有ExternalBinding及远端受管标记，不因HTTP超时盲目再建Issue。GitHub未提供的原生幂等保证不能凭空补上；无法确定时停在可见unknown状态。
- **导入**：外部状态带来源、对象ID、观察版本和上次同步基线。适配器生成变更请求，核心检查权限、当前领域版本、任务状态和执行占用。
- **冲突**：本地与远端同时改同一业务字段，或执行中改负责人/关闭/重开时，不能静默“最后写入者获胜”。保存双方事实和明确冲突；涉及执行安全时暂停相关变更或在安全边界处理，具体策略第二阶段定稿。
- **防回环**：记录已发布领域版本、来源事件身份与已处理外部观察，避免自己发布的更新再次被导入成新的业务变更。

### 8.3 两方向切换

| 切换 | 保持不变 | 需要处理 | 不允许发生 |
| --- | --- | --- | --- |
| 本地 → GitHub协同 | Project/Task/Agent ID、执行锁、会话、父子关系、历史证据 | 配置适配器；可关联已有外部项或发布新项；冲突和重复映射可见 | 因创建Issue重新生成Task；再次启动同一个工作 |
| GitHub协同 → 本地 | 完整领域记录、规格与验收、当前执行、队列和恢复点 | 停用外部发布/导入；保留ExternalBinding、上次同步事实和未完成同步操作，供以后恢复 | 删除远端Issue、遗失只存在外部的必需内容、释放后重复授予执行资格 |
| GitHub暂时不可用 | 核心任务与本地已确认事实 | 同步显示pending/error/unknown；涉及远端业务操作的任务明确受阻 | 自动生成另一个Task或另一位owner，或声称远端已更新 |
| 恢复连接 | 原领域身份和执行结果 | 按最后同步版本调和，不用旧远端快照覆盖离线产生的新成果 | 无条件以远端“Open”把本地已验收Task重新启动 |

**切换到本地的必要内容条件**：目标、规格、验收标准、完成判断所需的证据必须在本地持久保存或可解析取得，不能只有一个Issue URL。大文件是否缓存、外部证据不可用时如何表示，属于资源契约；但“只有URL没有任务内容”的记录不能被宣称可独立本地运行。

**切换协同方式不等于迁移执行宿主**：如果还要换机器或复制记录，必须处理协调权威、旧执行停止和资源路径映射。保留TaskId不代表复制文件就安全转移了锁。

## 9. CLI执行与平台无关的关联

v2关于DSH能力的核查继续有效：已有Codex/Claude one-shot provider，裸bash CLI不会自动变成DSH子会话，持久子会话和冷恢复需额外适配。[DSH-codex]、[DSH-claude]、[DSH-start]、[DSH-out-of-process]

本轮进一步要求它们统一携带的是 `ProjectId / AgentId / TaskId / ExecutionId / DelegationId`，不是 `issueId`。结果使用平台无关的EvidenceRef与StopReason；可选ExternalBinding只负责导航与协同。

父结果回传、取消进程树、实际cwd、native thread映射、恢复能力和未结算执行枚举都与GitHub无关。没有GitHub配置不能成为provider拒绝执行的理由；缺少模型凭据、执行权限或所需能力则仍须明确拒绝。

## 10. 领域到当前实现的映射

| 能力 | 状态 | 现有依据 | 实施差距 / 修订影响 |
| --- | --- | --- | --- |
| 未绑定Issue的旧Task记录 | 已实现 | [Task.issue可选][I-task-types]、[TaskDocumentStore][I-store] | 仅证明本地文档可存在，不证明新ProjectAgent/无Issue托管全链路已实现 |
| 本地交接、运行记录、inbox、执行围栏 | 已实现 | [I-start]、[I-rotate]、[I-inbox]、[I-guard] | 大量机制可复用；现有BoundTask和issue-N入口仍需替换 |
| 平台无关ProjectId/TaskId及核心命令 | 拟调整 | v2以GitHub node为身份；当前代码以路径/编号关联 | 独立ID、稳定引用、迁移和兼容映射；不使用虚构Issue编号 |
| 完整WorkRecordStore本地实现 | 拟调整 | 当前本地Task主要记录执行关联，规格/验收常在Issue | 需补齐本地业务内容、证据、版本、幂等与查询；存储技术待确认 |
| ProjectAgent与角色模板 | 拟调整 | 当前全局角色表与主会话推导CEO，[Agent 原定义][A04]、[会话身份账本][I-session-agent] | 归属领域Project，不再需要GitHubProject或账号 |
| ExternalBinding及可选GitHub协同端口 | 拟调整 | 当前watch部分外部事件已有；完整发布/导入与映射未实现 | 外部ID独立、去重、冲突、outbox、切换和断网语义 |
| 本地验收/完成不先关Issue | 拟调整 | [CEO-complete]仍要求gh；[I-complete]只检查本地主会话 | 改方法与工具契约，保留验收含义；外部关闭改为可选同步 |
| DSH Session/ChildSession/cwd/Workspace | 已实现 | [DSH-session]、[DSH-child]、[DSH-workspace] | 复用宿主事实；业务Project不映射成目录 |
| native与外部one-shot provider | 已实现 | [DSH-provider]、[DSH-codex]、[DSH-claude] | 指源码能力，非当前GUI全部启用；运行输入需关联TaskRef |
| CLI完整持久子会话统一 | 待确认 | [DSH-out-of-process]、[DSH-start] | 需能力扩展与恢复契约，不能用PID代会话 |
| 一协调会话服务多Task | 待确认 | 现有反向绑定限制及独立task循环 | 会话级有序调度、显式TaskRef和交接集合需后续设计 |
| 跨机器执行互斥 | 待确认 | 当前文件owner锁限同机/PID命名空间 | 所有参与runtime需共享协调权威；GitHub评论不能替代 |
| 项目任务整页 | 已有设计但未实现 | [Issue #70][Q70]及旧原型 | 展示本地领域任务；外部链接缺失为正常，不再从GitHub视图推断全部任务 |
| 原“tracker唯一真相”和完成顺序文档 | 拟调整 | [ADR 0003][A03]、[CEO职责][CEO]、[WAKE][WAKE] | 改为领域记录与外部协同边界；本轮只在评审稿明确替代口径，正式批准后同步真源 |

“已实现”来自既有静态源码证据，不代表已执行本轮本地模式验收。现有运行器不主动访问GitHub的事实，也不意味着所有上层工具和CEO方法已经解除Issue依赖。

## 11. 双模式检查清单与本轮建议

### 11.1 设计验收用例（后续实现必须验证）

| 用例 | 条件 | 期望结果 |
| --- | --- | --- |
| L1 无GitHub创建 | 无GitHub token、无gh、无Issue、无remote仓库 | 创建Project/Agent/Task，规格与验收内容本地可读，TaskId有效 |
| L2 无Issue执行 | L1任务，DSH/模型和目录权限可用 | 指派、取得执行资格、启动与委派成功，不要求补Issue |
| L3 本地接续 | 执行中交接/宿主重启，GitHub不可达 | 同Task/Agent身份恢复，事件与接续材料完整，旧owner受围栏约束 |
| L4 本地验收完成 | 本地评审与证据满足任务标准 | 任务完成、执行收口、父通知可查；不调用GitHub关闭接口 |
| G1 后关联GitHub | 已运行的本地Task关联Issue或发布新Issue | 原TaskId、会话与锁不变；出现ExternalBinding与同步状态 |
| G2 断网后完成 | 已关联Issue，GitHub网络中断，验收无远端业务依赖 | 本地任务可完成；Issue关闭待同步，不假报成功 |
| G3 重复导入/发布超时 | 同外部Issue重复输入，或创建响应丢失 | 不盲目新建Task/Issue；通过映射和受管标记核实，不能确定则报告unknown |
| G4 双边并发修改 | 本地继续推进，远端改负责人或重开 | 保存冲突/观察，经版本与权限调和；不直接越过执行锁 |
| X1 退出GitHub协同 | 停用适配器，但有未同步操作 | 本地继续运行，保留外部映射/待同步事实；不删除远端工作项 |
| X2 切换后身份稳定 | 本地→GitHub→本地 | Task/Agent/Project、父子关系和证据不丢，不重复启动 |

这张表是目标验收标准，本轮是文档审查，**没有宣称上述用例已通过产品实测**。

### 11.2 建议保留

- ProjectAgent统一职责身份；CEO仍只是角色，会话是执行载体。
- Task/Session、Stage/Generation、Subtask/ChildSession各自独立。
- DSH能力复用、显式目录/资源、统一provider入口、显式执行资格和安全交接。
- 验收事实决定完成；执行结束或CLI退出不代表业务成功。

### 11.3 建议调整

- 撤销v2的GitHub主键依赖：Project/Task/Repository均使用领域身份，外部引用可为空。
- 把完整规格与验收信息纳入本地工作记录，而不只保存Issue指针。
- 把“写Issue绑定”改为“保存领域关联；可选发布外部摘要”。锁始终属于执行协调机制。
- 把“必须先关Issue”改为“验收后提交Task完成；有关联时独立同步外部关闭”。
- 重写CEO/工具契约中的强制gh读取路径；有外部关联时可用gh/适配器辅助，但本地记录必须足够接续。

### 11.4 待确认的实施选择（不影响本轮确认GitHub非必要）

1. WorkRecordStore与协调存储使用何种本地技术、哪些动作同事务；由聚合不变量决定。
2. GitHub导入/发布支持哪些字段、冲突如何裁决、哪些外部动作需要显式确认。
3. 大附件与外部证据的本地可用性、导出/备份格式与迁移流程。
4. 共享协调会话、多runtime互斥和CLI持久子会话化的能力范围。

## 12. 下一阶段与交付说明

第一阶段范围不变。评审确认抽象后，下一阶段围绕**平台无关Task/ProjectAgent、执行资格、交接操作、委派和ExternalBinding/outbox**完善聚合图、状态图与关键时序。必须覆盖本地提交失败、外部结果未知、重复事件、并发认领、断网、恢复和模式切换，不能只画GitHub正常路径。

三张主图提供JSON可编辑源、HTML离线查看/导出页和SVG。JSON为编辑真源；修改后重新渲染与导出，保持正文/图源/静态图一致。

- [业务场景 JSON](diagrams/a2d2-ddd-v3/01-business.workflow.json) · [HTML](diagrams/a2d2-ddd-v3/01-business.html) · [SVG](diagrams/a2d2-ddd-v3/01-business.svg)
- [子域全景 JSON](diagrams/a2d2-ddd-v3/02-subdomains.architecture.json) · [HTML](diagrams/a2d2-ddd-v3/02-subdomains.html) · [SVG](diagrams/a2d2-ddd-v3/02-subdomains.svg)
- [上下文 JSON](diagrams/a2d2-ddd-v3/03-contexts.architecture.json) · [HTML](diagrams/a2d2-ddd-v3/03-contexts.html) · [SVG](diagrams/a2d2-ddd-v3/03-contexts.svg)

**来源说明**：源码引用固定到基线提交。旧ADR证明现有设计，不证明v3新契约已实现；本轮用户明确的“无GitHub也可运行”要求优先于旧GitHub绑定假设。此前GitHub接口能力核查的结论仍适用：未证实的字段/评论CAS能力不能用于实现执行锁。[GH-issues-api]、[GH-projects-api]

[A03]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/docs/adr/0003-tasks-live-in-the-tracker.md
[A04]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/docs/adr/0004-agent-is-models-plus-two-level-configuration.md
[CEO]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/ceo/AGENTS.md
[CEO-complete]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/ceo/AGENTS.md#L17
[DSH-bash-cwd]: https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/shell/tool-bash/src/index.ts#L144
[DSH-child]: https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/subagent/subagent/src/child-agent.ts#L139
[DSH-claude]: https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/subagent/subagent-claude-code/src/index.ts#L73
[DSH-codex]: https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/subagent/subagent-codex/src/index.ts#L63
[DSH-out-of-process]: https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/subagent/subagent/src/out-of-process.ts#L237
[DSH-provider]: https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/subagent/subagent/src/types.ts#L299
[DSH-session]: https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/core/session/src/types.ts#L91
[DSH-start]: https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/subagent/subagent/src/index.ts#L559
[DSH-workspace]: https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/workspace/workspace/src/types.ts#L57
[GH-issues-api]: https://docs.github.com/en/graphql/reference/issues
[GH-projects-api]: https://docs.github.com/en/graphql/reference/projects
[I-bind]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/index.ts#L646
[I-complete]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/index.ts#L769
[I-guard]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/task-runtime/runner.ts#L195
[I-inbox]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/task-runtime/store.ts#L24
[I-rotate]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/task-runtime/runner.ts#L352
[I-session-agent]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/session-agents.ts#L142
[I-start]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/task-runtime/runner.ts#L78
[I-store]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/store.ts#L198
[I-task-types]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/src/types.ts#L43
[Q70]: https://github.com/a2d2-dev/dsh-plugin/issues/70
[WAKE]: https://github.com/a2d2-dev/dsh-plugin/blob/6c9ccb6f0d5d2caea7275fc798caf36436af4f69/ceo/WAKE.md
