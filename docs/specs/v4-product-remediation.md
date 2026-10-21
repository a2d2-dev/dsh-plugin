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

真实 job_output 组合使用 QA 交付的 Host `8282d61299a04f60555f9ce473af174bbe161b02` 四个一致制品（session／jobs／jobs-local／tool-jobs），manifest 和四个归档 SHA256 已逐一核对；未写 Host checkout 或运行目录。独立 `.local/matched-host-8282-env` 复制当前 src/tests 并保留原 lock 的其他依赖解析，四包 pnpm overrides 一起安装，固定 pnpm 10.26.2、ignore-scripts。真实 owner Session 的 appendIgnorable 和 registry.observe 均断言存在，测试输出四个实际解析路径全部为该 fixture 内 file+packages+ 制品，未做混合 singleton 方法替换。

组合的 baseline（仅在私有源码快照移除完成前检查，finally 恢复）明确红、exit 1：子和 job 在途时出现不可逆 completion／external intent。当前实现的真实连续模型工具链为：过早 work_report → native continuable 通知真实入父 user/message → 终态 job 尚 pending 时再次拒绝 → 原生 job_output 正式 collected 与 jobs/collected journal → 另一必要工具仍在途时拒绝 → 工具结束后恢复不自动采纳 → 新一次模型 work_report → 唯一父结果、一次受控 SourcePort 关闭、安全 closeout settled → 第二项真实独立 Session 执行 work_control wait。固定 Task／Execution／owner／epoch／原 Session 不变，没有新建第一项身份。外部 port 和模型输出是确定性边界，未调用真实 LLM／GitHub 写。

`TMPDIR=/dev/shm/v4-pf-141 corepack pnpm@10.26.2 exec vitest run --config vitest.matched-host.config.ts --maxWorkers=1`（在私有 env）：1/1、1490ms、exit 0。一次中间失败的末条断言期望第二项仍 active，而模型已无后续动作并被原调度器正常 blocked；改为第二项实际 work_control wait，显式验证其独立处理与等待，不关闭 idle 防空转保护。

可复现入口为 `A2D2_MATCHED_HOST_DIR=<approved-artifact-root> TMPDIR=/dev/shm/v4-pf-141 node scripts/verify-v4-completion-host.mjs`。脚本固定验证 Host revision 与四个已批准 hash，保留所有绝对 file 依赖、缓存和制品在本工作树忽略目录，保存每个源码／测试的 SHA256 provenance，执行完整安装与该正向 lane。普通 stock rc2 缺 observe 的反向合同仍保留，未 skip／翻状态冒充此真实证明。

补充边界：宿主观察抛错先红，现具名返回 completion-results-unsettled 而不泄露异常细节或创建终态。四文件三项整改组合曾 30/30、exit 0；之后 F2 增补 closed 子不得自动验收、纯本地拒绝无关 externalChildren、外部子资料变化拒绝旧 updatedAt，当前 F2 独立14/14、exit0。

一次扩大组合为7文件84项，77 pass／7 fail、exit1，全部来自旧 continuous 测试在 pending 时先报告 done 的旧期望。按新合同调整为先具名拒绝、保留 owner，再 idle 并显式重新确认，正向来源补充已完整空子范围；维护失败、未知／缺观察、Block、重复身份原断言均保留，未改预算。该文件随后33/33、exit0；其余6文件51项当次已绿，未为状态更新重复跑。

## P-F2：必要原生子范围与独立验收

根因是完成只遍历本项目已链接的 `task.children`，未导入、跨项目 canonical 和部分读取均可被当成无子项。完成现在同时检查唯一来源身份下已接受的原生必要范围（默认 binding.accepted，明确采纳后为 acceptedChildren）。缺元数据、hasNextPage、条目去重后的数量不符均返回 `native-child-scope-incomplete`。跨项目 canonical 的真实 Task 未验收时返回 `native-child-acceptance-required`；外部 closed／PR merged 不替代验收。

未导入子项不强制造 Task／会话。负责者使用 `work_related_issue` 从当前 Task 已知 related refs 读取规范化资料；该 helper 验证当前 Session／epoch、返回 node／repo／number 和账号，目标来自受信记录，不能传任意 URL／目录，响应不含凭据。随后报告 externalChildren 的 nodeId、精确 updatedAt、当前验收依据与可核验证据。已有 canonical 永远优先，不能借此绕过未完成 Task。

Repo 的原 detail 不读取原生关系；仅受信 helper 请求 nativeChildren 时，生产适配器读原生 `/sub_issues` 端点，最多十页一千项，重复身份、数量不符或上限保留明确不完整。读取仅缓存观察。unknown 范围须由 owner 用 `work_organize` 的 source-children、当前版本和精确 observedAt 显式采纳；不能移除此前已接受必要项。后续刷新不悄悄扩张业务范围。纯本地无源 Task 不增加来源要求，旧完成历史不新造验收。

- 未导入子项公开回归在原路径错误 completed 时红、exit 1；外部证据路径先红（旧 schema 不支持），实现后绿。
- 生产适配器完整原生分页回归先红（subIssues undefined、exit 1），实现后 101 子项、两页完整读取绿，未泄露凭据。
- `TMPDIR=/dev/shm/v4-pf-141 corepack pnpm@10.26.2 exec vitest run tests/work-native-acceptance.spec.ts tests/work-completion.spec.ts tests/work-continuous-integration.spec.ts tests/work-progress.spec.ts`：4 文件 29/29、exit 0。新增矩阵 11 项涵盖未导入、跨项目真实 owner、不完整三种情况、外部证据、无子、纯本地、显式采纳、刷新不扩张、禁止删必要项及只读 helper 权限。
- 旧正向外部完成 fixture 未描述原生完整性，首次组合如实 7 fail、21 pass、exit 1；只给这些正向来源添加明确的已完整读取空集合，保留全部原断言。unknown／partial 的反向路径由新增测试独立锁定，未放宽预算或跳过失败。

