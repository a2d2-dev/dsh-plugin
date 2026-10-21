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

## P-F2：必要原生子范围与独立验收

根因是完成只遍历本项目已链接的 `task.children`，未导入、跨项目 canonical 和部分读取均可被当成无子项。完成现在同时检查唯一来源身份下已接受的原生必要范围（默认 binding.accepted，明确采纳后为 acceptedChildren）。缺元数据、hasNextPage、条目去重后的数量不符均返回 `native-child-scope-incomplete`。跨项目 canonical 的真实 Task 未验收时返回 `native-child-acceptance-required`；外部 closed／PR merged 不替代验收。

未导入子项不强制造 Task／会话。负责者使用 `work_related_issue` 从当前 Task 已知 related refs 读取规范化资料；该 helper 验证当前 Session／epoch、返回 node／repo／number 和账号，目标来自受信记录，不能传任意 URL／目录，响应不含凭据。随后报告 externalChildren 的 nodeId、精确 updatedAt、当前验收依据与可核验证据。已有 canonical 永远优先，不能借此绕过未完成 Task。

Repo 的原 detail 不读取原生关系；仅受信 helper 请求 nativeChildren 时，生产适配器读原生 `/sub_issues` 端点，最多十页一千项，重复身份、数量不符或上限保留明确不完整。读取仅缓存观察。unknown 范围须由 owner 用 `work_organize` 的 source-children、当前版本和精确 observedAt 显式采纳；不能移除此前已接受必要项。后续刷新不悄悄扩张业务范围。纯本地无源 Task 不增加来源要求，旧完成历史不新造验收。

- 未导入子项公开回归在原路径错误 completed 时红、exit 1；外部证据路径先红（旧 schema 不支持），实现后绿。
- 生产适配器完整原生分页回归先红（subIssues undefined、exit 1），实现后 101 子项、两页完整读取绿，未泄露凭据。
- `TMPDIR=/dev/shm/v4-pf-141 corepack pnpm@10.26.2 exec vitest run tests/work-native-acceptance.spec.ts tests/work-completion.spec.ts tests/work-continuous-integration.spec.ts tests/work-progress.spec.ts`：4 文件 29/29、exit 0。新增矩阵 11 项涵盖未导入、跨项目真实 owner、不完整三种情况、外部证据、无子、纯本地、显式采纳、刷新不扩张、禁止删必要项及只读 helper 权限。
- 旧正向外部完成 fixture 未描述原生完整性，首次组合如实 7 fail、21 pass、exit 1；只给这些正向来源添加明确的已完整读取空集合，保留全部原断言。unknown／partial 的反向路径由新增测试独立锁定，未放宽预算或跳过失败。

## 范围记账

WorkApplication 的 possible Divergent Change 留作后续深模块整理线索，本票不拆大 class／运行器。已撤回的维护锁环不修。旧 #123／#129、Host、运行目录、18781／18782、真实模型与 GitHub 业务写均未纳入本次源码整改。
