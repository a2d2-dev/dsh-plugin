# #141 准备工具（未部署）

固定起点 `bfc0826453d971f58b9fe6715b80e3a96a4b9465`，分支 `test/v4-acceptance`，目标 `feat/task-interaction-v4-delivery`。本目录只准备；没有安装、重启、真实模型调用、Task/队列启动或 GitHub 测试对象创建。最终 #141 仍受 #136 实现片与 host142 约束。

## 已冻结与证据边界

[公开基线](baseline-public.json) 包含原 origin、服务 PID、宿主 commit、profile/plugin 链接、包与 client SHA、78 个 GUI / 3 个 preview Session 的 cwd、preset、持久配置和可用公共投影、逐记录历史数量与摘要；preview 领域记录包含 runtime、Project、Agent、Task、来源、外部映射、Execution 与命令回执。源材料和会话正文没有提交。两个实例的私有原始备份分别在 `/tmp/a2d2-v4-141-gui-baseline-2` 和 `/tmp/a2d2-v4-141-preview-baseline-3`（0700，文件0600），不应上传。比较使用私有目录中的 `baseline.json`，公开摘要只供审查。

这是顺序只读观察，活跃 CEO/children 会继续追加日志；部署前须结算、flush 后重冻。部分旧会话没有显式 model/permission 选择事件；18781 有公共 modelSelection/permissions 投影，18782 的列表没有配置投影。实际生效 sandbox/approval 与完整配置仍需未来 live 公共观察，不能把默认推成 actual。GUI phase1 没有 work-v3 store，其旧任务材料尚不能以 v3 域记录声称完整冻结；须在部署前补其公开导出或明确批准的旧存储范围。当前 children/jobs 是正常活跃工作，本工具不取消、不清理它们。

18781 实际全局入口只有 Plugins，phase1 链接及 client SHA 与环境报告相符；18782 为既有 `http://10.126.126.12:18782`，没有改成 localhost。当前截图只证明既有页面；preview 导航遇到 Preview Notice，未验证进入完整来源面板，不能沿用历史报告冒称本轮通过。

| 基线页面 | 桌面 | 窄屏 |
|---|---|---|
| 实际18781 | [截图](baseline-gui-desktop.png) | [截图](baseline-gui-narrow.png) |
| 既有18782 | [截图](baseline-preview-desktop.png) | [截图](baseline-preview-narrow.png) |

浏览器使用独立 `--session a2d2-v4-qa`，技能及 CLI core 已加载，截图后关闭。浏览器上的新会话输入框是页面既有空入口，本轮没有点击新建或发送。

## 当前硬前置

2026-10-21 本轮只读发现 dev 宿主 `apps/cli/lib/bin.js` 不存在；目录只剩 `types` 与 `tsconfig.tsbuildinfo`。公开基线记录窄范围目录 mtime、文件存在性、服务配置/launcher SHA 与 PID。只说明观察事实，不推断谁改变了它。两个进程仍运行，**当前不得重启**。原 conf 备份无法证明可执行回滚。先在独立制品区得到新、旧两套完整可运行宿主并验证 CLI 与所有动态导入，再准备切换。host142 的独立工作树只读；不能往共享 dev 的 lib/dist 构建，也不能用 npm rc2 版本号代替新 capability。

## 工具入口

在锁定 worktree 根运行（私有路径应每次唯一）：

```sh
node scripts/v4-acceptance/capture.mjs preview /tmp/a2d2-v4-<unique-preview>
node scripts/v4-acceptance/capture.mjs gui /tmp/a2d2-v4-<unique-gui>
node scripts/v4-acceptance/retention.mjs BEFORE/baseline.json AFTER/baseline.json ALLOWED_ADDITIONS.json
node scripts/v4-acceptance/fingerprint.mjs RELEASE_MANIFEST.json
node --test scripts/v4-acceptance/*.test.mjs
```

capture 只请求已有 origin 的登录交换和只读 `session/list`，不会激活冷 Session；Host Remote 的真实 envelope 为 `session/list` + `payload.args._request={}`。最初使用点分方法得到 not found，之后命名参数不符得到 gateway/arguments-invalid，均失败退出并修正，没有 fallback 伪造成功。私有 cookie 不输出，浏览器 auth state 仅私有保存。原始 zstd 先复制，再解码副本，避免解析与备份不是同一内容。

retention 检查旧 record 身份/config/material 原样保留、历史前缀不变；新对象必须按 `kind:id` 明确登记。domain 状态变更默认也拒绝，避免悄悄放松保留约束；合法业务变更须单独审查，不能删旧 baseline 来让比较通过。不同 history stream 分别比较，正常日志追加不报漂移。workspace/config 的 SHA 是取证，不是自动许可替换。

fingerprint 拒绝缺少 tgz/client/new-host/rollback-host/动态导入证明的 manifest，以及解析到共享 dev 的路径。最终需填写真实整合 commit 与 host142 完整 commit，不能填 base 或版本号冒称交付。清单 roles：plugin-tgz、plugin-client、host-cli、host-web、host-jobs、host-session、host-smoke、rollback-cli、rollback-smoke；每项为绝对 path + SHA256。host/rollback roots 必须规范化且独立。tgz 内 `package/lib/client.js` 必须与验收 client SHA 一致。

## 本阶段验证记录

- `node --test scripts/v4-acceptance/retention.test.mjs`：实现前 MODULE_NOT_FOUND，exit1；实现后1/1通过。覆盖 cwd/model/permissions/agentPreset 漂移、历史丢失、身份消失、新对象登记与日志追加。
- `node --test scripts/v4-acceptance/fingerprint.test.mjs`：实现前 MODULE_NOT_FOUND，exit1；实现后与 retention 合跑2/2通过。缺回滚宿主/固定指纹或共享 dev 路径必须在 stop 前拒绝。
- capture preview：64 个保留记录，其中3 Session；capture gui：78 个保留记录，全部 Session。未把缺失选择事件冒称配置通过。
- systemd `is-system-running` 返回 running；`supervisorctl status` 两指定程序 RUNNING。只读，没有调用 start/stop/restart/update/reread。
- UI 仅 baseline。18781 有6个活跃 subagents 的列表指示，未清理；真实模型、v4 UI、自动接续、重启保留均未验证。
