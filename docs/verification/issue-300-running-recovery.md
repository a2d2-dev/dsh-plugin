# #300 当前主会话运行后同步持续委托状态

## 目的与范围

当前主会话有真实工具进展时，持续委托不应继续显示已被推翻的中断或空闲错误，也不应因遗失槽位而漏计实际占用。仅处理协调状态；不接管 #3073 日志/S3 业务。业务等待、用户暂停/结束及真实未解决错误保持独立。

## 根因证据

在最新主干 `0856717` 上，通过真实 DSH Agent、会话持久化、模型循环和正在执行的 `hold_recovery` 工具构造回归，外部模型输出受控。

1. 旧逻辑只遍历已保留槽位，因此实际运行但槽位遗失的当前主会话未被观察。
2. 对真实 running 的执行直接跳过，只对准确旧 `observeSession` 错误有特殊恢复路径，保留了旧 interrupted/idle 队列状态。
3. 宿主失败观察只读取最后一次 `turn/end`，即使后面已有新 `turn/start` 且当前主会话仍真实运行，仍返回上一轮 provider 错误。

失败回归命令：

```sh
pnpm exec vitest run tests/work-continuous-integration.spec.ts -t 'reconciles historical protection'
```

首次仅扩展 interrupted 情形时，1 失败、1 通过。加入缺槽位和旧失败新轮次后，4 失败、1 通过。失败分别命中 blocked 未恢复、旧 runtimeFailure 未淘汰；原始输出保留在验收归档，未把预期失败写成通过。

## 修复与回归

已实现调度锁内的当前执行占用扫描、新轮次淘汰旧失败、按 ExecutionId/owner/epoch/Session 核对后更新队列，以及容量已满时不唤醒旧 idle 项的门禁。全过程只读观察当前主会话，不额外创建会话或发送输入。

回归覆盖保留/遗失槽位的 observeSession、interrupted、idle 旧状态；真实旧失败之后原生人工输入开启新轮次；反复协调不重启工具、不增加 Task 或模型请求；工具返回后安全释放及轮转。负例覆盖 owner/epoch/Session 变化、旧 ExecutionId、历史/子/无关会话、真实执行/接续/runtime 错误、未知保护、wait/pause/end，以及并发 1 下另一个旧槽位仍有待投递输入。

已通过的检查：

- 5 个相关文件 164 项回归，包括持续队列、真实 Agent 集成、执行、生命周期和安全边界。
- `pnpm typecheck`。
- `pnpm verify:repository`。
- `pnpm test:node`：28 通过、2 项沿用原配置跳过。

`verify:pack-exports` 首次在未提交工作树按其设计拒绝执行，尚不记通过；提交后将按门禁要求重跑。独立审查和开发发布仍待完成。

## 指定开发实例

入口：[DSH 插件开发](https://dsh-dev.e5box.a2d2.dev/)。根据本轮环境指令，只安装及重启开发实例，生产服务不修改。发布候选须保留开发环境已有 #197、#281、#320、#334 修复。

修复前已记录真实页面基线：当前 #300 为正在处理 1、占用 1/1；公开执行观察为 running，同一当前会话原生事件有 139 次工具调用、1 次 turn/start、0 次 turn/end。这是正常基线，未将其宣称为现场再次复现；缺陷复现来自上述真实 Agent 集成回归。

## 交付状态

实现、独立审查、合并、开发发布及发布后页面验收尚未全部完成。本记录不表示验收完成，Issue 保持 Open。
