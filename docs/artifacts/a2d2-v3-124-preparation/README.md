# #124 GitHub 来源：18782 部署与真实浏览器验收准备

## 本阶段结论与实验目的

本阶段只完成准备，**没有安装候选、没有重启服务、没有创建测试记录**。CEO 尚未提供最终产品候选及部署开绿；后端/UI 产品集成结果、认证后页面、来源接入和 Session 关联均未验收。当前页面仍是此前 HTTP 修复包，不以该包验收 #124。

目的：在既有普通 HTTP 预览上建立可复查的旧数据保留基线，验证服务器读取身份的最小环境，准备收到指定候选后可执行的部署与浏览器步骤。原 GitHub Project 测试目标为 <https://github.com/orgs/a2d2-dev/projects/1>；既有 [来源设计及只读 smoke 说明](../../architecture/a2d2-v3-124-source.md) 与 [真实 smoke JSON](../../architecture/a2d2-v3-124-smoke.json) 证明 Project 1 包含仓库 `a2d2-dev/dsh-plugin` 的真实 #112。本阶段未重新获取 Project 元数据或 #112 正文。

## 目录、基线与操作边界

首条命令在指定 worktree 执行 `pwd && git branch --show-current`，实测：

- 目录 `/data/src/github.com/a2d2-dev/dsh-plugin.worktrees/a2d2-v3-04-acceptance`。
- 分支 `test/a2d2-v3-04-acceptance`。
- 初始 HEAD `c5cdd4b9e8ef42c1d66dfef828162e9b6c819866`，`git status --short` 为空。

只在此 worktree 写本准备证据和验收工具。preview 文件均只读；未访问其他 checkout 的源码。18780/18781 未修改或重启，未启动替代服务。候选阶段也只允许修改指定 preview 的包/配置和重启其已有 supervisor program。

已读取现有 launcher、patch、guard、HTTP 部署/浏览器/保留工具和 [HTTP 验收记录](../a2d2-v3-132-http/README.md)。旧部署脚本固定了旧来源 worktree 和旧 SHA，不能直接重跑用于新候选。

## 实验步骤与已观测结果

1. 用 `supervisorctl status dsh-a2d2-v3-preview` 只读查询：exit 0，RUNNING PID `2636008`。run ID `16c5b50f-86f7-442c-827b-cfd776ce9090`，child PID `2636015`，HTTP origin 仍为 `http://10.126.126.12:18782`。
2. 执行 [保留工具](./retention.mjs) `capture`，保存 [基线](./baseline.json)：2 Projects、2 Agents、3 Tasks、9 commands、0 legacyMappings，两个 Session 文件，gateway/adapter 均 0。
3. 以 launcher 完全相同的白名单环境，**只增加** `GH_CONFIG_DIR=/root/.config/gh`，执行 `gh api --method GET user`：exit 0，身份 `imneov` / `MDQ6VXNlcjMxNjEyMDMz`。无需将 preview 的 `XDG_STATE_HOME` 改到 `/tmp`。本阶段未修改 launcher，没有执行 `gh auth token` 或输出 token。
4. 加载 agent-browser skill 及 `agent-browser skills get core`。专属浏览器 `a2d2-124-prep` 打开确切公网 HTTP origin，只查看未认证登录页。原生 `isSecureContext=false`、`crypto.randomUUID=undefined`、`crypto.getRandomValues=function`。未加安全来源例外/禁用 Web security flag，未覆盖 Crypto、未 mock API、未注入写成功结果。
5. 保存 [登录页截图](./01-native-http-login.png)、[快照](./login-snapshot.txt)、[预检 JSON](./preflight.json)。截图经实际查看，密码输入框为空。准备过程未读取固定密码。
6. 执行保留工具 `compare`：[只读检查后证据](./after-readonly-preflight.json) exit 0，全部既有记录 ID/hash 和 Session 整文件 hash 一致，计数仍为 2/2/3/9，模型计数仍 0/0。最终工具增加 guard/patch 比对后再执行一次，结果见 [准备结束保留证据](./final-preparation-retention.json)。

