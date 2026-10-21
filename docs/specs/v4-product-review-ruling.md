# v4 产品候选：一轮双轴评审裁决

固定候选 [Draft PR #149](https://github.com/a2d2-dev/dsh-plugin/pull/149)：feat/v4-integrated / `19a6bec31e2723d4c6e7e8d2c6bb83de4f8428e8`；base spec/dsh-control-panel-v3 / `b477025116110f63d3488e0c71e47468ad882844`。CEO 已独立核对 merge-base、本地／远端／PR head、tracked clean 与 128 路径差异。两轴均 fresh context，经 code-review 实际派发 codex/gpt-6.1-sol／xhigh，未继承实施上下文。

## Standards

session-84020108-4b3f-4c39-93ff-29bdd4d78dcf：**REQUEST_CHANGES，2 项硬标准问题。**

1. **P1：完成栅栏阻断必要结果收取。** ADR0003:14 要求完成后执行收口可恢复，执行架构声明原生 job_output 能解除待收围栏。work-progress:73–75 可在 pending job 时提交完成；work:76 随即禁止该 owner 推进，dsh-host:46–49 对 job_output 同样 deny。实际源码方法的纯内存探针中，合法报告完成后 jobOutputAdmission=deny，observation 为 job-unsettled，补收口保持 pending。
2. **P2：原生关系导入绕过完成态保护。** ADR0003:12 要求采纳外部观察时校验当前完成状态，ADR0006:10 要求应用强制不变量。source application:50–52 直接修改 parent.children／child.parent；source.import 在 work:981–982 提前分派，绕过后面的完成／交接保护。父已完成后导入原生子，父仍 completed 却新增 planned 子 Task；快照仍通过，交接期也可被同路径改结构。

Possible smell：work.ts 同时承担计划、调度、完成恢复和查询，possible Divergent Change；这是判断项，不要求本票大重写。

已核对来源范围／缓存、显式启用与 Block、owner/epoch、scope/seal、维护/flush、HTTP UUID、模块映射及迟到响应。未发现新增 skip／soft assertion／放宽预算。没有把未部署或已知环境超时当源码 finding。

## Spec

session-406180bc-8090-40a1-a146-a9544cba0828：**REQUEST_CHANGES，2 项 P1；未发现 scope creep。**

1. **P1：终态缺少待收原生结果的正常收尾路径。** 交付规格:31 及整合检查点:28 要求可靠收口。done 可在 continuable 子会话仍在途或通知未消费时提交；之后源 pre-step／工具失去资格，但 host:94–97 要 settled notice 实际进入父 user/message 才消除 pending。补同步只观察，continuous 槽无法释放。实际源码方法、内存宿主事实连续三次恢复仍 guard=false／closeout pending／maintain=0；现有测试只是翻转 fixture settlement，不能证明真实解除。
2. **P1：父验收漏查已知原生必要子 Issue。** 交付规格:32 要求子项分别验收。source application:25–27 仅两端已导入且同 Project 时链接本地 children；work-progress:57–65 只遍历该集合。只导入父时，已知开放子未导入、canonical 属其他 Project 或 subIssues.hasNextPage=true，报告 done 仍成功。纯 Node 原方法已复现 stage done／completionCreated=true，而原生子仍开放且资料部分读取。

维护锁环候选已撤回：真实公开 runMaintenance 遇 active work 同步拒绝；先前队列锁模拟不符合合同，不构成 finding，不要求整改。旧 #123／#129 等范围与运行实例里程碑未加算为本票源码缺失。

双轴统计：Standards 2 项，最重完成收口 P1；Spec 2 项，最重完成收口及父子验收 P1。两轴保持独立，不用一个轴抵消另一个轴。

## CEO 裁决

CEO 已亲读所引报告、终态 guard、来源层自动关系变更与提前分派，确认固定 base 及反例路径。三项都保留为当票整改，不借此做全库重构。

### 修 P-F1：完成与待收结果可终止

- 业务验收成立前，必要的原生子结果／后台结果必须有真实收取及负责者核验路径。资源 flush／收口可在业务事实后完成，但不能先创建不可逆终态再让负责者失去收取资格。
- 首选拒绝过早 done，返回具名待收原因并保留现有 owner／会话正常收尾；也可保存明确“待验收候选”，但它不是完成事实，且新结果到来后必须由负责者重新确认，不能仅等状态翻 settled 自动采纳旧结论。
- 不简单重新开放所有 completed Task 的普通推进，不 fake consumed，不因为 reporter 正在执行 work_report 就等待自己 whenIdle 形成新死锁。必须区分本次受信报告自身与其它在途工具／结果。
- 红→绿须组合真实 native continuable 通知及 job_output：过早报告不锁死；结果实际进入消息账本／正式收取后可重新验收；父通知／外部关闭不提前；完成槽最终释放，且无第二 owner／Session。

### 修 P-F2：原生必要子范围不可隐式跳过

- 本地 children 不是源原生必要子项的完整证明。默认从父 Issue 接入时，核对已接受的源子范围与读取完整性；未知／分页未完整不能当无子项。
- 跨 Project canonical 子须使用其真实 Task 及验收事实；不能只因不在当前 project 的 children 集合就跳过。
- 未导入的外部子可以由负责者在明确范围内记录可核验的外部已验收结果（可复用现有拆解／证据机制），不强制启动别人的任务或机械创建会话树，也不把远端 Closed／PR merged 自动当本地验收。已有 canonical Task 时不得借外部记录覆盖它未完成的事实。
- 原生关系是观察材料，已接受的业务范围及必要性裁定必须受正常业务 guard 约束，不从刷新隐式扩写。纯本地无源工作不受虚构的原生子要求影响。
- 覆盖未导入、跨 Project、partial／unknown、外部证据及正常无子路径；缺任何必要验收时，父完成及外部关闭不能发生。

### 修 P-F3：所有结构写入口遵守同一保护

- source.import／link 的自动本地父子链接不能绕过 completed／handoff freeze，且不得只改关系一侧。
- 允许保存真实源观察／接入 child 而保持已冻结业务结构，或返回具名冲突；必须让差异可观察，不隐藏真实原生关系，不修改过去完成事实。不要用整文件覆盖另一分支行为。
- 覆盖父完成后导入 child、child 完成后导入父、交接期两端及正常可变关系；不重建 canonical Task／owner。

### 记账与排除

- possible Divergent Change 记为后续深模块整理线索，不在本票拆整套运行器。
- 已撤回的维护锁环不修、不建缺陷票。
- 本机 ext4 初始化长阻塞和 timeout 后清理竞态保留诊断记录；独立 tmpfs 对照通过不能覆盖原红，更不能以提高预算制造绿灯。整改按真实相关行为复验。

三项交 fresh 高级执行者，修后 CEO 按清单直接核对，不再派第二轮代码评审。运行实例、真实 LLM、远端专用对象与升级保留仍由后续 #141 验收，当前未部署。
