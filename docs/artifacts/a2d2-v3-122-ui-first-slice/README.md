# #122 首片真实 DSH 浏览器验收：部分通过，启动阻塞

固定产品源码 `07297921961d01f0da7ac15336f33131b5188a6a`：UI 与 `e2ae5c3` 相同，只增加六条公开服务包的 type-only Context augmentation imports。工具 checkpoint `6a6f3cf`。**公开启动被后端 admission 拒绝；ready、actual 与当前会话跳转未通过浏览器验收，不代表整票 UI 完成。**

## 真实包与宿主

[构建记录](02-package-build.json)：先前 `pnpm verify:pack-exports` 因 src-only 声明构建缺少服务声明而退出 2，[原始失败](01-build-failure.json)保留。授权修复 `0729792` 仅改一个后端文件的六条 type imports，不改运行逻辑、schema、依赖或编译设置。源声明检查 exit0；完整 `pnpm verify:pack-exports`（bash-925）exit0，包含 server/client 声明、tsdown bundle 和 13 个 packed Node exports。`pnpm pack --json`（bash-931）exit0。

- 实际 tgz：本 worktree `dsh-a2d2-0.0.1.tgz`，SHA256 `b48c4e693b5f3b4647118f287158b7d8131eb348d1f45c73306a0a9b33ba01f6`；未提交编译产物。
- 本地与官方安装后 client bundle SHA 相同：`235767eb9dfb073f599cff7c4e8981d3757ec91d1b5cd57756c029327480fc0b`。
- [manifest](manifest.json)、[assembly](assembly.json)记录真实 CLI、API、LLM、agent 与包版本/hash；[额外宿主 artifact](02-package-build.json)记录 loop、JSONL persistence、preset registry。宿主源码 HEAD `a45068d2ec03326c800c68c9bdcd47508e3ccb9c`，CLI `0.2.0-rc.2`，实际页面标记 `0.2.0-rc.2-4c24ce4`。未重建或写入宿主。
- prepare（bash-932）exit0，官方安装到全新 `/tmp/a2d2-v3-121/122-ui-first-slice-0729792`。真实 [run](08267484-5809-4d45-b0b3-31ad86e78738-run.json)：managed `bash-935`、child PID `1875467`、supervisor `1875455`、URL `http://127.0.0.1:43343`。未接管 18780/18781。

## 实际浏览与公开命令

agent-browser 使用独立 session `a2d2-122-ui-0729792` 和本 root browser-profile。私有登录 URL、cookie/profile 与原始日志均未复制。所有 PNG 均已亲自 read_image 查看。

| 场景 | 实际结果与证据 |
| --- | --- |
| 初始恢复 | 浏览器打开前 [snapshot](1792470497304-snapshot.json) 为 0 Session；首次真实页面恢复后 [snapshot](1792470583186-snapshot.json) 为 1 个宿主空会话，ID `session-b8ead1bd-a8a2-4e4f-abb5-348b78df6a35`；[原生截图](03-native-first-restore.png)。未重定基线掩盖这次出生。 |
| 公共宿主资源 | [fixture](1792470585139-fixture.json)经 Workspace/SessionController 创建真实 workspace 及四个固定身份，scope 仅为宿主身份，不赋予 Task 权威；before/after 模型计数均 0/0。 |
| 真实 UI 建 Project/Task | 表单创建项目并选择真实 workspace，随后创建完整目标、规格、验收的 Task；[公开查询](05-initial-public-work.json)全部 HTTP200，[未开始概览](06-unstarted-overview.png)有四标签、未开始文案且无当前入口。 |
| related/review 不猜 current | [公开关联命令](07-public-associations.json)两次 HTTP200，先 related 后 review；execution 仍为空。[真实会话页](08-associated-without-current.png)分列“关联工作”“评审”，明确未授予协调权且无当前入口。 |
| 公开 task.start | [完整请求与响应](09-public-task-start.json)：真实 agent/resource、`standard`、`a2d2-acceptance/deterministic`、`read-only`、当前 expectedVersion=3；服务器返回 HTTP400 `host-admission-failed: Host execution admission failed`。随后 execution 查询 HTTP200 且没有 execution。没有改后端、直接写 store、伪造 ready、改 DOM 或 mock 响应。 |
| 返回列表保留筛选 | [截图](10-list-filter-retained.png)和 [DOM 读数](11-list-retention.json)显示详情往返保留项目、搜索 `122 首片`、`已关联会话` 筛选；列表刷新后关联数为 2。 |
| 关闭回原会话 | [截图](12-close-original-session.png)显示原 Default workspace 空会话与原生输入框。没有进入其他 Session 或生成新身份。 |

## 身份、零模型与退出

[metrics](metrics.jsonl)只有 guard/driver ready 与五次已解释的 session-born：首次宿主恢复 1 个、公共 fixture 显式创建 4 个。无 authorized、prompt-submitted、gateway、adapter；没有执行 positive 或授予模型预算。公开 start 被拒绝前后均只有上述 5 个身份，[启动前 snapshot](1792470814568-snapshot.json)未出现 turn/start。

[纯读 phase](phase-no-execution-navigation.json)在拒绝之后冻结；[check](1792470951941-check-no-execution-navigation.json) exit0，前后完整 snapshot 相等，0/0 模型计数、身份、持久投影、默认模型不变。[重放脚本](replay-gate.mjs)执行 exit0，[结果](15-replay-result.json)明确只验证已观察子集，并保留 `productStartGate=blocked`：

```sh
node docs/artifacts/a2d2-v3-122-ui-first-slice/replay-gate.mjs
```

浏览器独占 close exit0；[所有权核对后停止](13-owned-stop.json)仅向本 root supervisor 发 SIGTERM。[managed job 退出](08267484-5809-4d45-b0b3-31ad86e78738-exit.json) code0 已收集；[清理断言](14-cleanup.json) exit0，两个 PID 不存在，43343 ECONNREFUSED。root、包、私有日志及失败环境保留；未留自有服务。

保留的辅助失败：首次 offscreen 表单按钮未提交，语义等待 bash-952 超时 exit1；读原生表单有效性/几何后用 scrollintoview 显式滚到按钮提交成功，未改产品。一次 role fill locator 参数不匹配 exit1，改用最新 snapshot ref；一次从 web-app anchor 解析额外 loop artifact 失败 exit1，改为真实 base anchor 后成功。这些不属于产品通过或后端故障的证据。所有 managed 短任务均已收集，长期宿主唯一 job 为 bash-935，已退出。

## 待完成

后端需诊断真实装配下的 admission 异常；WorkApplication 对非 WorkExecutionError 只公开通用错误，目前证据不能断言其内部根因。取得明确修复 SHA 后重新打包、fresh root 复验 ready/actual、当前实例 ID 导航与返回 Task。运行/等待/暂停、固定 kickoff、控制表单、历史只读及接续仍待稳定公开契约和相应授权；本轮不调用模型，也不把组件测试或旧 host-only 正控冒称这些产品 gate 已通过。