采集过程的两次工具失败也保留口径：首次把默认随机 browser profile 假定为 session 名，匹配 0 个；改为明确 profile 后，宽泛 substring 匹配误含其他进程命令，匹配 13 个。最终以 Chromium 独立参数 `--user-data-dir=/tmp/a2d2-124-prep-browser` 精确匹配，得到单个自有浏览器 PID `4140842`。这些失败未执行产品操作或改数据，不属于 #124 产品验收结果。脚本输出文件使用 `wx`，再次运行须提供/改用新证据文件名，不能覆盖既有证据。

## 当前安装包与旧数据基线

当前 tgz 为 preview 下 `artifacts/http132-1d0face/dsh-a2d2-0.0.1.tgz`，313192 bytes，SHA256：

```text
3ba6225b0da7eb20f05724b4c686ba058d6f52d8e41bd98964ae566a10e22767
```

安装 client bundle SHA256 `f8d77443584a553a7bab124866f3f0e9775d5bca3a347be4f3e9e2e1fca2b7e5`。manifest、lockfile、launcher、patch、guard 与 tgz/bundle 的完整 hash 均在 [基线 JSON](./baseline.json)。这是当前 rollback 目标，不能用更老的演示包替代；历史 tgz、旧 rollback 和失败证据也继续保留。

| 原记录 | ID | JSON row SHA256 |
| --- | --- | --- |
| 演示 Project | `ec480d94-c5e8-44a0-80a0-897945df1a67` | `552b30fb95ad6c20ff11b2b1926b471113b6b623fad9525cdf5e933e4b5867d0` |
| HTTP132 Project | `1b3fd2f7-a492-4c1d-a965-7e7f8cc5cc58` | `e1e98d174624c9127705b1f05132ec0b33055d2eaba841b3625194899e090618` |
| 原 Task 1 | `76e75fb5-a0ee-45cb-94e0-8dc9cb849411` | `e2975e85b29fc5365978a2ceac84a47a24b6a34c636421b53d2d63e09464cb90` |
| 原 Task 2 | `0880f27a-5367-4679-b562-27c080cff7ab` | `92db7bf90a25d62044b4641f9669f088a06afcec92c0db5bdaaea0f019913a9c` |
| HTTP132 Task | `3e00a048-42b1-48dd-ae22-d6655c06779d` | `ca92021ad026e7b4942917d2c1c0e03ff21486d85c7f743a91e15ca91edf1a0d` |

两个 Agent 和九条 command receipt 的每个 ID/hash 同样逐条保存在 [基线 JSON](./baseline.json)。完整 Task row hash 同时保护其规格、活动及既有 Session 关系。Session `f9282a68-4c3f-4251-adcb-bcd6f24d7515` 的压缩记录当前为 **417 bytes**，SHA256 `7cfd5a79aa74170a2fcb456e13d2fc21b5f88446f7b329da76406812ab6c8e27`；lock 文件为 0 bytes。不能继续拿上次 HTTP 部署前的 337 bytes 作为本次整文件基线。

## 候选到达后的部署白名单与保留检查

以下均为待执行步骤，必须先收到 CEO 明确指定的提交/版本化 tgz/校验 SHA 和部署开绿。当前不执行安装或 restart。

1. 再校验本 lane 的 `pwd`/branch/status，核对候选确切提交、fresh review 裁决与 HTTP 修复集成。候选准备人提供 source commit、tgz SHA、client bundle SHA/manifest；不从其他 checkout 擅自构建或提取旧包。
2. 在 preview 自有 `artifacts/<唯一候选版本>/` 保留新 tgz，以实际 SHA 核验来源；保留所有历史 tgz。创建独立版本的证据/rollback 目录，用排他写备份当前 manifest、lockfile、launcher、patch；记录备份的 bytes/hash。当前 `baseline.json` 只是准备时刻，安装前必须重新捕获新基线。
3. 白名单变更仅为 profile 的 `dsh-a2d2` file dependency、对应 lockfile、launcher 的 package SHA 元数据，以及 launcher env 中增加 `GH_CONFIG_DIR:'/root/.config/gh'`。保留 preview 自有 `XDG_STATE_HOME`/state、`DSH_HOME`、`XDG_CONFIG_HOME`、密码文件引用、home/workspace/Session/store 路径、trusted host、透明 HTTP relay、guard/禁用模型配置。禁止把 token 写入配置、浏览器或证据。
4. 在该 preview profile 内以 `pnpm install --ignore-scripts --no-frozen-lockfile --config.auto-install-peers=false` 安装指定 tgz，记录退出码和 installed tgz/bundle 的实际 hash。只有 manifest/lockfile 等预定配置差异可接受；guard/patch hash 必须一致。
5. 只执行 `supervisorctl restart dsh-a2d2-v3-preview`。检查同 program RUNNING、新 PID/run ID、旧 origin 可访问、current-run package SHA 与实际安装一致。不得重启 supervisor 全局、18780/18781 或另起 server。
6. 首次重启后、浏览器任何来源配置动作前运行 `compare`；要求每一条旧 Project/Agent/Task/receipt 的 ID/hash 原样保留、Session 路径及 417 bytes 前缀 hash 保留、模型计数 0/0。
7. 验收结束后再比较安装前基线。任何 session 整文件变化由工具记录 bytes/前缀；工具返回失败并要求单独诊断追加记录，不把前缀相同直接说成整文件不变。只允许有证据且符合授权操作的追加；不删除/恢复用户数据来制造通过。
8. 失败先留截图、错误、运行/config/hash和保留差异，定位 root cause。回滚仅恢复该版本备份的代码依赖/manifest/lockfile/launcher/配置，重新安装**当前保留的 HTTP132 包**并 restart 同 program。用户数据保持当前状态；如果新来源快照使旧包不兼容，停止写入并回报，绝不用旧数据快照覆盖。

