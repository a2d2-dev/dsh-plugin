# 固定最终包的动态 Origin 重启尝试

**结论：本轮严格重启验收失败，不能据此宣布 #121 全部通过。** 原文、blank 会话轻入口及当前已选 Session 新关联即时显示均已实际 UI 闭合；同 root 以 `--port 0` 重启导致实际 Origin 改变，原生首用选择恢复自动新增 Session，精确集合从 2 变为 3。此目录保留失败原貌，未删除 Session、修改基线或清零 metrics。

固定 checkout `8d3308112f3affb91767b5976a8d1d2d950c921b`；产品代码修复提交 `433e9860ca76026a05d001c0552da0a4b45c84bf`；tgz SHA256 `81466a33342c0256873bbf30dac693ee0cff2c075246a4ad859d94663ce0a82b`。真实宿主 `a45068d2ec03326c800c68c9bdcd47508e3ccb9c`、CLI `0.2.0-rc.2`、前端实际显示 `0.2.0-rc.2-4c24ce4`；不改宿主、产品、工具源码。

## 新 guard 正控

[独立正控](../positive-guard/positive.json) 实测 gateway `0→1`、adapter `0→1`，唯一 `finish/error` 携带 `A2D2_ACCEPTANCE_MODEL_DISABLED`；未生成模型文本。managed job `bash-546`，`http://127.0.0.1:40845`，已停止，子进程 exit 0。

[工具测试命令](../positive-guard/positive-tests.tap) 因本验收 worktree 未安装 `@deepseek-ai/cordis`，在测试模块 bootstrap 时退出 1；没有实际执行该测试文件，不将其写成 unit 通过。CEO 在相同冻结源码与依赖上已有工具单元验证；本 lane 通过运行中真实 CLI `positive` 完成新 guard 正控，无需为此修改依赖或扩大安装。

## 本轮通过的真实事实

| 场景 | 证据 |
| --- | --- |
| 修复 seed：两个非空 workspaceId、正确 cwd、目标 Workspace 实际成员含两个 seed IDs | [03 公开成员验证](03-seed-public-membership-verified.json) |
| UI 创建的目标／规格首尾空白、尾换行和两条独立多行 criteria 逐字保存 | [08 UI 创建比较](08-ui-create-exact-original.json)、[实际表单](07-ui-rich-original-form.png) |
| API 合法原文后仅用 UI 改目标，规格和 criteria 逐字不变 | [10 仅改目标](10-ui-goal-only-exact.json) |
| UI 不编辑直接重存，正文与数组边界均完整 | [11 无改动重存](11-ui-unchanged-resave-exact.json) |
| 两 Project 同名独立 Task、拆解、子工作、父子引用及活动 | [15 公开记录及 HTTP](15-two-projects-and-http-boundaries.json)、[活动截图](13-parent-activity-desktop.png) |
| 无 Project 创建入口、无“所有项目”、当前 Project 过滤 | [空态](06-empty-project-entry.png)、[乙过滤 DOM](18-project-b-filter-isolation.json) |
| 兼容 Session 关联幂等，重复后完整 Task 相同且版本 7 不增 | [20 幂等证据](20-association-idempotent.json) |
| blank Session 输入区上方的真实工作轻入口 | [21 原生截图](21-blank-native-work-entry.png) |
| **当前已选同一 Session** 新增子 Task 关联后无页面刷新／无切 Session 即显示新链接，点击回正确子详情和四标签 | [26 精确验证](26-r5-same-selected-session-verified.json)、[23 即时链接截图](23-current-session-new-child-link-without-refresh.png)；文档 timeOrigin 前后一致，公开父子 SessionRef 相等 |
| 第二既有 Session 的原生打开；返回列表保留 Project／视图／搜索；关闭回原会话 | [28 第二会话](28-second-session-native-entry.json)、[30 返回状态](30-return-list-preserved-state.json)、[31 截图](31-return-list-desktop.png) |
| 桌面 1440×900 与补充窄屏 768×900 | [21 桌面](21-blank-native-work-entry.png)、[29 窄屏](29-narrow-child-detail.png) |
| 真实认证／跨 Origin／跨 Project／不兼容资源／版本／commandId 拒绝均符合预期，拒绝前后完整领域结果相同 | [15 HTTP 边界](15-two-projects-and-http-boundaries.json) |
| 公开旧地址映射唯一、重复分配另一 Task 拒绝、v3 文件与旧 tasks 目录分离 | [33 地址与存储](33-legacy-address-and-storage-isolation.json)；仅合同探针，没有复制／迁移旧活动 Task；真实旧 writer 互操作未在浏览器 lane 执行 |
| 刷新前后完整 Project／Agent／Task／历史／关联及旧地址映射完全相同 | [36 刷新比较](36-after-refresh-public-state.json) |
| **重启后浏览器登录前**，零 live Session 的公开完整 ID 集合仍为原两个，全部工作查询和映射保持相同 | [38 冷态公开查询](38-restart-cold-public-id-set-and-domain.json) |

