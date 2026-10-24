# Issue #137 真实实例来源验收（2026-10-24）

原始工作：[a2d2-dev/dsh-plugin#137](https://github.com/a2d2-dev/dsh-plugin/issues/137)，父 #136。Task `d659d90c-6dfc-49a5-afe9-025c8d70e087`，ProjectRef `f2827706-8088-47a5-976d-683147a430d6`，协调代次2、规格2，七项原条件不变。本轮直接在既有3080 GUI完成来源段组合验收；不把 #141 整票完成作为来源段结果的前置，也不宣称其他实现票已验收。

## 目的与范围

补齐 Project／Repo 来源标签、概览、独立 Issue 查询、真实 views／PR、canonical 导航及读取状态的真实页面证据。浏览和来源配置不启动 Task／模型／持续处理，不改 freeland 业务数据。本轮发现并修复一个目录缓存提示缺口。

## 固定源码与实际运行版本

- 原已合并来源修复：PR #212，合并 `f1d6c1b7c9d100443afc915c300595daa19ff05e`。
- 本轮开发基线：`release/v0.0.22@d975e9cc60c8c7acee6c91fc80d7d277691d9577`；独立 `test/137-live-acceptance` 工作树。
- 本轮产品修复提交：`1c14d0b`，仅增加目录缓存／本次读取与观察时间显示，外加真实组件回归。
- 当前宿主：supervisor `dsh-web-server`，PID `3451716`；checkout HEAD `8282d61299a04f60555f9ce473af174bbe161b02`，实际浏览器仍为同一3080实例。本轮没有重启或替换宿主、配置、会话数据。
- web profile 的插件仍为 tarball 安装，manifest 版本0.0.21，并叠加后续 host 补丁；不能用该版本号推断是否加载某个修复，也没有声称整包升级至0.0.22。
- 更新前逐字比对安装 `client.js.map` 的全部 `../src/` 内容，均等于上述 release 基线。更新后仅 `source-directory.tsx` 变化，其余31个客户端源码保留，25个 host JS资产前后SHA不变。
- 当前安装客户端 SHA256：`49c688cf3e4c867ce592e802dbf496d6422514cfa6e2ecee4ca835233af3ad02`。更新后刷新同一GUI，已观察到新缓存提示。
- 当前 watcher 在另一个 runtime checkout，本报告不声称自动HMR。版本与备份见 [client-deployment.json](client-deployment.json)，受保护更新／回滚脚本见 [client_update.py](client_update.py)。回滚：在本目录执行 `python3 client_update.py rollback`，再刷新现有GUI；脚本先验证当前文件及备份SHA，拒绝覆盖后续他人更新。

## 步骤与记录

操作全部通过 `agent-browser --auto-connect` CLI复用当前GUI；GitHub API文件仅作真实字段／筛选对照，未替代页面操作。页面数据来自宿主受信 GitHub 路由与既有凭据。

| 场景 | 操作及实际结果 | 证据 |
| --- | --- | --- |
| 仓库接入与默认概览 | 页面输入仓库URL，真实识别账号imneov、仓库a2d2-dev/dsh-plugin，确认后进入概览；仓库只有概览／Issue／PR | [识别](01-repo-identify.png)、[概览](02-repo-overview.png) |
| 来源标签与范围 | Project显示a2d2-dev/#1/组织/账号imneov；重复接入view仍保留两个原Project标签加一个Repo标签，没有重复来源标签 | [最终概览](48-final-project-overview.png) |
| Repo独立Issue查询 | @me／全部负责人、Open／Closed／全部、ready-for-agent标签及v4搜索均真实读取；前后页及有效空可辨 | [@me](03-repo-issues-me.png)、[开放](04-repo-open-all.png)、[关闭](05-repo-closed.png)、[全部第2页](07-repo-all-page2.txt)、[标签搜索](08-repo-search-label.png)、[有效空](09-repo-valid-empty.png) |
| Project独立Issue查询 | Project view之外独立切换负责人及远端状态；第2页最终加页码断言后取得 | [@me](35-project-issues-me.png)、[开放](36-project-issues-open.png)、[关闭](37-project-issues-closed.png)、[全部](38-project-issues-all.png)、[第2页最终记录](45-project-issues-page2-verified.txt) |
| 真实views与字段 | GitHub定义为“任务清单”(is:open)和“全部任务”(空过滤)。页面任务清单24项，全部任务含关闭97项；切回任务清单仍24项；字段包括Status、Assignees、Labels、Parent issue、Sub-issues progress | [GitHub定义](github-project-facts.json)、[开放视图](12-project-view-open.png)、[全量视图](13-project-view-all.png)、[第2页最终记录](43-project-view-page2-verified.txt)、[恢复开放视图](44-view-open-filter-restored.png) |
| 不支持筛选 | 同一Project的原始view入口增加unknown:value，明确报告未知字段，不用全量列表冒充成功。完成后保存view1/is:open的等价正常入口，测试入口仅留历史 | [明确不支持](31-unsupported-view-filter.png)、[正常入口恢复](44-view-open-filter-restored.png) |
| 真实PR目录 | Project/Repo真实仓库、状态、草稿/合并及可得关联可读；未知检查/评审显示破折号。“引用不等于验收”一直可见。PR#212没有关闭关联事实时，显示未观察到关联，不从标题#137推造事实 | [Project PR](17-project-pr.png)、[合并筛选](19-project-pr-merged.png)、[PR有效空](20-pr-valid-empty.png)、[Repo PR212](22-repo-pr-212.png)、[PR第2页最终记录](46-project-pr-page2-verified.txt) |
| canonical导航 | Repo和Project入口打开#137，均读取同一规格2、同一已报告进展与当前1／历史1会话。Project行显示session-ba1cd580。全程未点开始／恢复处理 | [Repo入口](11-repo-canonical.png)、[Project入口](16-project-canonical.png)、[当前会话行](12-project-view-open.txt) |
| 读取 | 真实Issue请求期间显示正在读取及禁用查询控件 | [读取记录](24-reading-issues.txt) |
| 无缓存 | 仅对本轮新增的Repo来源暂时停用远端刷新，然后进入未读取过的缓存第2页：显示source-page-unobserved、“此筛选页尚无可读缓存”“读取失败不表示列表为空”。随即恢复来源并真实刷新 | [真实无缓存](40-real-no-cache-page.png)、[恢复](41-source-reenabled.png) |
| 缓存 | 显式读取缓存列表后断言“缓存 / 最后已知列表”；目录修复后显示缓存／本次读取及目录观察时间 | [显式缓存](42-cache-read-verified.png)、[目录本次读取](33-live-fresh-directory.png)、[目录缓存](34-live-cached-project.png)、[最终目录状态](48-final-project-overview.png) |
| 不可见／权限边界 | 使用宿主真实账号识别github/github，返回github-not-found及“missing or not visible to this credential (404)”，不创建来源、不当空结果 | [真实不可见来源](30-invisible-repository.png) |
| 不可用及恢复 | 仅将该浏览器临时离线，刷新失败显示Failed to fetch并保留上次列表；finally恢复联网后读取成功，没有停宿主或改凭据 | [失败保留缓存](27-unavailable-cache-retained.png)、[恢复](28-recovered-issues.png) |
| 异步切源 | Repo刷新请求发出后立即切换Project，等待网络请求收敛并断言选中来源仍为DSH A²D²、页面为其概览；旧Repo响应不抢占 | [最终新来源状态](29-source-race-final-project.json) |
| 桌面与窄屏 | 1920×1080与390×844均在同一GUI交互。窄屏文档宽度390，表格自身横滚、筛选/页码可操作 | [窄屏PR](23-narrow-pr.png)、[窄屏Issue](25-narrow-issues.png)、[窄屏缓存目录](49-narrow-pr-header.png)、[桌面最终概览](48-final-project-overview.png) |

## 根因、修复及回归

`SourceDirectory` 原本已根据 `sourceState.cached` 计算文案，但没有插入JSX。Issue列表自己的提示不会挂载到Project／PR分支，因此同一缓存与本次读取可显示相同目录。最小修复只在非Issue公共目录分支、有catalog且不处于读取时展示状态与时间；无catalog仍保留无缓存提示，失败保留原错误及最后已知数据。

新增真实 `WorkPanelController`＋`WorkPanel` 渲染回归，对Project与PR分别验证本次读取→缓存→403失败保留缓存→无catalog。原红2失败／1通过，修复后3/3。合成外部响应只证明组件合同；当前真实不可见来源返回404，本报告不把404冒称403，也未通过撤销全局凭据制造401/403。

- [原红](cache-render-red.txt)、[修复后](cache-render-green.txt)
- [来源14文件148/148](source-regressions.txt)
- [typecheck](typecheck.txt)、[构建](build.txt)
- [clean-tree pack](pack-clean.txt)：固定源码提交1c14d0b；30个显式导出目标、177项tarball、安装后14个Node入口可导入。

首次在保留未提交截图的工作树执行pack，被脏树门禁正确拒绝。随后使用固定提交的干净detached工作树重跑通过，没有放宽门禁。没有声称全仓库测试或配置CI全部通过。

## 验收脚本纠错

原CLI对屏外控件的点击没有自动滚动，部分“Done”没有实际点击，也未发出对应命令。已加显式滚入视口，并对最终分页断言“第2页”。以下早期记录不作为其文件名所述场景的通过证据：`10-repo-restored`（空字符串清输入未生效）、`14-project-view-page2`、`18-project-pr-page2`、`26-cached-issues`、`39-project-issues-page2`。真实替代记录为40/41/42/43/45/46；原始文件保留用于审计，不伪造原始绿结果。来源停用恢复本身正常，异常来自脚本点击没有进入视口。

复现辅助见 [ui_steps.py](ui_steps.py)。它只驱动既有GUI；执行分模式脚本前应选择相应Project／Repo和目录页。断言及源状态以本报告明确列出的最终记录为准。

## 逐项验收裁决

1. URL严格GitHub.com、规范身份去重和view／切片持久保存由原11项应用合同及本轮真实识别、重接、刷新恢复共同支持；浏览未启动工作。
2. Project／Repo页签、默认概览、账号范围和独立Issue筛选／分页已在现有GUI取得证据，原型的来源导航结构保持。
3. 真实views、字段及相应过滤已对照GitHub；未知字段明确失败。
4. 真实PR事实、仓库、草稿／合并、可得关联和未知检查／评审均显示；引用不作验收。
5. 同Issue跨来源进入既有canonical工作已在页面核对；同号跨仓库隔离和真实跨仓库关联沿用专门PR身份及公共应用回归，不以标题或裸编号关联。
6. 读取、无缓存、缓存、不可见权限边界、不可用、有效空与切源均有页面记录；新增Project／PR缓存提示缺口已修复并刷新验证。401/403细分由合同覆盖，现场404的限制已明确。
7. 来源合同148/148、typecheck、完整构建、clean pack与本轮同GUI来源专项组合浏览器验收完成。本报告只验收#137来源段，不替代#138/#139/#140或#141整体验收。

工作完成结论、PR合并回执与原生Project状态将在Task／GitHub回读后登记；Issue最终关闭由LF执行，不自动关闭。
