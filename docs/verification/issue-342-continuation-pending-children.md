# #342 未返回子会话不阻断接续

Issue：https://github.com/a2d2-dev/dsh-plugin/issues/342

## 目的

验证手动或既有自动接续触发后，未返回原生子工作作为准确待处理事实交给后继；主会话安全、明确暂停/结束、旧 owner/epoch 和 Task 完成门继续生效。没有添加任意超时计时器。

## 步骤与记录

1. 在修复前代码运行新增真实 native 测试：子会话停在 `hold_native` 工具，源主会话 idle。`task.continue` 被 `native-result-pending`、`tool-result-pending`、`executor-unsettled` 拒绝推进。红灯日志为 `docs/artifacts/continuation-pending-children-20261101/continuation-pending-red.log`。
2. 修复后同一原生工具仍未返回时接任 epoch 2。后继真实日志包含准确 parent/child、状态、工具和下一动作；Task 完成被拒，running child 不重复启动，退休主会话不能写协调状态。late child 结果经原 parent 通知保持 pending，后继通过 `work_child_recover result` 顺序分页取得真实证据。只保存接收声明而没有真实工具结果不能解除门；真实全部分页 tool/result 提交后观察 settled，正常验收可完成，完成后 resume 被拒。
3. 独立子 worker 在真实原生工具尚未返回时 flush 公开会话并被 SIGKILL，外层使用同一持久目录重新装配宿主。公开 query 诚实呈现 interrupted/error 闭合；接续仍完成。完成接续后再卸载/重载宿主，使退休 root-parent 也处于 cold 状态；桥通过原 root-parent 的公开 `subagents.sendMessage` 恢复同一 childId，首次真实消息已接收但回执丢失，重试不产生第三轮。新一轮真实结果被后继接收后解除结果门，旧主会话未重新取得协调权。`continuation-native-crash-seed.log` 的子 worker 非零退出是刻意制造的宿主丢失；通过结论来自外层冷恢复断言，不将该 worker 的失败当作测试通过。
4. 原 catalog 指向不可读 orphan child 时，源主会话事实仍可读，unknown child 身份被保留；接续安全维护可进入，完成观察仍含该 child 的不可读阻碍。
5. 原生通知重排/伪造拒绝、waiting/paused 接续控制、原生结果消费事实、固定 operation 重试/冷恢复、关联源执行者维护锁及 queue end 回归继续通过。

验证命令与原始日志：

- `pnpm exec vitest run tests/work-continuation-pending-children.spec.ts tests/work-completion-native.spec.ts tests/work-continuation.spec.ts tests/work-host.spec.ts tests/work-execution-boundary.spec.ts tests/work-queue-end-host.spec.ts`：6 文件、53 项通过，`continuation-affected.log`。随后保留已转交 child 历史记录并补 orphan 边界后，受影响的 3 文件、42 项通过（`continuation-final-tests.log`），orphan/runtime 定向 2 文件、6 项通过（`continuation-orphan.log`）；补退休 parent 的再次 cold 重载后，真实 native 两条回归通过（`continuation-pending-green.log`）。
- `pnpm typecheck`：通过，`continuation-typecheck.log`。
- `pnpm build`：通过，`continuation-build.log`。编译产物未提交。

所有日志位于 `docs/artifacts/continuation-pending-children-20261101/`，也保留同名 `/tmp/` 原件。

## 已知边界与交付

原生同 ID 恢复遵守 direct-parent 权限。递归 child 的原 parent 自身已冷却、普通 SessionController 无权恢复该 parent 时，返回准确 `child-recovery-parent-unavailable`，不能假称已恢复。当前协调应先确认旧执行已停止，再依据保存进度显式重新委派剩余工作，不自动唤醒整条链或复制运行中的工作。

本次未修改生产 home、1474 业务代码，未部署或重启。真实 dev 页面验收由主会话完成，此报告不将组件集成测试当作页面验收。


## 正式 review P1 替代处置回归

目的：修复“提示重新委派，但旧 interrupted child 永远阻止完成”的闭环缺口。

步骤与记录：新增 `replace` 后，独立 SIGKILL 场景使用 `vi.spyOn(subagents.sendMessage).mockRejectedValueOnce` 注入一次 provider 不可恢复错误（不声称该错误来自实际宿主权限拒绝），当前协调通过原生 API 创建替代 child，实际执行 `replacement_verification` 并返回证据。未正式读取结果时 replace 被拒；当前协调完整分页收取后，replace 持久绑定停止的旧 endSeq 与真实替代 completed endSeq，完成观察解除旧失败门。旧 child 的 interrupted 与 native pending 保持原样。随后再接续一代，旧接收 epoch 不授新代完成权，新协调可重新读取同一替代 child 并完成。另一路对已成功收到的普通 child 同样跨两次 handoff 再读取并完成。运行中的旧 child 不可替代；其他 Task 的替代 child 与结果读取均被拒。

原始红灯：`/tmp/continuation-replacement-red.log`（旧实现没有正式替代准入，外层 1 失败）。绿灯：`/tmp/continuation-replacement-green.log`（真实原生 3 场景通过）。相关 7 文件、65 项回归通过，类型与构建分别记录在 `continuation-replacement-affected.log`、`continuation-replacement-typecheck.log`、`continuation-replacement-build.log`。CI 中两条 continuous wait/pause fixture 已等待首次材料维护结束，再显式重试同一 operation 的材料请求；原控制、槽位与其他自动消息不执行业务的断言保留。该文件连同最终原生回归 2 文件、20 项通过（`continuation-replacement-final.log`）。日志同存 artifact 目录。
