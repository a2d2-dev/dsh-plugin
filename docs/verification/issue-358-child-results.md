# #358 子结果读取与接续验收

关联 [Issue #358](https://github.com/a2d2-dev/dsh-plugin/issues/358)、[PR #359](https://github.com/a2d2-dev/dsh-plugin/pull/359)，来源 theriseunion/freeland#1474 会话7。

## 目的与修复

原会话切换后被迫重新分页读取整个子会话原始事件，工具定义和模型重放资料占据结果。修复为确定性投影，保留原助手文本、失败工具文本、真实终态及原生日志定位；成功工具详情留在原始日志。长业务结果仍分页，逐页从真实工具call/result核实。当前任务合法后继继承同一结果的完整或部分回执，退休会话权限保持不变，新末轮不沿用旧回执。

旧原始格式部分回执在status明确要求从新格式cursor0读取一次；成功result不附旧重启指令。已携带子会话直接核对原生父目录，未知子会话或replace仍观察全执行图。严格schema兼容已有可选discardReason=superseded，原记录保留。

## 同工作负载测量

读取三个真实子会话末轮事件，原JSON SHA256与旧工具revision一致；用生产源码的projectChildResult处理同一输入，并逐条比较全部assistant文本。

| 原子结果 | 原字符 | 新字符 | 原页数 | 新页数 |
|---|---:|---:|---:|---:|
| All | 582674 | 7766 | 49 | 1 |
| 模型供给 | 3005174 | 33405 | 251 | 3 |
| 项目消费 | 4359321 | 46219 | 364 | 4 |
| 合计 | 7947169 | 87390 | 664 | 8 |

原业务文本逐字保留。原实例状态调用243实测169.882秒，CPU采样显示记录比较/提交、GC和会话日志解析开销；已去掉已携带子会话的无关全图发现。原实例受队列准入限制，尚未取得最终快路径的同负载端到端耗时，不用开发小场景时延替代。

## 自动与独立验证

回归先失败后通过：初版相关5文件63项、持久格式兼容2项；最后快路径与重启提示修正后8项原生/投影回归通过；保留新主干c663ca3后主分支相关3文件10项、运行集成2文件8项通过，类型检查、构建通过。保留原生父子归属、伪造和未提交回执拒绝、长文本逐字跨代重组、旧完整回执、末轮变化及pause/wait负例。发布集成另有65项相关回归通过。

三路独立只读审查均完成。审查发现成功result0错误携带旧restartRequired，已由6c57909修复，补充原生回归并复审通过。Node22/24及密钥扫描CI通过，最终文档提交的检查在PR页面记录。

## 真实页面步骤与记录

1. agent-browser打开https://dsh-dev.e5box.a2d2.dev/，创建独立QA Task，由真实codex/gpt-6.1-sol medium父子会话生成160行答复，最终答复与input.txt逐字一致。
2. epoch1实际result(cursor0)交付12000字符、complete=false；保存后暂停。正式task.continue到epoch2时暂停保持，材料received后测试器明确恢复并发送业务输入。
3. 后继status确认同一child/endSeq/revision及cursor12000；直接读取剩余5118字符，complete=true，最终status为cursor17118。两页实测0.276秒、0.439秒。
4. 独立解析两个原生工具call/result，重组全部17118字符，全部assistant文本与子日志一致；后继没有cursor0请求，唯一child/endSeq29保持。页面截图和原始记录一致。

## 原实例交付与业务状态

原实例已有未入主干的恢复/去重补丁。纯主干候选首次加载时严格schema拒绝8条既有discardReason事件；未改数据。兼容后88条真实执行记录通过严格解析，8条事件原样保留。实际发布从已部署源码525b249集成#358至6c57909，发布提交97402e2，并保留随后进入主干的c663ca3子会话通知免重复写入优化，保留既有补丁；主干PR没有夹带这些恢复功能。

最终包为`/data/_ssd2t/dsh/packages/issue358-live-v3/a2d2-dsh-a2d2-0.0.23.tgz`，SHA256为`a67ee1cf263e18a9303d3d0a4340d59bf4c0232ef383674803cda3d6dee2a60d`。原实例和开发profile各198个lib文件与包一致，两次独立重启回执均succeeded，页面恢复正常。

原#1474已实际读取新投影：All7766字符完整；供给与项目各24000字符。已实际接续至会话8、epoch8/received且无接续错误，以上回执全部保留，All没有重读。

剩余31624字符、3页尚未在原业务会话收到：原单槽队列concurrency=1，slot由freeland#1767占用，已核实其原生会话有工具执行。公开resume请求回读resumeRequested/explicitResumeRequested=true，保留并发和现有slot。队列旧错误显示已在[既有Issue #300](https://github.com/a2d2-dev/dsh-plugin/issues/300#issuecomment-6563749151)补充证据。#1474原业务验收未完成，仍由原队列调度。

## 原始证据

按仓库源码排除规则，原始日志、截图和现场记录保存在本机`docs/artifacts/1474-child-result-2026-11-01/`，未纳入公开源码。报告README含实验步骤、记录和各文件索引，主要证据为projection-measurements.json、native-qa-verified.json、original-progress-verified.json、real-state-schema-proof.json、live-v2-install-attestation.json及重启回执。私有工作目录另有复核脚本与原实例会话8截图。
