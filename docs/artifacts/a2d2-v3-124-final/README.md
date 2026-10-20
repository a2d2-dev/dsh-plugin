# #124 GitHub Issue 来源：18782 真实浏览器验收与保留部署

## 结果

CEO 开绿的唯一候选 `876758c8566e50c0db0df53e27ada46b8041c223` 已部署至既有 **http://10.126.126.12:18782/**。本次来源配置、真实读取、完整正文、显式接入、UI 防重复、四标签、既有 Session 关联与往返、缓存、真实只读错误、停用后本地保留、整页重载和恢复正常来源均通过。最终来源 **a2d2-dev/dsh-plugin 已启用**、身份 **imneov**，恢复到真实 #112 的可用来源详情，无可见错误。自有浏览器已关闭；preview 仍 RUNNING。

旧 **2 Projects、2 Agents、3 Tasks、9 receipts** 每条 ID/hash 原样保留；唯一旧 Session 的 **417 bytes 整文件 hash 相同**，没有追加，也没有新增 Session 文件/身份。模型 gateway/adapter 均 **0**。最终新增一个本地 Task、一个来源、一个 binding、对应 node/URL 唯一索引和五条本地命令回执。没有 GitHub 业务写操作、没有修改原 Task、没有恢复或删除用户数据。

本次验证的是 **用户 Project 1 中真实 Issue #112 的仓库来源接入**。UI 明示 GitHub Project 完整视图尚未提供；不声称 #125 Project views 或 #122 任务启动/执行/完成已实现。后端重复 import 幂等没有通过隐藏 API 在真实预览重跑；实际 UI 已将接入按钮替换为“打开已关联工作”，因此浏览器验证的是防重复入口和同 canonical 工作的重复访问。

## 实验目的、授权候选与部署边界

目的：在既有原生 HTTP 环境验证“GitHub 已有 Issue → 本地可持续工作”的实际产品路径，同时保留原工作与 Session。准备阶段结论见 [准备报告](../a2d2-v3-124-preparation/README.md)。本阶段开始首条命令实测指定目录、分支 `test/a2d2-v3-04-acceptance`、干净状态和 HEAD `48658d9fb9267f8ed870d92b7e1337954bddfddc` 均吻合。部署阶段已立即提交推送 `93552ee`，没有合并分支。

| 项目 | 实测值 |
| --- | --- |
| source commit | `876758c8566e50c0db0df53e27ada46b8041c223` |
| tgz SHA256 | `b7939639179faf84563a9d486ef768600e642e0722db22a1fb84fe9444c9bf5b` |
| 包内及 installed client SHA256 | `93baf01e6222cefc5710403f0c29e59ae9258d31fd3ca930b1c1e3a1a7476f61` |
| 初始 rollback 包 SHA256 | `3ba6225b0da7eb20f05724b4c686ba058d6f52d8e41bd98964ae566a10e22767` |
| Supervisor program | `dsh-a2d2-v3-preview` |
| 实际 HTTP URL | `http://10.126.126.12:18782/` |
| launcher / child PID | `149203` / `149210` |
| run ID | `8ff9ecbb-d772-42fc-9480-64f2ef7d6dd1` |
| restart startedAt | `2026-10-20T15:30:55.944Z` |

候选 tgz 仅从 CEO 指定的精确 artifact 路径读取，核验 SHA 后排他复制到 preview 唯一 `source124-876758c...` 版本目录。当前 manifest、lockfile、launcher、patch 的原 bytes/hash 备份均保留于同版本 rollback 目录，具体路径和 hash 见 [部署准备清单](./deployment-prepared.json)。安装使用 `--ignore-scripts --no-frozen-lockfile --config.auto-install-peers=false`，exit 0，详见 [安装清单](./deployment-installed.json) 与 [部署阶段记录](./deployment-stage.md)。

