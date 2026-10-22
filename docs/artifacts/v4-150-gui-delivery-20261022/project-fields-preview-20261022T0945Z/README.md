# Project 视图 vs GitHub 看板：差异清单与本轮闭合范围（2026-10-22 09:45Z）

对照对象：用户提供的 GitHub 看板截图（DSH A²D² Project 任务清单，列：Title / Assignees / Status / Linked pull requests / Sub-issues progress）与 GUI 18780 的「真实 Project 视图与字段」截图。

## 差异（按可见程度）

| # | GitHub 看板 | 面板（修复前） | 现状 |
| --- | --- | --- | --- |
| 1 | Linked pull requests 显示 `#106` | 「未读取此类字段值」 | **已修**：读取 `closedByPullRequestsReferences`，显示 `#n`（可点，草稿标注） |
| 2 | Sub-issues progress `10/11 90%`（进度条） | 「未读取此类字段值」 | **数据已修**：读取 `subIssuesSummary`，显示 `7/7 · 100%`；进度条视觉未做 |
| 3 | Parent issue（子项层级） | 「未读取此类字段值」 | **已修**：显示 `#n 标题`（可点） |
| 4 | Created / Updated / Closed 隐含在卡片里 | 三列全「未读取此类字段值」 | **已修**：读取 `createdAt`/`updatedAt`/`closedAt`，显示日期 |
| 5 | PR 的 Reviewers | 「未读取此类字段值」 | **已修（仅 PR 项）**：读取 `reviewRequests` |
| 6 | Status 彩色徽章（Done/In Progress/已部署） | 纯文本 | 未做（视觉） |
| 7 | Assignee 头像 | 纯登录名 | 未做（视觉） |
| 8 | 父行下的子项折叠缩进、完成勾选 | 平铺单表 | 未做（结构） |
| 9 | 行内子项进度条 | 无 | 未做（视觉） |
| 10 | 视图筛选 `is:open` | 视图本身无筛选时显示 82 项（含已关闭） | 未做（筛选配置沿用 GitHub view filter；用户在 GitHub 搜索框输入的 `is:open` 不是 view 定义的一部分） |

## 本轮验证（preview 18782，组合构建 + 本轮字段读取）

- 产物：tgz `00e237b19b339c428778177a79409a914c804ea252c56d5145cd800217193535`，client `863c6539ce93fa4a720181462cf89cec555b1de0d3b191422bc24c2ea8e60824`。
- 部署：`redeploy-preview.sh` → `RESULT=redeployed`、sessions/storages identical；随后「刷新来源」重新扫描 Project（observedAt 2026-10-22T09:44:41.586Z）。
- 真实渲染（`preview-project-fields.png` / `.txt`）：
  - `#8 …` → Status `Done`、Sub-issues progress `7/7 · 100%`、Created/Updated/Closed `2026-09-25`
  - `#9 …` → Linked pull requests `#16`、Parent issue `#8 Spec: 「下一步」…`
  - `#112 …` → Assignees `imneov`、Status `已部署`、Labels `a2d2:main`、Created/Updated `2026-10-15`
- 剩余「未读取此类字段值」只出现在仍未建模的字段类型上（诚实标注，不编造）。

## 未做 / 下一步

1. GUI 18780 仍是上一版（本轮没有重启用户实例）；本轮改动需下一次同 URL 部署才可在 GUI 看到。
2. 看板级视觉：Status 徽章颜色、Assignee 头像、Sub-issues 进度条、父子行折叠与完成勾选。
3. `is:open` 这类搜索框筛选 vs 视图定义的差别，需要在面板里支持同样的搜索语法或明确说明。
