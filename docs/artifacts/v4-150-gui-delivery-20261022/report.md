# v4 实例交付与真实验收记录（#150 / #152 / #154 / #155）

日期：2026-10-22（UTC）。主会话只做设计/裁决/复核，实施、部署脚本与页面取证由受派执行者或服务外受管 runner 完成。

## 一、结论摘要

| 项 | 状态 | 关键证据 |
| --- | --- | --- |
| preview 18782 切到 v4 候选并保留原数据 | 完成 | `current-run.json` host `8282d612` + 原 sessions/storages hash 一致；真实浏览器面板与来源可读 |
| 产品缺陷 #163（工作库写锁饥饿 → 交互写 503） | 已修复并部署 | PR #164（Draft，未合并）；21MB 库 5/5 刷新成功（修复前 100% 失败）；专项测试 11/11 |
| 修复后核心链路（来源/视图/PR/Issue→真实模型会话/接续入口） | 通过 | P(#157) Task `9124c73c…`、Execution `0ac555c0…`、Session `session-b36314e3…`，模型首轮真实回复 + work_control |
| 原 GUI 18781 同 URL 更新（含 #163 修复） | 完成 | pid `4148425` cwd=`v4-141-release-8282d612`；`http://10.126.126.12:18780/` 出现 A²D² 控制面板；删除路径数 0 |
| GUI 上面板端到端（加来源 + 真实数据） | 通过 | 识别 repo 来源显示 imneov 可读；概览 46 开放 Issue / 74 PR |
| 真实自动接续、父子独立验收、后台 job 收取、持续委托计划/Block/串行、关闭补偿 | **未验证** | #152 剩余场景；不得写成通过 |
| PR 合并 | 未合并 | #149（v4 整体）与 #164（#163 修复）均 Draft，维护者决定合并 |

## 二、preview 18782（#154）

目的：在不破坏原数据的前提下，把既有 preview 实例切到冻结候选（host 8282d612 + 产品包），并核对真实页面。

步骤：
1. 备份 preview 的 `home/profiles/web`、`launch.mjs`、`.v4-141-runtime.private.json`。
2. 安装已冻结候选 profile（tgz `56709afc` 安装出的 node_modules，client `640f11be`）。
3. `supervisorctl restart dsh-a2d2-v3-preview`，等待 HTTP 与 `current-run.json` 变成新 host；失败自动回滚。

记录：切换成功（pid 3795992、host `8282d612`、packageSha256 `56709afc`）；原 sessions/storages/a2d2 文件 hash 前后一致（仅新增 `work-v3.json.lock`）；真实浏览器看到 A²D² 控制面板、两个来源、概览 40 开放 Issue、读取账号 imneov。

偏差：未使用已冻结 26 工具 one-shot（#151 两项 P1 属该工具）；改用 supervisor 受管重启 + 真实页面/HTTP/命令行/inventory 核对 + 自动回滚。

## 三、产品缺陷 #163 的发现与修复

现象：preview 21MB 工作库 + 后台发现写循环时，交互写命令（`source.catalog`/`source.issue`/`continuous.configure`/保存委托）稳定 503 `work-record-unavailable`；只读查询正常；同库复制到独立实例后立刻 200。

根因：工作库为全局单文件，写事务整库解析/序列化并持跨进程锁，默认可等 2s；后台发现每 5s 写一次；同进程并发事务只能自旋（`holderExited` 对自身 PID 不接管）；路由把真实原因折叠成一句话。

修复（PR #164，分支 `fix/workstore-contention`，HEAD `dd44958`）：
- 4 个 `work-v3` 写路径先进入进程内 FIFO 队列再申请文件锁，共享 30s 获取预算；业务 lease/scheduler/planning 的 `waitMs: 0` 语义不变。
- 仅 `discovery.nextAttemptAt` 变化不整库落盘（内存 overlay，checkpoint/inFlight 仍持久化）。
- 发现轮询默认 5s → 30s。
- 503 保留 code，message 追加安全原因（`lock-timeout`/`invalid-state`/安全 errno）。

验证：新增 `tests/work-store-contention.spec.ts` 11/11；`tests/work-process.spec.ts` 5/5（跨进程真实等待 30.852s 超时、死后接管保留数据）；串行全量 246 pass / 13 fail，其中 11 项在基线 fc4fa731 复现（7 项面板 VM 模块加载、2 项旧 executionGraph 断言、2 项 self-wait/pause），另 2 项为 5s 负载超时单跑通过；`pnpm typecheck` exit 0。

部署：preview 换装修复产物（tgz `7faf3bce`、client `6e98f56f`、runId `preview-154-5a2ecf3-03-163fix`）；真实 21MB 库连续 5 次 `source.catalog(refresh:true)` 全部 completed（17–26s/次）。

## 四、修复后核心链路验收（#152 部分）

目的：证明「从真实来源进入 Issue、启动真实模型执行、看到统一执行与接续入口」这条主链在修复后可用。

步骤与记录（单客户端串行，1440×1000 与 390×844 截图）：
1. UI「刷新来源」：catalog 与 Issue 扫描 HTTP 200，整批约 21.9s；概览 43 开放 Issue / 62 PR，不再出现 `work-record-unavailable`。
2. Project：两个真实视图（任务清单/全部任务）TABLE_LAYOUT、81 项；部分字段显示「未读取此类字段值」。
3. Issue：@me+Open 见 P(#157)/C(#158)/A(#160)，@me+全部 见 P/C/E(#159 真实 closed)。
4. PR：真实开放/草稿/合并与关联 Issue；全部/已合并筛选可用。
5. P 详情 →「开始处理」：`task.start` HTTP 200（20.6s），目录 `v4-152-r01`、`codex/gpt-6.1-sol`；Task `9124c73c-3882-495d-803d-4b6d0e25bbe9`、Execution `0ac555c0-125e-4ed2-9ad2-ded8c447b37a`、Session `session-b36314e3-3c0e-4c4d-9247-928d6b4187af`、owner `657d73e9…`、epoch 1。模型真实回复并调用 `work_control status`、`work_organize`（规格 v2 / 9 条验收）、`work_report`（2/9）。
6. 「会话与执行」「接续」入口与参数可见（目标 200,000 / 余量 16,000 / 输出预留 128,000），未触发接续。
7. 关闭浏览器重开（同 session 名）：仍指向同一 Task/Execution/Session，无重复创建。

未通过/未验证：Issue「全部」下一页点击后仍第 1 页（HAR 无 page:2）；PR 下一页行变化但页码仍第 1 页；P 首轮后 `processingState=blocked`，blockers 含 `Exact model route or capacity changed; explicitly reconfigure continuation before advancing`，真实自动接续四阶段未取得实证。

## 五、原 GUI 18781 同 URL 更新（#155）

目的：把用户正在使用的开发实例从旧插件切到含 #163 修复的 v4 产物，保留原会话/工作区/项目数据，并在同一 URL 核对。

步骤（服务外受管 runner `/data/_dsh-dev/deployments/v4-gui-runner.sh`）：
1. 备份 `/data/_dsh-dev/profiles/web`、`/etc/supervisor/conf.d/dsh-dev-web-server.conf`、切换前 stderr。
2. 装入修复产物 profile（client `6e98f56f`），写 `launch-v4.py`（exec 8282 宿主 CLI，保留 DSH_HOME/凭据/CWD 语义）。
3. `supervisorctl reread/update/restart dsh-dev-web-server`。
4. 健康等待 → 真实浏览器登录核对面板与旧工作区 → sessions/storages/a2d2/projects inventory 比对。
5. 任一步失败：恢复备份 profile 与 supervisor 命令并重启旧实例。

记录：
- pid `4148425`，`/proc/4148425/cwd = …/v4-141-release-8282d612`；conf command = `python3 /data/_dsh-dev/profiles/web/launch-v4.py`；外部入口 `http://10.126.126.12:18780/`（socat → 127.0.0.1:18781）返回 401 登录页。
- 用新口令登录外部地址成功；侧栏出现 A²D² 控制面板；五个原工作区与全部原会话保留。
- 面板端到端：`＋` → 粘贴 repo 链接 → 「a2d2-dev/dsh-plugin 仓库 · 读取账号 imneov · 已确认可读取」→ 确认添加 → 概览 46 开放 Issue / 74 PR。
- 保留核对：sessions 198→200（新增重启后本会话文件 2 个）、storages 1→1、a2d2 2→3（新增 `work-v3/runtime-v1.json`）、projects 4→4；**删除路径 0**。`workspace.json`/task-runtime 状态为同一路径原地更新。
- 更正：runner 初版用整行 diff，把 hash 变化误判为 loss；已改为按路径集合判定（只在路径消失时算 loss），复算 `LOST_PATHS=0`。
- 真实模型：本会话即运行在更新后的 18781 上（同一 pid），回复与工具调用由该实例模型产生；新插件向协调会话暴露工作工具。

## 六、安全

- 既有阶段证据 `raw/part2-fresh-runtime-observation.json`（20MB）含实例登录口令明文，已在 QA 分支 tip 删除（`9cc37a7`；历史仍在私有仓库）。
- 已轮换 `/data/_dsh-dev/web-password`（20 位）；preview 与 GUI 重启后均使用新口令。
- 本文件与脚本已扫描，未包含口令/token。

## 七、未验证边界（不得视为通过）

真实自动接续与后继决定保留、父子独立验收（C/E 纳入父完成）、后台 job 收取分层、持续委托真实模型计划/Block/串行/等待让槽/关闭补偿、关闭冲突补同步、稳定分页与 PR 关闭空结果。#152 保持 Open 覆盖这些场景；#163 修复 PR 与 #149 均等维护者合并。

## 八、补充核对（轮次内追加）

- **分页不是后端缺陷**：preview 真实 API 用 `source.issues`（Project1 来源，`perPage=5`）：第 1 页 `status=completed`、`nextPage=2`、首项 `#112`；第 2 页 `completed`、首项 `#12`（条目不同）。服务端分页正确。GUI 上「下一页」按钮在 `@me + Open`（16/16 项 < 20/页）时本来 disabled，不属于缺陷；UI 点击行为仍未稳定复现，记为未定性。
- **接续 blocker 的根因是陈旧 policy**：P 详情里用正规入口显式重存自动接续策略（target 200,000 / reserve 16,000，HTTP 200，policy v2）后，`Exact model route or capacity changed` blocker 消失，只剩 fixture 自身要求的 FINISH 等待；说明该 blocker 是“策略与当前路由不匹配，需显式重配”的设计路径，不是接续功能损坏。
- **持续委托的 `source-snapshot-unavailable` 属实现细节**：repo 来源需要 `repositorySnapshot.sourceVersion === source.version`；该版本匹配扫描由 `continuous.preview` 自身在规划前执行（1 页 100 条、最多 10 页），后台 reconcile 只在规则 `enabled=true && planning` 时补扫。对 disabled 的规则直接查 status 会看到该错误，属预期，不代表功能不可用。
- GUI 侧 `invalid-request` 假警报：用 DOM 直接改筛选值导致 React 状态带上非法枚举（`assignee='all'`），恢复为 `@me` 后真实刷新成功（16 项，观察时间 2026-10-22T03:38:16Z）。不是产品缺陷。

## 九、接续与持续委托（#152 收口状态，2026-10-22 04:00Z）

### 已通过：真实自动接续

- policy v3（target 28,000 / reserve 16,000）按“真实计量之下”正规重存，未注入 meter；自动触发，真实 observation 28,185。
- `material-saved` → `delivered` → 正式接任：execution epoch 1→2，当前 Session 变为 successor `session-1a48efa9…`，旧段 role=retired；owner 身份保留（符合规格）。
- 新段真实模型首条回复复述「数量3、必须保留stable标签」与未完成项；usage：codex/gpt-6.1-sol/high、maxTokens 128,000、input 15,358 / output 111。
- 旧段推进被拒：`task.control progress`（epoch=1）→ HTTP400 `stale-execution-authority`。

### 部分通过：持续委托

- 真实模型计划 v1（HTTP200 / 68.4s）给出 A→B 有序步骤、理由/nextAction/新建或复用判断，X 被排除；`continuous.block` 使 Block 正式持久化，纠偏后保留；Task/Session/proof 零执行证据成立。
- 计划启用被新缺陷 **#165** 阻断：planning basis 含全部易变字段，60–90s 模型窗口内必然被 30s 发现 tick 或其它会话进展破坏（`planning-basis-changed`）；另有 3 次 `planning-model-failed`。修复分支 `fix/planning-basis-stability`（base dd44958）进行中。
- 未完成：启用后的 A 让槽 / B 串行 / B 真实关闭 / A 恢复、暂停在途边界、越界 node 拒绝。

### 新缺陷

- **#165** 计划 basis 校验过严（产品能力阻断，修复中）。
- **#166** 390×844 持续委托面板横向裁切（textarea width=514 vs documentWidth=390，按钮右侧超出视口；有 DOM 坐标与截图）。

## 十、组合修复与 planner 负载（2026-10-22 04:20Z）

- 已构建并部署 `#163 + #165` 组合产物到 preview：tgz `5269d65b`、client `f68f8181`、host 8282d612；sessions/storages 保留（redeploy 日志与 inventory 见 preview `artifacts/redeploy-20261022T041459Z/`）。
- **#165 生效验证**：连续两次 `continuous.preview` 不再出现 `planning-basis-changed`，而是直达模型调用；新的失败消息 `Model planning failed: Model stopped with error` 说明模型失败与 basis 抖动已被区分（R3）。
- **新缺陷 #167**：planner 仍失败，测量显示请求体约 350–400KB——`planningBasis` 把整个 source（实测 source 328,892 bytes，其中 observations 285,493 bytes / 49 条）与无关 Issue 全部发给模型；实际只需要候选身份与指令/Block/策略。已在独立 worktree `fix/planner-payload`（base 4f359b8）修复中：收窄来源摘要、候选有界字段、请求体上限与失败诊断。
- 决策：GUI 暂不再次重启换装组合产物，等 #167 一并修好后再做一次最终同 URL 更新，避免为中间版本多付一次重启成本；当前 GUI 仍是已验收的 v4 + #163 修复版本。

## 十一、持续委托串行调度：已真实跑通（2026-10-22 04:47–05:00Z）

`#167` 修复部署到 preview（client `85abb961`、tgz `120aea75`、host 8282d612，sessions/storages 保留）后：

1. **真实模型计划 v2**：`continuous.preview`（expectedVersion 7）HTTP200，plan v2 `createdAt=2026-10-22T04:48:11.830Z`，steps 有序 **A(#160) → B(#161)**，两者 `mode=new`（不再是 wait），含 why/nextAction，X(#162) 不在计划内。basis 从 ~2.2MB 降到 129KB 后模型调用恢复稳定。
2. **Block 生效**：X item=`blocked`，reason「Issue is excluded by the persistent Block list」。
3. **启用即自动推进**：`continuous.set-enabled`（v8→v9，enabled=true）后宿主自动为 A 建 Task `b8d20566` 与执行 `f3cf7e6a`（session `session-ab13…`），此时 B=queued、X=blocked，**同时只有一项 active**。
4. **A 让槽**：A 在真实会话里保存 in-progress、写 `A.proof.json`，并调用 `work_control wait`（control action=wait status=applied）→ item A=`waiting`。
5. **B 接槽**：A 让槽后宿主自动为 B 建 Task `d456f4bc` 与执行 `f3f33cb2`（session `session-d4ed19…`），item B=`active`，A 仍 `waiting`、X `blocked`——串行语义（A-start → A-wait → B-start，至多一项推进）真实成立。
6. 快照：`continuous-serial-snapshot.json`（规则 v9/enabled=true、plan v2 modes、items、executions、tasks）。

### 未完成（如实记录）

- B 的模型在正确取得宿主推进槽后，仍以「串行槽前置条件缺少可核验回执」为由把自己置为 blocked，未开始 proof 执行；操作者两次正式 `task.input` 提供宿主槽证据（规则 v9 enabled、A=waiting、B=active、active ref=d456f4bc…）后仍未继续。这是**夹具/模型判断**问题，不是调度器缺陷；因此 B 未完成、未关闭 #161，A 的 RESUME 与最终完成也未验证。
- 越界 node 拒绝（模型输出计划外节点）本轮未构造出真实场景，未验证。

## 十二、最终同 URL 核对：GUI 组合构建与真实模型计划（2026-10-22 07:19–07:31Z）

主会话 #136（父 #150）收尾轮次，全部核对走外部地址 `http://10.126.126.12:18780/`。详细证据与原始文件见 `final-verify-20261022T0730Z/README.md`。

### GUI 已是组合构建

- 切换发生在 06:56Z（受管 runner `systemd-run --on-active` 延迟执行）：`deployments/v4-gui-20261022T065636Z/runner.log` → `RESULT=updated-and-verified`、`LOST_PATHS=0`；因此本轮**不需要**再跑 `v4-gui-runner.sh --execute`。
- 独立复核：profile `client.js` sha256 = `85abb961…`；CLI pid `749945` cwd = `…/v4-141-release-8282d612`（`git HEAD 8282d61299`）；supervisor command = `python3 …/launch-v4.py`。
- 浏览器实取 `plugins/??dsh-a2d2/client.js&rev=a7da043b78de`（200，353,942B），还原服务端注入的 sourceMappingURL 行后 sha256 = `85abb961…`，逐字节等于磁盘文件——排除"磁盘新、服务端仍发旧 bundle"。

### 面板 / 来源 / 保留

- 「A²D² 控制面板」在侧栏；五个原工作区与原有会话保留；repo 来源 `a2d2-dev/dsh-plugin`（读取账号 imneov，44 开放 Issue / 74 PR）保留。
- 按路径集合比对切换前清单：`LOST_PATHS=0`（sessions 208→210 仅新增，storages/a2d2/projects 计数不变）。

### GUI 侧真实模型计划（#167 的 GUI 证明）

- 三次真实 `continuous.preview`：deepseek-flash 32.4s → `planning-execution-mismatch`（模型把 #160 判成 `existing`，而工作库 0 Task/0 Execution）；deepseek-flash ~50s → `planning-model-failed: Model stopped with max-tokens; requestCharacters=16386, candidates=47`；**codex/gpt-6.1-sol 28.4s → HTTP 200，plan v1：3 步，#152 `new` → #150 `wait` → #136 `wait`**。
- 载荷量：修前约 350–400KB；GUI 侧现 `requestCharacters=16386`（47 候选），落盘 basis 21,835 chars。模型真实返回并被解析，说明 #167 的失败模式在 GUI 消失。
- 本轮只做预览：规则 v5 `enabled=false`，未创建 Task/Execution。

### 本节新增的未验证项（不得写成通过）

- 47 候选 + deepseek-flash 触发 `max-tokens`（模型输出预算），未定性为产品缺陷。
- 模型对 canonical 执行存在性的判断与工作库事实不一致（#160 被判 `existing`）。
- #166 窄屏裁切本轮未复测；分页稳定、PR 关闭空结果、后台 job 分层、关闭冲突补偿沿用前次未验证结论。

## 十三、串行收尾：B 完成 → #161 关闭 → A RESUME → #160 关闭（2026-10-22 08:08–08:35Z）

详细证据见 `serial-B-done-A-resume-20261022T0810Z/README.md`。

- **B**：真实会话写入 `B.proof.json` 并以 workspace-write 实际执行 JSON/数量/标签/SHA256 校验（全 passed），08:08:22 `done` + `closeExternal`；#161 于 08:11:28Z 关闭（external 先 `unknown`，随后观察为 `closed`）。
- **A**：正式 `task.control resume`（`RESUME-A-v4-152-6b252218-r01`）后沿用原 session/owner/资源恢复，08:31:59 采纳 #160 完整原生子范围（0 子项），08:32:38 `done` + `closeExternal`；#160 于 08:34:58Z 由宿主 completion outbox 自动关闭（closeout settled，external closed/attempts 1）。
- **环境修复**：宿主原先没有 workspace-write 沙箱后端。安装 `bubblewrap 0.6.1` 并用产品自身模板实测只读 + workspace-write 均通过后，重启 preview 重新探测；此后 A/B 的 bash 以默认权限成功执行。B 曾发起的 danger-full-access 扩权请求被**拒绝**，未放宽权限。
- **新缺陷 #168**：持续候选扫描每 ~30s 用不含 `subIssues` 的列表观察覆盖 `binding.lastObserved`（`repository-candidates.ts:63` 用 `<=`），令 `source-children` 采纳必然 `source-observation-superseded`、`done` 被 `native-child-scope-incomplete` 拒绝。暂停接新（rule v12 enabled=false）后一次采纳成功——绕过而非修复；已按建议登记 #168。
- **越界 node 拒绝**：用真实模型两次刻意构造，模型均拒绝输出候选外节点（plan v2/v3，HTTP 200），因此 `planning-outside-source` 仍只有单元测试覆盖，**未取得真实模型实证**。
- **B 模型判断问题**：未消除；B 仍需操作者给出正式槽位事实才推进。
- **仍未验证**：47 候选 + deepseek-flash 的 `max-tokens`、#166 窄屏裁切、分页稳定、PR 关闭空结果、后台 job 收取分层、关闭冲突补偿。
