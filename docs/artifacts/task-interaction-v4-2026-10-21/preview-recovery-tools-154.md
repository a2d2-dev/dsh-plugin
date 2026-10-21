# #154：运行后窄修与只读恢复核验（进行中）

起点为合法证据提交 `c042c5e298d5778a14e3846146ddca0d54f7d619`，该提交相对原工具基点3a409188只增加实际失败证据，工具无差异。#150主会话随后授权当前树最小工具整改与一次独立只读恢复验证；不授权任何新停启/切新。原failed run/tools/plan/completion/lock均不修改。

## 第一阶段：可达CDP完成race与成败元数据

已知接口缺口与原运行故障严格区分：原实际capture失败在随后只读诊断中没有复现，原分支/requestId/error码没有被旧工具保存，仍不能声称原根因已定位。现在修的是可由正式CDP消息顺序证明的接口race：responseReceived先到，loadingFinished或getResponseBody后到时，旧snapshot仅await当时的Promise数组，会立即missing-body拒绝。

测试seam为公开captureScriptResponses的外部CDP WebSocket协议边界。fixture只发送正式命令响应/Network消息并明确延迟两次完成，不启动HTTP服务、不mock自己的模块、不替换live响应。第一条测试先实际exit1：`snapshot must not reject a current Script before loadingFinished`；原接口立刻settled。事件驱动修复后同命令exit0、1/1。第二片先锁定失败证据：真实CDP error code -32000/message No resource with given identifier found后snapshot拒绝，但元数据文件ENOENT，1pass/1fail、exit1；实现持久化后2/2、exit0。

当前实现仍使用原10000ms等待预算与total/resource各16777216bytes。snapshot对选定主document的全部已观察Script等待真实loadingFinished/body完成；任一当前Script失败、document身份漂移、超时/未知仍硬失败。不通过删除失败target或放宽cache/SW/Script/request/frame/loader/selected-client条件制造通过；原绑定函数保持不变。事件驱动等待不是轮询重抓。

成功或失败均保存0600私有JSONL（exclusive创建、逐记录fsync）：当前document/frame/loader、全部Script request/url/status/MIME、pending/failed/state、body字节/SHA、cache标志及getResponseBody后端错误code/message。历史document行标currentDocument=false，仅当前主document行参与完成门；未改变原有范围。数据文件不保存body明文、Cookie、headers或token登录URL；data: URL嵌入内容也脱敏。缓存/SW控制只在实际命令ack后标true。正式verifyLive初始化与错误路径已接入元数据，close等待文件写完。

协议聚焦 `node --test scripts/v4-acceptance/browser-response-protocol.test.mjs` 当前5/5、fail0/skipped0、exit0：延迟loadingFinished/body、后端body错误持久化、原10秒到期pending证据、document漂移/失败target、成功脱敏证据。时间边界使用Node MockTimers模拟外部时钟，明确tick10000，没有改预算或增加测试超时；Node的实验性API提示不是测试失败。

下一片仅处理浏览器命令异步消费机制与Notice有界确认，然后重跑原离线CDP/绑定及全工具回归。只有完成新工具与独立只读恢复核验后，才向#150报告新的工具SHA与恢复事实；后续新切换另行fresh plan，使用当前managed rollback真实退出receipt/owner日志，不复用旧6681口径、旧PID或旧指令。
