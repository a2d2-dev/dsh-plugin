# Spec: 「下一步」按 Matt 公路图定位 + 按站选模型 + A2D2 配置页

状态: 已与 LF 收敛（2026-09），合并了并行会话的设计与 LF 拍板。词汇见 CONTEXT.md「公路图」「区」「站」「阶段完成」「走法」「站点模型表」「A2D2 配置页」「前置条件」。前序: boundary-card.md、status-card.md。决策: docs/adr/0004、0005、0006。

## Problem Statement

「下一步」卡片现在回答「做到哪了」靠模型写的一句「当前位置」，回答「接下来」靠 2–4 颗自由生成的芯片。用户读完仍要自己把这句话对到 Matt 流程的哪一站，看不出离上线还有几站。芯片既不说明「留在本会话还是换会话」，也不说明下一站该用哪个模型——而 LF 的实际纪律是「想清楚用 fable、实施用 codex、评审换非实现模型」，每到边界都要手动切模型、手动判断五选一。模型选择也没有地方配置和查看。咨询本身沿用本会话路由，会话在用的网关一限流、或会话绑着实验模型，咨询就失败。球上「下一步」「交接」两个平级按钮也诱导了无谓交接——按 ask-matt，交接只是绕道服务区的一个动作。

## Solution

球上只留一个入口「下一步」。卡片从上到下：

1. **现状**（不变）：秒出，只读会话快照。
2. **前置条件路牌**（仅缺失时）：「首次使用前：/setup-matt-pocock-skills」。
3. **公路图**：竖向迷你公路，主干 5 站 grill → to-spec → to-tickets → implement（内含 tdd）→ code-review；当前站高亮，已过的站实心，下一站带箭头；每站挂中文职责与**该站模型**标签。在服务区或匝道时旁边加一行，如「绕道中：prototype，完成后 handoff 回 grill」「匝道：wayfinder，并入 to-spec」。
4. **下一站行**：「→ /to-spec · Continue（spec 需要本轮原始推理）· fable-5-1」。阶段没做完时改为「本阶段未完成 · 继续」，不给边界决策。
5. **芯片**：首颗 = 推荐走法，其余 1–3 颗备选。点击 = 填好命令 + 按需切模型 / 建空会话 / 打开交接卡；回车永远归人。
6. **其他走法**（折叠行）：通用入口，交接在这里。
7. 卡底小字：「由 fable-5-1 生成」（回落时注明「fable-5-1 拒答，改用 gpt-6」）。

DSH 设置导航新增 **A2D2 配置页**：首块画整张公路图（主干、匝道与并入点、服务区、路基、独立区），每站一个可排序的模型候选列表（从模型目录挑选），每个候选旁有「测试」按钮；另有「咨询」一行配置咨询自身用的模型。

## User Stories

