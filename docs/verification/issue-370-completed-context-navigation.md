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

本报告只记录代码级验证。实际开发环境页面截图、发布、既有生产后续会话登记与最终验收由主 agent 继续执行；本分支未部署、未重启服务、未修改生产数据。
