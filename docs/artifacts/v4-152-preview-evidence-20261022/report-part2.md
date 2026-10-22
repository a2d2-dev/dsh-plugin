# #152 v4 真实 preview 验收：执行链 part2

run：`v4-152-6b252218-r01`；目标：<http://10.126.126.12:18782/>。本记录由 qa152b 外部自动验收执行者编写，不冒充 LF。产品代码、Host/profile、服务未修改。

## E 外部交付（已完成）

目的：提供父任务可核验的真实外部子成果，保持 E 无本地 Task/Session。

步骤：读取 E 正文；在隔离目录写 E.proof.json，再用独立 Python 命令解析并断言 run、fixture、数量3/stable 标签，计算 SHA256。将真实路径/hash/操作者和校验退出码写入 GitHub 专用评论，再关闭 #159；回读 state/closedAt/updatedAt。

记录：proof 路径 `/data/_dsh-dev/acceptance-workspaces/v4-152-r01/E.proof.json`，SHA256 `5a3859f7ab57d2d0408fde36d278894b5409a536db45e1478273efadbdf11a3f`，校验时间 `2026-10-22T02:18:51.632606+00:00`，exit 0。交付评论 <https://github.com/a2d2-dev/dsh-plugin/issues/159#issuecomment-6331115575>。真实关闭成功；E 无 Task/Execution/Session/owner/epoch。父验收尚未发生，Closed 不计作父验收通过。

证据：[独立校验](raw/part2-E-verification.json)、[交付说明](raw/part2-E-delivery-comment.md)、[关闭回读](raw/part2-E-closed.json)。

## P/C 执行入口（失败，阻断后续）

目的：从面板「开始处理」创建 P 唯一执行及 C 独立执行。

步骤：校验锁定 worktree/分支并 git pull --ff-only；加载 agent-browser core，用独立 qa152b 登录、关闭 Preview Notice。进入 A²D²，Project1 Issue 列表选 P；筛选 #157 后点击可见入口，并用 DOM button.click 复核。重开浏览器 fresh=1 排除旧 shell，确认 client modules rev `761246ab4baa`。正式 projects.list 200；Project1 与 repo 两个来源均属于本地演示项目 ec480d94-c5e8-44a0-80a0-897945df1a67。对 P/C 在两个来源分别执行公开 source.issue 查询（refresh:true），没有绕过详情直接创建 Task。

记录：P 点击后停留列表，无详情、无「开始处理」。页面来源状态 `work-record-unavailable: Local work records could not be accessed safely`。正式 POST `/a2d2/api/work` 结果如下：

| fixture / 来源 | 请求开始时间 UTC | 终态时间 UTC | HTTP / 业务结果 |
| --- | --- | --- | --- |
| P / Project1 | 02:22:59.682 | 02:23:03.245 | 503 / failed / work-record-unavailable |
| P / Repo | 02:24:20.725 | 02:24:41.159 | 503 / failed / work-record-unavailable |
| C / Repo | 02:24:20.726 | 02:24:25.937 | 503 / failed / work-record-unavailable |
| C / Project1 | 02:24:20.726 | 02:24:28.221 | 503 / failed / work-record-unavailable |

日期均为 2026-10-22，错误原文均为 `Local work records could not be accessed safely`。请求 kind 为 query，value 包含 type:source.issue、number、refresh:true、projectId 与真实 sourceId。完整 envelope/响应见原始证据。页面 errors 命令无控制台错误输出，不能将空输出当作没有产品缺陷。根因未诊断，不将通用错误推测为具体文件损坏或权限问题。

`project.detail` 于 02:25:32.557Z HTTP200 返回 5 个既有 Task，无本 run P/C/E；其中 2026-10-21 的旧“真实模型启动与自动交接”Task、epoch2 和 token/决定材料均为历史，明确不计入本 run。`source.execution-options` 于 02:25:33.650Z HTTP200，指定 codex/gpt-6.1-sol 在可用模型表内，隔离 workspace 可选。默认仍为 codex/gpt-6-astra，未发送验收模型请求，不能把可用模型列表当实际路由证据。

证据：[初次页面与按钮](raw/part2-initial-entry-failure.json)、[fresh 页面与正式查询](raw/part2-fresh-runtime-observation.json)、[P Project1 请求回执](raw/part2-P-source-issue-503.json)、[P/C 其他来源回执](raw/part2-PC-source-boundary-503.json)、[正式项目与选项](raw/part2-project-and-options.json)、[桌面1440×1000](shots/part2-fresh-entry-desktop.png)、[移动390×844](shots/part2-fresh-entry-mobile.png)、[移动下滚错误](shots/part2-mobile-error-scrolled.png)。

## 本轮完成边界

| 项目 | 实际结果 |
| --- | --- |
| E proof/JSON/校验/hash/交付评论/真实关闭 | 完成；父尚未采纳 |
| P 唯一 Task/Execution/Session/owner/epoch | 未产生，全部 null；入口被阻断 |
| C 独立 Task/Execution/Session/owner/epoch | 未产生，全部 null；同一详情接口被阻断 |
| P.proof.json、C.proof.json | 未写，必须由各自真实执行完成 |
| 数量3/stable 决定与 in-progress | 未在本轮 P 执行保存；E proof 保有独立决定 |
| native child | 未启动，无 child ID/结论/owner |
| 自有后台 checksum job | 未启动；无 running、terminal、job_output/控制器消费实证 |
| 未收结果 / 待收 / 已收取 / 未知消费 | 均无本 run job，不能赋予任何状态；不把验收浏览器后台命令当 P job |
| 父未验收子结果的 done 拒绝原文 | 未测试，无拒绝原文；没有 P owner 可负责报告 |
| 自动策略与 automatic=true | 未配置；无本 run真实 meter，未注入 token、未手点接续 |
| 准备→旧入口保留→结果收取→正式接任/入口切换 | 四阶段均未触发；无 operationId、epoch 变化或后继 Session |
| 新段复述及旧段推进阻止 | 未测试，无新旧段 |
| codex/gpt-6.1-sol/medium 实际请求/usage | 未调用；仅证实 provider/model 候选存在，无 reasoning/request/usage 证据 |

本轮未通过完整执行链验收。唯一已复现阻断为 PC-ENTRY-503；其余不是通过，也不声称是已证明的独立缺陷。P/C 仍开放；E 已外部交付关闭。A/B/X 与现有开发 Issue 未操作。

命令说明：首次尝试 `python` 不存在（bash stderr），随后使用 `python3` 安全登录成功；未把口令持久化到证据。source.list 同步 browser eval 命令超时 exit1（后台 bash-3258 已正式收取），随后回读真实请求均 HTTP200；该浏览器命令不属于 P checksum job。其它成功截图/查询/gh/commit 命令退出成功。没有重启服务或修改业务代码。

主会话随后告知其诊断为全局单文件工作库写锁竞争，并要求停止并发刷新后做单客户端串行复测。本执行者已停止所有 refresh:true/刷新点击并关闭 qa152b；保留现状等待其恢复窗口。此诊断归属主会话，本段的独立证据仅证明上述四次 HTTP503 与本 run 执行未产生。
