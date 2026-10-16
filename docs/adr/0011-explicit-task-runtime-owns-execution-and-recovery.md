# 显式启用的任务由宿主运行器管理执行权和恢复

日期：2026-10-15。LF 授权一期实现长程运行；开发使用独立 DSH_HOME、profile、sessions、storages 和项目 `.dsh/a2d2`，生产保持现状。本决定扩展 ADR 0003 的执行层记录，不复制 tracker 的任务需求或验收。

## 决定

- 独立 `dsh-a2d2/task-runtime` mount 默认关闭。开启 mount 后，已绑定任务仍需 `/task-runtime start`，绑定本身不启动后台运行。
- 运行器用公开 AgentLoop、SessionQuery、sessionPersistence、workspace 和 sessionController API 工作。运行记录在独立 DSH home 中保存项目、workspace、当前主会话、操作步骤、固定后继 ID、续跑状态和任务事件收件箱。只发现已显式启动的记录。
- 每个任务的文件所有权锁跨越整个调度周期；另外的短写锁保护原子记录替换。每次 `agent/pre-step` 验证当前 owner、会话和任务主指针。停用运行器或主会话过期时拒绝执行；不终止无关会话。
- 源会话空闲后通过 `runMaintenance` 占据安全边界。交接先保存固定后继 ID，再 prepare、投递写作指令、验证文档、创建或恢复后继、继承 workspace、选择本地 CEO 模型、take、投递接续消息。普通 managed `/handoff` 拒绝并提示 `/task-runtime rotate`，不调度交接；既有 orb 在失败处停止。其他 take 不能绕开操作身份。
- active 任务一轮结束后默认继续。完成、真实提问、未结算原生子代理、活动子任务、已登记 GitHub 等待和显式 wait 阻止空推。工具可补充继续或等待状态；遗漏工具调用不停止后台生命周期。每代健康自动轮数达到上限后交接；重复进展指纹达到阈值后 blocked。
- GitHub watch 保存任务地址并随主会话交接；子任务完成先写入父任务收件箱再提交本地完成。事件具有稳定 ID，消息身份在投递前保存，重试回读公开会话日志和 pending inbox 去重。
- PR 事件 ID 同时包含 watch 序号和不可变状态摘要，收件箱写入与 watch 确认之间中断后，新状态不会被旧 ID 吞掉。冷会话通过 sessionController 恢复本地模型配置；执行中断产生以失败 turn 序号标识的恢复消息，真实重试有上限，用户主动取消则暂停。原生通知或 LF 回复使等待态重新进入 running。
- 执行围栏挂在基础任务服务上；可选调度插件卸载后保留关闭态检查，避免卸载窗口释放旧主会话执行权。
- 队列持久化与模型消费分别核实。冷恢复发现已有 pending inbox 时，在公开 `runMaintenance` 边界内发送并移除瞬时唤醒信号，释放宿主 wake latch；不重复插入原消息，瞬时信号不进入模型历史。交接文档只有在写作消息已消费且会话空闲后才校验。
- 事件先进入 `homeDir/inbox/<task-key>.json` 的独立短写锁，运行记录锁不参与 enqueue。调度器先把暂存事件及其消息 ID 提交到运行记录，再确认移除暂存项；中断后重复导入按事件 ID 去重。慢 create、模型选择或日志观察可以延后投递，但不阻塞事件落盘。
- GitHub 等待依据成功工具结果保存的结构化状态。只有 open/watching 与已登记 pending 进入 waiting-event；已终态、拒绝、未安装、异常结果不构成外部等待。

## 边界

- 会话日志与运行记录是两个持久化边界，不宣称跨存储事务或绝对一次执行。已投递消息在运行记录确认前崩溃时通过消息 ID 回读恢复；宿主 flush 失败、未被模型接纳的消息、日志损坏均可见并有界重试。操作输出不清除旧消息身份。
- 文件锁支持同机器、同 PID 命名空间；禁止多个主机或容器 PID 命名空间共享这套运行目录。开发/生产数据必须隔离。原子文件写支持进程中断恢复，不声称断电 fsync 保证。
- 进展指纹是最近工具结果和回答内容的启发式比较，不能证明任务取得业务进展。完成仍由验收与 `complete_task` 声明决定，达到无进展阈值需人或上层控制检查后 resume。
- 原生 continuable 子代理必须已停止且最新 settled 通知进入父会话日志后才允许交接；未知 child 模式保守阻止，错误可见。不把原生通知改送另一父会话。
- 无新 UI、价格路由、生产重启、自动 PR 合并或关闭 tracker issue。

## 完整根会话装配

真实模型验收发现，直接 `agents.create` 只创建执行实例，不能代替宿主的 preset 装配。运行器后继与 `open_subtask` 统一使用 `sessionController.create`，显式提供固定后继 ID、原 workspace 和源会话当前 preset。preset 以当前 projection 为准；旧的 preset-less 会话可从公开 `agentPresets.composedPreset` 读取实际装配身份，未硬编码 standard。交接先保存这份创建配置，再调用宿主。

源会话的命名权限 preset 和实际 sandbox/approval 值也持久化并通过公开 setter 继承，保留 custom 及 auto 下的实际策略，不复制单次授权。新根会话装配完成后才设置会话本地阶段模型、接任并投递。

回归使用真实 PresetRegistry、SessionController.create、AgentLoop、文件工具、bash 工具与 AGENTS 加载器：源会话从 minimal 切到非默认 workspace-agent 后，后继和子任务均继承当前 preset，实际执行 read/bash，且权限不回到创建默认。npm rc.2 缺少当前宿主新增的 selectLocalModel，因此该测试仅在模型选择面使用既有本地测试适配器；create/resolve/preset/tool 执行均使用真实宿主实现。
