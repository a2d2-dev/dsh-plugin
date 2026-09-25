# A2D2 下一步公路图 GUI 验收报告

验收日期：2026-09-25  
验收对象：父 spec #8 下 #9-#15 已合并功能  
验收环境：DSH 验收实例 `http://127.0.0.1:3181/`，DSH_HOME=`/root/.dsh-a2d2-accept`，插件工作树 `/data/src/github.com/a2d2-dev/dsh-plugin-wt/acceptance`。  
说明：先尝试 `http://10.126.126.12:3181/`，目录选择器报 `crypto.randomUUID is not a function` 导致无法添加工作区；按任务说明切换到同一实例的 `127.0.0.1:3181` 继续。未操作 `127.0.0.1:3080`，未启动/重启/杀 DSH 进程，未修改 `src/`。

## 总览

| 用例 | 覆盖工单 | 结论 |
|---|---|---|
| 1 | #9/#10/#12 | 通过 |
| 2 | #12 | 通过 |
| 3 | #11/#9 | 不通过 |
| 4 | #13 | 未验证 |
| 5 | #14 | 未验证 |
| 6 | #15 | 未验证 |

## 用例 1：下一步入口与公路图卡片

目的：验证已配置项目中球 hover 只有「下一步」，点击后卡片按 #8/#9/#10/#12 要求渲染。

步骤：
1. GUI 添加已配置工作区 `/data/src/github.com/a2d2-dev/dsh-plugin-wt/acceptance`。
2. 新建会话，发送「我们来 grill 一下给 README 加一个 FAQ 小节的想法」。
3. 等待 agent 回复结束，hover 指示球，点击「下一步」。

记录：
- 截图：`01-hover-next-only.png`、`02-next-card-loading-or-result.png`、`03-next-card-result.png`、`03-next-card-result-full.png`
- 渲染文字摘录：hover 后只有「下一步：它现在在干嘛、做到哪了、接下来去哪？」。
- 卡片先显示「空闲，等你输入」「上下文 27K / 1M（3%）」「正在咨询下一步…」。
- 咨询完成后显示主干 5 站：`/grill`、`/to-spec`、`/to-tickets`、`/implement`、`/code-review`；每站有职责和模型标签。
- 下一站行显示「本阶段未完成 · 继续」。
- 芯片显示「继续 按推荐回答继续 grill 切到 claude-fable-5-1」「子代理 先收集真实问题来源」等。
- 卡底显示「由 claude-fable-5-1 生成」。

结论：通过。卡片顺序、主干站、模型标签、走法标注、卡底生成模型均符合验收点；视觉高亮以截图为证。

## 用例 2：其他走法与交接卡取消不发送

目的：验证「其他走法」折叠行、交接卡，以及取消不会发送消息。

步骤：
1. 在用例 1 的下一步卡片中展开「其他走法」。
2. 点击「交接」。
3. 观察交接卡，点击「取消」。
4. 核对会话消息数。

记录：
- 截图：`04-other-moves-expanded.png`、`05-handoff-card.png`
- 渲染文字摘录：「其他走法」展开后有「新会话」「子代理」「压缩」「交接」。
- 交接卡渲染「下一步重点（可选）」输入框、「取消」、「创建并交接」。
- 取消后会话仍显示 `1 turns · 4 steps`，输入框为空，发送按钮 disabled。

结论：通过。交接入口移动到其他走法，取消未发送新消息。

## 用例 3：A2D2 配置页与模型测试

目的：验证设置页完整公路图、候选列表、测试按钮、配置保存后生效、冲突告警与恢复默认。

步骤：
1. 打开 Settings -> A2D2 配置。
2. 截图整页。
3. 尝试添加 `claude-bray/claude-fable-5` 并测试。
4. 对 `/implement` 首选 `codex/gpt-5.5` 触发测试。

记录：
- 截图：`06-settings-a2d2-full.png`、`07-settings-codex-probe.png`
- 渲染文字摘录：页面标题「A2D2 配置」，状态「已加载」；Matt 流程包含主干、`/prototype` 服务区、`/handoff` 服务区、`/triage`/`/diagnosing-bugs`/`/wayfinder`/`/improve-codebase-architecture` 匝道及并入点、`/domain-modeling`/`/codebase-design` 路基、独立区。
- 默认候选显示：思考类为 `claude-bray/claude-fable-5-1` -> `codex/gpt-6`；实现类为 `codex/gpt-5.5` -> `claude-bray/claude-opus-5-5`。
- `claude-bray/claude-fable-5` 在模型目录下拉中存在，但通过普通 GUI 点击「添加」后未出现新的候选行；未能完成该 route 的 GUI 测试。
- 对 `/implement` 的 `codex/gpt-5.5` 触发测试后页面显示「正常 · 测试中」，超过 2 分钟未返回最终「正常」结果，且 agent-browser session 变为 `Resource temporarily unavailable`。
- 因测试调用卡住，未继续修改 implement 首选、未验证下一步卡标签热生效、未验证 code-review 与 implement 首选相同告警；没有保存非默认配置。

