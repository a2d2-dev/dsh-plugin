# #168：持续扫描后范围采纳与完成回归

## 问题与修复

[Issue #168](https://github.com/a2d2-dev/dsh-plugin/issues/168) 的周期扫描会用等 `updatedAt`、缺少 `subIssues` 的列表观察覆盖完整 Issue 详情，导致 `source-children` 使用原观察时间采纳时返回 `source-observation-superseded`，完成门又因缺少原生范围返回 `native-child-scope-incomplete`。

[PR #169](https://github.com/a2d2-dev/dsh-plugin/pull/169) 已于 2026-10-23 合并修复 `fbc0841`。三个扫描入口共用 [观察合并逻辑](../../src/work-sources/observations.ts)：相同或更旧版本不替换绑定观察，更高版本仍更新观察并保留缺省的已知原生子字段。可信详情读取负责刷新完整关系。本次补全采纳与完成的集成回归，业务实现不变。

## 验收要求

- 完整详情读取后，插入同版本且缺少 `subIssues` 的扫描，原观察时间仍可用于采纳。
- 原生范围未采纳时，完成门仍拒绝；采纳后其他条件满足，持续规则保持启用时可以完成。
- 仓库候选扫描、Project 发现和普通来源列表刷新三个入口均满足上述行为。
- 更高 `updatedAt` 的真实内容更新仍使旧观察失效。

## 回归步骤

[观察刷新测试](../../tests/work-observation-refresh.spec.ts) 新增两组参数化测试，共六例，保留原有两例。

1. 通过 `WorkApplication` 导入缺少原生范围的 Issue，保存规格并启动协调者。
2. 调用 configure → instruct → preview → enable 建立实际持续规则，检查规则和启用计划。
3. 提交 done，断言 `native-child-scope-incomplete`，确认完成门生效。
4. 经可信相关 Issue 入口读取完整原生范围。
5. 分别经三个扫描入口写入等版本稀疏来源观察，并核实扫描确实发生且未返回子范围。
6. 用步骤 4 的观察时间采纳，提交 done 并核实持久化完成记录；规则仍开启。
7. 另测三个入口的更高内容版本，断言旧观察采纳失败且不产生完成记录。

测试使用确定性的 GitHub 与会话宿主端口 fixture。来源刷新、持久化、持续规则、采纳与完成门均使用真实应用实现；此层证据不等同于浏览器或外部 GitHub 关闭操作。

## 验证记录（2026-10-28 UTC）

| 检查 | 结果 |
|---|---|
| `pnpm exec vitest run tests/work-observation-refresh.spec.ts` | 8/8 通过 |
| `pnpm exec vitest run tests/work-sources.spec.ts tests/work-continuous.spec.ts tests/work-native-acceptance.spec.ts tests/github-project-source.spec.ts` | 160/160 通过 |
| `pnpm typecheck` | 通过，包含最终新增 fixture |
| `pnpm build` | 通过 |
| 临时回退观察合并逻辑，运行三个正向采纳用例 | 三例全部按预期失败，明确返回 `source-observation-superseded` |
| 恢复修复并复跑 | 8/8 通过，业务源码无差异 |

临时回退仅发生在隔离工作树，未安装到运行实例。该反向验证说明测试可以捕捉原始故障。

## 开发实例验证

使用 `agent-browser` 在授权开发实例完成登录、打开持续委托、刷新来源和查看 #168。

- 持续委托显示已开启，没有使用暂停扫描的历史绕过办法。
- 可信来源工具于 `2026-10-28T05:53:39.720Z` 返回完整空子范围，Issue 内容版本为 `2026-10-22T09:37:09Z`。
- 页面执行真实“刷新来源”后，使用上述原观察时间执行 `source-children` 成功，任务版本 5→6。
- 开发实例已安装的扫描模块与最新主干构建逐字节一致，SHA-256 为 `1b9b1b35438b302d968c670d4cc66f1a1da7c3b925a613adf683490c9ca9cf02`；工作和来源入口产物也相同，无需重复安装或重启。

原始日志、页面截图和运行实例细节保留于本次私有验收产物目录 `docs/artifacts/issue-168-20261028/`，按仓库忽略规则不提交公开 Git 历史。Issue 是否关闭与业务验收分别记录，最终关闭由 LF 执行。
