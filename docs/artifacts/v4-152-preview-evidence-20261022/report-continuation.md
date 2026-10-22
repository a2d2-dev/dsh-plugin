# #152 P 真实自动接续验收

## 目的与边界

在 <http://10.126.126.12:18782/> 串行验证本 run P=#157 的正规策略重存、准备、结果收取与正式接任，以及两项决定跨段保留。浏览器 qa152f，单标签。工作分支 test/152-preview-live，首步 pwd / branch / git pull --ff-only 成功。未改旧报告、旧 ledger、服务或业务代码。

## 阶段一：显式重存策略（已验证）

步骤：从来源概览打开 P → 接续 → 编辑自动接续设置 → 高级接续设置，确认启用、目标 200000、安全余量 16000 → 保存接续策略，仅提交一次。

记录：UI 正式 task.configure-continuation，commandId `5bdc3f9b-cb6d-46c0-88ec-323f19b8a994`，HTTP200；policy={version:2,enabled:true,targetTokens:200000,reserveTokens:16000}。HAR 保存实际请求和状态，工具未保存响应正文；随后正式查询保留完整 JSON 响应，不将 HAR 空正文当成完整响应。

- 03:39:17.315Z 保存前 project.detail：processingState=blocked，blockers 同时包含 FINISH-P 等待和 `Exact model route or capacity changed; explicitly reconfigure continuation before advancing`。
- 03:40:26.019Z 保存后 project.detail：processingState=blocked，route blocker 已消失，仅保留 FINISH-P 等待。
- 03:41:12.263Z task.detail：owner `657d73e9-40c5-4170-92fd-07ae0ada7367`、epoch 1、Session `session-b36314e3-3c0e-4c4d-9247-928d6b4187af`；continuationPolicy 与上述参数一致；真实 observation.totalTokens=28185，baseline=usage，capacity=1050000，outputReserve=128000，routeKey=`["codex","gpt-6.1-sol","high",1050000,128000]`。这是当前宿主观察，不是本轮新增模型调用。

最初按“仍 blocked 停止”暂停后续步骤。主会话随后明确更正：FINISH-P 是完成等待，不作为接续阻断；授权继续正式准备/接任，并允许仅通过正规表单把目标调到真实计量以下以验证 automatic=true。继续执行中，后续结果待记录。

证据：[保存前原始响应](raw/cont-01-before-project.json)、[保存 UI 请求 HAR](raw/cont-02-policy-save.har)、[v2真实保存完整请求响应](raw/cont-network-policy-v2.json)、[v3目标调整完整请求响应](raw/cont-network-policy-v3.json)、[保存后原始响应](raw/cont-03-after-project.json)、[完整任务响应](raw/cont-04-after-task.json)、[页面文字](raw/cont-05-after-page.json)、[参数展开1440×1000](shots/cont-02-policy-expanded-1440.png)、[保存后1440×1000](shots/cont-03-policy-after-1440.png)、[保存后390×844](shots/cont-04-policy-after-390.png)。通过 agent-browser --json network request 补导完整命令响应，认证头未入证据。

## 阶段二：真实自动准备（已验证）

步骤：按主会话更正后的授权，通过同一正规表单将目标改为 28000，保留 reserveTokens=16000，启用不变。没有点击“准备接续”，没有修改 meter，也没有注入增量 token。宿主观察真实 usage=28185，自动生成接续。

记录：policy v3；operationId `90c39ec5-5ca6-4327-af8e-23cfd0f35e6d`，commandId `auto:0ac555c0-125e-4ed2-9ad2-ded8c447b37a:1:3`，automatic=true，phase=material-requested，sourceEpoch=1，requestDelivery=delivered。source=`session-b36314e3-3c0e-4c4d-9247-928d6b4187af`，固定 successor=`session-1a48efa9-472c-495f-af04-ce499b931f48`，共同 runtime=`c01a3a7b-6deb-4820-9896-548d14220162`。当前 execution.session/owner/epoch 仍为原段身份；页面明文“原段仍负责，准备后继不切换当前入口”。

operation.profile：codex / gpt-6.1-sol / high，cwd 为指定隔离 workspace；没有擅自改成 medium。真实原段模型收到宿主材料请求并回复：“我现在保存同一 Task 的接续材料，明确保留两项决定、真实身份与已有证据，并列出验收缺口和下一步；保存后停止，由宿主移交协调权。” 页面出现 work_continuation_material 调用，收取结果仍待后续观察。

证据：[下调后任务](raw/cont-06-lowered-task.json)、[自动 operation 完整响应](raw/cont-07-auto-observation.json)、[材料请求模型现场](raw/cont-08-material-model-page.json)、[真实UI网络](raw/cont-09-auto-prepare.har)、[准备桌面](shots/cont-05-preparing-1440.png)、[准备手机](shots/cont-06-preparing-390.png)、[原段真实模型](shots/cont-07-source-model-1440.png)。

