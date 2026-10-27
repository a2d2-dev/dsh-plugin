# Issue #163 工作库锁竞争验收

原始工作：[GitHub #163](https://github.com/a2d2-dev/dsh-plugin/issues/163)。本轮基线为主干 `d8f8507`，日期为 2026-10-27。原 Issue 的四项期望作为验收标准保存，未拆分子任务。

## 目的与范围

核实大 Project 后台发现写库时，交互写不会再因原先两秒锁等待失败；同时验证无变化 tick 不写库、失败原因可诊断、旧 21MB 工作库完整可读写。

历史修复分支 `fix/workstore-contention` 的相关提交已经进入主干，包括 `6ec3a93`、`5c92fc2`。PR #164 已关闭且未直接合并，不能单凭该 PR 状态判断当前实现或验收。本轮只加强回归断言并记录当前证据，没有修改生产代码、存储 schema 或运行配置。

原文根因的一点更正沿用 Issue 2026-10-22 评论：发现逻辑已经按 `nextAttemptAt` 过滤到期来源，历史高频写库来自持续分页推进；不能由 mtime 每五秒变化推断每个 idle tick 都会写库。

## 步骤与记录

在独立 worktree 安装锁定依赖，执行：

```sh
pnpm exec vitest run tests/work-store-contention.spec.ts tests/work-process.spec.ts tests/work-dao.spec.ts tests/work-source-freeze.spec.ts --maxWorkers=1 --reporter=verbose
pnpm exec vitest run tests/work-store-contention.spec.ts --maxWorkers=1 --reporter=verbose
pnpm typecheck
```

第一组为当前主干检查，4 文件、38 项通过，44.01 秒。补强断言后，锁竞争专项 11 项通过，15.06 秒。最终 typecheck 通过。

| 原标准 | 验收证据与结果 |
| --- | --- |
| 后台发现写库期间，交互写有界等待并同进程串行 | DAO 的本地队列与跨进程锁共享 30 秒获取预算。同 PID 文件锁保持五秒后交互写成功；真实 `reconcileSources()` 原子写边界延迟五秒时，三个交互写全部 completed，完整保留三个新增项目，整项用例 6.748 秒。不同应用实例进入同一队列后才申请文件锁。跨进程活持有者等待至少 30 秒才拒绝，实测用例 30.542 秒；持有进程退出后接管成功且原记录保留。 |
| idle / 纯调度元数据不整库落盘 | idle tick 和只修改 `nextAttemptAt` 的用例均断言零次 `writeFileAtomic`，磁盘原文不变；下一次 tick 遵守内存调度时间，不访问来源。当前默认 discovery 周期五分钟。 |
| 失败原因可诊断 | 经真实 HTTP handler，错误 JSON/错误 schema 返回 `invalid-state`，锁错误返回 `lock-timeout`，权限错误返回 `eacces`；保留 `work-record-unavailable` code，message 不包含路径。四项通过。 |
| 旧 21MB 库可加载且不因锁修复改变 schema/兼容性 | 合成至少 20MiB、3000 observations 和完整 checkpoint，验证归档内容及全量导出逐项相等。另对真实 21,249,065 字节旧库的新副本完成冷读、迁移、三个并发小写及新进程全量回读；来源原始内容完全相等，全部原记录经既有规范化后的内容一致，schemaVersion 3 保持。本次锁修复及验收加强没有新增 schema 变化。 |

### 真实旧库副本

只读复制现有 preview 的旧格式文件到忽略的证据目录，所有写入均发生在副本中，未运行真实宿主或 GitHub port。输入 SHA-256 为 `1e2c6bbe1306e9ec091f6287210665c116814e531db6fba3353dbd77afa310ff`，含三个来源、3280 条 observations，checkpoint issue 数为 0 / 0 / 300。

| 检查 | 本轮结果 |
| --- | --- |
| 当前读者加载旧单文件并完整导出 | 1332 毫秒，来源 JSON 内容与原始输入全等 |
| 首次迁移 | 697 毫秒，迁移前后完整导出全等 |
| 迁移后三个并发小写 | 全部 completed，合计 163 毫秒 |
| 控制文件大小 | 723245 字节，来源大字段由现有 DAO 归档协议保存 |
| 全新进程读取全部归档并导出 | 原来源 JSON 内容全等；过滤三个显式新增项目、对应默认协调 Agent 和命令回执后，与当前读者规范化的原始快照全等 |

这些是本机单次离线测量，不是 GitHub 刷新耗时或长期吞吐承诺。完整来源比较针对原始 JSON；全库比较使用既有迁移规范化，避免把无绑定 legacy child 清理、队列默认字段或内存 undefined accessor 误认为本次锁修复造成的数据变化。

后续独立 DAO 改造已经引入 `storage.version: 1` 和旁文件，业务 `schemaVersion` 仍为 3。旧 strict 版本不能直接读取带 storage 标记的磁盘文件，降级必须完整导出，见 [DAO 文档](../architecture/work-dao.md)。本报告证明旧库前向加载和数据保全，没有宣称当前磁盘格式与旧版本直接双向兼容。

### 现有 GUI

使用 `agent-browser` 在现有 DSH GUI 操作 DSH A²D² Project 的“刷新来源”，未启动替代服务器。原生 HAR 记录 `source.catalog(refresh:true)` HTTP 200，18632 毫秒；页面保持可读，刷新按钮恢复可用。

后续 Project 扫描显示“已取 50/133 项，可继续刷新”。这不是全目录扫描完成的证据。本轮 HAR 的第一段在 `source.issues(refresh:true)` 尚未返回时结束，不能把其中 status 0 当作成功或失败。本票使用已完成的 catalog 写请求、可见页面，以及确定性并发回归证明锁竞争修复，不将分页完成度扩写为全流程验收。

## 证据边界

历史 Issue 评论称修复前 100% 503、修复后五次 completed 且每次 17–26 秒。指定历史部署目录中的原始文件只能证明部署和 session/storage inventory 保留，未找到五次请求的原件。因此这些历史比例和耗时没有作为本轮通过依据。

本地原始证据位于本 worktree 的忽略目录 `docs/artifacts/163-2026-10-27/`：`targeted-tests.log`、`strengthened-tests.log`、`typecheck-final.log`、`real-store-result.json`、`real-store-cold-result.json`、脱敏请求摘要及两张页面截图。原始库副本、HAR、含业务上下文的日志和截图不进入 Git 历史。