preview 仅改变 `dsh-a2d2` file dependency、对应 lockfile、launcher 的包 SHA 元数据和新增 `GH_CONFIG_DIR=/root/.config/gh`。保留原 `XDG_STATE_HOME`/state、home/workspace/store/HTTP relay/guard/patch。只重启上述 program 一次，没有触碰18780/18781、没有启动替代 server、没有改业务源码或其他 checkout。未部署被禁止的旧 ac/6587 候选。部署成功后未执行回滚；旧包/备份/失败证据全部保留。

未认证健康请求用 `curl --fail` 得到 HTTP401/exit22；[只读健康诊断](./http-health.json) 证实是正常登录 markup/认证边界，不当作服务启动失败。随后的浏览器复用原有有效认证，无需读取固定密码。本阶段没有读取、输出、写入证据或传入工具参数任何密码/token。

## 原生浏览器条件

已加载 agent-browser skill 和 CLI core。先核对旧 profile 无进程占用，复用 `/data/_dsh-dev/previews/a2d2-v3-121/browser-http132`、专属 session `a2d2-http132` 和原生 selection。没有直接读写 localStorage、没有移植选择状态。Chrome 150 真实原生能力见 [浏览器证据](./native-browser.json)：

- origin 为确切 `http://10.126.126.12:18782`。
- `isSecureContext=false`，`crypto.randomUUID` 为 `undefined`，`crypto.getRandomValues` 为 `function`。
- 没有添加 insecure-origin 例外或 disable-web-security flag；未覆盖 Crypto、未 mock API、未注入成功结果。
- 普通 HTTP 下 source.configure/source.import/Session 关联/停用启用五个真实 UI 命令均成功持久化；command IDs 均为 CSPRNG UUID v4。

本次没有另外重做 HTTP132 的独立本地 task.create/规格/分解全套流程；其原测试记录保留且可读。本次新来源工作流在原生缺 `randomUUID` 环境下实际写入成功，无该回归错误。

## 实际步骤与逐项结果

所有产品写入均由页面控件触发。[浏览器动作日志](./browser-actions.jsonl) 记录普通 CLI 动作和真实页面快照；[最终只读核验工具](./verify-final.mjs) 仅读取持久数据和 DOM，不写产品数据。

