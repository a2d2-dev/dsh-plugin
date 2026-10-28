# #152 开发实例只读验收准备与页面证据核对

## 目的与范围

本记录仅核实指定开发入口 `https://dsh-dev.e5box.a2d2.dev/` 的当前 UI、既有来源、已配置持续委托规则与隔离资源可见性，为后续验收执行准备证据。它不代表真实模型、fixture 或全功能验收通过；原业务目标与全部功能标准保留。

本轮由独立页面取证执行者完成，未创建本地子 Task，未进行 Agent Teams 编排。浏览器操作全部使用 agent-browser CLI，先加载 `agent-browser` skill，再读取 `agent-browser skills get core --full`。没有使用 Playwright。

工作树：`/data/src/github.com/a2d2-dev/dsh-plugin.worktrees/v4-152-live-acceptance`；分支 `test/152-preview-live`。开始时 `git status --short` 仅见已有未跟踪 `.local/`，未处理该目录。本文与截图仅新增在本证据目录，未覆盖旧证据。按本轮指定名称使用 `20261028`；UI 本身显示 `2026/10/27 22:12:37` 等时间，浏览器时区未核实，不做日期时区换算。

实例身份按本轮授权为 `dsh-plugin-dev-server`，`DSH_HOME=/data/_ssd2t/dsh-plugin-dev/home`。没有读取或变更服务/profile，没有使用其他端口或生产入口交叉验证实例。

## 步骤与记录

1. 核对 pwd、分支与初始 Git 状态，读取工作树 AGENTS.md 与本机 onboarding 约定。
2. 用独享浏览器 session `v4-152-readiness-20261028` 打开唯一授权 origin，设置桌面 1440×1000。
3. 页面出现 Password 登录表单。程序读取本机 `web-password` 后仅用于认证输入，输出被抑制；没有保存认证状态、密码、Cookie、认证头或 URL token。完成登录后关闭浏览器本地 Preview Notice。
4. 截取空白开发首页，点击 A²D² 控制面板，查看来源概览和缓存提示。
5. 打开“持续委托”，只读展开“队列设置”和“执行目录、模型与权限”，未填写或选择规则参数；截图后点击“取消”。
6. 展开现有来源选择器，仅观察已添加列表，没有点击“添加来源”，也未切换其他业务来源。
7. 打开当前来源“项目”列表，在本地搜索框输入 `[QA #152`，只读筛选历史 QA 条目。未打开业务 Task/Session 详情，未点击“开始处理”。
8. 保存 390×844 窄屏页面截图，再关闭面板回到空白首页。调用 `agent-browser --session v4-152-readiness-20261028 close`，收到 `Browser closed` 回执。
9. 用 read_image 检查全部 10 张截图。没有密码、Cookie、认证头、URL token 或完整模型私有上下文；没有全量 HAR、网络响应包、model request/context 落盘。

没有点击“刷新来源”“更新等待任务”“保存并更新等待任务”“暂停后续”“结束处理”“进入会话”，没有调用应用模型、continuous.preview 或应用 HTTP API，没有创建或修改 GitHub 对象、来源、Task、Session、规则、工作区。页面已有自动队列及历史模型筛选状态，不是本轮主动执行的结果。没有查看或执行 freeland / Project14 业务。

## 实际页面结果

| 核对项 | UI 实证 | 结论边界 |
|---|---|---|
| 开发入口 | 认证后显示 DSH Local Build、空白 New Session 编辑区、A²D² 控制面板导航 | 入口可用；未发送消息，不能证明模型可用 |
| 来源概览 | 当前 `a2d2-dev / DSH A²D²`，开放 Issue 58、PR 125；同步提示“显示缓存” | 来源数据可见；本轮没有刷新，不保证实时上游状态 |
| 已添加来源 | 菜单只有 `DSH A²D²`，类型 Project、组织 a2d2-dev | 可见列表未显示专用 fixture 来源；不推断其他 profile 状态 |
| 队列开关 | “自动处理已开启”，有“暂停后续”按钮 | 既有开启状态，未变更 |
| 当前队列 | 全部 31、正在处理 1、等待处理 29、需人工处理 1、历史 0；并发占用 1/1 | 已有真实业务队列占用，不能视为专用隔离队列 |
| 历史筛选摘要 | 候选 31、命中 12、排除 19；同时显示“大模型筛选失败：筛选期间候选内容发生变化，请刷新重试。刷新可重试。” | 仅证明保存的摘要/失败提示，未重试、未追查根因，不是本轮模型请求实证 |
| 现有任务 | 队列中 #152 正在处理、#163 等待人工/外部条件；项目列表 #152 使用新标题“开发服务器真实模型与全流程验收” | 概览/队列仍有旧标题，项目列表已显示新标题，不代表访问旧端口 |
| URL | 入口、面板和项目列表实际 URL 均为 `https://dsh-dev.e5box.a2d2.dev/` | 未观察到子路由或 URL query 参数；面板通过 UI 内部状态切换 |

### 已配置规则与路由的必要摘录

以下为既有设置表单当前选中值，本轮无编辑、无保存：

| 参数 | 当前可见值 |
|---|---|
| 队列来源 | DSH A²D² |
| 负责人 | 所有负责人 |
| 必须包含的标签 | ready-for-agent |
| 大模型筛选提示词 | 状态为待处理和进行中 |
| 更新周期 | 30 分钟 |
| 并发上限 | 1 |
| 等待顺序 | 较早创建优先 |
| 持续处理执行目录 | a2d2-dev |
| 持续处理模型 | codex/gpt-6.1-sol |
| Agent 预设 | standard |
| 权限预设 | danger-full-access |

