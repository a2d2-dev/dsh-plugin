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
