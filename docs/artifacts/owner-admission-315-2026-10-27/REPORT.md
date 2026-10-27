# #315 当前主会话消息准入回归

## 目的

验证等待中的当前主会话可以观察消息及恢复原授权，自动消息排在人工消息前面不会封住对话；暂停、完成、接任归属与准确维护边界保留。

## 步骤与记录

1. 安装仓库锁定依赖，运行真实 DSH Agent、AgentLoop、durable Inbox 与 JSONL 的确定性测试。
2. 在 Inbox 的 next-turn 队列依次放入 schedule、旧接续 dispatch 和两条人工消息，用真实 Agent.followup 启动驱动。修改前 wait/pause 两例均未消费任何人工消息，详见 red.log；修改后两例均消费两条原始人工消息各一次，等待例同时消费普通自动输入各一次，详见 green-inbox.log。
3. 原外部等待中更改实际依赖文件，只发送 schedule。模型调用真实 read、work_control resume、write，产出 schedule-proof.txt。Task、Session、owner、epoch 保留；三次 reconcile 不新增请求或重复事件。
4. 已让出持续槽位的等待项允许观察 schedule，另一任务继续占槽；观察不设置 resumeRequested，也不复制为 Task 事件。随后显式 resume 仍需等待有序调度。
5. 真实接任后向退役会话放入 Goal 与人工输入，人工输入得到回应，旧会话 work_control progress 被拒绝。已完成任务的提醒不进入模型，后方人工输入可对话，但 work_control resume 返回 task-completed。
6. 暂停例保留 state/control，既有准确维护范围、Goal 生命周期事件不复制为 Task 输入及端到端接续回归通过。

## 已验证结果

- 5 个相关测试文件共 191 项通过：regression-final.log。
- TypeScript 前后端类型检查通过：typecheck-final.log。
- git diff --check 通过。
- 本报告记录确定性真实宿主回归；正式 DSH 现有入口的实际供应商验证、部署及 #184 原会话由主会话负责，本实施分支没有修改现场运行数据或服务。

## 变更边界

等待中的当前 owner 可观察普通输入，消息不自动解除控制或获取槽位。暂停、完成、结束及非当前会话仍阻止自动驱动；若自动消息后已有人工输入，adapter 使用公开 Inbox.remove 将人工原始消息送入本次对话，原自动输入沿用现有 Task 或生产者恢复。没有新增定时器、Goal、状态机或统一宿主工具限制。