### 首次重启新增 source 字段的兼容判据

旧快照顶层只有 `schemaVersion/projects/agents/tasks/commands/legacyMappings`。候选首次加载旧 JSON 不得报错；读旧数据不能要求预先存在 source 字段。立即通过真实页面或只读公开查询验证旧 Project/Task 及其 Session 引用都能读，且不为兼容性创建记录。

来源字段可能仅在首次显式命令持久化后出现，不能把“重启后必须立即落盘”当要求。接受以下有证据状态：重启前后旧 JSON bytes 完全相同；或候选正常持久化使 schema 增添其声明的来源/观察/绑定/唯一索引空结构，而旧记录每行 hash 不变。工具记录 `addedSnapshotKeys`，候选 schema 与实际新键必须逐一核对，未知字段变化不能自动放行。

页面配置/刷新只允许新增来源配置、观察/缓存和相应显式回执，**浏览 Issue 不得增加 Task**。显式接入后允许新增本地 Task/binding/index/活动/receipt，必须持久化 canonical TaskId；再接入不新增第二个 Task。不得改原 Task 来规避演示 Project/Session 归属限制。老 JSON 整文件 hash 变化应解释新增字段/记录，而旧记录保持使用 row hash 判据。重新加载后再次只读核对 canonical 绑定及所有旧记录。

## 待执行的真实浏览器验收步骤

真实浏览器只用 `http://10.126.126.12:18782/`，最终认证验收复用此前 HTTP132 自有 profile `/data/_dsh-dev/previews/a2d2-v3-121/browser-http132`（旧 session 名 `a2d2-http132`），以及该 profile 中已有的原生 selection。先核对 profile 占用，不能并发启动同一 profile；本阶段未认证的 `/tmp/a2d2-124-prep-browser` 只用于登录页预检，不用于最终首用验收。先获取当前 snapshot 再操作 ref，不直接写 localStorage、改 selection 或移植存储状态。

首次选择可能触发宿主创建空 Session（#121 动态 origin 已有历史证据）。如复用后仍发生，保留该 Session，记录触发的真实 UI 动作、创建时间/ID、guard `session-born` 及前后 Session 集合，明确属于宿主导航行为；不删除新 Session 后声称集合未变。允许报告“既有 IDs 与原 bytes 前缀保留，新增宿主空 Session 已归因”，不能报告“ID 集合完全一致”。不发送 prompt、不启动模型，gateway/adapter 仍须 0；新增 Session 不替代既有兼容 Session 关联的验收要求。`retention.mjs compare` 的 `checkPassed` 检查既有记录/原 bytes/guard/model，不会单凭新增文件失败；最终必须另外逐条审查 `addedSessionFiles` 和 guard 的新增 Session ID，只有它们均为空才能称 Session 集合不变。若新增则附真实身份及归因，不能仅凭 `checkPassed:true` 放行该结论。

固定密码仅由内部自动化进程读取 `/data/_dsh-dev/web-password` 后输入登录流程；不回显、不写报告/截图/命令工具参数、不保存 token URL 或含凭据的 HAR/状态文件。GitHub token 由服务器来源适配器读取，浏览器不接收 token。

