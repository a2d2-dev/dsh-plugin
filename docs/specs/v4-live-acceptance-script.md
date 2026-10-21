# v4 既有预览真实验收执行脚本

本脚本是 #136／#141 的验收范围定义，供 QA 完成准备后执行。当前不是执行授权，也不是已通过记录。目标只限既有 18782，之后才切实际 18781；不启用或处理 freeland／Project14 业务 Issue。

## 安全范围与模型证据

- 仓库使用已确认为 PRIVATE 的 a2d2-dev/dsh-plugin，自有 Project 1。只创建明确标记的专用验收 Issue／标签／Project items；不得修改现有开发 Issue 或其 Project 字段。
- 真实运行前读取已有持续规则，确认新 fixture 不会被旧规则接入；若存在冲突，先给出保持原规则的隔离方案，不能悄悄暂停用户原规则。
- 先准备六项 fixture 的精确 body、期望、标签、assignee 与 nonce 清单；在 preview 切换验证通过、父会话下达实际验收阶段指令后创建。记录真实 nodeId／number／URL／Project item ID，禁止编造。
- 一个共同 run 标签标识所有 fixture；只有串行 A/B/Block X 使用独立 serial 标签，规则硬范围限定该标签及当前账户。自然语言仍由真实模型理解并产生理由／下一步／复用判断，不能用固定计划代替。
- 所有 Task／Session／文件／规则由 nonce 标识，执行目录为明确隔离验收 workspace。不得 clone 或修改本仓库业务代码，不让模型对其它 Issue 工作。
- 模型调用由真实 request／header／runtime trace 证明 provider、model、reasoning；不能用模型自报。QA agent 本身沿既定 medium 通道；应用内模型选用已配置且明确记录的路由，不在失败时静默换组。
- 新增独立评审 Session 必须真实阅读专用成果并给结论，用途明确；不要把别的任务的历史会话假装成本次新执行。使用正式 host／UI／SDK 能力，不能合成 parent／owner／consumed 行。

## 六项专用 Issue

| 代号 | 目的 | 准备和完成条件 |
| --- | --- | --- |
| P | 父汇总、统一执行、具体决定接续 | 原生子为 C 和 E。父只验收专用资料，保留已确认“镜像保留数量3、必须保留stable标签”；必要子结果成立后才可报告 done；等待测试器明确完成阶段，不提前关闭。 |
| C | 真实本地独立子工作 | 创建自己的小型 proof JSON，完整本地验收，保留自己的当前 Session／owner。不得在父 Session 冒充完成。 |
| E | 外部已交付子结果 | 由测试器实际生成可核验 proof／checksum 并以专用说明记录交付，真实关闭其 Issue。父须读取资料并记录外部验收证据；仅 Closed 不足。不为 E 自动创建 Task／Session，不伪装成其它真人。 |
| A | 自然语言计划第一项、等待让槽、关闭冲突 | 写独立 proof。先进入明确等待；测试器改变一个纯验收标签制造真实版本差异，不改要求。收到继续后核对并验收，请求外部关闭；预期本地完成、远端冲突可见，不重做。 |
| B | 自然语言计划第二项、正常关闭 | 仅写自己的 proof，实际收取所需结果后验收并正常关闭专用 Issue。验证一个真实成功 GitHub mutation。 |
| X | Block 名单 | 纳入候选资料但显式 Block，未解除前不得创建 Task／Session／文件；解除也不应自动执行旧计划。 |

这些 fixture 是行为验收对象，不是分派给开发团队的新工作。保持独立标签，避免被其它自动化当开发票领取。

## 目录与身份走查

1. 从真实页面粘贴 Repo 链接：识别后再添加；重复链接打开同一来源；添加／浏览阶段记录零模型生成、零工作启动。
2. 添加自有 Project1 来源，保留真实 view URL／参数；只把 P/C/E/A 的专用条目加入 Project，不动原条目。Project四页与Repo三页、概览/Issue/PR、真实字段和分页／partial／error／empty可见。
3. 先从 Repo 开始 C 或 A，再从 Project 打开同一 Issue；TaskId／ExecutionId／当前Session完全相同。返回列表保留来源和筛选，不让旧响应抢新页面。
4. Project14只能只读观察真实树和状态；不以已有研究或旧截图当当前读取通过。

## 父子、协作与接续

1. 建立真实 P→C/E 原生关系，P/C各自入口清楚；P未验收子结果时报告 done 必须拒绝，Task不假 completed、不关闭远端。
2. C通过自己的真实执行验收后，父可见真实结果；E只通过实际资料和明确外部验收证据采纳，不把源 Closed 直接映射成本地完成。
3. P在自己工作中发起一项真实 native child／协作与后台 job，明确用途和实际 owner；必要时另建真实只读评审 Session并显式关联 review，用其真实结论，不能只改标题。
4. 记录 job running→terminal待收→正式 job_output／控制器收取后的状态；未收结果时过早 done 不封死收取，实际入账后再次负责者报告才完成。
5. 为P已有真实token meter设置正式自动接续目标，允许针对专用执行降低阈值到测量值以下；不注入+30K、不伪造meter、不只点击手工接续。确认 operation.automatic=true。
6. 准备期间入口仍旧段，正式take后Task/Execution/owner身份保留、epoch/当前Session更新。新段实际复述“数量3、stable标签”及未完成项，再继续。
7. 保留输入草稿；点击建议只填框，不发送。Issue顶部仅一个策略编辑入口，Issue/原生聊天接续参数可直接查看；历史只读不恢复旧协调。

## 自然语言与串行闭环

1. 保存委托原话，真实模型预览 A/B 有序列表，显示理由／下一步／新建或复用；记录模型调用发生但零 Task execution 启动。
2. Block X，补充自然语言重新预览，X仍排除；严禁启用任何包含现有真实开发 Issue 的安排。硬标签范围与预览 node ID allow-list双重核验。
3. 明确启用后，A开始并进入等待，安全让槽后B才推进；B正常验收／关闭后，给A真实继续输入，A重获槽完成。允许的实证序列是 A-start→A-wait→B-start→B-done→A-resume→A-done；全程至多一项自动推进。
4. 在途 Block／暂停只影响后续接入，不能强行终止当前动作；恢复与重新安排仍遵守原owner／资源及Scope。
5. A的真实标签版本变化造成关闭冲突后，记录本地完成与远端Open/冲突。测试器从GitHub解决并关闭专用A，再点击补同步；同一CompletionOp／Task／Execution／Session保留，没有新增模型执行。未知回执故障窗口另引用合同测试，不谎称强制造出了GitHub outage。
6. 关闭浏览器后观察宿主持久推进；必要受管重启后读回规则原话／计划／Block／Task／Session。暂停新验收规则并关闭残余fixture，不删除数据或恢复旧数据覆盖新输入。

## 证据与清理

中文报告每场景写目的／步骤／记录，区分真实模型、确定性合同、运行页面和静态夹具。记录实际model request、budget meter、ids/epoch、source观测版本、命令exit及截图桌面／390px；截图里不能带口令／cookie／token。

原78 GUI／3 preview Session及旧64域记录按保留规则比对；新增对象只允许本run清单。保留proof和Issue引用。测试结束只停新验收规则、关闭明确专用Issue、按需从Project移除本次item；不删除用户数据、不触已有业务自动化。

最后先完成原18782运行验收，再通过已审可回滚服务外流程切实际18781并刷新同URL；同一证据格式验证新入口、原会话／目录／实际模型权限和数据。没有这些记录，整体目标不标完成。
