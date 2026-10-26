# #252 原任务恢复与接续

## 目的与故障

用户报告已有任务切换失败，手工新建会话无法接管。原执行在宿主当前模型与启动快照不一致时进入 `incompatible-session`；接续页又会用每五秒返回的等值关联对象取消慢详情请求，持续显示读取中。旧版 `bind_main_session` 不会转移控制面板 TaskExecution 的协调权。

## 修复

- 已受管会话恢复读取宿主当前 provider、model、reasoning effort，并更新执行记录；首次接管仍严格匹配资源、preset、模型和权限。
- 最终回执验证并返回同一份捕获配置，保留项目模型策略；完整有效日志包含 fork 的继承模型。旧宿主的模型选择不共享维护锁，本补丁不承诺后续模型调用的原子策略校验。
- 接续详情依赖任务与执行的稳定身份，不再因等值关联更新取消未完成请求；真正切换身份仍取消旧读取。关联不变时使用“刷新观察”。
- 失败和创建中的执行显示原因，先重试原执行或等待创建就绪。#270/#275 将等待/暂停改为独立的“仅换会话”和“恢复处理”：前者保留完整 control 原因与恢复条件，提交 task.continue，不写 ready/resume；后者才明确恢复业务。恢复失败不描述为等待生效。
- #275 在原生接续组件交互边界先记录 waiting/paused 两项红灯（找不到“仅换会话”），同一回归随后两项通过；命令使用重新读取的 execution/owner/epoch，保持原控制。记录在本地忽略目录 `docs/artifacts/issue-270-2026-10-26/` 的 red-hold.log / green-hold.log；该组件合同证据不代表既有 GUI 已加载新包。

## #275 生命周期与接续状态

Issue 和原生接续页共用后端事实：会话运行来自对应 Session 观察，Task 控制来自 execution/control 与独立完成事实，当前协调只认 execution.session/epoch。操作中的原会话、固定后继与正式当前分别呈现；创建后继不授予协调权。

操作详情展示 collections 的准确执行者、作业、请求消费与核实收取；settlements 的父/子会话、结束序号及通知投递/消费；材料请求、保存命令与新鲜度依据；已核实 profile；旧 Goal activation、持久 phase/revision；投递及真实读取凭据。没有凭据即未确认；旧协议 delivered 明确保留历史投递语义。插件持续负责流程，正式接任前原会话只保留业务协调身份。步骤失败显示后端 code/message 与当时步骤，修复缺口后重试同 operation/successor。

运行中/停止中、已知结算 unknown、等待/暂停控制待生效、创建及失败均保留前提与恢复说明。终态 pending 结果允许请求插件补收，不在前端写 collected/ready/resume。组件事实回归 red-facts → green-facts 为 1 fail → 1 pass；围栏交互 red-fence → green-fence 为 3 fail → 5 pass（含仅换会话两项），均未扩大 timeout。

## 验证记录

- 初始真实宿主与组件回归 4 项稳定红；修复后绿，覆盖已选未请求、已请求、冷恢复与六秒详情/五秒关联轮询。
- 推理强度显式变化、宿主默认值、固定后继重试、历史会话权限和合法 fork 均有回归。
- 独立复核发现并修复“继承模型丢失”“校验后重新读未经检查模型”两项；独立小复现核实最终捕获前、捕获后、校验后发生选择变化的返回配置均经过检查，fork 原事件前缀保留。
- 最终 `TMPDIR=/tmp pnpm test`：116 文件、1321 项通过；类型检查、构建及仓库校验通过。
- 实验目的、步骤、记录及原始日志位于 `docs/artifacts/task-session-recovery-20261024/`，按仓库规则不提交运行产物。
- 干净提交 `95457b7` 的打包验证通过：32 个 export targets 完整，安装后 15 个 Node 入口可导入。最终提交 `bda0e99` 保留后续主干 #253/#254；Node 22、Node 24 和 secrets CI 均通过。
- 已在既有 GUI 应用 `bda0e99` 构建，通过宿主公开插件管理入口重新激活工作组件，未重启 DSH 服务。页面接续详情正常显示，真实 #2104 恢复到 `ready`，`resume/applied`，无 error，当前实际模型 `codex/gpt-6-astra/high`；“准备接续”已启用。
- TaskVersion 9、规格 v4、ExecutionId、原会话和 epoch 1 保持不变。现场证据 `live-recovery.json` 与 `original-task-ready.png` 位于上述证据目录；已回读截图。
- 真实业务会话没有自动交接或强绑到手工创建的会话：GUI 验收到恢复及可用接续入口，完整后继创建/接任/内容送达由真实宿主回归覆盖。用户可从原任务显式准备接续，不能把旧版绑定工具的拒绝当作已转移协调权。

关联：[#252](https://github.com/a2d2-dev/dsh-plugin/issues/252)，模型配置裁决见 [#250](https://github.com/a2d2-dev/dsh-plugin/issues/250)。本修复没有修改 DSH 本体或 Rise Global 业务代码，也不表示原业务任务已完成。
