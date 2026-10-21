# Project14：60 个开放负责 Issue 的证据模式

本报告完整读取 **60 个直接指派给 imneov 且 OPEN 的 Issue 的正文、全部 244 条评论，以及 parent/subIssues/blockedBy/blocking、closedByPullRequestsReferences、cross-reference**，不是标题抽样。只使用本地缓存和原型源码；未调用浏览器、访问或修改远端、修改代码或原型。评论里的测试、部署、验收是来源声明，不是本次独立核验。

集合依据 [summary.json](/data/src/github.com/a2d2-dev/dsh-plugin.worktrees/task-interaction-v3/.scratch/project14-research/summary.json)，其 observedAt 为 `2026-10-21T11:57:03.525054+00:00`。详情分请求采集，非原子快照；遇到结构化字段和文本不一致保留两者。未将额外背景 Issue 混入 60 项分母，也不声称这个集合就是 view9 的完整显示结果。

| 观察项 | 结果 |
| --- | --- |
| Issue 仓库 | 60 项均为 theriseunion/freeland；实现跨多个仓库 |
| Project Status | 待处理25、进行中11、推迟解决12、待上线10、已修复2；均仍OPEN |
| 层级 | 14项有原生parent，7项有原生subIssues |
| 依赖 | 6项有blockedBy，共13条边；只有 #564→#563 的目标仍OPEN，其余目标均CLOSED |
| 标签 | ready-for-agent 7项，其中2项延期；needs-design-review 5项 |
| 关闭PR关联 | 60项的closedByPullRequestsReferences.totalCount均为0 |
| 完整性 | 244/244评论；上述六类connection均hasNextPage=false且nodes数等于totalCount |

**核心建议：保留现有 Issue / PR / 项目 / 会话入口，但将“当前可以推进什么、门槛是什么、证据覆盖什么”表达清楚。一个处理状态、一棵树和一个完成动作不足以表示真实项目。** 本文不重点重复主 agent 研究的 #3342/#2104/#2272/#2633 四树。

## 1. Open、Project 状态、执行与验收必须分开，差异不自动等于同步失败

