A2D2 V4 ACCEPTANCE #152 / #150
run: v4-152-6b252218-r01
fixture: B

这是专用持续处理验收对象，不是开发任务。只允许在 /data/_dsh-dev/acceptance-workspaces/v4-152-r01 写B.proof.json；禁止clone、修改业务代码、接入其他Issue或主动抢占A的推进槽。

仅由已经明确启用的本run串行规则取得槽后执行。先用work_control status读取真实Task/Execution/Session/owner/epoch，把正文保存为当前可核验规格。proof包含run、fixture、真实身份、decisions:{retainCount:3,keepTags:["stable"]}与实际checks。

实际完成JSON解析、数量3/stable字段核验及SHA256后，逐项真实验收，报告done并请求closeExternal:true；无需额外完成令。读取真实GitHub关闭结果，不能把请求当成功回执。必要job/子结果未正式收取时不能完成；不编造消费事实或模型路由，不冒充LF。
