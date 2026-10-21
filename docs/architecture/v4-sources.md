# v4 来源与目录架构

## 背景

控制面板沿用 WorkApplication 的公开命令／查询和事务记录。GitHub 来源是浏览范围，业务 Project 与 Task 保存已接受工作；同一 Issue 的 ExternalBinding 继续跨来源复用 canonical TaskRef。

## 目标

- 粘贴 GitHub.com Project 或仓库 URL，真实识别名称、身份和读取账号，用户确认后保存来源。
- 保存 Project view 和 slice 原始入口，规范来源去重；浏览不启动模型或会话。

### 非目标

不改变执行 owner／epoch、持续计划、验收或外部关闭，不操作来源业务数据。

## 架构

### 概要设计

`source.identify` 解析可信 URL 并通过宿主凭据读取真实 GitHub 身份，不写本地工作。`source.connect` 接受 URL，重新识别后在事务中按真实 nodeId／规范范围复用来源。既有手动 Project 合同继续兼容。来源保存可选 title、nodeId、entryUrls；原始 view／slice 入口不作为新的来源身份。

### 架构设计

URL 只用于解析范围。适配器构造固定 api.github.com REST 或 github.com GraphQL 请求，拒绝其他主机、凭据、端口、编码路径及不受支持路径。GitHub 网络读取在本地写锁外完成，来源连接事务仅保存观察和组织关系。

### 组件模块

| 组件 | 职责 | 状态归属 |
| --- | --- | --- |
| work-sources/url | 严格解析来源范围 | 无状态 |
| GitHubSource | 宿主既有凭据、真实读取、错误分类 | 远端观察 |
| WorkApplication | 权限、公开合同、幂等连接 | 事务快照 |
| ExternalBinding | canonical Issue 到 TaskRef 映射 | 本地已接受工作 |

### 数据流程

URL → source.identify → 真实候选 → 用户确认 → source.connect → 来源记录。Issue 读取 → 来源观察 → 显式 prepareStart → 既有 canonical Task／当前执行；来源添加没有 Task 或 Session 副作用。

## 场景

### 首次接入

前置条件：宿主可读取 github.com 凭据。公开查询 `{type:'source.identify',url:'https://github.com/a2d2-dev/dsh-plugin'}` 返回真实仓库与账号。确认后发送 `source.connect`，重复规范 URL 返回同一来源。Project 的 `/views/N` 和 query／hash 参数保存在 entryUrls。

完成判据：识别后 projects.list 不变；确认后产生来源；再次确认复用来源；没有 Task／执行创建。

### 无权限与恢复

识别失败返回明确 github 错误，不生成来源。已保存工作与缓存保留；恢复权限后可重新读取。

### 目录、视图与观察完整性

`source.catalog` 是只读查询，显式 `refresh:true` 在事务外读取 GitHub，再按来源 version 和请求 sequence 提交；停用、重配或更新请求使旧响应失效。目录缓存持久保存，失败保留旧数据。catalogError 与 Issue／成员扫描的 lastError 分开，成功读取 PR 不清除 Issue 权限失败。

仓库目录使用 `repository.issues(states:OPEN).totalCount` 作为全仓库开放 Issue 计数；PR connection 每页 50 项，最多读取 200 页，并检查账号连续性及去重后条目数与 totalCount，计数变化／上限标为部分观察。PR 保存真实仓库、开放／关闭／合并、草稿、关闭 Issue 关联、最新提交的 statusCheckRollup 与 reviewDecision；不可得事实显示未提供。

Project 的 views 和 fields 各自按真实 connection 翻页；条目成员仍沿用原有 discovery 的可恢复扫描，完整扫描原子发布。PR 目录另外读取真实 Project 收录和每个 Issue 最近 50 条 CrossReferencedEvent，按 PR nodeId 合并、保留收录与引用区别。历史引用存在更多页、权限受限条目或读取上限时明确标为部分观察，PR 引用始终不作为验收。

