# Project14 真实 Issue 与 v3 原型衔接研究

本笔记先依据本地第一方源码做静态研究，后追加主 agent 已保存的 API 快照统计；未调用浏览器、访问远端或修改产品/原型。目标入口由用户提供：[Project14 / view9 / imneov slice](https://github.com/orgs/theriseunion/projects/14/views/9?sliceBy%5Bvalue%5D=imneov)。源码分析不推断 Project14 业务数据；下方“API 快照补证”给出实际观察、统计口径和仍未知事项。主 agent 已恢复 gh 认证，后续正文、评论、PR 和完整原生关系的远端分析由其补充。

## 结论与边界

当前交互基线是 [DSH 控制面板原型](../prototypes/task-interaction-v3-dsh.prototype.html#L12)，不是早期独立工作台；[确认记录](../prototypes/task-interaction-v3-accepted.md#L11) 要求保留具体项目上下文、Issue 详情和当前/历史/评审会话的区别。原型内所有 Issue、PR、会话都是模拟，不能拿示例编号补齐真实 Project14。

领域上 Project、Task、Project Membership 分别成立，同一工作进入不同视图不生成新身份；需求块也不必创建子 Issue。[CONTEXT.md:9–19](../../CONTEXT.md#L9)、[CONTEXT.md:41–47](../../CONTEXT.md#L41)。导入需要分别保存以下关系，不能压成一棵通用“任务树”。

| 关系 | 从真实来源采集的最小字段 | 原型与当前源码的具体落点 / 限制 |
| --- | --- | --- |
| Project 收录与 view | Project node ID、owner/type/number/title/url；item ID、content 类型、archived；view ID/number/name、filter、显示字段、分组/排序、slice 字段与值；字段 ID/type/value，并保留读取完整性 | 原型 `projectViews/projectRows/projectsPage` 在 [原型:48](../prototypes/task-interaction-v3-dsh.prototype.html#L48)，目前是固定五个模拟视图。`ProjectEntry.parse` 在 [原型:130](../prototypes/task-interaction-v3-dsh.prototype.html#L130) 将 URL 归一到 Project，丢弃 view9 和 slice。当前 [ProjectSnapshot / GitHubProjectItem](../../src/work-sources/types.ts#L13) 保存收录及部分字段，没有 view 定义；[查询:12](../../src/work-sources/project.ts#L12) 也未取 views。需要单独保留原始入口与展示配置，不能用 Project 来源查询冒充 view9。 |
| Issue 身份与要求 | node ID、规范 URL、repository owner/name、number、title、完整 body、assignees、labels、state、updatedAt、observedAt；保留正文中验收段落及来源 | 原型 `issueTable/issuePage` 的概览对应 [原型:45](../prototypes/task-interaction-v3-dsh.prototype.html#L45)、[原型:58](../prototypes/task-interaction-v3-dsh.prototype.html#L58)；产品 [原文区](../../src/client/work-panel.tsx#L50)。导入保存正文，但 acceptance 初始为空且标记待确认，见 [application:123](../../src/work-sources/application.ts#L123)。不可将正文中的勾选状态自动判成验收结论。 |
| 原生 parent/subIssues | 两端 node ID、repo/number/url/title/state，原生 parent，subIssues 总数、已取条目与分页信息；补齐视图之外的必要祖先/后代并标记其不在当前筛选范围 | 原型 `parts/partTree/child-info` 在 [原型:52](../prototypes/task-interaction-v3-dsh.prototype.html#L52)、[原型:97](../prototypes/task-interaction-v3-dsh.prototype.html#L97)；产品分开显示 [Requirements](../../src/client/work-panel.tsx#L87) 与 [NativeIssueRelations](../../src/client/work-panel.tsx#L292)。`WorkTask.parent/children` 与 `BreakdownBlock.child` 是独立本地关系，见 [类型:28](../../src/work-types.ts#L28)。显式 import/link 才连接同项目中已经导入的亲属，防止不同父亲与环，见 [application:14](../../src/work-sources/application.ts#L14)。仅浏览/发现不创建本地父子关系。 |
| dependencies | 有向边：谁 blocked by 谁 / 谁 blocks 谁；两端稳定身份、关系来源（原生 API 或正文/评论引用）、观察时间、完整性；正文推断另列为待确认 | 放到 Issue“相关工作”中独立的“依赖 / 被依赖”区域，不复用父子树。当前 [GitHubIssue](../../src/work-sources/types.ts#L6) 与 [WorkTask](../../src/work-types.ts#L32) 没有结构化依赖边；[TaskReport.blockers](../../src/work-progress.ts#L15) 只有文本。真实依赖既不能自动变 parent，也不能仅靠 title/标签推断。此处是衔接建议，尚未实现。 |
| PR 与 Issue | PR node ID、repo/number/url/title、draft/open/closed/merged、关联 Issue 及关系性质（关闭关联或普通引用）、head SHA、checks、review decision 与观察时间；允许一个 Issue 多 PR / 一个 PR 多 Issue | 原型 [PR 列表:47](../prototypes/task-interaction-v3-dsh.prototype.html#L47)、[相关工作:60](../prototypes/task-interaction-v3-dsh.prototype.html#L60) 有落点，但模拟 PR 只指向一个 Issue，编号查找缺少仓库维度。产品 Project 查询仅取 PR title/url，见 [project:35](../../src/work-sources/project.ts#L35)；不能据此声称已具备真实 PR 检查/评审模型。PR 合并不自动证明任务验收，见 [CONTEXT:165](../../CONTEXT.md#L165)。 |
| 当前、评审、历史会话 | 这些信息来自本地 DSH：TaskRef、ExecutionId、SessionRef(runtimeId/sessionId)、owner/epoch、当前 session、retired、关联 purpose；GitHub 只提供外部身份供连接 | 原型 [issuePage:56](../prototypes/task-interaction-v3-dsh.prototype.html#L56) 已区分处理历史与其他关联；产品 [Sessions:189](../../src/client/work-panel.tsx#L189)、[CurrentExecution:203](../../src/client/work-panel.tsx#L203)。当前由 execution.session 决定，历史由 retired 决定，评审由关联 purpose 决定，见 [work:946](../../src/work.ts#L946)。不能从最近评论、assignee、最新打开会话或 PR 评审者推断控制权。 |
| 验收完成与外部状态 | 分别采集 Issue state、Project status 字段、PR state、最后观察时间；本地另存规格版本、逐条标准/证据/结论、未完成子工作与执行收口状态 | 原型 [概览:58](../prototypes/task-interaction-v3-dsh.prototype.html#L58) 与 [同步提示:62](../prototypes/task-interaction-v3-dsh.prototype.html#L62) 可分别展示；产品 [SourceBinding:276](../../src/client/work-panel.tsx#L276) 保留 accepted 与 lastObserved。当前 done 必须通过当前规格全部验收、解决阻塞、完成所有需求块和已链接子任务，见 [work-progress:38](../../src/work-progress.ts#L38)。原型的关闭重试是模拟，实际契约声明 `githubWrite:false`，见 [work-types:144](../../src/work-types.ts#L144)。 |

## 父任务与子任务如何避免重复接活

**已经存在的保护：**

- 同一外部 Issue 通过 node ID 和规范 URL 定位唯一 TaskRef；跨本地项目重复导入返回既有 canonical TaskRef 冲突，不产生副本，见 [application:95](../../src/work-sources/application.ts#L95)。不能只用 `#number`，Project 可能包含不同仓库的同号 Issue；[application:141](../../src/work-sources/application.ts#L141) 已显式拒绝这类歧义。
- 持续处理按完整 Project 收录、非归档 Issue、open、负责人、全部标签匹配，队列按 node ID 去重，见 [work-continuous:29](../../src/work-continuous.ts#L29)。领取时同事务预约导入、执行与槽位；若同一个 Task 已有执行则跳过并保留原 owner，见 [work:326](../../src/work.ts#L326)。显式 start 也复用或拒绝已有执行，并禁止共用当前/退役协调会话，见 [work:787](../../src/work.ts#L787)。
- 等待可以让出推进槽位而保留执行身份，见 [work:245](../../src/work.ts#L245)。后续输入属于原执行事件，不是新 Issue 候选，领域定义见 [CONTEXT:139](../../CONTEXT.md#L139)。

**仍缺失的保护：**上述去重针对“同一个 Issue/Task”，不是“父子执行范围重叠”。候选扫描与领取没有检查祖先执行、子任务覆盖或 dependencies；父子是两个 node ID，均匹配时仍可能先后各启动一次。每规则串行也不能避免重复工作，尤其父任务等待时释放槽位后。

原型以两种简化掩盖此问题：子 Issue 嵌在父 `parts` 里而不是独立候选；`add-work` 检查嵌套编号后返回父任务，`child-info` 直接打开父会话，见 [原型:95](../prototypes/task-interaction-v3-dsh.prototype.html#L95)。该逻辑不代表每个真实子任务都应由父会话执行，也不满足跨仓库身份要求；并且添加入口目前被 [增补样式:117](../prototypes/task-interaction-v3-dsh.prototype.html#L117) 隐藏。

**建议的导入与领取顺序（待设计实现，不是现有行为）：**

1. 先完成身份归一、Project 收录、原生层级、依赖边的观察，保留“未知/部分读取”状态。展示关系可以先于创建本地任务；不要因缺失的亲属被筛掉就判定它不存在。
2. 分别记录“父任务协调、子任务独立执行”与“父任务已明确覆盖该子范围”。父子身份始终保留；对后者记录覆盖者 TaskRef/ExecutionId、范围与依据，让子候选显示“由父任务处理”，导航到实际协调者。对前者允许子任务取得自己的执行，父任务仅协调/汇总/验收，不再实现同一部分。
3. 不按 parent 存在与否一律屏蔽全部子任务，也不自动把父会话变成所有子任务的当前会话。覆盖关系未确认、依赖未满足或层级读取不全时，候选保留待判断原因，不据此自动启动。覆盖关系与“父任务协调、子任务独立执行”的策略需要新契约，现有 `parent/children` 不表达它们。
4. 将 canonical Task、执行占用、父子覆盖策略、依赖资格的复查放在领取事务中；等待/暂停不能清除 owner 后重新接活。独立子任务的完成先形成自身验收事实，再向父协调者送结果；父完成不能批量把子节点改为 done。

最后一点尤其不能照搬 [原型 demo-complete:104](../prototypes/task-interaction-v3-dsh.prototype.html#L104)：它只是注入演示结果，会一次性把所有 parts/children 标为 done；真实产品有 [逐项和子任务完成门槛](../../src/work-progress.ts#L54)。原型 `progress()` 还按需求块数量展示计数，见 [原型:36](../prototypes/task-interaction-v3-dsh.prototype.html#L36)；该计数不能当加权工作完成率，领域约束见 [CONTEXT:193](../../CONTEXT.md#L193)。

## 主 agent 远端采集后需要补证的事项

- **view9 与 imneov：**读取真实视图 filter、slice 字段及默认隐藏/排序规则。URL 中 `sliceBy[value]=imneov` 单独不能证明“全部分配给 imneov 的开放 Issue”，更不能覆盖作者、评论者或评审者等其他关联。保留用户别称 MNeoV 与经验证 login/node ID 的对应。当前查询/持续规则仅接受 `@me | *`，`@me` 绑定认证账号，见 [work-types:83](../../src/work-types.ts#L83)、[work:154](../../src/work.ts#L154)；主 agent 报告已登录 imneov，仍应把这次身份观察与数据一起留证。
- **拆解的真实形状：**取得 view9 匹配条目，以及这些条目的原生祖先/后代与依赖上下文。分清真正 subissue、正文 checklist、普通引用与独立依赖；范围外亲属只作背景，不自动加入授权队列。当前查询对子 Issue 固定 `first:50` 且不取后续 cursor，字段值也是 `first:50`，见 [project:18](../../src/work-sources/project.ts#L18)。Project 全量分页结束不等于每个 Issue 的子树完整；必须记录缺页并另行补齐。
- **PR 与验收证据：**核实关联性质、实际 checks/review/head SHA，不能用开放/合并状态补造验收结论；当前导入未自动采集 comments/timeline、结构化 dependencies 或完整 PR 信息，查询边界见 [projectQuery](../../src/work-sources/project.ts#L12)。
- **会话与覆盖：**若无本地真实绑定，显示“暂无关联会话/未接入本地工作”；不能为真实 Issue 填模拟会话、token 用量、执行目录或已完成进度。下方快照已补证视图筛选、状态与项目内父子引用；真实本地会话绑定、执行覆盖、验收事实及项目外亲属完整性仍未验证。

验证方式：逐项阅读并对照上述一方类型、查询、导入、调度、进展投影及 HTML 原型；补证使用 Python 在本地聚合 API 快照，没有覆盖原始数据。本次没有运行产品、浏览器或测试。交付仅此研究文件。

## API 快照补证：view9、关闭状态与父子引用

数据来源：[project.json](../../.scratch/project14-research/project.json#L1)、[items.json](../../.scratch/project14-research/items.json#L1)、[summary.json](../../.scratch/project14-research/summary.json#L1)，汇总记录观察时间 `2026-10-21T11:57:03.525054+00:00`。以下统计从完整 items 逐条重算，并与 summary/inventory 核对；不把不同 API 请求之间的采集结果视为原子快照，也不将这些远端状态视为本地验收证据。

### view9 的范围

[Project 元数据:8](../../.scratch/project14-research/project.json#L8) 确认项目名为“项目管理 v3.0”，viewer 为 `imneov / LiuFeng`。view9 名称 `v3.0`、布局 TABLE_LAYOUT、filter 为 **`milestone:3.0 -is:closed`**，见 [元数据:22](../../.scratch/project14-research/project.json#L22)。`assignee:@me is:open` 属于 view8“分配给我的任务”，见 [元数据:15](../../.scratch/project14-research/project.json#L15)。视图名称不能代替真实 filter，例如 view14 名为“所有任务”，实际却有负责人、里程碑和状态排除条件，见 [元数据:43](../../.scratch/project14-research/project.json#L43)。

全项目快照为 2,987 items：2,985 Issue、2 PR。指派包含 imneov 的 231 个 Issue 全属 `theriseunion/freeland`、均未归档，其中 60 OPEN、171 CLOSED。按 view9 filter 重建的未归档集合有 **782 个 Issue**；再加 `assignees contains imneov` 得 **54 个**，不是 60 个，也不是 231 个。54 项 Project 状态分布为待处理 21、进行中 11、待上线 10、推迟解决 10、已修复 2。另 6 个开放指派项里程碑为 3.1，不在 view9 filter 内，见 [inventory:12](../../.scratch/project14-research/inventory.md#L12)。

**尚未证明的边界：**当前 project 快照只返回 view 的 id/number/name/layout/filter，没有 slice 字段定义。URL 的 slice 值为 imneov，因此 54 是“按负责人切片重建”的精确统计；在取得 slice 字段配置前，不宣称已验证浏览器该 URL 的实际可见行数。12 个由 imneov 创建但不指派给他的开放 Issue 属于关联背景，不应混入负责人切片，见 [inventory:81](../../.scratch/project14-research/inventory.md#L81)。

### 171 个 CLOSED 的 Project 状态与关闭原因

下表对 [items 快照](../../.scratch/project14-research/items.json#L1) 中 `content.__typename=Issue && assignees contains imneov && state=CLOSED` 的条目按 Status 与 stateReason 交叉计数。

| Project Status | COMPLETED | NOT_PLANNED | 合计 |
| --- | ---: | ---: | ---: |
| 已修复 | 159 | 2 | 161 |
| 不解决 | 0 | 6 | 6 |
| 推迟解决 | 0 | 2 | 2 |
| 已部署 | 2 | 0 | 2 |
| 合计 | 161 | 10 | 171 |

其中“已修复 + NOT_PLANNED”为 [#1492](https://github.com/theriseunion/freeland/issues/1492)、[#2823](https://github.com/theriseunion/freeland/issues/2823)；“推迟解决 + NOT_PLANNED”为 [#1552](https://github.com/theriseunion/freeland/issues/1552)、[#2100](https://github.com/theriseunion/freeland/issues/2100)。其余 NOT_PLANNED 六项是 [#1062](https://github.com/theriseunion/freeland/issues/1062)、[#1994](https://github.com/theriseunion/freeland/issues/1994)、[#2329](https://github.com/theriseunion/freeland/issues/2329)、[#2549](https://github.com/theriseunion/freeland/issues/2549)、[#2587](https://github.com/theriseunion/freeland/issues/2587)、[#2701](https://github.com/theriseunion/freeland/issues/2701)。这里只确认 API 返回的原因枚举，不推断每项实际为何关闭；具体理由需正文/评论或时间线补证。

另有 **OPEN + Project“已修复”** 两项：[#2114](https://github.com/theriseunion/freeland/issues/2114)、[#2384](https://github.com/theriseunion/freeland/issues/2384)。这组真实样本要求原型分别展示 GitHub state、Project Status、stateReason 和本地验收；“已修复”不能自动阻止或启动执行，也不能自动写成 Task done。

### 231 个指派项的原生 parent 分布

以 [items 快照](../../.scratch/project14-research/items.json#L1) 的 `content.parent.id` 为准，不解析标题中的“母单”或正文引用：**98 项有 parent（14 OPEN、84 CLOSED），133 项 parent=null（46 OPEN、87 CLOSED）**。98 个 parent 引用指向 28 个不同父 Issue，全部能在本次全项目快照按 node ID 解析。79 项的父负责人包含 imneov；19 项的父负责人不含 imneov。后者包括 3 OPEN、16 CLOSED；不能因负责人过滤把这些父节点当成不存在。

以下是全部 28 个父节点分布；“子项数”只计算指派包含 imneov 的直接子项，**不是父 Issue 的全量 subIssues 数**。父状态与负责人取全项目快照中的父对象。

| 父 Issue | 父 state | 父负责人 | 子项数：总 / OPEN / CLOSED |
| --- | --- | --- | ---: |
| [#29](https://github.com/theriseunion/freeland/issues/29) | OPEN | darrentangdt | 2 / 0 / 2 |
| [#562](https://github.com/theriseunion/freeland/issues/562) | CLOSED | wuxs, imneov | 2 / 0 / 2 |
| [#857](https://github.com/theriseunion/freeland/issues/857) | CLOSED | imneov | 4 / 0 / 4 |
| [#1401](https://github.com/theriseunion/freeland/issues/1401) | CLOSED | Wangmin362 | 2 / 0 / 2 |
| [#1455](https://github.com/theriseunion/freeland/issues/1455) | OPEN | ZhangYanJun11 | 4 / 1 / 3 |
| [#1590](https://github.com/theriseunion/freeland/issues/1590) | CLOSED | imneov | 1 / 0 / 1 |
| [#1767](https://github.com/theriseunion/freeland/issues/1767) | OPEN | imneov | 1 / 1 / 0 |
| [#1994](https://github.com/theriseunion/freeland/issues/1994) | CLOSED | imneov | 1 / 0 / 1 |
| [#2092](https://github.com/theriseunion/freeland/issues/2092) | CLOSED | imneov | 3 / 0 / 3 |
| [#2104](https://github.com/theriseunion/freeland/issues/2104) | OPEN | imneov | 4 / 3 / 1 |
| [#2114](https://github.com/theriseunion/freeland/issues/2114) | OPEN | imneov | 4 / 0 / 4 |
| [#2127](https://github.com/theriseunion/freeland/issues/2127) | CLOSED | imneov | 7 / 0 / 7 |
| [#2135](https://github.com/theriseunion/freeland/issues/2135) | OPEN | imneov | 3 / 2 / 1 |
| [#2271](https://github.com/theriseunion/freeland/issues/2271) | CLOSED | wuxs, imneov | 5 / 0 / 5 |
| [#2272](https://github.com/theriseunion/freeland/issues/2272) | OPEN | imneov | 2 / 2 / 0 |
| [#2329](https://github.com/theriseunion/freeland/issues/2329) | CLOSED | imneov | 1 / 0 / 1 |
| [#2384](https://github.com/theriseunion/freeland/issues/2384) | OPEN | imneov, dracula911 | 3 / 0 / 3 |
| [#2601](https://github.com/theriseunion/freeland/issues/2601) | CLOSED | imneov | 2 / 0 / 2 |
| [#2633](https://github.com/theriseunion/freeland/issues/2633) | OPEN | wuxs | 11 / 2 / 9 |
| [#2651](https://github.com/theriseunion/freeland/issues/2651) | CLOSED | imneov | 1 / 0 / 1 |
| [#2694](https://github.com/theriseunion/freeland/issues/2694) | CLOSED | imneov | 2 / 0 / 2 |
| [#2701](https://github.com/theriseunion/freeland/issues/2701) | CLOSED | imneov | 2 / 0 / 2 |
| [#2704](https://github.com/theriseunion/freeland/issues/2704) | CLOSED | imneov | 1 / 0 / 1 |
| [#2851](https://github.com/theriseunion/freeland/issues/2851) | CLOSED | imneov | 1 / 0 / 1 |
| [#2854](https://github.com/theriseunion/freeland/issues/2854) | CLOSED | imneov | 15 / 0 / 15 |
| [#2987](https://github.com/theriseunion/freeland/issues/2987) | CLOSED | imneov | 3 / 0 / 3 |
| [#2995](https://github.com/theriseunion/freeland/issues/2995) | CLOSED | imneov | 8 / 0 / 8 |
| [#3342](https://github.com/theriseunion/freeland/issues/3342) | OPEN | imneov | 3 / 3 / 0 |

**开放子任务没有已关闭父 Issue：14 项的直接父均 OPEN。** 其中跨负责人的三项为 [#1537 → #1455](https://github.com/theriseunion/freeland/issues/1537)（父负责人 ZhangYanJun11）、[#2638 → #2633](https://github.com/theriseunion/freeland/issues/2638) 和 [#2646 → #2633](https://github.com/theriseunion/freeland/issues/2646)（父负责人 wuxs）。其他 11 项的父也指派 imneov：#563/#1395/#2114 → #2104；#1768 → #1767；#1671/#1672 → #2272；#2354/#2355 → #2135；#3025/#3026/#3270 → #3342。完整开放列表见 [inventory:18](../../.scratch/project14-research/inventory.md#L18)。其中 #1671 属 3.1，不在 view9 内，故 view9 的 54 个负责人条目中有 **13 个**带 parent。

反向从全项目所有 Issue 的 parent 引用看：231 个指派项中有 **25 个作为父节点**，项目内共观察到 **82 个直接子项**，其中 79 个指派 imneov、3 个不指派他。三个范围外子项是 [#2708 → #1767](https://github.com/theriseunion/freeland/issues/2708)（OPEN，jason0730）、[#2979 → #3342](https://github.com/theriseunion/freeland/issues/2979)（OPEN，wuxs）、[#2460 → #1365](https://github.com/theriseunion/freeland/issues/2460)（CLOSED，无负责人）。这些边说明“我的任务”列表不能代表父任务的完整工作范围。

还有多层关系：#2114、#2651、#2704、#2995 同时是子节点和父节点。例如 **#2104 → #2114 → #2651 → #2702**，以及 **#2987 → #2995 → #3027**，均由该快照 parent 引用重建。原型需支持递归导航、每层独立状态及覆盖策略，不能只展平为一层 `parts.children`。

**完整性限制：**上述反向统计只覆盖 Project14 已收录的 Issue；项目外子项不会出现在 items 里，故 82 不能当作这 25 个父 Issue 在 GitHub 上的全部子项数。完整 subIssues、依赖边及关闭评论由主 agent 正在进行的另一采集补齐，本次没有重复远端请求。以上源自快照的结论取代前文对应待补证项；slice 字段、项目外关系及本地执行覆盖仍需后续验证。

