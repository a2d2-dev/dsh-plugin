# DSH 创建会话 502 诊断与恢复

## 实验目的

定位并恢复 `https://dsh.e5box.a2d2.dev` 的创建会话 502，验证坏任务文档不会通过 CEO prompt 初始化产生未捕获异常。

## 步骤与记录

1. agent-browser 打开实际入口，浏览器显示 HTTP ERROR 502；辅助 HTTP 探测也返回 502。
2. supervisor 中 dsh-web-server 持续启动退出；stderr 为 `TaskDocumentError: a2d2: mainSession must be a non-empty string`，调用链为 TaskDocumentStore.list → taskOfMainSession → ceo-prompt.maybeInstall。
3. 使用实际 TaskDocumentStore 扫描工作区，只有 Rise Global 项目失败。逐份核对发现 `.dsh/a2d2/tasks/issue-2987.yaml` 与 `issue-2995.yaml` 均为 `mainSession: null`、`sessions: []`。文件修改时间为本机 2026-10-17 23:01；写入者未查明。
4. 原文件备份到 `/data/_ssd2t/dsh/incident-backups/20261017-null-main-session/`，并改名为 `.yaml.invalid-20261017` 保留现场。未伪造主会话，也未修改 GitHub issue。
5. supervisor 启动 DSH 后，通过 agent-browser 登录实际入口、点击 New session。浏览器网络记录两次 `POST /api/session/create` 均为 HTTP 200；页面正常显示 Rise Global 新会话。
6. 在独立 worktree 增加真实坏任务文件的回归场景，覆盖启动恢复与 agent/created。修复前 Vitest 报 2 个 Unhandled Rejection 并退出 1；修复后 38 个测试文件、620 项测试通过，typecheck 与 build 通过。

## 根因与修复

无有效主会话的任务不应写入插件绑定目录；本地任务绑定要求 mainSession 为非空会话 ID，且在 sessions 中存在。CEO prompt 的两个初始化入口丢弃了异步 Promise，没有处理解析失败，导致 Node 进程退出，反向代理随后返回 502。

补丁按现有 agent-prompt 的处理方式捕获两个入口的错误，并明确记录会话、cwd 与原始错误。任务文档仍严格校验；修复有效绑定后可以重新安装 CEO prompt，不放宽格式、不静默忽略错误。

当前服务恢复来自坏数据隔离。防崩溃补丁已本地验证，待 PR 审核；未部署该代码补丁。两个隔离任务目前没有插件会话绑定，后续应在真实主会话建立后使用 bind_main_session 登记。

## 页面证据

![恢复后的实际 DSH 页面](https://10.126.126.12:5200/assets/%E5%B7%A5%E4%BD%9C/assets/share_1792304595768_DSH_%E5%88%9B%E5%BB%BA%E4%BC%9A%E8%AF%9D%E6%81%A2%E5%A4%8D%E6%88%AA%E5%9B%BE_2026-10-17.png)
