# Issue #137 来源与目录源码验收记录

本记录对应 [原始 Issue #137](https://github.com/a2d2-dev/dsh-plugin/issues/137)，Task `d659d90c-6dfc-49a5-afe9-025c8d70e087`，协调代次 1，规格版本 2。原始七项验收条件已完整登记到 Task；本记录不改变其范围。原生子 Issue 当前为零，来源、目录与验证均在本 Task 内推进。

## 固定版本

- 原来源实现：`feat/v4-sources@2e94db565d37c6fddbec40801c3cc003b6e1bdd2`；整合记录保留在 `docs/specs/v4-source-integration-stage1.md`。
- 本轮核验使用包含后续来源修正的集成检查点 `release/v0.0.22@b06b52df9fa4c2822b8e32847885ae486be54d62`，在独立 `issue-137-acceptance` 工作树完成。
- 本轮测试夹具修正：`8e85a74`。
- 本轮 PR 目录修复与新增回归：`ba0bbec`；最终源码检查与 clean-tree pack 均针对该源码完成。
- 补丁分支：`test/137-source-acceptance`。运行实例未在本轮更新。

## 本轮修复

PR 列表原先按关联 Issue 编号查找本地进展，会将 `acme/other#5` 的会话显示在关联 `acme/app#5` 的 PR 上。现复用 Issue 的规范 URL／可得 nodeId 查询，缺失 nodeId 不再与其他缺失值匹配。真正跨仓库的 PR → Issue 关联仍可定位该 Issue 的会话。PR 链接的可见文案补充 `owner/repository`。

新增行为回归通过真实 WorkPanelController 和 WorkPanel 组件验证：同号其他仓库排在进展列表首位时仍定位正确会话；没有 canonical 工作的同号 Issue 不显示其他会话；PR 位于不同仓库但明确关联当前 Issue 时仍显示正确会话；仓库可见文案、草稿、检查与评审可读；浏览不发工作命令。

两项既有观察测试同步到当前 UI 合同：显式进入 Issue 页后检查行级进展；会话页使用执行图事实验证等待状态，同时保留已载入历史、页签、筛选与零导航／零写入断言。原先的跨仓库隔离断言细化到各列表行。

## 原始验收条件与证据

| 条件 | 本轮源码证据 | 剩余验收 |
| --- | --- | --- |
| 1. URL 自动识别、严格 github.com、规范去重、保存 view／切片、浏览不启动 | `v4-sources.spec.ts` 11 项通过；严格 URL 拒绝、真实身份适配、同 nodeId scope 更新、重启恢复入口、识别与浏览零启动副作用 | 既有实例确认添加与再次添加的完整交互由 #141 记录 |
| 2. Project／Repo 标签与原型概览、来源账号／范围、Issue 独立 @me／状态／标签／搜索／分页 | `source-directory.tsx`、`work-panel.tsx` 与 `github.ts` 已核对；来源导航／渲染、列表与适配器合同通过。Repo REST 由固定范围构造，Project Issue 筛选独立于 view | 原型对照、筛选组合与分页在既有实例的完整操作待 #141；本项整体保留未验收 |
| 3. 真实 Project views／字段和筛选内容，不支持条件明确报告 | `v4-source-catalog.spec.ts` 3 项、`github-project-source.spec.ts` 8 项通过；真实 connection 分页、实际字段过滤、不完整字段与不支持表达式失败 | 最终实例真实 Project 切换与过滤对照待 #141 |
| 4. 真实 PR 目录、仓库／状态／草稿／合并／关联／检查／评审，引用不当验收 | catalog 合同覆盖真实读取结构、多页和 partial；`pr-source-identity.spec.ts` 验证修复后组件事实；可见仓库与“引用不等于验收”断言通过 | 既有实例的 PR 状态／搜索／分页与仓库文案可见性待 #141 |
| 5. 跨来源同 Issue 复用 canonical Task／当前会话，同号跨仓库隔离 | `work-sources.spec.ts` 29 项、`project-discovery.spec.ts` 18 项、`work-startup.spec.ts` 14 项，以及新增 PR 身份回归通过；原有 accepted text 保留 | 在既有实例经 Project／Repo 两入口进入同一现有会话的组合操作待 #141 |
| 6. 读取／无缓存／缓存／无权限／不可用／有效空及异步切源隔离 | 来源缓存持久化、权限／离线错误保留、旧页／旧来源／旧配置回执竞争及无缓存聚合未知合同通过；`refreshCatalog` 按来源 version／请求代次拒旧响应 | 桌面／窄屏各状态呈现与切源交互待 #141；本项整体保留未验收 |
| 7. 公共应用合同、typecheck、pack；最终里程碑统一浏览器验收 | 最终 14 文件 146/146，typecheck 与 diff 检查 exit 0，干净 HEAD 打包与实际安装导入 exit 0 | 最终浏览器验收与精确部署版本交接尚未完成；本项整体保留未验收 |

## 可复现命令与本轮结果

工作目录为独立验收工作树，Node 与既有依赖环境，使用 corepack pnpm 10.26.2。依赖安装采用 `--offline --frozen-lockfile --ignore-scripts`，exit 0。

```bash
corepack pnpm exec vitest run \
  tests/v4-sources.spec.ts tests/v4-source-catalog.spec.ts tests/v4-source-navigation.spec.ts \
  tests/github-source.spec.ts tests/github-project-source.spec.ts \
  tests/work-sources.spec.ts tests/project-discovery.spec.ts \
  tests/work-source-client.spec.ts tests/work-source-navigation.spec.ts \
  tests/client/work-source.spec.ts tests/client/v4-source-render.spec.ts \
  tests/client/work-startup.spec.ts tests/client/work-observation.spec.ts \
  tests/client/pr-source-identity.spec.ts --maxWorkers=2 --reporter=default
corepack pnpm typecheck
git diff --check
corepack pnpm verify:pack-exports
```

- 原始回归：13 文件 145 项，143 pass／2 fail，job `bash-130` exit 1。失败是旧 UI 夹具与当前执行图／来源默认概览合同不符。
- 夹具修正后：145/145、typecheck exit 0，jobs `bash-136`／`bash-137`。
- 新 PR 身份回归原红：job `bash-140` exit 1，实际渲染显示 `wrong-session`，证明按同号关联错误。
- 最终源码：14 文件 146/146，job `bash-141` exit 0；typecheck 与 diff 检查 job `bash-142` exit 0。
- 最终打包：`ba0bbec`，job `bash-144` exit 0。校验从 git archive 的干净 HEAD（无 lib）执行 prepack 构建；tarball 含 30 个显式导出目标、两个宿主 sidecar，共 177 项；安装后 14 个 Node 公开入口均可导入。

测试使用确定外部响应验证合同。本轮没有新增真实 GitHub 读数或运行实例截图；历史只读 API／组件截图见 `docs/architecture/v4-sources.md`，不作为本轮重新取得的端到端证据。

## 稳定需求块与下一步

1. **来源接入与身份**：源码核验完成；沿用已有受信 GitHub 路由和宿主凭据。
2. **真实目录与导航**：源码核验完成，本轮补齐 PR 仓库文案和跨仓库会话身份修复。
3. **最终实例验收**：等待 #141 在其最终固定版本集成本轮补丁后验收，属于原里程碑约定，无新增子 Task。

#141 应记录以下来源场景：Project／Repo 链接真实识别和确认、重复接入和原始 view／切片恢复；独立 Issue 筛选和前后页；实际 view 内容与不支持条件提示；PR 状态／草稿／合并和未知检查／评审；跨来源同 Issue 进入现有会话，以及同号其他仓库不串联（包含 PR 会话列）；读取、缓存、无权限、不可用、有效空与快速切源；桌面和窄屏截图。浏览仍不得创建会话、启用持续处理或修改 freeland 业务数据。

Task 保持 review／等待最终里程碑证据。GitHub Issue 保持 Open；PR 或构建通过不替代完整验收。
