# 子会话结果读取

`work_child_recover` 的 `result` 返回原生子会话最后一轮的确定性投影。助手原始文本逐字保留，`turn/start`、`turn/end` 保留轮次及结束原因，失败工具保留原始错误文本。成功工具只保留 `seq`、`toolCallId` 与错误标记；详细工具输出仍在原生会话日志中，通过返回的 child SessionRef、末轮 endSeq 和事件 seq 定位。没有助手文本的轮次仍返回实际结束事实和工具日志指针，不生成模型摘要或虚构结果。

工具 schema、系统和收件箱运行提示、消息 source 中的 replayState/encrypted 数据不进入强制结果分页。实际业务文本较长时，仍每页最多 12000 字符，使用返回的 `nextCursor` 与 `revision` 顺序读取；收到全部页面才形成完整接收事实。结果接收与业务验收分别成立。

接续后先调用 `status` 查看 `readProgress`。它只暴露经真实工具 call/result 日志核实的游标、revision 和 complete。未完成结果可从原游标继续；完整且末轮未变的结果无需因 epoch 切换重读。每页保存产生该回执的协调会话和 epoch，核实范围限于当前 TaskExecution 的 current/retired 链。历史回执可复用，退休会话仍不能发起新业务操作。

已有事件上的可选 `discardReason: "superseded"` 原样保留；严格 schema 继续拒绝其他原因值或未知字段。

旧存储记录的 `pages` 字段可缺省，校验时按该记录 epoch 在同一执行链中解析原协调日志。旧完整回执仍有效；旧原始事件 JSON 的未完成游标与新投影 revision 不同，需从零重读一次。不存在真实工具提交、页面不连续、revision 不匹配或新末轮 endSeq 变化时，旧进度不能结清当前结果。

回归覆盖见 `tests/work-child-result-projection.spec.ts` 和 `tests/work-continuation-pending-children.spec.ts`：投影排除重放噪音、保留原文及失败、成功工具详情留原日志、长文本跨代分页逐字重组、完整回执继承、旧 schema、伪造/未提交回执拒绝、无关 Task 和退休会话拒绝、新末轮失效，以及 pause/wait 保持。
