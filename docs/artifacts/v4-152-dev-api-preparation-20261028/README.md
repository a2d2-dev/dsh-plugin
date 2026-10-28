# #152 新开发实例验收准备核对

日期：2026-10-28（Asia/Shanghai）。入口：https://dsh-dev.e5box.a2d2.dev/。

## 目的和本轮边界

按 LF 明确指令，在迁移后的开发实例核对规则、来源、隔离资源和公开 API 接缝，形成剩余场景的执行准备。原功能标准继续保留。本轮只读准备；不创建／重开 fixture，不注册 workspace／Project／来源，不启动应用模型、preview、Task 或规则，不修改已有队列、服务或 profile。登录仅使用本机已有凭据，口令与 Cookie 不进入证据。

## 当前实例与公开接缝

- Supervisor：`dsh-plugin-dev-server`；独立 `DSH_HOME=/data/_ssd2t/dsh-plugin-dev/home`。启动器为 `/data/_ssd2t/dsh-plugin-dev/launch.py`，固定宿主 checkout `plugin-dev-8282d612`，开发域名映射内部 3081。
- web profile 安装 `@a2d2/dsh-a2d2` **0.0.23**，来源为独立安装包；与旧 18782 验收构建不同。本轮未安装或重建。
- 正式工作接口仍为 `POST /a2d2/api/work`，只读 envelope 为 `{kind:"query", value:{type:...}}`。已读当前安装版 schema 与实现，并通过实际查询核实，不将 HTTP 查询替代页面验收。
- 本轮实际查询：`work.capabilities`、`projects.list`、`resources.list`、`source.list`、`continuous.status`、`source.execution-options`、`github.account`。均返回 completed；主查询脚本 exit 0。没有发送 command 或 `refresh:true`。
- capabilities 返回 `githubRead=true`、`githubWrite=false`、`taskStart=true`、`projectViews=true`。安装版同时存在 completion outbox 与 CloseIssue mutation 路径；静态 capabilities 的 githubWrite=false 不能单独证明关闭能力可用或不可用，真正写回仍由正式专用场景验证。
- 应用自身 GitHub 身份为 `imneov`，状态 connected／idle。此结果来自应用查询，不以宿主 gh 身份代替。GitHub 仓库当前 public，与 LF 本轮决定一致。

## 来源、规则与资源快照

仅有一个本地 Project：`DSH A²D²`，ID `0c2c6a94-e9fd-45bd-9306-822afa968ea7`。

当前 Project 来源为 GitHub `a2d2-dev` 组织 Project 1：source ID `078c27c4-547d-42c8-8d09-9f04a879d50d`。当前列表未提供专用 Repo 来源；旧来源 IDs 不迁作新实例身份。

| 当前资源 | workspaceId | 归属 |
| --- | --- | --- |
| a2d2-dev | `82d84423-4f19-41d4-807e-9fd32eef43bf` | 已属于当前业务 Project |
| workspace | `018325a1-6b06-4a50-b6ea-d6ece5d7f45b` | 未分配 |

两者 runtimeId 均为 `46c056ed-34b4-4ca5-9ef5-cd22e543466e`。原验收资源 `b2c6edcf-bb21-4925-8ccd-6b0e503de5dc`／旧 runtime 不在当前 resources.list 中。

已存在并启用的规则：

- rule ID `5882f181-f70c-4fa0-815c-97968b795b95`，version 3；source 为上述 Project 来源。
- scope：所有负责人 `*`，硬标签 `ready-for-agent`。
- concurrency 1、refreshMinutes 30、oldest；当前 active／slot 是本任务 #152（Task `8ebd9fc8-05a1-454b-b68d-10b9d413b42e`）。
- 使用业务资源 a2d2-dev；model `codex/gpt-6.1-sol`、preset standard、权限 danger-full-access。没有据此改动用户规则或本次 QA 权限。
- 当前实现按本地 Project 取得规则，不能把同一 Project 下新增 source 当作独立验收队列。后续实际运行应建立 nonce 专用本地 Project、workspace 与资源，避免改写该业务规则；外部来源仍可指向自有 GitHub Project 1。

## 六个历史 fixture 的只读核对

本轮直接向 GitHub 查询真实 nodeId／标签／assignee／原生关系，命令 exit 0。

| fixture | Issue | 当前状态 | 标签范围 |
| --- | --- | --- | --- |
| P | #157 | Open | run |
| C | #158 | Open | run |
| E | #159 | Closed | run |
| A | #160 | Closed | run + serial + touch |
| B | #161 | Closed | run + serial |
| X | #162 | Open | run + serial |

run=`qa:v4-152-6b252218-r01`；serial 为 run 加 `-serial`，touch 为 run 加 `-touch`。全部 assign `imneov`。P 的真实原生子仍为 C／E。所有 fixture 均无 `ready-for-agent`，与当前规则硬标签不相交；真实创建前还须临查规则，不能把本次快照当永久保证。

