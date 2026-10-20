# #122 真实隔离宿主验收准备

## 背景与目标

固定 base `606fcee` 只提供 accepted 预约；最终产品 tgz 未提供。本阶段交付可复现的真实宿主正控和模型边界适配，不构成产品 task.start、等待/恢复、接续或围栏通过。#121 最终 stable-origin 证据及旧失败事实保留，见 [旧票最终报告](../artifacts/a2d2-v3-121-2026-10-19/product-final/README.md)。

## 架构

[独立入口](../../scripts/a2d2-v3-122/acceptance.mjs) 直接导入 #121 已导出的 prepare/run/request；该模块的 CLI 有 main guard，import 不启动进程。不修改旧工具，不复制其路径、端口、信号与生命周期逻辑。独占资源使用 `/tmp/a2d2-v3-121/122-<run>`，沿用已验证 namespace，以 122 前缀隔离。只在公开 prepare 完成、realpath/manifest 归属核对后替换自有 guard，原 manifest 不变，保留原 patch/guard/manifest hash 与新 assembly hash。每次 run/request 核验实际装配和已解析宿主构建。

[模型适配](../../scripts/a2d2-v3-122/model.mjs) 只发现一个确定性模型。公共 LLM waterfall 和 adapter 分别追加计数；未授权的 Session、辅助调用、预算耗尽均拒绝。宿主正控显式授予指定 Session 一次调用；公开 controller 以固定 ID 和真实 preset 创建/复用会话，selectLocalModel 使用宿主公开 installModelSelection 机制，只改 Agent 局部 assembly/request，不保存全局默认。adapter 固定回复由真实 AgentLoop 持久化，不伪造产品响应或写 Task store。指标只记身份、路由、阶段、事件类型，不保存消息正文或凭据。

## 场景

工作目录为本 worktree；HOST 指向已有只读宿主，ROOT 必须为全新专属目录。命令示例：

```sh
node scripts/a2d2-v3-122/acceptance.mjs prepare --host "$HOST" --root "$ROOT" --host-only
node scripts/a2d2-v3-122/acceptance.mjs run --root "$ROOT"
# run 必须经 bash run_in_background 管理，然后登记实际 job：
node scripts/a2d2-v3-122/acceptance.mjs job --root "$ROOT" --job <managed-job>
node scripts/a2d2-v3-122/acceptance.mjs positive --root "$ROOT"
node scripts/a2d2-v3-122/acceptance.mjs mark --root "$ROOT" --phase host-browse
# agent-browser 使用本 root browser-profile 登录真实页面、snapshot、截图
node scripts/a2d2-v3-122/acceptance.mjs check --root "$ROOT" --phase host-browse
```

正控要求双计数各增一、真实持久 assistant/message 含固定文本、turn/end completed、assembly/request 路由一致、全局默认不变。mark/check 比较阶段增量，允许既有显式调用总数非零；只读阶段要求零增量、身份集合与持久投影不变。live/cold 独立呈现；cold 不冒称已读取有效运行配置。登录 URL 只在隔离 root 的 private 文件；按 #121 私有 URL 读取方式交给 agent-browser，正式证据仅白名单复制。

