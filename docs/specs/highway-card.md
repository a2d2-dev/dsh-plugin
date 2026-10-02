# Spec: 「下一步」按 Matt 公路图定位 + 按阶段指定 Agent + A2D2 配置页

状态: 2026-10 按 ADR 0004、0005、0007、0009 修订，代码尚未跟进。现行代码仍按站选模型、continue 时切本会话模型、芯片新建会话只选模型；本 spec 描述的是目标形态。词汇见 CONTEXT.md「工作流」「阶段」「Agent」「公路图」「区」「阶段完成」「走法」「阶段 Agent 表」「A2D2 配置页」「前置条件」。前序: boundary-card.md、status-card.md。

## Problem Statement

「下一步」卡片原先回答「做到哪了」，靠的是模型写的一句「当前位置」；回答「接下来」，靠的是 2–4 颗自由生成的芯片。

用户读完以后仍有三个问题：
- 要自己把这句话对到 Matt 工作流的哪个阶段，看不出离上线还有几个阶段。
- 芯片不说明该留在本会话还是换会话，也不说明下一阶段该由谁来做。
- 「谁来做」没有地方配置和查看。

还有两个附带问题：
- 咨询本身沿用本会话的路由。会话所用的网关一限流，或者会话绑着一个实验模型，咨询就失败。
- 球上「下一步」「交接」两个平级按钮，诱导了不必要的交接。按 ask-matt 的说法，交接只是绕道服务区的一个动作。

## Solution

球上只留一个入口：「下一步」。卡片从上到下依次是：

1. **现状**（不变）：秒出，只读会话快照。
2. **前置条件路牌**（仅缺失时出现）：「首次使用前：/setup-matt-pocock-skills」。
3. **公路图**：一条竖向迷你公路。
   - 主干 5 个阶段：grill → to-spec → to-tickets → implement（内含 tdd）→ code-review。
   - 当前阶段高亮，已过的阶段实心，下一阶段带箭头。
   - 每个阶段挂中文职责和**该阶段的 Agent** 标签，如「工程师 · gpt-5.5」。
   - 在服务区或匝道时，旁边加一行说明，如「绕道中：prototype，完成后 handoff 回 grill」「匝道：wayfinder，并入 to-spec」。
4. **下一阶段行**：如「→ /to-spec · continue（spec 需要本轮原始推理）· CEO」。阶段没做完时改为「本阶段未完成 · 继续」，不给边界决策。
5. **芯片**：首颗是推荐走法，其余 1–3 颗是备选。
   - 点击后，按走法做三件事之一：填好命令；以下一阶段的 Agent 新建会话；打开交接卡。
   - 回车永远归人。
6. **其他走法**（折叠行）：通用入口，交接在这里。
7. **卡底小字**：「由 fable-5-1 生成」。回落时注明，如「fable-5-1 拒答，改用 gpt-6」。

DSH 设置导航里新增一页 **A2D2 配置页**：
- 首块画整张公路图（主干、匝道与并入点、服务区、路基、独立区），每个阶段可以选一个 Agent：CEO、工程师或评审。
- 下方给三个 Agent 和「咨询」各一个可排序的模型候选列表，模型从模型目录里挑。
- 每个候选旁有「测试」按钮。

## User Stories

1. 作为刚 grill 完的用户，我想看到公路图高亮在 grill、to-spec 带箭头，以便一眼知道离上线还有 4 个阶段。
2. 作为刚 grill 完、在主会话里的用户，我想看到「→ /to-spec · continue · CEO」，以便知道 spec 应该留在本会话写。
3. 作为 grill 还没结束的用户，我希望卡片说「本阶段未完成 · 继续」，不在中途把我推去压缩或开新会话。
4. 作为 grill 中途发现一件可以独立完成的小事的用户，我希望阶段未完成时仍可能得到「派子代理」的芯片。
5. 作为刚做完 to-tickets 的用户，我想看到「→ /implement #N · subagent · 工程师」。
6. 作为点了 clear 芯片的用户，我希望插件建好新会话，以下一阶段的 Agent 启动（模型取它第一个可用的候选，配置装配进系统提示词），打开它并把命令填进输入框，我只需回车。
7. 作为本会话的 Agent 与下一阶段相同的用户，我希望点 continue 芯片时什么都不切，只填框并聚焦。
8. 作为自己开会话（没有 Agent）的用户，我希望跨阶段时卡片不给 continue，只给新会话或派子代理。
9. 作为点了 subagent 芯片的用户，我希望本会话不动，输入框里是派子代理的指令，写明子代理是哪个 Agent。
10. 作为点了 compact 芯片的用户，我希望：
    - 打开交接卡，focus 预填要保留的指令；
    - 确认后，后继会话在接手之前就以下一阶段的 Agent 启动。
