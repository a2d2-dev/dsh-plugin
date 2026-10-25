# #138 执行状态与接续验收记录

## 目的

围绕 [Issue #138](https://github.com/a2d2-dev/dsh-plugin/issues/138) 原有七条验收要求，复核最新主干已有的执行图、独立子 Issue 入口、原生聊天接续与历史能力。保留原始目标和边界，不创建第二套运行器，不修改宿主会话／工具存储，不以合成页面代替真实实例。

## 基线与执行配置

- 基线：`origin/main b210e1c579a807e4900b12cfc6377e94baad97e8`。
- 隔离分支：`feat/138-execution-acceptance`。
- 当前 Task：`89ff4a49-0143-4c7a-997f-828ce2a0054d`，规格 v2 已逐字保存来源的七条验收要求。最初结构化 acceptance 为空，不能当作已经验收。
- 公开 `task.detail` 确认执行使用 `codex/gpt-6.1-sol`、`standard`、`workspace-write`，实际 cwd 为本仓库；runtime `b921120e-e6dd-4e5d-b109-945d9d692d25`，workspace `8b8436b8-0a8b-4b19-b2af-a80c61462fc5`。
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
| TypeScript | 通过 | `docs/artifacts/issue-138-2026-10-25/typecheck.log` |
| 正式构建 | 通过 | `docs/artifacts/issue-138-2026-10-25/build.log` |
| 导出与格式 | 32 个导出目标及 sidecar 存在；`git diff --check` 通过 | 命令实际输出 |

首次测试在断言运行前因默认临时目录缺失而退出（11 suites、0 tests）。按仓库已有约定使用 `TMPDIR="$PWD/.local/tmp"` 后完整通过，未把该环境错误解释成产品缺陷。

官方组合使用明确构建 `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`、Node `v24.22.1`，从 `tests/official-jobs.config.ts` 进入实际 registry、tool-jobs、Session 提交和冷 journal 回读。测试验证观察不消费、真实终态收取、错误／取消／空重读不伪造交付、持久回执与冷读。该场景针对官方公开适配，不冒充当前运行宿主跨重启升级验收。

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
- 浏览器后半程使用命名上下文 `issue-138`，复用登录而不输出凭据，避免共享 default 浏览器被其他工作导航干扰。没有把共享浏览器导航变化误判为产品缺陷。

短只读委派核查了显式身份、独立工作分区、只读历史查询及控制资格，未发现其已读基线范围内可证实缺陷。该审查早于本轮一行持久性修复，不能宣称独立审查覆盖了后续补丁；补丁由主会话阅读完整差异并运行红／绿回归复核。

## 逐项验收状态与余项

1. 真实身份与状态来源：现有代码、公开合同与当前实例观察已验证；无标题或创建时间推断。
2. 独立子 Issue 入口和两棵树：公开应用合同通过；真实父 #136 原生 Issue 树 → #138 canonical 详情 → 当前独立协调 Session 往返已截图，执行图单独显示 owner/epoch 和 native child。当前 #138 是叶子 Issue，未为截图创建业务子 Issue。
3. 作业 owner、返回／交付／消费／验收区分：合同与真实 job 验证通过；持久性标签补丁已更新现有 GUI，DOM 断言与截图复验通过。
4. 接续准备、收取、正式接任、重试固定后继：真实宿主合同通过，包括多处丢失回执重试和两次后继；本 Task 的真实模型接续截图尚未完成。
5. 唯一策略入口、可见参数、原生控件和关联返回：真实桌面及窄屏页面已验证。
6. 历史与当前同一工作、退休失权、材料保留：真实宿主合同通过；最终实际接续后的只读历史截图待补。历史只读指 Task 历史投影和协调权限，保留原生旧聊天人工对话能力。
7. 合同与前端测试通过，已有真实子会话、job、补丁部署后及桌面／窄屏截图；真实模型接续与接任历史仍未完成，不据此宣称整票完成。

#142 仍 Open 只记录为来源事实，不能凭状态断言能力缺失。本轮官方组合已经通过；指定宿主的跨重启／终态回执组合最终验收仍按原边界处理。整票完成前必须继续核对以上余项并更新记录。
