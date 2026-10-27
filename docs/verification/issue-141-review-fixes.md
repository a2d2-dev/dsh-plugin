# #141 本轮 fresh 审查 P2 整改

固定基线：`e0198e3249cac5ae0bd21986ce2329cf5d021965`。独立分支 `fix/141-review-findings`。仅处理本轮两项 P2，原九条验收保持不变，不增加 review 轮。

## 根因与改动

- P2-Spec：概览和复用入口共用的 `currentSession()` 将执行状态白名单当作会话存在条件，因此真实已创建的 failed Session 被隐藏。改为沿用 #223 的实际身份条件：actual 存在、TaskRef 匹配、Session 引用非空且 runtime 匹配。未创建或身份不符的引用仍不可进入。进入会话只导航，不执行 start/reconcile/resume，不改变 owner、epoch、控制请求或启动 guard。
- P2-Standards：`task.link-child` 只检查 child 有 ExternalBinding，不能证明它是父 Issue 的原生 sub-issue。新增小型共享判断 `isAcceptedNativeChild()`，证据明确选用父 binding 的 `acceptedChildren ?? accepted.subIssues`，要求完整范围（无下一页、总数与唯一项一致），并核对 child binding 的 nodeId、仓库 owner/name 与 Issue number。`lastObserved` 仅观察不自动扩大必要范围；新观察须按既有 `source-children` 接缝完整读取并显式采纳。真实跨仓库 native 引用允许，但不能借同编号、同标题或 nodeId 搭配错误仓库伪造关系。
- 同一原生关系判断用于既有本地边的完成过滤，避免历史上两个已有 binding 的独立根 Issue 被伪边额外设为完成门。无 binding 的 local-only 子记录已有迁移与过滤，本次不重复改造。原生必要子项仍走既有独立验收门。
- 更新旧测试中用 root Issue 冒充 child 的 fixture；保留独立验收、导入去重、冲突不写入和真实 native notice/job_output 断言。历史冲突通过旧持久格式 fixture 表达，不再调用当前命令创建无效关系。

## 验证目的、步骤与记录

全部测试使用 `TMPDIR=/data/_ssd2t/dsh/tmp/v4-141-review-fixes`，已核实该路径无 `.git` 祖先。测试依赖来自现有验收树，只读逐项链接依赖；本树持有 `node_modules` 目录，`.vite`、`.vite-temp`、`.cache` 不链接共享目录。最初整目录链接存在 Vite 缓存路径共享风险，发现后已改为上述结构；没有更改依赖包或 live 配置。

先添加回归、运行观察真实失败，再做最小修复。日志保存在本树被忽略目录 `docs/artifacts/v4-141-review-2026-10-27/`：

| 记录 | 结果 |
| --- | --- |
| `spec-red.log` | 1 failed：actual/ref/runtime 均匹配的 failed Session 返回 null |
| `spec-green.log` | 3 文件、42 passed：controller、SSR 入口及零命令副作用，未创建和身份不符负例 |
| `standards-red.log` | 1 failed：独立根 Issue 被 link 成功 |
| `standards-link-green.log` | 18 passed：修复 link 后的原生验收回归 |
| `standards-legacy-gate-red.log` | 1 failed：历史 bound 根 Issue 伪边导致 unfinished-child |
| `standards-legacy-gate-green.log` | 2 文件、22 passed：历史伪边忽略及既有 local-only 迁移 |
| `standards-green.log` | 3 文件、42 passed：未知/部分/重复/身份伪关系拒绝，真实 child 显式采纳、链接与独立验收 |
| `regression-first.log` | 129 文件；1541 passed、2 failed，均为原来创建伪边的旧 fixture，随后更新 fixture 保留原断言 |
| `spec-green-attempt1.log` | 首次扩大验证 41 passed、1 failed；原生导航会清理临时启动表单错误，测试改为精确核验持久 execution.error，并完整比较执行及控制事实 |
| `typecheck.log` | 服务端与客户端 TypeScript 检查通过 |
| `regression-focused.log` | 8 文件、131 passed：所有受影响的 controller/渲染、来源导入与完成门回归 |
| `regression-green.log` | **129 文件、1543 passed**，157.67 秒；默认 unit/host 全套通过 |
| `build.log` | 服务端、客户端声明与客户端 bundle 构建通过 |
| `matched-host-first.log` / `matched-host.log` | 额外 lane 1 failed：先发现旧 fixture 缺原生准入观察，补齐后在原有 `registry.observe` 能力断言失败（当前普通依赖返回 undefined），未进入后续匹配宿主作业验收路径 |

没有增加 timeout 或放松原有验收断言。matched-host 必须在既有匹配 Host 8282 四制品环境补验，本轮不冒称通过。

## 集成与产品限制

本轮不修改主验收树、共享主仓源码、live 服务、profile、凭据，不运行浏览器，不写外部 Issue/Project，不创建子 Task 或新运行器。PR 到 main 但不自动 merge；主会话负责集成及原 URL 最终验证。需在原入口确认：failed 已创建会话的概览与复用导航、导航不自动恢复、未创建会话仍隐藏入口，以及原生子项独立验收和父完成门。

主存发布 P1 不在本轮新增范围。原 #141 criterion 7 与已接受 v4 规格沿用“本地验收 + 独立远端关闭补偿”；最新 ADR 0003 的完整主存发布协议是目标迁移决策，本次未实现，不能声称主存自动发布已完成。
