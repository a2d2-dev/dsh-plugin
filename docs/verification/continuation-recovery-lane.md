# 已保存接续材料的独立生命周期恢复

## 问题与范围

#183 的源会话已通过真实 `work_continuation_material` 保存材料并 idle，但执行仍为 epoch 1、`material-saved`，后继尚未创建。该现场不同于 #1474 的后继 received 后未开展业务。只读检查发现正式进程存活且持续写工作库；没有证据定位当时全局恢复具体停在哪个 await，因此不将现场描述为已证实死锁。

可复现的结构问题是全局恢复 single-flight：无关来源、子结果或队列扫描未返回时，idle 事件和两秒兜底均跳过整个 `reconcileControls`，已保存材料没有独立推进机会。手动接续不意味着保存材料后再次等待人工输入。

## 实现

保留全局扫描，单独枚举权威协调记录中的在途接续和已接受控制。原生 idle 事件按准确当前 Session 恢复，插件启动和原两秒 timer 也枚举这些已持久意图，因此部署前发生的 idle 不会丢失。

Session 恢复不等待全量来源、子结果或队列扫描。启动及 timer 的后台批次逐项等待恢复，每次最多一个后台 Session；批次未完成时不叠加新扫描。准确 idle 事件仍直接恢复该 Session，不被后台批次等待挡住。按 Session 和 Execution 去重，每个现有 pending execution 最多一个恢复操作，并沿用 execution 文件 lease，避免与全局恢复重复接任。它不会创建新的 Task、增加定时器或驱动普通业务事件。

开始维护前重读 owner、epoch、当前 Session 和真实运行状态。仍在运行的源会话不接任。实际维护、接任、receipt 和控制生效继续由原 `ensureExecution` 执行；人工等待、暂停、队列槽位、结束及旧会话权限不变。

## 验证目的、步骤与记录

证据保存在本实施树 `docs/artifacts/continuation-auto-work-20261101/`。日志不包含正式业务材料。

1. `work-control-recovery.spec.ts` 启动真实 Task、AgentLoop、工具系统和 JSONL 持久层。仅将无关 `reconcileContinuous` 置于可控 deferred 门，源会话通过正式材料工具保存材料；整个验收期间该门保持未释放。
2. 旧实现两个红例分别覆盖未来 idle 和材料已保存后的插件启动。均在五秒验收窗口后仍为 epoch 1、`material-saved`，而非预期 epoch 2、received。记录 `recovery-red.log`，两例共 10.88 秒测试主体。
3. 相同负载修复后，idle 和启动两例均在无关扫描继续等待时完成后继真实 receipt。最终相关组记录分别为 2093 ms、2233 ms，包含从触发接续至读取确认的耗时；旧实现两项均超过 5000 ms。此测量证明绕过全局扫描等待，不代表正式 #183 的具体慢 await 已定位。
4. 增加暂停执行仅换会话、重复通知与旧源会话不重复创建、真实源 turn 尚在运行时不提前接任。断言后继真实成功工具结果、唯一 receipt、仅两份 Session，暂停控制及原因保留且无 continuation-business。
5. 将既有 continuous wait/pause 接续用例切到独立入口，验证没有业务槽位时仍可完成维护，但 slots、resumeRequested 和 explicitResumeRequested 不变。`recovery-queue-slots.log` 两例通过。

定向命令：

```sh
pnpm exec vitest run tests/work-control-recovery.spec.ts tests/work-execution.spec.ts tests/work-continuation.spec.ts tests/work-continuation-pending-children.spec.ts tests/work-continuous-integration.spec.ts tests/work-queue-end-host.spec.ts --testTimeout 60000
pnpm typecheck
```

最终 `recovery-affected-final.log` 六文件、104 项全部通过，测试主体 114.52 秒；`recovery-typecheck-final.log` 类型检查退出 0。上述连续 wait/pause 两例切换独立入口后另跑 `recovery-queue-slots.log`，两项通过，原槽位和控制断言全部保留。`git diff --check` 通过。

独立审查指出首次实现虽然逐 Session 去重，启动仍会并发派发全部 pending。增加三个真实 Task 均已保存材料的回归，在真实后继创建入口暂挂首项，观察原两秒 timer 再次触发：修正前实际同时进入三个后继创建，红灯 `expected 3 to be 1`，见 `recovery-bounded-red.log`。改为后台逐项消费后，两文件43项通过（`recovery-bounded-green.log`）。随后在同一回归中加入第四个真实 Task，在后台首项保持等待时新保存材料，验证原生 idle 仍可独立到 received；后台三项最大并发仍为1，放行后全部 received，四个任务共八份唯一 Session。

增强回归还捕获了后继 receipt 的 idle 与同 Execution 源恢复收尾重叠时，单纯加入旧 Promise 会漏掉下一次回读的问题：六秒后仍停在 delivered。加入旧恢复后重新读取该准确 Session，保留原准入和 lease，再推进其既有意图。最终 `recovery-bounded-green-final.log` 五项通过、测试主体10.16秒，idle/startup/paused 三项分别446/388/688 ms；`recovery-bounded-typecheck-final.log` 退出0。

本分支只完成源码和宿主回归。正式 #183 无人工新输入接任的现场验收由主协调集成、部署后执行；本分支不操作正式任务、清锁或重启服务。
