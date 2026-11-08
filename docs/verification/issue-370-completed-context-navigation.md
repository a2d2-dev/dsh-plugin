# #370 完成任务的后续上下文导航

## 目的

已完成任务的独立后续对话没有保存来源关系，原会话只能回到旧执行，无法沿已有上下文继续查看。补充明确的历史关联与导航，不创建会话或模型请求，不修改完成事实、规格、Execution ID、owner、epoch 或当前处理会话。

## 支持的登记命令

复用现有 operator 命令 `task.associate-session`，增加可选 `historicalSource`：

```json
{
  "type": "task.associate-session",
  "commandId": "unique-command-id",
  "ref": { "projectId": "project-id", "taskId": "task-id" },
  "expectedVersion": 36,
  "session": { "runtimeId": "runtime-id", "sessionId": "existing-successor-id" },
  "purpose": "related",
  "historicalSource": { "runtimeId": "runtime-id", "sessionId": "exact-source-id" }
}
```

任务须有完成记录；来源须属于完成记录指定执行的当前或退休会话；目标须为同一个执行工作目录内已有的独立会话，且不能占用其他执行的当前、退休或已保留的接续会话（`session-in-use`）。重复同一关系不增加任务版本，原有 related 关联可补充来源，不带新字段的旧调用保持兼容。关联只保存导航关系，不证明交接材料已读取，也不授予任务执行权。带 `historicalSource` 的关联不进入原执行的观察或执行图根集合，因此后续对话的运行、工具和作业不阻塞原执行结算；普通 related/review 仍按原规则观察。

`session.work` 保留原有 `purpose`、执行与代次，另外投影 `historicalContexts`。原生会话页头、A²D² 接续页和已完成任务概览提供“后续上下文 / 进入会话”，多个上下文按序号区分，标签不显示会话 ID。点击重新读取准确 Task 的已登记关系，仅调用宿主打开目标 Session。

## 步骤与记录

1. 使用真实 `WorkApplication` 创建并完成任务，给原执行登记已有后续上下文。重载存储核验来源投影、目标关联与完成/规格/执行完整相等。
2. 覆盖活动任务、错误来源、目标自指、错误工作目录被拒绝；覆盖普通旧关联、补充来源、重复调用和旧格式调用。
3. 挂载生产组件，分别点击原生接续页、页头和完成任务入口，确认只打开准确目标且未发送任何工作命令。没有登记关系时拒绝导航，不替换成旧执行。
4. 红灯 `docs/artifacts/370-2026-11-08/red.log`：真实任务关联已存在，但生产展示没有“后续上下文”。受影响 6 个测试文件共 81 项通过；`pnpm typecheck` 与 `pnpm build` 通过。原始日志位于本地 `docs/artifacts/370-2026-11-08/`，未纳入 Git。

5. 修复 review 确认的跨执行占用与结算范围问题：三种占用状态先红后绿，真实 Agent 的运行工具及真实作业验证历史关联不阻塞原执行；普通 related 仍被观察。最小 3 个测试文件共 22 项通过，类型检查通过。原始记录为本地 `/tmp/370-occupancy-red.log`、`/tmp/370-observation-red.log`、`/tmp/370-remediation-tests.log` 和 `/tmp/370-remediation-typecheck.log`。

6. 开发环境页面发现按钮未继承操作样式、输入区提示与主内容重复。历史入口复用现有 `taskActions` 与 `row` 样式；历史上下文不再单独生成输入区提示，原有正式交接提示保持。3 个相关 UI 测试文件共 58 项通过，类型检查通过。原始记录为本地 `/tmp/370-visual-tests.log`、`/tmp/370-visual-typecheck.log` 与 `/tmp/370-visual-client-typecheck.log`；测试 mock 的字面量类型修正后，客户端类型检查已单独通过，宿主检查复用同轮通过结果。

7. 实际验收发现历史导航等待旧执行的 `task.detail` 完整历史观察，导致入口显示或点击受阻。仅调整客户端：历史入口使用已有 `session.work.historicalContexts` 投影显示；点击通过现有 `project.detail` 找到准确项目与 Task，核验完成事实及目标关联。普通当前会话导航仍使用 `task.detail`，后端查询与执行图行为不变。生产组件在 `task.detail` 永久不返回时仍显示并准确导航；新读数缺少任务、完成记录或精确关联时拒绝。2 个相关测试文件共 61 项通过，客户端类型检查通过。原始记录为本地 `/tmp/370-history-read-red.log`、`/tmp/370-history-read-tests.log` 与 `/tmp/370-history-read-typecheck.log`。

