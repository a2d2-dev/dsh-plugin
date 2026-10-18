# Codex 统一模型与真实派发验收

## 结果

开发入口 <http://10.126.126.12:18780/> 的默认模型和 CEO、工程师、评审、咨询配置均为 `codex/gpt-6.1-sol`。父会话、子代理实际请求也都使用该模型，真实派发和父会话自动完成通知已通过。

| 用途 | Provider / Model | Reasoning effort |
| --- | --- | --- |
| 默认会话及本次验收父会话 | codex / gpt-6.1-sol | high |
| CEO | codex / gpt-6.1-sol | xhigh |
| 工程师及本次验收子代理 | codex / gpt-6.1-sol | medium |
| 评审 | codex / gpt-6.1-sol | xhigh |
| 下一步咨询 | codex / gpt-6.1-sol | xhigh |

本轮没有修改 DSH 源码、升级运行时、放宽沙箱或重启生产。开发宿主仍为 DSH 0.2.0；新接口 startActivation 的行为证据仍是此前自动化回归，本次真实验收覆盖现有宿主的兼容分支。本轮没有重跑代码测试或构建。

## 实验目的

消除 DS Flash 余额不足对派发验收的阻塞，确认实际模型路由，验证子代理最终答案由运行时自动送达父会话，而不只相信模型自己报告的结果。

## 实验步骤

1. 检查开发 profile：默认值和四类 Agent 配置已全部为 Codex。之前失败会话仍保留 DS Flash 的会话级选择，页面选择其他模型后仍未观察到生效；重试仍报原模型余额不足。因此保留历史失败记录，创建新的验收会话，让其使用当前 Codex 默认模型。
2. 通过 agent-browser 登录现有开发页面，在先前的独立验收 workspace 创建新会话并从真实输入框发送请求，禁止文件编辑、shell 命令、外部 GitHub 操作及 complete_task。
3. 首次绑定 #112 时，工具拒绝覆盖已有主会话；此前一期完成记录保留。改为绑定本次修复 PR #117 对应的本地任务，parent_issue=112，再调用 dispatch_subagent，stage=implement，issue=117。
4. 子代理返回标记 `DISPATCH_PLUGIN_ONLY_20261018_OK`。检查父子实际持久日志，确认模型与 effort，确认运行时的 `subagent-settled` 消息，再确认父会话在该消息之后回复。

## 实验记录

- 父会话：`session-a5137720-247a-49e5-a04b-3d8bcd6e39fe`。全部实际 request/header 为 `codex / gpt-6.1-sol / high`。
- 子代理：`session-37302b02-f8a7-4fcd-a520-589b2299969b`。实际 request/header 为 `codex / gpt-6.1-sol / medium`，turn/end 为 completed。
- 子代理未调用文件或 shell 工具；调用了一次控制工具 send_message。父会话 seq 60 收到这条 agent-message，之后又在 **seq 68** 收到独立的 **subagent-settled** 自动结算消息，内含子代理最终答案。
- 父会话在 seq 68 之后再次输出 `PARENT_RECEIVED_DISPATCH_PLUGIN_ONLY_20261018_OK`。已单独断言自动结算消息与后续确认的先后关系，没有把主动 send_message 当成自动完成通知的替代证据。
- 配置与日志的脱敏 JSON 已独立断言：默认/角色模型均为 Codex、父子请求路由均为 Codex、子代理完成、存在自动结算消息、父会话后续确认、子代理仅调用 send_message。

旧 DS Flash 会话与 #112 原主会话均未被批量迁移或篡改历史。#117 的验收仅写入开发环境本地任务与会话记录，未向 GitHub issue 发消息或关闭 issue。

## 证据

- [实际路由与结算断言](https://10.126.126.12:5200/assets/%E5%B7%A5%E4%BD%9C/assets/share_1792340959364_A2D2_Codex_%E9%AA%8C%E6%94%B6_evidence.json.json)
- [开发模型配置快照](https://10.126.126.12:5200/assets/%E5%B7%A5%E4%BD%9C/assets/share_1792340959363_A2D2_Codex_%E9%AA%8C%E6%94%B6_model-routes.json.json)

![父会话收到子代理消息及自动结算并确认](https://10.126.126.12:5200/assets/%E5%B7%A5%E4%BD%9C/assets/share_1792340959370_A2D2_Codex_%E9%AA%8C%E6%94%B6_01-parent-received.png.png)
