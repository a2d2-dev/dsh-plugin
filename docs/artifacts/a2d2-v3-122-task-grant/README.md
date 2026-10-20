# #122 TaskRef 显式模型预算

工具源码 checkpoint `ae5759b`，从已接受 `c3aab4e` 追加；同分支 `test/a2d2-v3-02-host-acceptance`。**只交付模型授权工具与合同/IPC证据，不宣称 b14 产品 kickoff 通过。** 旧 c3 宿主正控、浏览器、重启和失败记录保持原样。

## 用法与 IPC

必须用新工具 prepare 全新 root，指定最终已验证产品 tgz；不得替换旧 root 的 guard/patch/assembly。产品公开命令先建立 Task，Task 存在但 Execution 尚未创建即可授权：

```sh
node scripts/a2d2-v3-122/acceptance.mjs grant-task --root "$ROOT" \
  --project-id "$PROJECT_ID" --task-id "$TASK_ID" --calls 1 --phase startup
# 等上条命令 exit0、回执落盘后，才在真实产品页面点击开始处理或调用 task.start。
```

[CLI](../../../scripts/a2d2-v3-122/acceptance.mjs) 仅接受显式 project/task、正的安全整数 calls 和 phase；复用 #121 request，私有文件请求是：

```json
{"action":{"type":"grant-task","ref":{"projectId":"existing-project","taskId":"existing-task"},"calls":1,"phase":"startup"}}
```

成功回执包含 mode=task、grantId、ref、calls、phase；若已有 Execution 还包含 binding。CLI 将成功回执追加到本 root/evidence。失败保留本 root/ipc 的 request/response、追加 metrics 并退出1，不把超时当授权成功。guard 经 `ctx.get('a2d2Work')` 动态取得可选公开应用，调用 `query(value,{operator:true})`；不硬依赖此服务，host-only 仍可运行。没有新增产品路由、写 Task store、浏览器推导或模型消息授权。

## 固定执行身份的边界

[模型边界](../../../scripts/a2d2-v3-122/model.mjs)按 b14ed41 的公开查询契约工作。授权先 task.detail 验证 Task；task.execution 无执行时保持pending，有执行时经 session.work 唯一 control 反向核对后立即pin。pending在首次模型准入时pin executionId/owner/epoch/runtimeId/sessionId。

每次gateway执行 task.execution → session.work → task.execution：正反向须同Task、唯一control、Execution/epoch一致、当前Session正确，resource/runtime一致，选择确定性route，state ready/running且无待应用wait/pause。第二次正向读变化明确拒绝。related/review/retired/unknown、错误Project/Task、缺应用/查询失败、错误route、auxiliary和预算耗尽均拒绝，未通过核对不扣预算。身份变化需新grant，不把同Task任意Session放行。

只有一个当前grant；显式新grant可替换空闲旧grant，公共查询/流进行中替换及并发调用拒绝。预算在准入后扣一次，开始后中止不退还；不从metrics恢复，进程重启需重新grant。phase是显式授权的记录标签，不由模型内容改变。gateway/adapter尝试、rejected、authorized、task-pinned、admitted全部追加，记录grant/Task/执行/Session身份，不保存消息正文或凭据。公开查询与模型调用不是原子事务，生产仍负责已在运行请求的围栏。

## 红绿与必要回归

[TaskRef边界测试](../../../tests/a2d2-v3-122-task-grant.test.mjs)明确标记为公开查询合同示例：只验证外部模型授权边界，不冒称真实 WorkApplication/Task store 集成。首条红测缺authorizeTask（exit1）；另一个有意义行为红测证明 pending wait 尚未应用时会错误准入，`Missing expected rejection` exit1。补 runnable/control 检查后通过，记录见 [checks](checks.json)。

最终命令：

```sh
node --test tests/a2d2-v3-121-run.test.mjs tests/a2d2-v3-122-model.test.mjs \
  tests/a2d2-v3-122-assembly.test.mjs tests/a2d2-v3-122-task-grant.test.mjs
```

[实际 TAP](tool-tests.tap) exit0，**35 passed / 0 failed / 0 skipped**。覆盖CLI参数、TaskRef前置授权、epoch/owner/Execution/Session变更、错误关联/反向映射、并发查询窗口、流中替换和旧Session grant；所有脚本语法及diff检查exit0。

## 真实 host-only 私有 IPC 回归

新root `/tmp/a2d2-v3-121/122-task-grant-contract`；[assembly](assembly.json)固定 wrapper `f552554f88bf4071e65c0a395f49aa3b9b5a3af9920811d9671242487b74eb02`、guard `372c96b2d3b4cc7deb7a067e8beb8826458f3b85bc9de23bd2b41814a788e9fc`、model `7609e81fde12bcfc965b6fea1d5f85b5f04cfd3415002e35646f6c1147667efb`。host-only无产品包，plugin SHA为null；宿主源码/CLI/解析包hash及原始prepare来源独立记录，未改旧root。

[真实 grant-task CLI](cli-no-app-rejection.json)通过真实文件IPC到guard，实际exit1，明确 `WORK_APPLICATION_UNAVAILABLE`，无属性访问崩溃；[metrics](metrics.jsonl)留rejected，未引起gateway/adapter调用。随后[原host-positive](1792472402527-positive.json) exit0，标准preset固定Session复用，真实loop持久reply seq15、completed end seq17、assembly/request匹配、default未变，模型双计数0/0→1/1，证明旧Session授权仍可用。不是产品Task启动。

[run](62b6223c-89c0-4718-8b0b-8f35262bda8d-run.json)：managed `bash-1025`，origin `http://127.0.0.1:38049`，child2000731/supervisor2000719。停止前核对current-run job和两进程/proc精确命令/patch归属，仅SIGTERM自有supervisor；[exit](62b6223c-89c0-4718-8b0b-8f35262bda8d-exit.json) code0。[cleanup](checks.json)验证两进程消失、38049 ECONNREFUSED；bash-1020/1027/1028已收集exit0。没有新浏览器或其他服务启动，不监听/接管18780/18781，保留临时原始证据，只白名单复制正式文件。

## 后续真实产品连线条件

后续lane需新root安装已验证b14 tgz/SHA，实际存在Task并暴露 a2d2Work.query 的 task.detail/task.execution/session.work（含control+executionId+epoch）。先grant成功，再通过真实公开task.start触发随机当前Session kickoff，观察pin与双计数增量、真实持久reply/事件及产品状态。错误Task、缺能力等不能fallback。等待/恢复及手动接续需要产品公开控制/接任契约，再分别显式grant；本轮不自动扩大源/后继预算、不声明完整handoff或旧会话围栏验收。