执行目录下拉选项仅见 `a2d2-dev` 和 `workspace`，侧栏也可见这两个 workspace 名称。UI 未提供本轮专用 fixture workspace 路径、隔离边界或与 fixture 来源的绑定实证。

这些是 UI 路由候选配置，不能证明实际请求使用了该 provider/model/Agent/权限。首页空白编辑器显示 `gpt-6.1-sol High`、`Workspace Write`、`Standard mode`，与持续委托属于不同控件；未把它当成真实处理会话请求参数。推理档位、API base URL、实际请求体和运行时权限应用结果均未从本轮 UI 证实。

### fixture 与隔离资源可见性

项目列表本地搜索 `[QA #152` 返回 3/58 项：

| 可见条目 | 标签/关系 | 可见状态 |
|---|---|---|
| #157 `[QA #152 v4 v4-152-6b252218-r01] P` | `qa:v4-152-6b252218-r01`；子项进度 1/2、50% | Status 与会话列均为 `—` |
| #158 `[QA #152 v4 v4-152-6b252218-r01] C` | 同一 QA 标签；Parent issue #157 | Status 与会话列均为 `—` |
| #162 `[QA #152 v4 v4-152-6b252218-r01] X` | 同一 QA 标签及 `qa:v4-152-6b252218-r01-serial` | Status 与会话列均为 `—` |

这证明历史 QA 来源条目在当前 Project UI 可见，不能证明已有本机 canonical Task、隔离执行 workspace 或可恢复处理 Session，不能把旧 QA 名称自动当成本轮新 fixture。完整 P/C/X 场景资源未从本轮 UI 证实。

既有规则要求 `ready-for-agent`，上述 QA 行可见标签没有该标签。结合来源仅有现有 Project、执行目录为共享 a2d2-dev、队列已满，尚无 UI 证据证明规则已经接入专用 fixture。后续能否以专用来源/标签/执行目录接入，需要经授权的隔离设计与真实执行另行确认，本轮没有调整规则试验。

## 已确证限制与缺口

- 既有规则自动处理开启、并发占用 1/1，包含真实开发任务，不能直接当成本轮独占 fixture 环境。
- UI 显示历史筛选失败，本轮不重试；没有认定其当前代码根因或验收阻断级别。
- 来源显示缓存，不能声称实时 GitHub 同步正常。
- 专用 fixture 来源、workspace 物理路径及隔离性、canonical Task/Session 绑定、P/C/X 可执行性未从 UI 证实。
- 真实模型调用、实际路由与请求参数、终态 job 收取流程、停止后接续和全功能标准均未执行。本记录不能替代 #152 原验收。
- 指定域名可以登录并浏览，没有本轮 UI 入口不可达事实。仓库 public 是给定条件，未另开 GitHub 站点验证；没有沿用历史 PRIVATE 阻碍。
- 一次上层目录 AGENTS.md glob 发现超时；工作树自身 AGENTS.md 已成功读取，未影响页面证据。
- 本轮没有创建后台 job，最终 `job_list` 返回 `(no background jobs)`，无待收取结果。

## 截图索引

均为真实 UI viewport 截图，未用接口响应替代。

| 文件 | 尺寸 | 内容 |
|---|---|---|
| [01-dev-entry-desktop.png](./01-dev-entry-desktop.png) | 1440×1000 | 开发首页与侧栏 workspace |
| [02-panel-overview-desktop.png](./02-panel-overview-desktop.png) | 1440×1000 | A²D² 概览、缓存时间与任务摘要 |
| [03-queue-rule-desktop.png](./03-queue-rule-desktop.png) | 1440×1000 | 既有队列设置和筛选失败提示 |
| [04-queue-rule-mobile.png](./04-queue-rule-mobile.png) | 390×844 | 窄屏规则上半部分，标签和提示词可见 |
| [05-execution-route-desktop.png](./05-execution-route-desktop.png) | 1440×1000 | 执行目录、模型、Agent、权限候选值 |
| [06-existing-sources-desktop.png](./06-existing-sources-desktop.png) | 1440×1000 | 唯一可见已添加 Project 来源与现有队列 |
| [07-existing-qa-project-desktop.png](./07-existing-qa-project-desktop.png) | 1440×1000 | 历史 QA 搜索、状态/会话列 |
| [08-existing-qa-project-mobile.png](./08-existing-qa-project-mobile.png) | 390×844 | 窄屏 QA 列表和表格横向滚动条 |
| [09-panel-overview-mobile.png](./09-panel-overview-mobile.png) | 390×844 | 窄屏概览，默认关注项 #163 |
| [10-dev-entry-mobile.png](./10-dev-entry-mobile.png) | 390×844 | 窄屏空白开发首页 |

全部图片已逐张 read_image 复核。窄屏规则上半部分输入框位于视口内，项目列表通过横向滚动呈现其他列；没有对全部滚动位置和按钮操作做功能验收，不能宣称历史布局问题全部通过。

## 收尾

专属浏览器 session 已关闭。无后台作业待收取，未 commit/push，证据留待主会话审查。仅完成本轮“验收准备与证据核对”，没有更改 #152 工作状态、Project 状态或关单状态。
