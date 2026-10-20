# #122 真实隔离宿主验收准备

## 背景与目标

固定 base `606fcee` 只提供 accepted 预约；最终产品 tgz 未提供。本阶段交付可复现的真实宿主正控和模型边界适配，不构成产品 task.start、等待/恢复、接续或围栏通过。#121 最终 stable-origin 证据及旧失败事实保留，见 [旧票最终报告](../artifacts/a2d2-v3-121-2026-10-19/product-final/README.md)。

## 架构

[独立入口](../../scripts/a2d2-v3-122/acceptance.mjs) 直接导入 #121 已导出的 prepare/run/request；该模块的 CLI 有 main guard，import 不启动进程。不修改旧工具，不复制其路径、端口、信号与生命周期逻辑。独占资源使用 `/tmp/a2d2-v3-121/122-<run>`，沿用已验证 namespace，以 122 前缀隔离。只在公开 prepare 完成、realpath/manifest 归属核对后替换自有 guard，原 manifest 不变，保留原 patch/guard/manifest hash 与新 assembly hash。每次 run/request 核验实际装配和已解析宿主构建。

[模型适配](../../scripts/a2d2-v3-122/model.mjs) 只发现一个确定性模型。公共 LLM waterfall 和 adapter 分别追加计数；未授权的 Session、辅助调用、预算耗尽均拒绝。宿主正控显式授予指定 Session 一次调用；公开 controller 以固定 ID 和真实 preset 创建/复用会话，selectLocalModel 使用宿主公开 installModelSelection 机制，只改 Agent 局部 assembly/request，不保存全局默认。adapter 固定回复由真实 AgentLoop 持久化，不伪造产品响应或写 Task store。指标只记身份、路由、阶段、事件类型，不保存消息正文或凭据。

## 场景

工作目录为本 worktree；HOST 指向已有只读宿主，ROOT 必须为全新专属目录。命令示例：

```sh
node scripts/a2d2-v3-122/acceptance.mjs prepare --host "$HOST" --root "$ROOT" --host-only
node scripts/a2d2-v3-122/acceptance.mjs run --root "$ROOT"
# run 必须经 bash run_in_background 管理，然后登记实际 job：
node scripts/a2d2-v3-122/acceptance.mjs job --root "$ROOT" --job <managed-job>
node scripts/a2d2-v3-122/acceptance.mjs positive --root "$ROOT"
node scripts/a2d2-v3-122/acceptance.mjs mark --root "$ROOT" --phase host-browse
# agent-browser 使用本 root browser-profile 登录真实页面、snapshot、截图
node scripts/a2d2-v3-122/acceptance.mjs check --root "$ROOT" --phase host-browse
```

正控要求双计数各增一、真实持久 assistant/message 含固定文本、turn/end completed、assembly/request 路由一致、全局默认不变。mark/check 比较阶段增量，允许既有显式调用总数非零；只读阶段要求零增量、身份集合与持久投影不变。live/cold 独立呈现；cold 不冒称已读取有效运行配置。登录 URL 只在隔离 root 的 private 文件；按 #121 私有 URL 读取方式交给 agent-browser，正式证据仅白名单复制。

重启前只停止已核对本 root run 记录的自有 job，收集退出，再同 root run，复用原 origin/profile，模型指标跨进程追加。路径规范/符号链接拒绝前无写入、端口占用不杀他人、origin 检查及自有停止直接复用 [#121 生命周期证据](a2d2-v3-121-acceptance.md)，不制造镜像测试。

## 待产品接线的 fixture 与 gate

| Fixture / 场景 | 当前边界 |
| --- | --- |
| 两 Task 竞争同 Session、重复启动/回执丢失 | 等最终 tgz 的 WorkApplication task.start/task.execution；不调用 base accepted 预约冒充启动 |
| current/retired/review Session | 宿主 fixture 仅创建固定身份；业务用途、owner/epoch 与 retired 围栏待公开产品命令 |
| current/retired cold | 宿主重启后的公开 list/inspect/projections 可观察 cold；产品历史投影/零调用围栏待接线 |
| 持久 Task inbox、等待/恢复 | 待公开 TaskId 控制与投递/消费查询；不把宿主 inbox 代替 Task inbox |
| 手动接续检查点 | prepare/write/create/take/deliver 及固定后继均待公开产品接口；不发明私有后门 |

最终接入需要已验证 tgz 及 SHA、公开命令/查询契约、受控失败窗口和浏览器入口。新建独立 root 官方安装，不替换已冻结实例；显式 start/continue 才授予确定性预算，列表/历史/旧会话阶段按零增量检查。未来参数化产品授权入口待契约确定后补齐，当前仅开放宿主 positive。

## 当前验证

test-first：首轮缺模块为装配失败，不计行为红测；保留禁用语义后运行用例，授权请求抛 `A2D2_122_NOT_AUTHORIZED`（exit 1）；增加指定 Session 单次预算后 1 passed / 0 skipped（exit 0）。测试接缝为任务明确批准的外部 LLM/adapter，不使用产品 mock。真实宿主记录随后在 artifacts 追加。