以上保留实现与回归记录；正式发布及真实页面验收结果如下。


## 正式发布与验收（2026-11-08）

修复及正式验收已完成。PR #371 已合并为 `7a88a94c`，导航读取修正 PR #372 已合并为 `190a6f0d`；各自最终提交的 Node 22、Node 24、secrets 两组 CI 全部通过。独立只读审查已确认身份、结算隔离、界面及最终导航读取修正，无未解决阻断项。

发布组合保留既有正式 `e4678a7` 的全部补丁，只叠加本票已审提交。最终组合导航 2 文件 55 项通过，构建、声明与客户端 bundle、打包均退出 0；不同阶段测试有重叠，不累计数量。开发与正式安装同一 v4 包，SHA-256 `c70f63874e54d78da9be86d4e17f829c450ca1c4d63d11a81be774ae2177bf60`，两边 198 个 lib 文件逐字节匹配，profile 只改变本插件的依赖引用。最终独立 Supervisor 回执均 succeeded：开发 PID `2125047`，正式 PID `2146606`。

真实页面步骤和记录：

1. 原会话8仅显示 done 禁用和会话7至8的旧 received 记录，缺少独立后续上下文入口。独立核对既有后继 `session-c0070e0d-1939-4e8b-87ac-2f24956b2f34` 的原始 read/EOF/确认回执及交接文件 SHA；该后继已被 LF 使用，复用它，没有新建后继或发送重复模型请求。
2. 开发实例用已有完成 QA 任务与同目录的空白会话，执行支持的 `task.associate-session` 登记历史来源。原完成、规格、进展和完整 Execution 保持。检查明暗主题及 800 宽度，消除默认按钮和重复提示；实际点击后精确选中目标，最终测得 132 ms。
3. 正式登记准确来源 `session-21b176da-439d-4839-884f-9749a67a0cbd` 与既有 c007 后继。登记活动可追溯，Task 版本 `36 → 37`，原完成、规格、进展及完整 Execution 逐字段相同，epoch 仍8。
4. 首次正式验收发现只读导航被不必要的旧执行图观察拖住。相同数据下，`task.detail` 在 8000 ms 截止时未完成，`project.detail` 在 406 ms 返回准确 Task。最终历史入口不依赖该旧图；正式源页在旧图尚未完成时已经显示“后续上下文”。
5. 使用 agent-browser 从源会话真实点击“进入会话”，MutationObserver 记录目标选中时间 **151 ms**，选中 ID 精确为既有 c007。被动 Network 记录按点击时间段检查，实际只有查询请求，包含 `project.detail`，没有工作命令。没有以失效的 fetch 包装器空数组作为证明。
6. 对比两实例源/目标 journal，turn、人工/系统消息、模型请求、助手消息、工具调用及结果数量均未增加。原 GitHub Issue #183 仍 Closed、原 Project 仍 Done；没有业务恢复、模型运行、集群操作或额外验收。原交接材料73行及已接受的完成/延期事实保留。

入口：打开 **#183 · 会话8 → A²D² 接续 → 后续上下文 → 进入会话**。后继按来源会话序号命名为“#183 · 会话 9”，Session 身份仍是既有 c007。这是已完成任务的历史上下文衔接，原执行完成记录与 epoch8 保留。

完整中文记录、截图、原始回归与结构化证明保存在本工作树 `docs/artifacts/dsh-370-2026-11-08/`，关键文件为 `prod-final-navigation-proof.json`、`final-original-state-proof.json`、`prod-final-journal-proof.json`、`prod-final-source-entry.png` 和 `prod-final-existing-target.png`。私有截图和业务上下文不提交公开仓库。旧失败与早期验证记录继续保留，不计作最终成功证据。

Issue #370 的工作及验收完成，Project Status 为 Done；Issue 保持 Open，最终关闭由 LF 执行。

## 会话命名修正（2026-11-08）

Task #183 的当前执行会话是 epoch8，历史后续上下文使用所登记来源会话序号加一生成标题。因此后继显示为“会话 9”；这只调整会话标题，原 Task/Execution 仍保持已完成/epoch8，不创建 epoch9 执行。

最终 v5 同包已安装至开发和正式实例。两个 Supervisor helper 重启后，后继 c007 标题均为“#183 · 会话 9”，没有恢复为“关联1”。测试和接续验收详见本报告前文。
