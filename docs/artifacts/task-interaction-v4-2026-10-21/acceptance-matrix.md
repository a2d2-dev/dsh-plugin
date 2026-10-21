# 最终验收矩阵：目的／步骤／记录

本表是后续验收工具准备，不是通过报告。所有“待验”均为**未验证**。现有基线见[报告](README.md)；部署及继续机制见[升级方案](upgrade-and-continuation.md)。四个实现片与 host142 交付、独立完整新／回滚宿主、实际部署授权就绪前，不开始本表的执行lane。

## 对象与分层

- 只读来源：a2d2-dev/dsh-plugin、自身Project1。freeland / Project14只观察；不得开始其工作、配置持续规则、发消息、改Issue或关闭对象。
- 写对象：后续明确登记的专用本地Task/Session与 a2d2-dev/dsh-plugin 测试Issue，名称/正文标明 `A2D2 V4 ACCEPTANCE #141`。当前一个也未创建。记录registry包括TaskRef、canonical Issue nodeId/URL、runtimeId、ExecutionId、owner/epoch、每个SessionId、job registryEpoch/instanceId及用途；把明确新增 `kind:id` 输入retention allow-list，不放宽旧对象。
- L0静态制品与公开合同；L1只读保留/页面；L2确定性回归；L3获授权真实模型/专用对象；L4同URL刷新/既有服务重启。L0/L2通过不等于L3/L4通过。
- 每项记录真实命令/请求ID、退出码或具名错误、脱敏结果文件SHA、desktop/narrow截图、前后计数。没有证据写“未验证”，未知状态写unknown，不能填mock或固定计划冒充模型。