结论：不通过。配置页基础渲染通过，但模型测试按钮没有完成分类结果，阻塞了 #11 的关键 GUI 验收项。

## 用例 4：空项目前置条件路牌

目的：验证未配置 Matt skills 的 `/tmp/a2d2-empty-project` 中出现「首次使用前：/setup-matt-pocock-skills」路牌，首颗芯片为该命令；已配置项目不出现。

步骤：
1. 在 `/tmp/a2d2-empty-project` 执行 `git init`，仅用于让 DSH 识别工作区。
2. GUI 添加空项目工作区并发送「看一下这个空项目下一步应该做什么」。
3. 等待回复结束，点击「下一步」。

记录：
- 截图：`09-empty-project-session.png`
- 渲染文字摘录：空项目会话回复指出目录除 `.git` 外为空，建议先定目标、技术栈、写 CLAUDE.md/AGENTS.md、搭骨架。
- 点击「下一步」后咨询超过 2 分钟未返回，agent-browser session 报 `Resource temporarily unavailable`，未能取得卡片最终渲染。
- 已配置项目卡片在用例 1 中未出现「首次使用前」路牌。

结论：未验证。已配置项目“不出现路牌”通过；空项目“出现路牌与首颗芯片”未拿到最终 GUI 证据。

## 用例 5：continue 芯片切模型且不发送

目的：验证 continue 芯片在下一站模型不同的时候预显示「切到 X」，点击后切换模型、填入输入框、未发送。

记录：
- 用例 1 已观察到 continue 芯片预显示「切到 claude-fable-5-1」。
- 未点击 continue 芯片执行切模型链路。原因：后续配置页探测与空项目咨询导致多个 agent-browser session 卡住，为避免继续污染验收环境，停止触发新的副作用。

结论：未验证。

## 用例 6：clear / 新会话走法

目的：验证 clear 芯片或「其他走法 -> 新会话」创建空会话、选好下一站模型、填入命令且未发送。

记录：
- 用例 2 已观察到「其他走法」里存在「新会话 开一条空会话承接下一步」。
- 未点击新会话走法执行创建链路。原因同用例 5；未取得模型选择、填框、不发送的最终证据。

结论：未验证。

## 缺陷清单

### D1 配置页模型测试无超时，探测长时间停在「测试中」

严重级别：高

复现步骤：
1. 打开 Settings -> A2D2 配置。
2. 对 `/implement` 的 `codex/gpt-5.5` 点击「测试」。
3. 页面显示「正常 · 测试中」后等待 2 分钟以上。

实际结果：未出现最终「正常 / 拒答 / 限流 / 报错」分类；agent-browser 读取页面时开始报 `Resource temporarily unavailable`。  
期望结果：测试按钮一次调用后返回分类结果，或在合理超时后显示「报错」与原因，不应无限等待。

根因初判：
- [src/client/config-page.tsx](/data/src/github.com/a2d2-dev/dsh-plugin-wt/acceptance-report/src/client/config-page.tsx:313) 的 `probe` 只把状态设为「测试中」并直接 `await callConfig(...)`，没有客户端超时。
- [src/config-page.ts](/data/src/github.com/a2d2-dev/dsh-plugin-wt/acceptance-report/src/config-page.ts:265) 的 probe host route 只在 HTTP request aborted 时 abort，没有固定超时预算；底层模型流不返回时，UI 会一直停在 pending。

### D2 下一步咨询无客户端超时，长调用会让卡片停留在 loading

严重级别：中

复现步骤：
1. 在 `/tmp/a2d2-empty-project` 工作区会话中点击「下一步」。
2. 等待 2 分钟以上。

实际结果：未取得最终卡片；agent-browser session 报 `Resource temporarily unavailable`。  
期望结果：咨询应在合理超时后显示可读错误，并允许重试；至少不应让卡片无限保持 loading。

根因初判：
- [src/client/orb.tsx](/data/src/github.com/a2d2-dev/dsh-plugin-wt/acceptance-report/src/client/orb.tsx:335) 触发 `requestConsult` 时没有传入 AbortController 或超时。
- [src/client/consult-actions.ts](/data/src/github.com/a2d2-dev/dsh-plugin-wt/acceptance-report/src/client/consult-actions.ts:395) 的 `requestConsult` 直接 await fetch `/a2d2/api/consult`，没有超时或 fallback UI。

## 环境记录

- `http://10.126.126.12:3181/` 上目录选择器显示 `crypto.randomUUID is not a function`，Open disabled；切换到任务允许的 `http://127.0.0.1:3181/` 后目录选择器正常。这看起来与浏览器安全上下文/`crypto.randomUUID` 可用性有关，不在本次 #8 功能结论内。
- `codex/gpt-5.5` 探测和空项目下一步咨询均可能真实调用模型；实际等待时间超过 2 分钟仍未完成。
