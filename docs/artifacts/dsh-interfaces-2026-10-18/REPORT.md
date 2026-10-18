# DSH 0.2.1 接口兼容修复与验收

## 实验目的

解除 `dispatch_subagent` 的 `startContinuable is not a function` 阻塞，并兼容 Team 的原始 UUID、恢复不保存默认值的会话模型选择。

## 修复与部署

- 插件提交 `9fb7254`，PR https://github.com/a2d2-dev/dsh-plugin/pull/116 。改用公开 `SubagentRuntime` 类型和 `startActivation`，指定 `delivery: 'parent'`，通过 `request.agentOptions` 传入模型与品牌化推理强度。异步结果失败明确记日志。
- UUID 与旧式 `session-…` 均保留原值；路径分隔符、穿越和编码路径输入仍拒绝。
- 运行时提交 `58b2a8359e`，PR https://github.com/imneov/deepseek-harness/pull/4 。恢复 Host-only `selectLocalModel`，复用目录校验、图片准入串行化与模型安装；`selectModel` 仍保存默认值，未新增 Remote 接口。
- 运行时部署分支 cherry-pick 为 `9aaad98175`；`.local/sync-runtime.sh` 已加入 `fix/session-local-model`，避免后续同步丢补丁。
- Web profile 的 dsh-a2d2 依赖和安装链接改到独立 worktree `/data/src/github.com/a2d2-dev/dsh-plugin.worktrees/fix-dsh-021-interfaces`。原 package.json 备份为 `package.json.bak-dsh-021-interfaces-20261018`。原主 checkout 未修改。
- 已构建插件和运行时 session-controller，重启 dsh-web-server、恢复 dsh-web-watch，两者均 RUNNING。未合并 PR，未放宽沙箱。

## 步骤与记录

1. 更新测试使用当前 API，旧代码实际报 8 个派发失败（`startContinuable is not a function`）和 1 个 UUID 拒绝失败；运行时新用例报 `selectLocalModel is not a function`。
2. 修复后插件 38 个文件、626 项测试通过，`pnpm typecheck` 和 `pnpm build` 通过；运行时模型选择 27 项测试通过，完整类型检查 5 个 gate 全部通过。
3. 插件类型检查曾因 Zod 4.6.5 与 DSH 4.4.3 并存而内存增长；对齐 Zod 版本后通过。早期运行时检查因跨 worktree 依赖链接产生重复声明失败；独立安装依赖后完整检查通过。
4. 使用 agent-browser 在实际入口 `https://dsh.e5box.a2d2.dev/` 添加本次修复 worktree，创建验收会话，通过模型调用 `bind_main_session`、`dispatch_subagent`，未以接口脚本替代页面操作。
5. 子任务只要求回复固定文本，禁止工具、文件修改和网络。实际子会话 `session-a4e40f3e-d4ec-4afb-804c-9c03b14bb8be` 的持久 request/header 为 `provider=codex`、`model=gpt-6.1-sol`、`reasoningEffort=medium`；工具调用数量为 0。
6. 父会话 `session-451aa891-15fc-48c6-9c5b-a90e818df588` 收到持久 `user/message`，来源为 `kind=subagent-settled`、`senderSessionId=session-a4e40f3e-d4ec-4afb-804c-9c03b14bb8be`，随后回复 `PARENT_RECEIVED_DSH_ACTIVATION_SMOKE_20261018_OK`。页面显示子任务完成。

验收过程中父模型曾传入无效的 issue=0，被校验拒绝，重试后成功；还将 parentIssue 设置为自身 109，属于本次验收会话的参数偏差，仅保存在独立 worktree。未修改实际业务仓库任务绑定或 GitHub issue。父工具仅写入本地绑定与 Agent 账本，子任务无写入。

## 验收范围

实际派发、实际模型/推理强度、子任务零工具调用和父会话完成通知已通过页面与持久记录双重核验。UUID 路径安全和会话模型默认隔离通过自动测试；本次未另外驱动 Team UI 或模型初始化 UI。

## 证据

![子任务完成与父会话确认](https://10.126.126.12:5200/assets/%E5%B7%A5%E4%BD%9C/assets/share_1792329386018_DSH_%E5%AD%90%E4%BB%BB%E5%8A%A1%E5%AE%8C%E6%88%90%E4%B8%94%E7%88%B6%E4%BC%9A%E8%AF%9D%E5%B7%B2%E6%94%B6%E5%88%B0%E9%80%9A%E7%9F%A5.png)

[筛选后的实际会话证据 JSON](https://10.126.126.12:5200/assets/%E5%B7%A5%E4%BD%9C/assets/share_1792329399630_DSH_%E5%AE%9E%E9%99%85%E5%AD%90%E4%BC%9A%E8%AF%9D%E6%A8%A1%E5%9E%8B%E4%B8%8E%E7%88%B6%E9%80%9A%E7%9F%A5%E8%AF%81%E6%8D%AE.json)
