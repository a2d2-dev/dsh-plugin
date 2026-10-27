# #140 自然语言持续委托验收

## 目标与口径

工作身份为 [Issue #140](https://github.com/a2d2-dev/dsh-plugin/issues/140)，实现与验收 PR 为 [#298](https://github.com/a2d2-dev/dsh-plugin/pull/298)。LF 已在本票协调会话明确选择沿用后续 #265 的独立页签、单队列、可配置并发和无逐轮计划审批界面。原目标及九条有效标准保存在 [验收口径](../specs/issue-140-queue-acceptance.md)，并已同步原 Issue；没有用旧界面要求判定当前产品回归。

本次源码基线为 `d927fb0cfdb0bfcf8f071adc1eeae6e9b5a9a189`，已整合主干 `0e241cb` 的恢复和单项结束修复。现场安装包来自 `continuous-repair-299-301-cff99bb`；`git diff --exit-code cff99bb -- src` 退出 0，全部生产源码与本次候选一致。使用既有 DSH 实例，没有另起验收服务器。

## 实际变化

- 新队列可独立保存 Block／解除 Block，兼容旧计划中的排除项；Block 和暂停不更换在途 owner、epoch 或 Session。
- Project 查询直接读取原生阻塞依赖；仓库候选及普通刷新补齐父子与依赖事实。未知、部分或身份不一致的关系不能视作已满足，外部 Closed 也不能替代已导入 canonical Task 的当前规格验收。
- 真实模型筛选接收 Issue 正文、canonical Task 已确认要求、进展及既有执行；上下文截断明确标注，事实变化会作废旧判断。
- 原话原样保存。筛选依据、授权和决定进入既有冷归档；常规队列状态只留最新紧凑引用，完全相同的输入和判断复用归档，通过显式 `continuous.review` 读取完整依据。
- 仍使用原调度器、同一 Project 队列和既有 Task／会话入口，无手动上移下移。

## 验证目的与步骤

在专用仓库来源下创建仅含简单 Python 断言的 [#295 A](https://github.com/a2d2-dev/dsh-plugin/issues/295)、[#296 B](https://github.com/a2d2-dev/dsh-plugin/issues/296)、[#297 C](https://github.com/a2d2-dev/dsh-plugin/issues/297)。标签固定为 `qa-140-20261026`，执行目录为专用空目录，真实模型为 `codex/gpt-6.1-sol`，并发上限 1。没有接入 freeland 业务工作。

1. 浏览未配置队列，确认没有 QA Task／执行。通过实际设置表单保存原话、标签、资源、模型及权限，仍保持暂停。
2. 真实模型读取三项正文，三项均命中，理由明确引用 Python 断言及禁止业务修改。模型筛选完成时执行数仍为零。
3. 用页面操作 Block C、解除、再次 Block；公开持久记录分别反映排除和解除，C 始终没有 Task／执行。
4. 显式继续，A 取得唯一名额；A 在途时暂停后续。A 保留原 owner／Session 并完成，B 不启动。
5. 关闭并重新打开浏览器，核对队列、原话、授权、C 的 Block 和 A 原身份保留。
6. 保存 A 已验收且收口、B 未开始、C 被 Block、队列暂停的记录，通过旧有 Supervisor 独立入口重启同一 DSH。重启后服务 PID 从 `3174546` 变为 `3425069`，为 RUNNING，原页面可用。重启前后断言全部通过，暂停状态下 B 仍未启动。
7. 在页面显式继续后，B 才取得名额；B 在途时再次暂停后续，B 正常完成。最终 A／B 均验收并收口，槽位为 0，C 从未执行，队列保持暂停。
8. 从队列的既有会话入口进入 B 历史会话，在 Trajectory 中抽查原始 bash 响应，实际值为 `QA140_SERIAL_OK\nQA140_EXIT_CODE=0\n`，不是仅依据模型总结。
9. 保存并逐图检查 1600×1000 和 390×844 实际截图；窄屏 document／body scrollWidth 均为 390，队列宽 297，内容正常换行，无页面横向溢出。

新 `dsh-restart` skill 在验收后段已可见，但 helper 路径当时尚不存在。该轮只查询既有重启结果，遵守其“不为查询安装或再次申请”的规则；上面的既有重启通过实际服务 PID、RUNNING、原页面及持久状态比对确认，没有冒称取得新 helper 的 succeeded 回执。

## 真实记录

| 对象 | Task／Session | 验收结果 |
| --- | --- | --- |
| A／#295 | Task `aa938d76-1087-4dbf-8737-e7d1dcc09066`；Session `session-3494ab44-d832-47db-a189-eddf491755bd`；owner `b65936b2-2357-49df-8606-ab731cc3d34b`，epoch 1 | 唯一断言通过；正式完成时间 `2026-10-27T05:06:49.300Z`，即北京时间 13:06:49；closeout settled |
| B／#296 | Task `35d2b383-cfc5-44d2-bd2f-ba3bc681c50a`；Session `session-e1afd10d-7b74-47d8-8dcc-5ac29601e3a2` | A 收口并在暂停／重启恢复后显式继续才接入；原始输出与退出码已抽查；完成时间 `2026-10-27T09:28:14.887Z`，即北京时间 17:28:14；closeout settled |
| C／#297 | 无 Task／执行引用 | 持久 Block 保留，未执行 |

A、B 间隔包含人为暂停和重启验收等待，不代表执行耗时或调度吞吐。时间以持久记录中的 ISO 时间为准，截图中的浏览器本地时间仅作界面读数。

## 九条标准与证据

| 标准 | 验证结果与主要依据 |
| --- | --- |
| 1. 原话、授权、设置、依据和 Block 可恢复 | 前后公开快照及恢复断言通过；完整依据冷归档和同输入去重合同通过 |
| 2. 真实模型理解候选与明确失败 | 现场真实模型三项判断及理由；正文／canonical 进展、未知字段、失败／缺失判断合同通过 |
| 3. 明确授权与服务端资格校验 | 浏览和保存后均零 QA 执行，显式继续后才启动；身份、负责人、关系完整性、依赖与竞争合同通过 |
| 4. Block、补充与暂停影响后续 | 现场 Block／解除及在途暂停通过；提示词／正文／进展变化重筛合同通过 |
| 5. canonical 复用与唯一推进 | 跨来源、跨 Project 既有执行接纳及 owner 冲突合同通过；现场重开／重启保留 A 原身份，A／B 各只有一个执行 |
| 6. 等待保留 owner 并安全让槽 | 连续调度和真实宿主 wait／pause／接续／输入资格合同通过；现场暂停保留在途执行并安全收口 |
| 7. 按并发设置推进及竞争恢复 | 现场上限 1、A／B 串行；未知创建／投递回执、并发领取、结束竞争及重启合同通过 |
| 8. 已确认的单队列界面与草稿 | 现场独立页签、真实 Task／会话导航、双尺寸截图；生产组件和慢保存／后台刷新草稿合同通过 |
| 9. 合同与当前实例真实证据 | 完整本地检查通过；现场真实模型、两项串行、Block／暂停、关闭浏览器和服务重启已有持久证据 |

跨来源组合、外部关闭补偿和父票全流程仍按 #141 范围验收；本报告不将本票证据扩写为整个 #141 完成。

## 自动检查

最终生产源码上运行以下完整链，退出 0，原始回执为本协调会话的 `bash-491`：

```sh
pnpm verify:repository
pnpm typecheck
pnpm test
pnpm test:node
pnpm verify:pack-exports
git diff --exit-code
```

- Vitest：129 文件，1523 项通过。
- Node 验收套件：28 通过、0 失败、2 项按原套件配置跳过，没有把跳过项算通过。
- clean HEAD 包：32 个导出目标与 sidecar 完整，安装后 15 个 Node 入口均可导入。
- 本地固定 `gitleaks v8.30.0` 扫描全部 Git 历史：665 个提交、约 78.75 MB，4 分 44 秒完成，退出 0，`no leaks found`（回执 `bash-514`）。
- 独立只读复核发现的普通刷新覆盖关系与热状态重复保存全文问题已修复，并有回归验证；合并最新恢复／结束修复后的类型与 151 项定向检查通过。

GitHub 上早期提交 `dd0c852` 的 CI 曾通过。最终合并提交 `d927fb0` 的两个工作流均未启动任何步骤，GitHub 注释明确为账号付款失败或支出额度不足；这不是测试失败，也不表述为当前 Node 22／24 远端矩阵通过。详情：[Actions run](https://github.com/a2d2-dev/dsh-plugin/actions/runs/40449096539)。本地完整链使用 Node 22.23.1。

## 证据保留与状态

原始截图、公开查询 JSON、复验脚本和回执摘要存于本工作树忽略目录 `docs/artifacts/issue-140-2026-10-26/`。主要索引：`qa-screening-check.json`、`qa-blocked.json`、`qa-unblocked.json`、`qa-before-enable.json`、`qa-a-active-paused.json`、`qa-browser-reopened.json`、`qa-before-restart.json`、`qa-after-service-restart.json`、`restart-verification.json`、`qa-b-active-paused.json`、`qa-serial-result.json`、`serial-verification.json`、`b-original-command-results.json` 及对应截图。认证状态不进入 Git 或公开报告。

本票功能验收通过。PR 与 Task／Project 的最终状态以链接及接受回执为准；原 Issue 保持 Open，最终关闭由 LF 完成。
