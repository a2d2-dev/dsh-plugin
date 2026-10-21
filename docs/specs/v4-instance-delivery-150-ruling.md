# #150 运维风险审查裁决

审查任务 [#151](https://github.com/a2d2-dev/dsh-plugin/issues/151)，整改任务 [#154](https://github.com/a2d2-dev/dsh-plugin/issues/154)。这是唯一一轮 fresh 运维审查；产品与 Host 既有裁决不重开。审查结果 REQUEST_CHANGES，主会话裁决两项均“修”，修后由主会话直接核对，不再派第二轮 review。

## 固定证据

- reviewer session-22f46ce4-55b6-43a8-b6df-70dd37969993；实际 dispatch 为 codex/gpt-6.1-sol/xhigh，18781 settings.get revision0与派发回执已由主会话核对。
- 工具分支 test/v4-acceptance；审查 HEAD 6b2522189cc64ebdea608789949b3237aa4b1d29；base/merge-base b477025116110f63d3488e0c71e47468ad882844。主会话已独立核对 Git/PR148 与源码。
- 初始计划 SHA256 659f9d7d6fd17104ae1c4978312250442d75b882172df696237ad8a64f31b64c；24 个 frozen tools 与 plan、toolCommit 39fe47e 和审查源码一致。审查首尾 clean，无代码变化。
- 审查仅运维脚本、测试、候选和现有证据。主会话额外只读核对 Host serving/shutdown 合同，确认 a450→8282 对应路径无改动。

## 修 O-F1：实际浏览器客户端须绑定到固定制品

位置：[verify-live.mjs](https://github.com/a2d2-dev/dsh-plugin/blob/6b2522189cc64ebdea608789949b3237aa4b1d29/scripts/v4-acceptance/verify-live.mjs#L80)。严重度 P2。

现有网络校验只检查同源、URL、200 和 JavaScript，记录 hash；磁盘 client 正确不能证明页面实际执行相同客户端。页面资源后二次 fetch 也不能替代实际加载响应。旧或错误客户端仍可能写出 verified，再被 one-shot 记作 deployment-verified。

正式 Host 会去除 client 尾部 sourceURL/sourceMappingURL、补换行、按资源顺序拼接分号并附组合 source map。整改应按正式转换和资源身份绑定实际加载响应，不能直接比较组合响应原始 SHA 与磁盘文件 SHA。必要回归：正确新/旧客户端通过；同源、200、JavaScript、入口文字均正确而客户端内容错误时拒绝。

## 修 O-F2：明确停机错误须阻止切新

位置：[preview-stop.mjs](https://github.com/a2d2-dev/dsh-plugin/blob/6b2522189cc64ebdea608789949b3237aa4b1d29/scripts/v4-acceptance/preview-stop.mjs#L21)、[stopped-cut.mjs](https://github.com/a2d2-dev/dsh-plugin/blob/6b2522189cc64ebdea608789949b3237aa4b1d29/scripts/v4-acceptance/stopped-cut.mjs#L19)。严重度 P1。

旧 wrapper 把 CLI stdout/stderr 写入另一个私有日志，但工具只取 Supervisor stdout 的 wrapper exit 记录。Host disposer 可先 logger.error 再被吞错，CLI仍在五秒内 exit0/null；静态数据完整并不能让已明确错误越过已定拒新门。

整改应在信号前绑定旧 CLI 日志描述符、inode/offset，旧 CLI 消失后核对可归因停机窗口；明确失败阻止切新，对外只出分类/hash。保留数据并仅在完整性可证时恢复可运行旧宿主。必要回归：明确错误但 exit0 的反例、正常日志与日志身份/截断边界。Host 没有正式 shutdown marker；不新增 Host 回执，不因未知标记一律宣称强退，也不把无错误或 exit0 当 graceful/flush ack。

## 记账与已排除范围

- 18781 必须等待预览真实业务/模型验收单独通过；deployment-verified 仅表示切换校验。GUI执行票将绑定预览业务证据，不把它加成当前18782的第三项缺陷。
- 已审路径/实例、单PID及startTicks、hold无子、停后zstd/accepted cut/无写FD/双native、rollback保留当前数据、凭据引用和服务外执行机制不扩大重写。
- 原ext4 setup超时仍保留，tmpfs相关对照不意味着原环境已修。
- 两项整改只动运维脚本/相关测试/证据，不动冻结产品或Host。高级执行者 session-24baf38e-54c1-4d21-a4b1-6368112298f1 已实际派发 #154，codex/gpt-6.1-sol/xhigh，唯一持有工具树写权；当前仅修复及离线新plan准备，未授权服务切换。

## 整改闭合状态

O-F1：待实际红绿、提交和主会话核对。

O-F2：待实际红绿、提交和主会话核对。

两live实例均尚未因本任务切换，真实模型与页面验收尚未完成。
