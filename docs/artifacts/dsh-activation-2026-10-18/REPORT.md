# A²D² / DSH 接口兼容修复验证

## 实验目的

修复派发调用旧 `startContinuable` 接口的问题，兼容 Team 裸 UUID，并恢复不保存默认模型的会话级模型选择。

## 修复范围

- 插件以公开 `SubagentRuntime` 类型约束 `startActivation`，显式传入 `delivery: 'parent'`；模型配置通过 `request.agentOptions` 传递，reasoningEffort 转换为运行时品牌类型。
- 会话 ID 原样接受旧式 `session-…` 与 UUID，继续拒绝路径输入。
- DSH 增加 Host 公共方法 `sessionController.selectLocalModel`，与 `selectModel` 共用校验和安装逻辑，前者不写默认值，后者保持原有保存行为。
- 插件依赖对齐 DSH 0.2.1-rc.2，并固定开发依赖 Zod 4.4.3，避免与运行时 schema 类型不一致。`dsh-invariants` 保持其已发布版本。
- 未修改沙箱策略。两个仓库均使用独立 worktree，未修改原 checkout 的业务代码。

## 实验步骤与记录

1. 先添加 UUID 回归用例，运行 `pnpm exec vitest run tests/dispatch-subagent.spec.ts tests/handoff.spec.ts`；修复前裸 UUID 两例失败。该轮派发测试因缺少已安装 peer 依赖无法加载，不能视为派发复现证据。
2. DSH 新增会话级选模用例，运行 `pnpm exec vitest run packages/api/session-controller/tests/session-models.host.spec.ts -t 'only for the target session'`；修复前出现 `controller.selectLocalModel is not a function`。
3. 修复后插件 `pnpm test`：38 个文件、628 项通过，包含 provider/model/reasoningEffort 与父会话投递策略断言、UUID 原样保留及非法路径拒绝。
4. 插件 `pnpm typecheck` 与 `pnpm build`：通过。最初类型检查曾因堆内存限制失败；改用公开类型后发现并修复品牌类型与 Zod 版本冲突，最后标准命令通过。
5. DSH `pnpm exec vitest run packages/api/session-controller/tests/session-models.host.spec.ts`：27 项通过；新用例确认会话选择生效且不调用默认值保存，拒绝非法模型后也不保存默认值。
6. DSH `pnpm run typecheck`：5 项检查通过，包括 Host、Client 及 aggregate 检查。
7. DSH 构建本机 native addon 后，运行 `pnpm exec vitest run packages/subagent/subagent/tests/parent-result.spec.ts packages/subagent/subagent/tests/run-settlement.spec.ts`：5 项通过，覆盖子代理答案/结构化结果进入父会话。它使用测试模型，不证明真实 provider 已执行。
8. DSH `pnpm run doc-sync` 初次 39 项通过、4 项失败。其中 API catalog、JSDoc 与双语配对已修正，分别重跑检查通过；剩余 `python/sdk/uv.lock:113` commit-hash 引用错误不在本次改动范围。未宣称完整 doc-sync 通过。
9. 使用 `agent-browser` 打开现有 DSH 地址 `http://10.126.126.12:3080`，得到 `net::ERR_CONNECTION_REFUSED`。未切换入口、未新建服务或放宽沙箱；没有成功页面截图。

## 当前状态

代码修复与上述自动化检查已完成。未部署、未合并。真实 `dispatch_subagent` 的 provider/model/reasoningEffort、真实父会话完成消息仍未验证，需在现有 DSH 页面可访问且加载修复后验收。自动化回传测试不能替代此验收。
