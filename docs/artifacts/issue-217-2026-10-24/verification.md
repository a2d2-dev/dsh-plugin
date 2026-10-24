# #217 接续空白后继修复验证

## 目的

修复“合并PR并更新Issue状态”接续后，原段已显示会话切换、后继却没有交接内容的故障。保留 Task、固定后继、协调代次与原材料，通过正式接续恢复入口补投。

## 现场与根因

- 原协调段已经保存完整材料，后继已经接任；持久阶段为 `taken`，尚无 `kickoffDelivery`。
- 错误：`continuation-outcome-unknown: secret.startsWith is not a function`。
- 最小输入 `docs/specs/task-interaction-v4-delivery.md` 即可使现场安装版 `redactText` 抛出相同异常。
- token 正则误匹配普通路径内的 `sk-interaction-v4-delivery`，且只有一个捕获组；回调却按 `(match, prefix, secret)` 读取两个组，第三个实参实际是数字 offset，调用 `startsWith` 崩溃。
- 接续原实现先创建后继、提交接任，再生成首条消息，因此内容生成失败会留下已接任、尚无消息的后继。

## 修复

1. 独立 token 规则使用两个捕获组，与统一替换回调保持一致；添加前缀边界，避免从普通标识符内部匹配密钥。独立 token 仍脱敏，二次处理保持幂等。
2. 首条消息在创建后继及提交接任前生成、校验；生成失败时原协调段仍保有权限，显式重试复用预留身份。
3. 已处于 `taken` 的旧操作继续使用现有恢复路径生成、补投，保留 operation、successor、kickoff ID。投递与其回执丢失均由原有幂等投递机制恢复。
4. 页面把会话切换与内容送达分开描述；已接任但未投递时显示醒目说明、投递失败信息及“重试内容投递”。

## 步骤与记录

基线：`origin/release/v0.0.22`，提交 `51809db64ce9092153ded0b04dfa0620f34423e3`。独立修复工作树，不修改其他任务分支。

### 回归先红

先添加普通路径、三类独立 token、真实接续材料、消息生成失败前权限保护回归，再运行：

```sh
TMPDIR="$PWD/.tmp" corepack pnpm exec vitest run tests/handoff.spec.ts tests/work-continuation.spec.ts
```

修复前：2文件，18项失败、38项通过。脱敏回归出现 `secret.startsWith is not a function`；真实接续测试复现 `phase=taken` 而预期为 `delivered`。消息准备失败的新增测试也确认原实现错误地转移了权限。

首次使用宿主默认 TMPDIR 时 Vite 临时目录不可用，测试套件未加载；改为工作树内可写临时目录后才取得上述有效红灯。该环境错误不计为产品回归证据。

### 修复后验证

```sh
TMPDIR="$PWD/.tmp" corepack pnpm exec vitest run \
  tests/handoff.spec.ts tests/work-continuation.spec.ts \
  tests/client/execution-components.spec.ts tests/client/session-handoff-entry.spec.ts
corepack pnpm typecheck
corepack pnpm build
git diff --check
```

- 4文件、62/62项通过；真实宿主接续测试20/20，脱敏36/36，界面合同6/6。
- 覆盖材料请求、后继创建、接任、输入封口及首条消息投递的丢回执恢复；后继真实宿主日志中首条消息恰好一次，模型请求保留普通路径且不含测试密钥。
- 消息准备失败时维持原 epoch/session，只有原会话存在；重试后原预留后继接任并收到一条消息。
- typecheck、构建及 diff 检查通过。
- 独立只读复核指出：`taken/error` 也可能是已投递但回执丢失，不应一律宣称“投递失败”。已改为“交接内容尚未确认送达／接续尚未完成”，保留幂等重试入口；改后界面合同6/6通过。
- 测试临时目录随后收纳到忽略的 `.local/tmp`；不提交生成文件、完整私有材料或凭据。

## 实例恢复验收（已通过）

修复 PR #218 已于 `2026-10-24T05:23:17Z` 合并到 `release/v0.0.22`，合并提交 `d975e9cc60c8c7acee6c91fc80d7d277691d9577`；通过 Git 比较确认与已测试提交 `9fa3795db151f5f5299f3355f77ee91875b400a0` 的源码树一致。

在当前既有 DSH GUI 更新插件：保留既有宿主和端口，备份原配置、浏览器产物与工作记录，再切换工作插件入口；没有重启宿主、没有手动改写 Task 或会话持久记录。实际激活目录为 `lib/continuation-217-d975e9c`，保留前一版本供回滚。安装包版本字段仍为原先的0.0.21，工作插件按合并构建目录叠加激活；部署身份以合并提交、文件散列及实际加载入口为准，未宣称已发布新的 npm 版本。

插件重新加载后，既有恢复机制自动补投原 `taken` 操作，随后通过 agent-browser CLI 在同一实例核验：

- Task 仍为 `d659d90c-6dfc-49a5-afe9-025c8d70e087`，epoch仍为2。
- operation仍为 `a5cdc0c0-750c-4527-9996-0f5cd8ab3067`；后继仍为 `session-ba1cd580-b994-4fca-aa9c-a762306bb7d7`，没有创建额外后继。
- 持久阶段达到 `delivered`，`kickoffDelivery=delivered`，原错误清除。
- 解码后继JSONL持久日志核实，消息 `continuation:a5cdc0c0-750c-4527-9996-0f5cd8ab3067` 恰好一条，包含原交接材料和完整规格路径；后继已有真实工具调用。私有材料正文不进入本报告。
- 原会话“进入当前处理会话”进入上述后继，页面已出现新助手回复及 `work_control` 等工具活动，后继继续执行原任务；本次修复验收不等于#137业务验收完成。
- 后继接续页显示“接续内容已投递”；浏览器实际请求的插件脚本包含新“重试内容投递／接续尚未完成”文案，确认使用修复客户端。
- 多次读取及页面刷新后，持久日志中kickoff仍恰好一条。丢回执后的重复恢复去重由真实宿主合同测试覆盖；没有通过在已完成操作上点击“准备接续”制造下一次交接。

初次页面断言假定单轮会话具有轮次导航且直接展示受管输入正文，断言失败。实际宿主将受管输入显示为折叠的“Execution requested”，原文的完整性以持久日志核实，页面验收改为检查真实助手回复和工具执行。另有其他活跃会话同时使用默认浏览器，因此最终截图与断言使用独立agent-browser会话，仍访问同一个既有GUI。

截图：

- [后继已有实际回复和工具执行](successor-recovered.png)
- [接续页确认内容已投递](continuation-delivered.png)

干净源码包验证亦已完成：`pnpm verify:pack-exports`从已提交HEAD导出、prepack构建，tarball含30个导出目标和177项，安装后14个Node入口全部可导入。首次安装临时包被workspace-write沙箱拦在pnpm缓存写入处，按工具要求原命令获得权限后重试通过，不把权限失败算成产品问题。

修复工作与自验已完成；Issue仍Open，最终关闭由LF完成。后继会话当前标题为Untitled，命名属于已有#211／PR #213，不纳入本次投递修复。
