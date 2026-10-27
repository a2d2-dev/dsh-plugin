# #141 集成验收状态与证据索引

## 目的

对应 [Issue #141](https://github.com/a2d2-dev/dsh-plugin/issues/141)，保持“更新既有 DSH 实例、保留数据和会话、完成真实模型与全流程页面验收”的原目标。九条原始验收标准已完整保存为本地 Task 规格 v2；本文件只记录准备结果，不替代最终验收。

本次核对时间为 2026-10-26 America/Los_Angeles，公开身份快照采样为 `2026-10-27T00:01:32.002Z`。记录分支从 `origin/main 62ded4e9cae21869a435e14c10eba86d03ed4d50` 创建。

## 前置接受状态

| 原实现票 | 本地验收与 GitHub 状态 | 可复用证据 |
| --- | --- | --- |
| [#137 来源](https://github.com/a2d2-dev/dsh-plugin/issues/137) | 本地 Task 有 completion；Project Done；Issue Closed | 本次仅核对接受事实，原始来源全链路证据仍需映射到最终整合版本。 |
| [#138 执行与接续](https://github.com/a2d2-dev/dsh-plugin/issues/138) | 本地 Task 有 completion；Project Done；Issue Open 等待人工关闭 | [整票报告](issue-138-execution-acceptance.md)、[权限恢复报告](issue-138-permission-recovery.md)、已合并 [PR #279](https://github.com/a2d2-dev/dsh-plugin/pull/279)。已抽查真实固定后继／epoch 2／retired 事实、材料截图与匹配宿主日志。 |
| [#139 完成补偿](https://github.com/a2d2-dev/dsh-plugin/issues/139) | 本地 Task 有 completion；Project Done；Issue Closed | 已合并 [PR #244](https://github.com/a2d2-dev/dsh-plugin/pull/244)、[完成架构与验证接缝](../architecture/v4-completion.md)。原始报告明确真实 GitHub mutation 为零，不能替代 #141 的真实关闭补偿。 |
| [#140 持续委托](https://github.com/a2d2-dev/dsh-plugin/issues/140) | Issue Open；Project Status 为空；当前本项目列表未包含对应 canonical Task | 尚未核得九条标准的最终接受结果，保留为最终整合验收的前置缺口。 |

Issue Open 与工作未验收分别判断。#138 已验收，不因等待人工关单要求其重做。#140 的缺口是最终接受证据尚未核得，不能仅凭 Open 推断，也不能凭已有实现、计划或 PR 合并补写完成。

## 本轮步骤与实例记录

1. 完整读取受信来源与规格，补齐结构化九条标准，保持原 Issue 前置与边界。没有创建本地子 Task。
2. 复核已有报告和原始材料，不重复已经通过且本轮未影响的测试。当前没有最终冻结版本，因此本轮没有跑 typecheck、构建或回归，不宣称新的测试通过。
3. 通过 `agent-browser` 进入现有 DSH，打开已有 DSH A²D² 来源概览。使用公开查询保存 Project／Task／来源身份及当前协调会话权限；没有直接读取或改写宿主私有会话／工具存储。
4. 保存并逐图查看 1600×1000 和 390×844 概览截图。窄屏 document/body scrollWidth 均为 390；这个结论限于概览，不代表持续委托或全部页面合格。
5. 原 Project「DSH A²D²」的 #141 Status 已更新为 In Progress 并回读；Issue 仍 Open。没有启动模型、生成或启用计划、创建测试 Issue、修改 freeland 对象或重启部署。

当前服务仍为 Supervisor `dsh-web-server`，检查时 RUNNING，服务 checkout 为既有 `v4-141-release-8282d612`。实际 Web profile 安装 `@a2d2/dsh-a2d2@0.0.23` 的 file tarball，发布目录 `continuous-dispatch-290-6cec40f`；不是历史文档中的源码 link。实际浏览器 boot rev 为 `28bcc008c752`，插件 client rev 为 `4719d58fb065`。访问沿用现有 [DSH 域名入口](https://dsh.e5box.a2d2.dev/)，没有另起服务。

该发布目录对应的 [PR #292](https://github.com/a2d2-dev/dsh-plugin/pull/292) 检查时仍 Open，Node22／Node24／secrets 成功。这是检查时的部署事实，不是最终候选已合并、整体已验收或生产上线声明。原 [PR #148](https://github.com/a2d2-dev/dsh-plugin/pull/148)／[PR #149](https://github.com/a2d2-dev/dsh-plugin/pull/149) 当前 Closed 且没有 mergeCommit，也不能按历史交付候选直接算合并。

`dsh-web-watch` 虽 RUNNING，但它的 checkout 与服务 checkout 不同，不承诺当前 checkout HMR。此次只做身份准备快照，没有升级，所以没有升级后数据差分或本轮回滚成功的证据。

## 九条标准的剩余验收

| 原标准 | 尚需完成的证据 |
| --- | --- |
| 1. 固定整合提交、typecheck、相关回归、完整构建与实际包导出 | 冻结最终整合版本，复用适用证据并跑受影响检查；每个失败先核环境和断言再裁决。 |
| 2. 更新既有实例及链接、构建、Supervisor、URL、刷新版本 | 记录最终制品、安装挂载及刷新后的实际加载版本；保留当前同实例入口。 |
| 3. 原 Project／Task／来源／会话／权限与可执行回滚 | 补齐全部旧数据逐项清单、升级前后差分及当前候选可执行回滚。当前快照只覆盖公开项目身份、本项目 Task/来源及当前执行权限。 |
| 4. agent-browser 全目录、跨来源复用、子 Issue、执行、job、待确认与历史 | 将 #137/#138 有效原始证据映射到冻结版本，补齐最终整合场景。 |
| 5. 真实模型决定保留、接任、旧段失权与失败／待收恢复 | 复用已核 #138 的固定后继和决定材料，补核待收结果与正式接任的完整组合证据。旧协调失权不封禁人工对话。 |
| 6. 真实自然语言计划、预览零执行、Block／暂停、两项串行与关闭／重启恢复 | 核得 #140 最终接受结果，逐项补齐真实模型／浏览器／持久记录；不以历史失败后的时间线声明代替原始记录。 |
| 7. 专用对象本地验收与远端关闭补偿 | 用专用对象验证真实关闭失败／未知回执／补同步及不重跑，保留 freeland 业务对象。合同 GitHub port 不是该证据。 |
| 8. 双尺寸截图和中文报告 | 本轮准备报告与概览基线已有；全流程目的／步骤／记录与产品限制仍须补全。 |
| 9. 一轮 fresh 安全评审整改、PR／tracker 与验收一致 | 核对单轮评审及整改对最终版本的覆盖；只按实际验收和合并事实收口。 |

## 2026-10-27：queue Block 进入规划依据的最小修复

目的：修复暂停 queue 已有 `rule.blocks`、尚无 planning 时，保存委托后预览只读取空 `planning.blocks` 的现场缺口。基线为远端已核 `main eb0a772563aee7d04691f52531ddb74a73482113`，独立分支 `fix/141-preview-block`；本轮不部署、不启用真实规则、不写 GitHub，整体验收状态不因本修复改变。

步骤与记录：

- 先复用真实 `WorkApplication` fixture，连续执行 configure queue（暂停）→Block→instruct→preview，捕获 planner basis。修复前 new/existing 两个分支均出现 `blocks=[]`，并错误接受被 Block 的步骤为有效计划，原规则名单仍保留。既有手动执行的关联只要求预览前后不变，不要求消失。
- `planningBasis` 每次通过既有 `continuousBlocks(rule)` 读取 queue 与 legacy planning 的合并名单，让模型输入、提交前 fingerprint 重验和 `validatePlan` 共用同一依据。无需初始化复制或改动存储；不清旧 Block、旧计划，不迁移 UI。既有 `planning-blocked-issue` 契约保持，包含 wait 的现有拒绝逻辑不变。
- 增补混合旧记录恢复场景：两个字段分别保存不同 Block，预览必须同时传入并拒绝两项；原委托、补充、旧计划历史与原名单保持。
- `pnpm exec vitest run tests/work-continuous.spec.ts -t 'pre-instruction queue Block|union of saved legacy'`：3 passed；`pnpm exec vitest run tests/work-continuous.spec.ts tests/work-planning.spec.ts tests/work-planning-payload.spec.ts tests/work-native-relationships.spec.ts tests/work-continuous-integration.spec.ts`：5 文件、157 passed；`pnpm typecheck`：exit 0。

原始日志位于本独立工作树忽略目录 `docs/artifacts/issue-141-preview-block-2026-10-27/`：`red.log` 为改生产代码前的失败证据，`green-final.log` 为三个最小回归通过，`affected-tests.log` 为受影响测试，`typecheck.log` 为类型检查，`install.log` 为锁定依赖安装。中间 `green.log` 如实保留测试对手动执行关联的错误假设，随后已改成验证关联不变。真实模型和既有实例的复验由父任务继续，本轮没有替代该证据。

## 原始材料与下一步

准备报告、筛选后的身份快照及截图保存在本工作树忽略目录 `docs/artifacts/v4-141-2026-10-26/`。原始 Session 截图、日志、认证文件不进入 Git；本文件只保留不含凭据的结论与索引。

当前 #141 未通过整体验收，不关闭。下一步是核得 #140 完整接受结果与整合候选，然后重新核对当前实例和数据基线，在专用对象补齐上述剩余场景。原历史 #152 报告中的失败、未知和未验证均保留；不将旧预览环境的部分成功扩写为当前产品整体验收。
