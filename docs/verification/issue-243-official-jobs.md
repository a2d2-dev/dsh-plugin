# #243 官方 DSH jobs 观察与 P1 修复验证

## 目的与范围

修复独立审查确认的 P1：官方 `jobs.read` 已消费一次性结果，但后续 post-execute 失败或 Session result 提交失败；旧适配把随后没有 payload 的成功重复 `job_output` 当作已交付，错误解除完成门禁。

- 工作树：`/data/src/github.com/a2d2-dev/dsh-plugin/.scratch/official-dsh-compat`，分支 `fix/243-official-dsh-compat`，本次修复基线 `ba0b4d2646a1e2b31fa696f2f88be10fb8df1f10`。
- 只读官方构建：`/data/src/github.com/deepseek-ai/deepseek-harness-dev.worktrees/dsh-upgrade-latest-20261024`，HEAD `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`，各载入包版本 `0.2.1-rc.3`。
- 所有命令显式使用 Node `v24.22.1`。未修改官方 Host、live/profile/3080、依赖目录、package 或 CHANGELOG，未 install、push、PR 或 merge。
- 生产修改限于 [official-job-observation.ts](../../src/work-execution/official-job-observation.ts)、[job-observation.ts](../../src/work-execution/job-observation.ts)、新增 [official-job-receipts.ts](../../src/work-execution/official-job-receipts.ts)，以及已提前告知父会话的 [work-plugin.ts](../../src/work-plugin.ts) 最小 hook 安装接线。
- 观察仍只用公开 `jobs.list/get` 与 `sessionQuery.observeSession`；不读输出、不改变 cursor、不激活模型。receipt 使用公开 `tools/result`、`session/event` 和官方 `appendPluginRecord`。

## 根因及真实红灯

官方 `packages/jobs/jobs-local/src/index.ts:470-475` 的 `readJob` 先推进 model cursor，并把终态 final result 标为已消费。`packages/jobs/tool-jobs/src/index.ts:517` 先 read，再由 `packages/core/tools/src/pipeline.ts:354-362` 跑 post-execute；策略抛错或取消后，最终只返回 error。标准 `tool/result` 不保存 canonical value。

旧算法只有 `settled < tool/call < successful tool/result` 的排序证明。该排序既不证明首读提交，也不证明重复读取还带 payload。此前合成测试“失败后重复成功必恢复”假设错误，已替换。

先只扩真实官方 integration，在基线源码上运行下述官方命令，exit 1，约 1.92 秒。原始记录在本工作树 `.local/tmp/p1-red.log`：

```text
Official jobs fixture provenance ... "head":"22ddee3792402c3e70ec5f86a63c3e3e895a2f60","node":"v24.22.1" ...
AssertionError: expected 'delivered' to be 'pending'
Expected: "pending"
Received: "delivered"
...work-execution-official-jobs.integration.ts:156:80
Test Files 1 failed (1)
Tests 1 failed (1)
```

红灯之前已断言真实首读后重复 read 为 `chunks: []` 且没有 `result`；失败点恰是该无 payload 重复读取错误解除门禁，不是环境或模块装配错误。

## 第二轮审查：canonical 与展示投影必须对应

`2a6e519` 仍有另一个可达窗口：官方 post-execute 可合法返回 `{ kind: 'accept', content: [] }` 或任意替换展示，而保留非空 canonical `value.text`。此前只比较两处最终 content 的摘要，空展示也能产生回执。

父会话先加入真实官方“清空展示”和“替换成无关文本”场景，使用相同官方测试命令运行，`.local/tmp/presentation-red.log` 明确失败：`expected delivered to be pending`，断言同时确认 canonical 有实际输出、已提交 result 成功且展示确为空。修复使用当前调用快照中工具公开、纯的 `output.render(args, value)` 重建 canonical 投影，必须与最终 content 完全一致且非空，才进入回执候选；不再次调用有状态的 finalizer，也不解析自然语言。

加强后的回执为 **version 2**，冷读明确拒绝缺少该证明的 v1；空 content 即使伪配相同摘要也被拒绝。`.local/tmp/presentation-green.log` 中两种真实策略替换场景通过，`.local/tmp/presentation-unit.log` 为6文件63项通过；后续 `.local/tmp/presentation-final.log` 加入官方真实 `outputLimitBytes:128` 有损 finalizer，完整场景通过，类型检查与正式构建也通过。此有损场景保守 pending，未把输出截断伪装完整交付。

## 修复后的结构证明

