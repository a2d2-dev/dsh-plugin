# Project 视图筛选：is:open 重建不丢 + 关闭项默认隐藏（2026-10-22 17:10Z）

## 现象

「任务清单」视图里出现了 41 个已关闭 Issue。用户指出该视图带了 `is:open` 条件，但重建后条件没了。

## 根因

- GitHub 侧 `任务清单` 视图记录本身的 `filter` 是空的（GraphQL `ProjectV2View.filter = ""`），`is:open` 只存在于保存的来源入口 URL：
  `.../views/1?filterQuery=is%3Aopen+`。
- 面板在 `state.viewNumber === null`（首次进入）时用入口 URL 的 `filterQuery`；一旦从下拉里选了视图，就改用 `view.filter`（空），入口的 `is:open` 被丢掉，于是 82 项全量、41 项已关闭出现。

## 修复

1. 选中的视图如果就是入口 URL 里的那个 view，继续使用入口的 `filterQuery`；选别的视图才用该视图自己的 filter。重建/刷新不会丢条件。
2. 对没有筛选条件的视图（如「全部任务」），已关闭项默认隐藏，工具栏显示「41 项 · 已隐藏 41 个已关闭」，并有「含已关闭」开关可展开到 82 项。
3. 如果视图自己的 filter 明确写了 `is:closed`，关闭项始终保留，不会被本地开关藏掉。

## 实测（18783）

- 首次进入 / 选「任务清单」：**41 项**（上游 `is:open` 生效，未出现已关闭）。
- 选「全部任务」：**41 项 · 已隐藏 41 个已关闭**；勾选「含已关闭」后 82 项。
- 截图：`project-isopen.png`。

源码 `feat/project-field-values` @ `37bb7c0`；18783 client `36c258d7…`。
