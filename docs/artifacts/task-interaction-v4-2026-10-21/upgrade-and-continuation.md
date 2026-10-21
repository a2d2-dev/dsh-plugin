# 既有实例升级／回滚与服务外继续方案（仅准备）

## 当前裁决

本轮没有部署授权，不运行以下部署命令。示例计划保留 `prepareOnly: true`、未知 commit/制品/动作均为 null。默认 dry-run 必须失败并说明缺项。当前 dev CLI 入口缺失，完整回滚宿主、最终插件 tgz、host142 最终 commit、真实维护回执、最终动作脚本均未齐备；不能 stop 后再补。

升级顺序固定为既有 preview `dsh-a2d2-v3-preview` → 用户实际 GUI `dsh-dev-web-server`。实际 origin 分别保持 `http://10.126.126.12:18782` 与 `http://127.0.0.1:18781`；外部 mesh18780 对应后者，不另起替代服务器。无同 checkout dev:web watcher，不承诺 HMR。禁止操作生产 `dsh-web-server`、watch 或其他业务服务。

## 1. 制品与可执行回滚，必须在 stop 前完成

1. 在最终整合分支固定 plugin commit，记录 typecheck、针对回归、完整 build、pack 和实际导出检查的真实命令、退出码、日志摘要。tgz 放 commit 唯一路径，提取 `package/lib/client.js` 对照构建 client SHA。版本 0.0.1 或 npm rc2 不能代替指纹。
2. host142 基点为 `a45068d2ec03326c800c68c9bdcd47508e3ccb9c`，最终补丁在独立 worktree。实施者在自己的隔离路径构建完整宿主（CLI、包 lib、client emit 和 apps/web/dist），本验收工具只读，不替其 build。不在 `/data/src/github.com/deepseek-ai/deepseek-harness-dev` 写任何 lib/dist；两实例仍共用它。
3. 准备一套独立、完整、可执行的旧宿主回滚制品。当前 dev 路径缺 bin.js，不能作为 rollbackHostRoot；备份旧 Supervisor conf、package/lock/patch 也不能替代旧可执行依赖闭包。旧插件 tgz、旧安装依赖、host node_modules 的解析目标、web shell 和所有选中 profile 动态入口都要可读可导入。
4. 在新、旧独立宿主分别运行 `host-smoke.mjs ROOT /tmp/a2d2-v4-.../host-smoke.json`。命令仅 CLI --version 和真实 import，不启动 Web/模型。脚本覆盖 session、jobs-local、subagent、llm、session-controller、job-controller、client-modules 的实际解析路径，拒绝逃回共享 dev。新宿主还要求 `LocalJobRegistry.prototype.observe` 和 `Session.prototype.appendIgnorable`。这些 smoke **只覆盖列出的 seam**，完整 profile 中其他动态 import 与包导出、构建回归仍必须由最终集成记录证明，不能把少数 import 成功写成全闭包已验。
5. 填 release manifest 的固定 commit、独立 host roots、tgz/client/CLI/web/jobs/session 与两套 smoke 的绝对路径和 SHA。`fingerprint.mjs` 做无安装核验；旧 CLI 缺失或 smoke 未通过立即拒绝。最终 apply/verify hooks 必须先补完整 profile 动态导入证明，再在 review 后填入脚本绝对路径与 SHA；目前 hooks 为 null，runner 无法执行部署。

## 2. Preview 先指向隔离已构建宿主

不改变 preview 的 home/config/state/workspace/a2d2 与 Session 存储目录。不在共享 dev 就地构建。预备 launcher 完整候选文件，只把其 CLI 常量从共享 dev 改到已核验独立宿主的 `apps/cli/lib/bin.js`，保留原 Node、env 的私有凭据引用、`--trusted-host 10.126.126.12:18782`、内部127.0.0.1随机端口及原10.126.126.12:18782透明转发逻辑。候选与旧 launcher 的 SHA 进入审查清单，不公开凭据。

apply 动作须在指定服务已停止后：核对原 package/lock/launcher 指纹；仅把当前 profile 中 dsh-a2d2 的 dependency 切成已验 tgz；在该 profile 执行 `pnpm install --ignore-scripts --no-frozen-lockfile --config.auto-install-peers=false`；核对安装 client 与 tgz SHA；写入审查过的 launcher 候选。不要复用历史脚本的固定旧 hash，不启动新 server。预演安装到私有 staging profile，确认依赖和回滚依赖齐全后才允许 stop。

rollback 动作只恢复对应 profile 的 package/lock/patch、可用旧依赖与旧 launcher（其 CLI 必须指向独立可运行旧宿主）；不恢复旧 Session/Task 数据快照，不删除失败期间追加内容。数据 schema 不向后兼容时不切换，先补恢复路径。

## 3. 18781 自升级的受管继续机制

公开宿主接缝已核对：

- `ctx.agents.list()` / `get(id)`，`Agent.whenIdle()`，`Agent.runMaintenance()`。后者仅在 idle 可进入，并在回调未结束时扣留后续 wake；不能在自己的工具调用中 await 自己 idle。
- `ctx.sessions.list()` / `get(id)` / `flush(session)`；flush 必须真实返回 true，表示至少一个持久化监听器参与且全部成功。不能用 sleep 或文件存在冒充 flush。
- host142 `ctx.jobs.list(owner)` / `observe(jobId, exactOwner)`；观察不消费，完整比对 registryEpoch + instanceId + terminalResult。`collected` 仍不等于模型理解或业务验收。
- 当前旧 host 没有新 observe 回执。旧 registry 非空且缺可靠收取证据时标记 unknown，拒绝维护。不得清理 children/jobs 来伪造空闲，也不得解析输出文字猜消费。

