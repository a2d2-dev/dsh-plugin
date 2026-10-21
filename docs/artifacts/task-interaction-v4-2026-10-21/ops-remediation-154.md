# #154 两项运维整改（离线，未部署）

固定接手 HEAD `6b2522189cc64ebdea608789949b3237aa4b1d29`，base `b477025116110f63d3488e0c71e47468ad882844`。唯一运维 review #151 后 CEO 裁决 O-F1/O-F2 均为“修”；不重开产品或 Host review。当前授权只有工具修复与 prepareOnly plan。

实际 dispatch 回执由 #150 主会话提供：`session-24baf38e-54c1-4d21-a4b1-6368112298f1`，`codex/gpt-6.1-sol`，`xhigh`，stage diagnosing-bugs 路由至 ceo。本次执行使用 diagnosing-bugs 与 TDD。

## O-F1

根因：旧 verifyLive 检查网络 origin/status/content-type 后只记录 raw SHA，没有将实际 JS 响应绑定 selected.clientSha256。磁盘正确不能排除 Host 缓存/路由送出旧内容。

正式 a450/8282 合同：末尾 sourceURL 后 sourceMappingURL 依次去除，必要时补换行，每个模块拼 `;\n`，最后附 combo source-map trailer。修复先将 selected raw client 校验为 plan SHA，再按此合同校验浏览器获取的 dsh-a2d2 singleton；按真实已加载 combo URI 顺序，用同页面 boot graph 的正式 singleton 响应重组整个 combo，要求内容逐字节一致。URI须严格是该 origin 的正式 client.js combo，目标模块唯一；不依赖页面文字或网络整体 raw SHA 等于磁盘 raw SHA。

红命令：`node --test scripts/v4-acceptance/verify-live.test.mjs`，旧校验入口实际报 `Missing expected exception`，1/1 fail、exit1。最小修复后同命令 1/1 pass，再补边界后 4/4 pass、exit0：new/rollback、Host trailer 变换、多模块顺序、旧 combo + 新 singleton、错 module、缺 module、跨 origin、HTTP失败和非JS。`node --check scripts/v4-acceptance/verify-live.mjs` 与 `git diff --check` exit0。

O-F1第一片 `493ab08` 已提交并推送，CEO复核要求再补实际加载响应，不能以刷新后二次fetch代替。最终路径使用独立run/side agent-browser session，在about:blank取得官方CDP endpoint；任何DSH页面加载前启用Network，clearBrowserCache、setCacheDisabled、setBypassServiceWorker均须实际ack。最终同URL document刷新后，仅收其frameId/loaderId的Script responseReceived→loadingFinished→getResponseBody，保存requestId与实际body至0600私有文件。二次Fetch只用于singleton重组，不进入loadedPayloads。来源、Script类型、document/request身份、禁缓存证明缺失，或cache/SW/prefetch来源均拒绝。

追加反例 `loaded旧响应不能被同URL refetch新响应掩盖` 先Missing expected exception、exit1；改用loadedPayloads后绿色。聚焦 `node --test scripts/v4-acceptance/browser-response.test.mjs scripts/v4-acceptance/verify-live.test.mjs` 最终7/7、exit0：真实离线Chrome/CDP Script旧体，后续Fetch新体不能替换；下一document换loaderId；新/rollback、多combo、cache/SW/Fetch/identity/HTTP错误均硬断言。真实离线proof另存 offline-cdp-proof-154.json，旧body SHA `003e38129f489134ab43807753b0f30e5e27f230845cf3875bd92cfa1a295b09`，新body SHA `d9ecfcf0870cdaea886760524d90af0120f5cc1e40b94144eb0e08bc14cef755`。

离线测试最初因Chrome给data:发requestServedFromCache=true而失败（exit1），独立诊断确认fromDiskCache/fromServiceWorker/fromPrefetchCache均false，随后对data:事实改为明确true断言；正式HTTP校验仍硬拒servedFromCache=true，没有放宽正式条件或预算。该fixture仅证明实际body/requestId/document与Fetch隔离，不满足HTTP live验收条件。已加载agent-browser skill并执行core/help，未访问18781/18782/第三方，未创建HTTP server、route/mock、live信号或模型。18782实际UI/HTTP cache控制与响应仍待授权后验证。

CEO集成核对发现live-cut仍只接受已审私有tmp证据根；撤回本轮无必要的持久evidence根许可，one-shot/prepare-plan两处validator恢复原合同，与0343129对应文件完全一致。工具/plan/profile仍在新的持久唯一run，raw evidence沿既有/tmp/a2d2-v4-唯一目录。首个候选preview-candidate-154-447e3ed-01（planSHA `6d8053e7cc763b22e7e8c156fbda5a72d05dd8cba3f78143c9dbb58a8e531e67`）仅保留历史原字节，已撤回，不得执行；修正提交clean后另生成全新run并复核dry-run。

## O-F2

根因：旧 launcher 将 CLI stdout/stderr 仅同步写入 web.private.log，Supervisor stdout 只有 stopped/code/signal。Cordis吞disposer错误并记录logger，且SIGTERM退出码0，故该私有日志必须纳入本次停机判断。

信号前从精确路径打开真实日志，绑定launcher持有的append fd、dev/inode、完整行offset及前缀SHA，保存绑定元数据；旧CLI/launcher均消失后读取同inode的本次窗口，并复核路径身份、前缀、大小和完整行。私有raw窗口0600保存，只对外提供分类/指纹/metadata；替换、截断、前缀改写、半行、超原1MiB窗口预算或不可归因均不能声称无错误。明确error/fatal/exception/failed与已知强退拒新。没有正式marker不会单独阻塞；正常/空窗口只证明未观察到已知错误，不推断graceful/flush。

`node --test scripts/v4-acceptance/stopped-cut.test.mjs`：CLI明确error但exit0且staticCut.ok反例先报Missing expected exception，2pass/1fail、exit1；最小判定修复后3/3、exit0。`node --test scripts/v4-acceptance/shutdown-log.test.mjs scripts/v4-acceptance/stopped-cut.test.mjs`：真实tmpfs文件、真实子进程stderr error+exit0、正常/空日志、历史error排除、inode替换仍保留原窗口、截断/长回/半行、缺证/强退/超预算、无append owner与停前半行，8/8、exit0。测试未对live发信号。

未知日志/明确错误作为exit证据传到verifyStopped；仍先执行无写FD、完整zstd、accepted-prefix与独立new/rollback native静态双读。只有staticCut.ok成立才可coherent rollback，保留所有新增数据；不直接throw跳过静态完整性，不以exit0放行。

## 权限记录

初始工具 schema 将 sandbox_permissions 标成必填；执行者误在多次普通工具调用中填写 danger-full-access，未申请更宽访问、未触发权限提示。未按要求省略该字段是执行流程偏差，保留记录，不把它当成部署授权。

工具全集 `node --test scripts/v4-acceptance/*.test.mjs`：27/27、fail0/skipped0、exit0，原始TAP保存ops-tool-tests-154.tap。全部.mjs语法、3个Python AST和git diff --check均exit0。所有离线browser test均finally close，session list未出现本任务专属session；未关闭任何他人session。
