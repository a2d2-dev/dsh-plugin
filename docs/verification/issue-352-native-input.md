# #352 原生消息与接续收集验证

## 目的

移除 Task 调度在消息入口的硬拒绝，核实模型实际收到完整消息，且 Task 的暂停、等待、owner、epoch 和独立写入权限不因送达改变。修复 #184 固定接续操作对运行中作业和同名历史作业的错误收集判断。

## 步骤与记录

使用 Node 22 和仓库锁定依赖，在隔离 worktree 执行真实 AgentLoop/Inbox 测试，不启动或重启服务。

1. 修改前运行 `pnpm exec vitest run tests/work-execution.spec.ts tests/work-continuation.spec.ts -t 'delivers every native source|waits for a running exact-owner'`。3 项红灯：wait、pause 中 schedule 消息没有到模型；live/running 作业产生 `continuation-collection-unavailable`。证据 `docs/artifacts/continuation184-2026-11-01/issue352-red.log`。
2. 在公开 observation 接缝放入同 owner、同作业号的历史 completed/history/delivered 行和当前 running → killed/live/pending 行。修复等待语义后仍不能发出收集请求，证明裸作业号首行查找错误。红灯 `issue352-collision-red.log`。
3. 修改消息入口，只用调度结果观察或唤醒，不拒收、不丢弃混合消息、不将原生消息另复制成 Task 待投递输入。保留 #348 的提醒合并和人工缓冲恢复。
4. 消息矩阵覆盖 user、schedule、tool-jobs、subagent-settled、GitHub watch、dispatch、任意维护标记，在 wait、pause 和退休会话中逐项检查真实模型请求与原生 user/message 日志。断言每条只消费一次，owner、epoch、当前会话和暂停原因不变；退休协调写入仍拒绝，接续中的规格和验收写入仍由原命令边界拒绝。
5. 真正持久维护请求仍拒绝不属于该步骤的工具。任意标记照常送达，但不能获得维护资格。原生子会话通知与同批普通输入均进入模型，不再按 settle 白名单删消息。
6. 收集测试选择当前 live 行保存准确 registryEpoch/instanceId，running/stopping 时不请求收集；terminal/pending 时沿同 operation/successor 请求准确 owner 收集。已有材料刷新、正式交付和读取凭据测试继续验证结果屏障。

最终定向绿灯 `issue352-guard-continuation-green.log`：2 文件 79 项通过。复用生产代码未再改变时的五个通过文件（执行、连续处理、连续处理集成、执行边界、生命周期）共 179 项，见 `issue352-affected-policy-red.log`；该日志中的两个失败文件为本次已更新并重新通过的旧策略断言。合计 7 文件 258 项通过。`issue352-typecheck-green.log` 退出 0。未重复全套，集成后的全套检查由主会话负责。指定开发实例真实模型、页面及正式 #184 恢复由主会话协调执行，此隔离代码验证不代替上线验收。

## 已核实限制

额外尝试使用锁定的 `dsh-jobs-local@0.2.0-rc.2` 做真实作业收集全链路。该依赖生成 ordinal 作业号，未提供正式 `jobs.observe`，宿主正确返回 `job-observation-unavailable` 与 `job-result-unknown`，不能提供本次正式交付证明。未增加 shim、fallback 或伪造回执。此范围使用公开 observation 接缝验证同名实例选择，真实交付保留给具备正式观察能力的指定实例。失败记录 `issue352-native-job-unavailable.log`。

原生 fork 与受管接续分别成立：复制历史不会自动取得 Task 当前协调身份，不按标题收养 fork。现场 clone 的身份及用户停止意图由主会话单独核实和恢复，接续后仍须保留暂停。

## 与 #348/#349 的独立组合候选

本节记录基于 `53cb616` 整合 `2a26b53` 的独立候选，分支 `fix/session-recovery-20261101`。保留 #348 提醒合并、人工缓冲，以及 #349 当前代业务指示、旧激活身份过滤、冷恢复和维护轮工具限制。`WorkAdmission` 保留 business variant，只有含 `step` 的对象可进入维护工具域；业务指示不能被误当维护资格。

目的：证明原生消息送达与业务授权分离后，交接、结果读取和完成门仍成立。

步骤与记录：使用 Node 22、已有锁定依赖和真实 AgentLoop/Inbox/JSONL 执行七组相关测试。首轮 `related.log` 为 269 通过、7 失败。四个失败揭示真实组合缺陷：退休 parent 现在可以消费原生子结果通知，原判断会因此放行尚未由当前协调正式读取的 carried child 结果。修正公开观察：交接记录携带的子执行必须有当前 epoch 的完整正式读取，既有真实 replacement 绑定继续生效。原生 parent 的消费事实保留，不伪造后继 receipt。另三项是 #349 旧的“暂停时不送模型／另存待重放输入”断言，改为核实原始消息完整送达一次、控制保留且不复制原生输入。

结果：首轮未改的执行、控制恢复、持续队列、持续队列集成四组共 183 项通过。最终组合三组 93 项中 92 项通过，首项真实三代子会话测试超过默认 5 秒；它此前在产品修正后已通过。给该测试与同文件其余宿主测试一致的 20 秒总预算，不改变内部等待条件，定向重跑 1 项通过。复用未改变代码的有效检查，合计七组 276 项通过；保留原超时日志。覆盖真实暂停消息矩阵、准确维护工具、业务指示后真实文件写入、live 作业实例、跨代子结果正式读取、旧激活冷恢复。TypeScript 检查退出 0。日志位于本机 `docs/artifacts/session-recovery-20261101/`：`related.log` 保留初始失败，`combined-final.log` 为最终三组记录，`native-child-green.log` 为超时单项的重跑，`typecheck-final-green.log` 为类型检查。不重复全套；日志按仓库规则仅本机保存。

现场限制：主会话另已确认 #184 源会话在发生阻塞时位于宿主 `workspace.json` 的 `global.archivedSessionIds` 中，DSH core 的 archived-session gate 会拒绝归档会话及其后代。#352 不修改该门，也不能被称为现场循环解除的前提。本候选未安装、未重启、未修改正式 Task；真实模型与指定开发页面验收未在本分支执行，现场恢复由主会话负责。
