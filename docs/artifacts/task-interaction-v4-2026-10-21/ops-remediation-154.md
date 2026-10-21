# #154 两项运维整改（离线，未部署）

固定接手 HEAD `6b2522189cc64ebdea608789949b3237aa4b1d29`，base `b477025116110f63d3488e0c71e47468ad882844`。唯一运维 review #151 后 CEO 裁决 O-F1/O-F2 均为“修”；不重开产品或 Host review。当前授权只有工具修复与 prepareOnly plan。

实际 dispatch 回执由 #150 主会话提供：`session-24baf38e-54c1-4d21-a4b1-6368112298f1`，`codex/gpt-6.1-sol`，`xhigh`，stage diagnosing-bugs 路由至 ceo。本次执行使用 diagnosing-bugs 与 TDD。

## O-F1

根因：旧 verifyLive 检查网络 origin/status/content-type 后只记录 raw SHA，没有将实际 JS 响应绑定 selected.clientSha256。磁盘正确不能排除 Host 缓存/路由送出旧内容。

正式 a450/8282 合同：末尾 sourceURL 后 sourceMappingURL 依次去除，必要时补换行，每个模块拼 `;\n`，最后附 combo source-map trailer。修复先将 selected raw client 校验为 plan SHA，再按此合同校验浏览器获取的 dsh-a2d2 singleton；按真实已加载 combo URI 顺序，用同页面 boot graph 的正式 singleton 响应重组整个 combo，要求内容逐字节一致。URI须严格是该 origin 的正式 client.js combo，目标模块唯一；不依赖页面文字或网络整体 raw SHA 等于磁盘 raw SHA。

红命令：`node --test scripts/v4-acceptance/verify-live.test.mjs`，旧校验入口实际报 `Missing expected exception`，1/1 fail、exit1。最小修复后同命令 1/1 pass，再补边界后 4/4 pass、exit0：new/rollback、Host trailer 变换、多模块顺序、旧 combo + 新 singleton、错 module、缺 module、跨 origin、HTTP失败和非JS。`node --check scripts/v4-acceptance/verify-live.mjs` 与 `git diff --check` exit0。

当前只做离线回归；18782 实际浏览器响应/UI 未验证，没有运行 agent-browser、模型或服务控制。网络取证沿用同URL刷新后浏览器 reload fetch；不是浏览器缓存原始响应体的 capture receipt。

## O-F2

根因：旧 launcher 将 CLI stdout/stderr 仅同步写入 web.private.log，Supervisor stdout 只有 stopped/code/signal。Cordis吞disposer错误并记录logger，且SIGTERM退出码0，故该私有日志必须纳入本次停机判断。

信号前从精确路径打开真实日志，绑定launcher持有的append fd、dev/inode、完整行offset及前缀SHA，保存绑定元数据；旧CLI/launcher均消失后读取同inode的本次窗口，并复核路径身份、前缀、大小和完整行。私有raw窗口0600保存，只对外提供分类/指纹/metadata；替换、截断、前缀改写、半行、超原1MiB窗口预算或不可归因均不能声称无错误。明确error/fatal/exception/failed与已知强退拒新。没有正式marker不会单独阻塞；正常/空窗口只证明未观察到已知错误，不推断graceful/flush。

`node --test scripts/v4-acceptance/stopped-cut.test.mjs`：CLI明确error但exit0且staticCut.ok反例先报Missing expected exception，2pass/1fail、exit1；最小判定修复后3/3、exit0。`node --test scripts/v4-acceptance/shutdown-log.test.mjs scripts/v4-acceptance/stopped-cut.test.mjs`：真实tmpfs文件、真实子进程stderr error+exit0、正常/空日志、历史error排除、inode替换仍保留原窗口、截断/长回/半行、缺证/强退/超预算、无append owner与停前半行，8/8、exit0。测试未对live发信号。

未知日志/明确错误作为exit证据传到verifyStopped；仍先执行无写FD、完整zstd、accepted-prefix与独立new/rollback native静态双读。只有staticCut.ok成立才可coherent rollback，保留所有新增数据；不直接throw跳过静态完整性，不以exit0放行。

## 权限记录

初始工具 schema 将 sandbox_permissions 标成必填；执行者误在若干普通工具调用中填写 danger-full-access，未申请更宽访问、未触发权限提示。后续使用包装调用省略该字段。此为执行流程偏差，保留记录，不把它当成部署授权。