| 目的 | 步骤 | 记录（当前） |
|---|---|---|
| 固定整合与宿主版本（L0） | 固定最终plugin+host142 commit；typecheck/针对回归/完整build/pack导出；独立host smoke；核对tgz→client→实际profile client。 | 待验。工具base bfc0826；当前dev host a45068d；缺CLI入口已冻结。新host capability/全动态导入和可执行旧host回滚未验证。 |
| 保留原身份、材料、配置（L1） | 部署前结算flush后capture两个既有实例；保留runtime/Project/Agent/Task/source/index/Execution/currentSession/历史与所有原Session；部署后同origincapture并retention比较。旧cwd/model/preset/permissions与原规格正文不可漂移。 | 准备完成：78 GUI /3 preview Session、preview64 records的私有基线与公开摘要；检测工具4项行为测试通过。GUI phase1旧域材料与实际有效权限覆盖缺口仍须补。 |
| Project来源添加（L1/L3） | 粘贴本仓库Project URL，确认前观察真实名称/组织/类型/访问；明确确认才添加。错误账号/权限失败/有效空结果区分；原Project14只读。 | 待验；不得自动调用模型。记录canonical id、来源标签、访问响应、明确确认前后副作用计数。 |
| Repo来源添加及去重（L1/L3） | 专用来源输入仓库不同合法URL形式，重复添加与来源切换；保留Project view/切片入口。 | 待验；标签唯一、canonical key和浏览范围，不把来源当新业务Project或执行资格。 |
| 真实views／Issue／PR（L1） | Project展示概览/项目/Issue/PR；仓库概览/Issue/PR。对照真实GitHub view/filter数据，逐页与总量比对，缓存/读取中/无权/不可用/空列表均可辨。 | 待验；不把全列表当view。记录真实view id、筛选、分页完整性、Issue与PR nodeId；PR合并不等于本地验收。 |
| 同Issue跨来源唯一（L3） | 同一专用测试Issue分别从Project与Repo访问；首次明确开始，重复点击、刷新与跨来源进入。 | 待验；TaskRef/Execution/currentSession相同；启动/Session/模型计数只发生一次。若跨领域归属不同，显示已有归属，不建副本。 |
| 独立父子Issue（L3） | 在本仓库专用父/子测试Issue建立关系；分别查看负责人、入口、规格与验收。先验子再父。 | 待验；独立TaskRef、负责人和验收事实；父子Task与会话父子分别记录。单个子完成不冒称父完成。 |
| 统一执行与协作状态（L3） | 专用Task显式创建协调/实施/评审、关联会话和子Issue；打开统一详情，观察running/waiting/paused/failed及历史。 | 待验；用途/owner/epoch/有效入口真实；关联或评审/最新时间不能抢协调权。 |
| job观察不消费（L2/L3） | 专用真实job运行中与终态分别调用公开observe/readAt；观察前后游标和终态交付不变，再由owner真实job_output收取。试其他owner应拒绝。 | 待验；记录registryEpoch/jobId/instanceId、pending→collected、标准tool result.meta持久回执。collected不写consumed或业务验收。 |
| job重启身份与历史（L4） | 在专用已结算job记录旧身份；获授权重启后查历史与新job，不能按相同jobId重配旧结果。 | 待验；旧registry丢失显历史/不可恢复，不能假报运行或强行杀当前工作。重启前先结算所有真实在途工作。 |
| 具体决定自动接续（L3） | 给专用Task两个可核验具体决定，如“保留3个镜像并保留stable标签”；真实模型保存决定/证据/待办/下一步；按公开预算观察设专用阈值，自动触发而非点手动按钮。 | 待验；记录真实request route、tokenMeter、logRevision/window/输出预留与automatic=true；模型实际复述原决定/证据SHA。不能借历史v3结果。 |
| 正式接任才切入口（L3） | 在准备、收结果、创建后继、taken、delivered各阶段观察旧/新入口；故障后重试。 | 待验；Task/Execution不变，source/successor/operation/epoch时序准确；正式接任前原段仍协调；重试复用固定后继与kickoff，不重复投递。 |
| 原段失权与关联导航（L3） | 接任后打开旧Session只读历史及“进入当前处理会话”；尝试旧段协调/工具写必须受围栏拒绝。 | 待验；新段入口正确、旧段失败理由可见；不新增会话或模型请求；聊天单标题、任务链接/上下文指示正确。 |
| 待收结果与失败恢复（L3） | 专用children/job终态但未收结果时触发维护边界；然后真实收取结果，重试准备/接任；模拟仅专用执行的可恢复失败。 | 待验；pending解除依真实收取回执；已处理失败进入历史；不把按钮点击/投递当模型消费；无永久等待或重复继任。 |
| 自然语言真实计划（L3） | 后续明确模型授权后输入两项专用测试工作，真实模型生成顺序、理由、下一步及新建/复用方式；保留原话/授权来源/计划版本和依据。 | 待验；真实gateway/adapter计数、requestId/Session/route与响应证据。失败显示失败，无固定计划fallback。 |
| 预览零执行与零启动（L1/L3） | 获取计划预览，观察Task/Session/job/队列数量；刷新、浏览与切来源。计划生成可有明确授权模型调用，浏览不得额外调用，预览不得领取执行。 | 待验；区分“计划生成模型计数”与“执行启动计数”；开始前新执行/会话/队列领取为0。不把模型预览误写总模型0。 |
| Block持久边界（L3/L4） | 以自然语言Block某专用测试Issue并重规划，换来源/刷新/重启后再规划；服务端尝试越界候选。 | 待验；Block名单版本持久、所有后续计划排除且服务端拒绝，保持既有规则范围；外部文本/模型输出不能扩授权。 |
| 暂停与在途收尾（L3） | 明确启用两项专用序列；第一项进行时暂停；让在途自然收尾再观察下一项；等待项保留身份、安全让槽。 | 待验；暂停后不新增领取，不杀在途、不丢结果；等待/暂停/Block含义可辨，身份不重复创建。 |
| 两项串行（L3） | 明确开始两项已确认专用计划；第一项未验收时观察第二项；第一项本地验收和收口后观察第二项接入。 | 待验；服务端资格校验、同时执行数≤1、每项唯一启动；排序/依赖/负责人/资源校验真实，不能用UI顺序冒充调度。 |
| 本地完成与远端关闭补偿（L3） | 专用本仓库测试Issue先本地验收落盘，再执行收口/父通知/外部关闭。只对该对象制造可控同步失败或拒绝，再恢复。 | 待验；完成事实先持久、外部失败独立待补偿；未知回执先观察再重试；重试不重跑模型/本地工作，不误关业务Issue。 |
| 浏览器关闭／刷新恢复（L4） | 关闭自己的浏览器后等后台真实观察，再以同origin打开并刷新；验证来源/计划/Block/执行/接续/输入草稿与当前Session入口。 | 待验；后台活动真实时间和新浏览器记录；建议仅填草稿不代发；刷新不调用模型/启动工作。 |
| 既有preview升级重启（L4） | 使用服务外one-shot，独立新/旧host制品、完整动态导入和维护回执齐备才stop指定preview；同10.126.126.12:18782刷新核对版本、retention、桌面/窄屏。 | 未执行；dry-run应拒绝当前缺项。preview当前baseline截图不能当v4升级通过。 |
| 实际GUI18781自升级（L4） | preview真实完成回执作为前置；CEO/children/jobs结算、hold+flush后，由已有系统管理器one-shot切换指定dev程序；观察者在被重启服务外。 | 未执行；原URL仍18781、原Session身份不变；记录cgroup、unit、PID、持久completion.json；不能依赖被杀主会话等自己，也不能nohup。 |
| 回滚与机器接续（L4） | 在专用维护窗口的真实失败条件触发回滚；恢复独立可执行旧host/profile/launcher，保留新增数据；由外部观察同URL、查持久成功/失败回执。 | 未执行；不能仅备份conf。正式DSH输入/任务通知若使用需真实机器来源/owner/epoch，不伪造人类消息；当前无通知适配器。 |
| 最终安全评审与收口（全部） | fresh安全评审逐项裁决；核对真实commit/PR/tracker、截图/日志/对象范围；只在实际通过后报告对应层次。 | 待验。不合并、不关闭#141；准备分支push后交父会话。 |

