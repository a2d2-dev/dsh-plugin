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

LLM 模块通过宿主 base bundle 依赖闭包解析；controller/client-modules 通过 web-app bundle 解析。guard 拷贝到临时独立包，避免宿主把仓库中的 guard 误认为产品客户端包。overlay 全量替换相关 config；host-only 不写不存在的 A²D² 行；产品环境禁用既有 `a2d2-task-runtime`。插件的 v3 工作数据默认位于独立 DSH_HOME。

guard 只提供合法模型目录元数据，`adapter.stream` 计数后抛出固定错误；公共 waterfall 计数并拒绝任何非 guard provider。每次 IPC 命令还核查实际 provider 目录只有 guard。只记录事件种类、时间、进程和 Session ID，不保存模型消息正文。

公开 Session／Workspace controller 通过仅存在于临时文件系统的 IPC 调用；不新增产品路由，不直接写任何 Task store。`seed` 创建真实 Workspace 与无 prompt 的真实 Session；不应在冻结基线后调用。首次空环境 restoreSelection 创建默认会话属真实宿主启动行为，必须在页面稳定后再定基线。

### 组件模块

| 组件 | 职责 | 状态归属 |
| --- | --- | --- |
| prepare | 核验宿主、安装指定 tgz、生成 overlay 与独立 guard 包 | manifest、隔离 profile |
| run | 前台监管真实 CLI 子进程，转发停止信号，记录 ready 与退出 | private 日志、run 记录 |
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

重启使用同一个已准备 root，再次运行 `run` 并登记新 managed job ID；不能再次 prepare 或删除 metrics。若需加载新的 tgz，另建全新 root。浏览器需重新交换新进程 token，再通过公开查询检查持久身份及配置。

清理只停止本任务 managed jobs 与 `agent-browser --session a2d2-v3-121 close`。保留临时隔离数据以便复核，不删除宿主或既有 profile，不操作 18780/18781。正式证据只白名单复制 manifest、run／exit、positive、metrics、baseline／check、截图及脱敏测试结果；不复制 private 登录 URL、原始日志或 browser profile。

## 一轮评审后的 R2 隔离整改

原 checkedRoot 先递归 mkdir 后检查 realpath。真实回归由测试自行创建 `/tmp` 外部临时 fixture 及 ticket namespace 下的临时 fixture，把 namespace/link 指向外部，再调用公开 prepare；拒绝后要求外部目录为空。所有 fixture 在 cleanup 前核对保存的精确绝对路径、父目录、名称前缀及 realpath，仅清理本测试创建的根，不删除 namespace 或现有实例。

- 红测：`XDG_STATE_HOME=/tmp/a2d2-v3-gh-state node --test --test-name-pattern='symlink escape' tests/a2d2-v3-121-acceptance.test.mjs`，退出 1；实际外部目录新增 `new-root`，与期望空数组不符。
- 修复后同命令退出 0，1/1 通过；没有外部新增目录或文件。
- 工具测试命令 `XDG_STATE_HOME=/tmp/a2d2-v3-gh-state node --test tests/a2d2-v3-121-acceptance.test.mjs`：6 项通过、2 项 real-host 显式 skip，退出 0。新增覆盖规范路径语法、内部及悬空 symlink 的拒绝，及全新规范 root 的完整 prepare。后者使用测试自建的最小宿主布局/CLI fixture，不冒称真实 DSH 宿主安装或产品验收。

## 本阶段实际验证

2026-10-19；宿主 HEAD `a45068d2ec03326c800c68c9bdcd47508e3ccb9c`，CLI `0.2.0-rc.2`，Node `v22.23.1`。真实前端显示 `0.2.0-rc.2-4c24ce4`，说明宿主现有构建不全同代，未擅自重建宿主。

正式记录见 [阶段报告](../artifacts/a2d2-v3-121-2026-10-19/README.md)。最终产品 tgz、产品完整浏览器清单和产品刷新／重启持久性均待 CEO 后续交付，不在本阶段宣称通过。
