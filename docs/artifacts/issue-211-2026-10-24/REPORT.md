# Issue #211 合并、在线部署与实际页面验收

## 目标与结果

继续完成 [Issue #211](https://github.com/a2d2-dev/dsh-plugin/issues/211) 的交付，使已实现的任务会话命名在当前运行页面实际生效，并更新 [DSH A²D² Project](https://github.com/orgs/a2d2-dev/projects/1) 的原生状态。此前“只开 PR、不合并部署”的收口不再作为当前约定。

**结果：代码已合并，命名已在线加载，当前真实会话及既有接续历史的名称已自动修复，整页刷新后仍保持。** 宿主 PID 一直为 `3451716`，没有重启进程、恢复数据快照或重建现有执行对象。

## 合并与保留的修复

| 对象 | 结果 |
| --- | --- |
| [PR #213](https://github.com/a2d2-dev/dsh-plugin/pull/213) | 合入现行集成分支，merge `e6fbcf35e2ff319ef9107b545aeddd40a2241649` |
| [PR #221](https://github.com/a2d2-dev/dsh-plugin/pull/221) | 将命名整合到最新发布分支，merge `67dfaaef063a304286174935ce046874bcdbc2ee` |
| [PR #222](https://github.com/a2d2-dev/dsh-plugin/pull/222) | 增加不替换执行宿主的在线命名入口，merge `f78404dd312b80c4a06f75a41ed9a5e54fbc84c8` |

发布整合以已包含 #139、#214、#217 修复的分支为基础。冲突解决保留了人工对话、Goal 输入废弃和接续首条上下文行为。用户排除的旧版独立 `/handoff take` 登记路径保持原有行为；交接文档文件名没有改动。

## 运行期问题与处理

第一次只修改现有 Loader 条目的模块路径后，管理列表已显示新路径，但实际工作服务对象仍没有新的命名能力。临时只读观测确认 `host` 仍只有 `ctx/runtimeId/execution`，没有 `nameSession`，且不存在新的标题队列。不能据此把配置变化当作部署成功。

为保留当前人工轮次和既有授权，增加正式可选入口 `@a2d2/dsh-a2d2/session-title-live`：仅为缺少命名能力的现有宿主接入标题元数据，在原 `ensure` 返回前写入名字，在成功绑定后维护名字，并修复历史标题。执行宿主、权限回调、owner 和 epoch 不替换；具备原生命名能力的完整新宿主会让该入口直接退出。

在线入口源提交为 `c6b06a3`；部署入口 SHA-256 为 `21cfbe6b87879e66e76db57b6df7aa3b5771f1bb19e932ebdac07b339ffc522e`。原模块与私有配置备份保留作回滚；临时诊断插件已撤回，临时模块已删除。没有将配置、凭据或完整运行上下文提交到报告。

## 验收步骤与记录

1. 使用 `agent-browser` 访问当前实例已有 HTTPS 入口，登录并选择真实会话 `session-6d3435f0-9413-403e-8542-faf9a36a8570`。该域名通过既有 Caddy 反向代理指向同一个 PID 的3080监听，没有另起验收服务。
2. 记录原名称“忽略旧版交接登记路径”，加载已合并、已测试的在线命名入口。
3. 观察同一会话自动显示 `#211 · 会话 1 · 会话命名：关联任务并携带阶梯/序列编号，`。同一列表中，原 #137 的两条会话也分别显示真实的“会话 1”和“会话 2”。
4. 整页刷新，再从相同 Session ID 打开，名称继续保持；没有发送会话消息、创建假任务或手工替换 DOM 来制造结果。
5. 正式只读会话投影 API 辅助核验三条真实名称，逐条与已有 Task/Execution 关系计算的预期比较：#211为78字节，#137两条均77字节，均不超过80。投影读取没有激活 Agent。
6. 回读 Task/Execution 身份：仍为8项 Task、8项执行、12条关联处理/历史会话；当前 Task 的执行 ID、owner、epoch及Session引用保持原值。没有通过改名获取协调权或恢复已完成任务。

页面证据：

- [修复前：原任务会话](before-current-session.png)
- [修复后：当前会话与既有接续序列](after-current-session.png)
- [整页刷新后仍保持](after-reload-current-session.png)
- [实际标题投影及模块 active 状态](live-projections.json)
- [真实关系派生的名称预期](expected-live-titles.json)
- [宿主状态与未变化的PID](runtime-status.txt)

## 自动化验证

- 9个针对性文件 **73项测试通过**，包含在线入口创建前写名、冷绑定不启动模型、保留同一执行宿主、已有原生命名能力时不重复接入；另覆盖命名、两次真实接续与丢回执恢复、人工消息、Goal输入及生命周期边界。[原始输出](regressions.txt)
- 在线入口的两项标题缺失用例先实际失败、再通过；类型检查通过。
- 从干净已提交源码 `c6b06a3` 打包安装：32个显式导出目标与bundle sidecars完整，**15个公开Node入口可导入**。[包验证输出](pack-check.txt)
- 本轮没有重新宣称全仓全量绿色；[上一轮报告](../issue-211-2026-10-23/REPORT.md) 中的全量基线限制是历史测试记录。本轮以发布整合后的专项回归和当前实例实际页面作为交付证据。

## 工作状态与关单状态

Issue关联的正确Project为 [DSH A²D² #1](https://github.com/orgs/a2d2-dev/projects/1)。实际处理期间已将Status改为`In Progress`并回读；完成上述部署与验收后，按项目未另行定义时的原生规则改为 **`Done`** 并回读。

[状态回读](project-status.json) 保留 `Status=Done` 与 `Issue=OPEN`。**工作已完成，Issue仍为Open，最终关闭由LF完成。**
