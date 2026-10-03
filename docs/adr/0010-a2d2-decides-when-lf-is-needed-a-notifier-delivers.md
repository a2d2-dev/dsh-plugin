# 等人通知：A²D² 决定何时、说什么，`notifier` 服务负责送达

CEO 主会话停下来等 LF 时，要把消息推到 LF 手机上。「这算不算在等 LF、消息说什么」由 A²D² 判断；「怎么送到手机」交给提供 `notifier` 服务的插件，A²D² 不自建推送渠道。我们维护的飞书桥 a2d2-dev/dsh-feishu-connect 提供这个服务；要多渠道的用户可以改装社区的 dsh-notifier。

## 背景

- 社区已有 40 多个 DSH 通知插件。dsh-notifier（MIT）覆盖 28 个推送渠道，并以 `ctx.notifier.push(message, options)` 对其他插件开放（公开接口版本 0.7）。
- 通用通知插件只看得到 `turn/end`、`approval/asked` 这类原始事件。它分不清主会话和子代理会话，也不知道 CEO 为什么在等。
- 2026-10-02 在 DSH 0.2.0-rc.2 上实测（#81）：回调式 `ctx.inject(['notifier'], cb)` 能触发，`push` 送达；dsh-notifier 0.13.1 需要版本豁免，出站路径不过滤子代理；它的飞书普通通知只能走群 webhook，不能用已有的应用机器人。
- LF 已经在用 dsh-feishu-connect 的应用机器人。上游（limingboGitHub/dsh-my-plugins）停在 1.7.1，没有 DSH 0.2 适配；我们一直靠本地 pnpm 补丁运行它。

## 决定

- **语义归 A²D²**：只看主会话；等待原因和正文用 A²D² 词汇（任务 issue 号、当前阶段、单向门问题），附任务 issue 链接。
- **投递归 `notifier` 服务**：A²D² 只调用 `ctx.notifier.push(message, { sourceName: 'dsh-a2d2', sessionId })`。接口形状以 dsh-notifier 0.7 为准，`sessionId` 是我们加的可选字段，不认识它的实现会忽略。
- **可选依赖**：用回调式 `ctx.inject(['notifier'], cb)`。没有任何插件提供 `notifier` 时 A²D² 照常运行、不发通知；不用静态 `inject`，否则会卡住宿主启动。
- **飞书桥 fork 到 a2d2-dev/dsh-feishu-connect**：保留上游历史和 MIT 署名，补 DSH 0.2 适配，新增三件事：
  - 通用等人通知：顶层会话的一轮结束、工具审批、`ask_user` 提问，经应用机器人私聊发给绑定的人；从飞书发起的会话跳过，因为回复本来就回到飞书。
  - `/bind` 命令：在飞书私聊里绑定接收人，不再依赖「最近聊天」。
  - 提供 `notifier` 服务，接口与 dsh-notifier 0.7 兼容。
- **一件事只发一条**：某插件带 `sessionId` 调用 `push` 后，飞书桥在宽限窗口内撤销该会话尚未发出的通用通知。主会话的等待因此只收到 A²D² 那条。
- **两个 `notifier` 提供者只装一个**：飞书桥和 dsh-notifier 同时装会抢服务名，文档里写明二选一。

## 被否方案

- **A²D² 自建推送渠道**：违反 ADR 0001 的边界；LF 的非 A²D² 会话也需要通知，会出现两套绑定、两套静音。
- **只装通用通知插件，A²D² 不参与**：子代理也会刷屏，而且消息里没有任务和阶段。
- **只用 dsh-notifier**：飞书普通通知只能走群 webhook，LF 要再建一个机器人；它的飞书接收端还会和 dsh-feishu-connect 抢同一个应用的事件。
- **把 dsh-notifier 的代码拷进飞书桥**：相关部分约 4500 行，依赖它自己的配对、台账、限流模块；真正需要的监听逻辑只有一百多行，重写比拆分便宜。
- **继续用本地 pnpm 补丁**：只在一台机器上有效，升级就丢，无法给别人用。
- **静态 `inject: ['notifier']`**：把通知插件变成硬依赖，没装的用户启动会卡住。
