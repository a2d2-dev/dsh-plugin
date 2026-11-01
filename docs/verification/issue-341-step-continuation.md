# #341 长 turn 的安全步骤接续

## 目的

自动接续的 300000 token 是安全边界上的软目标。长 turn 在首次低于目标、完成后续工具并越过目标时，也应安排正式交接；不打断运行工具，不把原生 Stop 当成交接。

## 根因与改动

原宿主按 turn 缓存业务准入，自动接续计量却附在准入回调的非空消息路径。首次准入后，同一 turn 的后续空消息步骤不会再读 tokenMeter；后台协调又等待当前执行空闲，因此长 turn 会持续越过软目标。

宿主现在在每个非人工、非维护的 `agent/pre-step` 独立检查接续。包括人工发起 turn 完成工具后的后续步骤。正式 `tokenMeter.measure`、实际路由窗口和输出预留仍由原计量边界读取。达到目标先持久预留唯一 operation，再复查业务准入；已经 claim 的自动消息沿原 Task 事件路径完整保全。拒绝下一步产生宿主 `blocked`，既有 idle recovery 再推进材料、接任、读取确认和业务输入。没有新增取消工具、计时器或硬 token 上限。

turn 准入缓存继续允许 wait/done 后提交已执行工具的结果和最终答复。原生人工消息仍正常进入对话；维护步骤仍只允许原 operation 的窄工具。计量返回后的提交重新核对 owner、epoch、当前 Session、策略、控制和队列资格，暂停、结束及等待不被计量解除。

## 步骤与记录

使用真实 DSH AgentLoop、SessionController、工具运行时及 JSONL 持久化。外部模型输出受控；tokenMeter 在公开服务边界提供确定读数，不用 UI 压力估算或模型 usage 替代。

1. 启动真实 Task，会话内连续完成两次 `work_control progress` 工具；第一次后计量 100，第二次后计量 300001，目标 300000。
2. 分别由原生人工消息和自动输入发起。人工例下一步没有新消息；自动例在阈值处插入完整自动消息，检查拒绝后仍保留原 ID、内容和来源，并最终进入后继。
3. 检查越界步骤没有再次请求业务模型，operation 为 automatic/reserved；运行原有协调，检查同 Execution/owner、epoch 增至 2、材料正式 received、后继实际收到 `continuation-business` 输入且只创建一个后继。
4. 运行相关接续、控制和队列回归及类型检查。

旧代码红灯已记录在 `docs/artifacts/auto-continuation-341-20261101/step-red.log`：自动例 measurements 只有 `[100]`，未包含 300001。首次人工例遇机器磁盘 I/O 导致默认 15 秒超时，不作为产品失败证据。增强回归使用命令级 60 秒预算。

定向绿灯 `step-green.log`：人工及自动两例通过，测试主体共 3.95 秒；包含同 turn 两个真实工具步骤、低/高两次读数、blocked、唯一后继、received、业务自动继续与原 envelope 保全。

完整相关回归 `affected.log`：5 文件、96 项全部通过，测试主体 33.78 秒，总耗时 39.40 秒。范围为 `work-continuation`（含新增等待/暂停用例）、`work-execution-boundary`、`work-execution-guard`、`work-queue-end-host`、`work-continuous-integration`。命令为：

```sh
PATH=/root/.nvm/versions/node/v22.23.1/bin:$PATH pnpm exec vitest run tests/work-continuation.spec.ts tests/work-execution-boundary.spec.ts tests/work-execution-guard.spec.ts tests/work-queue-end-host.spec.ts tests/work-continuous-integration.spec.ts --testTimeout 60000
```

`pnpm typecheck` 在参数化测试的 MessageSource 联合类型修正后退出 0，日志 `typecheck-green.log`。该修正仅把测试的 `{ kind }` 改成两个显式来源分支，生产代码及回归行为不变。`git diff --check` 通过。构建、包检查、CI 和开发实例页面验收由主协调统一执行，不在本实施分支重复运行。

开发页面与真实模型验收由主协调执行，本实施记录不代替该验收。正式 #1474 的策略、状态、队列和服务均未操作。
