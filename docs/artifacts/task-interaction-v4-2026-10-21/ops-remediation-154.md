# #154 两项运维整改（离线，未部署）

固定接手 HEAD `6b2522189cc64ebdea608789949b3237aa4b1d29`，base `b477025116110f63d3488e0c71e47468ad882844`。唯一运维 review #151 后 CEO 裁决 O-F1/O-F2 均为“修”；不重开产品或 Host review。当前授权只有工具修复与 prepareOnly plan。

实际 dispatch 回执由 #150 主会话提供：`session-24baf38e-54c1-4d21-a4b1-6368112298f1`，`codex/gpt-6.1-sol`，`xhigh`，stage diagnosing-bugs 路由至 ceo。本次执行使用 diagnosing-bugs 与 TDD。

## O-F1

根因：旧 verifyLive 检查网络 origin/status/content-type 后只记录 raw SHA，没有将实际 JS 响应绑定 selected.clientSha256。磁盘正确不能排除 Host 缓存/路由送出旧内容。

正式 a450/8282 合同：末尾 sourceURL 后 sourceMappingURL 依次去除，必要时补换行，每个模块拼 `;\n`，最后附 combo source-map trailer。修复先将 selected raw client 校验为 plan SHA，再按此合同校验浏览器获取的 dsh-a2d2 singleton；按真实已加载 combo URI 顺序，用同页面 boot graph 的正式 singleton 响应重组整个 combo，要求内容逐字节一致。URI须严格是该 origin 的正式 client.js combo，目标模块唯一；不依赖页面文字或网络整体 raw SHA 等于磁盘 raw SHA。

红命令：`node --test scripts/v4-acceptance/verify-live.test.mjs`，旧校验入口实际报 `Missing expected exception`，1/1 fail、exit1。最小修复后同命令 1/1 pass，再补边界后 4/4 pass、exit0：new/rollback、Host trailer 变换、多模块顺序、旧 combo + 新 singleton、错 module、缺 module、跨 origin、HTTP失败和非JS。`node --check scripts/v4-acceptance/verify-live.mjs` 与 `git diff --check` exit0。

当前只做离线回归；18782 实际浏览器响应/UI 未验证，没有运行 agent-browser、模型或服务控制。网络取证沿用同URL刷新后浏览器 reload fetch；不是浏览器缓存原始响应体的 capture receipt。

## 权限记录

初始工具 schema 将 sandbox_permissions 标成必填；执行者误在若干普通工具调用中填写 danger-full-access，未申请更宽访问、未触发权限提示。后续使用包装调用省略该字段。此为执行流程偏差，保留记录，不把它当成部署授权。
