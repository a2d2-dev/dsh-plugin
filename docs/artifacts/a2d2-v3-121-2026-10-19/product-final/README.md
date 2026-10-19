# #121 最终验收裁决

**通过，可由 CEO 关闭整票。** 同一产品包的真实 UI／HTTP／刷新证据，加上 R6 稳定 Origin 最后 gate，已经闭合本票验收。代码、工具和宿主没有由验收 lane 修改；本报告只提交证据与裁决，不执行外部 Issue 关闭或 PR 合并。

## 固定产物

| 对象 | 固定值 |
| --- | --- |
| 产品代码修复提交 | `433e9860ca76026a05d001c0552da0a4b45c84bf` |
| 产品 tgz SHA256 | `81466a33342c0256873bbf30dac693ee0cff2c075246a4ad859d94663ce0a82b` |
| 最后 gate 工具提交 | `56679a69286f473d786735576c81ffa3a61d4238` |
| 宿主源码 HEAD | `a45068d2ec03326c800c68c9bdcd47508e3ccb9c` |
| 宿主 CLI／Node | `0.2.0-rc.2`／`v22.23.1` |
| 实际前端版本 | `0.2.0-rc.2-4c24ce4`，宿主现有构建没有擅自更新 |

[稳定 Origin 工具／产物／宿主构建指纹](stable-origin/08-fixed-tool-package-host-hashes.json) 包含实际 CLI、LLM、controller、client-modules 的 SHA256。guard SHA `442573774fd2c16eb858af534230cbfb8f7029ff8d483085926b14531454e62d` 与 [真实正控](positive-guard/positive.json) 完全相同：gateway／adapter 各 `0→1`，唯一 `finish/error`，没有模型生成文本。

## 各 AC 闭合

| 规格条目 | 结论与证据 |
| --- | --- |
| AC1 原 DSH 保留、唯一入口、公开主内容与关闭回原会话 | 通过。[原生页面](attempt-dynamic-origin/04-native-unassociated-desktop.png)、[面板和返回筛选](attempt-dynamic-origin/31-return-list-desktop.png)、[完整导航 check](attempt-dynamic-origin/32-check-complete-navigation.json) |
| AC2 具体 Project、无“所有项目”、空态入口、选择不建会话不调用模型 | 通过。[无 Project 页面](attempt-dynamic-origin/06-empty-project-entry.png)、[当前 Project 过滤及无所有项目选项](attempt-dynamic-origin/18-project-b-filter-isolation.json)、[选择后的 Session 配置 check](attempt-dynamic-origin/14-check-two-projects-breakdown-child.json) |
| AC3 独立 Project／ProjectAgent／Task 与完整目标规格验收保存重载 | 通过。[UI 创建原文逐字相同](attempt-dynamic-origin/08-ui-create-exact-original.json)、[仅改目标保留其余正文与条目](attempt-dynamic-origin/10-ui-goal-only-exact.json)、[无改动重存原文](attempt-dynamic-origin/11-ui-unchanged-resave-exact.json)、[刷新](attempt-dynamic-origin/36-after-refresh-public-state.json)、[稳定真实重启完整域](stable-origin/13-stable-origin-gate-passed.json)。无 live Session 依赖由固定源码后端真实 SessionStore 自动接缝证据补充；浏览器公开 agentAvailable 不扩大为 SessionStore 对象计数 |
| AC4 真实命令、稳定 commandId／版本／权限、拆解与独立子 Task、同名不覆盖 | 通过。[实际 UI 活动](attempt-dynamic-origin/13-parent-activity-desktop.png)、[完整父子及同名身份与真实 HTTP 拒绝](attempt-dynamic-origin/15-two-projects-and-http-boundaries.json)。独立进程并发唯一性由固定源码自动 lane 覆盖，不称为浏览器压力测试 |
| AC5 四标签、仅当前 Project、返回保留 Project／视图／筛选 | 通过。[正确子详情及四标签 DOM](attempt-dynamic-origin/25-child-light-entry-correct-details.json)、[乙隔离](attempt-dynamic-origin/18-project-b-filter-isolation.json)、[返回状态](attempt-dynamic-origin/30-return-list-preserved-state.json)、[窄屏补充](attempt-dynamic-origin/29-narrow-child-detail.png) |
| AC6 已有兼容 Session 幂等关联、真实导航、不重配或启动 | 通过。[重复关联完整 Task 相同且版本 7 不增](attempt-dynamic-origin/20-association-idempotent.json)、[导航配置 check](attempt-dynamic-origin/27-check-r5-current-session-navigation.json)、[跨进程原有实际配置相同](stable-origin/12-strict-config-check-after-native-restore.json) |
| AC7 原生轻量入口返回正确 Project／Task、四标签与位置 | 通过。[blank 原生入口](attempt-dynamic-origin/21-blank-native-work-entry.png)、[当前已选同一 Session 新增子工作关联，不刷新／不切 Session即出现入口并返回正确子详情](attempt-dynamic-origin/26-r5-same-selected-session-verified.json)。未关联 Session 初始无入口、无必经步骤；非空分支由公开宿主产物渲染自动测试覆盖，没有为制造非空发送 prompt |
| AC8 统一公开查询、真实隔离宿主、双层 guard、零意外调用、刷新重启一致 | 通过。[稳定 Origin 总 gate](stable-origin/13-stable-origin-gate-passed.json)、[新 ready／同 URL／不同 PID](stable-origin/09-new-ready-same-origin.json)、[累计 metrics](stable-origin/metrics.jsonl) |
| AC9 新记录与旧 writer 边界、唯一旧地址映射、不复制活动旧任务自动启动 | 通过存储／契约边界验证。[公开唯一映射与 v3 独立路径](attempt-dynamic-origin/33-legacy-address-and-storage-isolation.json)，冲突原映射不变；固定源码自动 lane 覆盖映射原子唯一性。没有迁移或复制活动旧 Task，真实旧 writer 互操作未在本浏览器 lane 执行 |