旧 fixture 的身份与 proof 不改写。A／B 的历史正常关闭不能当作关闭冲突补偿实证；其既有完成不能靠重开和重跑伪装成新一轮通过。

## 模型与 native／job 准备

`source.execution-options` 实测可用模型共 61 项，包含 `codex/gpt-6.1-sol`；agent presets 为 standard、standard-custom、ptc、minimal、cordis；权限选项为 read-only、workspace-write、danger-full-access。默认 standard／workspace-write／codex gpt-6.1-sol。

候选与默认值只证明可配置，不能证明真实 provider／model／reasoning 或 medium 调用已经发生。正式阶段需对 Task、native child 和 planner 分别收取 request/header/runtime trace、requestId／usage；明确记录实际 reasoning，不静默换组。

已读当前安装版 `work-plugin.js`：工作工具及正式 job receipt 在宿主 tools 注入时安装；当前 native-child owner／等待验证存在。但本轮不启动校验 child 或 job，不声称已验证它们的运行、结果待收、正式 job_output 收取或过早 done 拒绝。

正式 native 入口已具名定位到实际宿主 `packages/subagent/tool-subagent/src/index.ts:478–536`：工具依据父 agent／配置解析请求，再通过 `runtimeCtx.subagents.startContinuable({provider,request,signal})` 发起，`request.agentOptions` 可以承载 provider／model／reasoningEffort；动态模型参数仅在 modelSelectionEnabled 时暴露。本会话实际工具 schema 未暴露这些参数，不能在 prompt 声称 medium 就算完成指定路由。正式阶段须使用该执行会话允许的配置／公开 SDK 能力并核对真实 trace，不改用户全局路由来冒充。

当前安装版 `host-CARw9kKP.js:17–81` 的正式 job 收取回执要求：由真实 owner 直接调用公开 `job_output`、终态结果非空、真实 tool/call 与持久 tool/result 精确配对后追加版本2回执。重复读空结果、PTC／间接读取不补造交付事实；正式 checksum job 需产生非空可核验输出并直接收取。上述仅为已核对机制，运行收取门仍待实际阶段验证。

## 剩余执行准备与证据方案

1. 实际阶段前临查旧规则、source 与资源、GitHub fixture 状态。先锁定独立 QA writer 与写树；配置 nonce 本地 Project／workspace／资源，关联自有 Repo 和 GitHub Project 1 双来源。所有真实资源、来源、Task 和 Session ID 只用正式创建回执填账。
2. P／C／E：保留历史资料；独立 C 按真实 canonical Task 验收，P 正式采纳必要子范围与 E 的 proof／checksum／updatedAt。测试 P 未验收必要子结果时的 done 拒绝，不以 E Closed 当父通过。
3. native child／job：由真实 P owner 发起专用只读校验 child 和 checksum job，记录 owner、running、terminal 待收；先验证早 done 拒绝且仍能收取，再用正式 job_output 收取及当前 owner 再次报告。
4. 关闭冲突与新实例串行：旧 A／B 已关闭。如需新的正常关闭与冲突闭环，准备独立新 run 的 A／B／X 专用对象及精确正文，正式阶段才创建；其 node allow-list 必须来自真实回执，不能沿用或编造旧 ID。新 fixture 不带 ready-for-agent，只使用专用 run／serial／touch 标签。
5. 输入／分页／空态／移动端：在当前域名由独立执行者采集桌面1440×1000与390×844，覆盖实际页面及 API 对应身份；不得以只读准备截图当作全部功能验收。
6. 数据保留：以新实例当次基线与本 run ledger 核对新增集合；原78 GUI／3 preview Session／旧64域及旧地址继续保留其历史核对证据。独立新 home 不意味着这些旧数据已自动迁入；不导入生产库或用旧快照覆盖新增输入。

准备阶段完成条件是实际环境、旧规则隔离条件、资源缺项、接缝与证据方案均有记录；全流程完成仍要求真实功能和交付验收。正式执行继续遵守源 Issue 已接受的精确阶段指令和独立执行者边界。

## 证据索引

- 现行脚本：`docs/specs/v4-live-acceptance-script.md`，文档提交 `2097a91`。
- 准备方案：`docs/specs/v4-instance-delivery-150-qa-plan.md`，文档提交 `90fb062`。
- 当前安装产物：`home/profiles/web/node_modules/@a2d2/dsh-a2d2/package.json`、`lib/dao-D5ijQ1zn.js`、`lib/work-CBGmeTVw.js`、`lib/work-plugin.js`；仅引用版本／入口和必要代码行为，不提交安装产物。
- 独立页面取证在相邻目录 `v4-152-dev-readiness-20261028/`，由独立执行者写入和复核；以其报告明确的实际结果为准。
