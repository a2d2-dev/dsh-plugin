# #299 / #300 宿主观察恢复验证

## 目的

验证恢复循环不会早于真实会话观察服务就绪；遗留观察失败能够按原执行身份恢复，实际运行主会话恢复为处理中，且不启动重复执行、不清除真正业务阻碍。

## 根因

`src/work-plugin.ts:60` 原先仅等待 agents/sessionController。实际路径为 reconcileControls → reconcileContinuous → observeRuntimeFailure → DshWorkExecutionHost.failure（`src/work-execution/dsh-host.ts:109`）→ RuntimeHost.events（`src/task-runtime/host.ts:65`），直接访问当时尚不存在的 sessionQuery。该服务晚到时，已持久化 recoveryBlocked 又阻止重新观察；运行主会话的早返回也不修正队列状态。

## 步骤与记录

1. 修改测试，保留原实现，执行：`pnpm exec vitest run tests/work-host.spec.ts tests/work-continuous.spec.ts -t 'sessionQuery|actual session query'`。三个确定性失败，原始输出见 recovery-red.log。生产 Cordis injection 在 query 缺失时已启动；通过实际 DshWorkExecutionHost.failure、SessionStore、JSONL 持久化和随后加载的真正 SessionQuery，空闲/运行两例仍保留旧错误。
2. 增加最小服务就绪条件和准确遗留错误恢复，再执行相关套件：`pnpm exec vitest run tests/work-host.spec.ts tests/work-continuous.spec.ts tests/work-continuous-integration.spec.ts tests/work-execution.spec.ts`。4 文件、126 测试全部通过，见 recovery-green.log。覆盖等待、人工暂停、持久化真实模型错误、历史/无关会话运行，以及原有未知创建/结算结果需明确恢复的测试。
3. 新的真实组合用例在正式 DSH Agent 中执行挂起工具；持久化遗留保护后执行 reconcileContinuous，确认仍为相同 Agent、Task、Execution、Session、owner、epoch、模型、权限；队列恢复 active、保留唯一槽位，工具未被中断、无新增模型请求、未导入第二 Task。工具实际返回后，原执行按正常空闲状态结算。
4. 执行 `pnpm typecheck`，服务端和客户端 TypeScript 检查通过，见 recovery-typecheck.log；`git diff --check` 通过。

## 行为边界与未验收项

自动恢复只识别本次已复现的准确 undefined.observeSession 保护，先成功读取当前绑定会话的正式日志，再以 ExecutionId、epoch、Session 和保留槽位复核。其他未知宿主结果沿用明确 task.reconcile / task.control resume 路径。已有错误、业务等待、暂停和真实模型失败独立保留；空闲无新输入只安全让槽，不发送续跑消息。

本工作树没有改动生产状态、重启、部署或发送业务消息。正式 3080 页面验收由主会话集成后完成，当前未验证。与 #301 合并时，end 优先处理分支必须位于本次遗留恢复之前，并通过正常类型条件保留 ended/已应用 end，不恢复为 active。#140 未合并改动由主会话另行保留。
