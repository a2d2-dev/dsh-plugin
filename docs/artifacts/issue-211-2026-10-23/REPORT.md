# Issue #211 任务会话命名验收记录

## 目的与范围

对应 [Issue #211](https://github.com/a2d2-dev/dsh-plugin/issues/211)，验证任务会话具备可读任务标题和可定位编号，任务层级与会话接续顺序可区分，并覆盖创建、绑定、受管接续及自动命名不可用场景。

用户已确认交接后的会话名称属于本次范围，旧版独立 `/handoff take` 登记路径不用修改。最终补丁不改旧运行器和兼容任务服务。编号规则见[任务会话名称](../../session-naming.md)。

代码基线：`635d7316d6451e48531ff3c31a86f72c9234dccb`；交付分支：`fix/211-task-session-titles`，目标集成分支：`fix/planner-payload`。独立工作树实施，没有重启生产或现有开发宿主，没有部署候选插件。

## 步骤与记录

### 1. 重现并修复

- 原始真实 `task.start` 回归：首次模型轮结束后无 `session/title`，断言收到 `undefined`。命名接入后同一路径转绿，并验证标题事件早于首次任务消息。
- 生产80字节回归：原格式将完整仓库及上级仓库放在前面，实际宿主接受的名称丢掉“会话 2”和任务标题。改为紧凑任务身份、上级/当前编号路径，先保留序列再给任务文本分配字节预算；同一真实宿主用例转绿。
- 冷缓存竞争回归：在标题写句柄关闭后注入其他写者，新标题被错误缓存为自己的目标名称，第二次恢复仍留下其他标题。改为持有写租约时观察缓存 revision，第二次恢复可正确修复；不加载 Agent、不产生模型请求。
- 活跃历史回归：十次未变化的命名检查会调用十次 `sessionTitle.get`。按精确 Session 实例和标题事件维护缓存后，十次检查为零次；外部重命名仍可修复。
- 标题刷盘失败后重试检查通过，不追加重复标题事件。

### 2. 最终受影响范围验证

```sh
pnpm exec vitest run tests/work-session-titles.spec.ts tests/task-session-title-writer.spec.ts tests/work-continuation.spec.ts tests/work-execution.spec.ts tests/work-host.spec.ts tests/work-execution-lifecycle.spec.ts tests/work-execution-boundary.spec.ts
pnpm typecheck
```

结果：**7 个文件、63 项测试通过**，宿主与客户端 TypeScript 检查通过。原始记录：[acceptance-tests.txt](acceptance-tests.txt)。

| 原始验收项 | 对应证据 |
| --- | --- |
| 已关联任务的会话具有相关可读标题及定位编号 | 真实创建、已有会话复用、关联冷会话、来源绑定、80字节预算用例通过 |
| 不同任务及连续会话编号含义一致 | 上级/当前编号路径、真实 epoch、两次实际接续、重复来源编号和 Task 前缀碰撞消歧、评审/关联独立序号通过 |
| 创建、绑定、接续入口均覆盖 | 初始标题在任务投递前写入；真实接续后继投递前写入；五类丢回执恢复点保持原任务与序列 |
| 自动命名失败或空名有任务兜底 | 空、抛错、无关 provider 均不参与任务名称生成；不可见标题按任务目标再兜底为“任务会话”；生产80字节设置下通过 |

### 3. 发布包验证

```sh
pnpm verify:pack-exports
```

结果：构建成功，打包后安装到空目录，**14 个公开 Node 导出入口全部可导入**。记录：[pack-check.txt](pack-check.txt)。构建产物不提交到 Git。

### 4. 全量测试及干净基线对照

- 未修改基线 `pnpm test`：1121 项测试中，1105 通过、16 失败；98 个文件中6个失败。记录：[baseline-tests.txt](baseline-tests.txt)。
- 最终分支 `pnpm exec vitest run --maxWorkers=2`：1136 项测试中，1119 通过、17 失败；100 个文件中7个失败。记录：[full-tests.txt](full-tests.txt)。
- 两者相同的16项失败为：7项面板表单测试找不到 `execution-components.tsx`；8项现有客户端导航/历史/完成状态断言失败；1项来源发现计划测试期待 sequence 增长但没有增长。
- 最终全量运行还出现1项旧运行器 fixture 清理 `ENOTEMPTY`，之前运行在同一文件另一条清理测试中也出现过。旧运行器及其测试与基线没有源代码差异；干净基线单独运行 `tests/task-runtime.spec.ts --maxWorkers=2` 时33项通过。记录：[baseline-runtime-tests.txt](baseline-runtime-tests.txt)。此清理时序问题没有在本补丁修复，不能据此宣称全量绿色。
- 受管控制的测试继续区分“已接受 resume 回执”和“实际完成恢复”，等待真实 ready/applied 状态后再断言。关联已有会话的测试验证原日志前缀与配置保持，只有任务标题事件新增。

**结论限制：本次命名与直接影响范围验证通过，构建安装通过；整个仓库全量测试未通过。**

### 5. 既有开发页面核查

使用 `agent-browser` 登录既有开发入口 <http://10.126.126.12:18780/>，核实会话列表仍有旧版无名与泛化名称。截图：[existing-dev-build.png](existing-dev-build.png)。

该实例没有安装本分支候选，所以这张截图只记录现有部署状态，**不作为候选自动绑定/接续命名的浏览器通过证据**；候选自动行为的证据来自上述实际 DSH 服务集成测试。没有以独立网页或接口调用冒充 UI 验收。

浏览器检查中在自有新会话输入 `/goal` 时，编辑控件使发送内容成为 `//goal` 普通消息，意外触发了一轮模型，约24秒结束；随后没有再发送消息，专用浏览器连接已关闭。没有把该轮模型输出当作本任务验收。开发验收会话保留供追溯。

## 交付边界

实现、规则文档及可复查证据随任务分支交付；不合并 PR，不关闭 Issue，也不将尚未部署的 GitHub Project 状态标成“已部署”。实际运行 GUI 升级后的端到端自动命名验证仍需在发布环节执行。
