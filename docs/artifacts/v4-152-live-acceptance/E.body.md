A2D2 V4 ACCEPTANCE #152 / #150
run: v4-152-6b252218-r01
fixture: E

这是外部自动验收执行者交付对象，不是开发任务。不得为E自动创建Task或Session，不得将外部Closed直接当父任务已验收。

执行者只在 /data/_dsh-dev/acceptance-workspaces/v4-152-r01 实际生成E.proof.json，内容包含run、fixture、decisions:{retainCount:3,keepTags:["stable"]}、实际校验结果与明确自动测试器来源；不伪造Task/Execution/Session身份，不冒充LF或其他真人。

实际解析JSON并计算SHA256，交付说明记录真实路径/hash/命令退出码和操作者来源，然后真实关闭本专用E Issue。父P必须读取该交付资料及最新updatedAt，核验proof/checksum并记录明确外部验收依据；单纯Closed不足。不clone仓库、不修改业务代码、不处理任何其他Issue。
