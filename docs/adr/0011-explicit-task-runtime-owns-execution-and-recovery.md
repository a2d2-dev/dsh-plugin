# 显式授权的宿主运行器按 Task 身份管理协调权、接续与恢复

**状态：当前目标决策。** 浏览器用于观察和表达意图，长程推进由 DSH 宿主中的运行器负责。执行协调沿用本地可恢复机制，并扩展为独立领域身份与明确的当前处理会话。

2026-11-01 已按本决策形成[实现与正式运行核对矩阵（私有证据）](https://github.com/a2d2-dev/project/blob/5b2fd29/dsh-plugin/docs/artifacts/270-runtime-contract-2026-11-01/README.md)。本文的目标合同不等于所有版本均已满足；主干、正式包、候选和 GUI 验收状态在矩阵中分别记录。

## 执行资格

- 只发现和驱动已明确启用的执行。绑定会话、浏览项目或重载插件不自动接管工作；“开始处理”与“持续处理”按 ADR 0007 授权。
- 同一协调域内按 TaskId 授予唯一有效 owner 与 epoch，允许受控的并行工作者。短事务、固定操作身份和版本检查防止重复创建或重复接任。
- 首期同一 `(runtimeId, sessionId)` 至多作为一个活动 TaskExecution 的当前协调会话，领取时同时校验任务与会话两个方向的唯一性。历史、评审和工作者关联不自动取得协调身份；未来开放共享协调会话前，必须先具备显式 Task 寻址、会话级有序驱动及相关任务集合的交接恢复。
- 首期限定单宿主、同 PID 命名空间、同一协调权威。不能把多个独立安装、不同目录或复制存储上的锁解释为全局互斥；多宿主协调不由 GitHub 评论实现。
- 旧协调会话在接任提交后失去对原 Task 的协调写入资格。具体 Task 操作校验 owner/epoch 并说明当前会话；旧会话显示交接提示和新会话入口，仍接收并回应人工输入。等待、暂停、完成和交接都不得封禁原生对话或统一禁用宿主工具（#120、#122、#139；2026-10-23 用户裁决）。
- 暂停、取消请求和工具真正停止分别可见。运行器不得杀死无关会话或把正在执行的外部副作用假称已经撤销。

#315 的修复范围仅为人工对话：业务准入拒绝队首自动输入时，adapter 通过公开 Inbox 接口让其后已有的 source.kind=user 原始消息进入对话。自动输入的准入、路由、恢复和原控制全部保留，不因本轮修复允许 schedule 或其他自动来源进入 waiting/paused 会话，不自动恢复业务。被拒自动消息沿用既有 Task 事件或宿主生产者恢复路径；人工对话不授予当前 owner/epoch、不解除暂停或结束、不重开完成任务、不取得持续槽位。

#348 在受管 Task 的安全 pre-step 同时整理当前 claim 与原生 Inbox：仅当同一 `schedule_id`、逐字相同 `reminder_prompt` 的待处理 occurrence 已有更新替代时取消旧 envelope，按 `occurrence_at` 保留最新原始消息及身份。批次中每一项都有替代才丢弃整批；混合批次中仍有独有提醒、格式未知、其他来源和不同指令均原样保留。原始 journal 不重写，已 claim 的替代项通过公开 Inbox 显式取消，不能冒充 `user/message` 消费。接续 seal 与 Task 重放保留事件及完整 payload，把替代项记为 `discarded`，不再投递成数十个模型轮次。

受管会话的人工 Inbox 和已接受 Task 人工输入在下一安全 step 恢复，自动队首获准也不能让人工输入饥饿；非受管会话仍沿宿主 Queue 语义。人工消息保持身份及顺序，自动输入单独准入，暂停、结束、旧会话与维护范围不随人工消息扩大。维护请求与人工消息相遇时先交付人工对话，固定维护请求由其原有 operation 重试；不能借人工对话解除维护工具限制。

## 生命周期维护与业务准入

插件对同一 Task 持续持有接续推进责任；当前业务主会话身份只在正式接任事务切换。会话只执行插件指定的收取、保存或读取确认步骤。显式 `task.continue` 允许 idle 且相关事实满足条件的 waiting/paused 执行仅换会话，保留 Task、Execution、owner、全部规格验收与完整 control 原因；维护不取得 continuous slot，不设置 resumeRequested，不把 waiting/paused 改为 ready。

维护准入绑定持久 operation、准确 Session、固定请求身份及具体步骤。tools.guard 只允许 material 步骤保存材料、collect 步骤正式 job_output 指定 jobs、receive 步骤确认指定材料；任意 marker、业务工具和嵌套分派不取得准入。人类正常对话仍沿用宿主权限，对话、页面查看、完成和归档不解除 Task 控制。

当前宿主另有归档硬门：归档 Session 及其原生 subagent 后代不能执行任何模型步骤，包含上述维护步骤和人工对话。前述原生对话合同不能解读为插件可绕过该宿主门。恢复归档不改变 Task 的 pause/wait/end；必需源材料尚未可靠保存时，归档会阻断接续。#184 的人工恢复已验证同 operation 继续且 pause 保留，插件自动恢复归档与退休提醒收口尚未闭环。

原生结算另有无工具的 settle 步骤：从真实父 catalog、child header/descriptor、最新 turn/end 及原通知首次 inbox insertion 核实 parent/child/endSeq/messageId，绑定当前 operation/source epoch。只让准确通知进入父 user/message；同批其他自动输入持久排队，不获得业务权限或设置 resumeRequested。旧通知重插不刷新首次入箱时间；消费通知、child returned 与 Task 验收仍分别核实，接续触发后，原生子工作与未消费通知不再构成接任门；原生消费事实保留，后继通过准确子会话结果另行收取。材料新鲜度覆盖源主会话及非原生关联执行者的 job 身份，变化中的子工作由独立持久快照交接。

指定宿主 rc.3（22ddee3792402c3e70ec5f86a63c3e3e895a2f60）及匹配依赖的 LocalJobs 在准确 owner Agent 退役时删除其注册记录。真实原生 activation 返回且父已消费旧通知后，先前两个 completed 作业已经不可达；普通 SessionController 也不具有原生 child 冷恢复权限。不能把这个能力负例说成“returned child 的两个 reachable pending jobs 已补收”，不能伪造 pending 注册表、裸读结果或绕过子会话路由。本轮正式负例与已有准确 owner 正式补收 lane 分开记证；将来宿主支持该前置条件时，仍需原生新通知消费和新材料的完整实证。

## 接续与上下文

- 使用宿主公开的安全维护边界；源会话达到可接续状态后，固定后继和操作身份，保存接续内容，创建或恢复后继，校验环境与配置，受控接任，再投递剩余事件。
- 接续保持 Project、Task、负责 Agent、Execution 与业务 Stage；只增加会话代次和对应协调版本。评审会话与独立子任务会话不因新建而取代当前处理会话。
- 接续材料包含完整本地目标、已接受决定、证据、未完成项、下一步及历史引用。尚未正式落盘的关键讨论必须被明确保存；不能用泛泛的“沿用上下文”代替内容。
- 原生子会话结果仍受宿主父子关系约束。手动或自动接续一旦触发，不等待原生子会话返回：保存准确 parent/child、label、运行/返回/结果状态、工具、作业与下一动作，随接续材料交给后继。源主会话自身及非原生关联执行者的安全门、明确 pause/end 均保留；不另增任意超时器。独立子 Task 本身也不阻止交接。
- 200K／300K 等设置是提前接续软目标。安全边界上通过公开计量与实际路由元数据观察 token、模型窗口、输出预留及接续余量，记录读数来源和新鲜度。
- 界面近似压力读数只供显示，不能单独充当硬预算依据。缺计量、估算、路由变化或长 turn 延迟必须可见；硬性“下一个请求绝不超窗”需要宿主与最终请求绑定的预算契约，不在本次直接承诺。
- 新根会话通过公开 SessionController/preset 装配，继承实际 cwd、workspace、策略与有效权限；使用会话本地模型选择。恢复已有会话时，读取并采用宿主当前有效的 provider、模型和推理强度，按 ADR 0009 更新当前执行配置；不将启动快照、旧接续 profile 或上一请求路由当作不可变的模型约束。模型选择变化本身不产生新 Task、Execution、Session、owner 或 epoch。
- 用户已经选择新模型但尚未发送请求、或已经用新模型完成请求，都允许恢复；不可仅因它与历史模型不同报 `incompatible-session`。模型不可用、能力或预算不足时显示对应阻碍；无法确认的权限、资源或任务归属仍分别核查，不通过改模绕过这些校验。

事件交付回执未改变 `delivery` 时，`ensureExecution` 回读最新执行；仅当 owner、epoch、当前会话及准确事件交付值仍匹配时复用该快照，避免逐事件无变化写事务。新控制等并发更新继续进入后续循环；状态推进、身份变化、事件缺失或交付值变化沿用原写事务与错误路径。此优化不改观察频率、实际执行配置保存或宿主协议。

## 持续处理与等待

- 状态追问不撤销原有任务授权。模型自行设置的等待与用户明确暂停分开处理：当前会话可在人工追问时读取相关证据、检查原等待是否仍成立，确认自身误判后用既有控制入口恢复原工作，不索要新的“继续”口令。不得借此解除用户暂停、结束决定或尚未解决的真实外部条件。内部身份提示仅供工具定位，不作为用户进度汇报。
- 对未完成的已授权执行，使用 DSH 公开的 `agent/turn-stopping` 在同一轮内有限次纠正纯解释或重复记账。计数与已观察的工具结果保存在当前执行记录；实际在途子执行、审批、交接维护、已完成和历史会话分别保留。只查看会话不启动执行，恢复提示随下一次合法输入进入；不另建定时器或 Goal 驱动。具体边界见[对话执行护栏](../architecture/execution-guard.md)。

- 来源发现队列与 Task 事件收件箱是两种职责。前者发现候选并去重、领取；后者向已存在的 Task 投递输入、结果和外部观察。
- 队列在具体项目和已授权筛选范围内运行。发现重复外部项先解析唯一映射，领取后以固定 Execution/command 身份启动或复用；启动回执未知先核对，不再建第二个执行。
- 不把浏览器定时器或模型反复空推作为后台生命周期。来源适配可按明确能力使用推送或受控增量拉取，状态查询不调用模型。
- 明确等待人类、结果或外部条件时停止无意义模型推进。规则的可推进槽位与 Task 协调资格分开：等待项在安全边界让出自动推进槽位但保留 owner 和会话，规则继续处理其他合法候选；回复/结果先落入事件记录，再按有序调度恢复，不能绕过并发门槛自动唤醒。业务完成以验收事实为准；模型停止、无进展指纹和工具返回不能替代验收。
- 暂停接新工作停止新领取，当前受管执行按自身状态继续。来源暂不可用保留已有候选、当前执行与恢复点，不清空工作列表。

终态 pending jobs 先在维护锁外向准确 owner 发出补收请求，由该会话的真实模型步骤调用正式 job_output。插件 flush owner Session 后复查正式交付事实；运行中、unknown、权限拒绝、消费后未提交成功结果和空重读均不伪造 collected。补收后的材料按 execution/source/epoch/specification 与结果身份集合校验，结果改变即重新请求材料；随后才进入相关执行者锁内重查并接任。

新操作持久写入 protocolVersion=1，投递与可读分别持久记录：`taken → delivered → received`。后继用 work_continuation_received 声明读取准确 material command；插件读取该准确 Session 中成功提交的 tool/call、tool/result 并 flush 后确认。投递返回或单独写入声明不足以进入 received。旧记录没有 protocolVersion；其中 delivered 继续保留历史终态“已投递、没有新读取确认”，冷加载/观察/恢复不重开，也不改标 received。只有未完结旧操作在合法恢复时采用新屏障；对旧终态显式新接续则归档原历史并预留一个新操作。消费但未产生结果保留具体错误，新显式重试只换该步骤请求身份，沿用 operation/successor/epoch。

受控接任在 source maintenance 内通过公开 goals.disarm(exactLiveAgent) 撤销旧 activation，并 goals.get 回读确认 id/phase/revision 不变、activation=disarmed。无公开能力且无法证明旧 Goal 已退役时保留准确宿主能力阻塞；不修改 DSH，不冒充人类 pause/resume，不以 complete/blocked 收口未完成 Goal。独立浏览器协作不会自动成为原生接任，须使用该受控流程；这里不提供跨会话 Goal 迁移或自动 rearm。

显式 `task.control action=end` 仅终止所属持续队列项；页面 `continuous.end` 对未开始项直接保存终态，对已执行项沿用同一控制路径。根会话及其原生子执行使用宿主公开取消，运行作业使用准确 owner 的 `jobs.kill`，等待 idle 并 flush 后核实停止，再移入历史和释放槽位。related/review/retired 关联本身不授予停止权。终态输出、子通知尚未消费或输出交付观察能力不可用只阻止业务完成，不单独阻止放弃队列处理；结束仍以准确 owner 的公开作业列表核实 running/stopping 状态，未知实际活动不放行。保留原结果及 unassessed。未知活动或停止失败保留结束请求和位置，页面可重试结束。此操作不写 Task.completion、不置 progress=done、不关闭 Issue，也不因外部 Closed 推断验收。 已接受或已生效的 end 同时约束原生自动输入的恢复请求、候选选择与取得槽位的提交事务；即使结束在候选选出之后才落盘，事务仍重读该事实并拒绝覆盖为 resume。新输入保留在事件记录中，不重新授予处理权。 普通执行在 host.ensure／会话标题更新后回读到新 end 时保留 accepted，释放当前 execution lease 后交专用结束恢复，不走 wait/pause/resume 的 applied 写入。通用控制等待 settle 后若 commandId 已改变，立即让出，不再唤醒或投递旧控制下的业务输入。

## 持久化与恢复

- 稳定事件身份贯穿接受、入队、投递和消费；这些是不同确认点。交接期间仍可持久化新事件，慢创建不阻塞事件落盘。
- 创建后继、接任、发送消息和确认回执之间均有恢复点。重试复用同一个操作、后继和消息身份，并结合宿主公开日志回读；不承诺跨存储原子提交或外部副作用恰好一次。
- 验收结论与完成意图先可靠记录到执行协调记录；完成事实只有在发布到主存后才成立。不得在主存仍为待发布时通知父任务“已完成”，也不得把本地记录当成完成事实。
- 完成后不因可选的外部收尾失败继续驱动模型。独立同步恢复只处理已有操作，不能重新授予协调权或重跑任务。
- 升级在安全边界迁移旧任务、会话、固定后继、消息与 watch 引用，保留唯一映射和进行中的操作身份。旧新运行器不能同时写同一协调记录。

### 持续队列的宿主观察恢复（#299、#300）

后台恢复依赖真实 `agents`、`sessionController` 和 `sessionQuery` 三个服务就绪。控制器已注册不等于会话观察服务可用；本地浏览和来源查询仍不需要这些执行服务。

旧版本在会话观察服务缺失时会持久保存 `recoveryBlocked` 和准确错误 `Cannot read properties of undefined (reading 'observeSession')`。对此已确认的只读观察失败，周期恢复重新通过当前 Execution 的正式 failure 观察读取真实会话日志；读取仍失败则保留原保护。恢复先在调度锁内扫描队列已绑定的准确 ExecutionId／TaskRef：当前主会话确实 running、实际配置已确认且没有业务 wait、用户 pause/end 或完成事实时，补回遗失的槽位，再观察旧槽位的收尾，最后才安排候选。历史、子会话和无关会话运行不构成恢复证明。

正式 failure 观察按当前会话日志区分轮次：有更新的 `turn/start` 且当前 Agent 仍 running 时，上一轮 provider 错误可被真实新轮次取代；原生用户 Stop（`aborted` 且 `reason.kind=user`）必须沿用已有显式恢复／业务输入的确认语义，普通状态问句不构成确认。人工消息 ingress 在正常对话执行前观察当前执行，保存尚未协调观察的 Stop；观察失败不拒绝原生对话，关闭自动纠正也不关闭此取消事实观察。后续无失败或正常 `turn/end` 不删除未确认的 `userCancelled`，其状态问句及工具不重新取得业务槽位；已有在途占用仍需通过正常安全结算才能释放，不能只凭用户停止标记提前释放。没有新轮次事实的空闲或冷会话继续保留其最后失败。观察提交同时核对 ExecutionId、owner、epoch 和准确 Session；排队项的投影还须匹配当前规则与执行关联。成功观察后，只清理已被事实推翻的旧 interrupted／model-turn、idle-without-progress 和 observeSession 保护；若仍有真实执行错误、接续错误或当前未解决的 runtimeFailure，则继续 blocked 并呈现真实原因，不把旧保护文案留作当前错误。

业务等待、人工暂停／结束、尚未完成的维护以及未知创建或结算结果继续独立成立，不以 running 或观察成功解除。没有新输入的空闲执行按正常安全结算让出槽位，不自动发送续跑消息；其他未知结果沿用带当前 ExecutionId、owner、epoch 的 `task.reconcile` 或明确 `task.control resume`。恢复保持 Task、Execution、Session、owner、epoch、模型和权限，不创建替代执行。遗失槽位与旧保留槽位并存时，实际 running 已占满容量便不唤醒旧 idle 工作；仍需安全收尾的槽位保留到正常结算，结束后再继续有序轮转。

回归入口（仓库根目录，Node 22）：

```sh
PATH=/root/.nvm/versions/node/v22.23.1/bin:$PATH pnpm exec vitest run tests/work-continuous-integration.spec.ts tests/work-continuous.spec.ts
```

真实 Agent 场景让 `hold_recovery` 工具保持运行，注入历史协调保护并保留或移除槽位；`continuous.status` 应显示同一个执行 active、占用恢复、错误清除，模型请求与 Task 数量不增加。另一路先由真实模型循环记录 provider 失败，再由原生人工输入明确继续、开启新轮次，确认正式 failure 不再把上一轮失败当作当前结果。原生 Stop 回归使用公开 `Agent.cancel({ kind: 'user' })`，随后同一 Session 仅问状态并执行 hold 工具，分别覆盖已持久观察停止、未观察停止，以及状态问句正常完成后才扫描（关闭自动纠正仍保留观察）；三者均保留未确认的用户停止，不授业务槽位。初始红灯日志 `/tmp/issue-300-user-stop-red.log`（2 失败）；正常结束先于扫描的补充红灯 `/tmp/issue-300-user-stop-idle-red.log`（1 失败）。工具返回后，非用户停止的原槽位经正常空闲结算释放，下一项取得槽位。负例覆盖观察期间 owner／epoch／Session 改变、旧 ExecutionId、历史／关联会话运行、真实错误、wait/pause/end 以及容量已满时的旧待投递输入；数据从宿主事实进入执行协调记录，再由只读查询投影，业务规格与验收不随恢复改变。

显式恢复仍沿用准确 ExecutionId／owner／epoch 的既有入口：`task.control resume` 和 `task.input kind=input` 确认已观察的停止；受管项的显式 `task.reconcile` 重试也确认该用户停止，`kind=result` 只排队不确认。这些明确命令在接受前先验证 TaskRef、ExecutionId、owner、epoch 及可信当前 Session actor，再于 DAO 写锁外读取该准确主会话的已有宿主失败，把尚未落盘的 Stop 纳入同一次既有确认逻辑；异步返回后的观察提交与命令接受仍分别核对当前身份，新的失败身份不被旧观察覆盖或确认。观察失败保留失败结果，不记录成功恢复回执。相同 commandId 重放只恢复原回执，不重新观察或确认后来发生的 Stop；completed／end 不重新取得处理权。无需新增状态、token 或未来观察中的通用 resumeRequested 确认。

直接恢复回归使用真实 `Agent.cancel({ kind: 'user' }) → whenIdle → task.reconcile`，中间没有原生状态问句或 `reconcileControls`。必要 result 在 retry 后、首次调度前作为已接受事件到达；一次明确 retry 后应实际执行并在下一次协调中保持 active 和唯一槽位。另覆首次明确 resume、可信当前 Session 的 input，以及第二次真实 Stop 后重放原 commandId 仍保留未确认取消。边界负例验证错误 TaskRef／owner／epoch、历史 Session actor、宿主观察失败，以及读取期间 owner／epoch／Session 改变不落盘或确认旧观察；观察内的独立 DAO 写入完成同时核实没有持有 writer 锁。红灯 `/tmp/issue-300-unobserved-stop-red.log`（1 失败，首次 retry 后仍 blocked），定向绿灯 `/tmp/issue-300-unobserved-stop-green.log`，受影响宿主／continuous／guard／end 范围 `/tmp/issue-300-unobserved-stop-affected.log`（5 文件、174 项通过）；现有 execution／lifecycle／boundary／continuation 回归 `/tmp/issue-300-unobserved-stop-execution.log`（4 文件、77 项通过），`pnpm typecheck` 通过。

只加强停止保留而未保留 reconcile 确认时，真实回归在重试运行后失去槽位，红灯见 `/tmp/issue-300-user-stop-reconcile-red-final.log`（1 失败）。同轮补槽扫描已见准确当前会话运行时，保留这次观察的 ExecutionId、owner、epoch 与 Session；逐项读取前或失败观察期间正常结束的，只有身份仍匹配才沿用该事实淘汰旧保护，再由普通空闲结算重读当前结果并安全释放；不把当前时刻不再 running 当作保留旧保护的理由。完整回归与开发发布记录见 [#300 验证说明](../verification/issue-300-running-recovery.md)。测试使用真实 Agent／公开取消／持久化与工具执行，外部模型输出受控。

## 实现覆盖

当前主干已经具有独立 TaskRef、TaskExecution、Project Agent、owner/epoch、持续处理规则、事件收件箱及完成发布恢复记录；早期“仍仅以项目根/Issue 寻址”的实现描述已过期。这些身份和记录并不证明本决策的全部边界或 GUI 已验收。#274/PR#282 后端已交付；#275/PR#285 页面与 #276 整体验收尚未闭环，具体运行缺口见上述核对矩阵。计量仍须区分近似投影与实际路由预算，不承诺硬窗口保证。

新增实现与真实模型验收使用既有隔离开发入口 `https://dsh-dev.e5box.a2d2.dev/`；正式运行只读核对入口为 `https://dsh.e5box.a2d2.dev/`。不以历史 18780/18781 实例替代当前验收，也不因文档核对升级或重启正式服务。


## 未返回子工作随接续转交（#342）

`ContinuationOperation.pendingChildren` 保存观察快照，`work_read continuation` 可再次读取；收到交接不把原生结果标为 completed/consumed。旧未完结 operation 在正常恢复时使用同一规则，固定 operation/successor/epoch，不自动复活历史终态。运行中子工作与 unknown、未完工具不阻止接续；Task 完成仍检查全部相关执行事实。

后继用 `work_child_recover(child_session_id, action, expected_epoch)` 接手准确子工作：`status` 只观察；`result` 返回真实最新 turn 的 JSON 字符片段，每页不超过 12000 字符，以 `nextCursor/revision` 读到完整；`resume` 通过原 direct-parent 的公开 `subagents.sendMessage` 恢复同一 childId，不 reparent，不给退休主会话投递业务输入。running 不重复启动；正常 completed 返回先读结果，interrupted/error/aborted 等结束允许继续剩余工作。宿主公开 query/resume 对崩溃 turn 的错误闭合不等于业务成功，插件不修改日志。

恢复请求先持久保存固定 requestId，再把标记放入真实消息；重试读原生 inbox insertion/user/message，或直接返回已运行/已结束状态。完整结果接收记录另存 child/endSeq/epoch/全部分页 callIds。完成门回读当前协调会话的准确成功 `work_child_recover` tool/result、结果 revision 与最新 endSeq，全部页面真实交付后才解除该结果门；单独写接收声明、未读完、错误结果、新一轮 child 或旧 epoch 均不足以通过。原生 parent 通知 consumed 与插件当前协调接收是两项独立事实，业务验收仍需成立。

若递归子会话的原 parent 自身冷却且普通 SessionController 无恢复权，工具返回 `child-recovery-parent-unavailable`，包含准确 parent/child 与宿主错误。插件不隐式唤醒整条层级；当前协调先核实旧执行已停止，再按保存的工作区和进度显式重新委派剩余工作，不复制仍在运行的执行。此限制不阻止接续，且不能假报已恢复。已完成 Task、pause/end 与维护阶段不允许启动子工作。


### 无法恢复时的可核实替代处置（#342 review 修正）

明确停止的旧 child 可以由当前协调重新委派，但重派本身不清除旧失败门。`work_child_recover action=replace` 带 `child_session_id` 与 `replacement_child_session_id`，必须先满足：旧 child 最新 returned/endSeq 可读、旧 child 及可见后代无运行或未知活动/未完工具/活动作业；替代者是当前 Task 当前协调真实 catalog 下的另一个原生 child，最新一轮 completed；当前协调已用 `result` 完整接收其全部分页且真实成功 tool/result 可回读。不能用说明文字、未运行的替代 child 或其他 Task 的 child 解除旧门。

执行协调记录持久保存旧 parent/child/endSeq、替代 parent/child/completed endSeq 与作出处置的协调会话/epoch/command。完成观察重新核对旧执行仍停在该 endSeq、替代者仍是该 completed endSeq、当前代次已正式收取替代结果，才解除旧 unfinished 与原生结果等待门。旧 interrupted/error 日志和 native consumed 状态完整保留；旧执行重新启动或替代结果版本改变都会使绑定失效，其他工具/作业门不被豁免。替代绑定写进后继交接与 `work_read continuation`；后续换代可通过本 Task 历史协调的真实 catalog 再读准确 child 结果，不能因旧接收 epoch 失效形成不可解除的等待。


### 退休 parent 的真实结果通知回到当前协调（#342 dev 验收修正）

同 ID 恢复的 child 仍把原生 terminal notice 发给原 direct-parent。插件在既有启动、idle 与兜底 reconciliation 中，仅观察本 Task 已持久 pending、恢复或替代关系下的准确 parent/child，核实原生 header/descriptor、最新 endSeq 和首次持久 notice 身份，再向本 Task 当前协调收件箱写 `a2d2-work-child-result` 结果事件。事件 ID 来自 execution/parent/child/endSeq/原 noticeId，与会话代次无关，重载或重试不重复投递；不伪装原生通知，不改变旧 parent 的原生 consumed，不让退休 root 执行业务，也不创建新 Task。

重复巡检已记录的准确稳定通知 ID 时沿只读路径复用事件，不为无新增通知开启 DAO 创建事务；缺失通知仍在原事务内核对 owner、epoch、当前会话、完成／结束事实并去重。宿主观察期间快照可能变旧，因此 pending 通知投递前仍回读当前 owner／epoch／会话、准确事件的存在和 pending 状态、维护及业务控制条件；通知的持久接受、投递和消费继续分别记录。

当前协调的 model-owned executor wait 复用既有自动恢复准入：等待的准确 child、当前事件完整 envelope、持久 Task event 与新的真实 terminal notice 都必须吻合。人工 wait、pause/end、完成 Task 和未解决错误不被解除；通知在暂停中只持久保存，明确恢复后沿普通 Task 事件投递。无 continuous rule 的 Task 同样可由该通知自动恢复。接收通知只允许核实结果，不是 `childReceipts`、结果完整读取或业务验收；当前协调仍须调用 `work_child_recover result` 读完实际结果。旧通知不能重复唤醒后续 wait，新 turn 必须有自身最新 end/notice 身份。未返回 child 与公开 query 为崩溃生成的 interrupted 闭合没有真实 notice，不生成这种自动唤醒。
