# #122 真实宿主正控与隔离 fixture（产品 gate 待接入）

**宿主工具正控通过，最终产品未验收。** 工具源码 checkpoint `3114bf5`，固定 base `606fcee`。没有最终产品 tgz、没有调用 base accepted 预约、没有产品 Task store 写入。旧票最终 stable-origin 结论不变。

## 实际装配与能力边界

- [manifest](manifest.json)：源码 HEAD `a45068d2ec03326c800c68c9bdcd47508e3ccb9c`；CLI `0.2.0-rc.2`；Node `v22.23.1`。
- [assembly](assembly.json)：实际 CLI、LLM、Session/Workspace controller、client-modules、agent 的解析路径、版本与 SHA256，以及替换前后 manifest/patch/guard/model/wrapper hash。原 manifest 未改。[额外构建](additional-host-builds.json)记录 loop/persistence/preset。
- controller 实际文件为 `/data/src/github.com/deepseek-ai/deepseek-harness-dev/packages/api/session-controller/lib/index.js`，SHA `bc889fbd3e95a994d9019f08feb9ce9033f4c6c918b6932f14b1c0fd109241a6`。它提供公开 `selectLocalModel`，宿主正控经此接口使用 `installModelSelection` 的局部装配。**生产原锁包 0.2.0-rc.2 没有此方法**；相同版本字符串不能证明同能力，本正控不能回填为生产锁包能力，也不能代替产品自己的配置路径验收。
- 实际前端 `0.2.0-rc.2-4c24ce4`（截图可读），与源码 HEAD 不同代；没有重建或升级宿主，没有使用候选 `0.2.1-rc.2`。
- 插件 tgz/SHA 为 null（host-only）；guard SHA `7763d7a8043903a440514b6bc1fbed57b3d316f660ec5fbbd017f2dfca87ed90`。工具内容在本轮真实进程间未变；后续 wrapper 完整性修复另起工具 checkpoint 与独立 root，不追改本 assembly。

## 真实正控和零调用浏览

[正控结果](1792468069794-positive.json)保存 before/after `0/0→1/1`、Session/request ID、真实 assembly/request 路由、未变全局默认、持久回复 seq15 和 completed turn/end seq17。公开 WorkspaceController 创建 workspace，SessionController 以固定 ID 与真实 `standard` preset 创建/重复复用 positive/current/retired/review 四会话；全员实际 cwd 等于独立 workspace。后面三者只是宿主身份占位，尚未被产品授予业务用途或资格。

唯一可发现模型为 `a2d2-acceptance/deterministic`，adapter 固定输出 `A2D2_122_DETERMINISTIC_HOST_REPLY`；只有显式正控授予 positive Session 一次预算。模型凭据未继承，公共 LLM 与 adapter 跨进程[追加指标](metrics.jsonl)各一次。guard 不伪造产品返回、不直接写 Task store。

agent-browser 专属 session `a2d2-v3-122-host` 和本 root browser-profile，真实 Chromium 登录并完成 Preview Notice。原生页面显示真实持久回复，[截图](01-positive-native.png)与[模型菜单](02-real-model-menu.png)来自实际页面。浏览 Chat/Trajectory 和模型菜单之后，[纯读阶段检查](1792468198741-check-host-browse.json) exit0、delta0/0、身份/持久投影/default 不变。没有把 curl 或结构快照当作渲染证据。

## 同 origin 重启、cold 与退出

独立 root `/tmp/a2d2-v3-121/122-host-positive-606fcee` 保留全部原始数据；18780/18781 未监听或接管。

| 轮次 | managed job | PID | origin | 实际退出 |
| --- | --- | --- | --- | --- |
| 首次 | bash-768 | 1708921 | http://127.0.0.1:43267 | [code0](700aaef7-db08-4c7a-af6b-0b5f7a5de746-exit.json) |
| 同 root 重启 | bash-795 | 1727567 | http://127.0.0.1:43267 | [code0](1ce900f2-ede8-4d26-af51-209f566f391c-exit.json) |

重启前以 current-run managedJobId 和 `/proc` 精确命令/patch路径核对自有 supervisor/child，再只给自有 supervisor SIGTERM；收集两个 managed job 的退出。重启保持相同 browser-profile，交换新私有 token 后原生界面恢复同一 positive Session，[重启截图](04-restart-native.png)仍显示原回复。current/retired/review 经公开 list/inspect/projections 观察为 cold，未伪造有效 live 配置。[cold纯读阶段](1792468418270-check-cold-read.json) exit0，累计1/1不增。

[逐字段重启 gate](05-strict-restart-gate.json) exit0；[重放脚本](replay-gate.mjs)可重新核验：

```sh
node docs/artifacts/a2d2-v3-122-host-2026-10-20/replay-gate.mjs
```

精确四 Session ID 集合无增减，完整 meta 仅允许冷头 `delegationDepth` 缺省→0；positive 只允许关闭时追加一个 `session/end-seed`、asOfSeq17→18；其他 eventTypes/seq 严格相等。所有持久 projection values（含 preset、模型、inbox）、canonical cwd、default 相等，双计数累计1/1，原回复材料保留，无未知出生身份。live/cold 差异单列，不删除其他 meta/event 字段求通过。

## 测试、失败与清理

[工具测试](tool-tests.tap)：`node --test tests/a2d2-v3-121-run.test.mjs tests/a2d2-v3-122-model.test.mjs` exit0，22 passed / 0 failed / 0 skipped。121既有路径/symlink拒绝证据直接引用，不复制镜像安全实现。

[失败记录](failures-preserved.json)如实保留：模型边界行为红测 exit1 后 green1/1；组合运行旧 acceptance 文件因本 worktree 缺 cordis 依赖 exit1（22 passed/1 failed/0 skipped），未安装或改依赖；浏览器等待错误文案超时 exit1 后按实际 snapshot 找到 composer；跨重启误套纯读全等 exit1，合法生命周期差异如上，原baseline未改。

短任务 bash-769(失败测试)、772(正控)、773(首次登录)、776(失败wait)、778(snapshot)、783(22项测试)、800(重登)均已收集；Web bash-768/795 均exit0；独占浏览器close exit0。未遗留自有服务，不删除隔离数据，不操作其他实例。正式目录仅白名单 JSON/JSONL/PNG/TAP/重放脚本，不含登录URL、cookie、profile和原始日志。

## 未完成产品 gate

等待已验证 tgz/SHA 与公开 WorkApplication task.start/task.execution、TaskId 控制、持久 inbox 和接续检查点契约。两 Task 抢同 Session、等待/恢复、manual continuation、retired 原生输入围栏均待产品接线；retired输入允许blocked turn日志，须验证零模型/工具增量和current不变，不能用纯读全等替代。本阶段没有这些产品通过声明。
