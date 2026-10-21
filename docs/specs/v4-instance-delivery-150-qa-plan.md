# #152 原预览真实验收：只读准备结果

父任务 [#150](https://github.com/a2d2-dev/dsh-plugin/issues/150)，执行任务 [#152](https://github.com/a2d2-dev/dsh-plugin/issues/152)。本记录是准备结果，不是运行验收。继续沿用 [既定六项验收脚本](https://github.com/a2d2-dev/dsh-plugin/blob/7e5566b48c23171a7d7a69550077b66b69d33ad0/docs/specs/v4-live-acceptance-script.md)，不减少场景。

## 已核实环境

准备执行者 session-e8933487-f87c-4a3c-b674-bc95513f9b70，通过 implement 实际派发 codex/gpt-6.1-sol/medium。锁定工具树 test/v4-acceptance @6b2522189cc64ebdea608789949b3237aa4b1d29；没有主动写文件、Git写、模型、浏览器、服务动作或GitHub mutation；无后台jobs。主会话在采用结果前已亲读公开路由、执行与运维脚本，并核对工具/PR状态。

- GitHub只读结果：账户 imneov，仓库 a2d2-dev/dsh-plugin 为 PRIVATE/ADMIN；15标签完整，尚无建议验收标签。自有 Project1 私有开放，只有真实 View1（TABLE_LAYOUT，无filter），不可拿示例视图替代。
- 原18782正确产品端点是 `/a2d2/api/work`，POST query/command envelope；早期错误路径404已纠正。
- 准备快照：3 Project、3 source、6 Task、1历史 Execution、3 Session公开running=false。三个source的continuous.status均无continuousRule，当前没有已配置持续规则。
- 旧Execution及旧workspace不复用、不计本轮证据。新旧宿主、回滚、离线profiles和imports已有证据，不重复build。

这些是准备时事实，创建fixture前重查规则，切换前重采PID/输入/jobs/cut；不外推为临执行证明。

## 隔离与模型选择

建议nonce为 `v4-152-6b252218-r01`。全部P/C/E/A/B/X使用共同run标签，只有A/B/X使用serial标签；A另有纯验收touch标签用于制造远端版本变化。全部assign imneov，不加开发执行标签。创建回执、GitHub node、Project item和source.issue三方核对ledger。

如果届时出现可接入同仓库fixture的用户宽规则，先解决真实隔离前置；专用正标签不能排除宽规则，不能擅自暂停原规则。

创建独立nonce Project和workspace。Task/Continuous显式选择codex/gpt-6.1-sol/medium及公开execution-options返回的真实agentPreset/permissionPreset/resource。18782的全局stage表是旧配置，与18781不同；产品Task/Continuous与开发stageAgents独立，保留全局配置。公开API没有Agent policy编辑命令，不声称已设置专用policy限制。

source.connect全局去重可回到旧来源，适合验证识别/重复入口；专用Project的两来源使用source.configure与source.configure-project。C以本地独立Task起步并source.link，再跨Repo/Project source.import核对同一canonical Task/Execution/currentSession。E不import，X不创建Task/Session/proof。

## 执行序列

1. #154切换及原URL/原数据无fixture严格比对通过后，给独立QA写树和正式资源，再创建精确六项专用对象。
2. 页面验证Repo三页、Project四页和真实View1；C双来源身份唯一；建立真实P→C/E原生关系，P采纳完整必要子范围。
3. C由自身Task验收；E由真实测试器生成proof/checksum、关闭，P读取当前updatedAt与交付证据后显式外部验收；Closed本身不足。
4. P创建真实native只读校验child和自有checksum job。早done被拒后仍可收取；owner正式job_output和真实子通知后重新验收，不伪造consumed。
5. P保存“数量3、必须保留stable”及未完成项。用真实meter配置本Task自动接续；不注入token、不手工continue。准备仍旧入口，automatic operation正式taken后保留身份、更新epoch/currentSession；新模型实际复述具体决定。接任后避免小阈值连续旋转。
6. continuous.configure显式资源/模型且disabled；保存原话、Block X、真实模型preview。plan.steps node allow-list严格只含A/B，预览不启动执行。补充原话重新preview仍排除X，再明确启用。
7. 实证 A-start→A-wait→B-start→B-done/closed→真实继续A→A-resume→A-done。规则暂停只止后续接入，不杀在途；重启后保留原话/计划/Block/执行。X解除不授权旧计划，本轮不启用包含X的计划。
8. A等待时只改touch标签造成真实updatedAt变化；本地完成/远端冲突后由测试器解决专用远端状态，task.completion-sync补偿，同一CompletionOp/Task/Execution/Session且不重跑。
9. 完成P所需条件后发具名FINISH令，关闭专用残余Issue、停新规则，保留证据与用户原资料。

## 必须在实际环境核实的接缝

- native child SDK形状在源码/tests可证，但实际实例对显式agentOptions的正式工具/受管SDK入口需切换后核对；不能拿旧开发dispatch_subagent充数。
- Task及child真实模型证据来自各自model/selection、request/header.config、requestId、usage和execution.actual。辅助计划调用直接llm.stream、没有Session header；必须用既有runtime artifact/LLM logger对专用流量脱敏取证，不能用plan中的声明model替代真实请求，不新增trace平台。
- 自动接续使用临时真实continuationObservation与容量约束，若meter不可读则如实报告，不用旧历史造值。

## 证据与数据比对

后续执行者必须先加载agent-browser技能及CLI core，在原18782采集1440×1000和390×844的实际页面。覆盖来源、必要子、真实job待收/收后、接续准备/taken、策略/草稿、模型计划/Block/暂停/等待、关闭冲突补同步和重启恢复。截图和中文报告写目的/步骤/记录，不含秘密。

先无fixture严格核对升级保留；验收后再按真实ledger核对精确增量。现采集器不覆盖continuousRules，须额外保留公开continuous.status；externalIndex既有映射必须全保留，只允许本run已登记canonical新增，不放宽旧identity。E/X不import。不能把现retention比较器描述为已自动容许所有合法fixture变化。

当前真实验收、模型trace、native运行入口和重启均未完成；这些不是已通过项。