维护 producer 的精确协议：在获授权的既有服务中通过正式插件/公开维护入口注册一次性维护操作，返回“已登记”后让发起会话结束本轮；producer 后台观察所有应保留的 live Session 和完整 children/catalog，等待 CEO 与 children 已结算、结果真实投递/收取。然后在同一事件循环内为全部 live Agent 取得 `runMaintenance` hold；任一 Agent 已运行、Session 集合变动、待收结果或新 inbox 输入则释放并报失败，绝不取消工作。所有 hold 保持到外部 controller 发出停止/撤销。对全部 live Session `await ctx.sessions.flush(session)` 且检查 true；在 hold 内复查 live集合、children、jobs和待输入，写入0700私有目录的真实维护回执。hold 有不超过60秒的租约；未被外部 stop 时到期释放并记录失败。要同时阻止新 Agent/Session 的 admission，不能只 hold 已有 Agent 后忽略新对象。

**维护 producer 与 admission fence 尚未在运行宿主装配／实测。** `one-shot.mjs` 仅消费该协议的真实回执，不能自行生成 true 值。现有 session/list 是只读观察，不是 flush API；不能用它冒充维护入口。最终实施者须确认可从宿主正式插件装配加载 producer、拒绝新会话 admission，并用无模型专用对象实证 hold/flush。若公开接缝不能封住新增 admission，则这是部署前置阻塞，不能降低门槛。当前本会话及父会话仍活跃，绝不会填“已结算”。

独立 controller 由已有 systemd 管理，运行于 Web 的 Supervisor 进程组之外。已只读核验 systemd 状态为 running；未运行以下命令：

```sh
# 仅在后续明确部署授权、脚本/制品审查和真实维护producer就绪之后，由系统管理器登记：
systemd-run --unit=a2d2-v4-141-RUN_ID --collect --property=Type=oneshot \
  --property=UMask=0077 --property=TimeoutStartSec=20min \
  --property=KillMode=control-group \
  --working-directory=/data/src/github.com/a2d2-dev/dsh-plugin.worktrees/v4-acceptance \
  /root/.nvm/versions/node/v22.23.1/bin/node \
  /data/src/github.com/a2d2-dev/dsh-plugin.worktrees/v4-acceptance/scripts/v4-acceptance/one-shot.mjs \
  /tmp/a2d2-v4-RUN_ID/plan.json --execute
```

这不是 nohup，也不是 DSH jobs 启动的后台进程。systemd unit 的 cgroup 名必须与 plan.runId 一致；runner 在执行前核验。登记本身是后续部署动作，本轮未登记。controller 不依赖被杀主会话等待恢复；用户关闭浏览器或 DSH Web 退出后仍由系统管理器执行。

runner 先验证固定制品与四个审查过的 action SHA、plan SHA绑定的后续直接部署授权、目标 PID、维护租约、Session完整集合、children结果文件SHA、jobs具名终态回执和零待输入，再 stop **唯一指定程序** → apply → start → verify。每步 fsync 写入私有 `one-shot.jsonl`，成功写 `completion.json`；失败尝试回滚并写 `rolled-back` 或 `failed-needs-external-recovery`。所有原数据目录保留。当前没有真实 action、授权或维护回执，dry-run拒绝是预期结果。

18781 的新 supervisor command 必须直接指向独立可用宿主或审查过的稳定 launcher，保留原 DSH_HOME/profile/port与秘密引用。不要修改其他 checkout 中现有 dev-environment launcher。若必须更换 Supervisor conf，须把准确候选配置和**仅该程序**的 reload/update 行为纳入最终 apply审查；目前 runner 的固定控制流程为 stop/start，不自动处理 conf变更。**若原 launcher没有可配置host路径，必须先补这一精确 apply动作和对应自动启动语义，当前不能执行18781切换。** 禁止全局 update 或操作 watch/生产服务。

四个 actions 是最终版本相关的窄脚本（本轮未填，不能伪装完成）：apply只处理指定profile/launcher和已审查的该program配置；verify通过真实agent-browser刷新同URL并查询实际版本/保留；rollback恢复独立可执行旧runtime而保留全部数据；rollbackVerify在同URL验证旧版本与保留。动作文件SHA、调用参数与真实输出共同审查，不能把全返回0的占位脚本填入清单。

## 4. 验证与接续，不伪造人类输入

verify 必须使用独立 `--session a2d2-v4-qa`，在同 origin 刷新，记录 desktop/narrow截图、资源请求中的真实client SHA、全局入口及公共域/Session查询；执行 retention，登记专用新对象，比较旧config/任务材料与历史前缀。完成报告注明尚未验证的真实模型lane。runner 的 `deployment-verified` 只表示该部署动作校验完成，不代表 #141 整票通过。

完成/失败回执落盘后，外部操作者可在原URL打开原Session只读历史；若需恢复模型协调，只通过正式DSH输入/任务通知能力，保存真实机器来源与requestId，目标为原Task有效当前Session。新宿主 `Session.appendIgnorable` 可写具名log-only journal，但不能伪造 `source.kind=user` 或假造已读/已消费。当前已知公开 `task.input` /正常通知需owner/epoch和delivery约束；正式通知适配器未装配，故默认以磁盘回执+同URL只读复查交付，不自动发消息。不能把“主会话工具等待自己重启完成”写进方案。

回滚触发：任一SHA/commit/动态导入不符、原URL或入口不可用、旧身份/config/材料丢失、意外模型/Session副作用、非专用写、接续围栏/决定/回执错误。回滚不能清空失败期间新增数据；外部同步未知先观察再补偿，不能重复本地工作。实际升级、重启、回滚演练和自动通知均未验证。
