# #368 等待中的会话可显式接续

## 目的

修复当前协调会话处于 waiting/paused 时，“准备接续”被禁用的问题。接续只迁移上下文，保留原 Task、Execution、owner、等待或暂停及其原因，不恢复业务处理。

## 根因与范围

共享 `ExecutionContinuation` 将 waiting/paused 一律视为不可接续，并提示先恢复处理。这与现有 `task.continue` 及受控维护协议不一致。主协调已在正式页面确认按钮禁用及该提示；当时相关执行已结算，上一代接续已收到材料。

移除状态本身造成的按钮禁用，改为说明只切换会话、保留当前等待或暂停。“恢复处理”仍为独立操作。控制尚未 applied、原执行失败或创建中、任务完成、缺少实际执行资料和非当前协调的既有边界保留；明确结束的队列继续禁用。没有修改自动唤醒、运行账本、作业结果、宿主或原业务资源。

历史完成通知在旧日志中排在多条自动输入之后，宿主只 claim 首项并结束 blocked。当前主干已有作业通知合并准入回归，准确结果唤醒的六项现有回归通过，本次不重复修改已修复逻辑。历史通知已经取消不能等同于当前仍可投递，结果真实可达性须由宿主正式观察确认。

## 步骤与记录

基线 `origin/main`：`00597bf`；独立分支 `fix/184-session6-continuation`。

1. 在生产组件测试中覆盖原生会话页和 Issue 详情页，分别准备 waiting/paused 的准确当前执行，要求按钮可用。修复前四项均因 `disabled=true` 失败，见 `client-red.log`。
2. 修改共享入口后点击“准备接续”，要求只提交带 ref/ExecutionId/owner/epoch 的 `task.continue`，不提交业务 resume，返回的原 state/control 保持。
3. 检查未生效 wait/pause/end 及已生效 end 的禁用；保留完成、历史关联、缺少 actual、失败和创建中回归。
4. 复用真实宿主 waiting/paused 维护交接、结果后材料刷新和准确作业完成通知回归，再运行相关完整文件、类型检查、构建和 diff 检查。

本地原始日志保存在忽略目录 `docs/artifacts/dsh-368-2026-11-08/`。自动化模型由确定性 fixture 控制；真实 AgentLoop、Inbox、持久化、工具和 job 生命周期沿用既有集成夹具。开发页面、发布与原会话接任由主协调负责，测试和构建本身不能替代页面验收。

## 自动化结果

四个相关完整文件共 131 项全部通过：`execution-continuation-render`、`execution-components`、`work-continuation`、`work-execution-guard`。`pnpm typecheck`、`pnpm build`、`git diff --check` 均退出 0。未运行全套测试。

正式发布分支 `release/183-message-delivery-input` 在已部署的 `c17fdbb` 与主干受影响组件相同，本补丁可独立集成；不能以主干包覆盖该分支尚未合入的宿主和接续修复。

## 发布与页面验收（2026-11-08，第一阶段记录）

独立只读审查 APPROVE。PR #369 的 Node 22、Node 24、secrets 两组检查全部成功，已合并为 `4c0fd85b`。发布组合以正式 `c17fdbb` 为基线，只叠加本票提交，代码 `4bb4f8d`；组合四文件 140 项、typecheck、build、pack 通过。未用 main 包覆盖正式尚未合入的修复。

开发与正式均通过官方 profile 安装同一包，SHA-256 `45625f372eb011499a29a24664e34c2459271961c4c6dcddddc6893a9f550a38`；198 个 lib 文件逐字节匹配，profile 仅本插件依赖引用变化。独立 Supervisor helper 回执均 succeeded：开发 PID `2498926 → 1570388`，正式 `2529145 → 1610651`。开发重启期间正式 PID 保持。

目的：验证暂停及等待不再阻止维护接续，同时不恢复业务。

步骤与结果：

