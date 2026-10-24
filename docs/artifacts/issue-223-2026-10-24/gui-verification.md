# #223 既有 GUI 导航验证

## 目的

修复原历史会话点击“进入当前处理会话”无法打开当前处理会话的问题。只验证查看导航；不恢复 freeland#1395、不发送业务消息、不改变其模型、权限或 owner/epoch。

## 已验证现场

- 用户触发任务：freeland#1395，插件安装链路性能优化。
- 原历史段：`session-9af116ad-e4ab-4a92-b9d5-6207d324983a`（会话 3）。
- 权威当前段：`session-7353477e-dcc2-4e6e-b8c3-5df486cfbe9e`（会话 4）。
- `task.detail` 返回 completed，execution epoch=4、state=failed，actual.runtimeId 与 session.runtimeId 一致。
- 原执行错误为 `incompatible-session: Existing Session model differs; silent reconfiguration refused`。本票不消除原执行失败，也不静默修改模型。
- 安装中的客户端 source map 与冻结基线 `f78404dd312b80c4a06f75a41ed9a5e54fbc84c8` 的 27 个客户端源文件逐字一致，排除用旧分支覆盖部署中其他 UI 修复的风险。

## 步骤与原始结果

1. 使用 agent-browser 独立会话 `a2d2-jump` 打开既有 DSH GUI；原有运行宿主和端口保持。
2. 选择 #1395 会话 3 的 Chat，点击原生底部交接卡上的按钮。顶部折叠关联弹层中也有同名按钮，不能将未触发的点击或等待超时算作本故障复现。
3. 真实底部点击完成后，页面出现完整报错：`当前处理会话暂不可进入，请稍后重试或查看工作详情。`；选中的仍是会话 3。[错误截图](navigation-before.png)。
4. 用脚本再次驱动该入口，要求导航到当前会话；运行 `python3 .scratch/verify-current-session-navigation.py`，exit 1，明确失败于同一条 alert，选中行仍为会话 3。脚本随后补充 sidebar `data-row-key` 的 session ID 校验，绿灯不能仅凭标题判定。
5. 实施代理在真实 `WorkPanelController.openCurrentTask` 调用缝取得同一报错的红测。根因为前端的执行状态白名单错误地将 failed 视为不可查看。

## 修复后验收

代码交付：PR #228，实施提交 `542b8b5f6354b04921670db44368fa0610f2fb5c`，含实施验证文档的交付 HEAD 为 `11a4ee776c5a28b734f39848ae96aa4011362af7`。独立只读审查由 #227 执行，最终裁决在 Issue 时间线记录。

1. 主会话重新运行目标、面板、启动与观察 4 套测试，**54/54 通过，exit 0**。类型检查、构建输出已复核。扩大回归的 6 项失败与精确基线的失败名称逐一一致，未当作通过；详见[控制器验证记录](navigation-validation.md)。
2. 对已构建客户端 source map 做精确比较：只改变 `../src/client/work-panel-controller.ts`，其余 **31 个源文件保持**。保留旧客户端及 map 备份，按固定安装目录检查目标路径后原子替换 map 和脚本。**25 个宿主 JS 产物 SHA-256 全部不变**，没有改 profile 配置、重启宿主或写入真实工作记录。
3. 旧客户端脚本 SHA-256：`49c688cf3e4c867ce592e802dbf496d6422514cfa6e2ecee4ca835233af3ad02`；修复脚本：`177862da024929d961f511960061f06cdb4b94ffdab1ae27c0549e0e2de39fc1`。浏览器刷新后实际加载的 combo revision 从 `f3de7edf629a` 变为 `aaffe1d62eb9`；已读取实际响应中的 `openCurrentTask`，确认无执行状态白名单、非空会话身份检查存在。
4. 在原历史段刷新后，运行[原入口自动化断言](verify-navigation.py)，**exit 0 / PASS**。侧边栏 `data-row-key` 从 `session:session-9af116ad-e4ab-4a92-b9d5-6207d324983a` 切到 `session:session-7353477e-dcc2-4e6e-b8c3-5df486cfbe9e`，页面无 alert。[成功进入原权威当前会话](navigation-after.png)。
5. 导航前后读取权威记录：TaskRef、execution ID、owner、epoch=4、当前 session 均一致，state 仍为 failed，原 incompatible-session 错误保留。查看成功没有假装恢复原执行，也没有建立替代后继。

首次未触发的同名按钮点击以及 CDP/等待超时均未计为有效红测；后续针对可见底部入口的脚本在修复前明确失败、修复后明确通过，覆盖用户原始症状。未对其他 Task 或完整业务安装性能作验收声明。

## Issue 与会话归属

先检查现有 Issue、相关处理会话与实例工作记录，确认本故障没有其他处理者后，创建 #223，绑定主会话 `session-909519ef-7ce1-40b0-8650-58313d823eb5`。本票与已完成的 #217 材料投递故障、其他会话处理的 #211 会话命名区分。
