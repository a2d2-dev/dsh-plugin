---
title: 修复子结果重复读取阻塞任务推进
type: bugfix
created: 2026-11-01
status: done
baseline_commit: 8a71db6
context: [AGENTS.md, CONTEXT.md]
---

<frozen-after-approval reason="LF 已授权本次修复并要求自主推进验证">

## Intent

#1474 会话 7 已花费 28 分钟完成 15 次结果分页，实际读取的是三个已结束子会话中的工具定义、技能列表、模型重放字段等。插件将整个末轮事件流序列化并强制按 12000 字符分页；epoch 切换还会拒绝旧游标。修复结果呈现和进度继承，使任务协调者能收到真实业务输出并继续验收。

## Boundaries & Constraints

始终保留当前协调会话/epoch 权限、原生父子归属、最新末轮 endSeq、结果 revision、真实已提交工具回执校验。未成功交付的调用不能冒充已读；有新一轮输出时旧回执不能结清新结果。接续只继承同任务可信会话中的不可变读取事实，不赋予旧会话新执行权。

本次可修改插件源码、相关回归测试与文档，安装并验证独立 dsh-dev 实例。开发实例入口 https://dsh-dev.e5box.a2d2.dev/，DSH_HOME=/data/_ssd2t/dsh-plugin-dev/home，Supervisor=dsh-plugin-dev-server。先完成独立开发 profile 验证，再将同一修复包应用到 #1474 当前实例（配置服务名 dsh-web-server）。LF 已说明当前均为开发环境并授权直接修改；保留原任务控制，核实原会话实际恢复读取。不修改 #1474 的业务代码、规格、验收状态或已有工作目录。

结果中应保留子会话实际可见的业务输出、失败或中断语义、准确原始日志定位与必要元信息。禁止将工具 schema、系统/运行提示、源模型 replayState/encrypted 字段作为强制读取内容。不是生成二次模型摘要，也不能用固定文本或 fallback 代替真实输出。更长的真实业务输出仍需正确分页。

| 场景 | 输入状态 | 预期行为 |
|---|---|---|
| 正常业务结果 | 子会话已返回且有原始运行配置和 replay 数据 | 返回真实业务文本与末轮身份，噪音不进入结果分页 |
| 长结果 | 业务文本超过一页 | 连续分页、完整交付才形成完成回执 |
| 接续 | 同任务后继接手，child/endSeq/revision 未变 | 可发现并继续原可信游标，完整回执不因换 epoch 被抹掉 |
| 内容变化 | 子会话新末轮或 revision 变化 | 拒绝旧 revision，不把旧结果当作新结果已收到 |
| 无真实工具提交 | 仅直接调用应用方法伪造读完 | 观察仍为未接收 |
| 权限和控制 | 无关或旧协调会话、暂停或真实等待 | 保留既有访问和执行限制 |

</frozen-after-approval>

## Code Map

- src/work.ts：sessionChildRecovery 分页、回执与授权。
- src/work-execution/dsh-host.ts：原生结果投影、观察中的工具提交校验。
- src/work-types.ts、src/work-schema.ts：回执存储契约。
- src/work-execution/tools.ts、continuation.ts：工具说明和接续材料中的读取指引。
- tests/work-continuation-pending-children.spec.ts：真实原生子会话、接续、提交回执的 host 测试。

## Tasks & Acceptance

- [x] 最小回归先失败，覆盖带重放噪音的结果与跨接续结果进度。
- [x] 修改结果呈现、回执继承及相关模式，兼容已有存储记录，保留权限与结果变化校验。
- [x] 更新读取指引及文档；执行受影响 host 测试、类型检查、构建与必要相关检查。
- [x] 对相同工作负载记录修复前后结果大小、页数与耗时，不声称未测量的延迟改善。
- [x] 构建并安装到独立开发 profile，通过 agent-browser 验证真实结果读取及一次接续后的行为，记录中文报告和截图。
- [x] 独立只读审查、修正实际问题、commit/push/PR 并按 LF 默认交付契约合并。

给定真实已返回子会话，当当前任务读取结果时，拿到真实输出且不被重放字段耗尽分页。给定同一不可变结果，当任务接续时，可信进度保留，原有权限边界保持。给定子会话再次输出，当旧结果回执被观察时，不得将新输出标为已接收。

## Verification

针对测试沿用 vitest host project，保存失败和通过的原始日志；pnpm typecheck、pnpm build。UI 仅使用 agent-browser CLI，开发实例重启使用独立重启工具。证据 docs/artifacts/1474-child-result-2026-11-01/。原诊断证据位于 /data/src/github.com/a2d2-dev/docs/artifacts/session-1474-2026-11-01/README.md。

## Spec Change Log

- 现场发现实际部署还带未入主干的恢复补丁，8条事件有discardReason=superseded。保留现存数据、添加精确可选literal兼容；实际部署从525b249集成，主干不夹带恢复补丁。
- 原status243耗时169.882秒；已携带child原父子关系可直接核实，跳过无关全图；未知child/replace仍全图核实。旧raw部分回执的status不再发布不兼容游标，明确restartRequired；成功result不返回旧重启指令。

## Suggested Review Order

- 从当前协调者权限与已携带子会话读取入口开始。
  [work.ts:456](../../src/work.ts#L456)
- 核对原文投影、终态与工具日志定位。
  [dsh-host.ts:37](../../src/work-execution/dsh-host.ts#L37)
- 核对跨会话每页的真实提交证明。
  [dsh-host.ts:357](../../src/work-execution/dsh-host.ts#L357)
- 检查旧格式重启提示仅属于status。
  [work.ts:526](../../src/work.ts#L526)
- 检查真实原生分页与跨接续负例，以及持久格式兼容。
  [work-continuation-pending-children.spec.ts:30](../../tests/work-continuation-pending-children.spec.ts#L30)
  [work-schema.spec.ts:5](../../tests/work-schema.spec.ts#L5)

验证报告： [issue-358-child-results.md](../verification/issue-358-child-results.md)。原始证据位于本机 docs/artifacts/1474-child-result-2026-11-01/，遵守仓库私有证据排除规则。

## Delivery Record

实现与验收报告已完成；Git交付以[PR #359](https://github.com/a2d2-dev/dsh-plugin/pull/359)最终merge/checks回读及[Issue #358](https://github.com/a2d2-dev/dsh-plugin/issues/358)状态为准。原业务#1474剩余三页受既有单槽队列限制，已保留原进度和恢复请求；该限制没有作为产品缺陷或完整业务验收通过。
