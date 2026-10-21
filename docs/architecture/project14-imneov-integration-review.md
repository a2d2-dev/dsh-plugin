# Project14：imneov 的真实工作结构与任务交互整合建议

## 结论

可以整合，而且现有 DSH 控制面板、Issue 详情、标题旁关联任务入口、会话接续页都可以保留。需要调整的是来源视图、父子/依赖关系、状态和执行范围的表达，不能只把原型里的示例标题换成真实 Issue 标题。

建议下一版首先用 [#3342 镜像仓库遗留问题收尾](https://github.com/theriseunion/freeland/issues/3342) 的真实父子结构作为主场景，以 [#2104 插件交付与安装闭环](https://github.com/theriseunion/freeland/issues/2104)、[#2272 账号生命周期](https://github.com/theriseunion/freeland/issues/2272)、[#2633 RoleTemplate-only](https://github.com/theriseunion/freeland/issues/2633) 补充多层、跨迭代、跨负责人场景。本轮仅作分析与资料整理，未修改 GitHub 或当前 HTML 原型。

## 读取范围与统计口径

入口：[Project14 / view9 / imneov](https://github.com/orgs/theriseunion/projects/14/views/9?sliceBy%5Bvalue%5D=imneov)。GitHub 已认证账号为 `imneov`，显示名 LiuFeng；本次按链接及该账号解释用户说的 MNeoV。

2026-10-21 分页读取全部 **2,987 个 Project 条目：2,985 个 Issue、2 个 PR**。主集合为 assignees 包含 imneov 的全部 Issue，而不是仅查看当前页面。详细读取主集合以及本人创建的其他 Issue、必要亲属，共 **251 个 Issue、1,520 条评论**。已读取详情对象的原生子项、依赖、评论和 PR 关闭关联/交叉引用均已翻页至结束。原始数据分多次请求取得，不是事务快照；主集合的 state/updatedAt 在条目读取与详情读取之间未观察到变化。

| 范围 | 数量 | 用途 |
|---|---:|---|
| 分配给 imneov 的全部 Issue | 231 | 主要研究对象；均位于 theriseunion/freeland |
| 其中 Open | 60 | 当前待推进的工作范围，不等于全部可以自动启动 |
| 其中 Closed | 171 | 历史交付、撤销/不计划及关系变更的背景 |
| Open 且 milestone=3.0 | 54 | 按 view9 filter 再叠加负责人条件重建 |
| Open 且 milestone=3.1 | 6 | 不在 view9 的里程碑范围内 |
| 本人创建、但未指派给本人的 Issue | 16 | 12 Open、4 Closed，单列为关联背景 |
| 额外亲属背景 | 4 | 用于说明范围外父子和依赖，不混进我的队列 |

“所有相关”在本报告中具体指负责人集合、作者集合及其必要关系背景；没有把整个 Project 中每一个被评论、被提及或参与评审的 Issue 都作为个人待办。不能据这份清单宣称覆盖全部参与者关系。

231 个直接指派项中，**98 个有原生父 Issue，25 个自身又有子 Issue**；两组可以重叠。直接子项合计 82 个，已与这些父项的完整 subIssues 结果核对。实际存在四层链条，父单与子单的负责人、迭代也不必相同。

完整逐项数据见 [Issue 清单](project14-imneov-issue-inventory.md)。API 快照：[项目元数据](../../.scratch/project14-research/project.json)、[全量项目条目](../../.scratch/project14-research/items.json)、[详情集合](../../.scratch/project14-research/details.json)。本地接口核查见 [整合技术笔记](project14-prototype-integration-notes.md)。60 个开放负责人 Issue 的全文、244 条评论与关系已逐项阅读，九类模式和逐项覆盖索引见 [开放工作证据笔记](project14-open-issue-patterns.md)。这些评论中的测试、部署、验收属于来源声明，本轮未重新执行验收或检查全部 PR 源码/CI。

### 视图名称不能替代筛选定义

| 视图 | GitHub 实际 filter |
|---|---|
| 分配给我的任务（view8） | `assignee:@me is:open` |
| v3.0（view9） | `milestone:3.0 -is:closed` |
| 待处理（view10） | `status:待处理 or no:status` |
| v3.1（view13） | `milestone:3.1 -is:closed -status:已修复 -status:不解决` |
| 所有任务（view14） | `assignee:@me milestone:3.0 -status:已修复` |

来源：[Project 元数据](../../.scratch/project14-research/project.json)。用户 URL 还包含 `sliceBy[value]=imneov`，但此次公开 GraphQL 读取未取得该视图的 slice 字段定义；因此 54 是按“负责人 imneov”重建的结果，没有用浏览器核实该 URL 的实际可见行数。保存 Project 时应同时保留 view9 与 slice 上下文，不能把链接归一成项目首页后丢掉浏览范围。

### 60 个开放任务的 Project 状态

| Project 状态 | 数量 |
|---|---:|
| 待处理 | 25 |
| 进行中 | 11 |
| 待上线 | 10 |
| 推迟解决 | 12 |
| 已修复 | 2 |

其中两个 Open + 已修复是 [#2114](https://github.com/theriseunion/freeland/issues/2114) 与 [#2384](https://github.com/theriseunion/freeland/issues/2384)。171 个 Closed 中有 161 个 `COMPLETED`、10 个 `NOT_PLANNED`；[#1492](https://github.com/theriseunion/freeland/issues/1492)、[#2823](https://github.com/theriseunion/freeland/issues/2823) 的 Project 状态为“已修复”，关闭原因却是 `NOT_PLANNED`。这些是不同来源字段的实际组合，不能替用户自动改写为统一的“完成”。

## 真实拆分形态与对应交互

### 1. 汇总父单、独立子单与跨负责人：#3342

```text
#3342 镜像仓库遗留问题收尾 · imneov · 待处理
├─ #3270 外壳读取管理目录403 · imneov · 进行中
├─ #3025 外部镜像Tab/配置提示 · imneov · 进行中
├─ #3026 写操作迟到响应覆盖目录 · imneov · 待处理
└─ #2979 删除卡finalizer · wuxs · 范围外协作项
```

[#3342 正文](https://github.com/theriseunion/freeland/issues/3342) 明确：四张原票保留编号、负责人、规格、进度和证据；父单只提供统一入口，不重复实现；四张子单分别验收关闭后再关闭父单。#3270 已从已关闭的 #2995 移到此父单。

交互应当：

- 在父详情“相关工作”显示四个独立子 Issue，每项可以打开自己的详情及关联会话。
- 标明 #2979 由 wuxs 负责；“分配给我”的自动处理范围不因父单归我而包含它。
- 父单保留协调会话，子单可以有自己的处理/评审会话。父子任务关系不等于会话父子关系。
- 父任务和子任务都在表格中时，不能把它们作为五份互不相关的开发任务依次领取。

### 2. 多层工作线与部分交付：#2104

[#2104](https://github.com/theriseunion/freeland/issues/2104) 的直接子项是 #1395、#563、#1284、#2114；其中 #1284 Closed，其余 Open。#2114 下还有后续独立任务，可追到 `#2104 → #2114 → #2651 → #2702`。

父正文明确区分 CLI、CRD、安装性能、全新部署与后续核心组件升级；CLI 合并不代表安装、离线和性能验收完成。来源：[父单工作线与关闭门槛](https://github.com/theriseunion/freeland/issues/2104)、[#1395 缓存切片说明](https://github.com/theriseunion/freeland/issues/2104#issuecomment-6194841372)。

交互应当：支持多层关系导航；同时展示没有正式子 Issue 的工作块。计数可以写“1/4 直接子项已关闭”，不能宣称“总体完成25%”。PR、发布、实测验收按各自证据展示。

### 3. 跨迭代但不必串行：#2272

[#2272](https://github.com/theriseunion/freeland/issues/2272) 下面 #1672 是 3.0，#1671 是 3.1。父正文明确没有新增两者之间的串行 blocking，并要求看板继续平铺子单。

交互应当：保留当前表格平铺体验，用父任务列/可展开关系辅助阅读。在 v3.0 视图里打开父详情，仍可看到完整的两个子项，给 #1671 标注“3.1 · 不在当前视图”。同一父任务不等于相同迭代，也不自动产生先后依赖。

### 4. 我的子任务挂在别人的父任务下：#2633

[#2633](https://github.com/theriseunion/freeland/issues/2633) 归 wuxs，子项 #2638、#2646 是 imneov 当前开放工作；其他子项有已关闭、有未分配的开放工作。另有 #1537 的父 #1455 归 ZhangYanJun11。

交互应当：“我的任务”保留命中的子项，同时显示父任务背景；不能因为父不归我就隐藏子项，也不能据此接管父任务。多负责人也要原样显示，例如 #2646 同时指派 yangshiqi、imneov。

### 5. 评论里的工作拆分并非原生子 Issue：#2972

[#2972](https://github.com/theriseunion/freeland/issues/2972) 的原生 subIssues=0，但[进度评论](https://github.com/theriseunion/freeland/issues/2972#issuecomment-6244199284)列了 #2973–#2978、#2980–#2982 等切片与后续工作，还保留了 ai-infra 的新决定。

交互应当：“相关工作”分开呈现原生父子、工作拆解/引用、依赖与 PR。文本提及可作为待核对的关系建议，不能自动创建父子、自动继承负责人或纳入持续处理。原生结构缺失不代表没有工作拆分。

### 6. 范围更新与历史归属需要保留，但不覆盖当前结构

[#2995 最新收口评论](https://github.com/theriseunion/freeland/issues/2995#issuecomment-6313300808)依据用户“只解决 API”的范围裁定关闭任务，保留未执行项的真实状态；旧正文仍有很多更大的执行目标。后续 #3342 整理剩余问题，不代表重开 #2995。

[#2135 关系调整评论](https://github.com/theriseunion/freeland/issues/2135#issuecomment-6165203276)说明解除原生 parent，以便延期复杂日志范围；正文中仍保留历史 `Part of #2127` 与 A²D² 归属。当前 API parent=null，不能从旧标题、正文或 `a2d2:sub` 标签重建已解除的父关系。

交互应当：活动记录能展示重组/范围调整及来源；启动处理时展示已接受目标和最新范围变更，不能把整段旧正文当作所有内容仍需执行。历史记录引用会话 ID 也不能直接成为当前处理会话绑定。

## 怎样接到当前原型

| 原型区域 | 建议保留 | 需要接入的真实内容 |
|---|---|---|
| 项目选择与视图 | 单项目上下文、当前表格结构 | 真实 Project/view/filter，保留传入 view9 与负责人 slice；视图名称不硬编码语义 |
| 项目表格 | 平铺列表、搜索、标签、会话入口 | 多负责人、父 Issue、原生子项计数；Project 状态与 DSH 处理状态分开；优先级目前来自 P0/P1 标签，不伪造 Project 字段 |
| Issue 概览 | 标题、要求、进展、待确认 | 原始描述、当前范围、关闭原因、来源更新时间与状态差异；不以 PR merged 代替验收 |
| 相关工作 | 工作拆解与 PR 的集中入口 | 可递归的原生父子；单独的依赖区；文本引用注明来源；PR 带仓库和关系性质 |
| 会话页标题右侧 | 关联任务浮层 | 显示真实本地绑定及用途；没有验证绑定时显示未关联，不能填假会话和假token |
| 接续 Tab | 可直接读取配置与记录 | 配置范围、当前生效会话、具体已确认决定与下一步；交接保留 Task 身份 |
| 持续处理 | 项目顶部入口 | 先展示候选/跳过原因，结合负责人、状态、依赖及执行范围；不把父子同列当互不相关工作 |

在 60 个开放负责人 Issue 中，原生 `closedByPullRequestsReferences` 全部为空，但 **27 个 Issue 的交叉引用事件包含 PR，共涉及 120 个不同 PR**。因此只读“会关闭该 Issue 的 PR”会遗漏大量实际协作记录；普通引用仍要注明关系性质，不能反推关闭资格或验收通过。

Issue 均集中在 freeland 不代表代码也在那里。本次 Issue 的 PR 交叉引用涉及 rise-global、rise-global-extension、rise-kit、node-device-discovery、volcano 及 freeland 六个仓库。PR 是普通交叉引用还是关闭关联必须分开记录；引用存在本身不证明它直接实现这个 Issue。来源见 [详情集合](../../.scratch/project14-research/details.json) 与 [#2995](https://github.com/theriseunion/freeland/issues/2995)、[#2633](https://github.com/theriseunion/freeland/issues/2633) 的交付记录。因此项目的工作来源和处理时采用的代码资源需要分别表示，不能从 Issue URL 自动选同名仓库作为 cwd。

## 持续处理的关键规则

1. **浏览范围不自动变执行授权。** 当前视图可能只显示 3.0；“持续处理”应明确采用哪一项目、负责人和筛选范围。切换视图不静默修改运行规则。
2. **父子执行范围必须明确。** 父负责协调且子独立执行，或父已承担某个子范围，二者要有可记录的区别。已被覆盖的子项显示“由父任务处理”；独立子项进入自己的执行。不能一律跳父会话，也不能一律屏蔽子任务。
3. **待上线、推迟解决、已修复待核对有不同下一步。** 60 个 Open 中，12 个已延期、10 个待上线、2 个标已修复，不能把它们都当新实现任务。更具体地，[#3034 最新决定](https://github.com/theriseunion/freeland/issues/3034#issuecomment-6258757265)明确停止处理、保留未发布补丁，却恢复为“待处理”。因此还需记录已接受的暂停意图，不能只根据看板状态自动恢复。具体策略是产品建议，不是本次对远端状态作自动裁定。
4. **ready-for-agent 不是最高授权。** #2354/#2355 虽有该标签，Project 状态是延期；必须结合有效范围与阻塞。当前开放负责人集合里，API 原生开放 blocker 明确存在 `#564 blocked by #563`；正文提到的其他依赖须另作来源标注，不能宣称只有这一项业务阻塞。
5. **真实完成按标准与证据成立。** 子项、PR、版本、部署、现场验收分别记录。已合 PR 可能早于缺陷报告，如 [#1394 的时序纠正](https://github.com/theriseunion/freeland/issues/1394#issuecomment-6121530207)；单靠“找到已合 PR”不能断定后来报告的故障已修。

当前代码已有 Issue 身份去重和同一 Task 的执行复用，但尚无完整父子范围覆盖与依赖领取规则；Project 来源适配也尚未保留真实视图定义和完整评论/依赖。这是整合要补的能力，不是当前已经上线的行为。具体源码证据见 [整合技术笔记](project14-prototype-integration-notes.md#L21)。

## 建议先做的真实原型切片

先用 #3342 取代当前虚构的镜像管理样例：

- 在 #3342 示例范围内，“分配给我”匹配四行（父单 + 三个我的子单）；展开父单可查看四个子项，并标注 wuxs 的协作项不在负责人筛选范围。
- 点父单看整体范围与协调进展；点子单看自己的要求、证据和处理会话。
- 没有核验 DSH 本地绑定前，会话栏如实留空。若需要演示会话，则必须显式切换到模拟执行场景，不与 GitHub 实际记录混为一谈。
- 持续处理预览展示候选为什么可推进、等待、已由父处理或属于其他负责人，先检验去重与范围感觉是否正确。
- 用 #2272 检验视图外子项、#2633 检验别人父单下的我的工作、#2104 检验多层和部分交付、#2972 检验文本拆分。

这样能把当前 Issue 驱动交互建立在真实使用场景上，同时保留已经讨论过的 DSH 原生标题、标签、悬浮球和接续界面。
