# Issue #265 持续委托单队列验收记录

原始工作：[GitHub #265](https://github.com/a2d2-dev/dsh-plugin/issues/265)。实施基线 `97facf1821229fb240401e2892fa481d871a787e`，工作分支 `feat/265-single-queue`。已认可原型固定于 `95e75c9c0497a8ce6a0ce1a822eb2f311515d333`。本记录不把原型演示或构建成功当作真实执行验收。

## 目的与范围

验证独立页签和当前 Project 唯一持续队列：等待刷新保留原 Task／Execution／Session、历史和人工问题；按持久槽位与安全收口控制并发；显示筛选和导航不改变授权或启动任务。Task、处理会话、历史会话复用已有入口。

## 已执行检查

- 独立工作树从已 fetch 的最新 main 创建，未复制旧设计工作树的应用草稿。
- 客户端与后端类型检查通过。
- 整合运行 `tests/work-continuous.spec.ts`、`tests/work-continuous-integration.spec.ts`、`tests/work-panel-form.spec.ts`、`tests/continuous-client.spec.ts`、`tests/client/work-panel.spec.ts`、`tests/client/work-panel-render.spec.ts`，当时 79 项通过。后续审查修正仍需最终重跑，不将旧结果用于新增改动。
- 构建和 `verify:repository` 通过。`verify:pack-exports` 拒绝未提交工作树；其要求验证将被打包的 committed HEAD，待候选提交后执行。
- 审查修正后重新运行完整前后端类型检查及上述六个测试文件，**88/88 通过**（队列56、真实DSH Session集成2、表单8、持续委托控制器3、导航16、渲染3），`git diff --check` 通过。

## 独立复核与修正

1. 原等待刷新把资源/所有权冲突项重新置为 queued。两个较早冲突项可能交替占据队首，后面的合法工作永远不被选到。已改为保留协调等待与问题，仅恢复明确因范围/旧计划排除的候选，新增真实应用回归。
2. 队列会话跳转最初直接取预留 session。已复用既有 `enterTask`／`openCurrentTask`，验证实际创建、Task 身份和宿主关联；不隐式 reconcile 或创建会话。
3. 暂停队列后的单 Task 显式恢复已用持久显式恢复意图区分普通输入／结果，恢复仍受并发限制，不启用其他等待项。入队前被拒项目保留独立的只读 canonical Task 引用与原来源，已有 Task 完成后同步历史，不取得外部执行权。
4. 已核对宿主只读 `pluginManager/listPlugins` 回执：HMR 与原 work-plugin 的 `fiberPhase` 均为 `active`。配置热更新可用于候选插件替换；客户端仍需显式重建和刷新页面，不能依赖来自另一检出的 watcher。

## 实际 GUI 观察

使用 `agent-browser` CLI 操作原有 DSH GUI；对用户入口是 `http://10.126.126.12:3080`，浏览器内部使用同一实例的回环地址。没有启动替代应用服务器。

修改前 GUI 仍为四项导航，菜单打开的持续委托框插入“概览”内容。实际队列保存旧计划与 #138 问题摘要；来源页签切换没有应用新代码。桌面对照截图保存于忽略目录 `docs/artifacts/issue-265-2026-10-26/before-desktop.png`。

已核对当前宿主位于 `v4-141-release-8282d612` 检出，已安装插件来源为 main `97facf1` 包。现有 `dev:web` watcher 来自另一检出，不能声称本工作树变化会自动热更新。

## 尚未完成的验收

最终候选提交与包验证、当前 GUI 的实际更新、真实队列设置/刷新/导航观察、390px 窄窗口布局及截图、完整十二项功能逐条收口均未完成。Issue 保持 Open，不据此标记 Done。
