# Issue #265 持续委托单队列验收记录

原始工作：[GitHub #265](https://github.com/a2d2-dev/dsh-plugin/issues/265)；交付 PR：[#271](https://github.com/a2d2-dev/dsh-plugin/pull/271)。基线 `97facf1821229fb240401e2892fa481d871a787e`，核心实现提交 `618629d`。已认可原型固定于 `95e75c9c0497a8ce6a0ce1a822eb2f311515d333`。原型数据不作为产品执行成功证据。

## 检查目的与步骤

验证当前 Project 的唯一队列、只更新等待部分、安全并发收口和已有 Task／会话导航。先运行应用与真实 DSH Session 集成回归，再在原 GUI 使用现有数据点验，最后比较更新前后的真实工作身份。没有新增替代应用服务器，没有模拟 GUI 接口或启用全部现有待办任务。

1. 从 fetch 后的 main 建立隔离实施工作树，未复制旧设计分支的未验证应用草稿。
2. 独立复核并修复等待冲突项反复入队造成饥饿、预留会话误跳转、暂停队列阻断显式 Task 恢复、入队前问题失去 canonical 完成观察等缺陷。
3. 主会话最终前后端 typecheck、六个整合测试文件 **88/88 通过**：队列56、真实DSH Session集成2、表单8、持续委托控制器3、导航16、渲染3。窄屏呈现收尾后，客户端 typecheck 与表单/导航 **24/24 复跑通过**。
4. 构建、仓库校验通过。从干净 HEAD 导出后执行 prepack，tarball 包含32个导出目标和元数据；安装后15个Node入口全部导入通过。初次未提交时包校验按约定拒绝，提交后通过。
5. 使用 `agent-browser` CLI 在同一 DSH GUI 点验。用户入口为 [当前 GUI](http://10.126.126.12:3080)，浏览器内部使用该实例的回环地址。保存1440×1000桌面、390×844窄屏和设置操作截图，逐张查看。

## 实际运行记录

- 原宿主始终为 `dsh-web-server`，PID `749243`；未重启服务。HMR查询确认候选 `a2d2-work-265-618629d` 为 active，原 work-plugin 已 disabled（宿主仍显示 unloading，等待旧上下文清理）。当前Task协调会话和epoch2保持不变。
- 候选后端位于当前profile的固定版本release目录；客户端已显式重建、复制并刷新。最终构建与实际profile的client.js SHA256一致：`85a0d2db9a19c7626989310e28298e15d585a14b1a2905dbda4f2bd2883fc82f`。另一检出的watcher不被当作本次更新证据。
- 热替换前后：同一个队列 `ad80d1c4-c318-4df2-abde-f67b06a7780c`、同一设置版本、原暂停状态、原active引用、已保存委托/计划/排除项保持；37个原条目全部保留，执行身份变更0，原人工问题摘要保持。
- 显式更新后回读：HTTP200 / completed；37个原条目仍全部存在，现有38项，同队列/设置版本/启停/active引用保持，原问题和ExecutionId保留。新增来源观察与canonical已验收结果进入同一视图，没有第二个列表。
- 真实#138 Task按钮打开已有详情，当前会话入口进入原 `#138 · 会话1`；历史#211进入已有Task的“会话”页。返回原队列可继续操作；没有另造详情抽屉或纠偏表单。
- 从DSH A²D² Project切到单独仓库来源时，显示该Project“尚未配置”的空队列；原Project的队列没有串入。仓库导航保持“概览／Issue／PR／持续委托”，Project导航另含“项目”。切回原Project后数据保持。
- 原生HAR脱敏统计：只读交互131个工作请求均为query，其中包含真实task.detail与source.execution-options；command=0、session/prompt=0。单独的显式更新记录恰好1个continuous.refresh、HTTP200，session/prompt=0。早期在加载后替换fetch的观察没有覆盖客户端预绑定fetch，已弃用；以原生HAR统计和独立持久状态回读为证据。
- 窄屏检查：viewport=390、body.scrollWidth=390，队列面板1个，按钮/输入/select/table横向溢出0；设置保存与取消按钮可滚动到达且无遮挡。查看设置后取消，没有保存/启用真实项目的新授权。既有#138问题作为人工项保留，不将此票解释为自动修复该任务。

## 对应验收

| # | 验收内容 | 证据 |
|---|---|---|
| 1 | PR之后常驻页签，内容仅在该页 | 真实导航、概览队列面板0／委托页1；生产组件回归 |
| 2 | 每Project唯一队列与设置、同容器筛选 | 持久Project唯一配置及迁移回归；真实同队列ID与筛选 |
| 3 | 手动/周期/保存只重算等待 | 应用三路径回归；真实显式刷新前后身份比较 |
| 4 | 新候选加入、移出不删Task、完成不重跑 | 来源/等待刷新、canonical完成观察回归；真实38项回读 |
| 5 | 有序并发、安全补位、暂停及降并发 | 持久slots、完成未收口占位、并发与显式恢复回归；原生Session集成 |
| 6 | Project/来源清楚，展示不改授权 | 实际跨Project/仓库切换、空队列隔离、原生HAR查询统计 |
| 7 | 复用Task、当前会话、历史入口 | #138详情与原会话、#211已有会话页；预留/过期导航回归 |
| 8 | 问题保留、人工处理后同步、不自动纠偏重试 | 真实原问题摘要/ExecutionId保留；显式恢复/canonical完成回归 |
| 9 | 菜单进入同一页签 | 实际菜单快捷入口及生产组件回归 |
| 10 | 浏览不启动、不改设置，原执行合同保持 | 原生HAR 131查询、0命令/模型输入；权限/接续/验收回归 |
| 11 | 旧配置、执行、历史与操作保持 | 37项原数据、旧委托/排除项及原active保持；多来源迁移回归；文档更新 |
| 12 | 当前GUI真实接线，桌面及390px | 桌面/窄屏/设置截图，布局测量、实际Task/会话导航 |

## 证据位置与边界

本地忽略目录 `docs/artifacts/issue-265-2026-10-26/`：

- `before-desktop.png`、`queue-desktop.png`、`queue-mobile.png`、`settings-mobile.png`、`settings-mobile-actions.png`。
- `before-queue.json`、`after-queue.json`、`refreshed-queue.json`、`refresh-audit.json`。
- `readonly-navigation-audit.json`、`refresh-request-audit.json`、`runtime-activation.json`。

原始HAR和profile备份保留在私有目录，不提交或公开凭据。GUI验证使用真实现有队列，保持原暂停状态；并发/周期/故障等确定性场景由真实应用和宿主集成回归覆盖，没有为验收擅自启动现有大量工作。Issue保持Open，关闭仍由LF决定。
