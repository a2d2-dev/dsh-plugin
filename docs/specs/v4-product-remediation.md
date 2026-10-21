# #141 一轮评审后三项整改

固定接手：`19a6bec31e2723d4c6e7e8d2c6bb83de4f8428e8`，仅 `v4-integrated` / `feat/v4-integrated`。裁决来自 CEO 的一轮双轴产品评审，整改不启动第二轮评审、不部署、不改 Host。

## P-F1：完成前保留结果收取资格

根因是 `task.report` 在必要原生结果／job 尚未收取时就提交不可逆完成事实，随后原有终态 guard 拒绝原生推进和 `job_output`。现在在同一业务提交事务内先读取权威关联执行观察；pending／unknown 返回 `completion-results-unsettled`，不保存完成、候选验收、父通知或外部关闭意图。结果变化后必须由负责者重新报告，恢复不会自动采纳早先结论。

报告工具通过宿主分配的不可序列化 token 证明当前真实 `work_report`。宿主记录包含 admission 在途的工具调用，并检查公开日志中尚无结果的原生／PTC 调用。只有本次直接 report 自身的 running 被排除；其他调用、关联 Session、native child、job 和未知状态仍阻止完成。此路径只观察，不进入 `whenIdle`／`maintain`。完成后的普通 pre-step 和工具 guard 保持关闭，安全收口继续由既有维护边界执行。

验证使用固定 pnpm 10.26.2、专用 `TMPDIR=/dev/shm/v4-pf-141`。这只改变 fixture 文件系统，不增加原测试预算，不声称修复 ext4 setup 阻塞。

- `corepack pnpm@10.26.2 exec vitest run tests/work-completion.spec.ts -t 'rejects premature'`：原实现 2 项红、exit 1，错误返回 completed；修复后 2 项绿。
- 真实本地 DSH＋确定性模型：`tests/work-completion-native.spec.ts` 的模型 `work_report` 先因自身 running 红、修复后通过；native continuable 使用真实 SubagentRuntime 的公开 startContinuable 和 fresh provider 创建资料，真实子模型／工具结束后，settled notice 实际进入父 `user/message`，重新报告才验收并 settled。移除完成前检查重放同一 native 测试明确红、exit 1。
- `TMPDIR=/dev/shm/v4-pf-141 corepack pnpm@10.26.2 exec vitest run tests/work-completion.spec.ts tests/work-completion-native.spec.ts tests/work-progress.spec.ts`：阶段检查 17 项绿、exit 0；随后新增 native intake 测试单独 2/2、exit 0。
- 首次 typecheck 有一处严格空值类型错误，已修复，最终 typecheck 待整体收取。

真实 job_output 组合待与 Host `8282d612` 一致的 session/jobs/jobs-local/tool-jobs 编译制品 fixture 环境；当前 stock rc2 缺公开 jobs.observe，不能以 fixture 翻状态代替。后续证据会追加本记录。

## 范围记账

WorkApplication 的 possible Divergent Change 留作后续深模块整理线索，本票不拆大 class／运行器。已撤回的维护锁环不修。旧 #123／#129、Host、运行目录、18781／18782、真实模型与 GitHub 业务写均未纳入本次源码整改。
