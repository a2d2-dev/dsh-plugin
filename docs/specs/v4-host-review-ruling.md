# v4 宿主补丁：一轮双轴评审与 CEO 裁决

任务 #142；fork PR [#5](https://github.com/imneov/deepseek-harness/pull/5)。审查固定 base `a45068d2ec03326c800c68c9bdcd47508e3ccb9c`，head `110c44442ac42c88ca087f89d28cb6f8ba84818b`，分支 feat/v4-job-observation。CEO 已 fetch、核对 ls-remote／PR base/head／merge-base，确认 62 路径非空差异及 tracked clean。两位评审均 fresh context，通过 code-review 阶段实际路由 codex/gpt-6.1-sol／xhigh；未继承实施上下文。

## Standards

评审 session-4babcd15-71ae-4d22-9c46-a1b7f72172a8：**REQUEST_CHANGES，2 项 P2 硬标准问题，未另列 possible smell。**

1. `jobs-local/src/index.ts:639` 在释放 waitResolvers 前同步发布 jobs/settled 日志。Session 的 session/event 监听者可以同步 abort 等待信号，导致真实状态已经 completed 的 wait 返回 wait aborted。违反 jobs 的“结算后终态投影优先”公开约定以及文档匹配公开行为规则。实际源码的纯 Node 内存对照：a450 返回 completed，110c 返回 wait aborted；探针未写文件或启动服务。应先释放并移除 waiter 的取消监听，再发布可重入日志。
2. 新增三个 SessionEventMap 事件，但最终 diff 没有 Python SDK 驱动或当前 expected 更新，现有 Python fixture 没有 jobs 事件或 jobReceipt。AGENTS 的双 SDK 要求与测试政策要求新事实有组装后的消费证据；已 revert 的预备代码不构成最终覆盖。此项是缺覆盖，不是已证明 Python 运行失败。

静态核对确认普通 append 仍 required、observe 非消费且 exact-owner、teardown 不记收取；原 62 个持久 schema roots 未变，新增三项与 acknowledgement 一致。identity 探针确认不同 instance 的关系差异未被归一化吞掉。

## Spec

评审 session-3c0ff5d4-27ac-48e7-8d34-f02a25a87a26：**REQUEST_CHANGES，2 项 P2；未发现 scope creep。**

1. 未知回执缺少负向验收。真实 Loader／JSONL 组合目前只断言 first/repeat 成功；策略替换与未知 ID 测试只断言文本及错误状态，没有证明未产生 meta.jobReceipt，也没有证明实际 job 的 pending／cursor 未被改变。误造回执仍可能通过现有断言。需补真实持久负向路径；不据此声称实现当前已伪造回执。
2. 等待／取消退化与 Standards 第一项相同。日志同步回调发生在 waitResolvers 释放之前；owned job 的 jobs/settled 监听者取消等待后，真实 completed 的 wait 拒绝且 awaited 误变 false。原有 unowned 回归不会进入 journal，不能排除该问题。应增加 owned Session 监听者取消回归。

已核对默认 append、exact owner、read/remove、历史格式、归一化关系与净零 Python 历史；未运行会写临时文件的 Vitest／构建／生成器，未写仓库或提交正式 GitHub review。

双轴统计：Standards 2 项，最重为等待结算优先级 P2；Spec 2 项，最重同为等待结算优先级 P2。两轴分别保留，不以一轴通过代替另一轴。

## CEO 裁决与整改前沿

CEO 已亲读 settle／waitJob、Session 同步事件发布、公开 wait 约定、真实 JSONL 成功组合、策略替换／未知 ID 断言及双 SDK 测试政策，确认所用 base 正确。

- **修 R1（Standards 1／Spec 2）**：在任何可重入 journal 回调前释放／解除 waiter 取消监听并固定 awaited，保证实际终态优先。增加真实 owned Session 监听者 abort 的红→绿回归；保持旧 cancel／wait／teardown 契约。
- **修 R2（Standards 2）**：增加实际经过 jobs／job_output 新事实的 Python SDK 当前场景与官方生成记录。旧 advanced／recovery 原 golden 零变化只能证明旧场景未受影响，不能替代新事实覆盖。若正式 SDK 不投影某些 log-only 数据，需用实际 JSONL 证明场景确实产生这些事件，同时验证公开 SDK 投影；不得手写伪造 metadata 或仅添加无场景使用的 normalizer。保留旧 V2/V3。
- **修 R3（Spec 1）**：真实 Loader＋loop＋JSONL 的拒绝／策略替换／未知 ID 负向回执断言；证明没有伪造 jobReceipt，未执行 read 的路径不推进既有 job cursor／pending。不要把真实 read 后的输出替换误写成“从未收取”。

以上三项均击穿当票明确验收或仓库硬标准，保留在 #142，不扩成通用重构。交高级 fresh 执行者整改；修后由 CEO 对照此清单、固定提交与命令证据直接收口，不再派第二轮评审。

## CI 事实与范围

当前 PR 未合并，CI 不是全绿。已读取实际日志：Issue lifecycle 缺 GitHub App client-id；Issue policy 请求错误仓库；Cloudflare preview 的 token／account 均未配置。Release 的 npm consumer 安装因 `@aws-sdk/types@^3.975.0` ETARGET 失败。后者不能仅凭状态判为本补丁代码错误，需继续按依赖与日志分层核对；不改无关依赖、workflow、secrets 或 matrix 来制造绿色。主体 static／coverage／snapshot 结果仍须回读。

## 整改后 CEO 直接核对

最终源码 `8282d61299a04f60555f9ce473af174bbe161b02` 已核对本地／远端一致及 tracked clean；未做第二轮评审。CEO 回读实际实现、测试和原始日志，而非把执行者汇报直接当通过。

- **R1 已闭合**：settle 现在先复制／清除 waitResolvers、同步解除 abort 并 resolve、markSettled，再 journal。真实 owned Session 同步监听者的有效红测与 88/88 绿色日志保留，回调实际执行。没有改公共等待契约。
- **R2 已闭合**：新官方 sdk-jobs 场景使用实际 runtime/provider/loop 和公开 producer，JSONL 六条 jobs 事实与 SDK events／notifications 在归一化前逐项比较；first／repeat、unknown 无 receipt、独立 instance 的 remove 均被断言。官方只读 replay 通过；不是未使用 normalizer 或手写 metadata。旧历史不变。
- **R3 已闭合**：Loader＋loop＋JSONL 的 deny／replace／unknown 均验证无伪回执、pending 保持，后续正式读取仍完整且 first；post-read replacement 另证实际收取已提交而 presentation 无 receipt。66/66 日志已读，原成功路径仍在。

生产源码从 R1 checkpoint 到最终 head 无额外差异，匹配官方测试 exe SHA256 `b453e48d0a3447f1b65dd75033b6e176521a0781dfbed2b11d55f5747f58f78d` 已由 CEO 实算。Host／Client、doc-sync 43/43、pre-push 及 SDK 命令证据保留。这里接受源码整改，不声称既有实例已切换或 CI 全绿。

QA 新 Host 以 8282d612 固定源码在独立树构建，rollback 仍为 a450。匹配插件的真实既有实例、LLM 和升级保留继续由 #141 验收；当前尚未部署。
