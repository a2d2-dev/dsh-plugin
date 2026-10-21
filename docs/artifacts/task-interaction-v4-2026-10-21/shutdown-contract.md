# SIGTERM 与停后持久屏障：只读合同裁决

本轮只读核对固定宿主 `a45068d2ec03326c800c68c9bdcd47508e3ccb9c`；没有对运行实例发送信号或修改配置。撤回先前“必须新增全局admission API”的推定。升级边界可以由已结算工作、明确升级等待状态、正式停止生命周期及可验证的停后静态cut组成；不能让被停止的CEO等待自己恢复。

## 已有正式链路

| 环节 | 真实源码 | 合同与限制 |
|---|---|---|
| 信号 | 宿主 `apps/cli/src/profile-boot.ts:254–280` | SIGTERM调用单次root fiber.dispose及proxy disposer；新启动ready在信号后不commit。 |
| Web停止 | `packages/host/webserver/src/index.ts:303–315` | 关闭监听、所有HTTP连接及升级socket并等待。它随root disposer运行，不是独立提前完成的admission证明。 |
| Agent／工具收尾 | `packages/core/agent-loop/src/index.ts:523–569` | disposed取消→await whenIdle→scope.dispose→handle.close；收尾结束才移出registry。不可把当前children/jobs当泄漏清理；应在停止前完成其业务结算/实际结果收取。 |
| Session持久化 | `packages/session/session-persistence-jsonl/src/storage.ts:508–565` | flushAll排空live buffer并flush；退出关闭open handles且排空buffer，汇总错误；Agent handle.close承担最终closing events的durability。 |
| JSON Storage | `packages/storage/storage-json/src/index.ts:82–89,109–116`及`single-unit.ts:114–146` | 关闭新open；等待open和inFlight写操作；每个写调用本身await atomic publish。close等待settled，并非所有历史写操作成功的汇总证明。 |

## 不能由exit0推断成功

`apps/cli/src/process-shutdown.ts:4,52–74`默认5秒；成功dispose、dispose拒绝、到期和重复信号均可走forceExit(code)，SIGTERM传入code0。因此Supervisor STOPPED、子进程exit0都不能区分完整graceful和强退。现有测试 `apps/cli/tests/process-shutdown.spec.ts:61–79,114–146`明确锁定这些语义。

另有 `vendor/cordis/src/fiber.ts:265–295,675–695`：disposer错误写logger而不从全部fiber.unload重抛，root dispose resolve也不能单独冒称所有持久化成功。不能用空日志、固定sleep或“没有报错”补出不存在的ack。

## 准备的运行模式

1. 新／回滚宿主和新／旧完整profile先离线准备、全入口导入及SHA核验；此时不改运行profile。
2. 父会话收取本任务children/jobs的结果并写交接摘要及升级等待状态。旧jobs运维证据保留owner实际job_output原始命令回执、无running作业的公共观察，不标记产品consumed；正式epoch/instance消费事实另验。
3. 服务外one-shot先冻结最后一次公开Session投影seq及域状态cut，再仅stop指定Supervisor程序；检测forced kill、超时、错误日志或残留writer时不得切新版本。
4. 停后不启动任何DSH实例，静态解码原Session全部journal并检查完整物理帧、合法事件前缀、既有身份/config与预先冻结的已接受seq/material；验证所有进程退出与数据树稳定。此结果是实际静态durability证据，绝不把Supervisor状态当flush ack。
5. 只有该模式的合同证明足够且无已知强退/未完成写入才可切换、start、同URL核验；失败按独立可执行旧宿主/profile回滚，保留新日志与数据。无法判断退出原因时不能谎称“已证graceful”。

目前还缺运行宿主的具名shutdown-completed/forced/error终态回执。若停前公开cut＋停后静态完整性仍不足以裁决，最小缺口是记录退出原因及持久化结果的正式回执或已有公开flush witness，**不是预先扩平台新增全局admission API**。本阶段实现检查与动作，不生成虚假的回执；执行方式由父会话在源码／制品review后下达。

## 隔离制品准备范围

已先向父会话报告并创建rollback工作树 `/data/src/github.com/deepseek-ai/deepseek-harness-dev.worktrees/v4-141-rollback-a45068d2`，branch `test/v4-141-rollback-a45068d2`，base固定a45068d2。私有日志／制品根 `/tmp/a2d2-v4-141-artifacts-38d4d91`。只在新工作树安装和构建；共享dev与H142实施树没有写入。新宿主最终commit等待H报告后另固定，不猜测。

后续执行依据原人类整体授权及父会话的阶段执行指令，不新增LF确认门，也不声称已有新的human approval。本轮仍禁止部署、运行profile安装或服务start/stop。
