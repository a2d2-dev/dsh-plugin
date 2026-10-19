# #121 真实隔离 DSH Web 验收工具

## 背景

本工具用于规格 #121 的真实宿主验收；本阶段交付启动、模型禁用正控和宿主页面基线。最终整合插件 tgz 尚未提供，因此本阶段**不构成 #121 产品浏览器验收通过**。工具不修改宿主、业务源码、依赖或已确认规格，不接管 18780/18781。

## 目标

- 真实 CLI、独立 profile/home/workspace/browser，记录实际宿主 commit、CLI 版本、插件 SHA、URL 和 managed job ID。
- 模型目录仅注册 `acceptance-disabled/no-model`；公共 `llm/stream` 与 `adapter.stream` 双计数，后者必定 throw。
- 正控确认宿主转换后的 `finish/error`；随后新进程验收零调用。计数追加持久化，重启不能清零。
- 真实 Session 的 ID 集合和 cwd／模型投影及默认路由／sandbox 与 approval 配置冻结后不变。

### 非目标

本阶段不创建或更新产品 Task，不调用真实模型，不使用产品 mock、网络 fallback、Vite 外壳，不写 GitHub、不合并 PR。最终产品操作等待 CEO 提供最终 tgz。

## 架构

### 概要设计

[启动及检查 CLI](../../scripts/a2d2-v3-121/acceptance.mjs) → 真实 `dsh web` → [独立 guard 插件](../../scripts/a2d2-v3-121/guard.mjs) → 公开 LLM／Workspace／Session controller。真实浏览器使用 agent-browser，截图后才冻结基线。

### 架构设计

`prepare` 要求现有宿主绝对路径及 tgz，或显式 `--host-only`。临时资源必须位于 `/tmp/a2d2-v3-121/<run>`，root 必须为规范绝对路径（拒绝 `.`、`..`、重复分隔符和尾部分隔符）。任何 mkdir 前先向上查找最近现存父目录，用 lstat 拒绝非目录/悬空 symlink，并要求 realpath 与原路径完全相等，因而也拒绝命名空间内外的 symlink 别名；确认后才创建缺失目录，再核对 root 的规范路径。新环境独占 manifest，重复 prepare 拒绝。子进程只继承 PATH，并设置独立 DSH_HOME、XDG_CONFIG_HOME、XDG_STATE_HOME 和遥测禁用标志，不覆盖 HOME，不继承模型凭据。

`run` 首次在没有 `current-run.json` 时使用 `--port 0`，将真实 ready 的 `http://127.0.0.1:<port>` origin 保存为该 root 的站点身份。后续启动自动读取并验证记录，复用同一端口，无需手工端口参数。记录必须为规范 HTTP / 字面地址 `127.0.0.1` / 有效显式非保护端口，不含路径、凭据、query 或 fragment；保护端口 18780/18781、其他 host/protocol、损坏记录均在创建日志和启动 Web 子进程前拒绝。复用前以短暂 loopback 监听检查占用，`EADDRINUSE` 明确失败，不杀端口占用者、不尝试其他端口。CLI 实际 ready origin 还须与记录一致；若子进程绕开请求端口，工具停止本次自有子进程并失败，保存 private 日志与 exit，不替换原站点及私有登录记录。

LLM 模块通过宿主 base bundle 依赖闭包解析；controller/client-modules 通过 web-app bundle 解析。guard 拷贝到临时独立包，避免宿主把仓库中的 guard 误认为产品客户端包。overlay 全量替换相关 config；host-only 不写不存在的 A²D² 行；产品环境禁用既有 `a2d2-task-runtime`。插件的 v3 工作数据默认位于独立 DSH_HOME。

guard 只提供合法模型目录元数据，`adapter.stream` 计数后抛出固定错误；公共 waterfall 计数并拒绝任何非 guard provider。每次 IPC 命令还核查实际 provider 目录只有 guard。只记录事件种类、时间、进程和 Session ID，不保存模型消息正文。

