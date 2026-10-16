# A²D² 一期长程运行与独立开发环境验收

## 结果

一期代码已实现并部署到独立开发环境：<http://10.126.126.12:18780/>。开发与生产的配置、会话、存储、附件及验收项目执行资料分开。现有 <https://dsh.e5box.a2d2.dev/> 作为生产入口；本次功能没有部署到生产。

最终代码提交：`af2605a3f78f07151d5b771dc2a8b25635b71a93`。654 项测试、类型检查及构建通过。打包检查验证了 10 个 Node 入口；随后修改仅涉及旧记录权限判定，未改变入口或依赖。真实模型完成两次修复后的自动交接、一次运行中宿主重启恢复，任务最终为 done。最终部署重启后仍为 done，没有增加模型轮次。

跟踪：[Issue #112](https://github.com/a2d2-dev/dsh-plugin/issues/112)。代码与部署分别见 [PR #114](https://github.com/a2d2-dev/dsh-plugin/pull/114)、[PR #113](https://github.com/a2d2-dev/dsh-plugin/pull/113)，不合并。PR 基于固定生产插件基线 `1b75658`，避免夹带此前未合并改动。

## 实验目的

验证主会话执行权、自动接续和任务事件由插件管理，而不是依靠监督 AI 与临时轮换脚本；检查关闭浏览器、交接和进程重启后仍能继续同一任务。二期可视化和三期价格优化不在本次范围。

## 实验步骤

1. 创建独立 runtime worktree、`DSH_HOME=/data/_dsh-dev`、profile、数据及 `runtime-verification` 项目，用 supervisor 管理 `dsh-dev-web-server` 与 `dsh-dev-web-proxy`。
2. 用 agent-browser 实际登录，验证初始空会话/工作空间，通过页面创建开发工作空间。生产凭据只复制必要配置到独立私有文件；浏览器签名独立生成。
3. 从页面提交 `/task-runtime start 112 ...`，由插件绑定并启动任务。测试模型每轮只读取真实代次、写观察文件、完成交接文档，不调用 continue 或 rotate。
4. 关闭测试浏览器，观察后台仍创建后继。首次真实试跑发现后继缺少文件工具，定位并修复为通过宿主公开 sessionController.create 完整装配 preset、权限和工具；保留失败证据。
5. 在修复构建 `d245642` 上，从第 1 代继续，完成第 1→2→3 代两次自动交接。第 2 代运行中执行开发服务重启，未人工续跑，读取会话日志核对中断和唯一恢复消息。
6. 模型调用 complete_task 后，主会话独立断言任务记录、运行记录、交接边、工作空间成员和观察文件一致。
7. 对旧版本恢复与权限来源补充真实宿主回归，最终版本 `af2605a` 构建部署；恢复常规 `maxAutoTurns=8`，确认已完成任务不会重新执行。

## 实验记录

| 检查 | 结果及证据 |
| --- | --- |
| 开发网页登录及数据隔离 | 通过；独立项目及 workspace，无生产会话/调度数据导入 |
| 后台推进不依赖浏览器 | 关闭测试浏览器后仍完成第 0→1 代；首次后继装配缺陷随后修复 |
| 完整会话工具与权限 | 修复后实际执行 read、edit、bash；组合测试覆盖当前 preset、AGENTS、命名权限及 custom 权限 |
| 连续两次自动交接 | 第 1→2→3 代通过；不同 session ID、同一 workspace、主指针与交接边一致 |
| 运行中重启恢复 | 第 2 代 seq 46 为 interrupted；seq 52 为唯一 recover 消息；seq 86 为 completed，无人工续跑 |
| 完成收敛 | task 与 runtime 均 done，generation=3，pending operation 不存在 |
| 最终部署后不重跑 | 最后一代仍只有 1 个 turn/start，未创建第 4 代 |
| 事件可靠性 | 真实 DSH loop/JSONL 组合测试覆盖交接中事件、慢创建期间入箱、去重、重启回读、GitHub 状态变化及终态等待 |
| 旧会话恢复 | create/take/deliver 的冷/热恢复、空后继补齐、非空冲突显式 recover 均有回归 |
| 权限恢复 | 初始化宽权限不能覆盖源只读策略；明确后改保留；来源不明时阻断并要求受控恢复 |
| 自动化验证 | 39 个测试文件，654/654 通过；类型检查、构建和打包入口检查通过 |

有效真实模型交接链：

| 代次 | 会话 |
| --- | --- |
| 1 | `session-b5110c24-47a5-4c5f-954f-7a6123aa1454` |
| 2 | `session-4eb48620-a907-4613-a731-2a3bbbeb6c8b` |
| 3 | `session-b3edefe7-fbb4-4e24-9eca-eb754a0d3ed5` |

三代 workspace 均为 `a7c9e500-5214-4346-b740-619aa0e2737b`。第 0 代初次试跑记录保留；第 1→2→3 代才是修复后两次交接的验收依据。正常流程实跑构建为 `d245642`；后续旧记录及权限修正由针对性真实宿主回归和最终重启检查验证，没有混称整条模型流程运行于最终提交。

## 使用与更新

在开发工作空间创建会话后使用：

```text
/task-runtime start <issue-number> [title]
/task-runtime status
/task-runtime rotate [focus]
/task-runtime stop
/task-runtime resume
```

旧记录出现明确 recoveryRequired 时才使用 `/task-runtime recover`。受运行器管理的任务不再从旧交接卡运行浏览器创建序列；`/handoff` 会提示使用后台命令。普通未托管会话保留原交接流程。

常规开发参数：enabled=true、pollMs=2000、rotateTokens=150000、maxAutoTurns=8、maxFailures=3。每代轮数上限用于安全换代，失败与无进展另有界限。

更新命令（只构建和重启开发服务）：

```bash
cd /data/src/github.com/a2d2-dev/dsh-plugin.worktrees/dev-environment
./scripts/dev-environment-update.sh
```

## 证据附件

- [独立断言与全部代次观察](https://10.126.126.12:5200/assets/%E5%B7%A5%E4%BD%9C/assets/share_1792109792229_DSH_%E9%95%BF%E7%A8%8B%E8%BF%90%E8%A1%8C%E7%8B%AC%E7%AB%8B%E9%AA%8C%E6%94%B6%E6%96%AD%E8%A8%80.json)
- [实际中断、恢复消息及完成事件](https://10.126.126.12:5200/assets/%E5%B7%A5%E4%BD%9C/assets/share_1792109792372_DSH_%E5%AE%9E%E9%99%85%E9%87%8D%E5%90%AF%E4%B8%8E%E5%94%AF%E4%B8%80%E6%81%A2%E5%A4%8D%E6%B6%88%E6%81%AF.json)
- [最终部署、服务 PID 与完成后不重跑检查](https://10.126.126.12:5200/assets/%E5%B7%A5%E4%BD%9C/assets/share_1792110263254_A2D2_%E6%9C%80%E7%BB%88%E5%BC%80%E5%8F%91%E9%83%A8%E7%BD%B2%E4%B8%8E%E5%AE%8C%E6%88%90%E7%8A%B6%E6%80%81.json)
- [654 项测试输出](https://10.126.126.12:5200/assets/%E5%B7%A5%E4%BD%9C/assets/share_1792110262923_A2D2_%E4%B8%80%E6%9C%9F%E6%9C%80%E7%BB%88_654_%E9%A1%B9%E6%B5%8B%E8%AF%95.log)；[类型检查输出](https://10.126.126.12:5200/assets/%E5%B7%A5%E4%BD%9C/assets/share_1792110263069_A2D2_%E4%B8%80%E6%9C%9F%E6%9C%80%E7%BB%88%E7%B1%BB%E5%9E%8B%E6%A3%80%E6%9F%A5.log)
- [首次真实验收的后继缺工具记录（已修复）](https://10.126.126.12:5200/assets/%E5%B7%A5%E4%BD%9C/assets/share_1792109792909_DSH_%E9%A6%96%E6%AC%A1%E9%AA%8C%E6%94%B6%E5%8F%91%E7%8E%B0%E7%9A%84%E4%BC%9A%E8%AF%9D%E8%A3%85%E9%85%8D%E7%BC%BA%E9%99%B7.json)

![后台任务启动](https://10.126.126.12:5200/assets/%E5%B7%A5%E4%BD%9C/assets/share_1792109791154_DSH_%E5%90%8E%E5%8F%B0%E4%BB%BB%E5%8A%A1%E5%90%AF%E5%8A%A8.png)

![修复后后继继续运行](https://10.126.126.12:5200/assets/%E5%B7%A5%E4%BD%9C/assets/share_1792109791888_DSH_%E5%90%8E%E7%BB%A7%E6%81%A2%E5%A4%8D%E6%A0%87%E5%87%86%E5%B7%A5%E5%85%B7%E5%B9%B6%E7%BB%A7%E7%BB%AD%E8%BF%90%E8%A1%8C.png)

![第三代完成任务](https://10.126.126.12:5200/assets/%E5%B7%A5%E4%BD%9C/assets/share_1792109792031_DSH_%E7%AC%AC%E4%B8%89%E4%BB%A3%E5%AE%8C%E6%88%90%E4%BB%BB%E5%8A%A1.png)

## 范围与现场说明

- 开发关闭外部 notifier/Feishu/GitHub watcher。GitHub 路由与去重使用受控事件和真实宿主组合测试；未对生产仓库的实时 webhook 做在线联调。
- 文件锁面向同机、同 PID namespace；开发/生产不共写运行存储。跨任务记录与会话日志使用恢复点和消息 ID 去重，不承诺任意外部副作用绝对执行一次。无进展识别为启发式。
- 原生子代理尚未结算时延迟换代；不把尚未处理的结果留给已退任主会话。
- 生产 PID 曾从 1339798 变为 2482857。只读核查确认另一条 Codex 会话 `01a14056-d8a7-7c32-bd95-0e076af98549` 在 `2026-10-15T17:10:57.950Z` 执行 `supervisorctl update dsh-web-server`，与 supervisor 10:10:58 的停启吻合。本次部署仅管理 dsh-dev-*；不能声称整段期间生产从未重启。
- 初次部署时根盘可用空间为 0；收尾复查根盘可用约 104 GiB。清理不是本任务执行的，未冒认该工作。开发缓存和临时文件均位于 /data/_dsh-dev。