重启前只停止已核对本 root run 记录的自有 job，收集退出，再同 root run，复用原 origin/profile，模型指标跨进程追加。路径规范/符号链接拒绝前无写入、端口占用不杀他人、origin 检查及自有停止直接复用 [#121 生命周期证据](a2d2-v3-121-acceptance.md)，不制造镜像测试。

## 待产品接线的 fixture 与 gate

| Fixture / 场景 | 当前边界 |
| --- | --- |
| 两 Task 竞争同 Session、重复启动/回执丢失 | 等最终 tgz 的 WorkApplication task.start/task.execution；不调用 base accepted 预约冒充启动 |
| current/retired/review Session | 宿主 fixture 仅创建固定身份；业务用途、owner/epoch 与 retired 围栏待公开产品命令 |
| current/retired cold | 宿主重启后的公开 list/inspect/projections 可观察 cold；产品历史投影/零调用围栏待接线 |
| 持久 Task inbox、等待/恢复 | 待公开 TaskId 控制与投递/消费查询；不把宿主 inbox 代替 Task inbox |
| 手动接续检查点 | prepare/write/create/take/deliver 及固定后继均待公开产品接口；不发明私有后门 |

最终接入需要已验证 tgz 及 SHA、公开命令/查询契约、受控失败窗口和浏览器入口。新建独立 root 官方安装，不替换已冻结实例；显式 start/continue 才授予确定性预算，列表/历史/旧会话阶段按零增量检查。参数化 TaskRef 授权入口已在下面落地，产品动作仍待后续真实 lane。

## 实际宿主与生产锁包的能力差异

2026-10-20 的真实宿主正控、原生截图、纯读零增量、同 origin 重启及正常清理见 [实际报告](../artifacts/a2d2-v3-122-host-2026-10-20/README.md)。宿主实际 controller lib SHA `bc889fbd3e95a994d9019f08feb9ce9033f4c6c918b6932f14b1c0fd109241a6` 提供 selectLocalModel；其 package 标记虽为 0.2.0-rc.2，**生产原锁包没有该方法**。本工具仅证明该 actual artifact 上的局部模型配置正控，生产仍须在最终 tgz 上验证自己的公开 installModelSelection/持久化配置路径，不能以版本名回填能力。

mark/check 严格用于同一稳定生命周期内的纯读阶段。重启会合法追加 session/end-seed、推进序号并规范化 cold header；[重放 gate](../artifacts/a2d2-v3-122-host-2026-10-20/replay-gate.mjs)逐字段只允许已观察的这些差异，其余 meta、eventTypes、完整持久投影、身份、cwd、preset/default 和累计计数严格比较。retired 输入拒绝可产生 blocked turn，最终需另验模型/工具零增量及 current 不变，不能套纯读全等。

## TaskRef 显式模型预算（b14ed41 kickoff 接线）

当前入口增加本地私有 `grant-task`，用于产品 task.start 事前尚不知道随机 Session ID 的场景。必须使用本次 wrapper/guard/model 的 fresh root，先通过公开产品命令建立 Task，再显式授权并等待 CLI 成功回执，之后才点击“开始处理”或调用 task.start：

```sh
node scripts/a2d2-v3-122/acceptance.mjs grant-task --root "$ROOT" \
  --project-id "$PROJECT_ID" --task-id "$TASK_ID" --calls 1 --phase startup
```

私有 IPC 请求为 `{"action":{"type":"grant-task","ref":{"projectId":"…","taskId":"…"},"calls":1,"phase":"startup"}}`；仍由 #121 request 在自有 root/ipc 下传送，不新增产品 HTTP 路由。guard 动态取得真实公开 `a2d2Work`，仅调用 `query(value,{operator:true})`。无应用、错误 Task/Project、查询失败均拒绝，不从浏览器或模型消息推导授权。

授权时 task.detail 核对已存在 Task，task.execution 允许尚无 Execution。已有执行时以 session.work 的唯一 control 反向映射核对并绑定；否则在首次模型请求中核对后绑定 executionId、owner、epoch、runtimeId、sessionId。每次 gateway 重新 task.execution → session.work → task.execution，要求同 Task、唯一 control、Execution/epoch 一致、当前 Session 匹配、资源 runtime 一致、确定性 route、ready/running 且无待应用 wait/pause。跨两次正向查询改变也拒绝；related/review/retired/unknown Session 不取得预算。

每个 grant 只绑定这一执行身份，后继或 epoch/owner 变化需再显式 grant，不自动迁移剩余预算。任一时刻只有一个 grant，显式新 grant 可替换空闲旧 grant；查询或流执行中替换/并发请求拒绝，不消费错误预算。全部公共核对通过后扣一次，开始后的中止不退还。预算不从 metrics 恢复，进程重启需重新 grant。gateway/adapter 尝试、拒绝、授权、绑定和准入均追加留证。公开查询不与模型调用组成原子事务，本工具核验每次准入时的事实，运行中的生产围栏仍由产品保证。

宿主 positive 保留原 Session grant，不依赖产品能力。新增测试明确使用公开查询合同示例验证模型边界和 CLI，不将示例当作真实 WorkApplication/Task store 集成。实际 b14 产品 kickoff、等待/接续与旧会话围栏交后续真实产品 lane；旧 c3 宿主证据不追认新工具版本。TaskRef工具checkpoint `ae5759b` 的35 passed/0 skipped、pending wait行为红绿、fresh host-only真实CLI无app拒绝及旧positive保持通过，见 [本轮工具证据](../artifacts/a2d2-v3-122-task-grant/README.md)。

## 当前验证

test-first：首轮缺模块为装配失败，不计行为红测；保留禁用语义后运行用例，授权请求抛 `A2D2_122_NOT_AUTHORIZED`（exit 1）；增加指定 Session 单次预算后 1 passed / 0 skipped（exit 0）。测试接缝为任务明确批准的外部 LLM/adapter，不使用产品 mock。

真实 lane 清理后补 wrapper 自身完整性：原工具记录 wrapperSHA 却未校验，后续同 root 换入口文件可能误用旧指纹。新增公开 prepare/verify 接缝回归，篡改 fixture 的 wrapperSHA 后应拒绝：红测 `Missing expected rejection` exit1；加一条当前入口 SHA 相等断言后两项 122 测试通过（2 passed / 0 skipped，exit0）。既有真实 root/assembly/baseline 保留，不追改旧指纹；最终工具需要 fresh root。verify 在任何 run/IPC 前执行该检查，fixture 保留在独占 122-integrity-* root，不启动宿主。最终工具 `d1b2a01` 的 fresh root 真实正控、public-read 零增量、job bash-827 正常退出以及23 passed / 0 skipped 的最终测试见 [完整性复验报告](../artifacts/a2d2-v3-122-integrity-final/README.md)。实际 guard/model hash 与首轮真实浏览器和同origin重启证据一致。
