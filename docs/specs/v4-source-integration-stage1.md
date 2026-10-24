# #141 源码整合第一阶段记录

## 范围与固定对象

本阶段只在 `v4-integrated` 工作树、`feat/v4-integrated` 分支实施源码整合，不部署。开始时目录、分支、干净工作树及起点 `e631c6378f0aac340d0667043e8317c8d54ee7ee` 均由 Git 命令核对。

| 阶段 | 固定实现 | 候选合并提交 |
| --- | --- | --- |
| A 来源 | `2e94db565d37c6fddbec40801c3cc003b6e1bdd2` | `4fdc49d` |
| B 执行（含其前置） | `77162f0d5c206da9e57697df27d76e18861d2e01` | `39be952` |
| D 完成 | `87ef88c75a3d79371ba67a7f83214bd1e7c48ecc` | `d2eb2e5` |
| C 持续委托 | `977bbbb226b76f9f606ca822354f637745e71f89` | `47fe80e` |

后续源码检查点为 `5e20789`（工作台／graph／HTTP UUID）、`3387014`（Repo 持续委托）、`d13ba60779f605861a16054077138ba42d4de623`（观察事实、异步导航与浏览器响应式修复）。最后一条为本报告对应的源码冻结点；报告提交只追加说明。

总候选 PR 的 base 为 `spec/dsh-control-panel-v3`，远端已核对为 `b477025116110f63d3488e0c71e47468ad882844`。没有推送交付目标分支或合并既有 PR。

## 冲突与组合结果

D 的文本冲突位于 WorkApplication 构造 connector 和来源端口类型：保留 B 的完整 TaskRef／ExecutionId／owner／epoch／Session 核对及精确 post-take seal 恢复例外，同时保留 D 的完成终态 guard；catalog／identify／close 端口并存。C 的冲突为应用 imports，保留来源、planning 与 completion。未整文件选择 ours/theirs。

`task.detail`／`task.execution` 返回权威 ExecutionGraph。独立子 Task 按完整引用读取自己的 owner／epoch／Session；原生 Issue 引用另列入口，未读取字段明确未知，已观察关系缺字段时保留并标注最后已知时间。读取原生要求不会导入 Task；canonical 工作经已有项目导航进入，迟到响应不覆盖新选择。

详情接入 ExecutionSessions、ExecutionContinuation 和 CompletionStatus。单一 Issue 标题、唯一顶部自动接续编辑器、原生 header／blank dock／continuation view 保留；完成事实不会被可选 progress 缺失改显示为未开始。补同步只走稳定 completion-sync 和原 transport，失败不会重启模型。完成槽仍严格等待 `task.completion.closeout.status === 'settled'`；maintain body 没有新增 nested settle／whenIdle。

持续委托位于来源工具栏，保留资源／模型／权限授权，保存资源不启用计划。Repo 使用受信 SourcePort 完整分页，发布来源版本与请求代次匹配的完整可见候选；十页／一千 Issue 上限、权限、账号变化、越仓库、分页异常、扫描期间停用均具名拒绝。预览使用 planner 接口并在服务端验证，零执行；显式启用重新扫描才接纳。已有资源／模型／策略／owner／epoch 不变，Block 和重规划保留在途 guard。未公开 dependency 字段明确未知；浏览 view 不改变原规则范围。

## 验证证据

所有测试保持原有 timeout，未 skip、删断言或以吞错命令伪绿。后续测试／typecheck 分开收取退出状态。

| 检查 | 实际结果 |
| --- | --- |
| Repo 公开组合：`corepack pnpm@10.26.2 exec vitest run tests/work-continuous.spec.ts -t 'Repo'` | 7/7，exit 0；含预览零 Session／零发送、显式启用、持续来源扫描及六类拒绝／竞争 |
| 执行图公开组合：同文件 `-t 'keeps native Issue children\|returns the authoritative execution graph'` | 2/2，exit 0；包含独立子工作权威、未读原生入口、不自动多建 Task、部分字段保留最后已知关系 |
| 客户端／独立组件／原生注册：continuous-client、v4-integrated-client、completion-status、execution-components、panel-registration、两项 v4 render | 7 文件 17/17，exit 0；后续三文件工作台／来源／导航定点复验 4/4，exit 0 |
| 最终 source render／响应式夹具生成 | 1/1，exit 0；浏览器展开委托宽度断言红→绿 |
| 原组合 14 文件、80 项 | 原输出 79 pass／1 fail，无超时；失败为新增测试嵌套精确对象只写 nodeId，实际完整引用正确。保留原红并补全预期后，相关 graph 2/2 定点通过，未删除真实字段或断言 |
| 原组合内 completion／completion-source／progress | 7＋2＋7 全部通过；A 来源／目录／导航 11＋3＋2 全部通过；没有重复宽跑这些已绿组 |
| 固定源码上的单次真实本地宿主组合：`corepack pnpm@10.26.2 exec vitest run tests/work-continuous-integration.spec.ts --maxWorkers=1` | 2/2，exit 0；完成后下一项 2418ms，自动接续保留原槽 2164ms。使用真实本地 DSH Session 与测试 model 输出，无真实模型或 GitHub 写入 |
| 最终 `corepack pnpm@10.26.2 typecheck` | exit 0 |
| 最终 `corepack pnpm@10.26.2 build` | exit 0；只生成本工作树的 lib，未复制至运行目录 |
| 包导出校验 | 使用本地 pnpm 10.26.2 包装器运行既有 verifier；安装显式 ignore-scripts；14 个 Node 公开入口全部 verified，exit 0 |
| 客户端 bundle | 全文 require／node:／randomUUID 检索仅命中 `react` 与 `react/jsx-runtime` 两处 require，无 Node 内置模块或 randomUUID |

一次早期验证把测试和 typecheck 串联，后者 exit 0 掩盖前者失败的最终 shell 状态；已在原日志和架构记录中更正。机器默认 pnpm 为 12.11.2，后续全部固定使用 corepack pnpm 10.26.2；pack verifier 的内部调用也经本地包装器固定，不修改全局配置，不批准安装脚本。

父会话提供的实际宿主表核验：a45068d2 的 `packages/client/web/src/seed.ts` 29–30 映射 React／ReactJsxRuntime，`platform.ts` 9 含两项，H 候选 110c444 不修改该表。本会话保持不跨 checkout 读取；本地 bundle 两项 require 与该核验对照一致。实际新 shell 加载仍未验证。

## 浏览器证据与边界

使用 agent-browser 打开 `.local/v4-integrated` 的本地 file 夹具，页面明确标注“合成测试数据／非运行实例／未部署”，保留实际产品组件和样式。桌面 1280×1100，窄屏 390×844。截图为 source-desktop、source-mobile、execution-desktop、execution-mobile、delegation-mobile，均在既有忽略目录，不混入 PR 或包。

真实展开交互发现 delegation 只有 37.359375px；浏览器宽度断言先失败。修复 mobile flex basis 后，同一断言为 width 343／viewport 390／document 375，截图已读，内容正常；来源及执行页此前检查的 body／document／viewport 均为 390。仅页面没有横向溢出不足以证明面板可用。

未验证：真实 18781／18782 页面、新 Host142 包与 jobs receipt／journal 完整组合、真实 LLM 计划／接续、GitHub 业务关闭、原生聊天草稿端到端交互及数据保留升级。未启动服务器、未重启服务、未修改 Host 或运行目录。Repo 超过完整扫描上限会明确拒绝，未知依赖及不可见对象不会冒充已核验。本阶段结果交 fresh review，不能以源码、包或组件截图关闭整体交付。
