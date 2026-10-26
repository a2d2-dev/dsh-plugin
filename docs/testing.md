# 测试与证据

## 自动检查

- `pnpm verify:repository`：包名、版本、许可证、挂载导出及源码隐私排除规则。
- `pnpm typecheck`：宿主和客户端 TypeScript。
- `pnpm test`：Vitest 单元及宿主契约回归；认证命令、网络和模型调用应在相应边界隔离。
- `pnpm test:node`：Node 原生测试运行器中的验收工具回归；它使用测试自己拥有的 CLI、临时目录和 HTTP fixture，不等于产品页面验收。
- 提交后 `pnpm verify:pack-exports`：从已提交源码构建、安装并导入真实 tarball。
- `scripts/verify-git-install.mjs`：按需的 Git 安装授权回归，见[安装说明](git-installation.md)。

Node 22 与 24 的 CI 都执行适用检查。Vitest 的 `unit` 项目保留默认 5 秒用例预算；使用真实 Agent/JSONL 的 `host` 项目串行运行，完整场景预算为 15 秒。恢复测试会主动停住宿主操作 2.3 秒，并独立断言 1.5 秒的事件接收期限；分组预算不修改这些内部截止时间。总 worker 数上限为 2。测试临时目录应位于源码 Git 根之外；把 `TMPDIR` 指到 checkout 内部会改变向上解析项目标记的结果，造成无效的测试环境。

## 页面和宿主验收

源码编译和 mocked tests 不能证明运行中的 DSH 已加载新包。修改用户行为时，记录实际宿主版本、源码提交、包校验和、既有实例地址、浏览器步骤与截图。不要为了通过验收另起一个替代实例或把开发宿主的结果宣称为公开桌面版本兼容。

## 证据仓库

LF 指定 [a2d2-dev/project](https://github.com/a2d2-dev/project) 统一存放 A²D² 项目测试资料。插件证据位于 `dsh-plugin/`，迁移保留原 `docs/artifacts/<任务>-<日期>/` 相对结构，方便查阅已有报告。新证据同样按任务与日期组织，并在报告中引用准确源码提交。

报告使用中文，至少包含：实验目的、实际步骤、观测记录、通过/失败结论、未覆盖范围，以及原始输出或图片的相对链接。迁移清单包含来源提交、路径和 SHA-256，迁移不重写历史验收结论。

该仓库当前私有。源码中的链接应标明这是访问受限的历史测试证据；公共 README 不能依赖它才能理解安装和使用。外部贡献者可在 PR 中提供已脱敏的最小截图或日志。不要把会话快照、私人项目清单、cookies、token 或整段未审查对话带入源码仓库。

源码 checkout 中 `docs/artifacts/` 是忽略的临时工作区，不是发布目录。保存到证据库后再引用其 commit 固定链接；本地目录清理不表示旧 Git 历史、发行附件或图片已通过隐私审核。

LF 明确要求保留原路径的生命周期架构规格图有四个精确例外：[流程源图](artifacts/session-lifecycle-2026-10-25/session-lifecycle.html)、[流程渲染图](artifacts/session-lifecycle-2026-10-25/session-lifecycle-preview.png)、[状态与操作源图](artifacts/session-lifecycle-2026-10-25/session-lifecycle-operations.html)、[状态与操作渲染图](artifacts/session-lifecycle-2026-10-25/session-lifecycle-operations.png)。它们是经审阅的纯架构说明及浏览器渲染图，不是产品 GUI 验收截图。`verify:repository` 仅按这四个完整文件路径放行，不豁免目录；真实会话、测试日志、验收截图和其他 `docs/artifacts/`、`.dsh/`、`.local/`、`.scratch/` 等内容仍遵循原排除和证据仓库规则。
