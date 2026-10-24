# #225 当前处理会话导航：红测记录

## 目的与范围

在父 #223 授权的实际 `WorkPanelController.openCurrentTask` 调用缝验证：最新 `task.detail` 返回同一 Task、epoch 4、实际 runtime 与当前 session runtime 一致的失败执行时，点击应打开当前已创建会话，不恢复执行、不选 retired。此为控制器合同测试；真实 HTTP 200 由父会话取证，本文未声称重放完整 HTTP 响应或完成 GUI 验收。

- 锁定工作树：`/data/src/github.com/a2d2-dev/dsh-plugin/.scratch/current-session-navigation`
- 分支：`fix/223-current-session-navigation`
- 实现基线：`f78404dd312b80c4a06f75a41ed9a5e54fbc84c8`（release/v0.0.22）
- 当前与 retired session/runtime 标识沿用任务提供的真实触发信息，业务 Task 使用隔离测试夹具；未读取或修改真实工作库。

## 步骤与记录

1. `pwd`、`git branch --show-current`、`git rev-parse HEAD` 匹配上述目录、分支和基线，工作树初始干净。
2. 读取 `gh issue view 225 --comments`、`gh issue view 223 --comments`，并以 `--json number,title,body,comments,url` 核验完整内容（两票 comments 均为空）。
3. 首次运行指定 vitest 命令：exit 254，`Command "vitest" not found`。该结果是依赖缺失，不算红测。
4. `corepack pnpm install --offline --frozen-lockfile --ignore-scripts`：exit 0。
5. `TMPDIR="$PWD/.local/tmp" corepack pnpm exec vitest run tests/client/session-handoff-entry.spec.ts`：exit 1，**1 failed / 4 passed（5 项）**。

关键输出：

```text
FAIL ... enters the real current Session of a failed execution after handoff without resuming work
Error: 当前处理会话暂不可进入，请稍后重试或查看工作详情。
WorkPanelController.openCurrentTask src/client/work-panel-controller.ts:869:88
Tests  1 failed | 4 passed (5)
```

原始输出保存在工作树忽略目录 `.local/issue-223/red.log`，安装输出为 `.local/issue-223/install.log`。

## 根因与下一步

真实方法已读取最新 detail，随后把 `ready/running/waiting/paused` 的执行状态白名单误用于查看资格。隔离测试同 Task、actual 与 session runtime 一致，failed 独立触发原错误。导航调用只需验证权威当前会话与身份，不应授予执行恢复资格。

原生两处入口已有错误 catch 和 role=alert；尚无证据把浏览器等待超时归为同一根因。后续保留取消及迟到成功读取规则，验证失配拒绝与零 command。GUI 截图、部署和原任务真实点击由父 #223 主会话负责；本会话未操作浏览器或 live 环境。