公开 Session／Workspace controller 通过仅存在于临时文件系统的 IPC 调用；不新增产品路由，不直接写任何 Task store。`seed` 创建真实 Workspace，并将公开返回的 `created.workspace.workspaceId` 传给 `sessionController.create`，返回同一 workspaceId 与无 prompt 的真实 Session；不应在冻结基线后调用。首次空环境 restoreSelection 创建默认会话属真实宿主启动行为，必须在页面稳定后再定基线。

### 组件模块

| 组件 | 职责 | 状态归属 |
| --- | --- | --- |
| prepare | 核验宿主、安装指定 tgz、生成 overlay 与独立 guard 包 | manifest、隔离 profile |
| run | 前台监管真实 CLI 子进程，首次记录实际 origin、重启复用端口，转发停止信号，记录 ready 与退出 | private 日志、current-run 与各轮 evidence |
| guard | 唯一禁用模型目录、双计数、会话出生、公开 controller 驱动 | append-only metrics 与 IPC |
| baseline/check | 比较完整 Session 身份和配置，拒绝模型调用 | 截图 SHA、baseline、阶段 snapshot |
| agent-browser | 独立浏览器真实页面、交互与截图 | 独立 profile，PNG 正式证据 |

### 数据流程

1. 受控正向轮通过真实 `llm.stream({provider:'acceptance-disabled', model:'no-model', messages:[]})` 进入 waterfall 与 adapter。
2. adapter 抛错；宿主归一为唯一 `finish/error`。正控必须核对双计数恰好为 1、错误标记匹配、无生成文本。
3. 正控进程停止后，另启新环境／进程；metrics 不复用正控文件，不删除或清零旧文件。
4. 浏览器登录真实实例，完成预览告知、稳定原生界面；必要时 seed 真实会话。
5. baseline 保存公开查询的 ID 集合与配置，并记录真实浏览器 PNG 的 SHA；每个后续阶段调用 check。
6. 同进程出现额外出生即拒绝；重启后仅允许基线中已有 ID 重新装载，任何未知出生（包括后来删除的会话）仍拒绝。新旧进程的模型指标累计必须始终为 0。cold Session 缺少有效 live 配置时显式失败，需通过原生导航装载再比较。

## 场景

### 接入与正控

工作目录为本票 worktree。示例路径须替换为独立新目录。使用 harness `bash(run_in_background:true)` 启动 `run`，不能裸 `&` 或 nohup。

```sh
node scripts/a2d2-v3-121/acceptance.mjs prepare \
  --host /data/src/github.com/deepseek-ai/deepseek-harness-dev \
  --root /tmp/a2d2-v3-121/positive-example --host-only
node scripts/a2d2-v3-121/acceptance.mjs run --root /tmp/a2d2-v3-121/positive-example
# 上一命令必须通过 managed background job；拿到 job ID 后登记：
node scripts/a2d2-v3-121/acceptance.mjs job --root /tmp/a2d2-v3-121/positive-example --job <managed-job-id>
A2D2_ACCEPTANCE_POSITIVE_ROOT=/tmp/a2d2-v3-121/positive-example \
  node --test tests/a2d2-v3-121-acceptance.test.mjs
```

完成判据：真实 Web ready、双计数 1/1、唯一 `finish/error` 携带 `A2D2_ACCEPTANCE_MODEL_DISABLED`。退出正控 job 并收集 exit 记录后进入新进程。

### 最终插件与真实页面基线

```sh
node scripts/a2d2-v3-121/acceptance.mjs prepare \
  --host /data/src/github.com/deepseek-ai/deepseek-harness-dev \
  --root /tmp/a2d2-v3-121/product-example --plugin /absolute/final-plugin.tgz
node scripts/a2d2-v3-121/acceptance.mjs run --root /tmp/a2d2-v3-121/product-example
node scripts/a2d2-v3-121/acceptance.mjs job --root /tmp/a2d2-v3-121/product-example --job <managed-job-id>
```

`prepare --plugin` 使用真实官方 `plugin --profile web add`，记录实际 tgz SHA；本阶段该分支尚未实际安装最终产品包，标为**待验证**。`run` 的启动 URL 经私有日志捕获，公开输出只有无凭据 baseURL。登录 URL 只保存在临时 `login-url.private`（0600），不能复制进报告、截图或 Git。使用 Node `spawnSync` 从该文件读 URL，传给 agent-browser 参数；不要把实际 token 打印在命令或输出中。

