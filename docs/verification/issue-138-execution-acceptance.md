# #138 执行状态与接续验收记录

## 目的

围绕 [Issue #138](https://github.com/a2d2-dev/dsh-plugin/issues/138) 原有七条验收要求，复核最新主干已有的执行图、独立子 Issue 入口、原生聊天接续与历史能力。保留原始目标和边界，不创建第二套运行器，不修改宿主会话／工具存储，不以合成页面代替真实实例。

## 基线与执行配置

- 初始测试基线：`origin/main b210e1c579a807e4900b12cfc6377e94baad97e8`；最终文档基线：包含 PR #277 的 `8a1dc4b51931a40b7b807858dc06f2ed43dc3b66`。
- 实施分支：`feat/138-execution-acceptance`；最终文档使用隔离分支 `docs/138-accepted-evidence`，从最新主干带入此前两项文档提交并补齐真实接任证据。
- 当前 Task：`89ff4a49-0143-4c7a-997f-828ce2a0054d`，规格 v2 已逐字保存来源的七条验收要求。最初结构化 acceptance 为空，不能当作已经验收。
- 初始公开 `task.detail` 确认执行使用 `codex/gpt-6.1-sol`、`standard`、`workspace-write`，实际 cwd 为本仓库；runtime `b921120e-e6dd-4e5d-b109-945d9d692d25`，workspace `8b8436b8-0a8b-4b19-b2af-a80c61462fc5`。用户随后将原生权限改为 Full access，恢复及真实后继均保留 `danger-full-access`／`never`／`high`，全局新任务默认仍为 workspace-write。
- GitHub Project `DSH A²D²` 的 Status 从空值更新为 `In Progress`，随后回读确认；Issue 仍为 Open。没有新增独立 Task 或 GitHub 子 Issue。

## 修复

真实作业详情同时显示“持久生命周期记录”和“宿主进程内作业”。根因是 `JobRow` 在存在 Registry/Instance 身份时，无条件追加前一个标签，而后又按 `persistence` 显示另一个标签。稳定身份本身不能证明持久性。

现在身份字段只显示 Registry/Instance，持久性只由公开观察中的 `persistence` 决定并显示一次。回归覆盖稳定身份下的 `process-local` 与 `session-journal`，前者不能包含“持久生命周期记录”，后者只能出现一次。

## 步骤与测试记录

所有测试文件串行运行，`--maxWorkers=1 --no-file-parallelism`；未放宽断言或增加超时。

| 检查 | 结果 | 证据位置 |
| --- | --- | --- |
| 执行观察、owner 隔离、lost job、公开 jobs 适配、真实维护边界、执行生命周期、固定后继接续、原生入口与组件 | 11 文件，151 项通过 | `docs/artifacts/issue-138-2026-10-25/contract-tests.log` |
| 原生 header/dock 槽位、插件注册、独立 Issue/Task 执行图与组合渲染 | 5 文件，50 项通过 | `docs/artifacts/issue-138-2026-10-25/frontend-tests.log` |
| 持久性显示新增断言，修复前 | 1 项失败，精确复现进程内作业误标持久记录 | `docs/artifacts/issue-138-2026-10-25/persistence-red.log` |
| 修复后的执行组件与接续渲染 | 2 文件，23 项通过 | `docs/artifacts/issue-138-2026-10-25/persistence-green.log` |
| 官方 jobs 真实组合 | 1 个完整场景通过 | `docs/artifacts/issue-138-2026-10-25/official-jobs.log` |
| 匹配 Host 8282d612 四包真实组合 | 1 个完整场景通过，268 个源码／测试快照留存 | `docs/artifacts/issue-138-2026-10-25/matched-host-jobs.log` |
| 匹配宿主 jobs registry 与 Loader 持久回执／冷重载 | 2 文件，93 项通过 | `docs/artifacts/issue-138-2026-10-25/patched-host-restart.log` |
| TypeScript | 通过 | `docs/artifacts/issue-138-2026-10-25/typecheck.log` |
| 正式构建 | 通过 | `docs/artifacts/issue-138-2026-10-25/build.log` |
| 导出与格式 | 32 个导出目标及 sidecar 存在；`git diff --check` 通过 | 命令实际输出 |

首次测试在断言运行前因默认临时目录缺失而退出（11 suites、0 tests）。按仓库已有约定使用 `TMPDIR="$PWD/.local/tmp"` 后完整通过，未把该环境错误解释成产品缺陷。

官方组合使用明确构建 `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`、Node `v24.22.1`，从 `tests/official-jobs.config.ts` 进入实际 registry、tool-jobs、Session 提交和冷 journal 回读。测试验证观察不消费、真实终态收取、错误／取消／空重读不伪造交付、持久回执与冷读。该场景针对官方公开适配，不冒充当前运行宿主跨重启升级验收。

匹配宿主正向组合使用 `/data/_dsh-builds/v4-141-artifacts-38d4d91/matched-host-8282` 的既有 manifest。`scripts/verify-v4-completion-host.mjs` 核对 Host `8282d61299a04f60555f9ce473af174bbe161b02` 及四包固定 SHA256，在本工作树 `.local/matched-host-8282-env` 一起安装 session／jobs／jobs-local／tool-jobs，保存 268 个源码／测试快照及真实模块解析 provenance；场景确认原生结果与真实 `job_output` 均收取后才允许新的验收释放执行槽位，不能用 nominal rc2 或混合 singleton 冒充匹配构建。

随后在该宿主 checkout 只读运行 jobs-local registry 和 tool-jobs Loader 公开合同，Node `v22.23.1`、2 文件 93 项通过。Loader 场景实际 flush、dispose 并新建 Context，冷读 `jobs/registered` 与两次终态 `tool/result.meta.jobReceipt`，重新注册得到同名 job 时，Registry epoch 和 instanceId 均不同；还覆盖 owner 隔离、观察不消费和重复收取。宿主 checkout 的 `git status --short` 为空。本次重建的是测试 Context，未重启用户正在使用的 GUI 或宿主进程。

## 真实页面与执行事实

使用 `agent-browser` 操作既有 DSH GUI，未新建替代服务。人工复核入口为 [当前 DSH](http://10.126.126.12:3080)。截图与日志保存在 `docs/artifacts/issue-138-2026-10-25/`，该目录按仓库约定忽略，不提交含会话细节的截图和原始日志。

- `issue-continuation.png`：真实 #138 页面只有一个“编辑自动接续设置”；接续 Tab 直接显示策略、目标、安全余量、上下文观察和执行结算。未配置／未知如实显示，没有静态成功值。
- `execution-real-jobs.png`：真实当前协调、epoch、原生 childId 和本会话后台作业。
- `native-child-returned.png`：真实只读验收委派 `ddef8947-7c00-4c1d-a98d-e68f3ba0c40a` 已返回，通知仍待消费；页面不把返回当作消费。
- 通过公开 `task.execution` 观察到测试作业 `bash-2773` 的 owner 为当前协调 Session，输出收取后 `delivery: delivered`，模型消费仍 `unknown`，验收仍 `unassessed`。之前的失败已收取作业没有继续占用 `job-unsettled`。
- 原生聊天保留单个宿主标题、Chat／Trajectory／A²D² 接续、模型／权限选择与原生输入框；“返回工作详情”已实际返回 #138。

- 修复通过 [PR #266](https://github.com/a2d2-dev/dsh-plugin/pull/266) 合并为 `e5daa0c68a594bb19d434462459aeb24554d471f`；Node22／Node24／secrets CI 成功。后续证据分支为 `docs/138-final-evidence`。
- 原 GUI 前端与匹配 sourcemap 已更新并刷新，插件 boot rev 从 `711d96016ed1` 变为 `2134460f8c44`；安装文件与通过测试的构建 SHA256 同为 `79fc1de585821030f49302a207020dbe190964a5db3d4e78ef9f50cc46ff0bab`。旧文件备份在忽略目录 `.local/live-client.before.js` 和对应 map；未重启宿主或替换服务器。
- `job-persistence-deployed.png`：真实 `bash-2773` 详情保持 owner、已返回、输出已交付／消费未知／未验收，显示“宿主进程内作业”，DOM 中“持久生命周期记录”计数为 0。
- `parent-native-issues.png` 与 `child-independent-execution.png`：从真实父 Issue #136 的七项原生子 Issue 列表点击 #138“查看进展”，进入同一个 canonical Task，再经执行图的当前会话按钮返回原生协调 Session。未导入或启动父工作，未为截图创造业务子 Issue。
- `native-continuation-desktop.png` 与 `native-continuation-mobile.png`：原生单标题、Chat／Trajectory／A²D²接续、原生队列与输入控件保留。390px 窄屏实测 `document.scrollWidth=body.scrollWidth=390`，接续区域宽度与 scrollWidth 都为 295，无横向溢出；恢复 1600×1000 后继续验收。
- `parent-child-entry-visible.png`：补充父 #136 页面中实际可见的 #138 子项及“查看进展”按钮，已逐图复核；与父页顶部和独立执行页截图共同记录完整往返。
- `continuation-reserved.png`：真实原生按钮提交操作 `e55b31d6-3317-4845-9d27-2fbdabb26da7`，固定后继 `session-7f523df6-365f-4904-96bc-e4a85fd63583`；公开查询及页面确认当时 phase 为 `reserved`，当前仍原段 `session-4c0d3e10…`、epoch 1，准备未切入口；最终正式接任见下节。
- 浏览器后半程使用命名上下文 `issue-138`，复用登录而不输出凭据，避免共享 default 浏览器被其他工作导航干扰。没有把共享浏览器导航变化误判为产品缺陷。

短只读委派核查了显式身份、独立工作分区、只读历史查询及控制资格，未发现其已读基线范围内可证实缺陷。该审查早于本轮一行持久性修复，不能宣称独立审查覆盖了后续补丁；补丁由主会话阅读完整差异并运行红／绿回归复核。

## 固定后继真实接任（2026-10-26）

原生 Session 人工切换 Full access 后，恢复曾因旧权限快照与实际权限不一致而失败。根因、红／绿回归、正式热重载和运行恢复见[权限恢复记录](issue-138-permission-recovery.md)，修复通过 [PR #277](https://github.com/a2d2-dev/dsh-plugin/pull/277) 合并。其 execution／continuation 两文件 60 项、类型检查、构建及 32 个导出验证通过；本次后继从原始日志重新核对测试计数与 CI，而未重复已完成的测试或部署。

接任后的公开 `task.detail` 明确确认：Task 和 execution 身份保持，固定 operation 为 `e55b31d6-3317-4845-9d27-2fbdabb26da7`，当前 Session 为 `session-7f523df6-365f-4904-96bc-e4a85fd63583`、epoch 2，state 为 ready，continuation phase／requestDelivery／kickoffDelivery 均为 delivered。旧来源 `session-4c0d3e10-b3c7-4d9b-95f7-d631db4e538a` 在 retired 中保留 epoch 1；其公开 `session.work` 显示 purpose 为 history、currentSession 为同一固定后继。

在原 GUI、同一命名浏览器上下文完成以下步骤，截图与选取的公开查询事实保存在 `docs/artifacts/issue-138-final-2026-10-26/`，未提交原始会话截图、日志或凭据：

| 实测步骤 | 结果与证据 |
| --- | --- |
| 刷新旧来源原生接续页 | `continuation-delivered.png` 显示“已交接 · 可继续对话”和“接续内容已投递”，与之前 reserved 截图共同区分准备和正式接任。 |
| 展开旧来源关联任务并点击“进入会话” | `retired-linked-entry.png` → `linked-current-successor.png`，实际选中后继“会话 2”，宿主标题、Chat／Trajectory／A²D² 接续与原生控件保留。 |
| 后继打开接续页并展开材料 | `successor-material.png` 与 `preserved-unfinished-visible.png`，原有具体决定、证据、未完成项和下一步完整保留；旧“未完成”段落作为交接时的历史事实展示。 |
| 从“返回工作”进入 #138 会话页 | `current-and-retired.png` 同页显示当前 epoch 2 与旧来源“接续历史 · 只读”，两个入口仍属于同一工作。 |
| 点击旧来源“只读历史” | `task-readonly-history.png` 显示旧来源 transcript 和“查看记录不会启动旧会话”；历史区域只有关闭按钮。读取后公开查询再次确认 epoch 2、current successor 与 retired source 均不变。 |
| 核对实际归属与来源范围 | `public-handoff-facts.json` 留存上述筛选事实。可信来源路由于 `2026-10-26T07:21:24.326Z` 再次确认 #138 没有原生子 Issue、分页完整，已保存该空范围；没有制造本地子 Task。 |

历史失权的拒绝合同由本次 60 项回归中的 `keeps retired conversations usable after cold restore without restoring Task coordination` 验证：真实冷恢复后读取历史不创建旧 Agent，人工旧聊天仍可对话，但旧 `work_control progress` 返回 forbidden；current/epoch/owner 不变。真实页面验收核验了 history 投影和读取后不改变身份，没有冒充旧来源发出写操作。

观察过程中的脚本和时序问题已纠正：点击刷新后立即读取曾得到投递前快照，等待完成后显示 delivered；一次等待返回 DOM 对象导致 CDP 序列化报错，改用布尔断言后通过。一次材料读取早于加载完成，增加存在性等待后成功。这些失败未计入产品验收通过数。

## 逐项验收结果

1. 真实身份与状态来源：通过。现有代码、公开合同与真实实例均使用显式身份，当前、退休、关联、原生子会话分别显示。
2. 独立子 Issue 入口和两棵树：通过。真实父 #136 Issue 树 → #138 canonical 详情 → 独立协调 Session 往返已截图，执行图单独显示 owner／epoch／native child；#138 本身是叶子，必要子 Issue 范围已完整保存。
3. 作业 owner、返回／交付／消费／验收区分：通过。真实 job、显示回归、官方组合、匹配 Host 四包及 93 项冷读合同均验证；已处理失败不继续阻塞。
4. 准备、收取、正式接任和固定后继重试：通过。reserved 时未换入口，权限故障修复后复用相同 operation／successor 到 delivered／epoch 2；丢失回执及应收结果屏障合同通过。
5. 唯一策略入口、可见参数、原生控件和关联返回：通过。桌面与 390px 页面已有证据，旧来源关联入口实际返回固定后继，后继“返回工作”仍指向 #138。
6. 历史与当前同工作、退休失权、材料保留：通过。真实只读历史和读取后身份不变已截图；决定及未完成项可展开；冷恢复失权拒绝合同通过。原生旧聊天的人工对话能力保留。
7. 公开应用／真实宿主／前端合同及最终实测：通过。原有 151 项核心、50 项前端、23 项显示、官方和匹配组合、93 项宿主冷读及 60 项权限恢复／接续回归均有日志；真实子会话、job、模型正式接任与历史截图齐全。上述测试组存在覆盖交叠，不将计数简单相加当作独立用例总数。

#142 仍 Open 是来源状态；本票所需官方适配组合、匹配 Host 终态回执和冷重载防同名误配均已通过，无需重启当前运行实例。七条原始标准保持完整，本轮最终文档只汇总已验证结果。工作验收状态与 GitHub 关闭分开记录，Issue 最终关闭由 LF 完成。
