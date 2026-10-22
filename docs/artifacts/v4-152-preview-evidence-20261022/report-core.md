# #152 修复后核心链路真实验收

目的：在 preview 18782，以单客户端串行验证 Project 目录、真实视图及 Issue→真实模型会话。浏览器 session：`qa152e`，仅一个标签页。未重启服务、未改业务代码、未启用持续规则。

## 环境与方法

- 指定工作目录与分支 `test/152-preview-live` 已核对，`git pull --ff-only` 返回 Already up to date。
- preview 实际监听 `10.126.126.12:18782`。首次 localhost 返回 `net::ERR_CONNECTION_REFUSED`；只读检查监听后改用实际地址成功，这不是 HTTP 503。
- ProjectId `ec480d94-c5e8-44a0-80a0-897945df1a67`；来源 `c122502c-1632-4a96-acb5-8adbac61999d`（DSH A²D² Project，组织 a2d2-dev / #1）；账号 imneov。
- fixture：P=#157、C=#158、E=#159、A=#160；不操作 A/B/X、不创建 P 以外 Task。

## 阶段一：来源刷新（已验证）

真实 UI：A²D² 控制面板 → DSH A²D² Project →「刷新来源」，仅点击一次，等待完成，无循环刷新。

- 2026-10-22T03:02:05.057Z，`source.catalog(refresh:true)`，HTTP **200**，请求 ID `4036622.142`。
- 同次按钮还触发 `source.issues(perPage:100,assignee:*,state:all,refresh:true)`，HTTP **200**，请求 ID `4036622.143`。
- Resource Timing 同批两条开始时间 03:02:04.985Z / 03:02:04.986Z，耗时分别 **12,988 ms / 21,910 ms**。计时 API 不含请求体，不能单独断言每个耗时对应哪个操作；按钮整批约 21.9 秒完成，符合慢刷新预期。
- 完成后按钮恢复可用，开放 Issue **43**、PR **62**、处理中 **0**、需要关注 **0**，无 `work-record-unavailable`。完整扫描时间 2026-10-22T03:02:20.697Z。
- 原始证据：[网络请求体/状态](raw/core-network-refresh.json)、[计时](raw/core-refresh-timing.json)、[页面文本](raw/core-refresh-snapshot.txt)。认证请求、Cookie、口令不纳入证据。

![刷新后概览，1440×1000](shots/core-01-overview.png)

## 后续阶段

项目视图、Issue/PR、真实模型启动、接续入口和重开验证进行中；未完成前不计作已验证。