浏览器必须显式 `--session a2d2-v3-121 --profile /tmp/a2d2-v3-121/product-example/browser-profile --executable-path /usr/local/bin/chromium`，不使用 auto-connect/CDP。只有首次打开传 profile；后续操作使用同 session。完成预览告知后重新 snapshot，确认原生输入框与模型选择可见。

```sh
# 可选：在冻结前通过公开controller建立额外真实已有会话，不发送prompt
node scripts/a2d2-v3-121/acceptance.mjs seed --root /tmp/a2d2-v3-121/product-example
agent-browser --session a2d2-v3-121 snapshot -i
agent-browser --session a2d2-v3-121 screenshot /tmp/a2d2-v3-121/product-example/evidence/ready.png
node scripts/a2d2-v3-121/acceptance.mjs baseline \
  --root /tmp/a2d2-v3-121/product-example \
  --page-evidence /tmp/a2d2-v3-121/product-example/evidence/ready.png
node scripts/a2d2-v3-121/acceptance.mjs check --root /tmp/a2d2-v3-121/product-example
```

PNG 存在只能作为冻结前置条件；验收者仍须实际查看截图与 snapshot，不能把任意 PNG 或预览告知屏当成产品页面通过。

后续正式清单：无 Project 入口 → 两个本地 Project 及同名 Task → 完整目标／规格／验收保存更新 → 四标签与拆解／子 Task → 当前 Project 过滤 → 已有 Session 幂等关联 → 真实导航 → 原生轻量入口返回正确详情 → 列表保留筛选 → 关闭返回原会话 → 刷新／重启后公开查询一致。各阶段截图并执行 check；产品命令 HTTP 证据由最终后端能力补充。

### 失败、重启与清理

真实宿主缺少 bundle／guard 加载失败／命令超时／缺少公开配置投影／页面未 ready 时显式失败，不能报告零调用通过。失败原因只在私有原始日志中诊断，正式证据采用脱敏结果。

重启前先停止本 root 自有的 managed job 并收集 exit，再次对同一个已准备 root 运行 `run` 并登记新的 managed job ID。工具从保存的 `current-run.json.baseURL` 自动复用真实端口，浏览器继续使用同一个 browser-profile，在相同 origin 交换新进程 token 后检查原 selection、持久身份及配置。不能再次 prepare、删除 current-run、替换 browser-profile，或清空 metrics/baseline 来把新站点首用当成重启。各轮 run/exit 独立留证，模型指标继续跨进程追加。

若端口被占用，工具退出 1 并明确报告占用错误；原 current-run、private 登录文件、profile 与指标保持不变。调用者应核对自有旧 job 是否已退出，不得杀其他进程或改端口绕过失败。若记录非法或损坏也直接拒绝，不能退回端口 0。若需加载新的 tgz，另建全新验收环境并保留旧失败环境；新环境的通过不追认旧基线。

清理只停止本任务 managed jobs 与 `agent-browser --session a2d2-v3-121 close`。保留临时隔离数据以便复核，不删除宿主或既有 profile，不操作 18780/18781。正式证据只白名单复制 manifest、run／exit、positive、metrics、baseline／check、截图及脱敏测试结果；不复制 private 登录 URL、原始日志或 browser profile。

## 一轮评审后的 R2 隔离整改

原 checkedRoot 先递归 mkdir 后检查 realpath。真实回归由测试自行创建 `/tmp` 外部临时 fixture 及 ticket namespace 下的临时 fixture，把 namespace/link 指向外部，再调用公开 prepare；拒绝后要求外部目录为空。所有 fixture 在 cleanup 前核对保存的精确绝对路径、父目录、名称前缀及 realpath，仅清理本测试创建的根，不删除 namespace 或现有实例。

