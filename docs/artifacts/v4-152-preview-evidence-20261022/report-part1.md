# #152 v4 真实 preview 验收：准备与目录页面

run：`v4-152-6b252218-r01`；目标：<http://10.126.126.12:18782/>。

## 阶段一：准备与既有持续规则（已验证）

目的：确认隔离条件，不修改既有规则，不让 fixture 被旧规则接入。

步骤：第一条命令在锁定 worktree 执行 `pwd && git branch --show-current`，得到 `/data/src/github.com/a2d2-dev/dsh-plugin.worktrees/v4-152-live-acceptance` 与 `test/152-preview-live`。读取 agent-browser core，登录原 preview，关闭 Preview Notice，进入 A²D² 面板，展开“持续委托”，正式查询全部三个项目、三个来源的 continuous.status。

记录：

| 来源范围 | 来源 ID | 原话 | 是否启用 |
| --- | --- | --- | --- |
| a2d2-dev/dsh-plugin Repo | `9cea4378-0219-4f99-a237-80f51bd36291` | 无已保存规则（API 没有 continuousRule） | 无已保存规则 |
| a2d2-dev Project 1 | `c122502c-1632-4a96-acb5-8adbac61999d` | 无已保存规则；页面输入框空 | 页面“接新工作已暂停”，API 无 continuousRule |
| theriseunion Project 14 | `6de5b019-9765-45dd-8596-1a02dbaa7cca` | 无已保存规则（API 没有 continuousRule） | 无已保存规则 |

三个正式 status 响应都是 HTTP 200 / `status:completed`，没有规则实体。没有发现宽范围旧规则冲突；保留原规则不变。Project14 只为完整规则盘点查询了状态，未刷新业务 Issue、未执行其工作。三个项目中，独立历史验收项目没有来源。

既有来源直接复用，没有重复添加。Project1 来源页面当前缓存概览显示“缓存 / 最后已知观察 · 尚无目录缓存”，开放 Issue 40（完整扫描 2026-10-22T02:03:59.496Z），PR“尚未完整观察”，本地工作聚合“尚未读取”。这些是页面观察，不当作新鲜完整扫描。

![既有规则与会话基线](shots/01-baseline-rules-desktop.png)

原始命令与退出码保存在 `raw/baseline-*.json`，本轮 capture 脚本 exit 0；每个命令 exit 0。注意初次尝试 `/api/session/list` 使用空 body，返回 HTTP 200 但业务错误 `gateway/bad-request` / `invalid client-request message`，不能当有效会话数量证据；保留原响应，后续以正确 RPC 与页面核对。

规格读取说明：当前验收分支没有规格文件；依父会话提供路径，只读读取交付 worktree 的 `docs/specs/v4-live-acceptance-script.md`。fixture 六份正文与 ledger template 以本分支内容为准。已有未跟踪 `.local/` 不变。

## 阶段二：workspace 与 GitHub 对象

目的：建立只属于本 run 的资源与外部对象，保留真实身份供后续执行。

步骤：创建隔离目录 README，通过 Add workspace → Edit path → 输入完整路径 → Enter → Open 正式注册。随后 resources.list 查询，再调用幂等 workspace/create 回读已注册记录（created:false）。GitHub 使用精确六份 body-file 创建，assign imneov，创建三个本 run 标签；POST 两条原生 sub_issues 后 GET 回读；只添加 P/C/E/A 到 Project1。

记录：正式路径 `/data/_dsh-dev/acceptance-workspaces/v4-152-r01`，runtimeId `c01a3a7b-6deb-4820-9896-548d14220162`，workspaceId `b2c6edcf-bb21-4925-8ccd-6b0e503de5dc`，createdAt `2026-10-22T02:09:20.666Z`。Host 自动生成空 Session `session-df9adec7-379c-482d-bb4d-0f0ccc493351`；这属于 workspace 初始化，不能声称整个准备阶段零 Session。正式 session/list 回读 blank:true、running:false、0 turns / steps / tokens。初次根页 /session/create 请求不能单凭请求次数断言新建：旧 blank Session 仍为原旧时间，未证实新增根 Session。

| fixture | 真实 Issue | database ID | Project item ID |
| --- | --- | --- | --- |
| P | [#157](https://github.com/a2d2-dev/dsh-plugin/issues/157) | 5971765972 | `PVTI_lADODqZowM4BnNzFzhCk6LI` |
| C | [#158](https://github.com/a2d2-dev/dsh-plugin/issues/158) | 5971766749 | `PVTI_lADODqZowM4BnNzFzhCk6NY` |
| E | [#159](https://github.com/a2d2-dev/dsh-plugin/issues/159) | 5971767556 | `PVTI_lADODqZowM4BnNzFzhCk6Ns` |
| A | [#160](https://github.com/a2d2-dev/dsh-plugin/issues/160) | 5971768445 | `PVTI_lADODqZowM4BnNzFzhCk6Sg` |
| B | [#161](https://github.com/a2d2-dev/dsh-plugin/issues/161) | 5971769149 | 不加入 |
| X | [#162](https://github.com/a2d2-dev/dsh-plugin/issues/162) | 5971769932 | 不加入 |

Project1 的真实 ID 为 `PVT_kwDODqZowM4BnNzF`。完整 node_id / updatedAt / URL / 标签 / assignee 见 [ledger](ledger.json)。P 原生子回读仅 #158/#159，数据库 ID 与正文一致；没有创建 Task/Execution/规则，没有设置执行模型。新 workspace 尚未附到任何新的 A²D² project，ledger.projectId 保持 null，避免误用旧演示执行资源。

![正式注册 workspace](shots/02-workspace-registered-desktop.png)

创建脚本与全部 gh 子命令 exit 0。Git 首次 commit 因未配置作者 exit 128，读取已有作者后使用命令级 `-c user.name=imneov -c user.email=i@imneov.im` 完成，没有修改全局配置。RPC 探索错误保留 raw（缺少 args、缺少 _request），最终有效格式为 client-request / method session/list / payload.args._request:{}，正式返回 ok:true。

## 阶段三：目录、双来源详情与副作用

待验证。

## 范围

本阶段不创建 Task，不启动模型，不启用规则；执行、父子验收、自动接续与持续处理交给后续阶段。服务、Host、插件、profile 与 src/ 未修改。
