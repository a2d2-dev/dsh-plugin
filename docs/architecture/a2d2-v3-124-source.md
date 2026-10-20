# #124 第一阶段：GitHub Issue 来源后端

第二阶段的客户端入口、导航、安全呈现与验证边界见 [GitHub Issue 来源 UI 架构](./a2d2-v3-124-ui.md)。下文保留第一阶段后端的范围和证据。

## 背景

[#124](https://github.com/a2d2-dev/dsh-plugin/issues/124) 在固定基线 `1f562b107ad9adc046b1f0bb01929185b5c7d234` 上实现“GitHub 已有工作 → 本地 Task”。遵循 [ADR 0003](../adr/0003-local-work-records-and-optional-collaboration.md)：来源观察和已接受业务事实分别保存。本阶段没有部署或重启 18782。

## 目标

- 用户可辨认当前 GitHub 来源身份，浏览真实仓库 Issue 列表、分页和原文详情。
- 显式接入／关联保存稳定 TaskId、原文、唯一映射及命令回执；离线保留本地工作和会话关系。
- 来源停用、乱序返回和远端错误不会覆盖已接受规格或制造重复工作。

### 非目标

GitHub 写入、任务启动／续跑／完成、旧迁移、客户端来源 UI、完整 Project views（#125）均未实现。`work.capabilities` 返回 `githubWrite:false, taskStart:false, projectViews:false`；`githubRead` 只说明本服务器装有读取适配器，具体凭据及仓库权限要以实际请求结果判断。

## 架构

### 概要设计

受信任 HTTP 请求进入同一个 WorkApplication。浏览来源仅保存观察；`source.import`／`source.link` 才接受本地工作。来源、观察、Task、ExternalBinding、唯一索引和命令回执共用一个原子工作快照。

### 架构设计

[GitHubSource](../../src/work-sources/github.ts) 异步 `execFile('gh', ['auth','token','--hostname','github.com'])`，继承服务器显式环境，10 秒超时；不会改 HOME、搜索其他账号目录或接受浏览器凭据配置。每个 GitHub GET 有 15 秒超时，只访问生成的 `https://api.github.com/user` 与仓库 Issue 路径，拒绝所有 redirect。仓库改名后配置规范仓库，再用相同 node ID 接入即可复用原 Task；不会跟随远端任意 Location。

`source.configure` 与生产读取适配器共享仓库范围校验：owner 使用 1–39 位字母数字／内部连字符；repository 使用 1–100 位字母数字、点、下划线、连字符，允许 `.github`、`_work`、`-work`，单独的 `.`／`..` 无效。两个组件均拒绝路径片段、斜杠／反斜杠、百分号编码和 URL 查询／片段注入；固定 GitHub.com GET 域与拒绝 redirect 的约束保持不变。

`@me` 每次绑定该凭据的 `/user`，返回 login、nodeId、name。列表剔除 PR；详情遇 PR 返回 `github-not-issue`。保留标题、原文（可合法为空）、负责人、标签、远端状态、node ID、`updatedAt` 和 `observedAt`。分页参数为有界正整数，绝不执行远端 Link URL；原始页满时保守返回 `nextPage`，因此末尾满页可能需一次空页确认。PR 会占 GitHub 原始页位置，剔除后空页仍可能有下一页。无自动抓取所有页。

刷新先在短事务内保存请求代次，再在锁外等待网络，最后重新锁定并检查 enabled、来源版本和该查询最新代次。停用再启用也会提高来源版本，旧在途响应失效。不同查询返回同节点时比较远端更新时间及本地请求序号。进程退出后可重新显式刷新，无后台轮询器。

ExternalBinding 以稳定 node ID 和规范化 URL 建立持久唯一索引；原子事务校验索引与 TaskRef 一致。新 URL 别名在显式接入时保存。URL 接入先从该受信唯一索引解析 node，再要求当前来源有该 node 的完整观察；尚无索引时，仅可匹配当前来源已取得的 URL 观察。索引中的旧 URL 不必再次出现在当前来源观察里，但索引本身不能替代内容观察。重复页和并行命令复用映射；同号跨仓库按不同 node／URL 区分。跨 Project 命中返回 `external-object-owned` 及 canonical TaskRef，不复制或改变原归属。节点／URL 指向不同绑定返回 `external-mapping-conflict`，不合并活动工作。

接受快照 `binding.accepted` 保持不变，后续观察只更新 `binding.lastObserved`。关联已有 Task 不覆盖规格、目标、Agent、父子或 Session；仅增加关联活动及领域版本。本基线没有完成字段／完成命令，观察路径不写任何完成结论。

来源接入保留完整正文；不从 Markdown 自动推断结构化验收。`specification.missing:['acceptance']` 表示结构化标准尚待确认，**不表示原文没有验收段落**，更不表示标准已满足。合法空正文额外标 `body`。从未取得正文的 URL 返回 `source-content-unavailable`，不能创建占位 Task。普通本地 `task.create`／更新规格仍要求非空正文及至少一条验收。

### 组件模块

| 组件 | 职责与契约 | 权威数据 |
| --- | --- | --- |
| [work-sources 导出](../../src/work-sources.ts) | 稳定 server-only GitHubSourcePort、IssuePage、IssueDetail、ExternalBinding 类型 | 外部只读观察 |
| [来源应用](../../src/work-sources/application.ts) | 显式接入、关联、去重、代次屏障 | 工作快照内来源／绑定／唯一索引 |
| [WorkApplication](../../src/work.ts) | 唯一命令事务、版本与重试回执、本地查询 | Task、Agent、规格和会话关联 |
| [插件](../../src/work-plugin.ts) | 延迟凭据读取；公开动态 `ctx.get('a2d2GitHubSource')` 可选端口 | 服务器配置；`github:false` 禁用读取能力 |
| [HTTP](../../src/work-route.ts) | DSH 登录及可信来源校验、严格 JSON 结构 | 不保存 token 或浏览器路径 |

### 数据流程与错误

浏览器仅提交 ProjectId／SourceId、Issue number 或已观察 node／URL。服务器解析仓库范围，网络结果成为观察；显式接入才在同一事务中提交 Task、内容快照、ExternalBinding、node／URL 索引和 commandId 回执。错误与空页分开，失败响应尽可能带 `page`／`issue` 最后已知内容；缓存查询带来源 `lastError`。失败不清除 Task、已有观察或分页记录。`refresh:false`（默认）始终只读本地。

DSH 未登录／不可信请求返回 HTTP 401／403，读取请求体前拒绝。GitHub 401／403／404／缺凭据返回 HTTP 424，分别以 `github-unauthorized`、`github-forbidden`、`github-not-found`、`github-credentials-unavailable` 识别；限流为 429，附可取得的 `retryAt`；网络／暂不可用／缺读取能力为 503；无效远端结构为 502。消息不含 token 或远端原始错误正文。

已知分类限制：HTTP 200 的非法 JSON 会在 `response.json()` 抛错，当前仍由传输 catch 归为 `github-offline`（503）。本次单轮裁决将其记账，不扩大 R1／R2 必要修复，也不重构错误系统。

## 场景

### 首次接入已有 GitHub 工作

前置：已登录 DSH，服务器有 GitHub.com CLI 凭据。接口均为 `POST /a2d2/api/work`，以下为依次提交的 `value`，外层分别用 `{kind:'command',value}` 或 `{kind:'query',value}`。`projectId`、`sourceId` 使用前一步响应的真实引用。

```json
{"type":"source.configure","commandId":"source-1","projectId":"<ProjectId>","repository":{"owner":"a2d2-dev","repository":"dsh-plugin"}}
{"type":"source.issues","projectId":"<ProjectId>","sourceId":"<SourceId>","page":1,"perPage":20,"assignee":"@me","state":"open","refresh":true}
{"type":"source.issue","projectId":"<ProjectId>","sourceId":"<SourceId>","number":112,"refresh":true}
{"type":"source.import","commandId":"accept-112","projectId":"<ProjectId>","sourceId":"<SourceId>","nodeId":"<observed Issue nodeId>"}
```

列表响应有 `page.items`／identity／nextPage；详情有 `issue`。接入返回 `task`、`binding`、canonical `ref`。也可提供 `url` 代替 nodeId（恰好一个）；URL 通过受信索引或当前来源观察解析，不作为网络入口。`source.link` 用 `ref,expectedVersion,sourceId,nodeId|url` 关联已有工作。`source.list` 列出当前 Project 来源。再次提交同一 commandId 返回原回执。

### 两来源改名与旧 URL 再次接入

前置：S1 的 `a2d2-dev/dsh-plugin#112` 已按 node 接入；仓库改名为 `a2d2-dev/renamed`，在同一 Project 显式配置 S2 并刷新取得同 node 的完整新观察。以下为依次提交的 command `value`：

```json
{"type":"source.import","commandId":"renamed-node","projectId":"<ProjectId>","sourceId":"<S2 SourceId>","nodeId":"<same observed nodeId>"}
{"type":"source.import","commandId":"renamed-old-url","projectId":"<ProjectId>","sourceId":"<S2 SourceId>","url":"https://github.com/a2d2-dev/dsh-plugin/issues/112"}
```

两次均返回原 canonical `ref` 和 Task；binding 保存新旧 URL，`accepted` 保留首次原文，`lastObserved` 来自 S2。旧 URL → 唯一索引 → node → S2 完整观察 → 原 Task 的解析在同一命令事务内完成。移除来源读取端口后，用新 commandId 重复旧 URL import 仍成功；同一 commandId 的并发／重启重试返回原回执。S2 尚未观察该 node、只观察到同号不同 node，或提交未知 URL 时返回 `source-content-unavailable`，不会产生占位工作。其他 Project 已观察同 node 后按旧 URL 接入，仍返回 `external-object-owned` 和原 canonical ref，不改变归属。

### 离线续读与停用

`task.detail` 返回本地规格、会话及 `bindings` 的接受／最后观察。`source.issue`／`source.issues` 省略 refresh 时只读缓存，缺 GH 也可用。调用 `source.set-enabled`（projectId、sourceId、expectedVersion、enabled:false、commandId）停止新刷新和接入；已提交 Task、Agent、索引、历史保留。重复旧接入 commandId 可以回读既有回执，不产生新导入。网络恢复后用新刷新取得观察；本地规格只由显式工作命令变更。

### 可重复的真实目标只读核查

工作目录为本分支根目录。先 `pnpm build`，再执行：

```sh
GH_CONFIG_DIR=/root/.config/gh XDG_STATE_HOME=/tmp/a2d2-v3-gh-state node scripts/github-source-smoke.mjs
```

这是本次已知凭据配置的验收命令；生产适配器不会硬编码这些路径。[smoke 脚本](../../scripts/github-source-smoke.mjs) 只读确切 Project 1，并从其真实 Issue 推导来源仓库；没有可用 Issue 时失败，不替换 demo。外部全程只读，显式 import 仅发生在新建临时本地记录中，结束只清理该自建目录。

[实测 JSON](./a2d2-v3-124-smoke.json) 记录 2026-10-20 的 exit 0：imneov／LiuFeng；私有 Project `PVT_kwDODqZowM4BnNzF`（DSH A²D²），`viewerCanUpdate:true`；唯一条目 #112 来自 `a2d2-dev/dsh-plugin`，仓库 `viewerPermission:ADMIN`。`items(first:1)` 返回 totalCount 1、hasNextPage false，带真实游标再读为空。真实 metadata 仅一个 View 1／TABLE_LAYOUT，13 个字段，无后页。Project view 应用接口和 UI 尚未实现。

打包后的生产适配器用 `@me,perPage:1` 读取来源仓库第 1、2 页，分别得到 #124、#132（均无写入），nextPage 2／3；随后取得 Project 条目 #112 的 4950 字节正文，与 GraphQL 原文逐字一致。隔离本地 import 后关闭来源端口重新读取，稳定 TaskId 和完整正文均通过。

## 验证与集成边界

固定响应覆盖 PR 分流、错误／空页、重复／改名／URL 别名、并行接入、跨 Project 所有权、分页中断、停用及新请求后的迟到观察、离线续读。生产插件 HTTP 测试使用真实 JSONL Session／Workspace 存储，关联前后保留既有规格与会话，无 live Agent／模型。src-only 声明构建与完整构建通过，测试不会替模块 augmentation 补类型。

完整回归 `pnpm test`：50 文件、716 tests 通过，exit 0；随后补充子 Issue 重复／跨仓库同号和已接受本地修改测试，最终来源相关三文件 24 tests 通过，exit 0。`pnpm typecheck`、src-only `tsc -p tsconfig.build.json --noEmit`、`pnpm build`、打包安装后的 14 个 Node exports 校验与真实 smoke 均 exit 0，无 skip。浏览器／部署验收未执行。

前端后续应安全呈现不可信原文，区分 `lastError`、缓存内容、待确认标准和能力边界；接入返回 canonical ref 后再导航，不凭 Issue number 拼 TaskId。#132 的 UUID／资源提示独立提交应在 UI 集成时复核。本阶段未验证 18782 浏览器／整体部署、GitHub 写操作、真实任务执行／完成，也未实现 #125 完整视图。

### 单轮 review 整改验证

整改起点为 `875c52899d87e012ebe82ffbc852f478d633a438`，review base 固定为 `1f562b107ad9adc046b1f0bb01929185b5c7d234`。本轮仅处理已裁决 R1／R2：

- R1 根因：配置 schema 和生产适配器重复使用首字符必须字母数字的正则，且共用 owner／repository 规则。`pnpm exec vitest run tests/work-sources.spec.ts -t 'configures, reads and imports a legal .github'` 先 exit 1，修后 exit 0；`pnpm exec vitest run tests/github-source.spec.ts -t 'reads legal repository'` 先 3 failed／1 passed，修后 4 passed。危险组件在配置与适配器两个公开入口均被拒绝；HTTP 固定响应仅置于外部网络边界，真实应用、存储与适配器未替换。
- R2 根因：当前来源按观察 URL 查找并提前返回，未读取已保存别名的唯一索引。`pnpm exec vitest run tests/work-sources.spec.ts -t 'reuses the canonical Task when a renamed source'` 先 exit 1，修后 exit 0；场景实际配置两个来源，保存 old／new URL 后再次以旧 URL 接入，并覆盖无端口重开、同 commandId 并发重试。补充未知 URL、当前来源无 node／仅同号其他 node 和跨 Project 归属负向回归，原 node／URL 索引冲突回归保持通过。
- 最终 `pnpm exec vitest run tests/github-source.spec.ts tests/work-sources.spec.ts tests/work-host.spec.ts` 为 3 文件／56 tests 通过；`pnpm exec tsc -p tsconfig.build.json --noEmit`、`pnpm typecheck`、`pnpm verify:pack-exports`（含完整 build 与安装包 14 个 Node exports）均 exit 0。构建只有既存 tsdown `external`／`noExternal` 弃用提示。

本轮未重跑全量。CEO 的独立全量结果为 716／718，两项失败为旧运行器 afterEach `ENOTEMPTY` 与 5000ms cold-create timeout；CEO 另在固定 base、相同依赖下复现 `ENOTEMPTY`，cold-create 通过，单独基线记账。本轮未修改 runtime、timeout、依赖或锁文件，也未提交编译产物。先前真实 GitHub smoke 是原实现证据，本轮未重跑真实 GitHub 网络、UI／截图、服务或部署；没有 GitHub 业务写入。HTTP 200 非法 JSON 的错误分类限制见上文，未扩大修复。
