# A²D² v3 实现能力核查

## 背景与范围

本次把已确认的独立原型转为开发规格，并按 LF 指示清理冲突 ADR。核查采用源码、既有测试和只读 GitHub 查询；没有运行产品测试、模型、真实任务或部署。本报告是实现证据，不把 mock、原型状态或历史测试记录宣称为本轮真实集成验收。

## 固定基线

| 对象 | 已核实事实 |
| --- | --- |
| 原型与设计确认 | 原型 `d6fe008`，确认记录 `a214914` |
| 当前规格分支 | `spec/dsh-control-panel-v3`，从 `a214914` 建立 |
| 插件产品代码 | `6c9ccb6f0d5d2caea7275fc798caf36436af4f69`；其至 `a214914` 的源码、测试、包声明和装配配置无差异 |
| 远端 main | `25c25a84022cfa72b467f00187dc7ee4bbc49f6d`；只读远端查询与本地引用一致，落后于本次采用的开发代码 |
| 已有运行器集成分支 | PR [#117](https://github.com/a2d2-dev/dsh-plugin/pull/117) 合入 `feat/task-runtime-phase1`，merge commit 为 `6c9ccb6`，并非合入 main |
| 开发环境配置分支 | `chore/dsh-dev-environment` 为 `3f72b0388dd218302ab77c90032a743858fd7479`，它不是新功能代码默认集成目标 |
| DSH 检出 | `a45068d2ec03326c800c68c9bdcd47508e3ccb9c`，describe 为 `dsh-v0.2.0-rc.2-10-ga45068d2ec` |
| 包版本限制 | 插件依赖多声明 rc.2，但宿主检出包含发布 rc.2 之外的接口；必须按能力和实际构建核验兼容范围 |

后续实现从已含运行器的上述开发代码建立隔离功能分支，再合入本规格文档；不能从旧 main 开工后把已存在能力重新实现，也不能借本任务将整条开发分支未经核验合入生产。

[旧任务 #70](https://github.com/a2d2-dev/dsh-plugin/issues/70) 是阶段 Agent 与 highway-card 工作，正文明确排除任务整页；[任务 #112](https://github.com/a2d2-dev/dsh-plugin/issues/112) 是已具备部分实现的运行器一期，排除新 UI 和外部关闭。本次需新的主任务，不修改或关闭这些历史任务。

## 架构与能力映射

| 能力 | 证据 | 结论与需要新增的内容 |
| --- | --- | --- |
| DSH 内单入口整页 | 插件现入口 [client/index](../../src/client/index.tsx#L60)；宿主 [main keyed slots](https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/client/ui-layout/src/client/index.ts#L56)、[panel list](https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/client/ui-sidebar/src/client/contract/slots.ts#L31)、[selectPanel](https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/client/ui-layout/src/client/service.ts#L28) | 可新增专用 main key 与侧栏入口，不替换 root/sidebar/conversation；selectPanel 不改变当前会话。无需先重做宿主路由。 |
| 会话导航 | [现有面板调用](../../src/client/panel.tsx#L54)、宿主 [openSession](https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/client/ui-workspace/src/client/navigation.ts#L405) | 进入真实会话可复用公开导航。项目切换不能调用会创建空会话的 connectWorkspace。普通 openSession 没有 readonly 参数。 |
| 独立项目查询 | [旧面板路由](../../src/panel.ts#L135)、[项目识别](../../src/store.ts#L43) | 旧路由依赖 live session 和 cwd；需新增按服务端 ProjectId 查询的入口，无在线会话也能浏览。 |
| Task 与 Agent 身份 | [Task 类型](../../src/types.ts#L43)、[绑定](../../src/index.ts#L646)、[Agent 账本](../../src/session-agents.ts#L25) | 有本地 Task 但执行仍 issue-bound；缺 ProjectId、ProjectAgent、完整规格/验收/证据。不能用虚构 Issue 编号过渡。 |
| 协调权与并发 | [运行存储](../../src/task-runtime/store.ts#L10)、[guard](../../src/task-runtime/runner.ts#L196)、[绑定竞争测试](../../tests/main-session.spec.ts#L126) | 已有同机 owner 和短写锁；尚无领域 epoch/ExecutionId。旧不同 Task 同时绑定同会话存在待防护窗口。需要 Task 与 Session 双向唯一性，不能宣称跨主机互斥。 |
| 会话历史和评审 | [成员投影](../../src/panel-types.ts#L32) | 有 handoffFrom 和当前主会话，缺用途明确的 Task—PR—review session 关联。评审不能夺取当前协调身份。 |
| 根会话装配与恢复 | [root-session](../../src/root-session.ts#L69)、[分步交接](../../src/task-runtime/runner.ts#L352) | 固定后继、preset/权限继承、消息回读和恢复步骤可复用；必须迁移操作身份，不另建一套恢复器。 |
| 来源发现与持续处理 | [运行记录发现范围](../../src/task-runtime/store.ts#L7) | 当前只枚举显式启动执行；Task inbox 不是来源队列。需来源配置、游标、候选索引、claim、分类重试和暂停新领取。 |
| 验收完成 | [completeTask](../../src/index.ts#L769) | 已不调用 GitHub，但仍要求 BoundTask，仅检查 summary；缺完整验收和完成操作。父通知先于子完成提交，需改为可靠完成事实后派生通知。 |
| GitHub 读取与 watch | [watch](../../src/github-watch.ts#L117)、[状态结构](../../src/github-watch/state.ts#L12) | 只有指定 PR 的状态订阅；不能充当 Issue/PR 目录、Project views 或外部关闭服务。 |
| 浏览器认证 | [认证边界](../../src/route-auth.ts#L4)、[认证测试](../../tests/route-auth.spec.ts#L176) | 复用宿主 operator 边界和写路由校验；服务端解析项目/资源，浏览器不传任意 cwd 或持有 GitHub token。当前不是多租户 RBAC 系统。 |

### 数据流程的目标接缝

1. 控制面板按 ProjectId 查询已接受工作和外部最后观察；查询不会申请执行资格。
2. 来源适配把 Issue/Project/PR 的观察送入工作应用层，按唯一映射导入或标记差异。
3. 工作应用命令接受稳定命令身份和版本条件，保存业务事实与协调意图，调用已有 DSH 执行端口。
4. 运行器记录当前会话、恢复点与事件投递；查询组合这些事实，历史和评审不自动改变当前指针。
5. 验收完成先成为可靠本地事实，再收口、通知父任务和可选同步外部关闭。

## 上下文接续的真实能力

当前全局阈值来自 [rotateTokens 配置](../../src/task-runtime.ts#L13)，[host 适配](../../src/task-runtime/host.ts#L64) 读取近似 contextPressure，[runner](../../src/task-runtime/runner.ts#L325) 在轮末安全条件下判断。它不能证明任意模型支持 300K，也不能保证长 turn 不越过阈值。

DSH 的 [压力投影契约](https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/llm/token-meter/src/projection.ts#L20) 明确该值用于显示参考，字段并非同一次原子观察，不能直接作为 gating input。

可复用的公开能力包括：

- [tokenMeter.measure](https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/llm/token-meter/src/index.ts#L125)：按当前持久日志和请求配置重算，返回不可变 snapshot；baseline.kind 区分 none/estimated/usage，并有 logRevision。仍是有来源标记的计量，不承诺精确 tokenizer。
- [会话请求事实](https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/core/session/src/types.ts#L234) 与公开 resolveModelInfo：取得最近实际 provider/model、输出配置及模型容量；最近请求不自动代表下一次动态路由。
- [runMaintenance](https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/core/agent/src/runtime-types.ts#L193)：占用真实 idle 安全边界，后续输入排队；whenIdle 不等于特定消息已消费。
- 宿主[压缩策略预算计算](https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/packages/compaction/compaction-basic/src/config.ts#L143)可作为窗口减输出预留和余量的先例，但压缩余量不能冒充交接余量。

因此规格将阈值定义为提前接续软目标，显示用户目标、有效模型窗口、输出/交接预留、计量来源、日志版本与等待安全边界的原因。若要求与下一次最终路由请求绑定的硬预算准入，需要额外宿主契约；本轮未证明已有此能力。

## GitHub Project views：已验证的 API 与未验证的实例权限

官方契约提供 [ProjectV2](https://docs.github.com/en/graphql/reference/projects#object-projectv2) 和 [ProjectV2View](https://docs.github.com/en/graphql/reference/projects#object-projectv2view)。本次使用已认证 `gh` 对 schema 做只读 introspection，实际得到：

- ProjectV2：views、view(number)、items；items 参数包括 after/before/first/last/orderBy/archivedStates/query。
- ProjectV2View：name、filter、layout、fields、configuration、groupByFields、sortByFields。

可以读取远端视图定义，并把支持的筛选交给 items(query)，不必先重实现整个 GitHub 筛选语言。实际目标的 @me、字段、排序、分组与分页结果仍须集成核对；不能把原型五个固定标签当真实来源。

当前命令环境缺少 HOME，初次 gh 读取退出 4。显式指定已有 `GH_CONFIG_DIR=/root/.config/gh` 后已成功读取 #70/#112/PR#117 和上述 schema；未读取或输出 token，未写远端。子核查会话最初的“无凭据”只描述其默认进程环境，现已诊断解决。

[官方权限说明](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects#authentication)区分 read:project 与 project 等权限。schema 可读、仓库 Issue 可读，不证明任意组织 Project 可读；本轮没有对用户目标 Project 的实际数据和权限作验收。

## 测试接缝与已有先例

| 接缝 | 采用方式 | 现有证据及限制 |
| --- | --- | --- |
| 工作应用的公开命令/查询 | 首选统一高层行为接缝：创建、关联、启动或复用、接续、完成、查询；稳定 commandId 与版本条件 | 真实本地记录、真实 DSH loop/persistence/controller/preset；模型与外部协同用可控适配。避免只测 Store CRUD 或复制 reducer 实现。 |
| 真实宿主浏览器 | 隔离 DSH profile/home + 插件 bundle + 真实 Session/Workspace + 固定外部响应，禁止误调真实模型 | 宿主 [scaffold](https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/apps/web/tests/scaffold.ts#L278)、[插件管理页先例](https://github.com/deepseek-ai/deepseek-harness/blob/a45068d2ec03326c800c68c9bdcd47508e3ccb9c/apps/web/tests/plugin-manager.e2e.ts#L1)；现插件只有 node 测试 lane，需接入独立浏览器验收。 |
| 持久恢复 | 在 claim、创建、接任、发送、确认和完成操作的提交边界注入失败，再从同一记录恢复 | [现有运行器测试](../../tests/task-runtime.spec.ts#L98)覆盖较多真实机制，但使用脚本化模型，部分 controller/模型选择为替身；不等于真实接续质量或 token 预算已验证。 |
| 外部适配真实只读验收 | 目标仓库/Project 的分页、视图和权限只读 smoke；写入验收只在专用测试对象中授权开展 | [watch 测试](../../tests/github-watch.spec.ts#L107)用 FakeConnection，不能证明真实来源目录或权限。 |

还需明确覆盖：同 Task 两个消费者、不同 Task 抢同一会话、宿主已创建但回执丢失、旧 owner 延迟结果、完成提交与父通知之间中断、远端关闭成功但回执丢失、来源重复/乱序/分页中断、暂停与 claim 竞争、巨大工具输出和陈旧计量。

## 迁移与当前约束

[文档解析/重写](../../src/document.ts#L133)仅保留固定字段。不能把 v3 字段塞进旧格式并期待旧 writer 保留；需版本化新记录、幂等迁移索引、备份和迁移日志，再由兼容入口映射到同一新命令。

活动记录必须在安全边界切换当前 owner，连同固定后继、操作身份、message IDs、暂存 inbox 和 watch 地址迁移。保留一会话最多协调一个活动 TaskExecution，直到有显式 Task 寻址和会话级有序调度。新旧运行器不能双写同一协调域，复制文件不是迁移执行资格。

当前可开始的工作是规格、隔离记录/界面/固定响应开发。目标源权限、宿主装配能力和真实模型接续质量须在相应实现切片验收，不需要为写规格重启或部署现有服务。
