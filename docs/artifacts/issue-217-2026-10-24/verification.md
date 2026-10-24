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

## 实例恢复验收

将已合并修复部署到当前既有 DSH 实例后，核对实际加载构建、从正式接续入口恢复原 `taken` 操作，确认：

- 仍是原 Task、epoch 2、原固定后继，未重新创建会话。
- 状态达到 `delivered`，错误清除，并有首条消息投递回执。
- 从原段进入后继，页面可见交接材料与后继执行，不再为空白。
- 重复恢复不会重复投递首条消息。

本节实例结果由部署后的实际证据补充；源码测试和构建不能替代页面验收。