1. 作为刚 grilling 完的用户，我想看到公路图高亮在 grill、to-spec 带箭头，以便一眼知道离上线还有 4 站。
2. 作为刚 grilling 完的用户，我想看到「→ /to-spec · Continue · fable-5-1」，以便知道 spec 应该留在本会话写。
3. 作为 grilling 还没结束的用户，我希望卡片说「本阶段未完成 · 继续」，不在中途把我推去压缩或开新会话。
4. 作为 grilling 中途发现一件可独立完成小事的用户，我希望阶段未完成时仍可能得到「派子代理」的芯片。
5. 作为 to-tickets 刚做完的用户，我想看到「→ /implement #N · clear · gpt-5.5」。
6. 作为点了 clear 芯片的用户，我希望插件建好空会话、选好 gpt-5.5、打开它并把 `/implement #N` 填进输入框，我只需回车。
7. 作为点了 continue 芯片且下一站模型不同的用户，我希望点击时本会话切到下一站模型，输入框旁的模型选择器同步显示，芯片上事先写着「切到 fable-5-1」。
8. 作为点了 continue 芯片且模型相同的用户，我希望什么都不切，只填框聚焦。
9. 作为点了 subagent 芯片的用户，我希望本会话模型不动，输入框里是派子代理的指令，写明子代理用哪个模型。
10. 作为点了 compact 芯片的用户，我希望打开交接卡、focus 预填保留指令，确认后后继会话在接手前就选好了下一站的模型。
11. 作为点了 handoff 芯片的用户，同上，只是 focus 写的是可移植的交接意图。
12. 作为实施完一张工单的用户，我想看到「→ /code-review · subagent · fable-5-1」，以便评审用非实现模型、在隔离上下文进行。
13. 作为做 prototype 的用户，我想看到「绕道中：prototype，完成后 handoff 回 grill」。
14. 作为在 diagnosing-bugs / triage / wayfinder / improve-codebase-architecture 匝道上的用户，我想看到各自写死的并入点（implement / implement / to-spec / grill）。
15. 作为在用独立技能的用户，我希望公路图标「独立：research」，主干不高亮。
16. 作为做的事与 Matt 流程无关的用户，我希望卡片标「不在公路上」，只给现状和通用芯片，不编造位置。
17. 作为新仓库的用户，我希望缺 `CONTEXT.md` 或未配置工单追踪时出现路牌，首颗芯片是 `/setup-matt-pocock-skills`。
18. 作为已配置好的用户，我希望路牌完全不出现。
19. 作为想手动交接的用户，我希望在「其他走法」里找到交接。
20. 作为用户，我希望球上只有「下一步」一个按钮。
21. 作为想知道每站用什么模型的用户，我希望公路图每站都挂模型标签，没走到的站也有。
22. 作为用户，我希望在 A2D2 配置页看到整张 Matt 公路图，并逐站排序每站的模型候选。
23. 作为用户，我希望配置页只让我从当前模型目录里挑模型，避免拼错。
24. 作为用户，我希望对某个候选点「测试」，看到正常 / 拒答 / 限流 / 报错，以便发现 fable-5 这类目录里有但会拒答的模型。
25. 作为用户，我希望改完配置不重启就生效，下一次打开卡片就用新表。
26. 作为用户，我希望把 code-review 和 implement 配成同一个首选模型时，配置页给出警告。
27. 作为用户，我希望咨询用自己配置的模型候选列表，本会话网关限流或绑着实验模型时咨询照样出结果。
28. 作为用户，我希望咨询首选模型拒答或限流时自动换下一个，并在卡底告诉我实际用了哪个。
29. 作为用户，我希望某站候选全不在目录里时芯片写「保持当前模型」，而不是报错。
30. 作为用户，我希望切模型或建会话失败时仍把命令填进输入框，并提示失败原因。
31. 作为用户，我希望模型答出表外的站名或走法时整个咨询报错并显示原因，不渲染错的公路图。
32. 作为用户，我希望芯片永不代发送。
33. 作为 skill 维护者，我希望 ask-matt 原文仍整段注入咨询，规则变更自动生效；公路图只是展示结构。
34. 作为旧宿主 + 新客户端的用户，我希望缺少公路图字段时退化为「当前位置」一句话 + 芯片。
35. 作为反复点「下一步」的用户，我希望每次都是全新一次咨询、不入史、无累计副作用。

## Implementation Decisions

### 公路图枚举（插件拥有，ADR 0004）

区与站是闭集，放在宿主侧一个纯数据模块，供 prompt 信封列出合法值、解析器校验、客户端与配置页渲染：

| 区 | 站 | 并入 / 返回 |
|---|---|---|
| `main` 主干 | `grill`（grill-with-docs / grill-me）→ `to-spec` → `to-tickets` → `implement`（内含 tdd）→ `code-review` | — |
| `service` 服务区 | `prototype`、`handoff` | 返回出发的主干站（`returnTo`） |
| `ramp` 匝道 | `triage` → implement；`diagnosing-bugs` → implement；`wayfinder` → to-spec；`improve-codebase-architecture` → grill | 并入点写死在枚举里 |
| `standalone` 独立 | 任意 skill 名（开集） | — |
| `roadbed` 路基 | `domain-modeling`、`codebase-design` | — |
| `off-road` 不在公路上 | — | — |

### 咨询输出形状

```ts
{
  position: string                       // 保留：一句话当前位置
  location: {
    zone: 'main'|'service'|'ramp'|'standalone'|'roadbed'|'off-road'
    station?: string                     // 闭集区内必须是枚举值；standalone 为 skill 名；off-road 无
    returnTo?: MainStation               // 仅 service，且必填
    phaseDone: boolean                   // 当前阶段是否已做完
  }
  next?: { station: string; move: Move; reason: string }   // off-road 可缺省
  candidates: Array<{ label: string; input: string; move: Move; station?: string }>  // 2–4 颗
}
type Move = 'continue'|'clear'|'handoff'|'subagent'|'compact'
```