- 红测：`XDG_STATE_HOME=/tmp/a2d2-v3-gh-state node --test --test-name-pattern='symlink escape' tests/a2d2-v3-121-acceptance.test.mjs`，退出 1；实际外部目录新增 `new-root`，与期望空数组不符。
- 修复后同命令退出 0，1/1 通过；没有外部新增目录或文件。
- 工具测试命令 `XDG_STATE_HOME=/tmp/a2d2-v3-gh-state node --test tests/a2d2-v3-121-acceptance.test.mjs`：6 项通过、2 项 real-host 显式 skip，退出 0。新增覆盖规范路径语法、内部及悬空 symlink 的拒绝，及全新规范 root 的完整 prepare。后者使用测试自建的最小宿主布局/CLI fixture，不冒称真实 DSH 宿主安装或产品验收。

## 真实验收新发现 R4：seed 资源引用整改

第一轮工具误读 `created.workspace.id`；公开 WorkspaceController 返回的是 `workspace.workspaceId`。传入 undefined 会使 SessionController 选择默认 cwd，旧 seed 不能证明所选资源与 Session cwd 匹配。原 host-only / 第一轮记录如实保留，不能将它们追记成修正后 seed 的通过证据。

独立浏览器 lane 随后向 CEO 报告：旧包同 root 重启后领域 2 Project / 2 Agent / 3 Task 与 runtimeId 一致，但错误 seed 未把 Session attach 到目标 workspace；动态端口前端首次 restore 又创建 Session，集合 2→3，旧 Session cold 导致 guard 缺投影拒绝。该失败作为旧验收 fixture 污染保留；本执行者未操作或复验其实例。修复后的默认 controller 契约已检查真实 workspace membership；fresh root 的 Web 重启集合不增仍交指定 lane 验证。

新增默认运行的契约测试通过真实 guard IPC → 公开 WorkspaceController/SessionController → 真实 WorkspaceRegistry、AgentLoop、SessionStore 与 JSONL 持久化建立无 prompt 会话；只控制无关 RPC plumbing 和此用例未用的 capability。观察真实 create 请求、seed 返回引用、公开 inspect 的 cwd、live Session header cwd、workspace membership，并要求 gateway/adapter 指标均无调用。它不启动 Web 服务，不接管既有验收实例。

- fixture 首次缺少真实 AgentLoop factory，测试退出 1；补齐装配后才进入行为红测，不将该装配错误计作产品复现。
- 行为红测：`XDG_STATE_HOME=/tmp/a2d2-v3-gh-state node --test --test-name-pattern='guard seed' tests/a2d2-v3-121-acceptance.test.mjs`，退出 1；实际 Session cwd 为进程默认 worktree，期望为测试所选 `root/workspace`。
- 修复 guard 的两处字段读取后，同命令 1/1 通过，退出 0。
- 完整工具命令 `XDG_STATE_HOME=/tmp/a2d2-v3-gh-state node --test tests/a2d2-v3-121-acceptance.test.mjs`：7 项通过，2 项需要独立真实 Web 的 real-host 测试仍显式 skip，退出 0。该真实 controller 契约证据不替代 CEO lane 的新包真实 seed / 浏览器复验。

## R6：同一隔离 root 的 Web origin 连续性

本项为验收工具重启语义整改，代码/回归提交 `6077dae`。起点为干净 `e6f3ae5df501d8090b8f15d415e6e8da367920b6`，保持同一功能分支；只改本工具、新增聚焦工具测试与本说明。所有产品源码、guard、依赖、锁文件、宿主及现有服务均未修改，产品包保持 CEO 已验证版本，不重新 build/pack。

CEO 提供的真实 lane 证据表明，`product-final-8d33081` 环境的公开 seed 及 Workspace 挂载正确，浏览器重启前仍为原 2 Session ID、完整领域数据一致。旧 `run` 每次硬编码 `--port 0`，使 origin 从端口 34569 变为 42801；同 browser-profile 在新 origin 没有原 localStorage selection，真实宿主按首用 restoreSelection 流程创建第 3 个 Session。该失败与 R4 误读 workspace ID 的旧 seed 缺陷分别记账，不修改 DSH restoreSelection/header/会话数据来迎合验收。本执行者未操作或重新核验该真实实例；其原 root、公开查询/失败记录和跨进程指标继续保留，不改基线掩盖。

