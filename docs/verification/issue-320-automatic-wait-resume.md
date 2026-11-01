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

## 最终验证结果

- 最终代码 `30ae9c9`：130 个测试文件、1589/1589 项通过；定向 guard/continuous 129 项通过，类型检查、仓库检查和打包入口检查通过。独立审查发现的「通知早于 wait 应用」和「队列恢复后重复通知」均已修复并复核通过。
- 开发兼容分支 `dev/320-wait-resume-acceptance`，提交 `9a92c39`，在主干 `e5ec679` 上保留开发实例已有 #281 及存储所需 #197，再集成本修复。两项开发改动不进入本 PR。兼容回归 29/29 通过。

## 开发实例真实模型验收

目的：在指定页面 `https://dsh-dev.e5box.a2d2.dev/` 验证原生完成事件可唤醒真实模型，而非仅验证模拟模型 fixture。

步骤：通过 agent-browser 创建独立本地 QA 工作区与任务；使用真实 `codex/gpt-6.1-sol`、medium reasoning 启动后台 Python 作业。作业等候测试 release 文件，模型保存准确 `bash-1` 的 executor 等待并结束首轮。控制者读到 waiting/applied 后才释放文件，全程不向会话补发人工消息。模型收到宿主生成的 tool-jobs 通知后调用正式 job_output、写文件、回读，并按测试要求暂停。

记录（UTC 2026-11-01）：

- 最终 QA Session：`session-80ebed2a-8796-4eca-9542-9eff2a4cc5b5`；Task：`3e8e99fc-0b93-48b9-b0b0-3c085309f3a5`。
- 实测 `waiting / wait applied / idle → running / automatic-wake resume applied → paused / pause applied / idle`。
- 正式 job_output 得到 `QA320-FINAL-NATIVE-RESULT-30ae9c9`；`job-final.proof.txt` 内容回读一致。原始 journal 为两轮、10 次工具调用，人工追加消息 0、blocked 回合 0。首次 write 缺少 justification 的调用被工具拒绝，模型补齐参数后写入成功；该记录保留，没有将拒绝当作成功。
- 最终安装使用独立路径 `packages/issue320-final-30ae9c9/a2d2-dsh-a2d2-0.0.23.tgz`，安装后的全部 199 个 lib 文件与包逐项哈希一致。重复覆盖同路径 tarball 曾导致缓存复用，已核实并纠正后再执行最终验收。
- 开发重启回执 `302d4531-3573-439c-b9b4-70597c77367f` 为 succeeded，运行 PID `3181880`；正式服务 PID `3102758` 未变。
- 本机证据：`/data/_ssd2t/dsh/home/docs/artifacts/dsh-wait-resume-2026-10-31/` 中 `final-evidence.json`、`final-waiting.png`、`final-proof.png` 以及安装/构建日志。截图已实际打开检查。

开发环境前置问题已恢复：旧包不识别现存 executionDefaults，集成保留 #197 后原记录可读；两天前残留的 0 字节写锁经 inode、时间及无打开 FD 核验后隔离保存，原工作记录未删除。两个 QA 会话均已按要求暂停，无活动测试作业或提醒；共享开发实例已交接给 #334。

本次交付仅安装开发实例。正式 #184 未恢复，正式推广另行安排；宿主历史 blocked 空回合的显示整理仍属于 #320 未完成部分。
