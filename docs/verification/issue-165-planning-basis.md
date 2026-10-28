# #165 preview 稳定性验收

## 工作身份与范围

原始工作为 [Issue #165](https://github.com/a2d2-dev/dsh-plugin/issues/165)。目标是在来源发现或 canonical 进展正常推进时仍能预览持续委托计划，同时保留规划授权、身份与最新范围校验，兼容已有 rule v6／plan v1 数据。

本次核实发现，稳定指纹、最新事实校验及模型错误摘要已合入主干，后续 #167 的请求体压缩与模型失败诊断也已合入。因此本次补齐验收证据，不重复修改生产实现，不扩大到其他持续委托功能。

## 实现依据

- `planningBasisFingerprint` 比较规则输入、来源身份／版本、候选集合和 canonical 权属，排除 discovery、sequence、错误、观察时间、进展文本、临时 state／control。
- `previewContinuous` 在模型调用前保存稳定指纹，调用后重建最新 basis；身份变化返回 `planning-basis-changed`，稳定时使用 `validatePlan(output, fresh, current)` 执行完整校验。
- 模型调用失败保留脱敏错误摘要和请求大小／候选数，不将模型失败改写为 basis 变化。
- `savedBasisSchema` 仍读取旧完整 source／issue basis，现有计划不被重写。

本次源码基线为主干 `d8f8507`。现场包来自 `continuous-repair-299-301-cff99bb`；以下比较退出 0，四个相关生产模块一致：

```sh
git diff --exit-code cff99bb -- src/work-planning.ts src/work-planning/llm.ts src/work.ts src/work-sources/discovery.ts
```

## 定向回归

```sh
pnpm test tests/work-planning.spec.ts tests/work-planning-payload.spec.ts tests/work-planning-llm.spec.ts tests/work-continuous.spec.ts
```

回执 `bash-714`，退出 0，4 文件 129 项通过，耗时 16.28 秒。覆盖稳定字段与身份变化、候选排序、Project 身份、模型期间真实 discovery 调度路径、最新标签范围校验、模型失败脱敏与恢复、旧计划读取和 legacy 规则内容保留。46 候选的 observations 为 414737 bytes，basis 为 131112 characters／bytes。

当前生产实现没有新增改动，因此没有重复运行无关完整检查链。原始确定性红测试与修复已在 `2a60e70` → `b0ae8fe`、`57715e9` → `0b45e48` 和 `3fcc7dd` → `4f359b8` 的历史中保留。

## 当前实例真实回归

目的：在来源和 canonical 事实真实变化时，连续三次 preview 至少两次成功，并保持三次请求之间配置不变。

使用既有 DSH 实例、已登录的 agent-browser 和真实 `codex/gpt-6.1-sol`，未另起服务。来源为当前 DSH A²D² Project，source `876c02eb-6cf7-420b-b674-c6a246420477`，rule `ad80d1c4-c318-4df2-abde-f67b06a7780c`。起始 rule v28，已有 plan v1。

当前默认后台发现间隔已经是 5 分钟。为复现原票的 30 秒干扰，通过同一实例既有 `source.issues(refresh=true)` 每 30 秒触发真实 Project 发现，刷新未完成时跳过重入；不修改后台定时器、规则配置或来源身份。每轮使用最新 expectedVersion。当前 Task 的真实处理会话持续执行，规划期间通过 `work_report` 写入 canonical 进展；这些写入不改变 owner／epoch／session。

执行步骤：

1. 浏览真实来源及持续委托页面，查询 source／rule，核实已有模型、资源与配置。
2. 保持 instruction、supplements、Block、scopeVersion、scope、executionStrategy、enabled 和 queue 设置不变。
3. 连续发起三次 `continuous.preview`，并行每 30 秒触发来源发现，记录 HTTP、错误码、耗时、plan 版本及 source.sequence。
4. 在模型窗口内保存 Task 进展，观察当前页面，核实 preview 未使当前执行更换身份。
5. 收取全部响应与持久结果，比对配置和原计划，保存中文记录及截图。

三次连续调用均已结束，达到原票的至少 2/3 成功要求：

| 轮次 | UTC 开始时间 | 耗时 | HTTP／结果 |
| --- | --- | --- | --- |
| 1 | 2026-10-27T11:08:00.313Z | 107.921 秒 | 200，成功，plan v2，51 steps |
| 2 | 2026-10-27T11:09:48.664Z | 91.630 秒 | 200，成功，plan v3，51 steps |
| 3 | 2026-10-27T11:11:20.707Z | 103.492 秒 | 400，`planning-execution-mismatch`，模型选择的执行模式与当前 canonical Task 不符，被既有安全校验拒绝 |

第三轮不是 basis 抖动或模型服务停止，不计为成功；保留原始错误码，不放宽模式检查。三轮均没有 `planning-basis-changed`。

30 秒定时触发共 10 次，其中 5 次实际完成完整发现，另 5 次因前一刷新仍在途而跳过重入。每次真实刷新 HTTP 200，source.sequence 从 526 增至 531；第二、三轮开始时 discovery 为 syncing。当前默认 5 分钟后台周期没有被改写，30 秒测试触发器在三轮完成后停止，最后一项在途刷新也已收取。

最终收取脚本的七项断言全部通过：恰好三轮、至少两次成功、没有 basis 错误、三轮及最终配置一致、原 plan v1 逐字段不变、canonical 执行身份一致、来源发现确实推进。rule 最终为 v30，plans 为 v1／v2／v3。当前 execution `097cfb63-941a-4661-8752-f57f2638ce2c` 的 owner `54ab1416-9029-4cec-896d-a92e621c284c`、epoch 1、session `session-157e8e67-f512-4cbb-a378-085fd708feae` 与成功计划记录中的身份完全一致。

页面截图实际显示来源正在扫描、保留上次完整结果，同时 #165 显示处理中及本轮写入的 canonical 进展。已逐图检查截图。测试没有依靠生成的假计划或模型 mock；确定性测试中的 fake port 仅用于自动回归，现场结果来自真实 GitHub 来源和真实模型。

## 五项原始验收对照

| 原 Issue 期望 | 已验证依据 | 状态 |
| --- | --- | --- |
| 1. 仅稳定规划输入决定有效性 | 稳定指纹 26 项测试通过，身份／来源版本／scope／strategy 变化均有拒绝依据 | 通过 |
| 2. 易变字段不能单独作废 preview | 参数化指纹回归及模型期间 discovery tick 集成回归通过 | 通过 |
| 3. 用最新 basis 完整 validatePlan，错误可诊断 | 最新标签越界返回 `planning-outside-scope`，身份变化返回 `planning-basis-changed`，错误摘要测试通过 | 通过 |
| 4. 活跃来源 + 30 秒发现下连续三次至少两次真实成功 | 当前实例 2/3 成功，5 次完整发现，sequence 526→531；第三次保留模式校验拒绝，三次无 basis 误判 | 通过 |
| 5. rule／plan 结构兼容 | 旧完整 basis 逐字段解析保持不变，legacy instruction／plans／blocks 保留测试通过 | 通过 |

原始响应、检查记录与截图存于本工作树忽略目录 `docs/artifacts/issue-165-2026-10-27/`，凭据不写入证据。任务与 Project 最终状态以验收后的接受回执为准，原 Issue 最终关闭由 LF 完成。
