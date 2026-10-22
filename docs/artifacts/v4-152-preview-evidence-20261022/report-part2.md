# #152 v4 真实 preview 验收：执行链 part2

run：`v4-152-6b252218-r01`；目标：<http://10.126.126.12:18782/>。本记录由 qa152b 外部自动验收执行者编写，不冒充 LF。产品代码、Host/profile、服务未修改。

## E 外部交付（已完成）

目的：提供父任务可核验的真实外部子成果，保持 E 无本地 Task/Session。

步骤：读取 E 正文；在隔离目录写 E.proof.json，再用独立 Python 命令解析并断言 run、fixture、数量3/stable 标签，计算 SHA256。将真实路径/hash/操作者和校验退出码写入 GitHub 专用评论，再关闭 #159；回读 state/closedAt/updatedAt。

记录：proof 路径 `/data/_dsh-dev/acceptance-workspaces/v4-152-r01/E.proof.json`，SHA256 `5a3859f7ab57d2d0408fde36d278894b5409a536db45e1478273efadbdf11a3f`，校验时间 `2026-10-22T02:18:51.632606+00:00`，exit 0。交付评论 <https://github.com/a2d2-dev/dsh-plugin/issues/159#issuecomment-6331115575>。真实关闭成功；E 无 Task/Execution/Session/owner/epoch。父验收尚未发生，Closed 不计作父验收通过。

证据：[独立校验](raw/part2-E-verification.json)、[交付说明](raw/part2-E-delivery-comment.md)、[关闭回读](raw/part2-E-closed.json)。

## P 入口（复核中）

目的：由正式面板「开始处理」创建唯一执行。

步骤：校验锁定 worktree/分支并 git pull --ff-only；加载 agent-browser core，用独立 qa152b 登录、关闭 Preview Notice。进入 A²D²，Project1 Issue 列表选 P；筛选 #157 后点击可见入口，并用 DOM button.click 复核。重开浏览器 fresh=1 排除旧 shell，确认 client modules rev `761246ab4baa`。正式 projects.list 200；Project1 与 repo 两个来源均属于本地演示项目 ec480d94-c5e8-44a0-80a0-897945df1a67。

记录：初次 P 点击后停留列表，无详情、无「开始处理」。页面来源状态 `work-record-unavailable: Local work records could not be accessed safely`。尚未创建 P Task，未启动模型。公开 source.issue 查询正在复核，不能将上述现象直接等同最终后端原因。

证据：[初次页面与按钮](raw/part2-initial-entry-failure.json)、[fresh 页面与正式查询](raw/part2-fresh-runtime-observation.json)、[桌面截图](shots/part2-P-entry-before-refresh-desktop.png)。

## 待执行

P/C 真实模型、native child、自有后台 checksum job、自动接续、父子完成拒绝边界，均尚未通过，不得由 E 的单项完成替代。