1. agent-browser 在正式原会话6复现“准备接续”禁用及“请先恢复处理”提示，相关执行已结算。
2. 开发实例在原暂停的 QA 会话点击修复后的“准备接续”，经真实模型保存材料，后继调用正式 received 工具。同一 Task/Execution/owner、epoch `1 → 2`、phase `received`，原 pause 控制及原因完全相同。没有调用业务 resume。
3. 正式升级后，原会话6按钮可用。点击创建操作 `abadbc11-5984-490d-9fbc-207b7b99478d`，准确交给原会话保存材料；固定后继 `session-f6e94427-8cee-4494-bbf7-b75d1d3bb720`。
4. 正式材料请求实际仍为 `codex/gpt-6.1-sol/high`，日志 seq2161。其后上游先返回 HTTP 524，再连续返回 HTTP 522，均无模型输出，seq2164–2183 留有重试证据。辅助访问同域首页返回200，仅证明首页可达，不代表模型请求成功。停止本次失败请求继续重试，没有切换提供商、重写材料、直接改账本或伪造接收。
5. 回读正式 Task/Execution/owner、specification 和原 wait 控制及原因保持，epoch仍6，phase为 `material-requested`，尚无新材料。因此按钮修复已交付，正式会话6→7完整接任仍被模型上游阻塞，不计验收通过。原业务 #184 未推进或标为完成。

完整中文记录、截图、原始回归、lib 比对及重启回执位于本机 `docs/artifacts/dsh-368-2026-11-08/`；私有生产截图及业务上下文不提交公开仓库。包、部署前备份及结构化证明在本机 `/data/_ssd2t/dsh/packages/issue368-session6-v1/`。

恢复条件：该原会话的 Codex 材料请求能正常返回。届时在原接续页点击“重试本次接续”，复用相同操作和后继，继续核实材料保存与 received；不要点击业务恢复绕过维护失败。Issue #368 保持 Open / Project In Progress，原会话完整接任未完成，最终关闭由 LF 执行。


## 正式原会话接续已完成（2026-11-08）

LF 要求继续修复后，复核发现原请求在上轮第六次重试之后已开始返回，但随后被停止，未执行保存；另 seq2166 持久记录了 DimAgent 选择，导致本次操作报 `continuation-profile-changed`。只读代码调查未找到自动切换路径，不能把该选择归因于目录加载。通过正式模型选择入口恢复原 `codex/gpt-6.1-sol/high`，seq2188 可核，然后重试原操作，未修改配置、账本或上游服务。此前 524/522 是真实失败记录，不因后来成功而删除；现有健康检查成功和真实请求返回已解除本次恢复前置，不扩大到迁移或改造上游。

正式验收结果：

- 原 Session `2d83a6c4` 的 seq2198 实际调用 `work_continuation_material`，seq2199 成功返回。材料正文 18144 字节，SHA-256 `2e11c9e11292c824cee2c7614c2b45f5561561b954378de3e789de19c556c2d7`；没有用摘要副本冒充源模型保存。
- 原固定后继 `session-f6e94427-8cee-4494-bbf7-b75d1d3bb720` 正式接任为“#184 · 会话7”，epoch `6 → 7`。
- 后继 seq23 实际调用 `work_continuation_received`，seq28 返回 `status=completed`、同操作 `abadbc11-5984-490d-9fbc-207b7b99478d` 和材料命令；工作库最终 phase=`received`，无接续错误。
- 结构化校验确认同 Task、Execution、owner、完整 specification、原 wait 控制及原因均保持；原业务验收没有被标为完成。
- 交接后的 seq33 出现真实人工“继续”，以及新的模型选择。这是原会话里的后续输入，不是修复方恢复业务；验收只将接收工具成功返回之前列为维护区间，未覆盖或撤销之后的人工操作。
- agent-browser 实际进入会话7并检查接续页，“后继已确认材料可读”可见；截图与结构化证明已保存。模型上游无需新增代码修改，原接续故障已完成实际恢复。

本机最终证据：`docs/artifacts/dsh-368-2026-11-08/prod-original-handoff-proof.json`、`prod-session7-received-visible.png` 以及原始源/后继日志。前一节“仍被上游阻塞”是第一阶段历史，已由本节正式成功验收替代。Issue #368 的 Project Status 更新为 Done；Issue 保持 Open，由 LF 最终关闭。
