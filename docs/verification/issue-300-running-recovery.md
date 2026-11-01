# #300 当前主会话运行后同步持续委托状态

## 目的与范围

当前主会话有真实工具进展时，持续委托应同步处理计数和实际占用，清除已被事实推翻的历史错误。仅修复 DSH 协调状态，不接管 #3073 日志/S3 业务；真实错误、业务等待、用户停止分别保留。原始要求见 [Issue #300](https://github.com/a2d2-dev/dsh-plugin/issues/300)。

## 根因与失败证据

在主干 `0856717` 上，以真实 DSH AgentLoop、SessionQuery、持久会话及正在执行的工具复现，外部模型输出受控：

1. 调度只遍历既有 slots，漏掉槽位遗失但仍运行的当前主会话。
2. running 路径直接跳过，仅准确旧 observeSession 错误有恢复例外，其他 interrupted/idle 保护未重算。
3. failure 仅取最后 turn/end，忽略更新的 turn/start，继续返回上一轮错误。

```sh
pnpm exec vitest run tests/work-continuous-integration.spec.ts -t 'reconciles historical protection'
```

该实际路径先出现 1 失败、1 通过，扩展缺槽位及真实旧失败新轮次后为 4 失败、1 通过。失败命中队列仍 blocked 或 runtimeFailure 仍为旧错误，非单纯“命令没有报错”的检查。

## 最终行为与独立复核

在调度锁内记录当前绑定执行的真实运行身份，并先恢复占用再调度。运行事实绑定 ExecutionId、owner、epoch、准确 Session；异步观察提交再次核对。扫描后、逐项读取前或 failure 观察期间自然结束，仍沿用本轮身份匹配的运行观察，由普通 idle 路径重读最终结果并安全结算。

只淘汰已有成功事实推翻的旧 model-turn、idle 和 observeSession 错误。独立审查发现的停止与收尾漏项已补真实失败回归并修正：

- 原生 Stop 后仅问状态，不确认用户取消，也不重新取得业务槽位；人工对话仍正常，关闭自动纠正也继续保存取消事实。已有占用保留到安全收尾。
- Stop 尚未落盘时首次明确 reconcile、resume 或业务 input，会在写锁外观察准确主会话，再按现有确认语义接受。错误身份、历史调用者、观察失败和读取中变更均不假报成功；原 commandId 重放不确认后来的新 Stop。
- 恢复当前运行占用后，另一个旧槽位的 pending 输入不能越过并发 1；相关工具结束后才释放并轮转。

保留真实执行/接续/runtime 错误、未知创建结果、wait/pause/end；不以历史、子会话或无关会话运行作为恢复证明。没有增加持久状态或恢复 token。

## 自动化检查记录

最终整合源码 `e05731a` 的类型检查及以下 9 文件、253 项检查通过：

```sh
pnpm typecheck
pnpm exec vitest run tests/work-continuous.spec.ts tests/work-continuous-integration.spec.ts tests/work-execution-guard.spec.ts tests/work-host.spec.ts tests/work-queue-end-host.spec.ts tests/work-execution.spec.ts tests/work-continuation.spec.ts tests/work-execution-boundary.spec.ts tests/work-execution-lifecycle.spec.ts
```

此外，首轮整仓 Node 22 的 131 文件、1619 项通过；对应 `94b0ce0` 的远端 Node 22、Node 24、secrets 通过。后续两项修正以最终整合的定向检查及 PR 当前提交的 CI 为准，不把旧提交结果冒充最终提交结果。

`pnpm verify:repository` 通过；`pnpm test:node` 为 28 通过、2 项沿原配置跳过。打包门禁在未提交树上按设计拒绝，提交后已验证 32 个导出目标及 15 个 Node 入口。最终提交检查可从 [PR #340](https://github.com/a2d2-dev/dsh-plugin/pull/340) 回读。

## 开发实例验证

指定入口：[DSH 插件开发](https://dsh-dev.e5box.a2d2.dev/)。只安装和重启 dsh-plugin-dev-server，生产不修改；候选保留当前开发环境已有 #197、#281、#320、#334 功能。

修复前真实页面基线为 #300 正在处理 1、占用 1/1；正式执行观察为 running，同一主会话原生事件有 139 次工具调用、1 次 turn/start、0 次 turn/end。这是正常基线，未将其宣称为现场再次复现，红灯来自实际 Agent 集成回归。

发布验证须核对包 SHA-256、安装文件一致性、开发重启成功回执与两实例 PID，再刷新该实际页面并比较当前身份、处理计数、占用和旧错误；另回读真实 QA 暂停控制不变。发布维护只临时暂停后续领取，不停止当前执行；验后恢复由本会话设置的维护暂停。

开发发布及页面验收的实际结果、脱敏计数和截图通过 [Issue #300 的验收记录](https://github.com/a2d2-dev/dsh-plugin/issues/300) 与其私有证据归档发布。本文件不以构建成功替代页面验收。Issue 最终关闭由 LF 执行。
