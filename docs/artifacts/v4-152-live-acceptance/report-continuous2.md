# #152 持续委托第二轮真实验收

## 目的与当前结论

仅在 preview http://10.126.126.12:18782/，以 run `v4-152-6b252218-r01` 的 A=#160、B=#161、X=#162 验证真实模型计划、Block、预览不执行与串行让槽。使用 agent-browser 技能及单标签会话 qa152g。未改业务代码、插件、Host、profile 或 P/C/E。

本阶段已取得真实模型计划 v1：A→B，X 不在 steps。规则由 v2 经保存补充变为 v3，真实预览后为 v4；Block X 成功后 v5，中文纠偏成功后 v6。计划 v1 的两步 mode 均为 wait，因此已用自然语言要求启用后的可执行新建/复用模式，第二次真实预览正在进行。尚未启用，未宣称串行或完成通过。

## 步骤与记录

1. 在锁定目录确认 `test/152-preview-live`。默认 `git pull --ff-only` 报 `Cannot fast-forward to multiple branches`；显式 `git pull --ff-only origin test/152-preview-live` 成功且 Already up to date。
2. 登录指定 preview，接受 Preview Notice，进入仓库来源，点击 summary“持续委托”。旧原话完整保留；保存补充明确 A/B、X 排除、隔离目录及各自 proof。
3. 03:41Z Task 基线：6 项，包含已有 P，无 A/B/X；隔离目录只有 README.md 与 E.proof.json，无 A/B/X proof。浏览器初始化产生的空白 New Session 在预览前，不能算预览执行。
4. 03:42:35.841Z 发真实 `continuous.preview`，HTTP200，耗时 68368.8ms，计划创建于 03:43:41.225Z。浏览器 CDP 的 Runtime.evaluate 超时不等于服务失败；原 fetch 继续，随后从内存取回完整请求/响应。
5. 首份计划 v1，draftVersion=2，来源完整 snapshot sourceVersion=3。A、B 每项均有 why 与 nextAction，说明先核实 canonical 映射、存在则复用、不存在才新建。X 未入 steps；模型文字说列入 Block，此时实际 blocks 仍为空，不能将文字当持久 Block。
6. `continuous.block` 正式命令为 X node `I_kwDOUmfSE88AAAABY_H6TA` 写 blocked=true，HTTP200，规则 v5，blocks=[X]。随后保存中文纠偏，HTTP200，规则 v6 / draftVersion=4，Block 保留。第二次真实预览于 03:45:51.427Z 开始。

## 首份计划完整要点

| 顺序 | Issue / node | mode | 纳入理由与下一步 |
|---|---|---|---|
| 1 | A #160 / I_kwDOUmfSE88AAAABY_H0fQ | wait | 指定仓库、imneov、serial 标签；A 在 B 前。启用后先核实映射，按真实身份保存规格/in-progress，等待真实 RESUME-A 并让槽；恢复后 JSON/数量3/stable/SHA256 验收及关闭协同。 |
| 2 | B #161 / I_kwDOUmfSE88AAAABY_H3PQ | wait | 同硬范围，排第二；A 安全让槽后取得槽，核实映射，新建或复用 B 自己的会话，仅写 B proof，真实校验并请求关闭且读回结果。 |

原始 why/nextAction 与版本依据保存在同目录 ledger-continuous2.json 的 raw 数组。实际模型 request/usage/路由尚待宿主只读证据核对；此处不以配置 codex/gpt-6.1-sol medium 冒充实际调用日志。

## 待续验收

第二份计划、Task/Session/proof 完整差分、Block 后纠偏排除、越界拒绝、显式启用、A-wait→B-start→B-done→A-resume→A-done、CompletionOp 与 GitHub 关闭回执、暂停在途边界、双尺寸截图尚未收口。
