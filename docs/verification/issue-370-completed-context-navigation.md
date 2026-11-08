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

任务须有完成记录；来源须属于完成记录指定执行的当前或退休会话；目标须为同一个执行工作目录内已有的独立会话。重复同一关系不增加任务版本，原有 related 关联可补充来源，不带新字段的旧调用保持兼容。关联只保存导航关系，不证明交接材料已读取，也不授予任务执行权。

`session.work` 保留原有 `purpose`、执行与代次，另外投影 `historicalContexts`。原生会话页头、输入区提示、A²D² 接续页和已完成任务概览提供“后续上下文 / 进入会话”。点击重新读取准确 Task 的已登记关系，仅调用宿主打开目标 Session。

## 步骤与记录

1. 使用真实 `WorkApplication` 创建并完成任务，给原执行登记已有后续上下文。重载存储核验来源投影、目标关联与完成/规格/执行完整相等。
2. 覆盖活动任务、错误来源、目标自指、错误工作目录被拒绝；覆盖普通旧关联、补充来源、重复调用和旧格式调用。
3. 挂载生产组件，分别点击原生接续页、页头、输入区和完成任务入口，确认只打开准确目标且未发送任何工作命令。没有登记关系时拒绝导航，不替换成旧执行。
4. 红灯 `docs/artifacts/370-2026-11-08/red.log`：真实任务关联已存在，但生产展示没有“后续上下文”。受影响 6 个测试文件共 81 项通过；`pnpm typecheck` 与 `pnpm build` 通过。原始日志位于本地 `docs/artifacts/370-2026-11-08/`，未纳入 Git。

本报告只记录代码级验证。实际开发环境页面截图、发布、既有生产后续会话登记与最终验收由主 agent 继续执行；本分支未部署、未重启服务、未修改生产数据。
