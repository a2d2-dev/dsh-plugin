# #269 停止表达缺口验证

目的：直接用户要求关闭或结束当前会话时，本轮结束不追加继续纠正；此识别不自动执行 `end`，也不产生 Task 完成事实。

变更限于 `humanGuardIntent`：在现有用户来源和引号剥离边界内，补充“关闭/结束当前、这个、本会话”及原句中的倒装表达，并排除直接否定的关闭/结束表达。未引入通用语义分类。

验证步骤与记录：

1. 先新增原句“算了，你这个会话你直接关闭吧。”测试，运行 `pnpm exec vitest run tests/work-stop-intent.spec.ts`：exit 1，1 个失败，实际 `answerOnly: false`。
2. 应用最小 guard 修复，重跑相同命令：exit 0，1 个通过。
3. 补齐指定表达、窗口/Issue/连接业务操作、历史引语、非用户来源和明确否定，运行 `pnpm exec vitest run tests/work-stop-intent.spec.ts tests/work-execution-guard.spec.ts`：exit 0，2 个文件、43 个测试通过（新增 18，原有 25）。
4. 新增测试中的 3 个真实 AgentLoop turn 分别覆盖原句、“结束当前会话”、“关闭这个会话”：均只增加 1 次模型请求，无新增工具调用，执行 `control` 和 Task `completion` 均为空。
5. `pnpm typecheck`：exit 0，服务端与客户端 TypeScript 检查通过。

限制：这是当前代码可复现的识别缺口，不能据此认定历史事件由当前护栏导致。未修改已有 guard 测试、Issue 或服务；部署和主会话集成不在本次子任务范围。
