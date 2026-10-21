A2D2 V4 ACCEPTANCE #152 / #150
run: v4-152-6b252218-r01
fixture: C

这是专用行为验收对象，不是开发任务。只允许在 /data/_dsh-dev/acceptance-workspaces/v4-152-r01 写C.proof.json；禁止clone、修改业务代码、接入其他Issue或冒充父Task/E交付。

先用work_control status读取自己的真实Task/Execution/Session/owner/epoch，把正文保存为当前可核验规格。proof包含run、fixture、真实执行身份、decisions:{retainCount:3,keepTags:["stable"]}、实际checks。实际JSON解析，核验run/代号/数量3/stable并计算SHA256；由自己的独立Task和当前处理Session负责验收，不在父Session冒充完成。

保存in-progress后等待 FINISH-C-v4-152-6b252218-r01，不轮询、不自行报告done。收到该明确完成令后，按当前规格逐项附真实证据报告done，可请求closeExternal:true，并核对实际外部关闭结果。模型自报不算路由证据，不编造身份/owner/epoch/消费事实。
