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

证据：[保存前原始响应](raw/cont-01-before-project.json)、[保存 UI 请求 HAR](raw/cont-02-policy-save.har)、[保存后原始响应](raw/cont-03-after-project.json)、[完整任务响应](raw/cont-04-after-task.json)、[页面文字](raw/cont-05-after-page.json)、[参数展开1440×1000](shots/cont-02-policy-expanded-1440.png)、[保存后1440×1000](shots/cont-03-policy-after-1440.png)、[保存后390×844](shots/cont-04-policy-after-390.png)。

## 阶段二：真实自动准备（已验证）

步骤：按主会话更正后的授权，通过同一正规表单将目标改为 28000，保留 reserveTokens=16000，启用不变。没有点击“准备接续”，没有修改 meter，也没有注入增量 token。宿主观察真实 usage=28185，自动生成接续。

记录：policy v3；operationId `90c39ec5-5ca6-4327-af8e-23cfd0f35e6d`，commandId `auto:0ac555c0-125e-4ed2-9ad2-ded8c447b37a:1:3`，automatic=true，phase=material-requested，sourceEpoch=1，requestDelivery=delivered。source=`session-b36314e3-3c0e-4c4d-9247-928d6b4187af`，固定 successor=`session-1a48efa9-472c-495f-af04-ce499b931f48`，共同 runtime=`c01a3a7b-6deb-4820-9896-548d14220162`。当前 execution.session/owner/epoch 仍为原段身份；页面明文“原段仍负责，准备后继不切换当前入口”。

operation.profile：codex / gpt-6.1-sol / high，cwd 为指定隔离 workspace；没有擅自改成 medium。真实原段模型收到宿主材料请求并回复：“我现在保存同一 Task 的接续材料，明确保留两项决定、真实身份与已有证据，并列出验收缺口和下一步；保存后停止，由宿主移交协调权。” 页面出现 work_continuation_material 调用，收取结果仍待后续观察。

证据：[下调后任务](raw/cont-06-lowered-task.json)、[自动 operation 完整响应](raw/cont-07-auto-observation.json)、[材料请求模型现场](raw/cont-08-material-model-page.json)、[真实UI网络](raw/cont-09-auto-prepare.har)、[准备桌面](shots/cont-05-preparing-1440.png)、[准备手机](shots/cont-06-preparing-390.png)、[原段真实模型](shots/cont-07-source-model-1440.png)。

## 后续阶段

结果收取、正式接任、新段回复和旧段拒绝待执行，不计通过。
