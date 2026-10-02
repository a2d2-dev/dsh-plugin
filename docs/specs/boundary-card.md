# Spec: 指示球演进为边界卡（boundary card）

状态: 已 grilling 收敛（2026-09，与 LF 十三问定案）。决策真源见 docs/adr/（0006 知识归属、0007 决策归人、0008 下一步咨询）与 CONTEXT.md。

## Problem Statement

用户在阶段边界（一个阶段做完、或上下文逼近 smart zone）需要决定下一步，但悬浮球只提供一种出口：写摘要式交接。真实工作里交接只是五选一之一；且当状态已沉淀在文档/工单里时，被迫写 4000 字符叙述摘要既慢（约 10 分钟一轮）又错——后继需要的是几行指针。用户被迫手打"我该如何给新会话写提示词"并等待长答案。

## Solution

指示球（读数不变）hover 露出两个平级入口，对应两种人类意图：

- **交接**（已决定换会话）→ 交接卡：focus 输入 + 确认，走既有一键交接序列；写内容那轮的指令改为 handoff skill 原文注入 + 参数信封，内容形态（指针/摘要/混合）由源会话 agent 按状态自判。
- **下一步**（阶段做完，问该干嘛）→ 下一步咨询：宿主一次性生成（不入史），以 ask-matt 原文 + 会话素材为据产出 2–4 颗候选意图芯片；点击芯片将命令填入输入框（kind=handoff 的芯片转开交接卡预填 focus），回车归人。

## User Stories

1. 作为拆完工单的用户，我想点「下一步」看到"按 ceo-team 实施 #A–#B"这样的候选芯片，以便一次点击 + 回车进入实施阶段。
2. 作为 grilling 到一半的用户，我想在候选里看到"继续留在本会话"排第一（附理由），以便不被引导做无谓交接。
3. 作为决定交接的用户，我想点「交接」填一句 focus 就完成整个交接，后继首条消息是指针而非复述。
4. 作为状态已全部落盘的用户，我希望交接轮写出的是任务行 + 基线 + 阅读清单 + 护栏的短指针，而不是 4000 字符叙述。
5. 作为状态还在对话里的用户，我希望交接轮写出未落盘部分的摘要，落盘部分仍用路径引用。
6. 作为点了「下一步」的用户，我希望咨询不在对话流里留下任何痕迹，历史里只有我采纳后真正执行的命令。
7. 作为反复权衡的用户，我希望能多次点「下一步」而不产生任何成本或历史污染。
8. 作为看到告警色的用户，我希望悬停文案告诉我"接近 smart zone，该在下个边界做五选一"，而不是只说贵。
9. 作为 skill 的维护者，我希望改进 handoff/ask-matt 的措辞后，插件的交接与咨询行为自动跟进，无需改插件。
10. 作为没装 ask-matt 的部署的用户，我希望「下一步」仍能给出候选，且明确标注"未读到 ask-matt skill"。
11. 作为点击了 stay 类芯片的用户，我希望命令出现在输入框且聚焦，我可以编辑后再回车。
12. 作为点击了 handoff 类芯片的用户，我希望交接卡打开且 focus 已预填该候选的意图。

## Implementation Decisions

- **交接指令重写**（宿主，handoff-instruction 模块）：删除叙述式摘要辅导词与 suggestedSkills 渲染；新形态 = handoff SKILL.md 原文注入 + 参数信封（文档路径、标记对、focus、约 4000 字符预算）。信封不含任何 skill 已有规则（ADR 0006）。skill 文件缺失时回落为最小指令并在文档 front matter 标注降级。
- **skill 读取**：探测既有 skill 根目录（可配置覆盖），读 SKILL.md 及其正文相对引用的本地 markdown；注入原文不改写。
- **下一步咨询**（宿主）：新增插件 HTTP 路由面 `POST /a2d2/api/consult?session=<id>`，同现有 tasks 路由的信任判据与 `{ok,value}/{ok,error:{code}}` 响应纪律。宿主取素材（最近 N 条 surface 消息节选 + 本项目任务/交接账本，N 与 token 上限为常量）→ `ctx.llm.stream` 手构 messages 一次生成（先例：session-title-llm），路由跟随本会话当前路由（已为价格解析 request/header，复用）。产出解析为候选数组 `{label, input, kind: stay|handoff|other}`，解析失败整体报错不出半成品芯片。
- **客户端**：hover 动作区从一个按钮改两个（「交接」「下一步」）；「下一步」点击 → 调 consult 路由 → 卡上渲染芯片（loading/error 态显式）；stay/other 芯片点击复用既有 appendToDraft + focusComposer（替换而非追加需保留既有草稿保护语义），handoff 芯片点击打开交接卡并预填 focus。交接卡与一键交接序列（command → 等写摘要轮 → connectWorkspace → rename → take）不动。
- **阈值**：`handoffWarnTokens` 默认 200000 → 150000，hover 文案改为 smart zone 语义；配置键语义不变。
- **suggestedSkills 配置**：停止渲染，键保留标记废弃（不 break 既有部署加载）。
- **交接文档协议不变**：front matter、标记对、take 校验、脱敏、版本 2 全部保持。

## Testing Decisions

- 只测外部行为：指令文本生成（含 skill 注入、缺失降级）、consult 路由的响应形状与错误码、候选 JSON 解析（含畸形输出拒绝）、芯片点击对 composer/交接卡的效果（既有 orb-actions 测试风格，注入 doubles）。
- 既有先例：tests/ 下对 orb-actions 的纯函数注入式测试；宿主路由沿用 tasks 路由的测试形态。
- 不测 llm 生成内容本身的质量；prompt 全文做快照断言以捕获意外改写（信封与注入边界是本设计的核心不变量）。

## Out of Scope

- 交接卡候选 focus 的预生成（打开交接卡时预填建议 focus）——等下一步咨询用出体感后再议。
- frontier 扇出、tracker 集成：多票并行是后继会话里 ceo-team 的职责，插件不碰。
- 消灭交接轮本身（"轻接续跳过写内容那轮"）：单一指令下短内容轮已经很快，不值得新协议。
- consultRoute 独立模型配置、咨询结果缓存。
- A²D² 面板改动。

## Further Notes

- handoff skill 原文已于本轮修改（"调用方给位置就用调用方的"），upstream 真源与插件同日演进——这是 ADR 0006 的第一次实践。
- README 的 Known Limitation"写摘要的指令复述 skill 规则须手工同步"在本 spec 落地后删除。
