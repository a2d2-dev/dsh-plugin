# v4 整合与最终验收检查点

本清单属于 #136 的交付编排，原始验收仍以整体规格和原型为准。主会话只裁决与复核；源代码冲突及接线交独立实施者处理。整体 Draft PR 为 #143，base 为 spec/dsh-control-panel-v3 的已接受集成基线 b477025。

## 已核验与待核验

- 来源首片 bfbf0db 已在固定 detached 检出独立运行公共合同，2 文件 30/30、exit 0；已整合为交付提交 454a94a。代码与通过测试的 src/tests 完全一致。完整视图／目录／UI 仍待 A 最终提交及里程碑验收。
- 执行观察首片 e6ca554 已在固定 detached 检出独立运行 3 文件 4/4、exit 0。不能由此宣称缺 scope、最新 flush／connector 或真实宿主 journal 已验收。
- 完成补偿候选为 PR #144 / 87ef88c，固定 base a8ee660；本地、远端、PR head 已核对，分支 clean。CEO 独立七组 52 项为 50 pass／2 个原 5000ms 超时；原红保留。高级只读诊断 session-49c94ae1-7b8b-4fa9-822e-f5b948afb382 正在做固定 target/base 对照，未调整预算。
- D 与 B 首片的真实两项连续处理组合由执行者报告通过；最终 B scope/flush、host142 及完整 UI 接入后仍须 CEO 复验，不能沿用中间绿色关闭整票。
- H 宿主补丁固定 a45068d2，已包含公开观察、稳定 epoch/instance、终态 read receipt 和 log-only ignorable journal；前台 remove 的正式收取记录与 teardown 区分。真实组合及包／CLI／snapshot 产物待最终验证。
- 所有独立检查点是阶段事实，#137–#142 当前均不得仅凭代码／PR／SSR 截图关闭。

## 源码整合顺序

先接 A 的来源、目录与工作台，再接 B 的执行图／原生槽位，随后接 D 的完成操作，最后接 C 的委托／计划与串行复用。Q 的验收工具保持独立。相同公共文件的文本冲突由整合实施者解决，不通过覆盖某一分支丢掉另一片行为。整合实施者另占持久候选工作树和分支，完成后提交、推送并开可审查的总候选 PR；不通过直接推送子 PR 的目标分支制造已合并状态。PR 合并由维护者决定，CEO 不代合并。

### 必须保留的公共合同

- TaskRef、ExecutionId、owner/epoch、当前 Session、canonical Issue 身份与来源范围分别成立。同号跨仓库不能复用，跨来源同 Issue 不能再造 Task 或 owner。
- WorkApplication 必须连接权威 ObservationScope。无 scope 为 unknown，不能假设只有当前和退休会话。查询 graph 不能读取／收取模型作业输出。
- connector 核对完整 ref/executionId/owner/epoch/current Session。固定 operation 已 taken 但 inputSeal 缺失时，源侧 seal 恢复仅接受精确 source/sourceEpoch、固定 successor/sourceEpoch+1 和匹配 retired 记录；不恢复旧协调权。采用 B 最终已验证实现，不能被 D 的普通 owner 检查覆盖。
- `maintain` 是相关执行者安全结算和日志 flush 的权威屏障。对新增 live 关联／后代补锁并重读；未知不放行。D 的 body 仅原子提交 closeout，禁止嵌套 settle/whenIdle 再申请已持有锁。
- 真实 job 以 registryEpoch／instanceId／job.id 合并。pending、collected/delivered、模型消费未知、业务验收分别展示。正式前台 remove 可记录控制器收取；owner/service teardown 不能假算收取。
- 独立子 Task 只作自己的处理入口与验收，不纳入父原生 Session 子树或接续围栏。
- 计划草案的 canonical 引用不是 dispatch claim。预览或改委托不改变原执行 guard、owner、active 槽及在途收尾。显式启用才原子接纳；其他 rule 已拥有时等待而非抢占。
- 接纳既有执行保留原资源／策略／owner／epoch，并在预览中明确；新建执行只使用规则授权资源。Block 只约束后续接入。
- 完成事实、父结果与可选关闭意图先原子保存。缺结算证明保持 pending；外部 close pending/error 不阻止已经安全收口后接下一项。未知关闭回执先观察，不重新执行工作。

## UI 接线与密度

- B 的 ExecutionSessions、ExecutionContinuation 接 Issue 的“会话与执行”和“接续”；D 的 CompletionStatus 接完成事实与补同步；C 的独立委托组件接来源工具栏右侧。
- 以原型的紧凑顶栏为准：A²D² 控制面板、来源标签和加号在同一导航层；下方为概览／项目／Issue／PR。减少大标题、来源标签与来源摘要重复占据首屏的高度。
- Project 与 Repo 的对象页签不同；Issue 筛选独立于 Project view。需要关注、正在处理和最近进展可从概览直接到真实执行。
- Issue 顶部仅一处自动接续设置；参数在接续页直接可见。原生聊天保留单标题、宿主控件和草稿。非 blank 标题旁用关联入口，blank 保留 dock，轨迹遵守宿主设置。
- 组件 SSR/file 页截图只作为中间布局证据。最终必须在既有 DSH 同 URL 走真实交互，记录桌面／窄屏截图。

## 部署与继续机制

- 用户当前 18781 与既有 preview 18782 当前仍是旧包，均未切 v4。
- Q 已发现当前 dev 宿主 CLI bin.js 缺失。两个现有 PID 仍可服务不等于可重启；任何 stop 之前先证明新宿主、插件、CLI 依赖闭包及可运行回滚制品完整。
- 先让既有 18782 使用隔离且一致的 H 宿主制品与最终插件，保留原 origin 和数据；不能在 18781 活跃时改写两者共享的 dev lib。
- 18781 的升级必须在所有本任务 children/jobs 结算、会话 flush 后，由服务外的受管 one-shot 执行并留完成／失败证据。不能依赖被重启的 CEO 进程等待自身恢复，不伪造人类消息。
- 预览通过后再更新实际 18781 并刷新原 URL。升级前后比对原 Session／cwd／模型／权限及旧 Task 内容，允许正常追加记录与专用验收对象，不覆盖失败期间的新数据。
- 未完成实际页面、真实模型计划／接续、专用关闭对象与数据保留验收前，不标交付完成。GitHub 业务 freeland/Project14 只读，不启动其任务。
