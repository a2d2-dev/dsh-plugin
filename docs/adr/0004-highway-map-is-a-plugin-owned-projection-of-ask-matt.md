# 公路图是插件拥有的 ask-matt 展示投影，规则仍取原文

「下一步」咨询的定位输出改为闭集：区（main / service / ramp / standalone / roadbed / off-road）与站（grill、to-spec、to-tickets、implement、code-review、prototype、handoff、triage、diagnosing-bugs、wayfinder、improve-codebase-architecture、domain-modeling、codebase-design）。这张枚举与各匝道的并入点由插件以纯数据维护，prompt 信封列出它、解析器校验它、客户端按它画公路图。

## 背景

ADR 0001 要求 skill 原文注入、信封零 skill 规则。一句自由文本的「当前位置」无法画成图，也无法校验；让模型自由输出站名又容易答偏。ask-matt 本身已有稳定的结构（主干 / 匝道 / 独立 / 路基 / 前置条件），公路图就是它的画法。

## 决定

- 插件拥有的是**展示结构**（有哪些站、按什么顺序、从哪并入），不是**流转规则**（什么时候去哪、五选一怎么选）。后者仍只来自注入的 ask-matt 原文与 PHASE-BOUNDARIES.md。
- 独立区是开集（任意 skill 名），ask-matt 新增独立技能无需改插件；主干、服务区、匝道、路基是闭集，ask-matt 调整主干时需同步改枚举——这是有意接受的耦合。
- 「已过的站」由客户端从主干顺序推导，不由模型报告。

## 被否方案

- **完全自由文本定位**：无法渲染、无法校验，模型答偏时静默错。
- **从 ask-matt 原文运行时解析出结构**：原文是给人读的散文，解析脆弱；结构变化远少于措辞变化。

## 后果

- 闭集外的值整体拒绝，卡片显示原因；ask-matt 主干改名会让咨询报错直到枚举更新——错误显式、可定位。
