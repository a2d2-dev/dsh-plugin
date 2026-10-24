# #214 Global 会话一秒空轮修复与验收

## 目的

停止 Global 工作区“分析错误发生的原因”会话反复出现“已完成，用时 1 秒”，保留原会话、Task 身份、Goal 暂停状态及已有历史。

## 根因与修改

Task 调度拒绝消息时，把 DSH Goal 驱动拥有的续跑消息保存成了待投递的 Task 输入。Goal 已暂停且版本由 1 变为 2 后，Task 恢复仍按旧消息的消费回执反复重放第 1 轮。Goal 驱动因预约/版本失效拒绝，产生 blocked 空轮；模型未收到这些输入，Task 记录却一直未消费。

现场最初捕获 61 个没有 user/message、request/header 的 blocked 空轮；等待诊断与构建期间仍在增长。部署前页面达到 276 条一秒记录，替换生效后固定为 280 条，原生总轮数固定为 286。

修复不再捕获或跨会话迁移 Goal 消息。恢复时把旧的未消费 Goal 事件持久化为 discarded，保留原消息，界面显示“已废弃 · 未验收”。调度、恢复和交接把 consumed 与 discarded 都作为投递终态，二者不互相冒充。

## 步骤与记录

1. 通过 agent-browser 打开现有 DSH 页面，选中原会话，捕获连续无正文的一秒记录。
2. 解码原会话日志，检查反复投递的同一消息及 Goal pause 版本。记录标识为 `ed4dcdcc-d4ab-4b11-aab4-27b28e75183c`，来源为 Goal revision 1、round 1。
3. 在部署版本 92a81be 上建立独立工作树，用真实 AgentLoop、Session 持久化与 WorkApplication 写回归测试。修复前：等待状态错误捕获 Goal 消息；三次 reconcile 产生三个新空轮。修复后：不捕获 Goal，accepted/delivered 两种旧事件均废弃，人工输入仍能进入模型。
4. 相关执行、交接、持续处理、显示合同与新回归共 47 项通过。合入最新 release/v0.0.22 基线后，新增回归及来源身份保护再跑 4 项通过。`pnpm typecheck` 和 `pnpm build` 均通过。
5. 把提交 `7ad99e9ca1f0f40c5e2e10df125b52f98b9fbdc3` 构建部署到现有 Web profile，禁用前一 work 插件挂载并启用新挂载；保留配置与客户端备份。未重启服务、未启动新实例、未修改 DSH 源码。
6. 通过现有浏览器认证接口回读原 Task：旧 Goal 事件由 delivered 变为 discarded。原 Task、执行 ID、owner、epoch、session、ready 状态保持一致。
7. 连续观察约 25 秒，跨越至少 12 个恢复间隔：turns 始终为 286，日志最后 seq 始终为 3108，Goal 始终 paused。
8. 刷新原页面并在 A²D² 控制面板进入原 Issue 的“会话与执行”，确认旧 Goal 输入显示“已废弃 · 未验收”，原会话显示空闲，第 286 次 turn 为已阻塞。返回原对话后仍为 280 条历史一秒记录，未增加。

## 验收证据

- [原始页面截图](before.png)
- [原 Issue 显示已废弃 Goal 输入](discarded-visible.png)
- [返回原会话后的页面](after.png)
- [连续观察记录](live-observation.json)
- [47 项针对性检查输出](tests.log)

现场会话为 `session-2c4aa995-7351-41fa-bbab-4a80d08eb364`；原执行 ID 为 `de7ef713-ce01-4e78-ac3c-f9cc1d6ae4c5`。原 Task 与业务 Issue 保持未完成，未发送业务消息、未恢复 Goal、未代为推进原部署工作。

## 限制与已有失败

已有一秒空轮属于会话历史，保留原记录；本次修复停止新增。原生聊天把 blocked 空轮显示成 Completed 的展示行为未修改。

额外检查 tests/client/work-completed-status.spec.ts 有 2 项失败，分别断言旧“查看记录”文案和旧来源概览布局。在未修改的 92a81be 部署基线单独复跑，得到完全相同的失败；未把这些已有 UI 断言问题混入本次修复。

新增 discarded 是插件 Task 事件投递状态，不改变 DSH Session 事件格式。旧插件的 schema 不识别该状态；仅还原插件配置不足以回退，回退前需要兼容迁移并保留当前记录，不能把废弃伪写成 consumed。
