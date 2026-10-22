# 接续页字体/风格与 Trajectory 对齐 + 处理会话表单说明（2026-10-22 16:10Z）

## 结论先说

**不是故意的。** 会话详情页里的「接续」是插件注册的 `conversation.view`，它复用了 `ExecutionContinuation`，但这份组件没有自己定义字号，在宿主会话页里就直接继承了正文的 16px（`h2` 还是自己的 18px）；而 Trajectory 用的是宿主的 12/13px 表格刻度。于是同一页里「接续」显得又大又散，跟旁边的轨迹完全不是一套。

控制面板内部的 13px 紧凑刻度是有意的；出问题的是**原生会话页这一处没有自己的刻度**。

## 改了什么

- `execution-native.tsx` 给原生占位加 `nativeView`，把整块固定到宿主的 `--dsw-font-xs-13`（13px/20px），标题降到 15px；不再继承对话正文的 16px。
- `接续` 的参数从「两列 dl + 大间距」改成带分隔线的键值表：标签 12px/18px、值 13px/20px、行底 1px 分隔线（`--dsw-font-xxs-12` / `--dsw-font-xs-13`）。控制面板里的「接续」tab 同步变成这张表。
- 窄屏 520px 以下保留两列但收紧到 96px。

对照：`cont-before.png`（16px 平铺）→ `cont-after.png`（13px 表格）；`trajectory.png` 是同一会话的轨迹页参照。

## 会话页「A²D² 接续」：左右两栏

- tab 名从「接续」改成「**A²D² 接续**」，和 Chat / Trajectory 区分开，明确这是插件视图。
- 左栏：任务卡片（项目名 / 标题 / 当前协调身份），下方是「返回工作详情」「刷新观察」两个跳转按钮。
- 右栏：接续配置（参数表），主操作「准备接续 / 重试本次接续」在右栏顶部右侧。
- 760px 以下自动堆叠成单栏。见 `cont-split.png`。

## 接续主操作的位置

「准备接续 / 重试本次接续」原来挂在整段事实的最下面，而页头的「返回工作详情 / 刷新观察」在上面，主次颠倒。现在它和「接续」标题同一行、靠右上，底部副本删掉；用宿主的 brand-primary 填充色，和其他主按钮一致。见 `cont-action-top.png`。

## 处理会话表单：现在四项都能选

上一版把「Agent 预设」和「权限」固定成宿主默认，理由是「只认证继承的选项」。这个契约不对：正常新会话能选的东西，从 A²D² 进来也应该能选。本轮把契约改成**宿主目录即权威**：

| 字段 | 现在 | 18783 实测选项 |
| --- | --- | --- |
| 工作目录 | 下拉 | 4 个 |
| 模型 | 下拉 | 2 个（18780 上 60 个） |
| Agent 预设 | 下拉 | `standard` / `ptc` / `minimal` / `cordis` |
| 权限 | 下拉 | `read-only` / `workspace-write` / `danger-full-access` |

- 宿主适配器 `choices()` 现在返回 `agentPresets.list()` 里已激活的 preset 和 `permissionPresets.names`（去掉派生的 `auto`），默认值仍是宿主默认。
- 工作层保留成员校验；宿主仍会拒绝目录外名称（`invalid-permission-preset`）。契约测试改成：任意伪造 preset 被拒，`danger-full-access` 现在是真实可选项，而不是「先展示再拒绝」。
- 表单说明改成「请确认执行目录、模型、Agent 预设与权限；未修改时使用宿主与项目的默认配置」。
- `start-form-all-selects.png` 是四项全下拉的样子。

需要提醒的是：选 `danger-full-access` 会按宿主该 preset 的审批策略运行（通常是 `never`）；`minimal`/`cordis` 这类 preset 的工具集与 `standard` 不同，A²D² 的 `work_report`/`work_control` 工具未必在，选之前心里有数。

## 构建

- 源码 `feat/project-field-values` @ `c76b5d4`（PR #170，Draft）。
- 18783 已换装：client `0f1c2cdaf3f80dffaba3e67ebbc48c88b8a36be2967e91c58c534f02e573cb07`。
- 18780/18781 仍是用上一轮的 `cf5c0986…`，没有跟进本轮样式；需要时说一声再切。
