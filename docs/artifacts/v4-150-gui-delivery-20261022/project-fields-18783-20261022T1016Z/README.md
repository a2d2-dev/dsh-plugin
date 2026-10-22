# 新端口 18783：同一份开发数据 + 本轮构建（2026-10-22 10:13Z）

按「换个端口」的做法：不重启 18781/18780，另起一个实例只用于查看本轮 Project 字段修复。

- DSH_HOME：`/data/_dsh-dev-18783`（开发数据的副本：sessions / storages / a2d2 / projects / profiles）
  - **不含**最近 20 分钟被改写的会话与所有 `*.lock`（正在使用的会话不在副本里，避免与新实例撞车）。
- 构建：profile 来自 `/data/_dsh-builds/v4-168-fields/profile-new`，client `863c6539ce93fa4a720181462cf89cec555b1de0d3b191422bc24c2ea8e60824`。
- 端口：`node apps/cli/lib/bin.js web --port 18783`（127.0.0.1:18783）+ socat `10.126.126.12:18783 → 127.0.0.1:18783`。
- 入口：`http://10.126.126.12:18783/`，口令沿用 `/data/_dsh-dev/web-password`。
- 原有实例未动：18781 pid 749945 仍在运行，18780 socat 未变。

## 核对（刷新 Project 来源后，observedAt 2026-10-22T10:15:33.280Z，筛选 `is:open`，41 项）

与用户提供的 GitHub 看板逐项对齐：

| 行 | 看板 | 18783 面板 |
| --- | --- | --- |
| #41 A²D²：每个任务由主会话里的 CEO 推进 | 10/11 90% | `10/11 · 90%`（Sub-issues progress） |
| #70 highway-card 跟进 ADR… | 5/13 38% | `5/13 · 38%` |
| #90 A2D2 配置页无法保存 | Linked PR #106 | `Linked pull requests #100, #106` |
| #42 / #9 … | 父项 #41 / #8 | `Parent issue #41 …` / `#8 Spec…` |
| 全部 | 创建/更新/关闭 | `Created/Updated/Closed` 真实日期 |

截图：`gui-18783-project-top.png`（左侧列）、`gui-18783-project-right.png`（右侧列），文本：`gui-18783-project-fields.txt`。
证明：`git diff` 前后同一份数据，面板从「未读取此类字段值」变成真实数值；仍不支持的字段类型继续显示「未读取此类字段值」。

## 说明

- 该实例是**数据快照**，不会与 18780 同步；它用于验证本轮构建的呈现。
- 未在 18783 启动任何会话或工作（持续规则为 disabled）。

## 追加：看板级视觉（2026-10-22 11:02Z，PR #170）

第二轮把「看起来像看板」也做了，仍部署在 18783（client `5e321bcaee713195220249eeb15bd17ac36c37c171894322a1bd5c982ddae10e`）：

- Status：读取 Project 单选项颜色（`options { id name color }`），渲染彩色徽章（如 `已部署` 蓝、`Done` 绿）。
- Assignees：头像（登录名首字母 + 稳定配色）+ 登录名。
- Labels：药丸样式。
- Sub-issues progress：进度条 + `10/11 · 90%` / `5/13 · 38%`。
- 层级：原生子 Issue 缩进挂在父行下，父行有折叠箭头；关闭项显示绿底勾选。
- 列：全空列自动隐藏（Milestone/Reviewers/Closed 等），标题列只显示 `#n 标题`（仓库在 tooltip 里），整体列数与看板接近。
- 截图：`gui-18783-final.png`（层级/徽章/头像）、`gui-18783-progress-bars.png`（进度条/父项/日期）。

仍未做：GitHub view 的列配置不开放 API（用「目录字段 − 全空列」近似）；`is:open` 下关闭的子项不会像看板那样挂在父行下；18780 未部署。

## 追加：1:1 行高与单元格（2026-10-22 11:24Z，PR #170）

按 GitHub 自己的度量重做行密度（不引第三方 UI 库：本插件的 client 是 tsdown 单包 + CSS Modules，class 名在 `css.d.ts` 里逐条声明，Tailwind/shadcn 需要额外 PostCSS 管线并会与宿主主题冲突；这里直接照抄 GitHub Primer 的数值）：