| 场景 | 实际动作与结果 | 证据 |
| --- | --- | --- |
| 旧工作可读 | 演示 Project 的原工作目标/规格/四标签/原Session关系可读；未修改原工作 | [旧详情](./01-old-task-detail.png)、[安装前基线](./before-retention.json) |
| 真实来源配置 | 在已有演示 Project 的 Issue tab 填 `a2d2-dev` / `dsh-plugin`，点击保存 | [我的Issue](./02-source-my-issues.png) |
| 身份与默认筛选 | UI显示 `imneov / LiuFeng`，真实select值 `@me`、open，列表有#124/#122/#112 | [默认列表快照](./02-source-my-issues.txt)、[动作中的DOM值](./browser-actions.jsonl) |
| 全部筛选 | 切全部负责人，再切全部状态，实际返回仓库Issue，PR被剔除 | [全部open](./03-all-open-issues.png)、[全部状态第一页](./04-all-state-page1.txt) |
| 分页/刷新 | 实际“下一页”进入第2页，#112在该页；真实刷新仍第2页；打开详情再返回恢复第2页及筛选 | [第二页](./05-all-state-page2.png)、[返回第2页](./07-return-page2.txt) |
| 完整真实#112 | 从真实列表打开详情；规范URL/nodeId一致；与当次服务器`gh GET`正文逐字相同 | [原文页面](./06-issue112-before-import.png)、[当次正文验证](./issue112-current-body-verification.json) |
| 浏览不建Task | 来源与缓存可落盘，但显式接入前Task仍3条、binding为0，原记录hash不变 | [浏览后保留](./browse-no-task-retention.json) |
| 显式接入 | 点击一次接入，接入回执返回canonical ref并正常导航；只有1个新Task/1个binding | [接入详情](./08-canonical-imported-task.png)、[接入后保留](./after-import-retention.json) |
| 四标签 | 实际查看概览/会话/相关工作/活动；原文未自动冒充结构化验收标准 | [概览](./08-canonical-imported-task.txt)、[会话](./10-associated-existing-session.png)、[相关工作](./11-related-tab.txt)、[活动](./12-activity-tab.txt) |
| 既有Session关联 | 新Task会话tab列出兼容原Session，选择“关联工作”后保存；未改原Task | [关联成功](./10-associated-existing-session.png)、[最终关联JSON](./final-verdict.json) |
| 原生Session往返 | 点击打开会话，宿主显示原Session及两个已关联工作入口；点击新工作入口回同Task，详情默认概览 | [原生Session](./13-native-existing-session.png)、[回到新工作](./14-return-from-native-session.png) |
| UI防重复 | 来源#112显示“打开已关联工作”，不再提供接入；点击后仍同canonical Task，Task数4，binding数1 | [缓存已绑定来源](./15-cached-bound-issue.txt)、[重复访问详情](./16-reopen-canonical-task.png)、[防重复后保留](./after-ui-dedup-retention.json) |
| 缓存可读 | 真正点击读取缓存详情，未丢正文/绑定；错误时仍显示最后已知第2页 | [缓存详情](./15-cached-bound-issue.txt)、[真实错误仍保留列表](./17-real-readonly-not-found.png) |
| 真实只读错误 | 用同正常来源打开不存在#999999，UI显示`github-not-found ... (404)`，work HTTP424；不是空列表，#112仍在缓存 | [错误截图](./17-real-readonly-not-found.png)、[动作中的alert/responseStatus](./browser-actions.jsonl) |
| 停用后本地保留 | 真正停用来源，刷新详情禁用，读取缓存和打开已关联工作仍可用；未清除Task/绑定/Session | [停用来源](./18-disabled-source-cache.txt)、[停用时本地工作](./19-local-task-while-source-disabled.txt) |
| 完整重载 | `reload`后通过原生Preview Notice Continue，从宿主工作入口重开；同本地规格/关联仍在，来源仍停用、缓存仍可读 | [重载后本地工作](./20-reloaded-local-task.png)、[重载后停用缓存](./21-disabled-cache-after-reload.txt) |
| 恢复正常终态 | 真正启用正常来源、刷新列表、重开#112；enabled=true、lastError为空、刷新/打开已关联工作可用，无alert | [最终来源](./22-final-enabled-source112.png)、[最终判据](./final-verdict.json) |

分页“上一页”按钮在第2页可用，但本次没有单独点击上一页；已实测的是下一页及详情返回恢复第2页。关闭浏览器前停留在正常#112来源详情；CLI `--full` 对宿主嵌套滚动容器仍只截到当前视口，[额外终态截图](./23-final-full-source112.png) 不冒称覆盖全文。完整4950 bytes正文由DOM和GitHub逐字核验及JSON留存证明。

## Canonical、本地原文和新增记录

- 原Project：`ec480d94-c5e8-44a0-80a0-897945df1a67`。
- 来源：`9cea4378-0219-4f99-a237-80f51bd36291`，最终version3、enabled=true、identity imneov、无lastError；4个缓存页、21个观察对象。
- 唯一新Task：`4c936541-0d4f-4bde-b810-bbfe946044da`，最终version2（接入v1＋关联Session v2）、specification version1。
- GitHub node：`I_kwDOUmfSE88AAAABXdRGDA`，URL `https://github.com/a2d2-dev/dsh-plugin/issues/112`；node和URL索引都指同canonical ref。
- 正文：4950 bytes，SHA256 `738f1dbe45c87fc7967fd1a6a49af39fe14cbce77cbc5c833e42a7dd560e0bed`。当次GitHub原文、来源DOM、binding.accepted、binding.lastObserved、Task规格逐字相同。结构化 `missing:['acceptance']` 表示待确认结构化标准，不表示原文缺验收段落。
- 关联：原 `session-f9282a68-4c3f-4251-adcb-bcd6f24d7515`，原runtime `c01a3a7b-6deb-4820-9896-548d14220162`，purpose related。

