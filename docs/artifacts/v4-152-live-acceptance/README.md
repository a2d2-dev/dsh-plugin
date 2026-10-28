# #152 历史专用验收对象正文（r01）

## 当前入口提示（2026-10-28）

LF 已将测试入口改为 https://dsh-dev.e5box.a2d2.dev/，仓库采用 public。当前使用[更新后的完整脚本](https://github.com/a2d2-dev/dsh-plugin/blob/2097a91/docs/specs/v4-live-acceptance-script.md)；新实例准备记录见[只读 API 与隔离核对](../v4-152-dev-api-preparation-20261028/README.md)。旧 18782 停服不再是阻塞或恢复前置。

本目录六正文固定为历史 r01 的原始要求，含当时工作目录和完成令；原封保留，不直接作为新实例的运行指令。P#157/C#158/X#162 当前 Open，E#159/A#160/B#161 已 Closed；后续先核对 ledger 与状态，按新实例独立资源准备实际阶段，不重复创建或重开历史对象。

## 历史准备记录

以下正文与操作顺序是 #150 主会话当时保存的准备方案；“尚未创建”及 #154／18782／PRIVATE 条件描述的是该历史阶段，不代表当前状态。后续真实运行记录见 #152 评论与各轮报告。

- 固定依据：[完整六项脚本](https://github.com/a2d2-dev/dsh-plugin/blob/7e5566b48c23171a7d7a69550077b66b69d33ad0/docs/specs/v4-live-acceptance-script.md)、[PR153具体验收方案](https://github.com/a2d2-dev/dsh-plugin/pull/153/files)。
- nonce：`v4-152-6b252218-r01`；workspace预定`/data/_dsh-dev/acceptance-workspaces/v4-152-r01`，只有正式注册返回的resource ref能进入执行命令。
- 所有对象run标签`qa:v4-152-6b252218-r01`，只有A/B/X加`qa:v4-152-6b252218-r01-serial`。touch标签`qa:v4-152-6b252218-r01-touch`只用于A。assign imneov，不加开发执行标签。
- [P](P.body.md)父汇总与决定接续；[C](C.body.md)独立本地子；[E](E.body.md)真实外部交付；[A](A.body.md)等待与关闭冲突；[B](B.body.md)串行正常关闭；[X](X.body.md)Block零执行。

## 操作顺序

1. 重新完整查询旧持续规则，确认不会接入fixture；有宽规则冲突则保持原规则并解决隔离，不能擅自暂停用户规则。
2. 创建/注册nonce独立workspace、Project和真实资源；不复用旧演示执行或开发checkout。明确Task/Continuous的codex/gpt-6.1-sol/medium与公开options返回的preset/权限，不修改用户全局stage设置。
3. 在自有PRIVATE仓库a2d2-dev/dsh-plugin创建六项专用Issue，逐份使用本目录正文；把真实number/node_id/数据库id/URL记录到运行ledger。P→C/E原生sub_issues POST使用`sub_issue_id`，值为数据库id，不是node_id。只将P/C/E/A加入自有Project1，保留真实item ID。
4. ledger交叉核对GitHub创建、Project和source.issue。E/X不import。持续计划steps只允许A/B两个真实node；hard标签与node allow-list两重核对后才显式启用。
5. 先无fixture核对升级原数据，再按既定脚本完成双来源canonical、独立子验收、真实native child/job正式收取、自动接续和两项决定新模型复述、Block/暂停/等待让槽/串行、关闭补偿及重启恢复。
6. Task/child模型用真实request/header、usage和actual；辅助计划使用既有运行时真实调用证据，不能拿plan声明或模型自报替代。native正式运行入口与辅助计划trace仍须实际核实，不能伪造。
7. 原18782的1440×1000和390×844实际页面截图、命令exit、IDs/epoch/版本/请求与中文目的/步骤/记录落本目录后续证据子目录。不写secret；不把CDP离线fixture或构建当真实页面验收。
8. 验收后只关闭专用残余Issue、停本run规则，不删用户数据。原externalIndex全部保留，仅允许ledger中批准的新增映射；原规则及新规则原话/plan/Block/版本分别核对。

P/C的完成令和A的RESUME令在各正文中明确；B满足规格后可自动收尾，不因公共模板缺少额外FINISH令而永久等待。真实值不得预填。本文与六正文是任务规格材料，不是通过记录。
