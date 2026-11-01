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

## 指定开发实例真实模型验收

目的：确认真实模型、正式计量、自动材料维护、后继接任和实际工具操作构成完整链路。入口为 `https://dsh-dev.e5box.a2d2.dev/`，使用 agent-browser 操作并检查页面，未另建服务或切换验收入口。

开发集成以已有 `5996420` 为基线保留 #281/#197，再加入本修复 `6af8015`；安装包 SHA-256 为 `7d36755fa940afe8ba1d768f9701fe25e7d77fed4d8595c0b3e56e84d66b633b`。199 个安装 lib 与包逐文件一致，其他 profile 配置保持。独立 dev 重启回执 `ee03e056-ecc9-464b-995b-531ccbf134fc` 为 succeeded，PID 3653362 → 3787773；正式 PID 3653321 未变。

步骤：建立本地 QA 任务，真实 `codex/gpt-6.1-sol`、medium reasoning。源会话连续执行身份核对、读本地指令、读 250 行非重复文本、计算 SHA-256；后继按 epoch 分支只核验摘要，写入并回读证明文件，再明确暂停。自动目标设为 30000、交接预留 16000，便于验证同轮跨阈值，不以实际消耗 300K 作为功能前提。

记录（UTC 2026-11-01）：

- 最终 Task `1c23465c-ebaa-4064-8e5b-3d2781a2c6e9`，Execution `b8da0e09-5748-4621-b470-a2ccd2ab3f4a`。源 `session-d2ea9379-15c4-4a2d-974c-5f474e0e0822`，后继 `session-1e9c7b89-cf2d-44b7-9f1e-917746fd2602`。
- 源 turn 1 的正式 tokenMeter 前缀读数为 18987、19086、25811、37096，最后一项与现场持久 observation 的 `logRevision=44 / totalTokens=37096` 精确相同。前三项由宿主公共 TokenMeter 对真实持久事件与 surface metadata 离线回放，不是首次低值的实时采样，也没有手动累加模型 usage。回放脚本与原始摘要保留模块和 journal 校验值。
- 超过目标后源 seq44 以 blocked 结束，系统自动请求并保存材料，唯一 operation `c80fde83-7b10-4c6b-b598-f153bb4509a3` 的 `automatic=true`，epoch 1 → 2、phase=received，历史 operation 为 0，且没有 runtimeFailure。
- 后继真实运行摘要与行数工具，写入并正式 read 回 `QA341-FINAL-AUTOMATIC-SUCCESSOR-20261101`。最后自主 `work_control pause`，控制 applied，公开查询 runtime=idle，页面显示“原执行已暂停”和“后继已确认材料可读”。两会话原生人工输入均为 0，没有人工补发继续或手动接续。
- 模型首次 write 缺少 justification 被拒，补齐后实际写入成功；调用中还出现本机指令禁止传入的 sandbox_permissions 字段。这些模型执行偏差保留，不将本轮称为全程指令合规，也不把参数拒绝记成产品成功。最终写入、读取、暂停由真实工具事件及工作库分别验证。

首轮探路 QA 的 24067 目标过小，后继继续读取剩余大文本造成多次正常接续，未满足唯一接续验收；该记录未删，已显式 pause 并回读 applied/idle。最终独立任务调整为一次完整文本读取和明确 epoch 分支后验收通过，没有改产品代码来迁就测试。两个 QA 均已暂停，无活动测试作业或定时器。

本机证据目录 `/data/_ssd2t/dsh/home/docs/artifacts/auto-continuation-341-20261101/` 包含 `final-verification.json`、`final-meter-replay.json`、`final-state-history.jsonl`、`final-proof-paused.png`、`final-received-paused.png`；截图均已打开检查。该目录不上传完整业务工作库或私有会话。

## CI、审查与交付范围

独立 fresh-context 审查对固定 `bb363c7`（基线 `f39d93e`）APPROVE。后续提交只补测试类型或验证文档，没有改变生产实现。`702e565` 对应 push 与 PR 的 Node 22、Node 24、secrets 全部成功；每个 Node 的全量 Vitest 为 1635 通过、1 项仓库既有跳过，另外 Node 测试、仓库检查、类型检查及干净源码打包导出检查通过，实际包可导入全部 15 个 Node 入口。

本次仅更新并重启开发实例；正式推广尚未执行。已备好基于正式主干的独立交付包 `issue341-reviewed-702e565`，不携带开发独有 #281/#197。当前正式仍为 #342 包，#1474 已有接续恢复由 #342 负责，本次未再次修改原业务状态。正式工作库中三条旧 continuation-route-changed 记录未清除，旧 observation 已被覆盖，不能仅凭现有同路由值断言最初误报原因；不把这三条历史保护解除冒充本票修复。
