# #121 最终产品验收证据

产品包固定 SHA256：`81466a33342c0256873bbf30dac693ee0cff2c075246a4ad859d94663ce0a82b`；产品代码修复提交 `433e9860ca76026a05d001c0552da0a4b45c84bf`。

当前记录：

- [新版 guard 正控](positive-guard/positive.json)：真实 gateway／adapter 均 `0→1`、唯一 finish/error，正控实例已清理。
- [固定 8d33081 工具的动态 Origin 尝试](attempt-dynamic-origin/README.md)：UI 原文／criteria 三路径、blank 轻入口、当前同 Session 无刷新新增子工作链接、两 Project 工作身份、拆解父子、HTTP 边界、刷新与重启后冷态公开列表（0 个可用 Agent）的完整领域查询均通过。但 `--port 0` 每次重启换 Origin，原生首用选择恢复自动新增 Session，严格集合断言失败；不得把该污染 root 标为通过。
- [本轮固定工具与产物指纹](fixed-tool-and-package-hashes.json) 保留当时 checkout／工具 SHA，不随后续工具修复改写。

CEO 已确定后续方案：首次真实启动分配空闲端口，同 root 重启复用实际已记录端口；被占用或命中保护端口时明确拒绝，不静默换端口。不改宿主或产品。等待指定新工具提交后，使用另一 fresh root 和同一产品 tgz 补做稳定 Origin 的真实重启；同一包已通过的原文和 R5 UI 证据保持有效。

所有旧失败目录和临时污染 root 保持原样；动态 Origin 轮次的正式 Web jobs、正控及专属浏览器均已停止并收集。最终总验收结论暂不通过，待补充稳定 Origin 结果。
