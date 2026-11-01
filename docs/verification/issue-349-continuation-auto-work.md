# #349 接续维护结束后继续原任务

关联：[Issue #349](https://github.com/a2d2-dev/dsh-plugin/issues/349)。

## 目的

修复后继已收到交接材料却继续把维护轮的停止理解为业务暂停，以及新代继承旧代纠正预算后过早等待的问题。维护回执仍不允许同轮执行业务工具。

## 步骤与记录

1. 使用 `ExecutionFixtures.mount(..., ..., true)` 运行真实 AgentLoop、Inbox、JSONL 与正式文件工具。源先读取真实依赖，再两次只回复文字，实际消耗两次纠正预算，随后上下文观测触发自动接续。
2. 源保存材料，后继成功调用 `work_continuation_received` 后在同轮尝试 `work_control status`，工具门仍拒绝。材料还包含 Agent 将维护要求误写为“最新人工要求立即保存后停止”的历史摘要。
3. 在后继首个普通输入投递之前，先让旧 `agent-message` 领取下一轮，业务事件仍未到达。fixture 仅在模型真实收到“接续维护已结束”的宿主准入指示后调用正式 `write`、`read`，生成并读取 `auto-proof.txt`，内容与真实依赖 `READY-312` 一致，再提交验收报告。
4. 断言成功工具结果、实际文件内容、原任务接续到 epoch 2，进展指纹保留且纠正次数为 0，无 guard 等待。另测源预算已 exhausted 时显式换会话：新预算清零，原有等待控制保持且自动输入仍被拒绝。
5. 在已 received 的协调状态验证 pause、human wait、end、无槽位、退役源会话均不能获得业务准入指示。原有维护与连续队列相关组同时回归。

## 验证结果

- 真红：修复前回执与维护工具拒绝均成功，首个后继普通轮缺少明确执行指示，`wrote` 为 false。[red.log](../artifacts/continuation-auto-work-20261101/red.log)
- 主回归绿：实际文件写入、读取与验收通过。[green.log](../artifacts/continuation-auto-work-20261101/green.log)
- 相关四组：196 项通过，包含自动接续、未返回子执行、执行守卫与持续队列。[related.log](../artifacts/continuation-auto-work-20261101/related.log)
- 已接收状态的五项禁止准入边界：[protected.log](../artifacts/continuation-auto-work-20261101/protected.log)
- TypeScript 检查：[typecheck.log](../artifacts/continuation-auto-work-20261101/typecheck.log)

本提交未安装插件、重启服务或修改真实 Task。开发及正式实例的真实模型验收由集成阶段执行；这里的工具动作证据来自真实宿主测试链路，模型为根据收到的提示选择工具的确定性 fixture。

## 跨代消息生命周期补充

源会话先已取得当前接续回执，宿主生成的 `continuation-business:<operationId>` 仍在公开 Inbox 的 next-turn 中、没有 `user/message` 消费记录时，再次接续。修复前真实三代回归在 epoch 3 接任后断言失败：旧通知为 `accepted`，仍会继续搬运；这是语义红，非超时。修复后该旧通知为 `discarded` 且 `discardReason=superseded`，不进入第三代模型，也不伪造源会话的消费记录。

失效仅发生在接任事务，只匹配 `kind=input`、无 `nativeMessage`、ID 精确等于当前 execution 的 `continuationHistory` 中旧 operation 所生成的业务激活通知。人工输入、结果、其他来源和文本相似消息不会按文本匹配失效。已消费记录保持原状，原会话 journal 不修改；无需批量清理旧 Inbox，退役准入与 `discarded` 状态阻止它被再次搬运。

当前 operation 的激活在回执确认后排入待投事件，位置保留已有 pending 原生人工消息在前，仅优先于后续非人工通知。真实 AgentLoop 回归分别验证普通人工消息的多行内容和 source 完整保留，以及人工停止先进入模型、成功调用 pause、当前激活没有进入模型。通过公开 Task input 接口接收的 result 也保留原 kind 与多行载荷，没有冒充消费或验收。源模型编写的停止摘要与人工停止分别判断。

本轮新增日志仅保存在本地 `docs/artifacts/continuation-auto-work-20261101/`，不新增日志追踪：`message-red.log`、`message-green.log`、`message-related.log`、`message-protected.log`、`message-typecheck.log`。其中前三条精准回归全部通过；完整相关组、禁止准入边界与类型检查结果按对应日志核对。没有重复实现 schedule 合并，也没有取消源会话的其他输入。

## 已存在 received 会话的恢复

未来接任的失效规则还不足以处理升级前已经进入当前 Inbox 的旧激活。恢复流程现在先将准确旧 operation 的未消费 Task event 持久记为 `discarded/superseded`，再通过公开 `Inbox.remove` 取消当前会话中 ID、source 与完整内容均吻合的旧宿主信封并 flush。原 journal 不重写，不将取消写成消费；重复恢复没有新的取消记录。

为避免冷加载驱动先领取旧通知，原生 pre-step 在普通准入之前使用同一权威身份规则仅滤掉准确旧信封。同一步其余人工消息、自动输入和已接受结果完整保留，并继续原有准入与保存路径。若滤空发生在已经准入的业务 turn，仍允许后续工具步骤和最终答复；只有尚未准入、仅含旧激活的新 turn 被拒绝。

冷恢复回归从真实三代会话的持久化目录在停机前取得字节快照，再挂载全新的宿主。采用停机前快照是因为正常 fixture disposal 会原生取消全部 pending 输入，直接在 disposal 后挂载无法代表已有积压。回归确认旧 event 从 `delivered` 变为 `discarded/superseded`，当前激活、人工暂停和其他来源的完整原载荷保留，暂停控制不变，公开取消记录只移除旧 ID。另把旧激活、有效自动输入与 accepted result 放入同一 next-step 批次，确认其余输入与结果仍准确保存；已准入的同一人工 turn 两次成功正式文件读取之间插入旧激活，仍完成第二次读取与最终答复。

反证红还验证“滤空一律拒绝”的错误实现只能得到一次读取；最终实现保留已准入 turn，得到两次同 turn 的成功文件工具结果。对应本地证据为 `backlog-red.log`、`backlog-admitted-red.log`、`backlog-green.log`、`backlog-mixed-green.log`、`backlog-typecheck.log`，不新增日志追踪。未对真实 Task 或服务执行这些测试数据操作。

## 与提醒队列修复的集成

保留 #348 已安装的重复提醒合并和人工输入恢复。提醒替换队首之后，再经过同一权威旧接续控制过滤；过滤掉已领取旧控制时，先处理待处理人工输入，再让有效原始信封沿普通业务准入继续。没有有效输入的新轮才拒绝，已准入轮次的工具结果与最终答复仍能完成。

集成回归先证明两项真实失败：直接拒绝空队首会搁住后面的人工/自动输入；在提醒替换前过滤会让旧控制绕过校验。修复后精确冷恢复、跨代失效、人工停止、有效自动输入、提醒替换共 8 项通过，typecheck 退出 0；此前组合相关 104 项通过。日志保存在本机 `docs/artifacts/continuation-auto-work-20261101/`，不进入 Git。指定开发实例真实模型验证仍由主协调完成。
