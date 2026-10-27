# #141 现有 DSH 实例最终整合验收

## 目的与交付边界

原始工作为 [Issue #141](https://github.com/a2d2-dev/dsh-plugin/issues/141)，父项为 [#136](https://github.com/a2d2-dev/dsh-plugin/issues/136)。保留原规格 v2 的九条要求，整合来源、真实执行、接续、持续委托与完成补偿，在既有开发实例上验收。没有发布生产版本，没有创建替代服务器，没有修改 freeland 业务 Issue。

既有开发实例已更新至包含 [PR #318](https://github.com/a2d2-dev/dsh-plugin/pull/318) 的代码 `9916177a71027e1b0dca776fce1b95bb69a6f37e`，原入口为 <https://dsh.e5box.a2d2.dev/>。技术验收证据已齐；最终工作接受、Project 状态及本报告发布以原 Issue 的回填和实际 Task 完成回执为准。Issue 保持 Open，最终关闭由 LF 完成。

[完整中文目的／步骤／记录与精选证据](https://github.com/a2d2-dev/project/blob/2cdf2e0d55539934b6e418f214523d48374b88e7/dsh-plugin/docs/artifacts/v4-141-final-2026-10-27/public/report.md)保存本轮实际数据、截图及限制；[SHA256 清单](https://github.com/a2d2-dev/project/blob/2cdf2e0d55539934b6e418f214523d48374b88e7/dsh-plugin/docs/artifacts/v4-141-final-2026-10-27/public/manifest.json)可核对精选附件。原始 profile、凭据、完整原生 journal 与上下文快照不进入精选包。

## 前置接受与固定版本

四个实现票的接受事实已核实：#137 来源、#138 执行接续、#139 完成补偿及 #140 持续委托。#138／#140 仍 Open 属于人工关单状态，不能据此推断未验收；旧准备文档中“#140 未核得接受结果”的记录已被本次核实取代。

#140 按 LF 接受的 #265 口径验收：独立持续委托 Tab、Project 单队列、自然语言筛选及理由、保存排序与并发；历史计划接口和数据保留，不恢复已被替换的逐轮审批主界面。

- 初始冻结 `e0198e3`：完整 1523 项、类型、构建、实际包验证通过。
- 单轮 fresh 两轴审查的两项 P2 经 [PR #311](https://github.com/a2d2-dev/dsh-plugin/pull/311) 修复，最终 `5caa551` 的精确生产源码有 1543 项完整回归、131 项定向、类型和构建证据；实际包 32 导出／15 安装入口通过。
- 保留后续已合并 #314／#317。现场真实预览发现队列 Block 未进入旧规划输入，最小修复 [PR #318](https://github.com/a2d2-dev/dsh-plugin/pull/318) 已合并。新增 3 项、5 文件 157 项相关回归、类型检查通过；Node22／Node24／secrets 两组远端检查全部 SUCCESS。
- `9916177` 为合并代码基线；实际打包树 `8a2c4aaf` 的生产源码、package、lock 与其 diff0。相同生产源码的 clean HEAD `986e4d6` 经完整 prepack 构建、32 实际导出和安装后 15 Node 入口验证。[原始包验证日志](https://github.com/a2d2-dev/project/blob/2cdf2e0d55539934b6e418f214523d48374b88e7/dsh-plugin/docs/artifacts/v4-141-final-2026-10-27/public/pack-exports.log)保留结果，不将相互重叠的测试数量相加。

## 原九条验收对照

| 原验收标准 | 实际证据与裁决 |
| --- | --- |
| 1. 固定整合提交，typecheck、相关回归、完整构建与实际包导出通过；测试失败需核对环境和断言后如实裁决。 | 上述固定版本及检查通过。[构建与部署原件](https://github.com/a2d2-dev/project/blob/2cdf2e0d55539934b6e418f214523d48374b88e7/dsh-plugin/docs/artifacts/v4-141-final-2026-10-27/public/build-and-deployment.json)包含精确提交、制品 SHA 和 CI。普通 npm 依赖缺 `registry.observe` 的首次组合失败按环境裁决，随后正确匹配 Host8282 四包组合通过；没有放宽断言。 |
| 2. 更新既有开发实例，不启动替代服务器；记录实际插件链接、构建、supervisor与当前URL，验证刷新后版本。若无同checkout watcher不承诺HMR。 | 正式 CLI 更新原 profile，受管重启 `739598→999361` 成功；原 URL reload 后 boot `b8d6f31ecdde`、client `ab4df1f4b690`，新包后台实际生成的 basis 已含原 Block。Host checkout 与原3080保持，异 checkout watcher 不承诺 HMR。 |
| 3. 保留原Project／Task／来源／会话／权限，升级前后逐项核对；构建／启动失败有可执行回滚。 | [逐项保全记录](https://github.com/a2d2-dev/project/blob/2cdf2e0d55539934b6e418f214523d48374b88e7/dsh-plugin/docs/artifacts/v4-141-final-2026-10-27/public/data-preservation.json)：4 个旧 Project／49 个旧 Task 全在，最终总数58；原规格／完成事实保留，合法新规格的原版本完整存在历史，正式交接和当前有效权限有依据。1544 原生 journal 中1531字节一致、13原解压前缀保留；可执行退包 verify-only 通过，只退回当前315包，不旧库覆盖新数据。 |
| 4. agent-browser验证Project／Repo来源、真实视图／Issue／PR、跨来源复用、独立子Issue和统一执行、后台job、待确认及历史。 | 实测 Project 两视图、搜索、Merged94／Closed19逐行筛选、两来源同#141入口、#157完整原生子项及独立#158执行、真实 job313 待交付与交付、暂停／需人工处理／历史；#138实际只读历史与往返原件复用。[页面记录](https://github.com/a2d2-dev/project/blob/2cdf2e0d55539934b6e418f214523d48374b88e7/dsh-plugin/docs/artifacts/v4-141-final-2026-10-27/public/report.md#页面与真实执行)区分完整详情和扫描中的缓存提示。 |
| 5. 真实模型证明具体决定跨接续保留、后继正式接任入口正确、原段不能继续协调；失败和待收结果恢复有证据。 | 复用#138真实模型具体决定与权限故障恢复，补当前#141真实 codex/sol/high 新协议 received、固定后继、原段退休和 Goal disarmed。旧 epoch 写实测 HTTP400／stale-execution-authority，当前身份及控制不变。准确 owner 正式 job_output 有 collected 和成功结果，页面 pending→delivered；自动补收／flush／新鲜材料另由匹配 Host 组合验证。见[接任和作业](https://github.com/a2d2-dev/project/blob/2cdf2e0d55539934b6e418f214523d48374b88e7/dsh-plugin/docs/artifacts/v4-141-final-2026-10-27/public/handoff-and-job.json)、[原生成功回执](https://github.com/a2d2-dev/project/blob/2cdf2e0d55539934b6e418f214523d48374b88e7/dsh-plugin/docs/artifacts/v4-141-final-2026-10-27/public/native-receipts.json)、[旧写拒绝](https://github.com/a2d2-dev/project/blob/2cdf2e0d55539934b6e418f214523d48374b88e7/dsh-plugin/docs/artifacts/v4-141-final-2026-10-27/public/retired-fence.json)。不同场景和证据层不冒称同一供应商整链。 |
| 6. 真实模型生成自然语言计划，预览零执行，Block／暂停边界、两项串行与浏览器关闭／重启后恢复有证据。 | 修复后原实例真实中文预览成功，Block C完全不入步骤，A/B只解释保留完成事实；7 Task／6执行／全部Session引用、规格／完成／事件、候选集合、槽位和规则字段前后完全同，旧计划 SHA 保持，队列始终暂停。原#140真实A/B串行、Block／暂停、浏览器重开和服务重启身份保全已核。[完整预览差分](https://github.com/a2d2-dev/project/blob/2cdf2e0d55539934b6e418f214523d48374b88e7/dsh-plugin/docs/artifacts/v4-141-final-2026-10-27/public/preview-zero-execution.json)、[串行与恢复](https://github.com/a2d2-dev/project/blob/2cdf2e0d55539934b6e418f214523d48374b88e7/dsh-plugin/docs/artifacts/v4-141-final-2026-10-27/public/continuous-serial-and-restart.json)。 |
| 7. 专用对象证明本地验收及远端关闭补偿；不改变 freeland 业务Issue。 | 只使用专用#307／#308／#310。真实模型本地验收→UI补同步真实关闭、真实版本冲突→独立关闭后的补观察；真实 mutation 成功丢一次回执→unknown跨app／冷Node→正式sync观察Closed，mutation恰1次。journal计数和proof保持、无业务重跑；确定性Host传输集成与GUI／真实模型明确分层。[完成补偿记录](https://github.com/a2d2-dev/project/blob/2cdf2e0d55539934b6e418f214523d48374b88e7/dsh-plugin/docs/artifacts/v4-141-final-2026-10-27/public/completion-compensation.json)。 |
| 8. 桌面与窄屏截图和中文目的／步骤／记录报告落docs/artifacts，未验证与产品限制明确记录。 | 精选证据包包含17张精选截图，覆盖当前持续委托、独立执行、旧段、失败入口、补偿及来源列表；390px document/body均390。中文报告列明目的、步骤、记录、失败裁决及限制。 |
| 9. 一轮fresh安全评审整改闭合，PR与tracker状态和实际验收一致；未合并不写已上线，未验收不关闭。 | 单轮 Standards／Spec 两轴各自记录，原P2通过PR311闭合；新增真实Block缺口由主会话直接读源码／红绿并经PR318修复，不再开fresh轮。原Issue接受证据、文档PR合并、Project／Task最终接受按实际顺序回填，Issue留Open。没有将开发实例更新写成生产上线。 |

## 实例、制品与保全步骤

实际 profile 指向 `file:/data/_dsh-builds/releases/v4-141-preview-block-9916177/a2d2-dsh-a2d2-0.0.23.tgz`，制品 SHA256 为 `fb8be11b61784056687cee44060ae9ab29f9081350079e9b4e75d371593e44c2`。实际插件入口继续按包名／导出路径挂载；client 文件 SHA256 为 `f78329bac820fe51b6efc59ded91051570e2e30af853c4b004912a95fefcae73`。

正式服务仍是 `dsh-web-server`，Host cwd 为既有 `v4-141-release-8282d612`。仅更新 A2D2 package URL，其他依赖、bundles 与挂载 patch 逐字节相同，LF 新增的 standard-custom-preset 保留。新重启 operation `f9eb2432-2aad-4435-84ee-78ba18c15eb7` 于 `2026-10-27T17:41:55.399951Z` 成功；没有重复旧重启请求。Supervisor 一次性执行器 EXITED 是预期结束，组合状态命令退出3未当成服务失败。

升级前保存原Project／Task／来源／Session／owner／epoch／有效权限，升级后逐项断言。合法的新规格和交接通过历史、固定操作与读取凭据核实，不盲目将新版本或新增工作算成丢失。私有原件和1544份原生记录全量副本只用于保全。回滚脚本先校验旧315包 SHA，再通过正式CLI退包和独立重启，不恢复任何旧工作或会话库。

## 现场缺口与修复闭环

暂停队列原有 `rule.blocks=[C]`，保存历史预览指令时新建的 `planning.blocks=[]`；旧 `planningBasis` 只读后者，真实模型因此误称没有 Block。首次现场三步均为 wait，零执行成立，但限制输入和响应校验存在实缺口，未按“演示没有启动”放过。

先写真实 `WorkApplication` configure→Block→instruct→preview 回归：new／existing 两分支在修复前均红，basis为空且错误接受计划。修复每次构造 basis 时复用现有 `continuousBlocks(rule)`，统一 queue 与 legacy 名单；混合旧记录恢复也覆盖，原话、补充、旧计划和原名单保留。修复后3项新增／157项相关及类型通过。主会话已读生产源码、测试和原始红绿，PR318两组CI全绿、已合并、原实例安装与受管重启成功。

最终真实预览于 `2026-10-27T17:45:03.809Z` 开始、`17:48:54.478Z` 完成。生产返回两项中文 why／nextAction，C在basis Block中且不在steps；A/B只保留既有完成／暂停。前后工作对象和历史计划严格不变，既有独立队列仍为0/1占用、历史2、需人工处理1。

## 证据边界与产品限制

- 旧#138接续 `delivered` 沿用旧协议，不伪造读取确认；当前#141 `received` 有准确成功工具结果。旧段不能协调指Task写权限，原生人工聊天仍保留。
- 当前真实job补收与received分别取证；自动补收／flush／新鲜材料是匹配生产Host组合。returned native child退役后LocalJobs注册表不可达的能力负例没有冒充可补收正例。
- planner调用来自生产LLM适配且保留完整中文返回；目前没有独立辅助调用的route／usage公开trace。不挪用Task A/B usage，不把配置header数当网络请求总数。
- 当前v4完成协议是本地验收与独立远端关闭补偿。ADR主存自动发布仍是迁移目标，本轮未扩写迁移，也未宣称该能力已经实现；本票自身先将证据发布回原Issue再接受完成。
- Source扫描中的部分缓存与PR引用边界在界面如实展示。历史model／basis／版本冲突、环境依赖与错误采集路径均保留，不将重试后的局部成功改写为历史全绿。
- 本轮曾误带已被LF禁止的工具 `sandbox_permissions` 字段，没有产生审批提示；一次委派依赖日志短暂在树外，已移回独立树。该执行偏差如实记录，不宣称全过程完全符合字段和写入范围要求。

原Issue的关闭与工作验收分别管理；最终状态请查看[原Issue及Project](https://github.com/a2d2-dev/dsh-plugin/issues/141)。

验收附件按源仓 `verify:repository` 规则保存在私有资料仓，已通过 [资料 PR #5](https://github.com/a2d2-dev/project/pull/5) 合并；以上引用固定到该合并提交。最初源仓附件提交被原有校验拒绝，已纠正存放位置，没有修改排除规则或弱化检查。
