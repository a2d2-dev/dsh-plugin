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