## 阶段三：原段材料结果收齐（已验证；后台 job 收取未验证）

目的：在正式接任前等待真实原段模型响应和工具返回，保留决定、证据、未完成项与下一步。

记录：宿主请求原文为 `Prepare a safe continuation of this same Task. Call work_continuation_material now, with expected_epoch 1. Preserve original concrete decisions, evidence, unfinished acceptance work and the exact next step. Include necessary local references and unsaved discussion in body. Explicitly state gaps. Do not claim the Task is complete. After saving, stop; the host will transfer coordination.`

只读 task.history 原段第二页给出可核对的真实时序：seq52 request/header；seq62 assistant/message；seq63 tool/call work_continuation_material；seq64 tool/result status=completed；seq65 step/end；seq66 turn/end reason=blocked；seq67 接续 intake-seal。03:46:35.636Z task.detail 的 operation.phase=material-saved，material 中完整保存 body/decisions/evidence/unfinished/next；当时仍是原段 Session、原 owner、epoch1，executionGraph.settlement=settled。

material.decisions 原文含：“已确认且不得丢失：镜像保留数量3；必须保留stable标签。精确对象为 decisions:{retainCount:3,keepTags:[\"stable\"]}。” 未完成项包括 C canonical 验收、E proof/checksum/updatedAt、P proof 与 JSON/SHA256、native child 路由回执、自有 job 正式收取和完成令；未把 Closed 或模型自报当业务验收。

**本轮无可收取的后台 job**：材料保存前后 executionGraph.jobs=[]、tools=[]（已结算），没有 native checksum job id。已验证的是实际工作响应/材料工具结果被宿主收齐后接任；没有验证后台 job “结果待收→正式 job_output 收取→可接任”，也没有看到单独 awaiting-results/ready-to-takeover phase 快照，不为它们填写虚构状态。

证据：[材料已保存完整任务响应](raw/cont-10-material-result-task.json)、[原段工具详情](raw/cont-13-material-tool-result.json)、[原段历史首页](raw/cont-15-source-history.json)、[原段历史续页与真实tool/result](raw/cont-17-source-history-next.json)。

## 阶段四：宿主正式接任与决定跨段保留（已验证）

03:47:27.139Z，operation.phase=delivered，automatic=true，sourceEpoch=1，requestDelivery=delivered，kickoffDelivery=delivered，inputSeal=67。固定 source/successor 与阶段二相同。Task/Execution 不变，owner 身份保留为 `657d73e9-40c5-4170-92fd-07ae0ada7367`；epoch 从1变2，currentSession 指向 `session-1a48efa9-472c-495f-af04-ce499b931f48`。executionGraph 旧段 role=retired/status=idle、新段 role=current/status=running。页面“正式接任已提交，当前入口以有效协调记录为准”，从 P 的“进入当前会话”实际进入新段。没有手工点击模拟准备、收取或接任阶段；宿主自动完成。

owner ID 保留是主会话确认的规格行为，授权边界由当前 Session + epoch 更新体现，**不记作缺陷**。

新段真实模型首条回复原文：

> 已保留两项决定：数量3、必须保留stable标签。未完成项包括 C/E 验收、P proof 的 JSON/SHA256 核验、native 只读 child 的路由回执核对、后台 job 正式收取，以及等待明确完成令。我先读取当前 Task 和执行身份，再继续收集实际证据。

新段随后真实调用 work_control status，并回复“当前已核实为 epoch=2，新 Session 已接续原 Task”。首条回复实际文本使用“数量3”，不伪造为含“镜像”字样的逐字引文。已额外向新段提出只回答两项决定完整名称与未完成项的自然语言问题，未在问题中给答案；排队回答待补。

模型路由实证：原段 task.history seq52 的 request/header.config 为 codex/gpt-6.1-sol/high/maxTokens128000，seq62/64 为真实模型消息/工具返回；原段前3次请求 TRANSPORT Connection error 后由真实重试成功。新段 Trajectory → Request#1 的实际 Options 同为 codex/gpt-6.1-sol/high/maxTokens128000，Usage input15358/output111，首请求界面显示 Connection error 和 Scheduled 2 of41 后完成。**high 是实际父执行档位；没有把它写成 medium，native child medium 尚未验证。**

证据：[正式接任完整响应](raw/cont-11-takeover-task.json)、[新段真实模型回复](raw/cont-12-successor-model-page.json)、[新段实际请求详情](raw/cont-19-successor-request-details.json)、[接任桌面](shots/cont-08-takeover-1440.png)、[接任手机](shots/cont-09-takeover-390.png)、[新段复述桌面](shots/cont-10-successor-reply-1440.png)、[新段复述手机](shots/cont-11-successor-reply-390.png)。对当前新段调用 task.history 被 `unrelated-history: Session is not retired history of this Task` 拒绝，这是正确只读历史边界，不计缺陷；原始响应保留于 [当前段历史边界](raw/cont-18-successor-history.json)。

## 阶段五：旧段普通推进拒绝（已验证）

03:52:21.386Z，通过公开 task.control action=progress 提交旧 executionId/owner/epoch1 fence，commandId=`probe-old-epoch-qa152f-20261022-035200`。HTTP400、status=failed；error.code=`stale-execution-authority`，拒绝原文：

> Execution identity, owner or epoch is stale

这是正式服务端 fence 验证，不冒充旧段模型工具调用。此前另尝试一次旧会话自然语言探针，session/prompt 返回 accepted，真实历史 seq69~72 仅记录新输入入队、turn3启动后 blocked，没有模型请求/工具，不能用该空界面冒充拒绝原文。正式拒绝以 [旧 fence 请求与响应](raw/cont-16-old-fence-rejection.json) 为准；[旧段页面](raw/cont-14-retired-probe-page.json) 仅作现场。

## 未完成项与产品/环境观察

- 未验证真实后台 job 待收与 job_output 正式收取门槛；没有创建假job或手造 consumed。
- 未捕获单独可接任中间 phase，只记录实际 material-requested→material-saved→delivered。不把缺少快照当产品缺陷。
- 新段业务继续时，bash 因 `sandbox mode \"workspace-write\" is requested but no sandbox backend is usable on this host; refusing to run the command unconfined` 失败；write 首次因空 justification 失败后成功写 P proof。此为新段真实执行观察，未改 Host/profile/权限规避；本次接续不因此冒称全部业务验收完成。
- 接任后按主会话要求没有再改 policy（仍v3，28000/16000）。04:00:18.643Z 最终正式 task.detail：epoch=2、currentSession 为后继 `session-1a48efa9-472c-495f-af04-ce499b931f48`、phase=delivered、runtime=idle；Task v6、specification v2、3/9。P proof 由新段真实写入，C/E 必要范围由新段正式采纳；业务完成仍不成立。证据：[最终原始响应](raw/cont-22-final-task.json)、[最终身份页面](raw/cont-23-final-identities-page.json)、[身份桌面](shots/cont-12-final-identities-1440.png)、[身份手机](shots/cont-13-final-identities-390.png)。
- 自动策略重存消除 route blocker、真实 automatic operation、材料保存、当前入口切换、epoch+1、决定与未完成项复述、旧 fence 拒绝均有实证。本次不能宣称 #152 整体验收通过。

## 收口清单与限制

| 验收内容 | 结论 |
|---|---|
| P详情正规重存200000/16000、route blocker消除 | 已验证 |
| 正规下调目标28000，以真实28185 usage自动准备 | 已验证，automatic=true |
| 原段保持当前入口直至材料保存 | 已验证，epoch1 |
| 真实模型work_continuation_material结果收齐 | 已验证，seq63/64，material-saved |
| 后台job待收→job_output正式收取门槛 | 未验证；本轮没有后台job |
| 正式接任、owner保留、epoch2、后继current/旧段retired | 已验证 |
| 新段首条真实复述数量3/stable与未完成项 | 已验证 |
| 新段额外问题逐字回答完整“镜像保留数量3” | 未验证；问题已排队进入会话，但截至收口未见额外模型回答，不拿旧段或prompt中的文字代替 |
| 旧epoch普通推进拒绝 | 已验证，stale-execution-authority |
| 1440×1000与390×844截图、原始请求响应 | 已保存，PNG尺寸与JSON解析已核对 |
| #152整体、P业务完成/关闭、native child medium | 未验证/未完成 |

本轮未确认新的接续产品缺陷。环境观察是workspace-write shell无可用sandbox backend；权限重试由本验收执行者通过页面Reject拒绝，未修改服务/Host/profile。手机Chat截图保留了真实横向裁切现场，不用裁剪图冒充完整移动排版。

命令限制如实记录：旧段树项相对时间变化导致一次定位失败，重取引用后成功；非secure HTTP页面的crypto.randomUUID不可用，第一次旧fence探针在发请求前失败，改为固定唯一commandId后真实发出且被拒绝。未把这些自动化错误计为产品缺陷。所有后台浏览器等待命令均已正式收取，唯一bash-112结束exit0。既有旧报告/ledger未修改；未触碰A/B/X或现有开发Issue。旧段模型探针仅阻断未执行，正式服务端拒绝保留独立证据。

分阶段提交：`6fd8a86`（正规重存）、`a879069`（自动准备）、`98245e6`（材料/接任/旧fence拒绝）；已推送同一分支，不合并。结构化结果见 [ledger-continuation.json](ledger-continuation.json)。
