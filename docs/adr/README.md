# A²D² v3 当前架构决策

以下 11 项是当前目标决策。它们已按 LF 确认的 v3 领域方向与 DSH 内控制面板原型逐份核查；冲突正文已直接替换，未保留另一套并列的旧规范。目标契约不等于全部产品能力已实现，代码覆盖见[实现能力核查](../architecture/a2d2-v3-implementation-evidence.md)。

| 编号 | 当前决策 |
| --- | --- |
| 0001 | [依托 DSH，以单入口连接工作与会话](0001-a2d2-plugin-is-the-single-carrier-on-dsh.md) |
| 0002 | [业务身份独立于平台、目录和会话](0002-goal-layer-and-execution-layer.md) |
| 0003 | [工作事实以主存为准，现阶段 GitHub 为主存、本地为缓存](0003-work-facts-follow-the-primary-store.md) |
| 0004 | [项目 Agent 与角色模板](0004-project-agents-and-role-templates.md) |
| 0005 | [工作要求、执行资源与后端能力](0005-execution-context-and-provider-capabilities.md) |
| 0006 | [领域规则、方法和观察各有来源](0006-each-piece-of-knowledge-lives-in-one-place.md) |
| 0007 | [显式意图与有范围的自动化](0007-humans-decide-the-machine-prepares.md) |
| 0008 | [可选咨询与事实查询分开](0008-next-step-consult-is-an-out-of-history-generation.md) |
| 0009 | [默认配置、项目策略与有效快照](0009-a2d2-settings-live-in-a-settings-namespace-with-own-page.md) |
| 0010 | [通知语义与可选投递服务](0010-a2d2-decides-when-lf-is-needed-a-notifier-delivers.md) |
| 0011 | [Task 协调权、接续、队列与恢复](0011-explicit-task-runtime-owns-execution-and-recovery.md) |

0003、0004、0005 保留编号但改用符合当前语义的文件名，旧文件已移除。历史内容可通过 Git 追溯；历史评审稿的固定提交链接仍指向它们实际讨论的时点。