## 模型lane与证据格式

历史 `scripts/a2d2-v3-121/acceptance.mjs` 的规范化私有tmp、SHA、positive/baseline/check与 `guard.mjs` 的gateway+adapter双计数方法可复用；**不能对既有实例运行旧prepare/run/seed**（会安装/新开服务/创建会话）。旧guard禁模型，只适用于明确隔离的no-model控制，不得装到最终real-model lane后报告真实计划通过。

`assert-evidence.mjs` 是离线格式/证据SHA与计数校验器，不会发请求；没有instrumented same-process before/after就不能写0调用。real-model必须另有直接授权记录（requestRef、专用SessionId名单、maxGateway/maxAdapter），禁用适配器明确为false，计数有增长但不超额，并关联真实request provider/model/session及持久模型响应。当前只读采集未安装计数器，因此只报告“采集器没有发模型命令”，不宣称整个活跃实例0调用。当前parent/children的正常调用不属于本验收预算，也不阻止它们运行。

示意输入字段如下；这些是字段契约，**不是实际观测事实，不可提交为已通过证据**：

```json
{
  "lane": "real-model",
  "guardDisabledAdapter": false,
  "authorization": {"source":"direct-human-real-model-authorization","requestRef":"真实授权引用","sessionIds":["专用SessionId"],"maxGateway":4,"maxAdapter":4},
  "counts": {"instrumented":true,"before":{"processId":"真实进程代次","gateway":0,"adapter":0},"after":{"processId":"同一代次","gateway":2,"adapter":2}},
  "actualRequest": {"provider":"真实provider","model":"真实model","sessionId":"专用SessionId","responseEvidence":"真实持久响应证据引用"},
  "facts": [{"purpose":"模型实际复述具体决定","status":"observed","path":"私有脱敏证据文件绝对路径","sha256":"文件真实SHA256"}]
}
```

格式通过不代表语义验收通过，仍须逐项检查模型决定、工具副作用、跨接任行为与真实页面。公开报告只放脱敏摘要和经检查的截图；cookie、token、原始header、原文备份及完整浏览器state仅私有tmp。