Project 视图在完整成员观察上先过滤再分页，使用真实字段值（含 Milestone），支持空白 AND、显式 AND、OR、引号值、逗号 OR 值、负条件、`assignee:@me`、`is:open/closed/issue/pr/draft/archived`、label、repo、no/has 与真实自定义字段等常用表达式。括号、比较、不完整引号或未知字段明确报告原因。原始 view 编号及 filterQuery 可恢复，手动切视图后按新 view 过滤；未知 slice 参数保留外链并明确拒绝假装已支持。

Issue 的 assignee、open／closed／all、全部标签及搜索与 Project 视图独立。Project 在完整成员快照中过滤；Repo 使用固定 REST 范围，标签／负责人／状态由 API 筛选，搜索按标题／正文／编号扫描来源页后分页（最多扫描 20000 条，超限明确失败，不返回假全量）。原有当前页处理状态／快捷搜索仍明确标注仅作用当前页。缓存键包含应用筛选，观察刷新沿用相同范围。

来源概览只聚合当前来源真实成员对应的 canonical Task 进展；跨业务 Project 的既有工作也投影到当前来源。开放 Issue 未知时显示破折号，Project 权限受限条目明确补注，PR 目录标完整／部分；列表页条目数不作为全量。最近工作按已报告更新时间排序，外部 PR 更新独立展示。

客户端沿用 sourceRevision／revision 栅栏。来源切换默认概览；Project 标签为概览／项目／Issue／PR，Repo 为概览／Issue／PR。URL 候选和 Issue 筛选草稿由根控制器保存，切源及原生会话往返不会代发或清空草稿。目录与浏览仅查询，prepareStart 的 canonicalTask／现有当前会话路径保持复用。

### 目录浏览与失败恢复场景

**操作**：来源标签 → 概览 → 刷新来源；Project 可选择“项目”中的真实 view；仓库直接打开 PR。GitHub 权限／网络失败时显示错误及上次缓存观察，目录尚未读取与有效空结果分别呈现。Project 成员扫描超过本次页预算时显示扫描进度，后续刷新或宿主 discovery tick 接着读取，不将中间页发布为完整成员。

**数据走向**：固定 GraphQL／REST → catalog／projectSnapshot／observations → 只读公开查询 → 来源目录；Task 与 Session 不因浏览新增。

**完成判据**：切源后迟到响应不能改变当前 sourceId／目录；离线重启可读目录缓存；无权限不被解释为零项；点击已有 Issue 的开始／进入继续定位原 canonical Task。

## 验证

工作目录为本工作树；使用 pnpm 10.26.2。来源公共应用／适配器／HTTP／导航／渲染相关回归 11 文件 107 项通过；随后新增完整异步切源链路竞争测试，针对导航／渲染的 4 文件 29 项通过。`typecheck` 和 `verify:pack-exports` 均通过；构建文件不提交。测试中的确定外部响应只验证合同，不等于真实 GitHub 或既有实例交互验收。

真实只读 API 实证：仓库 `a2d2-dev/dsh-plugin` 首次观察开放 Issue 36、PR 64；随后截图观察新增草稿 PR 后为 65，账号 imneov，目录完整。Project `theriseunion/14` 读取到 view 8／9／10／13／14、14 字段及 2705 个去重关联 PR，历史交叉引用明确部分观察。生产成员读取首 100 项有下一页，Milestone 值 3.0 及 `assignee:@me is:open`、`milestone:3.0 -is:closed`、`status:待处理 or no:status` 均通过实际字段求值；首 100 项的匹配数不作为全 Project 总数。

使用 agent-browser 打开当前生产组件渲染的静态 HTML，数据来自独立临时 WorkApplication 的真实仓库目录缓存；没有启动服务器或改动现有部署。桌面概览、390px 概览及桌面 PR 截图位于本轮临时证据目录 `/tmp/v4-sources-137-evidence-session81a2/` 的 `overview-desktop.png`、`overview-narrow.png`、`prs-desktop.png`。这些是组件视觉实证；静态截图没有声称按钮交互已在宿主实例验证。

最终既有 18781／18782 实例的来源添加、切换、真实会话往返及组合交互验收归 #141，当前未验证；未知 slice 参数、括号／比较表达式及受限字段值已在界面明确限制。Project 历史交叉引用不保证全量，任何 PR 事实都不替代 Task 验收。