[#2384](https://github.com/theriseunion/freeland/issues/2384) 缓存为 OPEN +「已修复」，正文却写 accepted/done。[10/15评论](https://github.com/theriseunion/freeland/issues/2384#issuecomment-6185506763) 声称按 rg-meta 约定验收关闭，明确“原190未访问”；[10/21评论](https://github.com/theriseunion/freeland/issues/2384#issuecomment-6306696468) 又补 190 页面未加载、无对应详情 GET，说明历史 rg-meta 通过不能替代，并仍写“原单关闭状态保留”。本次不推断重开者或原因。

[#2949](https://github.com/theriseunion/freeland/issues/2949) 是「待处理」，[最新评论](https://github.com/theriseunion/freeland/issues/2949#issuecomment-6290164052) 已报告两个实现 PR 合并但真实实例/普通用户验收待执行。[#3014](https://github.com/theriseunion/freeland/issues/3014) 是「待上线」，[末条评论](https://github.com/theriseunion/freeland/issues/3014#issuecomment-6253638269) 已报告190迁移和查询数据。两者都需复核，不应直接重新编码或关单。

**原型调整：**Issue state、Project Status、DSH执行、验收结论分别显示，带来源/观察时间。[状态词典](/data/src/github.com/a2d2-dev/dsh-plugin.worktrees/task-interaction-v3/docs/prototypes/task-interaction-v3-dsh.prototype.html#L32) 只有 queued/running/review/blocked/done，不能替代 Project 状态。[关闭同步提示](/data/src/github.com/a2d2-dev/dsh-plugin.worktrees/task-interaction-v3/docs/prototypes/task-interaction-v3-dsh.prototype.html#L62) 仅在存在本地关闭操作及失败事实时出现；OPEN+完成声明应提示“核对状态与证据”，不能自动给“重试关闭”。

## 2. ready-for-agent 不能覆盖延期或阶段门槛；needs-design-review 也不是新增审批的依据

[#2354](https://github.com/theriseunion/freeland/issues/2354) 与 [#2355](https://github.com/theriseunion/freeland/issues/2355) 均带 ready-for-agent，同时为「推迟解决」。[2354收尾](https://github.com/theriseunion/freeland/issues/2354#issuecomment-6165176210) 明确“保留 OPEN，Project 改为推迟解决，不再误示本期仍在实施”；[2355决定](https://github.com/theriseunion/freeland/issues/2355#issuecomment-6165177876) 相同。

[#2135](https://github.com/theriseunion/freeland/issues/2135) 仍带 needs-design-review，正文保留“先 grill→spec→tickets”，后续却已有设计PR、实现与发布片，当前又延期。[#1537](https://github.com/theriseunion/freeland/issues/1537) 没有该标签，正文反而明确共享契约先定方案。[#1474后续核验](https://github.com/theriseunion/freeland/issues/1474#issuecomment-6115721343) 说明有详细方案和基线测试仍不等于新接口完成。

**原型调整：**标签是筛选输入，执行资格另检查延期、明确暂停、当前会话占用、阶段和依赖，并显示原因。[队列逻辑](/data/src/github.com/a2d2-dev/dsh-plugin.worktrees/task-interaction-v3/docs/prototypes/task-interaction-v3-dsh.prototype.html#L38) 不能仅凭 project/mine/queued 自动接活。可区分“可做设计”“待部署验收”“延期，不接新执行”“已有执行，接续”；不从标签凭空增加人类审批门。

## 3. 正文步骤、文本子单、原生子 Issue 是三种关系

[#1767正文](https://github.com/theriseunion/freeland/issues/1767) 拆分为 ADR、后端、前端、验收、迁移五步，原生子单却是 #1768/#2708 两项。[关系说明](https://github.com/theriseunion/freeland/issues/1767#issuecomment-6121542220) 明确“父单完成比例只按真实子单状态计算，不按 PR 数或步骤打勾估算”。

[#1768](https://github.com/theriseunion/freeland/issues/1768) 有31行插件认领表，[评论说明30个不同Draft PR](https://github.com/theriseunion/freeland/issues/1768#issuecomment-6096311244)，原生subIssues=0；storage-agent与storage共用PR。[#2972](https://github.com/theriseunion/freeland/issues/2972) 标题说“逐插件子单”，[进度评论](https://github.com/theriseunion/freeland/issues/2972#issuecomment-6244199284) 列七个已完成切片及 #2978，原生subIssues同样为0，只有交叉引用。

**原型调整：**[工作拆解树](/data/src/github.com/a2d2-dev/dsh-plugin.worktrees/task-interaction-v3/docs/prototypes/task-interaction-v3-dsh.prototype.html#L52) 分开呈现需求步骤、文本拆分候选、原生子Issue。候选附原文链接，经显式确认再关联；零原生子项应写“暂无原生子Issue”，不能说“没有拆分”。分别计算子Issue关闭数和验收条目完成数，不将插件行/PR/步骤混算百分比。

## 4. 当前原生父子与历史执行归属可能有意不同

[#2135](https://github.com/theriseunion/freeland/issues/2135) 当前parent=null，但正文仍写Part of #2127、标签a2d2:sub、历史执行parent=2127。[最后评论](https://github.com/theriseunion/freeland/issues/2135#issuecomment-6165203276) 明确解除原生parent，将复杂日志移出基础首版，同时“不改 A²D² 既有 main/历史 parent=2127”。不能从旧文本自动补回原生树。

[#1392收尾](https://github.com/theriseunion/freeland/issues/1392#issuecomment-6121547012) 明确 #1393/#1394 是另开独立缺陷，不挂子单、不新增关闭门槛；[#2090正文](https://github.com/theriseunion/freeland/issues/2090) 同样明确不属 #857 子单或关闭条件。

**原型调整：**保留当前层级、历史范围归属、本地执行协调三类事实及变更理由。重组不重建Issue身份、不删除会话、不启动执行。[子Issue导航](/data/src/github.com/a2d2-dev/dsh-plugin.worktrees/task-interaction-v3/docs/prototypes/task-interaction-v3-dsh.prototype.html#L97) 不应一律跳父会话，要进入子单详情并显示真实当前会话和父协调入口。GitHub正文的session ID只能是外部记录，未经本地绑定核验不成为控制权。

## 5. 依赖有阶段与解除条件；保留的 blockedBy 边不等于活动阻塞

[#564](https://github.com/theriseunion/freeland/issues/564) 正文与原生边均依赖OPEN的 #563。[#1981依赖说明](https://github.com/theriseunion/freeland/issues/1981#issuecomment-6121532068) 则将 #2032 仅作为“完整建卷验收前置，不合并根因”；现在目标CLOSED但边仍保留。13条blockedBy中只有1条目标OPEN，不能全部计为当前阻塞。

[#2355正文](https://github.com/theriseunion/freeland/issues/2355) 明确阶段A解除 #2354 原生依赖，“#2354 保持 OPEN，不假关制造资格”。[#2949](https://github.com/theriseunion/freeland/issues/2949) 标题/旧正文仍称自己是 #2938 前置，[后续裁决](https://github.com/theriseunion/freeland/issues/2949#issuecomment-6237917974) 却明确“不再是前置”。[#2978](https://github.com/theriseunion/freeland/issues/2978) 标题/正文依赖 #2645，原生blockedBy=0。

**原型调整：**独立依赖区域显示原生/文本候选/已撤销、目标状态和来源时间。门槛指明作用于设计、实施、合并、部署或验收。[#1768评论](https://github.com/theriseunion/freeland/issues/1768#issuecomment-5997335795) 允许先开PR评审，合并仍等三环境条件；应该显示“可开发，暂不可合并”，不能一个blocked锁死全部工作。

## 6. freeland 是追踪仓，不等于实现仓；多PR且引用不等于关闭关联

[#1768进展](https://github.com/theriseunion/freeland/issues/1768#issuecomment-6096311244) 同时涉及 rise-global-extension、rise-global、node-device-discovery、volcano；vast依赖上游新OCI包，本地组合预检不代替包发布。[后续评论](https://github.com/theriseunion/freeland/issues/1768#issuecomment-6209641004) 记录三个重复PR关闭、继续原PR，说明CLOSED PR也不等于交付。

[#1392](https://github.com/theriseunion/freeland/issues/1392#issuecomment-5846306921) 有平台、registry、部署配置多个PR和顺序；[#3073](https://github.com/theriseunion/freeland/issues/3073#issuecomment-6265643116) 指向 `theriseunion/rise` 分支已有源码，真正缺的是目标release覆盖值。

**原型调整：**Project、Issue仓、实现仓、实际目录分别记录。[add-work](/data/src/github.com/a2d2-dev/dsh-plugin.worktrees/task-interaction-v3/docs/prototypes/task-interaction-v3-dsh.prototype.html#L95) 要求Issue仓等于project.repo会拒绝真实模式。以nodeID/规范URL定位Issue，以repo+number/nodeID定位PR，多对多关联并显示“正文引用/时间线引用/关闭关联/实现或发布证据”。本次60项关闭关联全为0，大量MERGED cross-reference不能冒充关闭关联或最终验收。

## 7. 待上线包含部分验收与待复测；证据必须逐项绑定环境和版本

[#314复测](https://github.com/theriseunion/freeland/issues/314#issuecomment-5947131488) 分列SWR和Harbor，Harbor缺实例，[最后仍OPEN/待上线](https://github.com/theriseunion/freeland/issues/314#issuecomment-6121521671)。[#1311收尾](https://github.com/theriseunion/freeland/issues/1311#issuecomment-6121525285) 又明确 Harbor 双provider属于 #314，不能自动增加到本单SWR验收。共享实现不等于共享全部验收范围。

[#1767部分验证](https://github.com/theriseunion/freeland/issues/1767#issuecomment-6086308222) 有探针Pulled但启动失败，不能当插件运行成功；[#1347](https://github.com/theriseunion/freeland/issues/1347#issuecomment-6083695006) 已报告deployed/Running却未做真实DELETE；[#809](https://github.com/theriseunion/freeland/issues/809#issuecomment-6115415375) 拒绝将旧HEAD截图和新HEAD组件回归当新页面PASS。

**原型调整：**每条AC保存PASS/FAIL/未验/不适用、环境、版本/digest、时间、证据、确认者和覆盖限制。是否需要现场验收以任务规格为准，不给所有任务统一加环境前置。[demo-complete](/data/src/github.com/a2d2-dev/dsh-plugin.worktrees/task-interaction-v3/docs/prototypes/task-interaction-v3-dsh.prototype.html#L104) 批量完成parts和children仅能用于演示，真实完成不能级联勾选。

## 8. 旧结论可能被后续证据纠正，下一步不能只取最后PR或最后评论

[#1394旧评论](https://github.com/theriseunion/freeland/issues/1394#issuecomment-6083697111) 曾称ext#1105修复；[后续评论](https://github.com/theriseunion/freeland/issues/1394#issuecomment-6121530207) 明确 PR 9/24 合并、故障9/26发生，不能凭更早PR证明后来故障已修，仍需现场删除撤回验收。

[#853旧等待](https://github.com/theriseunion/freeland/issues/853#issuecomment-6113858174) 是镜像Ready；[后续评论](https://github.com/theriseunion/freeland/issues/853#issuecomment-6121546324) 引 #1395 更晚的Ready旁证，要求先回读当前部署再验生命周期，“不仅重复等待发布”。旁证同样不是本研究实时部署检查。

**原型调整：**[活动区](/data/src/github.com/a2d2-dev/dsh-plugin.worktrees/task-interaction-v3/docs/prototypes/task-interaction-v3-dsh.prototype.html#L61) 保留作者、时间、原文、适用版本、被何记录修正；机器人催办与人工范围决定分层。摘要显示“已知事实/待验证/下一步及依据”，允许“历史阻塞可能解除，待回读”，不以旧阻塞重复要求用户行动，也不拿旧证据直接放行。

## 9. Open 不等于需要编码，开始处理要尊重交付类型、暂停和已有成果

[#1559](https://github.com/theriseunion/freeland/issues/1559) 验收是每个讨论问题形成做/不做/推迟，再拆实现单。[#2826](https://github.com/theriseunion/freeland/issues/2826) 虽叫Bug，正文明确只做权限验证与结论，修复另拆。[#3015](https://github.com/theriseunion/freeland/issues/3015) 追踪将手工TTL固化为配置与新装/升级验证。

[#3034最新决定](https://github.com/theriseunion/freeland/issues/3034#issuecomment-6258757265) 停止处理、恢复待处理，保留本机未发布补丁；它连Project延期都不是，只按queued会误重启。[#2409](https://github.com/theriseunion/freeland/issues/2409#issuecomment-6241749986) 明确不进入本milestone实现队列。

**原型调整：**[开始按钮](/data/src/github.com/a2d2-dev/dsh-plugin.worktrees/task-interaction-v3/docs/prototypes/task-interaction-v3-dsh.prototype.html#L37) 前呈现当前交付类型/切片：研究决策、代码、配置交付、部署验收、汇总协调。显示显式暂停原因、已有分支/PR与实际会话绑定，优先接续，不能queued就新建。复杂字段放概览摘要和相关工作，不增加新的必经顶级流程。

## 60 项阅读覆盖索引

每项均读正文、全部评论和上述关系。此表只记录内容识别，不重复主报告全量清单。所有“已有”均指来源记载。

| Issue | 内容与边界 |
| --- | --- |
| [314](https://github.com/theriseunion/freeland/issues/314) | 双provider验收；Harbor缺环境。 |
| [563](https://github.com/theriseunion/freeland/issues/563) | 全新离线服务端部署；六项候选未全部批准。 |
| [564](https://github.com/theriseunion/freeland/issues/564) | 售前初始化UI；依赖563。 |
| [809](https://github.com/theriseunion/freeland/issues/809) | 网站/白皮书漂移；新HEAD页面及托管未全验。 |
| [1394](https://github.com/theriseunion/freeland/issues/1394) | 撤回Pending；PR与故障时序纠正。 |
| [1537](https://github.com/theriseunion/freeland/issues/1537) | 插件双语元数据；兼容标量、先方案。 |
| [1767](https://github.com/theriseunion/freeland/issues/1767) | 平台镜像凭据；Pulled非安装成功。 |
| [1768](https://github.com/theriseunion/freeland/issues/1768) | 插件契约认领表；跨仓PR与合并门。 |
| [1450](https://github.com/theriseunion/freeland/issues/1450) | PCI安全交付OpenYurt，不接管foreign资源。 |
| [1452](https://github.com/theriseunion/freeland/issues/1452) | Join Command；短token与scope/运行时契约。 |
| [1474](https://github.com/theriseunion/freeland/issues/1474) | 授权∩Installed后端求交；两仓接口未完成。 |
| [1559](https://github.com/theriseunion/freeland/issues/1559) | SSH/API密钥归属讨论，按问题决定再拆单。 |
| [1610](https://github.com/theriseunion/freeland/issues/1610) | 成员指标缺监控数据源，不能仅删前端guard。 |
| [1611](https://github.com/theriseunion/freeland/issues/1611) | Ingress列表/详情；PR1084合并引用。 |
| [1613](https://github.com/theriseunion/freeland/issues/1613) | 应用商店双插件后端闭环。 |
| [1671](https://github.com/theriseunion/freeland/issues/1671) | 主动/超时锁定，区别禁用。 |
| [1672](https://github.com/theriseunion/freeland/issues/1672) | 四项密码策略；复杂度基线不能代验收。 |
| [1347](https://github.com/theriseunion/freeland/issues/1347) | 读写平面统一；真实删除撤回未验。 |
| [1352](https://github.com/theriseunion/freeland/issues/1352) | 临时member RBAC未来收紧，明确延期。 |
| [1364](https://github.com/theriseunion/freeland/issues/1364) | 独立quota；旧registry直写方案已撤回。 |
| [1392](https://github.com/theriseunion/freeland/issues/1392) | 插件Karmada身份；旧手工apply非新GitOps证据。 |
| [1395](https://github.com/theriseunion/freeland/issues/1395) | 安装六项性能；缓存/局部values不是全验。 |
| [1311](https://github.com/theriseunion/freeland/issues/1311) | CAMP镜像重构；SWR AC与314双provider分开。 |
| [853](https://github.com/theriseunion/freeland/issues/853) | schema Hide生命周期；旧镜像等待需更新。 |
| [854](https://github.com/theriseunion/freeland/issues/854) | private可信身份二期；夹具非完整授权验收。 |
| [1981](https://github.com/theriseunion/freeland/issues/1981) | ascend-112错host身份；另有Profile验收阻塞。 |
| [2090](https://github.com/theriseunion/freeland/issues/2090) | 独立storage安全评审；非857关闭条件。 |
| [2104](https://github.com/theriseunion/freeland/issues/2104) | CLI/CRD/性能/离线各自验收。 |
| [2114](https://github.com/theriseunion/freeland/issues/2114) | CLI本机合同验收声明；OPEN/已修复。 |
| [2135](https://github.com/theriseunion/freeland/issues/2135) | 历史日志；解除原生2127父，保历史执行归属。 |
| [2272](https://github.com/theriseunion/freeland/issues/2272) | 两账号子项协调，不收拢所有安全问题。 |
| [2305](https://github.com/theriseunion/freeland/issues/2305) | 商店API404，本期不做、默认不安装。 |
| [2354](https://github.com/theriseunion/freeland/issues/2354) | Deployment历史；基础发布与复杂验收分开。 |
| [2355](https://github.com/theriseunion/freeland/issues/2355) | 其它四类/双身份；阶段A去依赖，后续延期。 |
| [2384](https://github.com/theriseunion/freeland/issues/2384) | 历史rg-meta验收与新190复现及OPEN差异。 |
| [2409](https://github.com/theriseunion/freeland/issues/2409) | GPUStack缺后端；最新明确不恢复实施。 |
| [2638](https://github.com/theriseunion/freeland/issues/2638) | 只读IAM引用盘点，不执行迁移。 |
| [2646](https://github.com/theriseunion/freeland/issues/2646) | Scope授权验收；八前置已关仍有覆盖缺口。 |
| [2826](https://github.com/theriseunion/freeland/issues/2826) | 归档create权限验证，不预设缺陷结论。 |
| [2830](https://github.com/theriseunion/freeland/issues/2830) | GC文案与实现不符；二期二选一。 |
| [2855](https://github.com/theriseunion/freeland/issues/2855) | 租户存储原型/八AC；删除语义更新。 |
| [2910](https://github.com/theriseunion/freeland/issues/2910) | 自助空间三步引导与开关，仍有默认策略待定。 |
| [2948](https://github.com/theriseunion/freeland/issues/2948) | 12包类型门；64诊断含扫描口径噪声。 |
| [2949](https://github.com/theriseunion/freeland/issues/2949) | model-x回收站；旧前置撤销、新实现合并声明。 |
| [2972](https://github.com/theriseunion/freeland/issues/2972) | 菜单authKey多文本子单，原生子单0。 |
| [2978](https://github.com/theriseunion/freeland/issues/2978) | storage升级被IAM守卫拒，只有文本依赖。 |
| [3014](https://github.com/theriseunion/freeland/issues/3014) | 读性能转专表/total解耦，迁移首日补齐边界。 |
| [3015](https://github.com/theriseunion/freeland/issues/3015) | 七系统表TTL从手工改为声明交付。 |
| [3025](https://github.com/theriseunion/freeland/issues/3025) | 三Tab/响应式/Swiss污染多切片，最新后端优先。 |
| [3026](https://github.com/theriseunion/freeland/issues/3026) | 迟到写回由3030同写者覆盖，协调非完成。 |
| [3034](https://github.com/theriseunion/freeland/issues/3034) | Swiss参数；最新暂停，保未发布补丁。 |
| [3073](https://github.com/theriseunion/freeland/issues/3073) | Fluent Bit源码已有，release覆盖值未交付。 |
| [3093](https://github.com/theriseunion/freeland/issues/3093) | 升级筛选/404；版本未确定，新增启停反馈。 |
| [3253](https://github.com/theriseunion/freeland/issues/3253) | provider可变API证据；UI未核。 |
| [3254](https://github.com/theriseunion/freeland/issues/3254) | 地址校验；API/UI与归一合同覆盖分别记录。 |
| [3255](https://github.com/theriseunion/freeland/issues/3255) | 只读编辑按钮未禁用，不证明服务端越权。 |
| [3270](https://github.com/theriseunion/freeland/issues/3270) | 管理目录403伪成不存在；关系重组不恢复执行。 |
| [3287](https://github.com/theriseunion/freeland/issues/3287) | 任意WS Origin；有效登录态利用未验证。 |
| [3335](https://github.com/theriseunion/freeland/issues/3335) | 禁用后Dock仍显示；只禁用恢复不卸载。 |
| [3342](https://github.com/theriseunion/freeland/issues/3342) | 四遗留汇总，保身份/证据且不启动工作。 |

方法：Python仅整理完整正文评论、统计与检查分页；逐份读取12份展开内容，另逐边读取全部关系以避免JSON长行截断。未检查引用PR的源代码/checks或外部附件，不把这些链接内容补造成已核验证据。更大范围的251个Issue与1520条评论由主报告覆盖，本报告结论范围严格限定上述60项。
