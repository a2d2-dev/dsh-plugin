# 站点模型表放在插件自己的 settings 命名空间，并在「A2D2 配置页」编辑

站点模型表（每站一个有序的 `provider/model` 候选列表，另有 `consult` 键给咨询本身）不放在静态插件配置里，而是由宿主以带 schema 的 settings 命名空间注册，存于 `settings.yaml`、热加载。浏览器侧在 DSH 设置导航里新增独立一页「A2D2 配置页」（首块内容是 Matt 流程公路图与站点模型表）：画出整张公路图，逐站编辑候选列表，并可对单个候选按需「测试」。

## 背景

LF 要求模型选项可配置、且能在界面上看到 Matt 流程。实测发现模型可用性无法只靠目录判断：`claude-bray/claude-fable-5` 在目录里、网络通，但连一句「reply OK」都返回 `stop_reason: refusal`；同网关的 `claude-fable-5-1`、`claude-opus-5-5`、`codex/gpt-6`、`codex/gpt-5.5` 正常。

## 决定

- 命名空间由宿主 `settings.register(ns, schema)` 注册；DSH 的 settings RPC 只向配置客户端开放白名单命名空间，所以浏览器经本插件自己的受信任路由读写（与 DSH-better-sidebar 同一模式）。
- 候选列表为空、或条目不是 `provider/model` 形式，schema 校验失败；`code-review` 与 `implement` 的首个可用候选相同时告警（不拒绝）。
- 「可用」分两处判定：咨询由宿主真调用，出错、拒答、限流、输出为空时换下一个候选；芯片切模型按会话模型目录的成员资格取第一个在目录里的候选。拒答只能靠设置页的手动「测试」或咨询的运行时回落发现。
- 「测试」只在用户点击时发一次极小调用，报告 正常 / 拒答 / 限流 / 报错，不做后台轮询。
- 出厂默认：思考类（grill、to-spec、to-tickets、code-review、triage、wayfinder、improve-codebase-architecture、consult）= `claude-bray/claude-fable-5-1` → `codex/gpt-6`；写代码类（implement、prototype、diagnosing-bugs）= `codex/gpt-5.5` → `claude-bray/claude-opus-5-5`。

## 被否方案

- **静态插件配置（`Config.stationModels`）**：改一次要重启宿主，且没有界面。
- **放进插件页的一张卡片**：空间不够画整张公路图。
- **后台定时探测所有候选**：持续花费、持续占网关并发，而拒答多半是稳定属性，按需测一次足够。

## 后果

- 现有静态配置（阈值、价格表）暂不迁移，仍在插件配置里；只有站点模型表进 settings 命名空间。