解析规则（任一不满足即整体按 malformed 拒绝，沿用「不出半成品」）：
- zone/station/move 不在闭集内即拒绝；service 缺 `returnTo` 即拒绝。
- `phaseDone: false` 时 `next.move` 与所有候选的 `move` 只能是 `continue` 或 `subagent`（PHASE-BOUNDARIES：阶段中途只继续或拆子代理）。
- 首颗候选的 `move` 必须等于 `next.move`。
- 旧 `kind` 兼容一个版本：stay→continue、handoff→handoff、other→continue；客户端同理。
- 「已过的站」不由模型报告，客户端按主干顺序从当前站推导；匝道 / 服务区 / 独立 / 路基 / off-road 时主干不标已过。

### 站点模型表（ADR 0006）

- 宿主注册 settings 命名空间（带 schema，存 `settings.yaml`，热加载）。形状：`stations: Record<Station, string[]>` + `consult: string[]`，每项为 `provider/model`，有序，首个可用者生效。空列表或非 `provider/model` 形式 → schema 拒绝。
- 出厂默认：思考类（grill、to-spec、to-tickets、code-review、triage、wayfinder、improve-codebase-architecture、consult）= `claude-bray/claude-fable-5-1` → `codex/gpt-6`；写代码类（implement、prototype、diagnosing-bugs）= `codex/gpt-5.5` → `claude-bray/claude-opus-5-5`。未列出的站（handoff、路基、独立）不切模型。
- `code-review` 与 `implement` 首选相同 → 配置页与启动日志告警，不拒绝。
- 宿主把表随咨询响应返回（每站原样候选列表）；**选哪个由浏览器按会话模型目录决定**（见下），宿主不替会话选。模型不参与选模型 id。

### 咨询自身的模型与回落

- 咨询不再沿用本会话路由，改用 `consult` 候选列表，依次尝试：调用失败（含 429 限流）、`stop_reason: refusal`、输出为空 → 换下一个；输出非空但 malformed → 不换，直接报 malformed（换模型掩盖不了协议问题）。全部失败时报最后一个原因并列出每个候选的失败原因。
- 响应带 `answeredBy: "provider/model"` 与 `fallbacks: Array<{route, reason}>`，卡底显示。
- 已在工作区的三项修复保留：输出上限 4096、只剥离包住整段的单个围栏、失败原因回显。

### 前置条件（宿主事实）

宿主检查会话 cwd 所在项目：有无 `CONTEXT.md` 或 `CONTEXT-MAP.md`，有无 `docs/agents/issue-tracker.md`。结果随响应返回 `preconditions.missing`，并作为事实写进信封；缺失时宿主在解析后把 `/setup-matt-pocock-skills` 芯片强制置顶（若模型未给则补上，总数仍不超过 4）。本仓库已配置，验证需用临时项目。

### 芯片动作（ADR 0005）

| 走法 | 点击后 | 模型 |
|---|---|---|
| continue | 填本会话输入框并聚焦 | 下一站可用路由 ≠ 当前时先切本会话 |
| subagent | 填本会话输入框（指令中写明子代理模型） | 本会话不切 |
| clear | 同工作区建空会话 → 选模型 → 打开 → 填其输入框 | 创建时选 |
| compact | 打开交接卡，focus 预填「保留什么」；确认后一键交接序列 | 后继会话在 take 前选 |
| handoff | 打开交接卡，focus 预填交接意图；确认后一键交接序列 | 同上 |

- **可用路由**：按站点模型表的候选顺序，取第一个出现在该会话模型目录里的；都不在 → 「保持当前模型」。
- **切模型通道**：DSH 的会话模型目录服务（`modelDirectories`，按会话取目录，提供 `load` 与 `select`），与输入框旁的模型选择器共享同一状态；以结构化接口声明、可选注入，缺失时退化为只填框并提示。不直连 RPC。
- 芯片上预显示副作用：「切到 fable-5-1」「新会话 · gpt-5.5」「保持当前模型」。切换或建会话失败不阻断填框。

### 球与卡片