## 最后稳定 Origin gate

[完整稳定 Origin 报告](stable-origin/README.md) 与 [13 总断言](stable-origin/13-stable-origin-gate-passed.json) 均通过：

- 首进程 job `bash-632`／PID `3441526`，重启 job `bash-639`／PID `3454422`；runId 不同，实际 baseURL 都是 `http://127.0.0.1:39683`。
- fresh root 两次正确 seed，公开 Workspace 成员及 cwd 校验通过。经 Task“打开会话”自然保存选择；没有直接写 localStorage／selection。
- 重启后先只读核对精确两个 ID 和完整公开领域数据，再通过真实轻入口／Task 导航恢复剩余原冷会话，读取实际配置。cwd、默认模型／模型投影、sandbox 与 approval 均完全相同。
- 同 root 的 current-run、baseline 和 append-only metrics 没有手工删除／重定或清零。两个进程累计 gateway=0、adapter=0；Session 生命周期恢复有 4 次出生事件，但只有原来的 2 个身份，无第三 ID。
- 两个 Web jobs 已停止并收集子进程 exit 0，专属 browser 已关闭。旧污染 root 与全部失败证据仍保留，没有操作 18780／18781 或现有用户 profile。

## 历史失败、诊断与测试归属

- [最初产品首轮](../product-first-pass/README.md) 保留原文丢失／原生入口缺失／旧 seed 缺挂的失败原貌；同一修复产品包已分别提供真实闭合证据。
- [动态 Origin 尝试](attempt-dynamic-origin/README.md) 仍为严格失败：每次 port 0 换 Origin触发宿主首用创建，使集合 2→3。R6 使用另一 fresh root，通过同实例稳定 Origin gate 闭合，没有重写该轮结论。
- [额外 0 Agent 诊断断言](stable-origin/14-extra-agent-availability-diagnostic.json) 退出 1，原因是保留浏览器自动重连并原生恢复原已选 Session，可用 Agent 实际为 1。这个额外假设不属于 AC；失败与解释都保留，不制造 0 Agent 状态迎合断言。最终所要求的 ID／域／实际配置／双层零调用断言均 exit 0。
- [本 worktree 测试模块缺依赖的 bootstrap exit 1](positive-guard/positive-tests.tap) 保留；本 lane 没有把默认未选或未执行用例称为通过。实际 guard 正控与真实 Web gate 为独立运行证据。
- CEO 固定源码验证归属见 [整合评审记录](../../../architecture/a2d2-v3-121-review.md)：产品全量 48 文件 696/696、typecheck、真实打包安装 13 Node 导出均 exit 0。R6 工具由 CEO 另行确认 28 项通过、2 个真实宿主项默认未选，exit 0；本浏览器 lane 未重新安装依赖或冒称自行重跑。

本次没有剩余未通过的验收 gate。产品与工具的自动验证、实际 UI／HTTP 证据和最后稳定 Origin 实测共同支持 #121 关闭；负责者可据此收口整票。