11. 作为点了 handoff 芯片的用户，同上，只是 focus 写的是可移植的交接意图。
12. 作为实施完一张工单的用户，我想看到「→ /code-review · subagent · 评审」，以便由另一个模型在隔离的上下文里评审。
13. 作为做 prototype 的用户，我想看到「绕道中：prototype，完成后 handoff 回 grill」。
14. 作为在 diagnosing-bugs / triage / wayfinder / improve-codebase-architecture 匝道上的用户，我想看到各自写死的并入点（implement / implement / to-spec / grill）。
15. 作为在用独立技能的用户，我希望公路图标「独立：research」，主干不高亮。
16. 作为做的事与 Matt 工作流无关的用户，我希望卡片标「不在公路上」，只给现状和通用芯片，不编造位置。
17. 作为新仓库的用户，我希望缺 `CONTEXT.md`、或没配置工单追踪时出现路牌，首颗芯片是 `/setup-matt-pocock-skills`。
18. 作为已配置好的用户，我希望路牌完全不出现。
19. 作为想手动交接的用户，我希望在「其他走法」里找到交接。
20. 作为用户，我希望球上只有「下一步」一个按钮。
21. 作为想知道每个阶段由谁来做的用户，我希望公路图每个阶段都挂 Agent 标签，没走到的阶段也有。
22. 作为用户，我希望在 A2D2 配置页看到整张 Matt 公路图，逐个阶段选 Agent，逐个 Agent 排序模型候选。
23. 作为用户，我希望配置页只让我从当前模型目录里挑模型，避免拼错。
24. 作为用户，我希望对某个候选点「测试」，看到「正常 / 拒答 / 限流 / 报错」，以便发现 fable-5 这类在目录里、却会拒答的模型。
25. 作为用户，我希望改完配置不用重启就生效，下一次打开卡片就用新表。
26. 作为用户，我希望评审和工程师配成同一个首选模型时，配置页给出警告。
27. 作为用户，我希望咨询用自己配置的模型候选列表；本会话的网关限流或绑着实验模型时，咨询照样出结果。
28. 作为用户，我希望咨询的首选模型拒答或限流时自动换下一个，并在卡底告诉我实际用了哪个。
29. 作为用户，我希望某个 Agent 的候选全不在目录里时，芯片写明「工程师无可用模型」，点击只填框并提示原因。
30. 作为用户，我希望新建会话失败时，仍把命令填进输入框，并提示失败原因。
31. 作为用户，我希望模型答出表外的阶段名或走法、或给出违反「一条会话一个 Agent」的 continue 时，整个咨询报错并显示原因，不渲染错的公路图。
32. 作为用户，我希望芯片永不代发送。
33. 作为 skill 维护者，我希望 ask-matt 原文仍整段注入咨询，规则一变更就自动生效；公路图只是展示结构。
34. 作为旧宿主 + 新客户端的用户，我希望缺少公路图字段时，退化为「当前位置」一句话加芯片。
35. 作为反复点「下一步」的用户，我希望每次都是一次全新的咨询：不写入历史，没有累积的副作用。

## Implementation Decisions

### 公路图枚举（插件拥有，ADR 0006）

区与阶段都是闭集（独立区除外），放在宿主侧一个纯数据模块里，有三个用途：
- prompt 信封据此列出合法值；
- 解析器据此校验；
- 客户端与配置页据此渲染。

| 区 | 阶段 | 并入 / 返回 |
|---|---|---|
| `main` 主干 | `grill`（grill-with-docs / grill-me）→ `to-spec` → `to-tickets` → `implement`（内含 tdd）→ `code-review` | — |
| `service` 服务区 | `prototype`、`handoff` | 返回出发时所在的主干阶段（`returnTo`） |
| `ramp` 匝道 | `triage` → implement；`diagnosing-bugs` → implement；`wayfinder` → to-spec；`improve-codebase-architecture` → grill | 并入点写死在枚举里 |
| `standalone` 独立 | 任意 skill 名（开集） | — |
| `roadbed` 路基 | `domain-modeling`、`codebase-design` | — |
| `off-road` 不在公路上 | — | — |

### 咨询输出形状

字段名 `station` 沿用代码里的命名，含义是阶段。

