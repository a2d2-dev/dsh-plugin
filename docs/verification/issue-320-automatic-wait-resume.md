# #320 模型等待自动恢复验证

## 目的

确认模型登记的外部／执行者等待能由对应通知唤醒，实际观察结果并继续工作；条件仍未满足时可再次等待。人工等待、暂停、结束、已完成、退役和维护的权限边界保留。

## 步骤

基于 `origin/main` 的 `e5ec679`，在独立 worktree 安装锁定依赖。先加入真实 AgentLoop／Inbox 定时复查回归并运行，确认修复前没有新增模型请求。随后在 `WorkApplication` 的现有自动准入中补充模型等待唤醒，并运行以下回归：

```sh
pnpm exec vitest run tests/work-execution-guard.spec.ts
pnpm exec vitest run tests/work-continuous.spec.ts -t 'existing queue slot'
pnpm typecheck
pnpm test
```

## 观测记录

- 红灯：外部等待收到 schedule 后，模型请求仍为 2，断言 `expected 2 to be greater than 2` 失败；不是模型回复或文件系统权限导致。
- 成功／失败作业：使用真实 LocalJobs 和 ToolJobs，registry 结算生成原生通知并唤醒父会话；分别在等待控制 accepted 与 applied 时结算，四组回归均通过。模型实际调用 `job_output`，工具日志含 `REAL-JOB-EVIDENCE`，随后读取 `dependency.txt`、写入 `job-proof.txt`。无关 job 通知仍不进入模型。
- 定时复查：外部等待执行真实读写；执行者等待在作业仍运行时调用 `job_output(wait=false)` 并重新保存相同 job 的等待。读工具执行时断言协调状态已为 running、resume 已应用。
- 子会话：真实 continuable 子会话运行受控工具；伪造的提前结算消息不能进入父模型；原生结算信封到达后父会话实际写入 `child-proof.txt`。
- 重复事件：同一已准入通知在再次等待后不新增模型请求。
- 人工边界：human 等待和显式 pause 拒绝 schedule 与 GitHub 自动通知；真实人工消息仍可进入对话。已有完成、退役、维护及人工消息接回回归继续执行。
- 队列边界：等待项无槽位时，无关自动输入不请求恢复；有效复查保留原始消息并请求调度，取得既有槽位后 resume 应用，不绕过队列。独立确认消息已消费后再次保存模型等待，重放旧通知不会恢复或再申请槽位。

原始本地日志保存在忽略目录 `docs/artifacts/issue-320-20261031/`；公开源码不附带真实业务会话或私有工作库。

## 范围与限制

这些回归使用真实宿主 AgentLoop、Inbox、JSONL、文件工具和 jobs／subagent 生命周期；模型输出与外部 GitHub 服务由确定性 fixture 控制。GitHub 通知准入依赖现有可信 watcher 来源，登记与投递由 watcher 原有测试负责。自动唤醒仅允许核实和继续原授权工作，不把通知认定为业务验收。

本实现阶段未安装插件、未重启开发或生产服务、未改变 #184 业务工作。现有开发实例的页面与供应商验收由集成人员另行记录，测试通过不替代页面验收。宿主 blocked 空轮显示文案不属于本次插件改动。