## P-F3：原生关系导入遵守双端冻结

根因是 source.import 在普通完成／交接 guard 前分派，来源自动链接直接改写双端业务结构。现在来源关系、显式本地链接和负责者整理复用 Task 结构保护：预检父和子，已验收或交接中均不改边。来源仍可接入 canonical Task 并保存真实观察，在 binding 持久化 `source-hierarchy-frozen`＋具体原因、两端 TaskRef 和差异说明；ExecutionGraph 的 limitations 传给既有执行面板，源原生关系与本地业务关系继续分别呈现。

已完整链接关系的重复观察不重写版本。交接完成后，显式 re-import 可正常采纳双端边，并清除任一端来源记录里已经解决的差异；不重建 canonical／owner、不改历史完成。

- `TMPDIR=/dev/shm/v4-pf-141 corepack pnpm@10.26.2 exec vitest run tests/work-source-freeze.spec.ts`：首条真实 DSH 公开路径红、exit 1，原完成父从 version 4／children=[] 变成 version 5／planned child。修复后父完整记录不变、子来源接入成功，两端边保持原值。
- 首次 handoff 参数化测试误用 each 的第二参数取得测试 context，2 项 fixture TypeError、exit 1；改用公开 `it.for` context，未调整断言或预算。
- 追加接任后从相反端重新采纳的回归先红（旧 warning 残留），小范围清理已解决边后绿。
- `TMPDIR=/dev/shm/v4-pf-141 corepack pnpm@10.26.2 exec vitest run tests/work-source-freeze.spec.ts tests/project-discovery.spec.ts tests/client/v4-integrated-render.spec.ts`：3 文件 24/24、exit 0。涵盖已完父导子、已完子导父、父／子交接和接任后恢复、显式 local link 的 child guard、正常可变关系、幂等及原17项发现／层级合同。
- agent-browser 使用专用 session `v4-pf-141`，打开本工作树 file 组件夹具，1280×1100 与 390×844 截图已读；完整窄屏截图显示来源原生子入口和具名冻结差异，viewport=390／document=375／warning=true。证据位于 `.local/v4-integrated/remediation-freeze-desktop.png`、`remediation-freeze-mobile-full.png`，页面明确“合成测试数据／非运行实例／未部署”。未开服务器，未将组件截图算实际实例验收。

## 最终构建边界

第一次完整 build 的 client 声明阶段发现结构保护导入了带 `node:crypto` 的 continuation 运行模块，exit 2；typecheck exit 0 不能掩盖该红。将既有 `continuationInFlight` 纯状态谓词移至 browser-safe state 模块并从原运行模块 re-export，结构 guard 共用同一规则；未增加 Node 类型或放宽客户端编译配置。

该修正后 `corepack pnpm@10.26.2 build` exit 0；`typecheck` 独立 exit 0；定点 `tests/work-source-freeze.spec.ts tests/work-continuation.spec.ts` 2文件23/23、exit0，覆盖原17项真实接续、双代次决定保留、冷恢复旧段工具围栏及新结构冻结矩阵。构建仅替换已核对的本工作树 lib，没有复制到 profile／运行目录。

最终源码检查点 `012c4f7145426d49ee2c80e0b3b889f6ccf76c2a`：所有源码和测试与 matched fixture provenance 的211个 SHA256 逐一一致。可复现脚本最后实际执行1/1、1352ms、exit0；完整安装 ignore-scripts，pnpm10.26.2。

`PATH=<本工作树>/.local/v4-integrated/bin:$PATH TMPDIR=/dev/shm/v4-pf-141 node scripts/verify-pack-exports.mjs` 独立 exit0，14个 Node 公开入口 verified；包装器仅 exec corepack pnpm@10.26.2。客户端 bundle 检索只有 react 与 react/jsx-runtime 两处 require，没有 Node builtin 或 randomUUID。

保留 QA 包 `.local/v4-pf-141-pack/dsh-a2d2-0.0.1.tgz`，由 `corepack pnpm@10.26.2 pack --pack-destination .local/v4-pf-141-pack --json` 实际生成、exit0；SHA256 `56709afccea64797a7b9275ae26ab4fecd039ea8ee5162efb1ecd0c40509e2ad`。该包未安装到任何运行实例，未提交编译产物。最终说明提交只追加本记录，不改变上述源码／测试与包内容。

未验证：实际18781／18782页面部署、真实 LLM 业务计划／接续、真实 GitHub 业务关闭及升级数据保留。它们由父CEO／QA最终统一验收。新回归明确使用tmpfs，原ext4 setup长阻塞和旧红保留；本次不声称修复该环境问题。没有第二轮review、approved自审、合并、关票、推送交付目标分支或Host／profile写入。

## 范围记账

WorkApplication 的 possible Divergent Change 留作后续深模块整理线索，本票不拆大 class／运行器。已撤回的维护锁环不修。旧 #123／#129、Host、运行目录、18781／18782、真实模型与 GitHub 业务写均未纳入本次源码整改。
