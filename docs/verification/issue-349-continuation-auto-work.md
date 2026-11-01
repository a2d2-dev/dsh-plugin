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