## 严格失败与根因

[冻结基线](baseline.json) 只有：

- `session-d05a22e4-cea3-48d9-8454-39680dbfa9b7`
- `session-9b05c29d-29db-477b-aabb-9d81d3027f09`

这次 seed 已通过公开 Workspace 成员校验，不再有首轮缺挂问题。原生登录前上述两个会话均 cold，IDs 完全相同。随后登录重启的新端口，宿主自动新建 `session-0e896db5-b289-4dab-895f-1ab24895bcc1`，ID 集合断言退出 1。[39 真实 Session 列表与比较](39-new-origin-native-restore-id-set-failed.json)、[40 现场](40-new-origin-native-restore-created-session.png) 明确记录 `passed:false`；未继续在污染 root 修补或重定基线。

只读根因：宿主 `restoreSelection` 使用当前 Origin 的保存选择。该轮首进程为 `http://127.0.0.1:34569`，以固定工具 `run --port 0` 重启后变为 `http://127.0.0.1:42801`，浏览器在新 Origin 没有原已选 Session。`restoreSelection` 在没有 saved sessionId 时走 recentWorkspace → connectWorkspace；冷态 Session 摘要不是可复用 blank，因而走首用创建路径。这里的 Session 增加发生在浏览器原生启动恢复，不是 A²D² 工作动作触发，但仍使本轮所要求的精确集合不增失败。

已经交给 CEO 裁决后续保持实际 Origin 的真实 CLI／工具方案；没有自行改工具、overlay 或宿主。原失败 root `/tmp/a2d2-v3-121/product-final-8d33081` 完整保留。

## 退出结果与清理

- 官方 tgz 安装、修复 seed 公开成员断言、UI 原文逐字断言、关联幂等、导航、HTTP 拒绝断言、刷新比较、重启冷态公开比较均 exit 0。
- 本 worktree 工具 test 模块加载 exit 1；实际 CLI guard 正控 exit 0。
- 浏览器选择器一次命令参数未匹配元素，exit 1；更新 snapshot 引用后真实操作成功，不记为产品缺陷。资源已被甲项目占用时，乙接入 UI 正确显示 `resource-in-use`，保持乙独立无资源，没有强制改归属。
- 新 Origin 原生恢复后的 Session 集合断言 **exit 1**，未记为通过。
- 正式首进程 managed job `bash-551`、重启 `bash-597` 均停止并收集到子进程 exit 0；正控 `bash-546` 同样已收集 exit 0。短 jobs `bash-549`、`bash-552`、`bash-553`、`bash-560`、`bash-570`、`bash-572`、`bash-575`、`bash-587`、`bash-589`、`bash-593`、`bash-594`、`bash-596`、`bash-600` 均已收集 exit 0。
- 专属 agent-browser 已关闭。没有修改或接管 18780／18781、宿主或原用户 profile。登录 URL、cookie、原始服务日志与 browser profile 不归档。
- [append-only metrics](metrics.jsonl) 跨两进程完整保留，gateway 与 adapter 始终为 **0**；新进程及新增 Session 的出生事实没有清除。零模型调用不能替代失败的身份集合验收。