[receipt hook](../../src/work-execution/official-job-receipts.ts) 只接受 direct `job_output` 的最终公开 canonical outcome。必须成功、无 error、无 parent，canonical `job.id` 与精确 JSON arguments 的 `job_id` 相同，canonical 状态为 completed/failed/killed，且 canonical `text` 字段非空。随后通过本次调用快照的公开 `ToolDefinition.output.render` 重建投影，并与最终 content 精确核对。这里仅比较结构与完整不透明 payload，不解析 text、状态行、summary、标签或自然语言证明输出。

随后等待同一 Session 的真正 `tool/result` 接受事件。必须匹配 callId、turn、step，成功且无 error，`sourceEventSeqs` 引用精确 call seq，最终 content 的 SHA-256 摘要与 tools/result 一致。只有这些条件成立才排队追加 `plugin:a2d2/official-job-receipt`。官方禁止 publication 内重入 append，所以追加在 microtask 进行；追加失败只记录警告，不生成替代证明。

receipt 保存 version、owner、jobId、终态、canonical payload 字节数，以及 call/result seq、callId、turn/step 和已提交 content 摘要；不重复持久化原始输出。重放再次校验 receipt 的 ignorable 身份、版本、owner、官方 UUID 生命周期、终态、正整数字节数、精确 call/result/source edge、提交成功及摘要。单独成功 result、单独 receipt、缺失提交、错误提交或错配 receipt 都不会交付。

这是 Session 接受提交边界的证明，沿公开 Session 持久化通道保存。它不承诺每个 live event 在 fsync 前就耐受断电：进程在 result 与 receipt 之间崩溃，或 receipt 的持久化丢失，冷读会保守回到无证明；不会从 prose 或重复空 read 补造 receipt。fixture 显式 `sessions.flush` 后重建全新 Context，验证真实 JSONL 冷读可恢复。

正常有 payload 的 running `wait:true` 不再要求 settled 早于调用开始。其 canonical 终态值与成功提交可直接形成 receipt，首次 wait 即解除等待；普通 terminal read 同理。旧 fork 的 epoch/instance journal 和官方 V3→V4 后的 `plugin:jobs/*` 读取保持原行为。始终保留 `result=unknown`、`acceptance=unassessed`，交付不替代业务验收。

## 能力限制与准确恢复

- **被策略替换或有损截断的展示**：即使 canonical 有 payload，最终展示也必须与公开纯 renderer 的完整投影相同。清空、无关文本替换或有损 finalizer 均不发v2回执；这不表示截断后的文字不存在，而是没有完整 payload→已提交内容的证明。该边界已用真实 `outputLimitBytes` 场景验证；不解析截断提示或文件路径来补造证明。
- **真正空输出、无 final result，或空字符串 final result**：公开 canonical `{text:'',job:terminal}` 与“此前已消费后，重复读到空”不可区分。因此无 payload 不发 receipt，live 原作业仍 pending。fixture 明确覆盖真正空结果的 `wait:true`。本片不宣称这类 wait 自动解除，也不把它称为交付。需要宿主提供更强结构化消费事实，或操作者按以下 loss 流程收口，才能避免该边界。
- **失败、取消、丢失成功提交、插件启用前已消费或 receipt 丢失**：仅重复 `job_output` 无法恢复一次性 final result。新作业可补充独立证据，但不会清除旧作业 blocker。
- **PTC/无日志调用**：公开工具执行即使成功返回 canonical payload，没有匹配 direct Session call/result commit 也不交付。嵌套 parent outcome 不发 direct receipt。本片验证真实公共 PTC 子 dispatch pipeline seam，未运行完整 PTC 语言运行时/VM，不宣称支持 PTC delivery receipt。
- **inline 通知**：通知源有 `kind:'tool-jobs'`，但没有可作为 job/result 对应证明的结构身份；不解析其文本或 summary。通知提交后若只剩空 read，仍 pending。真实官方 `inlineOutputBytes:2048` 路径已覆盖。该配置下提前开始的正常带 payload wait 仍首次交付；fixture 也已覆盖。若日常异步工作必须稳定经 direct read 形成证明，部署可使用官方现有 `inlineOutputBytes:0` 配置；本片没有修改任何部署配置。
- **可行的旧记录恢复**：先保留产物、补跑并独立核验结果；旧 live 记录仍阻断。操作者可通过官方公开 `jobs.remove(id, owner)` 移除已结束记录，或在计划结束原注册表实例后收口。此时历史投影为 `availability=lost, delivery=unknown`，沿既有“不可达只提醒”规则给 bounded reminder，不再阻断。fixture 验证真实 remove 路径；插件不会自动移除、伪造 collected 或重新标为 delivered。
- 未记录官方生命周期时，receipt 也不能补造 owner/官方作业身份；保持无交付证明。跨 owner、旧 ordinal/list-only Host、通知、job_kill、teardown 不会获得额外权限或交付证明。