- 行高 40px、表头 32px 且 sticky、行分隔 1px `#d1d9e0`、单元格 12px（标题 14px）；
- 所有单元格单行 + 省略号（Repository / Parent issue 不再把行撑高）；chips 与头像 20px；
- Sub-issues progress 改为**分段条**（每项一段，最多 20 段）+ `10/11 · 90%`；
- 表头列名沿用 GitHub 字段名。

截图：`gui-18783-github1to1.png`（左半，行密度/徽章/头像）、`gui-18783-github1to1-right.png`（右半，分段进度条、父项省略、日期）。

线上构建：client `4c0fa0773f7545291d922b40da9ca5895841081b7035a99457f0719fb550b19d`，仍在 18783；18780 未部署。

## 修复：点另一个项目的来源标签后面板空白（2026-10-22 12:07Z）

复现（18783，两个项目各一个来源）：点顶部 `DSH A²D² Project` 标签 → 整个来源目录消失，只剩另一个项目的仓库标签。

根因：`selectConnectedSource` 在跨项目时调用 `selectProject(projectId,false)`；`browse=false` 不走 `showSources()`，而 `selectProject` 在项目变化时把 `source` 置为 `emptySource()`。于是 `selectSource(sourceId)` 拿到的 `sources` 是空数组，`SourceDirectory` 的 `find` 返回 undefined → 整个目录返回 null（面板空白）。另外 `selectSource` 对 Project 来源也会先读仓库 Issue 页（它没有）。

修复（`work-panel-controller.ts`）：
- 跨项目选择时先 `source.list` 载入目标项目的来源并写入 `projectSources`/`sources`，再 `selectSource`；
- Project 来源直接打开「概览」，跳过仓库 Issue 读取。

回归测试：`tests/client/work-panel.spec.ts` 新增「loads the target project sources before selecting a connected source from another project」；10/10 通过。

实测（client `9eaeabbb`）：仓库 → Project → 仓库 → Project 往返切换，面板始终有来源、有内容；截图 `repro-source-switch-fixed.png`。

## 布局：来源信息 + 目录标签 + 操作按钮合并成一行（2026-10-22 12:11Z）

原来三层：来源摘要 / 目录标签 / 刷新与缓存按钮 + 缓存文字。现在一层：
`DSH A²D² · Project · a2d2-dev / #1 · 组织 · 读取账号：imneov` + `概览 项目 Issue PR` + 右侧两个图标按钮（刷新 ⟳、读取缓存 🕐，`title` 里带缓存时间）+ `▶ 持续委托`。

- 图标按钮取代「刷新来源 / 读取目录缓存」文字，`aria-label` 保留可访问名称；
- 缓存/最后已知观察的时间不再占一行，只在按钮 tooltip 里；
- 截图：`header-row.png`（概览）、`header-row-project.png`（项目表格）。

构建：client `481900dfe1d59f481faced12f3608ff4b6288c378fe2523fb973a32049d7a6d5`，18783。

## 表格收窄：不再被长标题撑开（2026-10-22 12:22Z）

之前 auto 布局 + 9 列常显把表格撑到 ~1900px。现在：

- `table-layout: fixed` + 按列类型加权分配宽度（标题 30%，其余按 Assignees/Status/Labels/Linked PR/Parent/Progress 权重分 70%）；
- 每个单元格单行截断（省略号），标题也是；日期改成 `MM-DD`；
- 仓库、Created/Updated/Closed、Milestone、Reviewers 默认隐藏，勾选「显示时间与仓库列」再出现；
- 进度条分段上限 10 段、3px 宽，`10/11 · 90%` 完整显示；
- 表头允许换行（`Linked pull requests` 显示为两行）。

实测：表格宽度 901px = 容器 901px，`scrollWidth` 无溢出，列数 7。截图 `table-final2.png`。

构建：client `27e9e89a58daab0d8e31d150937cfc125ec90c09f0c51acf5840c59d6ca47998`，仍在 18783。
