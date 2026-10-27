# dsh-a2d2

[English](README.md) | 中文

[CI](https://github.com/a2d2-dev/dsh-plugin/actions/workflows/ci.yml) · [贡献指南](CONTRIBUTING.md) · [支持](SUPPORT.md) · [安全政策](SECURITY.md) · [更新记录](CHANGELOG.md)

本仓库存放 **A²D² DeepSeek Harness 插件**：把 A²D² 落地进 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的各组件，作为一个可安装的插件交付。

后续版本从整合后的 `main` 发布。当前预发布版为 **v0.0.23**，相对 v0.0.22 的变化见[更新记录](CHANGELOG.md)；已有发行标签保持不变。

## 安装 v0.0.23 预发布包

升级前备份完整工作目录，包含控制 JSON、来源 sidecar 和 archive。旧插件不能直接读取新的存储元数据，降级方式见[存储迁移与离线降级](docs/architecture/work-dao.md)。

从 [GitHub Release v0.0.23](https://github.com/a2d2-dev/dsh-plugin/releases/tag/v0.0.23) 下载 `a2d2-dsh-a2d2-0.0.23.tgz`，不要解压，也不要使用自动生成的 Source code 压缩包。在实际使用的 profile 插件管理器输入文件绝对路径；命令行可用对应应用提供的 `dsh plugin --profile desktop add /absolute/path/a2d2-dsh-a2d2-0.0.23.tgz`。更新后完整退出并重新打开 DSH；仅刷新页面不足以替换旧会话实例。

包名保持 `@a2d2/dsh-a2d2`，包含完整工作面板、服务端与浏览器构建。此前 GitHub v0.0.1 使用 `dsh-a2d2`；不要把两种包名同时启用为两套 A²D² 实例。插件要求 Node.js 22 起；下文已核验的官方源码宿主要求 Node 24.9 起。该宿主的 Session/model、jobs 集成证据与匹配开发宿主上的 GUI 验收分开，未宣称所有官方桌面发行版均已验证。源码提交和校验文件随 Release 提供；发布操作本身不升级运行实例。

人工对话在任务等待、暂停、完成和交接后仍可使用。旧会话会提示新会话入口；对话不自动重开已完成任务或夺回协调身份。旧版暂存的未消费人工消息会在原会话下一次人工输入时恢复，保留内容及附件并去重。

## GitHub Project 与 Issue 工作流

打开 DSH 侧栏的 **A²D² 控制面板**，连接 GitHub 仓库或 Project，直接浏览和处理 Issues。连接和浏览不会启动模型。

右上角的头像入口显示宿主当前使用的账号。已有有效 `gh` 凭据时直接复用；未连接时，点击 **连接 GitHub** 启动 GitHub CLI 的[网页授权流程](https://cli.github.com/manual/gh_auth_login)，按页面提示填写一次性验证码并完成授权。凭据由宿主的 GitHub CLI 管理，前端只接收账号状态和一次性验证码。「取消授权」只停止当前授权流程，不退出已有账号；授权流程十分钟后自动停止等待。「退出登录」会在确认后移除当前账号在宿主保存的 `gh` 登录，影响使用该共享凭据的其他功能；它不撤销 GitHub 端的 OAuth 授权，也不删除来源缓存。若另有已保存的账号，界面会显示退出后实际生效的账号。环境变量提供的凭据无法在面板中退出，需要在宿主配置中管理。

点击来源栏的 **＋**，从当前账号可访问的仓库中选择，可按账号／组织、可见性以及名称或描述筛选。目录每次加载 50 个仓库，搜索覆盖已加载范围；滚动到列表底部会自动续载。选择仓库后确认添加，不会批量导入任务或启动执行。GitHub Project 和已知仓库链接可通过顶部的 **通过链接** 页签添加。来源读取时间放在状态浮层中；读取账号与当前身份不一致时显示账号。

点击列表中的 Issue 会立即打开详情，先显示所选 Issue 的标题、返回入口与加载状态，随后载入完整原文和已有工作进展。读取失败可在详情中重试；加载中也可返回列表，保留来源筛选和已载入条目。切换 Issue 或离开详情后，旧请求不会重新打开或覆盖当前页面。

1. 点击 Issue 查看原始要求、处理状态、下一步和阻塞。点击 **开始处理**，确认目录与模型后创建或复用当前处理会话。
2. 打开 PR 后的 **持续委托** 页签，在 **队列设置** 中确认来源、负责人、标签、更新周期、等待顺序、并发上限及执行配置。每个 Project 只有一个队列；保存后更新等待部分，点击 **继续处理队列** 才启用尚未开启的队列。
3. **暂停后续执行**保留在途 Task 与历史；调低并发不终止当前执行。Issue 中的**暂停处理**停止该项自动推进，自动任务输入先保存，直到显式恢复。原生会话中的人工消息始终可以发送并得到回应，不要求先恢复任务，也不自动解除暂停。自动调度继续遵守并发限制。
4. 在项目或当前执行中设置 **200K、300K 或自定义 token 目标**。系统在安全边界保存决定、证据与待办，再交给后继会话。目标结合实际模型容量校验，是提前接续目标，单个长轮次可能超过它。
5. 围绕原始 Issue 查看需求块、关联子 Issue 与更深层子工作，以及每项的状态、证据和待确认事项。完成依据当前验收结果；会话空闲和 GitHub Closed 都不会替代验收。

持续委托支持 GitHub Project 与仓库来源，按完整来源观察和已保存范围更新等待部分。手动更新、周期更新、保存设置后的更新均保留在途执行、历史与需人工项；移出等待不删除原 Task，已完成工作不会因刷新重跑。队列显示顺序、Task 入口、处理状态、会话入口与单项“结束处理”。结束会安全停止本项当前会话、原生子执行和准确归属的在途作业，再释放并发位置并移入历史；未消费结果和未验收事实保留。停止失败显示具体原因，可“重试结束”。普通暂停仍可恢复，明确结束的项不会因刷新、重启或再次扫描恢复。结束队列不写 Task 完成、不改变业务进展为 done，也不关闭 GitHub Issue。模型可用 `work_control action=end` 表达相同的明确结束意图；`pause` 仍是临时暂停。全部、正在处理、等待、需人工、历史只是展示筛选，浏览和跳转不改配置或启动模型。

旧委托、排除项和历史继续保留；第一次保存队列设置时明确后续范围。旧数据若包含同一 Project 的多个来源配置，系统保留在途和历史，暂停后续接入并提示在队列设置中确认范围，不自动合并授权。来源读取、执行、验收与 GitHub 远端状态分别显示，此流程不自动关闭远端 Issue。

Project、Issue、PR 表格的每列都有 `⋯`：选择整列、升降序、按当前观察到的真实值过滤，以及适用列的分组、切片、隐藏和移动。标题列可按类型／状态过滤，保留条目入口；不支持的动作置灰并说明原因。多值字段同列选项取并集，多列条件与搜索取交集。当前条件可清除；隐藏字段可通过“显示”恢复，“重置列表”恢复默认展示。

Issue 页的主搜索查询整个当前来源，按 Enter 或点击搜索图标提交。负责人、GitHub 状态、处理进展和标签集中在「筛选」中，提交后以可清除的标签展示。列操作与「列表选项」中的本地搜索仅覆盖已加载范围。空结果、尚未读取与读取失败分别显示原因和恢复操作；更新失败保留上次列表。列表右上角的图标打开本地列表选项浮层，可筛选已加载内容或重置列；关闭浮层不会清除已生效的条件。概览中的需要关注、正在处理和最近进展通过分段按钮切换，不使用折叠列表；没有已关联工作时只显示一个空状态。

Issue 和 PR 使用一致的搜索／筛选布局，表格在限定高度内滚动并固定表头；PR 的状态、草稿类型筛选作用于已读取目录。历史记录也会在滚动到底部后自动续载，读取失败时停止续载并提供重试。

详情页固定标题、操作和页签，仅内容区滚动；正文支持 GitHub 风格的 Markdown 表格、任务清单、代码块与链接，代码块提供复制图标。可执行 HTML 不会被渲染，危险链接协议会被拒绝。“开始处理”放在顶部操作栏，点击后仍需确认执行资源。

列表搜索标题、编号和仓库。Project 搜索当前保存视图及入口切片、含关闭设置范围内的完整扫描快照；PR 搜索当前目录，并明确目录是否完整；这两类先查询再截取展示行。Issue 的列搜索和处理状态仅作用于已加载范围，搜索整个来源使用上方“搜索当前来源”表单并应用。三类列表首批最多 100 行，接近底部每次追加最多 100 行；Issue 追加失败保留已有内容并可重试。切换来源、视图或查询时重置展示批次并清除不适用的列条件。未观察字段单独显示为未知，不能当作已确认空值。列查询和展示操作不会创建处理会话、开启持续处理或修改 GitHub 字段。

DSH Goal 自动续跑消息由 Goal 驱动管理，A²D² 不把它们保存为 Task 待投递输入，也不跨会话转移。旧版本误存而尚未消费的 Goal 消息会在执行恢复时标记为“已废弃”，保留原消息供查看，并停止重放；废弃不表示已被模型消费或已通过任务验收。Goal 的暂停与 Task 的恢复分别生效。

任务处理与接续会话自动使用任务名称和真实编号，例如 `#200/#211 · 会话 2 · 修复会话名称`。完整名称按宿主80字节上限保留编号、接续序列与可读短标题；规则和历史名称修复范围见[任务会话名称](docs/session-naming.md)。

以下章节还保留既有会话工具与兼容记录格式的说明；控制面板中的受管会话使用 `work_control`、`work_report` 和 `work_organize` 保存进展，不要求手工绑定 Issue。

更换处理会话时，从原任务的 **A²D² 接续 → 准备接续** 进入；宿主保存材料并接任后，新会话自动沿用同一个 Task。手工新建普通会话并调用旧版 `bind_main_session` 不会转移受管执行的协调权。原执行失败时先点 **重试原执行**，等待或暂停时先点 **恢复处理**，就绪后再准备接续。页面会显示失败原因，接受请求与恢复成功分别呈现。

已受管会话可以通过宿主模型选择器更换 provider、模型或推理强度；恢复读取当前会话的选择并更新执行记录，不把旧模型写回会话或全局默认。首次接管其他会话仍校验资源、preset、模型和权限；当前模型不可用或不符合项目策略时保留原任务并显示具体失败。接续详情的读取不会被等值关联轮询取消；关联不变时可用 **刷新观察** 更新详情。

子代理派发优先使用宿主的 `startActivation`，显式指定 `delivery: 'parent'`；仅在该方法不存在时使用旧宿主的 `startContinuable`。模型与 reasoningEffort 在派发请求的 `agentOptions` 中指定，不需要为派发新增 `selectLocalModel` 或修改 DSH 源码。新接口报错直接返回，不重试旧接口。两种契约的类型来自各自已发布的 DSH 包，别名依赖只用于开发时类型检查。会话 ID 原样兼容旧式 `session-…` 与 UUID，仍拒绝路径输入。

**A²D²（Agentic Agile Driven Development，智能体敏捷驱动开发）是一套开发方法学**——它把敏捷开发的节奏交给智能体来驱动：由高品质模型主持架构与决策，由多模型编排承担执行，让属于同一件工作的会话在推进过程中始终串在一起。方法学本身比这个插件更大（它还涵盖工作流 skill 与多模型编排）；本仓库只是它在 DSH 一侧的具体落点。随着这一落地增长，更多 DSH 侧组件都会归在同一个 `a2d2` 命名空间下、存放于此。

插件当前给 DSH 带来的能力：

- **任务聚合**——一个任务把属于同一件工作的会话归到一起，并记录它们之间的交接边，使相关会话保留一段可阅读、可评审、可提交的关系。数据存放在项目本地文档中，且不为承载它而修改任何会话的持久格式。绑定了任务 issue 的任务还记着它的主会话——此刻执行它的那一条会话，由会话用 `bind_main_session` 工具绑定。主会话可以用 `open_subtask` 把设计较重的子任务开成根主会话，也可以用 `dispatch_subagent` 派出可续跑子代理，或用 `complete_task` 宣告自己的任务完成；Agent 身份与模型选择都来自阶段 Agent 表。
- **会话交接**——`/handoff` 把工作从一条又长又贵的会话搬到一条干净的新会话而不丢失脉络：交接出去的会话写下有界的接续内容，后继会话据此继续。
- **指示球**——输入框旁一枚可一眼看清上下文长度与花费的小球；会话接近 smart zone 时告警，提醒在下个相位边界决定去向。
- **A²D² 控制面板**——DSH 内的 GitHub Project 与 Issue 入口，连接原始要求、持续处理、需求拆解、验收进展和当前处理会话。
- **GitHub 关注**——`github_watch` 让会话不用轮询就能等一个 PR：PR 合并、关闭、CI 出结果或有了 review 结论时，会话会收到一条消息，空闲中的会话也会被唤醒。
- **通知**——任务 issue 的主会话停下来等 LF 时，经已装的 `notifier` 提供者往 LF 手机推一条带 A²D² 语义的消息。

> `A²D²` 是品牌与展示写法；`a2d2` 是技术标识——包名、目录、服务名都用它，因为 `²` 不能进 npm 包名。包名为 `@a2d2/dsh-a2d2`。

本文余下部分是插件的行为契约与已知限制，按各组件分列于下。

## 安装与开发

插件开发需要 Node.js 22 或更高版本、pnpm 10.26.2。当前开发源码保留已验证的 DSH 0.2.0-rc.2 / 0.2.1-rc.2 契约，并适配未经修改的官方源码构建 [`22ddee37`](https://github.com/deepseek-ai/deepseek-harness/tree/22ddee3792402c3e70ec5f86a63c3e3e895a2f60)（`0.2.1-rc.3`，宿主需要 Node 24.9 起）。Session/model 与 jobs 集成测试实际使用该官方构建；生产 profile 激活、完整数据备份与 GUI 验收仍是独立的部署检查。

会话初始化使用官方公开的 `Agent.model.current/select`，同时保留旧宿主已验证的 `sessionController.selectLocalModel`。同版 npm `0.2.1-rc.3` 分发包不包含这两种能力，会在会话本地模型初始化时被明确拒绝。版本号和 metadata 准入不能证明完整兼容性，参见[整合验证证据](docs/verification/issue-243-integrated-compat.md)和[可复用升级测试集](docs/verification/dsh-upgrade-test-suite.md)。运行 `node scripts/verify-dsh-upgrade.mjs --help` 可查看固定候选的快速检查与单阶段重跑入口。

从源码构建：

```sh
git clone https://github.com/a2d2-dev/dsh-plugin.git
cd dsh-plugin
corepack enable
pnpm install --frozen-lockfile
pnpm verify:repository
pnpm typecheck
pnpm test
pnpm test:node
pnpm verify:pack-exports        # 要求已提交且干净的 HEAD
pnpm pack --pack-destination /absolute/path/to/output
```

将生成的 tarball 安装到已有的 DSH web profile：

```sh
dsh plugin --profile web add /absolute/path/to/output/a2d2-dsh-a2d2-0.0.23.tgz
```

包名和浏览器 bundle 名称统一为 `@a2d2/dsh-a2d2`；本项目不在 `@deepseek-ai` scope 下发布。npm registry 发布及干净宿主上的端到端安装尚未验证。Agent 候选应配置为宿主实际可用的 provider/model 路由；示例默认值不代表插件提供这些模型。可选工作流 skill（`ask-matt`、`handoff`）需单独安装，路径见下方 `skillsRoot`。GitHub 功能还需要安装并认证 `gh` CLI。

将构建后的 tarball 安装到实际使用的 profile（`desktop` 或 `web`）。源码 checkout 没有 `lib/`；`pnpm pack` 会通过 `prepack` 构建。Git URL 安装可以运行准备构建，但较新 pnpm 可能要求在所属 profile 显式批准精确提交，见 [Git 安装说明](docs/git-installation.md)；不要配置一律允许依赖构建。

贡献检查和测试资料存放方式见[贡献指南](CONTRIBUTING.md)与[测试说明](docs/testing.md)。可选的 GitHub watch 会将 GitHub token 发送到指定 relay，默认由 A²D² 项目运营的 `hooks.a2d2.dev`；启用前阅读[凭据信任边界](SECURITY.md#credentials-and-external-services)。

本地工作数据通过共享 DAO 和不可变历史/回执归档保存。备份须包含完整工作目录；旧插件会拒绝新的存储元数据。参见[存储、迁移与离线降级](docs/architecture/work-dao.md)。

## 许可证

采用 [Apache License, Version 2.0](LICENSE)。第三方依赖保留各自许可证；参见[发布要求](docs/releasing.md)。

## 插件（namespace：`a2d2`）

本包声明十个挂载行，其中 `a2d2-work` 提供受管工作面板和工具，兼容的 `a2d2-task-runtime` 默认禁用。其余八行保留以下会话工具能力。`ctx.a2d2` 是任务存储，不声明任何服务，因此在任何 profile 中都会加载；命令行声明了 `commands` 与 `a2d2`，所以只有组合了两者的 profile 才得到 `/handoff`；基础工具行声明了 `tools` 与 `a2d2`，所以只有组合了两者的 profile 才得到 `bind_main_session` 与 `dispatch_subagent`；开子任务工具行额外声明 `agents` 与 `llm`，因为 `open_subtask` 要创建根会话，并从 `grill` 阶段指定的 Agent 选择模型；完成任务工具行声明 `agents`，因为 `complete_task` 可能需要先恢复父任务主会话再发送通知；CEO 提示段行声明了 `agents`、`systemPrompt` 与 `a2d2`，所以只有同时组合 live Agents 与系统提示词组装的 profile 才得到主会话作用域指导；Agent 提示段行使用同一组服务，为已记录 Agent 的工程师/评审会话装配配置；GitHub 关注行声明了 `tools`、`agents`、`sessions` 与 `sessionController`，所以只有能唤醒会话的 profile 才得到 `github_watch`。`dispatch_subagent` 只在实际运行时查找 `subagents`，因此没有子代理服务的 profile 仍能加载基础工具行，`bind_main_session` 照常可用。Cordis 对"声明了却缺失的服务"是拒绝加载，这正是把它们拆成多行、而不是从一行里条件式注册的原因。悬浮球不需要自己的一行：它通过自己已经身处的那个会话驱动同一条命令。

发布前运行 `pnpm verify:pack-exports`。它先用 `git archive HEAD` 只把 git 跟踪的文件导出到临时干净树（并断言其中没有 `lib/`），在该树里运行 `pnpm pack`，让 `prepack` 从零构建；随后断言 tarball 文件清单包含全部显式 `exports` 目标（含类型声明与 client 产物）、`dsh.plugin.json` 与 `cordis.patch.yml`，再把同一个 tarball 安装到空的临时项目并逐个导入 `package.json` exports 声明的每个 Node 入口。因此这个检查既覆盖空壳 tarball（未构建就打包的失败形态），也会在发版前发现遗漏的 hash 构建分块，例如共享的交接分块。由于校验对象是已提交的 `HEAD`，工作区有未提交改动时该检查会直接失败：先 commit 或 stash。

```yaml
- id: a2d2
  name: '@a2d2/dsh-a2d2'
- id: a2d2-work
  name: '@a2d2/dsh-a2d2/work-plugin'
- id: a2d2-command
  name: '@a2d2/dsh-a2d2/command'
- id: a2d2-tools
  name: '@a2d2/dsh-a2d2/tools'
- id: a2d2-open-subtask-tools
  name: '@a2d2/dsh-a2d2/open-subtask-tools'
- id: a2d2-complete-task-tools
  name: '@a2d2/dsh-a2d2/complete-task-tools'
- id: a2d2-ceo-prompt
  name: '@a2d2/dsh-a2d2/ceo-prompt'
- id: a2d2-agent-prompt
  name: '@a2d2/dsh-a2d2/agent-prompt'
- id: a2d2-github-watch
  name: '@a2d2/dsh-a2d2/github-watch'
- id: a2d2-task-runtime
  name: '@a2d2/dsh-a2d2/task-runtime'
  config:
    enabled: false
```

| 键 | 默认值 | 约定 |
|---|---|---|
| `root` | 每次调用时推导 | 绝对的项目根。设置后，会话 cwd 不再决定存储位置；相对路径在加载时失败。 |
| `projectMarkers` | `['.git']` | 从会话 cwd 向上查找项目根时用于识别的目录项。空列表在加载时失败。 |
| `skillsRoot` | `~/.agents/skills` | 显式指定包含已安装 skill 的绝对目录；省略则探测约定位置。宿主从这里读取 `handoff/SKILL.md` 及其声明的本地 markdown 资源。 |
| `suggestedSkills` | `['implement', 'tdd', 'code-review']` | 已废弃的兼容配置；仍可加载，但不再渲染或消费。 |
| `handoffWarnTokens` | `150000` | 指示球从多少 token 上下文长度开始告警会话正接近 smart zone。≤0 在加载时失败；大于 `handoffCriticalTokens` 也在加载时失败。 |
| `handoffCriticalTokens` | `1000000` | 悬浮球进入危急色的上下文长度。 |
| `modelPrices` | `{}` | 悬浮球花费行用的每百万 token 费率，键先看 `provider/model`、再看裸 `model`。负数或非有限值在加载时失败。 |
| `currency` | `¥` | 费率所标价的货币符号。 |

这些配置键属于 `a2d2` 那一行。每个方法都接收调用方的会话 cwd 并自行推导项目根，因此调用方不携带任何项目簿记。`list` 读取该项目的任务，`resolve` 返回新会话继承的任务，`create` 生成 id 并写入文档，`registerMember` 把一个会话登记为成员并可选地记录交接边，`prepareHandoff` / `takeHandoff` 分别写入与消费交接文档，`bindMainSession` 把一条会话绑定为某任务 issue 的主会话，`openSubtask` 把一个子任务 issue 开成新的根主会话，`completeTask` 把任务 issue 标成完成并在有父主会话时通知它，`taskOfMainSession` / `mainSessionOfIssue` 分别回答"这条会话是哪个任务的主会话"与"这个任务 issue 的主会话是哪条"。

### 阶段 Agent settings

插件还在 DSH 的 `settings.yaml` 暴露实时阶段 Agent settings。落盘 section 以插件 profile entry id 为键，本插件拥有该 section 内的 `stageAgents` 值。用户可以在不重启宿主的情况下调整阶段分配、Agent 模型候选和咨询候选。

```yaml
<profile entry id>:
  stageAgents:
    stages:
      grill: ceo
      to-spec: ceo
      to-tickets: ceo
      implement: engineer
      code-review: reviewer
      prototype: ceo
      handoff: ceo
      diagnosing-bugs: ceo
      triage: ceo
      wayfinder: ceo
      improve-codebase-architecture: ceo
      domain-modeling: ceo
      codebase-design: ceo
    agents:
      ceo:
        - claude-bray/claude-fable-5-1
        - codex/gpt-6
      engineer:
        - codex/gpt-5.5
        - claude-bray/claude-opus-5-5
      reviewer:
        - claude-bray/claude-fable-5-1
        - codex/gpt-6
    consult:
      - claude-bray/claude-fable-5-1
      - codex/gpt-6
```

`stages` 覆盖 Matt 公路图闭集阶段，每个阶段映射到 `ceo`、`engineer` 或 `reviewer`；独立区任意 skill 按规则使用 CEO，不进表。`agents` 与 `consult` 都是有序的 `provider/model` 候选列表。空列表、格式错误 route、未知阶段和未知 Agent 名都会被 settings schema 拒绝。默认值把 `implement` 交给 engineer，`code-review` 交给 reviewer，其余闭集阶段交给 CEO。CEO、reviewer 和 consult 默认是 `claude-bray/claude-fable-5-1` 再到 `codex/gpt-6`；engineer 默认是 `codex/gpt-5.5` 再到 `claude-bray/claude-opus-5-5`。若 reviewer 与 engineer 的首选候选相同，宿主会记录中文告警，但不会拒绝该设置。

### 子会话推理强度

在 **设置 → A2D2 配置 → Agent 模型候选** 中，每个模型旁的「推理强度」下拉框只列出该精确模型声明的档位。工程师、评审、CEO 和咨询分别配置；保存后下一次创建或派发使用新值，已有会话不变。没有声明档位的模型不可选择强度；模型元数据缺失会单独显示「元数据不可用」，不当作已声明无档位。任何显式强度都必须能用该精确路由的元数据验证：元数据缺失、未知路由或已声明空档位时，保存和测试都会被拒绝，不提示成功，也不会静默忽略强度。旧路由字符串仍可在没有强度元数据时保存。

旧 `provider/model` 字符串仍有效，未指定强度时保留 DSH 的原有默认与继承规则。需要独立强度的候选使用对象：

```yaml
engineer:
  - route: claude-bray/claude-opus-5-5
    reasoningEffort: medium
reviewer:
  - route: claude-bray/claude-opus-5-5
    reasoningEffort: high
```

这些列表位于 `stageAgents.agents` 下。咨询同样可在 `stageAgents.consult` 中使用对象。不要给路由字符串添加 `@medium` 后缀。芯片新建和交接创建由宿主设置会话本地模型，不调用会保存全局默认的 DSH 模型选择器。重复登记同一 Agent 不会重新设置已有会话的模型或强度。「测试」会使用当前候选所选强度，修改强度后不会复用旧档位的测试结果。

芯片新建和交接会话初始化要求公开的会话本地模型选择：官方 `Agent.model.current/select`，或旧宿主已验证的 `ctx.sessionController.selectLocalModel({ sessionId, provider, model, reasoningEffort? })`。设置前验证 provider/model 与显式强度，已开始的会话拒绝再次初始化。两种能力都缺少时明确拒绝；不会调用保存全局默认的 `selectModel`，也不会修改私有 Agent 或 registry。

初始化按会话串行执行，不阻塞其他会话。只有会话本地模型安装成功后才登记 Agent；安装失败不留下身份记录，可重新尝试，已经排队的请求也可继续。成功后重复初始化同一 Agent 不重装模型，保留用户手动选择；不同 Agent 会在安装前被拒绝。

### 会话 Agent 装配

主会话由任务绑定推出为 CEO，不另写 Agent 账本。`dispatch_subagent` 会把子代理会话记录为请求阶段指定的 Agent；需登录的浏览器路由 `/a2d2/api/session-agent` 供芯片创建的会话登记为 `ceo`、`engineer` 或 `reviewer`。该路由只接受 POST，使用与 `/a2d2/api/consult`、`/a2d2/api/config` 相同的 DSH 浏览器认证和 64 KiB JSON 请求体上限，会拒绝未知会话 id、非法 Agent 值、任务 issue 主会话，以及把已记录会话改写成另一个 Agent 的请求，并写入项目本地 `.dsh/a2d2/session-agents.yaml` 账本。把同一会话重复登记成同一 Agent 是幂等操作。`ctx.a2d2.agentOfSession(cwd, session)` 对任务 issue 主会话返回 `ceo`，对已记录的非主会话返回账本值，对普通未记录会话返回 `undefined`。

组合了 `agent-prompt` 行时，工程师和评审会话会得到一个作用域 `a2d2:agent` 系统提示段。该段先读 `~/.dsh/a2d2/agents/<engineer|reviewer>.md`，再读 `<项目根>/.dsh/a2d2/agents/<engineer|reviewer>.md`，并标明项目配置优先于全局配置。文件在每次系统提示词组装时现读；缺失或为空就跳过；两级都缺时该段渲染为空，因此之后新增配置文件会影响下一次请求。这些用户编写的 Agent 配置按字面提示词处理，`{{...}}` 示例会原样保留而不会被插值。这些文件不写入会话历史。CEO 继续使用既有的 `a2d2:ceo` 段与 SOUL 行为，SOUL 文本同样按字面处理。

### A2D2 配置页

浏览器 bundle 会向 DSH 设置导航注册一个独立 section：**A2D2 配置**。页面首块画完整 Matt 公路图，并为每个闭集阶段提供 Agent 选择器；独立区显示为 **CEO（任意 skill）**，不可编辑。公路图下方编辑四个有序候选列表：CEO、工程师、评审与咨询。可拖拽调整优先级，也可在排序手柄上使用方向键操作；修改后才显示保存按钮，控件跟随宿主深浅主题。

页面不会从浏览器直接写任意 settings 命名空间。它调用本插件自己的路由 `/a2d2/api/config`。与所有 A²D² 浏览器路由（`/a2d2/api/config`、`/a2d2/api/consult`、`/a2d2/api/session-agent`、`/a2d2/api/tasks`）一样，它先询问 DSH 的 `connection` 服务（`requestRejection`），该检查与 DSH 内置通道相同：Host/Origin 栅栏加浏览器登录校验。未带 DSH 登录 cookie 的请求得到 `401`（`unauthenticated`），来自不受信 authority 或 origin 的请求得到 `403`（`untrusted`），均在读取请求体之前拒绝。仅凭 Host 或 Origin 请求头永远不够，因为任何非浏览器客户端都能伪造它们。没有 `connection` 服务的 profile 不注册这些路由。浏览器端同源 `fetch` 会自动带上登录 cookie，已登录的 DSH 页面无需额外处理。请求体上限是 64 KiB，JSON 解析失败会被拒绝；读取会返回当前 settings revision，保存必须带着该 revision 整体替换 `stageAgents` 值：`stages`、`agents`、`consult` 三节必须齐全，`stages` 必须覆盖全部闭集公路阶段，`agents` 必须包含 `ceo`、`engineer`、`reviewer`，`stageAgents` 内未知顶层键（例如旧形状的 `stations`）会被拒绝。缺 revision 不会写入；若保存时 revision 已过期，路由拒绝写入并返回最新值；空列表、格式错误 route 等 schema 失败会直接回显原因，且不会落盘。

新增候选只能从 DSH 宿主模型目录（`llm.models`）选择，因此页面不会制造拼写错误的 route。每个已有候选旁都有 **测试** 动作：点击时宿主只发一次极小调用（`reply OK`，小输出预算），并把结果分类为正常、拒答、限流或报错，同时显示原因；空输出按报错处理。没有后台轮询探测。

## 任务文档

一个任务一个 YAML 文档，位于 `<projectRoot>/.dsh/a2d2/tasks/<id>.yaml`。`<projectRoot>/.dsh/` 是既有的项目本地根——与 `skill-filesystem` 使用 `.dsh/skills` 的锚点相同——插件短名给该存储划出命名空间，使它即使将来承载更多种类的状态，足迹仍是一个目录。

```yaml
version: 2
id: issue-45
issue:
  number: 45
  parent: 41
  mainSession: session-b
name: Bind the main session
state: active
createdAt: 2026-10-01T00:00:00.000Z
sessions:
  - id: session-a
  - id: session-b
    handoffFrom: session-a
```

绑定了任务 issue 的任务以 issue 编号为身份——`issue-<编号>.yaml`，一个项目里一个任务 issue 至多一份文档。它的 `issue` 映射记着 `number`（编号）、子任务的 `parent`（父任务 issue）、`mainSession`（主会话），以及主会话交接已准备、尚未 take 时的 `handoff.source`（交接中，记源会话）。任务的完成状态就是 `state: done`。未绑定 issue 的任务（例如 `/handoff` 自动建的）没有 `issue` 映射，id 由名称推导。

文档版本是 2。版本 1 的文档早于任务 issue：仍能读出，视为未绑定 issue 的任务，下一次写回时按版本 2 写。

文档是人可以手工编辑并提交的文件，因此校验发生在该边界上，并且**失败要响**而不是降级：不支持的 `version`、与文件名不符的 `id`、未知的 `state`、空名、非序列的 `sessions`，以及 `number` 或 `parent` 不是正整数、文档 id 不是 `issue-<编号>`、或 `mainSession` 不在 `sessions` 里的 `issue`，都会拒绝该文档，而不是产出一个空任务。任务目录缺失属于合法的空状态；对于人能亲眼看到的问题文档，`list` 也不会把它吞掉。

写入是原子的，并通过文档自身的文件锁串行化。`create` 由名称推导 id；不含 ASCII 词干的名称（例如中文名）回退为时间戳词干，因为 id 只需唯一且安全，而人读的名称就存在文档里。

## 主会话

`bind_main_session` 把调用它的会话绑定为某个任务 issue 的主会话（ADR 0003）。参数是 `issue`、`parent_issue`（只在子任务时给）与 `title`（首次记录任务时作为任务名，缺省为 `Task issue #<编号>`）；会话 id 与 cwd 取自调用方 agent。工具只把这些转交给 `ctx.a2d2.bindMainSession`，规则都在服务里：

- 首次绑定写出 `issue-<编号>.yaml`，该会话既是 `mainSession`，也是第一个成员。
- 一个任务 issue 同一时刻只有一条主会话：另一条会话来绑定会被拒绝，并说明当前主会话是哪条；后继只能经交接接任。
- 一条会话至多是一个任务 issue 的主会话，所以"这条会话在执行哪个任务"只有一个答案。
- 以相同参数再次绑定，返回已记录的任务、不做改动；父任务 issue 不同则拒绝。
- 当组合了 CEO 提示段行时，绑定成功还会把作用域内的 `a2d2:ceo` 系统提示段装到这条主会话正在运行的 Agent 上；之后创建或恢复的 Agent，如果其会话已经是该任务 issue 的主会话，也会得到同一段。
- 已有一份占用 `issue-<编号>` 这个 id 的未绑定任务时拒绝，而不是把它接管；会话没有工作目录时同样拒绝。

## 开子任务

`open_subtask` 让一个任务 issue 的主会话把某个子任务 issue 开成它自己的根主会话（ADR 0005）。唯一参数是 `issue`，也就是已经建好并挂到父任务下的子任务 issue 编号。调用方自己的任务 issue 会成为父 issue。

服务会读取 `grill` 阶段指定的 Agent，从该 Agent 候选中选择第一个出现在 DSH 实时模型目录里的 `provider/model`；随后在同一项目 cwd 下创建一条新的根 Agent 会话，给它设置该模型，只投递一条首条 prompt：子任务 issue 编号引用、父任务 issue（spec 在其中）编号引用、在本项目目录运行的逐条 `gh issue view <编号> --comments` 读取命令，以及“用 `/grill-with-docs` 推进、你是该任务的主会话”的指令；最后复用 `bindMainSession` 把新会话记录为子任务主会话。非任务 issue 主会话调用会被拒绝；子任务 issue 已有主会话时也会被拒绝。

## 宣告完成

`complete_task` 让任务 issue 的主会话在验收完成后宣告自己的任务已完成。参数是 `summary`，即要交给父任务 CEO 的完成说明。插件只写项目本地任务文档（`state: done`）；它不调用 GitHub，关闭任务 issue 仍由 CEO 自己完成。

只有任务 issue 当前主会话能完成该任务。任务没有父 issue 时，写完文档即结束。任务有父 issue 且父任务有主会话时，插件用 `a2d2-complete-task` 来源向父主会话发送一条通知。通知只写子任务 issue（`#<编号>`）与完成说明，不拼 URL。父主会话已加载时，插件直接对 live Agent 调用 `followup`；未加载时，插件先调用 DSH `agents.resume({ resumeSessionId })`，再对恢复出的 Agent 调用 `followup`。

## 通知

任务 issue 的主会话停下来等 LF 时，插件经可选的 `notifier` 服务往 LF 手机推一条消息（ADR 0010）。「这算不算在等 LF、消息说什么」由 A²D² 判断；送达交给提供 `notifier` 服务的插件。**提供者只装一个**：a2d2-dev/dsh-feishu-connect（飞书应用机器人）或 dsh-notifier（多渠道），二选一——两者提供同一个服务名，同时装会抢。没装提供者时插件照常启动、照常运行，不发通知；插件用回调式 `ctx.inject(['notifier'], …)` 接入，不用静态 `inject`，所以缺提供者不会卡住启动。

只有任务 issue 的主会话会发；子代理和未绑定的会话不发。三种等待会触发消息：

| 等待 | 标题 | 正文 | 级别 | 时机 |
|---|---|---|---|---|
| 一轮结束（`completed`、`error`、`blocked`、`max-tokens`） | `#<issue> · 等你回复` | 这一轮最后一段助手回复（截到 300 字），再加任务 issue 链接 | `active` | 一轮结束 30 秒后；期间该会话有 `user/*` 事件或重新开始一轮就撤销；调用过 `complete_task` 的那一轮不发 |
| 调用 `ask_user_question` | `#<issue> · 需要你决定` | 问题文本，再加任务 issue 链接 | `timeSensitive` | 立即 |
| `complete_task` 成功 | `#<issue> · 已完成` | 完成说明 | `active` | 立即；所在那一轮结束时不再发 `等你回复` |

以 `aborted` 结束的一轮，以及事后补写的 `interrupted`/`forked` 收尾，不发消息。链接是 `https://github.com/<owner>/<name>/issues/<issue>`，取自会话 cwd 的 `github.com` `origin`；没有就不带链接。标题不带阶段：当前阶段只写在任务 issue 的「现状」里，插件不读它。

每次推送都是 `ctx.notifier.push({ title, content, level }, { sourceName: 'dsh-a2d2', sessionId })`。`sessionId` 让提供者撤销它自己为同一次等待准备的通用通知，一次等待只收到一条。结果只记日志；推送失败、reject 或抛错都不影响会话。

## 派子代理

`dispatch_subagent` 从调用它的主会话派出一个可续跑子代理。参数是 `stage`、`issue` 与 `prompt`；父 Agent、会话 id、cwd 与取消信号取自工具执行上下文。工具只把这些转交给 `ctx.a2d2.dispatchSubagent`，规则都在服务里：

- 只有任务 issue 当前的主会话能派子代理；普通会话会被拒绝。
- 子代理使用 DSH 的 fresh `spawn` 可续跑 provider。
- 阶段先映射到 `ceo`、`engineer` 或 `reviewer`；模型取该 Agent 候选中第一个存在于 DSH 宿主模型目录的 `provider/model`，派发时只读一次，因此 settings 改动影响下一次调用，也不会出现返回 Agent 与选模型所用 Agent 不一致。
- 子会话 id 会预先生成，并在 DSH 创建子代理前记录为该阶段 Agent，使 `agent-prompt` 行能把工程师/评审配置装配进子会话首轮系统提示词。`dispatch_subagent` 不再通过 DSH `persona` 字段传入项目 Agent 配置。
- 返回值给出子代理会话 id、实际 `provider/model` 与所用阶段 Agent（`ceo`、`engineer` 或 `reviewer`）。

## GitHub 关注

`github_watch` 的参数是 `pr` 和可选的 `repo`（`owner/name`）。省略 `repo` 时，取会话工作目录的 `github.com` origin。PR 状态来自 A²D² hooks 服务 `https://hooks.a2d2.dev`（仓库 a2d2-dev/a2d2-services）。服务以 a2d2-bot GitHub App 的身份读 GitHub，每个事件只为所有订阅者读一次；PR 状态一变，就通过出站 WebSocket 推送过来。所以插件不需要公网地址，不用配置 webhook，也从不轮询 GitHub。它对 GitHub 的唯一调用是领取 ticket，请求里带用户的 `gh auth token`（或 `GH_TOKEN` / `GITHUB_TOKEN`），供服务检查读权限。

- 调用会返回 PR 的当前状态：open/closed/merged、CI 汇总和 review 结论。PR 若已合并或关闭，关注当场结束。
- 关注列表和"每个会话上次被告知的状态"存在 `~/.dsh/a2d2/github-watches.json`。之后收到的每个状态都和该会话上次被告知的比较，只有不同才注入消息。消息是持久的 user 角色 notice，source 为 `{ kind: 'a2d2-github-watch', repo, pr }`，并带一行摘要，例如 `a2d2-dev/x#7: merged, CI passed`。注入会唤醒空闲的会话。
- DSH 重启后，所有已存的关注会重新连接。服务返回的快照会和上次告知的状态比较：DSH 停机期间发生的变化补报一次；什么都没变就不报。
- 已合并、已关闭或不存在的状态告知之后，关注结束。会话不存在了，关注也会结束。
- 仓库没装 a2d2-bot 时，调用返回 `not_installed` 和安装链接（`https://github.com/apps/a2d2-bot/installations/new`），不保留关注。App 之后被卸载的话，正在关注的会话会收到一次通知，关注随之结束。
- 服务连不上时会退避重连（1 秒起，最长 60 秒）。服务 20 秒内没有回应时，调用返回 `pending`，第一个状态之后以消息形式送达。

| 键（`a2d2-github-watch` 行） | 默认 | 约定 |
|---|---|---|
| `relayUrl` | `https://hooks.a2d2.dev` | hooks 服务的基础 URL。 |
| `homeDir` | `~/.dsh/a2d2` | `github-watches.json` 所在目录。 |

## `/handoff`

一个命令名同时覆盖交接的两侧，因为后继会话的 id 只有在那个会话存在之后才存在。

```
/handoff [<focus>] [--task <task-id>] [--focus <focus>]
/handoff take <session-id>
```

| 调用 | 效果 |
|---|---|
| `/handoff` | 对当前会话发起一次交接，不说明 focus。 |
| `/handoff <focus>` | 同上，并记录下一次会话的目的。 |
| `/handoff --task <task-id>` | 在指定任务内交接，而不是用解析出的默认任务。 |
| `/handoff take <session-id>` | 读取该会话的交接文档，把当前会话加入被交接会话所属的任务，并把该文档正文作为本会话的首条 prompt 提交。 |

准备分两步，因为只有交接出去的会话才持有仍可能只存在于对话里的状态。命令先写入文档骨架——front matter 加固定小节——再为该会话排入一轮普通的 turn，请它的 agent 把接续内容写进文档。在这一轮结束之前，文档解析为 `unwritten` 而不是一份交接，因此从未写出的内容不可能被 take。take 只有一步：`take` 从被交接会话自身的成员关系推导任务，所以后继只需要它要延续的那个会话 id。

源侧解析该项目最新的 `active` 任务，项目里一个都没有时就创建一个，名称取 focus（没有 focus 则取项目目录名）。任务文档是随项目进版本控制的，所以交接需要一个可归属的任务；要求人先手写那个文件，会让这条命令在此之前完全不可用。

源会话立即加入任务；后继会话在 take 时加入，因为一个从未被打开的会话没有可指向的对象——文档是该意图的唯一记录。两次登记都是幂等的，重试的命令既不会重复成员，也不会覆盖首次尝试写下的边。

当源会话是某个任务 issue 的 `mainSession` 时，prepare 还会写入 `issue.handoff.source`，把任务 issue 标为「交接中」，同时 `issue.mainSession` 仍留在源会话。因此准备了但从未 take 的任务不会失去 CEO。成功 `take` 后，`issue.mainSession` 换成后继会话，`issue.handoff` 清空，同时照旧记录普通成员上的 `handoffFrom` 交接边。源会话不是任务 issue 主会话时，交接行为完全不变。

畸形输入**失败要响**，不会降级成 focus：未知选项（`--fucos`）、只有选项名没有值、同一选项给了两次、不是文档 id 的 task id、以及 `take` 缺参数或多给一个参数，都返回错误并附用法行。

脱敏是尽力而为的，并且发生在进入后继 prompt 的路上。带名称赋值的安全值、`Bearer` token、URL 中的密码、以及带提供方前缀的 token（`sk-`、`ghp_` 等）会替换为"删除了多少字符"的占位符；当这一趟脱敏改动了摘要时，文档会按脱敏后的文本重写，使提交的文件与 prompt 一致。模式未识别出的秘密——例如没有标签的随机串——会原样进入文档，因此处理过凭据的会话所产生的交接文档，不先读过就不该提交。撰写方 agent 也会被告知要脱敏秘密，这是第二道更弱的防线，而不能替代亲自读文件。

## 交接文档

一个被交接的会话一份 markdown 文档，位于 `<projectRoot>/.dsh/a2d2/handoffs/<session-id>.md`。两个写者各自拥有不同的一半：插件拥有它会解析回来的 YAML front matter——源会话、任务、时间戳、focus，以及可选的 skill 真源降级标记——和正文里的固定小节。两个 HTML 注释标记之间的接续内容归交接出去的会话自己的 agent 所有；它按状态所在地自判写指针、对话状态摘要或二者混合。正文就是后继收到的首条 prompt，因此只携带那个会话真正需要的东西：完成交接的那行 `take` 命令属于源侧，由命令自己的结果给出——后继读到它时，这一步早已发生。

`/handoff take` 在该文件边界上校验文档：不支持的 `version`、与查找所用会话不符的 `source`、未知的 front matter 字段、没有摘要区域的正文、以及仍带着占位符的摘要，都会拒绝该文档。文档缺失同样是失败，绝不降级为"无内容的继续"，因为刚 clone 下来的工作区可能确实还没有这个文件。

`.dsh/` 不在 `.gitignore` 里（只忽略了 `.dsh-build/`），因此任务文档与交接文档都进入版本控制——这正是把它们放在工作区里的目的。交接文档也就把摘要带进了版本库，所以插件会在后继读到它之前先做脱敏，也因此这份文件值得在提交前读一遍。

### 写接续内容的那一轮

宿主从 `skillsRoot` 读取 `handoff/SKILL.md`，按正文声明顺序跟随本地 markdown 引用，并把这些文件逐字注入。其后只有参数信封：文档路径、标记对、focus 与约 4000 字符预算，不复述任何 skill 规则。`SKILL.md` 缺失时只给一句最小交接要求，同时骨架写入 `skillSource: unavailable`，让降级可见而不内嵌回落知识。文档版本仍是 `2`：更早的构建写出的文档声明版本 `1`，会被拒绝，而不是去读一份它并不包含的内容。

## 派生的交接边

交接边只存一个方向：成员上的 `handoffFrom`，指向它由哪个会话交接而来。`successorsOf` 从同一文档派生相反方向，因此两个方向不可能互相矛盾；`handedOff` 报告某会话当前是否存在后继。

`handedOff` 报告的是"存在延续"，而非"该会话已结束"。交接不是终态：真实流程会交接到别处跑一段再交接回来，因此源会话保持可用，它自己也可能获得多个后继。

## 指示球

本包还带一个浏览器 bundle（`exports["./client"]`、`dsh.client.platform: 'web'`），挂在**裸 `@a2d2/dsh-a2d2` 行**上——子路径行永远不能承载客户端半边，而且 bundle 自己注册的 id 必须等于入口名，这就是为什么它的 id 就是包名。

它在输入框旁渲染一个圆形指示球：显示当前会话的**上下文长度**（`453K`、`1.2M`），该路由配了费率时再显示估算的输入花费。**背景色承载读数**：低于告警长度为绿，达阈值为琥珀，危急为红；默认告警长度为 150K token。琥珀色表示会话接近 smart zone：到下个相位边界该做五选一，交接只是其一。悬停给出完整数字——精确 token、容量、百分比、以及带货币符号的花费——并在圆球上方只露出一个边界入口：**下一步**。交接不再是球上的平级动作。

### 边界卡

点击 **下一步** 打开的卡片，顶部立刻显示现状区块，回答「它现在在干嘛」：运行中（在跑的工具及已运行时长）、在等你（待审批——含工具名与理由——或待回答的问题）、疑似卡住（运行中、无流式输出、且 10 分钟没有新的轮次或工具调用）、出错了、空闲（上一轮何时结束）或尚未开始，外加排队消息与上下文占用。它只读客户端已有的会话快照，不调模型，卡片打开期间实时刷新，因此咨询还在生成时卡片也不是空的。

同时，卡片会针对当前会话发起一次不进入会话历史的咨询。新宿主返回公路图坐标（`zone`、`station`、`phaseDone`，服务区另带 `returnTo`）、推荐下一站与走法、2-4 颗带走法的候选芯片、`stageAgents: { stages, agents }`，以及会话已记录为 `ceo`、`engineer` 或 `reviewer` 时的 `sessionAgent`。卡片先显示现状区块，再画一条竖向迷你公路：主干 `grill` -> `to-spec` -> `to-tickets` -> `implement` -> `code-review`，标出已过 / 当前 / 下一站 / 未到站，并显示每站中文职责和该阶段配置的 Agent。服务区与匝道显示旁注，例如「绕道中：prototype，完成后 handoff 回 grill」或「匝道：wayfinder，并入 to-spec」；独立区和不在公路上显示路牌，不高亮主干。公路图下方的下一站行形如 `→ /to-spec · Continue（理由）· CEO`；`phaseDone` 为 false 时显示「本阶段未完成 · 继续」。旧宿主不返回 `location` 时仍退化为旧的 **当前位置** 一句话加芯片。

下一步咨询不再读取 `a2d2-orchestrator`，也不再回落读取旧名 `ceo-team`。咨询信封只携带当前会话材料、宿主检查出的项目事实、上下文事实、公路图目录、阶段 Agent 表、本会话的 Agent（如已知），以及逐字注入的 `ask-matt` 真源；候选意图仍由模型基于这些材料生成，和普通芯片一样处理。因此装着或没装这些编排 skill，都不会改变咨询信封，也不会额外增加「编排实施全部工单」芯片。

宿主在询问模型前，还会检查会话 cwd 所属项目的首次使用前置条件：必须存在 `CONTEXT.md` 或 `CONTEXT-MAP.md`，并且必须存在 `docs/agents/issue-tracker.md`。响应带 `preconditions.missing`，prompt 信封也写入同一份宿主事实，避免让模型猜配置状态。只要有缺失，卡片顶部显示「首次使用前：/setup-matt-pocock-skills」路牌，并列出缺失项。宿主还会在解析模型输出之后把 `/setup-matt-pocock-skills` 强制置为首颗芯片；模型已经给出时就移动到首位，否则补上一颗，芯片总数仍最多四颗。模型给出的芯片若 input 精确等于 `/setup-matt-pocock-skills`，是唯一不受跨 Agent continue 规则约束的 `continue` 候选，与宿主插入的 setup 芯片保持一致。已配置项目、以及没有 `preconditions` 字段的旧宿主，都不显示该路牌。

咨询不再沿用当前会话 route，而是按阶段 Agent settings 的 `consult` 候选顺序尝试；提供方错误、限流、拒答或空输出会换下一个候选。非空但畸形的 JSON 不重试，因为这是协议失败，不是 route 可用性问题；这也包括 `phaseDone: true` 时试图 `continue` 到目标 Agent 不等于本会话 Agent 的阶段，或在本会话没有记录 Agent 时试图跨阶段 `continue`，但上面所述精确 setup 芯片例外。响应会带回 `answeredBy`、`fallbacks`、`stageAgents: { stages, agents }`，以及已知时的 `sessionAgent`；卡底显示「由 X 生成」，发生回落时注明原因。浏览器从 `stageAgents` 推导每个公路图标签：阶段 -> Agent -> 该 Agent 在本会话模型目录里的首个候选，显示为「工程师 · gpt-5.5」或「工程师 · 无可用模型」。芯片也按这张表准备（ADR 0007）。芯片永不代发送，也从不切本会话的模型；它只按走法做准备，并把副作用预先写在芯片上：

- **continue**：填本会话输入框并聚焦。不写副作用，因为它只在下一阶段的 Agent 与本会话的 Agent 相同时出现。
- **subagent**：本会话不动，填框，指令末尾写明子代理的 Agent；芯片写作「子代理 · 评审」这样的文案。
- **clear**：在同一工作区新建会话，经 `/a2d2/api/session-agent` 登记为下一阶段的 Agent，由宿主选中该 Agent 第一个在目录中的候选及其强度，只设置这条会话而不写全局默认，打开它，再填它的输入框。芯片写作「新会话 · 工程师（gpt-5.5）」（本会话模型目录尚未读到时写「新会话 · 工程师」）。该 Agent 的候选全不在目录里时，芯片写「工程师无可用模型」，点击只填本会话输入框并提示原因。新建会话失败同样退化为只填本会话；新会话上登记或选模型失败会提示原因，但不阻断填框。
- **compact / handoff**：打开交接卡；下面的一键交接序列在 take 之前把后继会话登记为下一阶段的 Agent 并选好它的模型。

独立区任意 skill 的 Agent 都是 CEO，芯片与下一阶段行一致。不返回 `stageAgents` 的旧宿主没有 Agent 可言：clear 只新建会话、保持默认模型（「新会话 · 默认模型」），不登记。

边界卡底部有一行始终可用的 **其他走法** 折叠入口，列出 continue 之外的通用走法：clear、subagent、compact、handoff。clear 走与 clear 芯片相同的建空会话序列，但没有阶段目标，因此不登记 Agent、保持新会话默认模型；subagent 准备一段可编辑的输入框文本；compact 与 handoff 打开交接卡。这样想手动交接时仍能从卡片里找到入口，但球上不会再把交接放回 **下一步** 的平级位置。

边界卡会明确显示加载中和路由错误。宿主未读到 `ask-matt` skill 时仍返回降级候选，卡片同时标注 **未读到 ask-matt skill**；生成失败时直接展示路由返回的错误消息并允许重试。每次咨询都会替换上一轮候选状态，不累计芯片或其他副作用。

### 一键交接

交接卡由 handoff / compact 芯片或 **其他走法** 打开，是一张插件自绘的确认卡（DSH 没有命令模态原语）：一个 focus 输入框加 **创建并交接** / **取消**。确认后一次手势完成整个交接，不再是"填进草稿等你再点发送"：

1. 浏览器在它所在的会话上、通过该会话自己的命令面运行 `/handoff <focus>`，正是这一步让 host 写入骨架、并排入写接续内容的那一轮；
2. 浏览器等待那一轮，通过会话传输读取会话自身的 `running` 状态——不用定时器，也不用另一个插件渲染出的 DOM，这两者都会在错误的时刻把会话报告为已完成；
3. 浏览器找到该会话的 workspace，`connectWorkspace` 出一个全新的后继会话；
4. 当 handoff 或 compact 芯片带入下一阶段目标时，浏览器通过 `stageAgents` 解析该阶段的 Agent（独立区 skill 为 CEO），经 `/a2d2/api/session-agent` 登记后继会话并由宿主设置候选模型与强度，不写全局默认——全部在 take 之前；登记或选模型失败会提示原因，交接继续；
5. 浏览器切焦点到后继会话；
6. 后继会话继承交接出去的会话的标题，并按 fork 给同级会话编号的同一风格递增（`Ship the store` → `Ship the store (1)`），使一条交接链读起来是同一件有名字的工作，而不是若干个同名会话。源会话没有标题、或重命名被拒绝时，后继保留它的自动标题——一次只丢标题的失败绝不打断一个接续内容已经落地的交接；
7. 后继会话跑 `/handoff take <session-id>`，这正是让 host 把接续内容注入为它首条 prompt 的动作。

如果等待结束时那一轮还没跑、或仍在运行，序列就停下并指出失败的是哪一步；反正 take 也会拒绝一份未写出的摘要，所以半途而废的交接不可能看起来像已完成。指示球通过客户端已经组合的服务——会话面与 workspaces 服务——自己驱动交接；它唯一用到的 host 路由是上面的 Agent 登记，仅在交接带有下一阶段目标时调用。会话不属于任何 workspace 时就没有后继可建；两者中任一服务缺失时，指示球退化为旧行为：把字面 `/handoff ` 追加进草稿并聚焦输入框，发送留给用户。**已有的草稿会被保留**而不是被替换。

圆球的位置与配色用的是字面量而不是主题变量：本 bundle 的样式先于主题 token 生效，它看不到的变量会解析为空，导致文字在背景上不可读。

占用率来自输入框旁 ContextMeter 读的同一个 `contextPressure` 投影，并优先用 `projectedTokens`，这样压缩后立刻反映。阈值、路由容量与解析出的价格一起通过 `a2d2Indicator` 会话投影到达浏览器——浏览器 bundle 读不到本插件的配置、也看不到会话路由到哪个模型，而编译进 bundle 的数字无法按部署配置。价格由宿主侧折叠会话的 `request/header` 解析：客户端没有 model 身份可查。profile 没有组合投影注册表、或价格表里没有匹配该路由的条目时，该 key 或价格缺席，悬浮球只显示 token 而不显示一个猜出来的数字。在 provider 同时报出分子与路由容量之前，悬浮球什么都不渲染，因此新会话在第一次请求前不会出现圆球。

## A²D² 面板

同一份浏览器 bundle 还向 better-sidebar 注册一个侧边栏 Tab，id 为 `a2d2-panel`，标题为 **A²D²**。better-sidebar 是可选 peer，通过 `ctx.get('betterSidebar')` 软读、不进入 `inject`：部署里没有它时，本 bundle 只注册指示球，这个 Tab 被跳过而不是让整个 bundle 失败。

上半部分读取 `/a2d2/api/tasks?session=<id>`，展示当前会话 cwd 所属项目里的任务。浏览器从不发送路径；宿主查出该会话，按插件正常存储规则把它的 cwd 解析成项目根，再返回 `{ root, tasks }`。这条路由只读、只允许 GET，并使用与咨询、配置路由相同的 DSH 浏览器认证；所有失败都是 JSON 响应体（`400` 会话 id 不可用、`401` 未登录、`403` 不受信、`404` 宿主无此会话、`405` 非 GET、`409` 会话无工作目录、`500` 读失败）。

任务卡按任务树排列：绑定了 issue 且 `parent` 指向另一个已返回任务 issue 的任务，会显示在父任务下面；父任务缺失、形成环、或未绑定 issue 的旧任务都作为根显示。每张任务卡展示状态、目标、成员会话与传入交接边。绑定了任务 issue 的任务还多一行：issue 编号、类型——没有父任务时是主任务，有父任务时是子任务（附父任务编号）——以及主会话，点开方式与成员相同；`issue.handoff` 存在时，同一行会带一个 **交接中** 标记。未绑定 issue 的任务没有这一行。成员会按 `handoffFrom` 形成树。缺失父节点、指向非成员的父节点、以及会闭合成环的边都会让该成员成为根，而不是把会话隐藏掉。包含当前会话的任务会被标为当前。成员标题与能否点击来自 shell 已有的会话列表：列表里有的成员可通过 `sessions.open` 打开；列表里没有的只显示短 id，不可点击。成功读到空列表时显示这个项目没有任务；路由或读取失败则显示失败行。

下半部分展示以主会话为根的子代理模型拓扑：从当前打开会话沿 durable 父链回到主会话，再递归展开已知的子代理目录。因此打开一个子代理时，仍能看到它的同级、后代与主会话。存在的原因是子代理的路由本来不可见。会话自己的模型是用户选的；被派出去的子代理用的是创建它时生效的那份组合所声明的模型，而 shell 里没有任何原生位置显示它——于是被钉在另一个模型上的子代理会安静地花掉那个模型的额度。

每一行的两半都是 host 折叠出来的、浏览器只读的值：子代理清单来自会话列表的子代理目录，每条路由来自该会话自己的 `a2d2Indicator` 投影。为此 `route` 现在随投影一起发布——它过去只在宿主侧用于查价。客户端拿不到适配器注册表，而子代理的 `request/header` 在子会话自己的日志里、永远不在父会话的日志里，所以父会话的投影折不出任何子代理的路由；这是本功能唯一的宿主侧改动。

面板可见时每 5 秒重读任务路由与已展开的子代理目录，不可见时不轮询；投影更新自己会到。与自己父会话路由不同的行标琥珀并加 `⚠`，表头给出 `N 个子代理 · M 运行中 · K 个与主会话不一致`，计数范围是整棵已加载的树。尚未发起请求的子代理显示「路由未知（尚未发起请求）」，而不是拿一个猜出来的值充数。

## Model Experience

### 任务聚合

#### What the model sees

普通会话除下面的 `bind_main_session` 工具外什么都没有。任务、成员关系与交接边本身不会进入任何提示词或提供方请求。组合了 CEO 提示段行的主会话不同：见 `a2d2:ceo`。

#### Token effect

无。聚合只写文件并读回，不给任何请求增加 token。

#### KV Cache effect

无。请求内容不变，因此不会使任何缓存条目失效。

### `a2d2:ceo`

#### What the model sees

只有任务 issue 的主会话会收到作用域内的 `a2d2:ceo` 系统提示段。主会话 Agent 创建或恢复时会安装；运行中的会话通过 `bind_main_session` 绑定为主会话时也会安装。`/handoff take` 把后继会话提升为主会话时，后继的 live Agent 会立即得到这一段，源会话 Agent 上的这一段会被移除。段内容由随包发布的 `ceo/AGENTS.md`、`ceo/WAKE.md`、全局 SOUL（`~/.dsh/a2d2/SOUL.md`）和项目 SOUL（`<projectRoot>/.dsh/a2d2/SOUL.md`）组装。项目 SOUL 放在最后，并标明优先于全局 SOUL。缺失的 SOUL 文件会在段内点名，而不是静默跳过。

#### Token effect

主会话 CEO 的每次请求都会携带渲染后的这一段。`ceo/AGENTS.md`、`ceo/WAKE.md` 与两份 SOUL 都在每次组装时现读，所以修改 SOUL 文件会改变下一次请求的 token。普通会话没有这一段。

#### KV Cache effect

这一段会改变主会话的系统提示词前缀。SOUL 是动态内容，因此任一 SOUL 文件变更都会让主会话下一次请求使用新的前缀；文件稳定后仍可正常缓存。普通会话保持原前缀。

### `bind_main_session`

#### What the model sees

组合了工具行的 profile 中，agent 的每次请求都多一份工具定义——名称、三句话的描述，以及 `issue`、`parent_issue`、`title` 三个参数。一次调用的结果是一行文字，写明任务 issue、父任务（如有）与任务文档路径；绑定被拒时，拒绝原因作为工具错误返回。

#### Token effect

定义约 685 字符的 JSON，按每 4 字符一个 token 估算约 170 token，出现在每次请求里。每次调用把参数与那一行结果加进会话历史。

#### KV Cache effect

工具列表属于请求前缀，因此组合工具行会让前缀变化一次。定义不含任何按会话或按轮变化的内容，之后的请求照常命中缓存。

### `open_subtask`

#### What the model sees

组合了开子任务工具行的 profile 中，同时拥有 `tools`、`a2d2`、`agents`、`llm` 的 agent 会多一份名为 `open_subtask` 的工具定义。调用成功时，结果返回新根会话 id、任务 issue、父 issue 与实际选择的 `provider/model`。被创建的子任务会话会收到一条普通首条 prompt，只包含子任务 issue 编号引用、父任务 issue 编号引用、在本项目目录运行的逐条 `gh issue view <编号> --comments` 读取命令与 `/grill-with-docs` 主会话指令。

#### Token effect

该工具定义在对应挂载行存在时进入调用方的请求前缀。成功调用会把参数和结果加入调用方历史；新建的子任务会话则以那条很短的首条 prompt 开始。

#### KV Cache effect

组合开子任务工具行会让调用方的工具列表前缀变化一次。新的根会话有自己的对话历史，因此也有自己的缓存路径。

### `complete_task`

#### What the model sees

组合了完成任务工具行的 profile 中，同时拥有 `tools`、`a2d2`、`agents` 的 agent 会多一份名为 `complete_task` 的工具定义。调用成功时，结果返回任务文档 id、任务 issue 编号、`done` 状态、是否通知了父任务，以及在适用时返回父 issue、父主会话和是否恢复过父主会话。若存在父主会话，该会话会收到一条普通通知，只包含子任务 issue 编号与完成说明。

#### Token effect

该工具定义在对应挂载行存在时进入调用方的请求前缀。成功调用会把参数和紧凑结果加入调用方历史；被通知的父主会话会把那条短通知作为普通对话历史接收。

#### KV Cache effect

组合完成任务工具行会让调用方的工具列表前缀变化一次。通知会改变父主会话后续请求的对话历史；任务文档写入本身不会改变任何请求前缀。

### `dispatch_subagent`

#### What the model sees

组合了基础工具行的 profile 中，agent 的每次请求都会再多一份工具定义。一次调用的结果写明子代理会话 id、实际 `provider/model` 与阶段 Agent（`ceo`、`engineer` 或 `reviewer`）。非主会话调用、该阶段 Agent 没有目录内可用模型等拒绝，都会作为工具错误返回。子会话会在 DSH 创建前被记录为该阶段 Agent；工程师/评审配置通过作用域系统提示词装配进入子会话，而不是通过 `persona` 请求字段。

#### Token effect

定义约 820 字符的 JSON，按每 4 字符一个 token 估算约 205 token，出现在组合了基础工具行的每次请求里。每次调用把参数与紧凑结果加入父会话历史；子代理会把传入的 `prompt` 作为首条用户消息接收。

#### KV Cache effect

新增工具会让组合基础工具行的 profile 的工具列表前缀变化一次。阶段 Agent settings 在工具运行时读取，不嵌进父会话请求前缀，因此它们变化本身不会让父会话缓存失效。工程师/评审 Agent 配置由子会话的作用域系统提示词段在每次组装时读取，因此文件变化影响的是该 Agent 下一次请求前缀，而不是父会话。

### `github_watch`

#### What the model sees

组合了 GitHub 关注行的 profile 中，agent 的每次请求多一个工具定义。调用结果是一句话：当前状态和"之后会收到消息"，或者安装链接，或者 PR 已经结束。之后被关注的 PR 每有一次变化，就往该会话加一条 user 角色 notice：几行文字，说明发生了什么变化、PR 链接、当前状态、关注是否继续。不关注任何 PR 的会话不受影响。

#### Token effect

工具定义约 590 个字符的 JSON，按每 4 个字符 1 个 token 估算约 150 token，出现在组合了该行的 profile 的每次请求里。每条 notice 约 300–450 个字符（≈ 75–110 token），只在状态真正变化时出现一次。重复和无变化的投递先被服务丢弃，插件比较时再过滤一次。

#### KV Cache effect

加入这个工具会让组合该行的 profile 的工具列表前缀变化一次。notice 和普通 user 消息一样追加在对话末尾，不会使已缓存的前缀失效。

### `/handoff`

#### What the model sees

命令结果本身从不进入模型——命令结果只渲染给派发它的界面。有两条由宿主提交的消息会进入：准备时把 handoff skill 真源原文加参数信封作为交接出去的会话的一条普通 prompt 排入，take 时把交接文档的正文作为后继的首条 prompt 排入，两者都走 `agent.followup`。信封写明文档路径与内容标记；后继收到的消息携带接续内容，其外围是那些固定小节。

#### Token effect

后继会话的首次请求携带交接文档的正文——接续内容加上固定小节——该会话之后每一轮也都携带它，作为普通对话历史。它的大小就是撰写方 agent 写出的内容，上限来自信封给出的约 4000 字符参数，而不是插件的强制预算。准备还会给交接出去的会话自己的历史增加一轮，因此该会话之后的每一次请求也会携带注入的 skill 真源与信封。

#### KV Cache effect

后继的提示词前缀是新的，因此其首次请求是填充缓存而不是命中缓存。源会话的缓存不受影响。

### A²D² 面板

#### What the model sees

什么都没有。面板是纯读取的浏览器视图：它不注册工具、不写提示词段落、不注入上下文。发布路由改变的是客户端收到的投影值，不是任何请求的内容。

#### Token effect

无。面板读取任务文档宿主路由、已在传输中的投影值与目录响应，不给任何提供方请求增加 token。

#### KV Cache effect

无。没有任何会话的请求内容发生变化。

### 通知

#### What the model sees

什么都没有。通知在宿主侧观察会话事件与 `complete_task`；它不注册工具、不写提示词段落、不注入上下文。

#### Token effect

无。推送只发给 `notifier` 提供者，不发给任何模型提供方。

#### KV Cache effect

无。没有任何会话的请求内容发生变化。

## Known Limitations and Deferred Work

- **悬浮球无法定位光标** —— 它聚焦输入框并追加命令，但外部插件没有受认可的光标 API，因此插入后的光标位置由 textarea 自身决定。
- **接续内容的好坏取决于写它的那一轮** —— 插件能核实确实写出了东西，永远无法核实它准确、完整、或没有模式漏掉的秘密。从不跑那一轮的会话，留下的是 `take` 会拒绝的文档。
- **文档版本是 2** —— 更早的构建写出的文档声明版本 `1`，携带的是对话投影而不是摘要，会被拒绝而不是被读取。既有项目必须重跑一次 `/handoff`，它的交接才能被 take。
- **最近使用是近似值** —— `resolve` 返回最新的 `active` 任务，因为文档自身不携带活动时间戳。从成员会话推导最近使用是预期的改进方向。
- **成员从不校验** —— 存储只记录会话 id，从不检查会话是否存在，因为文档是可提交、可跨机器的。消费方必须把"会话缺失的成员"渲染出来，而不是因此失败。
- **普通交接仍无法从任务反查** —— 任务 issue 能显示主会话正在交接中，但 `take` 仍需要被交接会话的 id，这个 id 由源侧打印；没有接口列出某任务的所有非主会话交接，也没有接口报告某份交接文档尚未写出。
- **仅限本机文件系统** —— 项目根发现与文档读写直接使用 Node 文件系统调用而非 `ctx.fs`，因此工作区位于某个 provider 之后的部署尚未覆盖。
- **项目根解析存在重复** —— `resolveProjectRoot` 重复了 `agent-instructions` 已导出的 `findProjectRoot` 所做的事；导入它会把该包的 agent、工具与 LLM 依赖拖进一个并不需要它们的存储。把这段上溯逻辑合并进共享工具是预期的后续工作。
- **子代理列表依赖 better-sidebar** —— 那个 Tab 只能注册进一个接受它的侧边栏；部署里没有 better-sidebar 时本功能整个缺席，而悬浮球不受影响。把同一份读数再挂到 DSH 原生座位上是预期的后续工作。
- **子代理后代是懒加载的** —— 目录按父会话发布，因此新发现的分支会在面板可见且该父目录刷新后出现。
- **路由取自子会话自己的最新 `request/header`** —— 子代理发起首次请求前该行显示未知；列表也永远无法报告一个子代理"此刻"在跑什么，只能报告它最近一次请求用了什么路由。
- **目录是请求/响应，不是流** —— 新派出的子代理最多 5 秒后才出现在表内，而 Tab 不可见时不刷新。

## 宿主后台任务运行器（一期）

新增 `@a2d2/dsh-a2d2/task-runtime` mount（id `a2d2-task-runtime`），默认 `enabled: false`。仅在独立开发 profile 启用 `enabled: true`；`homeDir` 默认是 `$DSH_HOME/a2d2/task-runtime`（未设置 DSH_HOME 时使用 `~/.dsh`）。开发与生产的 DSH home、会话、存储和项目 `.dsh/a2d2` 必须隔离。

已绑定 issue 且属于 workspace 的主会话可运行：

```text
/task-runtime start [issue-number] [title]
/task-runtime status
/task-runtime rotate [交接重点]
/task-runtime stop
/task-runtime resume
/task-runtime recover
```

`run` 是 `start` 的别名；重复 start 不重复启动。普通 bind 不启动运行器。managed `/handoff` 明确拒绝且不调度交接，提示改用 `/task-runtime rotate`；既有 orb 会在 prepare 失败处停止，不创建额外后继。未启用运行器的手动交接保持原行为，手动 take 不能绕开执行权。后台与浏览器连接无关，在重启时只恢复 homeDir 中已显式登记的任务。

`running` 默认继续 active 任务；`waiting-human` 等 LF 回复或 resume（期间外部事件保留），`waiting-event` 等任务事件，`paused` 暂停，`blocked` 表示有限重试或无进展检查失败，`done` 完成。`task_runtime` 模型工具可以报告 continue、wait-human、wait-event、rotate；实际提问、未结算原生子代理、活动子任务和 GitHub watch 也会阻止空推。`complete_task` 仅更新插件任务状态，不关闭 GitHub issue。

配置：`pollMs`（默认 2000）、`rotateTokens`（150000）、`maxAutoTurns`（8，每代健康自动轮数，达到后交接）、`maxFailures`（3，操作失败及连续无进展阈值）。状态输出包含当前主会话、代数、workspace、操作步骤、待处理事件和最后错误。排查失败后使用 resume；未完成的交接沿原 operation 和后继 ID 恢复。

恢复时会区分消息已排队与已被模型消费，并通过公开 Agent API 唤醒持久队列，不要求 LF 追加消息。事件先写入 homeDir 下独立 inbox，再并入运行记录；慢交接不占用入箱锁。GitHub 注册返回已结束或失败时，运行器不会把它当作仍需等待的 watch。

每次交接先保存后继 ID，通过公开宿主 API 创建/恢复、继承 workspace、设置 CEO 会话本地模型、接任和投递接续内容。旧会话在 `agent/pre-step` 被拒绝执行。交接期间 GitHub 和子任务事件保存在任务收件箱，接任后投递。消息 ID 先落盘，重试回读会话日志与 inbox 去重；这不是跨存储的绝对一次事务。进展指纹是工具结果/回答的启发式比较，不能代替验收。文件锁限同机器同 PID 命名空间；断电持久性和跨主机共享不在本期承诺内。详见 ADR 0011。

运行器后继与 `open_subtask` 使用公开 `sessionController.create` 首次创建根会话，已有预留 ID 通过 `resolveAgent` 恢复并显式确认 workspace 成员关系，继承源会话当前 Agent preset，由宿主在发布会话前装配文件、shell 等工具及提示词。交接在创建前持久化选定 preset 与权限配置，重试保持相同身份；CEO 模型仍使用会话本地选择。继承命名权限 preset 及实际 sandbox/approval 配置（包括 custom），不继承单次审批结果，不写宿主全局默认。

升级恢复旧后继时，create、take、deliver 都验证 preset。尚未开始运行的旧会话通过公开 preset 选择 API 补齐，保留原 ID；已有内容且 preset 不兼容时不覆盖，会在 status 中给出 `recoveryRequired` 和 `/task-runtime recover` 指令。在当前主会话空闲时执行该命令，会保留旧会话，先登记新的替代后继 ID，再携带原模型交接内容及旧会话历史指针接续；模型须检查旧会话的新进展后再执行。普通 resume 不会强改非空会话的 preset。