因此，本片修复 P1 的假阳性，并支持正常带 payload 的 read/wait；**不等同于所有官方 jobs 消费形式均具备自动完成门禁恢复能力**。尤其空结果与已提交 inline 的自动收口仍有限制，父会话整合与部署判断必须保留这一点。

## 实际执行命令

从上述工作树运行，官方红灯与修复后绿灯使用同一官方命令。普通回归和类型检查使用独立 TMPDIR。所有 Vitest 使用 `--configLoader runner --no-cache`，不使用共享依赖缓存。

```bash
PATH=/root/.nvm/versions/node/v24.22.1/bin:$PATH \
TMPDIR="$PWD/.local/tmp" \
DSH_OFFICIAL_HOST_ROOT=/data/src/github.com/deepseek-ai/deepseek-harness-dev.worktrees/dsh-upgrade-latest-20261024 \
node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache \
  --config tests/official-jobs.config.ts

PATH=/root/.nvm/versions/node/v24.22.1/bin:$PATH \
TMPDIR=/data/_ssd2t/dsh/tmp/issue-243-integration \
node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache \
  tests/work-execution-official-jobs.spec.ts \
  tests/work-execution-jobs.spec.ts \
  tests/work-execution-lost-job.spec.ts \
  tests/work-execution-observation.spec.ts \
  tests/work-compact-results.spec.ts \
  tests/work-execution-boundary.spec.ts

PATH=/root/.nvm/versions/node/v24.22.1/bin:$PATH \
TMPDIR=/data/_ssd2t/dsh/tmp/issue-243-integration \
node node_modules/typescript/bin/tsc --noEmit --incremental false

git diff --check
```

命令原始 stdout/stderr 分别重定向至工作树 `.local/tmp/p1-red.log`、`.local/tmp/p1-expanded.log`、`.local/tmp/p1-unit.log`、`.local/tmp/p1-typecheck.log`。这些本地日志供父会话复核，不纳入源码提交。

| 验证 | exit | 结果 |
| --- | ---: | --- |
| 真实官方 P1 红灯，先扩测试、未改根因代码 | 1 | 消费后失败 + 成功空重复错误得到 delivered |
| 真实官方扩展 fixture | 0 | 1 文件、1 完整集成场景通过；官方 SHA、版本、Node provenance 强断言 |
| 相关回归 | 0 | 6 文件、62 测试通过，其中 official jobs 35 项 |
| 服务端 TypeScript | 0 | `tsc --noEmit --incremental false` 通过 |
| diff whitespace 检查 | 0 | 无问题 |

## 真实 fixture 覆盖及未验证项

[官方 integration](../../tests/work-execution-official-jobs.integration.ts) 使用官方 registry、tool-jobs、共享 pipeline、native executor、AgentLoop、Session、JSONL、sessionQuery 与 migration catalog；仅模型是确定性脚本适配器。配置缺 env、缺构建或 SHA/version 不符会 hard fail，不 skip。

实际覆盖：只观察不 read/readAt/不增加模型请求，exact owner/unowned 隔离，正常终态 read 和重复读，真实 post-execute 消费后抛错，canonical 成功但无日志，Session 成功 result append 故障及官方 error recovery，消费后取消为 ABORTED，嵌套 parent 消费，两个真实并发 read 的一份 payload/一份空结果，running wait 首次交付，真正空 wait 的限制，公开 remove 后 loss 提醒，JSONL flush 后冷恢复，UUID 重启隔离、旧 fork V3→V4 迁移，以及真实 inline 通知提交后空读和默认 inline 策略下正常 wait。

[unit journal 验证](../../tests/work-execution-official-jobs.spec.ts) 补充 receipt 的版本、owner、job、状态、字节数、call/result/source edge、turn/step、摘要错配拒绝；旧“重复必恢复”断言已删除。既有 lost jobs、fork jobs、观察图、执行边界、紧凑结果一并回归。

未运行全仓测试、完整 PTC VM、浏览器/UI、live 模型或 3080 切换验收。本任务只修 jobs scope，官方 Host 与 live 均未修改；父会话负责整合、独立复核与最终部署验收。