新增 [run 生命周期回归](../../tests/a2d2-v3-121-run.test.mjs) 使用测试自建的真实 loopback HTTP CLI fixture，经公开 `acceptance.mjs run` 子进程执行两次启动、HTTP 访问与停止。首次参数为 0，重启参数必须等于首次真实端口，两个实际 origin 相等。测试还核对同 home/browser-profile 标记、跨轮 run/exit 留证、指标原前缀保留、private 登录文件 0600 与公开输出无登录 token。fixture 不是 DSH 产品验收；所有监听/子进程均由测试创建，清理前核对精确 supervisor PID/spawn 参数、自有 listener 地址及 fixture 绝对路径/realpath，只清理自有资源。

红绿命令均使用 `XDG_STATE_HOME=/tmp/a2d2-v3-gh-state`：

| 命令 | 红测实际反馈 | 修复后实际结果 |
| --- | --- | --- |
| `node --test tests/a2d2-v3-121-run.test.mjs`（最初仅核心生命周期用例） | 退出 1；重启请求端口为 0，期望首次真实端口 36079 | 同核心用例 1/1 通过，退出 0，真实 HTTP 两轮同 origin |
| `node --test --test-name-pattern='occupied saved port' tests/a2d2-v3-121-run.test.mjs` | 退出 1；只有“Host exited without Web readiness”泛错，缺少明确占用反馈 | 加入启动前占用检查后通过，退出 0；明确 EADDRINUSE、无 Web spawn/新日志，占用者仍可响应 |
| `node --test --test-name-pattern='CLI announcing' tests/a2d2-v3-121-run.test.mjs` | 退出 1；自建 CLI 绕开请求端口后仍误报 ready | 1/1 通过，退出 0；停止本次自有 child，不覆盖 current-run / private 登录文件 |
| `node --test tests/a2d2-v3-121-run.test.mjs tests/a2d2-v3-121-acceptance.test.mjs` | — | 总 30 项（含 16 个非法记录子用例），28 通过、2 个真实 Web 用例显式 skip，退出 0 |
| `node --check scripts/a2d2-v3-121/acceptance.mjs`、`node --check tests/a2d2-v3-121-run.test.mjs`、`git diff --check` | — | 均退出 0 |

非法记录回归直接验证 Web 未 spawn、logs 为空、旧 current-run 不变；包括非 loopback、其他 loopback 名称、非法协议/端口、无效 JSON、凭据/query/非 origin 路径及保护端口。18780/18781 只作为拒绝输入，测试从未监听或启动到这些端口；其余真实监听均用系统分配的自有临时端口。没有新增人工端口配置或通用服务管理接口。

真实复验仍由既有 browser lane 执行：使用同一已验证产品包，在新的独立验收环境首次 ready 后记录 baseURL、稳定页面 selection 并冻结基线；停止/收集 managed job 后，同 root 执行原 `run` 命令，确认 baseURL 完全一致，登记新 job，沿同 browser-profile 交换私有新 token，再比较 Session ID 集合、配置、领域数据与累计模型指标。保留旧新 origin 首用失败环境，不能把其结果当作同站点重启；不得删除原 current-run/baseline/metrics 后重跑来变成通过。R1/R5 已有真实浏览器通过事实由 CEO lane 保留，本工具执行者没有亲自浏览器验证或提供截图；R6 的真实 DSH 稳定 origin 重启结果待该 lane 提供，关闭裁决由 CEO 完成。

## 本阶段实际验证

2026-10-19；宿主 HEAD `a45068d2ec03326c800c68c9bdcd47508e3ccb9c`，CLI `0.2.0-rc.2`，Node `v22.23.1`。真实前端显示 `0.2.0-rc.2-4c24ce4`，说明宿主现有构建不全同代，未擅自重建宿主。

正式记录见 [阶段报告](../artifacts/a2d2-v3-121-2026-10-19/README.md)。最终产品 tgz、产品完整浏览器清单和产品刷新／重启持久性均待 CEO 后续交付，不在本阶段宣称通过。
