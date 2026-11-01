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

本次未修改生产 home 或 #1474 业务代码。开发实例的实际安装、重启与页面验收见下节；正式实例尚未推广。


## 正式 review P1 替代处置回归

目的：修复“提示重新委派，但旧 interrupted child 永远阻止完成”的闭环缺口。

步骤与记录：新增 `replace` 后，独立 SIGKILL 场景使用 `vi.spyOn(subagents.sendMessage).mockRejectedValueOnce` 注入一次 provider 不可恢复错误（不声称该错误来自实际宿主权限拒绝），当前协调通过原生 API 创建替代 child，实际执行 `replacement_verification` 并返回证据。未正式读取结果时 replace 被拒；当前协调完整分页收取后，replace 持久绑定停止的旧 endSeq 与真实替代 completed endSeq，完成观察解除旧失败门。旧 child 的 interrupted 与 native pending 保持原样。当时版本随后再接续一代时要求新协调重新读取替代 child；普通 child 同样跨两次 handoff 重读。#1474 修复已以可信原始工具提交验证取代该要求：同一不可变结果的完整和部分进度均可继承，详见 [子会话结果读取](../agents/child-result-reading.md)。运行中的旧 child 不可替代；其他 Task 的替代 child 与结果读取均被拒。

原始红灯：`/tmp/continuation-replacement-red.log`（旧实现没有正式替代准入，外层 1 失败）。绿灯：`/tmp/continuation-replacement-green.log`（真实原生 3 场景通过）。相关 7 文件、65 项回归通过，类型与构建分别记录在 `continuation-replacement-affected.log`、`continuation-replacement-typecheck.log`、`continuation-replacement-build.log`。CI 中两条 continuous wait/pause fixture 已等待首次材料维护结束，再显式重试同一 operation 的材料请求；原控制、槽位与其他自动消息不执行业务的断言保留。该文件连同最终原生回归 2 文件、20 项通过（`continuation-replacement-final.log`）。日志同存 artifact 目录。


## dev 验收发现的退休 parent 通知缺口回归

目的：修复“恢复入口成功，但 child 真实完成后当前协调停在 executor wait，原生通知只到退休 parent”的运行闭环。

测试先制造真实 SIGKILL child，再经原 parent 公开路由恢复同一 child。恢复后的 child 停在真实 `hold_recovered` 工具，当前协调通过实际 `work_control wait` 保存准确 executor 等待。工具返回并产生真实 terminal notice 后，既有恢复插件自动向当前协调投递 Task 结果事件，当前协调自动恢复并实际调用 `work_child_recover result` 读取完整分页，提交成功回执；没有人工给当前会话补输入唤醒。另一路先让真实通知留在旧 parent，再卸载/重载宿主，由启动 reconciliation 补投；同一 native notice 仅投递一次。

负例让同一 child 开始新一轮，重放旧通知不唤醒新 wait；用户 pause 后新结果只入箱不运行当前协调，随后显式人工 wait 也保持。断言按当前协调的真实 assistant/message 与 tool/call 计数（不使用可能去重的 request/header），child 自己完成所需的模型请求不算成当前协调被唤醒。原生结果消费、当前结果完整收取和业务验收分别检查，旧 parent 的原生通知仍未作为 user/message 消费。

最终 live/启动重载及全部新负例两条场景通过；相关 4 文件、28 项与 guard 35 项通过；typecheck/build 通过。红绿、相关回归、类型与构建日志分别为 `continuation-relay-red.log`、`continuation-relay-green.log`、`continuation-relay-affected.log`、`continuation-relay-typecheck.log`、`continuation-relay-build.log`，位于同一 artifact 目录并保留 `/tmp/` 原件。该回归测试未操作运行实例；主会话随后完成下述真实开发验收。


## 真实开发实例验收

入口为 `https://dsh-dev.e5box.a2d2.dev/`，隔离测试 Issue [#343](https://github.com/a2d2-dev/dsh-plugin/issues/343)。使用 agent-browser 和正式工作 API 创建独立工作区及测试任务，没有复制生产工作库或修改 #1474 业务代码。

1. 在旧包中启动一个真实 continuable 子会话，让其后台作业等待测试释放文件。原主会话空闲后正式请求接续，现场得到 `reserved` 和 `native-result-pending/tool-result-pending/executor-unsettled/job-unsettled`。固定后继已预留，未实际接任。
2. 通过独立 Supervisor helper 重启开发实例，原子会话最后持久事件为未完成的 `job_output` 调用，没有真实结束事件；对应等待进程不存在。保留这组记录用于后续验收。
3. 安装修复后，既有 operation 自动从 epoch 1 接续到同一个预留后继。后继成功调用 `work_continuation_received`，状态为 `received`，准确收到 child 身份、原 parent、`interrupted`、结果 pending 和旧 job lost；原人工等待控制保持。
4. 操作者明确恢复测试并创建释放文件后，后继经 `work_child_recover` 恢复同一 child。child 实际读取释放文件、写入并回读 `child-finished.txt=QA342_CHILD_FINISHED`，新 turn 真实 completed；没有新建 child 或由主会话代写完成文件。中途无效工具参数和权限模式失败保留在原始轨迹，未冒充成功。
5. 首轮页面验证发现完成通知仅到旧 parent、当前协调停在 executor wait。保留该现场并安装 `4839c00` 的通知修正后，启动 reconciliation 自动补投唯一结果事件，当前协调自动恢复。没有再次向当前会话发送人工输入。后继按同一 revision 顺序读取 7 页真实结果（endSeq 84），全部成功工具回执落盘，独立读文件后正式 `work_report` 验收为 done，completion closeout 为 settled。
6. 真实页面最终显示四项验收通过和 7 页结果完整读取。截图 `dev-baseline.png`、`dev-successor-resume.png`、`dev-result-wait-gap.png`、`dev-final.png` 已实际查看；`dev-final.json` 保存操作、接收回执、唯一转发事件、完成记录与服务状态。已知旧失败和修正后结果分别保留。

最终开发组合候选为 `599642089118cf33c0ab4bb2996c3bbe2480b2ed`，在原开发候选上叠加本项三个修复，保留已有 #197/#281/#320 功能。组合类型检查、62 项相关回归、构建和打包通过。包 SHA-256 为 `2180cc19571c859aba6db782bd0129e8766122fbd5a5419ef87c1cf5106dab63`；安装后的 199 个 lib 文件逐个匹配，其余 profile 配置及依赖未改。最终重启回执 `6957248c-47e7-4520-a14f-df4341508955` succeeded，开发 PID 变为 3567607，正式 PID 始终为 3102758。

源码 `4839c00` 经三轮独立只读审查后 APPROVE；其分支和 PR 的 Node 22、Node 24、secrets 全部通过。源码库未提交编译产物或私有会话轨迹。完整本机证据在 `docs/artifacts/continuation-pending-children-20261101/`，安装证明在开发实例的 `qa/issue342/`。正式实例尚未安装本项修复，生产 #1474 的接续尚未操作。
