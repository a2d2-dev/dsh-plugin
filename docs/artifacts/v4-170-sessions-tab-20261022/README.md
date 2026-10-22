# 「会话与执行」信息层级重构（2026-10-22 15:00Z）

入口：面板 → DSH A²D² Project → Issue #105 → 会话与执行。
问题：页面把当前会话、每一个后台作业的完整命令、每条输入/结果全文、子 Issue 全部平铺展开（#105 这一页正文约 12,351 字符），重点（当前协调会话与状态）反而被淹没。

## 现在的结构

```
会话与执行   [空闲]  session-47be3730  [查看会话]
代次 2 · 协调负责人：aafc7c96… · Agent 02d20bab…
┌ 7053e9de… / session-47be3730-… ┐   ← 当前会话完整身份 + turn
└ 第 1 次 turn · 已中止           ┘

▸ 后台作业 · 19 · 1 个非零退出
▸ 原生子 Issue · 2
▸ 输入与结果 · 1
▸ 历史会话与尝试 · 1
▸ 执行尝试记录 · 只读 · 3
```

- 当前会话是唯一默认展开的块：状态、短会话号、`查看会话` 动作、完整 `runtimeId / sessionId`、turn 与原因（`aborted` → 已中止）。
- 其余全部收进 `<details>`，summary 带数量；空的分组不再渲染（不再出现「尚无独立子工作」占位）。
- 后台作业每行一条：`bash-N · 状态 · [非零退出] · 命令首行（省略号）`；展开后才有执行者、交付/消费状态、完整命令、Registry/Instance。
- 输入与结果每行一条：`输入/结果 · 投递状态 · 未验收 · 首行`；展开后才是全文（可滚动的等宽块）。
- 历史会话（只读）折叠在「历史会话与尝试」里，它自己的 69 个作业再收在嵌套的「后台作业 · 69」中。

## 证据

- `sessions-before.png`：改动前，#105 页面被 bash-2…bash-6 的完整命令和 task prompt 占满。
- `sessions-collapsed.png`：改动后默认视图，一屏能看到当前会话 + 全部 5 个分组。
- `sessions-jobs.png`：展开「后台作业 · 19」，每行约 27px，深色/浅色均用状态底色。
- `sessions-native.png`：展开「原生子 Issue · 2」与「历史会话」。
- `sessions-dark.png`：深色主题下的默认视图。
- 单测：`tests/client/execution-components.spec.ts` 增加分组计数断言（`后台作业 · 1`、`独立子 Issue / Task · 1`），与 `v4-integrated-render`、`work-panel-render` 一起通过；`pnpm typecheck` 通过。

## 构建

- 源码：`feat/project-field-values` @ `0835e61`（PR #170，Draft）。
- 构建：`/data/_dsh-builds/v4-170-ui`，client `cf5c0986bf4291bdbc4f3117cee055bad2ea881dec52277727b95ed444b5003b`；18783 已换装，client rev `0c0e1e02d63e`。

## 已知边界

- 作业的 `label` 就是完整命令，summary 只取首行 96 字符；完整命令在展开后的等宽块里。
- 分组是纯展示折叠，不改变任何事实或动作；「查看会话 / 只读历史 / 查看子工作」等动作仍在。
- 390px 下宿主面板本身有最小宽度，右侧仍会横向滚动（本轮未改宿主布局）。