- 球 hover 只露出「下一步」；「交接」按钮移除，交接卡与序列保留，入口移到卡片「其他走法」及 handoff / compact 芯片。
- 公路图渲染状态由客户端纯函数模块推导：`highwayView(response) → { stations: [{id, role, models, state: 'passed'|'current'|'next'|'ahead'}], aside?, placard?, nextLine }`。卡片与配置页共用同一个公路图组件（配置页为可编辑变体）。
- 旧宿主（无 location）→ 不画公路图，只显示 position + 芯片。

### A2D2 配置页（ADR 0006）

- 注册到 DSH 设置导航的独立一页（`settings.section`），标题「A2D2 配置」。首块「Matt 流程」：完整公路图 + 每站候选列表（增删、排序，从模型目录挑选）+ 「咨询」一行。
- 浏览器经插件自有的受信任路由读写命名空间（DSH settings RPC 只开放白名单命名空间；与 DSH-better-sidebar 同一模式），写入带 revision 防并发覆盖。
- 「测试」按钮：宿主对该路由发一次极小调用，返回 正常 / 拒答 / 限流 / 报错 + 原因；只在点击时调用。

### 咨询 prompt

信封新增事实：公路图闭集（区 / 站 / 并入点）、前置条件结果、当前上下文占用与 smart zone 阈值、输出形状（含 `phaseDone` 约束）。走法判断规则不写进信封，仍由 ask-matt 原文与 PHASE-BOUNDARIES.md 提供。

## Testing Decisions

- 好测试只测外部行为：给定模型文本 → 解析结果或拒绝原因；给定响应 → 公路图视图；给定芯片 → 调用了哪些注入能力；给定配置 → 校验结果。不断言组件 DOM 结构与内部状态。
- 测试缝：
  1. **宿主咨询路由**（已有缝，`tests/consult.spec.ts`）：新形状、旧 kind 兼容、闭集外拒绝、service 缺 returnTo、phaseDone=false 时禁止边界走法、首颗 ≠ next.move、前置条件置顶、咨询候选回落（失败 / 拒答 / 空输出换、malformed 不换）、`answeredBy` 与 `fallbacks`、prompt 快照。stream 以 double 注入，按路由返回不同结果。
  2. **站点模型表 schema 与校验**（新纯函数缝）：默认值、空列表与格式错误拒绝、review=implement 告警。
  3. **公路图视图纯函数**（新缝，同 `status-model.spec.ts` 风格）：各站状态、服务区 / 匝道旁注与并入点、standalone / off-road 不高亮、路牌、「本阶段未完成」下一站行、模型标签取首个可用候选。
  4. **芯片分派**（已有缝，`tests/client/consult-actions.spec.ts` 注入 doubles）：五种走法各自调用的能力序列；目录选路由；路由相同不切；候选全不在目录 → 保持；切换失败仍填框；能力缺失退化；任何路径都不发送。
  5. **测试按钮**：宿主探测函数对 stream double 的结果分类（正常 / 拒答 / 限流 / 报错）。
- 前置条件检查用临时目录夹具（沿 `tests/a2d2.spec.ts` 风格）。配置页组件本身不写 DOM 测试，只测其调用的纯函数与路由。

## Out of Scope

- 自动走完整条公路（点完芯片自动发送、implement 完自动触发 review）。
- 球体本身常驻显示当前站。
- 跨会话的整张任务公路图。
- 后台定时探测模型可用性。
- 把阈值、价格表等既有静态配置迁到 A2D2 配置页（后续可做）。
- 让咨询模型自己挑模型 id。
- 改动 ask-matt 或其它 skill 原文。

## Further Notes

- 公路图回答「在哪、下一站去哪」，走法回答「怎么去」，而走法恰好决定换模型的方式（本会话 → 切；新会话 → 创建时选）。
- 实测（2026-09）：`claude-bray/claude-fable-5` 对「reply OK」返回 `refusal`（cyber），目录里却存在；这正是配置页「测试」与咨询运行时回落存在的理由。LF 说的「flabe5」按 `claude-fable-5-1` 处理。
- 基线：现状卡、咨询三项修复、CONTEXT.md / docs / AGENTS.md 目前都未提交，先开分支提交并经 PR 合并，再从合并点开工；宿主侧改动需重启 DSH 服务才生效。
