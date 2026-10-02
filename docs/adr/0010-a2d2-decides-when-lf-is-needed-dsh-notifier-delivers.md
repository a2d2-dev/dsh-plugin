# 等人通知：A²D² 决定何时、说什么，dsh-notifier 负责送达

CEO 主会话停下来等 LF 时，要把消息推到 LF 手机上。「这算不算在等 LF、消息说什么」由 A²D² 判断；「怎么送到手机」交给社区插件 dsh-notifier，A²D² 不自建推送渠道。

## 背景

- 社区已有 40 多个 DSH 通知插件。dsh-notifier（MIT）覆盖 28 个推送渠道（含飞书、ntfy、Bark），支持验证码配对和手机端审批，并通过 `ctx.notifier.push` 对其他插件开放。
- 通用通知插件只看得到 `turn/end`、`approval/asked` 这类原始事件。它分不清主会话和子代理会话，也不知道 CEO 为什么在等（单向门、设计阶段、交接卡、任务完成）。
- 2026-10-02 在 DSH 0.2.0-rc.2 上实测（#81）：dsh-notifier 0.13.1 需要版本豁免才能装；回调式 `ctx.inject(['notifier'], cb)` 能触发，`push` 送达；它的出站路径不过滤子代理会话。

## 决定

- **语义归 A²D²**：只看主会话；等待原因和正文用 A²D² 词汇（任务 issue 号、当前阶段、单向门问题），附任务 issue 链接。
- **投递归 dsh-notifier**：渠道、绑定、静音、限流、手机端审批都用它的，A²D² 只调用 `ctx.notifier.push(message, { sourceName: 'dsh-a2d2' })`。
- **可选依赖**：用回调式 `ctx.inject(['notifier'], cb)`。没装 dsh-notifier 时 A²D² 照常运行、不发通知，A2D2 配置页提示安装；不用静态 `inject`，否则没装就会卡住宿主启动。
- **一件事只发一条**：主会话的等待由 A²D² 发，dsh-notifier 的通用 `turn/end` 通知不能再为同一会话发一条。具体做法在 #81 的 to-spec 里定；需要 dsh-notifier 新接口时，向上游提 PR，不在 A²D² 里绕过。

## 被否方案

- **A²D² 自建推送渠道**：违反 ADR 0001 的边界；LF 的非 A²D² 会话也需要通知，会出现两套绑定、两套静音，同一件事收到两条。
- **只装通用通知插件，A²D² 不参与**：子代理也会刷屏，而且消息里没有任务和阶段，LF 看了还要回 GUI 才知道要决定什么。
- **静态 `inject: ['notifier']`**：把 dsh-notifier 变成硬依赖，没装它的用户启动会卡住。