| 新增本地回执 | commandId |
| --- | --- |
| source.configure | `8d8e4d69-4bef-467f-84b4-584ffef4047c` |
| source.import（含canonical ref） | `4d805639-c502-41e9-a9bf-74786ec1238b` |
| task.associate-session | `6c31d7b1-8f38-4c54-ab09-92a9d2ca5af1` |
| source.set-enabled false | `5824a697-3ee7-4f71-89de-37729fed27f1` |
| source.set-enabled true | `b31a90c3-bbcd-45ec-ac8c-bb5d0025544c` |

最终2Project/2Agent/4Task/1Source/1Binding/14receipt，每个新增项均由上述真实UI动作解释；读取与错误请求不造Task/命令回执。没有创建故意404测试来源，故无需遗留或删除这种来源。

## 旧数据、Session与模型保留

[安装前基线](./before-retention.json) 包含旧2Project/2Agent/3Task/9receipt每条ID/JSON row hash及Session bytes/hash。首次重启 [立即比较](./after-restart-retention.json) 通过：旧JSON缺source字段仍可正常启动，未先迁移/造假数据。首次真实来源命令后正常新增顶层 `sources/externalBindings/externalIndex`，旧record hash仍保持；整个快照hash变化不冒称整JSON不变。

[最终保留](./final-retention.json) 和 [关闭浏览器后保留](./closed-browser-retention.json) 均exit0：旧记录逐row hash原样；guard/patch hash原样；唯一旧Session的417 bytes SHA `7cfd5a79aa74170a2fcb456e13d2fc21b5f88446f7b329da76406812ab6c8e27`及0-byte lock均不变；`addedSessionFiles=[]`，没有删除或替换任何记录。

不能单凭retention.checkPassed推断Session集合不变。因此另从真实guard核对当前run事件：PID149210在 `2026-10-20T15:32:26.818Z` 有一次 `session-born`，ID是**同一个原Session**，正对应初开旧profile；历史两次旧进程也对同ID记录此生命周期事件。当前新ID差集为空，Session文件集合相同。宿主重载后侧栏标题从Untitled变成New Session，并未产生新Session身份。完整事件及差集见 [最终判据JSON](./final-verdict.json)。不把生命周期事件计数谎报为0，也不把它误报为新用户Session。

历史及当前run模型gateway/adapter都为0，未发prompt、未点启动/续跑；未改guard来制造通过。浏览器关闭后preview仍RUNNING PID149203，无回滚、无用户数据快照恢复。

## 失败、根因与范围限制

[自动化尝试记录](./automation-attempts.json) 如实保留四类失败：

1. 未认证curl用`--fail`把正常401视作exit22，实际登录markup正常；原profile认证有效。
2. 首保存按钮中心落在577px视口外，工具返回Done但没有提交。首click `15:34:09.321Z` 至滚动重试前**无任何work请求**；重试click `15:35:26.191Z` 附近才出现configure/来源读取请求。原DOM、viewport和原生ResourceTiming见 [首次点击诊断](./first-configure-click-diagnosis.json)、[失败截图](./02a-configure-no-transition.png)。不是已保存后UI转换失败，未修改业务代码。
3. 打开原空Session成功后，等待Chat文字超时，实际原生页面是Describe what you want to build及关联工作入口。检查真实页面后正常返回，不注入导航结果。
4. 最终只读脚本初始错误要求当前run的session-born事件数为0而exit1。先读取真实metrics定位为同旧ID重开，再将判据修正为身份差集＋实际文件集合核对；未修改guard或数据。最终脚本exit0。

本次未做实时401/403/429/断网故障注入、未触发限流或更改凭据。真实错误覆盖为不存在Issue的GitHub404→work424；停用/缓存覆盖了不依赖新远端读取的本地续读。后端并发/重复命令幂等依赖此前产品测试与CEO裁决，本lane没有冒充重跑。#125真实Project视图、#122启动/执行均未验收为完成。

工具语法检查与`git diff --check` exit0。未为证据脚本虚构单元测试成绩。所有截图均来自该真实HTTP浏览器；重点原文、错误、Session关联、重载和最终来源截图已实际查看。没有token/password/browserprofile/私有宿主日志进入本worktree证据。
