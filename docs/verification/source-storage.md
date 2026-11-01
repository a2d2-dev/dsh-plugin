# 来源存储验收摘要（Issue #346）

来源正文与 checkpoint 分开；分页只写新增/变化的 checkpoint item/issue 及进度 metadata，原子控制 head 保持恢复语义。完整扫描结束仍可能新增正文版本，离线维护接口仅回收不可达归档。接口及备份、恢复步骤见 [Work DAO 架构](../architecture/work-dao.md)。

真实 NVMe 基准采用固定旧 DAO `f39d93e45915a71b331c4a31b250dbd6372f3e7e`：20,315,567 B 来源正文、17,248,700 B 已累计 checkpoint，五页各追加一条20 KB Issue，包含 reservation 的完整 source clone。新增 archive 写入188,126,035 B降至102,485 B（减少99.9455%）；控制752 B。该轮耗时5476 ms降至3266 ms。可复现命令：

```sh
node --experimental-transform-types scripts/benchmark-source-storage.mjs
```

全量 vitest 1643项通过、1项跳过；最新 main（含 Issue #341 continuation）的5文件集成回归95项通过；typecheck、build、独立 tarball 安装并 import 15个Node入口、构建后GC CLI临时目录 dry-run/apply 均通过。最终部署验收另记，本摘要不将构建等同运行中实例验收。

开发实例读取另发现旧 Issue #197 配置残留 `Project.executionDefaults`。兼容修复使用该历史版本的严格字段定义，仅保留存储配置，不更改任务启动策略。新增回归覆盖读取、迁移、事务和导出完整保留，并继续拒绝未知子字段；兼容修复与 DAO 两文件29项通过。

原始测试报告、日志及基准 JSON 保存在本地 `docs/artifacts/a2d2-source-storage-2026-11-01/`，遵守仓库禁止提交本地验收捕获的规则；不放宽 `verify-repository` 检查。