| 场景 | 页面动作 | 判据及证据 |
| --- | --- | --- |
| 原生 HTTP | 登录后再次读取 origin/原生 Crypto 能力，记录自有 Chromium flags | false / undefined / function；无安全例外、无 Crypto/API 替换；截图 URL 不含秘密 |
| 旧数据可读 | 在演示 Project 中只读打开原 Task，查看 Session 关联；记录原位置 | 全部旧 Task 可读且 row hash 不变；只读导航不创建测试记录 |
| 仓库来源 | 在已有演示 Project 页面配置 `a2d2-dev/dsh-plugin` | 来源身份可辨认，服务器身份 imneov；无浏览器凭据入口 |
| 默认我的 Issue | 初次打开列表 | 页面与实际请求为 `@me`；记录真实列表与身份。空列表按实记录 |
| 全部/分页/刷新 | 切全部，使用实际分页控件前进/返回，显式刷新 | 页码、loading/error/cache 状态真实；刷新不是创建 Task；无数据时不假造下一页 |
| Project 1 的 #112 | 用真实列表/搜索/分页或候选实际支持入口打开 #112 | 记录 #112 nodeId `I_kwDOUmfSE88AAAABXdRGDA`、规范 URL；正文与当次只读 GitHub 原文逐字/bytes/hash比较。4950 bytes 只是历史 smoke，不硬编码为当前真值 |
| 浏览不接入 | 浏览完整正文后返回来源列表 | Task 数量与 IDs 不变；缓存/观察可新增，但无占位 Task |
| 显式接入 | 点击接入一次，保存实际返回 canonical ref/TaskId 再导航 | 新建仅本地测试工作，正文完整；不凭 issue number 拼 TaskId；旧 Task hashes 不变 |
| 去重 | 返回来源再点接入同 #112 | 定位同 canonical TaskId；Task 数量无第二次增长；receipt 依据真实命令可能新增但不得改旧 receipt |
| 四标签与关联 | 查看真实详情四标签（记录实际名称）；只给新接入 Task 关联已有兼容 Session | 不修改原 Task。若 Session 已被占用或不兼容，保留限制/错误证据，不造新 Session/启动模型绕过 |
| Session 导航 | 从新 Task 跳已有 Session，再返回来源/Task 原位置 | Session 关系、导航目标及返回位置可验证；不发消息，不点击启动/续跑 |
| 缓存/错误 | 若 UI 支持，使用明确不存在的只读来源测试错误，再回正确来源；也保留候选自身真实错误 | 错误不是空页；已有观察/Task 不丢。不可触发限流或修改共享凭据，不伪造429/401 |
| 停用及本地保留 | 在 UI 停用本次来源，读取接入 Task/正文，完整 reload 再看 | 停用阻止刷新/新接入，本地 Task/canonical 绑定/Session 仍可读；不用远端 fallback |
| 最终保留 | UI 结束后只读核对旧 IDs/hashes、Session 前缀、模型指标 | gateway=0、adapter=0；新增项逐条解释；whole-file 变化单独留证 |

若最终 UI 不含真实 GitHub Project 视图，本次仅验证 **Project 1 中真实 Issue #112 的仓库来源接入**。不得把仓库列表宣称为 Project view 或 #125 完成；不宣称具备任务启动/续跑/完成能力。无法在真实 UI 执行的场景标记“未验证/受阻”，不以隐藏 API 写命令、mock 或成功结果注入代替。

## 工具运行与下一步

准备工具已实测执行；不要将保留工具误当部署脚本。

```sh
node docs/artifacts/a2d2-v3-124-preparation/retention.mjs capture docs/artifacts/a2d2-v3-124-<候选版本>/before.json
node docs/artifacts/a2d2-v3-124-preparation/retention.mjs compare docs/artifacts/a2d2-v3-124-<候选版本>/after-restart.json docs/artifacts/a2d2-v3-124-<候选版本>/before.json
```

先在本 lane 创建相应证据目录；输出使用新文件名，工具不覆盖已有证据。工具只读取 preview 的快照/Session/config/metrics，不向 preview 写入，也不会创建产品记录。候选部署、认证后浏览器验收、回滚均尚未执行。准备完成后提交推送本分支，不合并，等待 CEO 候选与明确部署开绿。
