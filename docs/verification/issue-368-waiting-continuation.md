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
