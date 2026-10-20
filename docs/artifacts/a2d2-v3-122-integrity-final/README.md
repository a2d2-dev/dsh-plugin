# 最终 wrapper 完整性复验

**宿主工具通过；产品 gate 仍待 tgz。** 工具提交 `d1b2a01`，分支 `test/a2d2-v3-02-host-acceptance`，固定 base `606fcee`。本轮仅新增 wrapper 自身 SHA 拒绝检查；guard/model 内容与 [首轮真实宿主报告](../a2d2-v3-122-host-2026-10-20/README.md)完全相同，旧真实 root、assembly、baseline 和截图未改。

## 红绿与固定装配

[完整性结果](integrity-result.json)：新增公开 prepare/verify 回归在未修复时 `Missing expected rejection` exit1；当前 wrapper SHA 对照 prepared assembly 后，同 root 更换入口明确在 host/IPC 前拒绝。最终工具对旧 root snapshot 的实际拒绝 exit1，`Wrapper changed after preparation`，未更新旧指纹来绕过。

最终 [工具测试 TAP](tool-tests.tap)：

```sh
node --test tests/a2d2-v3-121-run.test.mjs tests/a2d2-v3-122-model.test.mjs tests/a2d2-v3-122-assembly.test.mjs
```

exit0，**23 passed / 0 failed / 0 skipped**；宿主真实结果另计，不把 fixture 测试冒充 Web 验收。prepare/verify 测试建立自有 122-integrity-* 隔离根并保留，不启动宿主。

[最终 assembly](assembly.json)记录 wrapper SHA `911b904b1ccea73d7032d130e2b17714bd2940f2c9127314000e56d37c1cdbf0`；guard `7763d7a8043903a440514b6bc1fbed57b3d316f660ec5fbbd017f2dfca87ed90`；model `a1680290d0d06f15cfe9261599411a6f3f5359211161a872462df3ca3cb8251d`。宿主源码、CLI、解析包及能力边界与首轮相同：实际 controller lib 提供 selectLocalModel，不能推定生产原锁包有此能力。插件 SHA 仍为 null（host-only），最终产品路径未验收。

## fresh root 真实复验及清理

`/tmp/a2d2-v3-121/122-host-integrity-final` 通过公开 prepare 创建，最终 wrapper 每次动作前验证所有固定 hash。[真实 run](18c253a3-a6bc-40b1-93d0-3643a10173a0-run.json)：managed job `bash-827`、PID `1749045`、origin `http://127.0.0.1:40291`。此为新隔离 root，不与首轮 origin 混称重启。

[正控](1792468665066-positive.json)实际 exit0：standard preset 与固定 ID controller create/retry、真实 loop、LLM/adapter `0/0→1/1`、assembly/request 匹配、default 不变、真实持久回复 seq15、turn/end seq17 completed。随后 [public-read check](1792468688771-check-public-read.json) exit0，计数保持1/1，身份和持久投影不变；[metrics](metrics.jsonl)为追加文件。

核对自有 current-run、managed job、`/proc` child patch 及 supervisor 命令后，仅 SIGTERM 本轮 supervisor；[exit](18c253a3-a6bc-40b1-93d0-3643a10173a0-exit.json) code0。bash-828 正控、bash-830 测试已收集exit0，Web bash-827已收集exit0。[最终清理断言](cleanup.json)验证三轮自有child/supervisor均已不存在，43267/40291均ECONNREFUSED，exit0。没有本轮浏览器启动；首轮 agent-browser 浏览器已close，两轮同origin重启与真实渲染证据见独立首轮报告，未冒称本轮再次浏览。

最终工具入口为 [acceptance.mjs](../../../scripts/a2d2-v3-122/acceptance.mjs)，用法和待接线 fixture/gate 见 [架构说明](../../architecture/a2d2-v3-122-acceptance.md)。实际命令均在锁定 worktree 执行；无宿主/业务/依赖/旧证据修改，未接管18780/18781，未遗留自有服务，保留独立 root 原始证据。最终 tgz、生产模型配置路径、task.start/execution、等待/恢复、手动接续及旧会话围栏仍未完成产品验收。
