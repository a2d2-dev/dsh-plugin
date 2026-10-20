# #122 host admission：诊断与最小修复

## 固定边界

- 锁定 worktree `a2d2-v3-02-host-admission`；分支 `fix/a2d2-v3-02-host-admission`；开始 HEAD `b14ed4175a7ca9e807f0ba1f483803d96ba5acbe`，初始 clean。
- 旧失败产品 `07297921961d01f0da7ac15336f33131b5188a6a`，tgz SHA256 `b48c4e693b5f3b4647118f287158b7d8131eb348d1f45c73306a0a9b33ba01f6`。旧 UI 证据提交 `0664518` 保留，不能当成 b14 的运行结果。
- 实际宿主 HEAD `a45068d2ec03326c800c68c9bdcd47508e3ccb9c`；controller lib SHA256 `bc889fbd3e95a994d9019f08feb9ce9033f4c6c918b6932f14b1c0fd109241a6`。不凭版本字符串或跨副本 instanceof 推断能力。

## 第一阶段：只读诊断

已加载 diagnosing-bugs/TDD，读取 AGENTS、CONTEXT、#122、协调架构与 ADR 0005/0011。未改产品、宿主或旧 root。GH CLI 意外产生 `.local/state/gh/device-id` 缓存；后续 GH 命令另设临时 XDG state，缓存不提交。

工具来自已接受 `c3aab4e299b7ba4fd972bc4b2aa7ccf05adf933c` 的 git archive，冻结在 `/tmp/a2d2-122-admission-diagnostic/scripts`。首次 prepare 使用的原工作树工具 SHA 与冻结工具一致。新建两个隔离 root：

1. `/tmp/a2d2-v3-121/122-admission-old-20261020`：原工具、原 tgz，真实公开路由重现 HTTP400 `host-admission-failed`，execution 查询 HTTP200 无 execution。命令 `node /tmp/a2d2-122-admission-diagnostic/public-red.mjs /tmp/a2d2-v3-121/122-admission-old-20261020` 退出1（断言 400 !== 200）。Project/Task/resource 均由公开路由取得，四个宿主 fixture Session 经真实 controller 创建，模型计数 0/0。自有 Web `bash-1001` 已核对 supervisor cmdline 后停止并收集 exit0。
2. `/tmp/a2d2-v3-121/122-admission-probe-20261020`：先冻结临时 instrumentation 生命周期及 preload，再 prepare 记录指纹。Node module hook 仅包裹真实已安装 tgz 的公开 `DshWorkExecutionHost.check`，记录异常并原样重抛，不读/写产品私有字段，不改请求、响应或宿主。wrapper、guard、model、manifest 指纹仍检查；原 root/guard/assembly 均未改。

三种可证伪假设及结果：

| 假设 | 预测 | 证据 |
| --- | --- | --- |
| 生产插件 Context 未声明执行服务而直接属性访问 | 动态 get 通过、直接属性抛 inject 错误 | 已捕获；旧产品 root cause 成立 |
| controller 实际缺方法 | 应抛缺失方法或调用能力错误 | 旧失败发生于 workspaceRegistry 访问，尚未调用 controller |
| preset/model/permission fixture 错误 | 应进入目录解析并具体拒绝 | 旧失败发生于这些解析之前 |

原异常为 `Error: cannot get property "workspaceRegistry" without inject`，位于真实 tgz `work-plugin.js:43`。前面的12项动态 `ctx.get` 全通过，随后 `this.ctx.workspaceRegistry` 抛错，被应用包装成通用 admission 错误。不是模型调用失败。脱敏公开请求及捕获的堆栈见同目录 artifacts；私有登录、cookie、原始日志不入 Git。

## 第二阶段及验证

当前 b14 的独立红反馈已成立：`pnpm exec vitest run tests/work-host.spec.ts -t 'starts through the production plugin Context'` 退出1，1失败、2未选，实际400 `host-admission-failed`，预期200 ready/actual。原有测试直接使用 root Context，未覆盖受 inject 约束的生产插件 Context。

未改产品源码的 src-only build + pack 退出0；b14 tgz SHA256 `71f71859b202c64f9fd061994088fa6303f2eab9139c0f4713424e31696538e4`，保存在 `/tmp/a2d2-122-admission-diagnostic/b14/`。新 root `/tmp/a2d2-v3-121/122-admission-b14-20261020` 的真实公开HTTP再次退出1，400/无execution；公开 check 原异常仍为 `cannot get property "workspaceRegistry" without inject`，真实包位置 `work-plugin.js:92`。这是当前 b14 的证据，不由旧072外推。

临时重放脚本原先将 product 标签固定为旧SHA；b14留证导出时只校正该描述标签并附实际tgz SHA，不改原始请求/响应。原root文件保留。后续记录修复及真实 tgz 验证。
