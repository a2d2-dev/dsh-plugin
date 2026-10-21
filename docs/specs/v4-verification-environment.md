# v4 验证环境与原始失败保留

本记录区分代码验收、测试环境和原始失败，不把自然绿或环境变化说成原故障已修。测试预算、断言未放宽。

## CEO 固定提交复验

- 来源 bfbf0db：固定 detached 检出，2 文件 30/30，exit 0，已接受为首片检查点。
- 执行观察 e6ca554：固定 detached 检出，3 文件 4/4，exit 0；不代表最新 scope/flush 与匹配 Host 已验收。
- 完成 87ef88c：固定 detached 检出，7 文件 52 项，50 pass、2 个原 5000ms timeout，exit 1。失败为 work-continuous 首两个用例，5727ms／6767ms。该原红不撤回。

## 高级只读诊断结论

固定 target 87ef88c，base a8ee660，源码 tracked diff 前后均 0；仅预先指定的 node_modules 链接未跟踪。诊断 session-49c94ae1-7b8b-4fa9-822e-f5b948afb382 实际派发 codex/gpt-6.1-sol／xhigh。

证据根为 `/tmp/v4-continuous-diagnosis-fcad4j_y`。11 次运行的精确 argv、环境、stdout、exit、elapsed 与错误分类由 evidence-index.json 保存。只选两个 testName，target 其余 15／base 其余 13 为 filtered skip，不算全套通过。

- 首轮 target/base/target 自然绿；后续无 trace 的 target 和 base 都能出现原 5 秒 timeout。ptrace 不是失败必要条件。
- trace 捕获 setup 早期 1881 字节快照的 rename 阻塞 16.118736 秒；当时尚无 continuous execution／Completion。base 同阶段也出现 4.839857 秒阻塞。因此这些停顿不以新 Completion 为必要条件。
- 实际 atomic-write 与 trace 均无 fsync/fdatasync；不把 fsync 当成根因。失败前无 lock EEXIST，不能把该早期停顿归因首项后段并发锁退避。
- 超时不取消底层异步，afterEach rm 可与旧写入交错，出现旧目录删除后重建、ENOTEMPTY／hook timeout。此为已确认次生清理竞态，不等于 CEO 无 cleanup 错误的原红必然同因。
- /tmp 与 /data 都是 ext4 且共用 sdb3，换/tmp不是独立物理存储对照。当前 cgroup 无 CPU quota/throttling，观察窗口有 CPU／IO pressure；它不是原红时的历史证据。最底层首因仍未锁定，不称无害flake或已修。

限制：Vitest 即使 --no-cache，仍生成 .vite-temp／SSR 临时文件，诊断发现后停止新增测试，不能宣称完全零依赖目录写入。部分调用显式携带权限字段，与用户参数要求不符；当时已是 full 策略，没有实际权限升级提示，记录该偏差，不以此证明调用约束全符合。源码、测试和预算没有被改写。

## 独立 tmpfs 对照

CEO 后续显式为验证工具生成缓存放行（不是继续声称只读诊断），仅把夹具 TMPDIR 改到既有 `/dev/shm` tmpfs，未改生产存储、原 5 秒预算或断言。容量实读 63GB，私有夹具根 `/dev/shm/a2d2-v4-controlled-_r6zg__a`；证据 `/tmp/a2d2-v4-tmpfs-check-h9q7obi8`。

| 固定对象 | 命令 exit | 两个选中用例 | 实际墙钟 |
| --- | --- | --- | --- |
| target-1 87ef88c | 0 | 524ms／848ms | 4.298s |
| base a8ee660 | 0 | 445ms／346ms | 3.346s |
| target-2 87ef88c | 0 | 426ms／362ms | 3.223s |

这只证明选中行为在独立临时存储条件下通过，不覆盖原 ext4 红，不是全 52 项稳定结论，更不代表运行实例已验收。新整改／最终组合可以明确记录使用独立夹具后复验，不能提高预算制造绿色。生产仍要在既有 DSH 和持久数据上验证。

## 当前裁决

- 环境底层停顿保留为具体未锁定条件，继续按实际需要观察，不借此改业务逻辑。
- 超时后的清理竞态记账，处理时必须等待／取消已知在途操作或保留现场；不删除仍有 writer 的夹具，不扩大为本票无关重构。
- 新的非超时断言失败必须独立核对。报告 tests 与 typecheck 的各自退出码，禁止后一个成功覆盖前一个失败。
