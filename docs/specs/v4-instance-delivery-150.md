# #150 既有 DSH 实例交付规格与执行边界

本规格补充 [#150](https://github.com/a2d2-dev/dsh-plugin/issues/150)，父规格为 [#136](https://github.com/a2d2-dev/dsh-plugin/issues/136)。它只收敛剩余实例交付，不重开已接受的产品和 Host 设计。词汇沿用 [已接受候选的领域词汇](https://github.com/a2d2-dev/dsh-plugin/blob/fc4fa731809c2e43d1017045b02372cb134080f8/CONTEXT.md)，不以当前 main 的旧词汇重定义 Task、Project 或 Session。

## Problem Statement

源码、制品与合同测试已有固定证据，但用户当前 GUI 和既有预览尚未更新。用户需要在原有入口使用 v4 工作流，同时保留会话、任务、工作目录、模型与权限，并能在切换失败时恢复可运行环境而不丢新增输入。

## Solution

先在既有 18782 预览完成有界安全切换与真实模型、页面和数据验收，再通过不依赖被重启 GUI 的受管机制更新原 18781。使用已审产品与匹配 Host、完整独立回滚宿主、固定工具和精确计划；更新和验收分别记录，不以一次成功启动代表业务能力已通过。

## User Stories

1. 作为既有用户，我要刷新原 URL 后使用新能力，并继续访问原 Session、Task 和执行材料。
2. 作为任务负责者，我要保留有效模型、权限、工作目录和当前处理关系，避免升级改变工作身份。
3. 作为交付负责者，我要先在既有预览验证实际制品和完整流程，再更新正在承载主会话的 GUI。
4. 作为交付负责者，我要只暂停指定目标实例，另一实例的正常协调不应成为预览的前置。
5. 作为用户，我要在失败恢复中保留切换期间新增输入，而不是恢复旧数据快照。
6. 作为用户，我要看到真实自然语言计划、预览零执行、Block、等待让槽和串行推进的实际结果。
7. 作为用户，我要在真实自动接续后保留具体决定，准备期间仍由原段负责，正式接任才更新入口。
8. 作为用户，我要让父子工作分别验收、正式收取原生子与 job 结果，并在远端关闭冲突后只补同步。
9. 作为维护者，我要有准确的部署、模型和数据证据及未验证边界，自主决定 PR 合并。

## Implementation Decisions

- 沿用已接受的产品候选 fc4fa731、Host 8282d612 和兼容回滚 a45068d2；不升级到最新上游、不重新构建已核验资产。
- 一次 fresh 运维风险审查覆盖实际调用链、固定计划、路径、信号、凭据引用、解码和失败恢复。只修验收破口或实证安全问题，其余记账；修后主会话直接逐条闭合。
- 预览只核对自身真实 PID/代次、Session、输入、jobs 和 accepted cut，不要求 GUI 中父会话或 QA 停工。
- 对既有 wrapper 使用已审的单 PID 信号与 future-spawn hold；临执行才采集事实。退出码零不能证明 graceful、flush 或业务消费。
- 停后以旧进程消失、无数据写入描述符、完整 zstd、accepted prefix/业务材料保留、两套宿主原生只读结果核验数据。强退、信号、非零或超出已定安全窗口时拒绝切新。
- 仅数据完整性可证明时恢复可运行独立旧宿主及配置；不覆盖 Session/Task 数据、不删除失败期间新增材料。
- 精确计划与执行指令绑定 SHA。准备计划保留真实未完成门，不预填 live 交接、cut、flush、graceful 或 product consumed。
- GUI 自升级由服务进程组以外的系统管理器继续；原主会话不能等自身重启完成。恢复输入必须明确机器来源，保留原会话引用，不伪装 LF。
- 真实验收只操作带 nonce 的自有专用对象；共同 run 标签、serial 硬标签和 node allow-list 双重约束。先核对旧持续规则，保护原规则和现有业务对象。
- 可回滚 dev 更新授权沿用父任务；不新增 LF 确认门。PR 由维护者决定合并，CEO 不代 merge。

## Testing Decisions

最高接缝是原 URL 的公开工作命令/查询、宿主正式 child/job 能力与真实持久记录。已有合同测试用于失败窗口与确定性边界，实际模型、运行截图和原数据比对单独取证。

| 验收面 | 必要证据 |
| --- | --- |
| 预览实际更新 | 原 18782 刷新、真实 client/Host 指纹、桌面和 390px 页面 |
| 双来源与身份 | 自有 Repo/Project、同 Issue 的 Task/Execution/当前 Session 唯一 |
| 独立验收与结果 | 原生父子、必要外部子材料、真实 native child/job 正式收取 |
| 自动接续 | automatic=true、准备与接任入口时序、两个具体决定由新模型复述、旧段失权 |
| 持续委托 | 真实模型请求/路由、预览零执行、Block、暂停、A 等待→B 完成→A 恢复、重启保持 |
| 完成补偿 | 本地验收与外部关闭分别成立、真实冲突后补同步不重跑 |
| 安全失败 | 单信号、真实退出/耗时、停后完整性、可运行回滚、保留新增数据 |
| GUI 实际更新 | 外部受管继续、原 18781 刷新、原身份/模型/权限/CWD/材料和数据比对 |

每场景报告包含中文目的、步骤和记录。模型自报、静态 SSR、旧截图、mock 计划、构建通过或远端 Closed 均不能替代对应运行证据。原 ext4 setup 超时记录保留；必要 tmpfs 合同测试不得被描述为原环境已修复。

## Out of Scope

生产发布、替代 GUI 服务器、新端口交差、处理 freeland/Project14 或现有开发 Issue、重开产品/Host 评审、新全局 admission 平台、删除用户数据、伪造真人或消费事实、自动合并 PR。

## Further Notes

执行票和实时状态以 GitHub 为准：[#151 运维风险审查](https://github.com/a2d2-dev/dsh-plugin/issues/151)、[#152 预览真实验收](https://github.com/a2d2-dev/dsh-plugin/issues/152)。准备不等于实际部署；预览业务验收与 GUI 服务外恢复是后续真实切换的前置。主会话为 session-74fb5e20-1456-461b-b5c1-ef5f3b41e018。

初始冻结工具为 test/v4-acceptance @6b2522189cc64ebdea608789949b3237aa4b1d29，代码点 e247236、计划工具点 39fe47e；初始计划 SHA256 659f9d7d6fd17104ae1c4978312250442d75b882172df696237ad8a64f31b64c。任何整改或授权变化均需要新的最终 SHA，不能沿用初始 SHA 宣称已授权执行。

产品 [PR149](https://github.com/a2d2-dev/dsh-plugin/pull/149)、工具 [PR148](https://github.com/a2d2-dev/dsh-plugin/pull/148)、Host fork [PR5](https://github.com/imneov/deepseek-harness/pull/5) 当前均未合并；没有因此关闭父任务或宣称运行交付通过。