```ts
{
  position: string                       // 一句话当前位置
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

解析规则：任一条不满足，就整体按 malformed 拒绝，不出半成品。
- zone、阶段、move 不在闭集内即拒绝；service 缺 `returnTo` 即拒绝。
- `phaseDone: false` 时，`next.move` 与所有候选的 `move` 只能是 `continue` 或 `subagent`。
- `phaseDone: true` 时，下一阶段的 Agent 与本会话的 Agent 不同、或本会话没有 Agent，则 `next.move` 与所有候选的 `move` 都不得为 `continue`（ADR 0005）。
- 首颗候选的 `move` 必须等于 `next.move`。
- 旧字段 `kind` 兼容一个版本：stay → continue、handoff → handoff、other → continue。客户端同理。
- 「已过的阶段」不由模型报告，由客户端按主干顺序从当前阶段推导。处在匝道、服务区、独立区、路基或 off-road 时，主干不标已过。

### 阶段 Agent 表与模型候选（ADR 0009）

- **存储**：宿主注册 settings 命名空间（带 schema，存在 `settings.yaml`，热加载）。形状如下：
  - `stages: Record<Stage, 'ceo'|'engineer'|'reviewer'>`
  - `agents: Record<'ceo'|'engineer'|'reviewer', string[]>`
  - `consult: string[]`

  模型候选每项为 `provider/model`，有序，首个可用者生效。空列表或格式不对，schema 直接拒绝。
- **出厂默认**：
  - 阶段：implement → 工程师，code-review → 评审，其余阶段（含独立区的任意 skill）→ CEO。
  - 模型：CEO、评审、咨询 = `claude-bray/claude-fable-5-1` → `codex/gpt-6`；工程师 = `codex/gpt-5.5` → `claude-bray/claude-opus-5-5`。
- **告警**：评审与工程师的首选相同时，配置页和启动日志告警，但不拒绝。
- **谁来选模型**：宿主把表随咨询响应一起返回；选哪个模型由浏览器按会话模型目录决定（见下），宿主不替会话选，模型也不参与选模型 id。

### 会话的 Agent

- **宿主为每条以 Agent 启动的会话记下它的 Agent**：
  - 主会话由绑定推出，是 CEO。
  - 子代理在派发时记下。
  - 芯片新建的会话，由芯片调用宿主路由登记。
- **装配按这份记录进行**：取首个可用的模型；两级配置每次请求前现读，放进系统提示词（ADR 0004）。
- **没有记录的会话没有 Agent。**
- **咨询信封带上**本会话的 Agent 与阶段 Agent 表，供上面的 continue 规则校验。

### 咨询自身的模型与回落

- 咨询不沿用本会话路由，改用 `consult` 候选列表，依次尝试：
  - 调用失败（含 429 限流）、`stop_reason: refusal`、输出为空：换下一个。
  - 输出非空但 malformed：不换，直接报 malformed，因为换模型掩盖不了协议问题。
  - 全部失败：报最后一个原因，并列出每个候选的失败原因。
- 响应带 `answeredBy: "provider/model"` 与 `fallbacks: Array<{route, reason}>`，在卡底显示。
- 保留三项已有修复：输出上限 4096、只剥离包住整段的单个代码围栏、回显失败原因。

### 前置条件（宿主事实）

- 宿主检查会话 cwd 所在的项目：有没有 `CONTEXT.md` 或 `CONTEXT-MAP.md`，有没有 `docs/agents/issue-tracker.md`。
- 结果随响应返回 `preconditions.missing`，并作为事实写进信封。
- 缺失时，宿主在解析后把 `/setup-matt-pocock-skills` 芯片强制置顶；模型没给就补上，总数仍不超过 4。

### 芯片动作（ADR 0007）

| 走法 | 点击后 | Agent |
|---|---|---|
| continue | 填本会话输入框并聚焦 | 不变（只有同一 Agent 时才会出现） |
| subagent | 填本会话输入框，指令里写明子代理的 Agent | 本会话不变 |
| clear | 在同一工作区新建会话，登记为下一阶段的 Agent，选好模型，打开，再填它的输入框 | 新建时确定 |
| compact | 打开交接卡，focus 预填「保留什么」；确认后走一键交接序列 | 后继会话在 take 之前确定 |
| handoff | 打开交接卡，focus 预填交接意图；确认后走一键交接序列 | 同上 |

- **Agent 的可用模型**：按候选顺序，取第一个出现在该会话模型目录里的。都不在时，芯片注明「无可用模型」，点击只填框。
- **选模型的通道**：用 DSH 的会话模型目录服务（`modelDirectories`，按会话取目录，提供 `load` 与 `select`），与输入框旁的模型选择器共享同一状态。以结构化接口声明、可选注入；缺失时退化为只填框并提示。不直连 RPC。
- **芯片上预先显示副作用**：如「新会话 · 工程师（gpt-5.5）」「子代理 · 评审」。新建会话失败时，不阻断填框。

### 球与卡片

- 球 hover 只露出「下一步」。「交接」按钮移除，交接卡和交接序列保留，入口移到卡片的「其他走法」以及 handoff / compact 芯片。
- 公路图的渲染状态，由客户端一个纯函数模块推导：`highwayView(response) → { stages: [{id, role, agent, models, state: 'passed'|'current'|'next'|'ahead'}], aside?, placard?, nextLine }`。卡片与配置页共用同一个公路图组件，配置页用可编辑变体。
- 旧宿主（响应里没有 location）：不画公路图，只显示 position 加芯片。

### A2D2 配置页（ADR 0009）

- 注册为 DSH 设置导航里独立的一页（`settings.section`），标题「A2D2 配置」。
- 首块「Matt 工作流」：完整公路图，每个阶段一个 Agent 选择器。下方是 CEO、工程师、评审、咨询四个候选列表，可增删、排序，模型从模型目录挑。
- 浏览器经插件自己的受信任路由读写命名空间，写入时带 revision，防止并发覆盖。DSH 的 settings RPC 只开放白名单命名空间，所以要走自己的路由（与 DSH-better-sidebar 同一模式）。
- 「测试」按钮：宿主对该路由发一次极小的调用，返回「正常 / 拒答 / 限流 / 报错」加原因。只在点击时调用。

### 咨询 prompt

信封新增这些事实：
- 公路图闭集（区、阶段、并入点）；
- 前置条件结果；
- 阶段 Agent 表与本会话的 Agent；
- 当前上下文占用与 smart zone 阈值；
- 输出形状（含 `phaseDone` 约束与 continue 约束）。

走法的判断规则不写进信封，仍由 ask-matt 原文与 PHASE-BOUNDARIES.md 提供。

## Testing Decisions

- 好测试只测外部行为：
  - 给定模型文本 → 解析结果或拒绝原因；
  - 给定响应 → 公路图视图；
  - 给定芯片 → 调用了哪些注入能力；
  - 给定配置 → 校验结果。

  不断言组件的 DOM 结构和内部状态。
- 测试缝：
  1. **宿主咨询路由**（已有缝，`tests/consult.spec.ts`）。覆盖：
     - 新形状、旧 kind 兼容；
     - 闭集外拒绝、service 缺 returnTo；
     - phaseDone=false 时禁止边界走法；跨 Agent 的 continue 被拒；首颗 ≠ next.move；
     - 前置条件置顶；
     - 咨询候选回落（失败、拒答、空输出换下一个，malformed 不换），`answeredBy` 与 `fallbacks`；
     - prompt 快照。

     stream 以 double 注入，按路由返回不同结果。
  2. **阶段 Agent 表 schema 与校验**（新纯函数缝）：默认值、空列表和格式错误被拒、评审与工程师首选相同时告警。
  3. **公路图视图纯函数**（新缝，同 `status-model.spec.ts` 的风格）。覆盖：
     - 各阶段状态；
     - 服务区、匝道的旁注与并入点；
     - standalone、off-road 不高亮；
     - 路牌、「本阶段未完成」的下一阶段行；
     - Agent 标签取首个可用候选。
  4. **芯片分派**（已有缝，`tests/client/consult-actions.spec.ts`，注入 doubles）。覆盖：
     - 五种走法各自调用的能力序列；
     - 新会话登记 Agent 并选模型；
     - 候选全不在目录时只填框；
     - 新建失败仍填框、能力缺失时退化；
     - 任何路径都不发送、都不切换本会话模型。
  5. **测试按钮**：宿主探测函数对 stream double 结果的分类（正常、拒答、限流、报错）。
- 前置条件的检查用临时目录夹具（沿用 `tests/a2d2.spec.ts` 的风格）。配置页组件本身不写 DOM 测试，只测它调用的纯函数和路由。

## Out of Scope

- 自动走完整条公路（点完芯片自动发送、implement 完自动触发 review）。
- 球体本身常驻显示当前阶段。
- 跨会话的整张任务公路图。
- 后台定时探测模型可用性。
- 把阈值、价格表等已有的静态配置迁到 A2D2 配置页（以后可做）。
- 让咨询模型自己挑模型 id。
- 改动 ask-matt 或其他 skill 的原文。

## Further Notes

- 四件事各管一块：
  - 公路图回答「在哪、下一阶段去哪」；
  - Agent 回答「谁去」；
  - 走法回答「怎么去」。
  - 一条会话只跑一个 Agent，所以下一阶段换了 Agent，就一定要换会话或派子代理。
- 实测（2026-09）：`claude-bray/claude-fable-5` 对「reply OK」返回 `refusal`（cyber），目录里却有它。这正是配置页需要「测试」、咨询需要运行时回落的原因。
