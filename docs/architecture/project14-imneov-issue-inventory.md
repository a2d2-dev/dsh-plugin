# Project14 · imneov Issue 全量清单

项目：[项目管理 v3.0](https://github.com/orgs/theriseunion/projects/14)。条目读取始于 2026-10-21T11:57:03.525054+00:00，详情补读完成于 2026-10-21T12:03:36.686466+00:00。分多次 API 调用读取，不是事务快照。

主集合为负责人包含 imneov 的 231 个 Issue；另列其创建但未指派给本人的 16 个 Issue。评论参与者、被提及者不是这份清单的纳入条件。

子项关闭数是 GitHub 原生状态计数，不是工时完成率或本地验收结论。PR 数包含关闭关联及交叉引用，不表示所有 PR 都直接交付该 Issue，也不表示已验收。

## 分配给我 · 开放（60）

| Issue | 标题 | GitHub 状态 / 原因 | Project 状态 | 里程碑 | 原生父项 | 原生子项 | 原生前置依赖 | PR 引用数 |
|---|---|---|---|---|---|---|---|---:|
| [#3342](https://github.com/theriseunion/freeland/issues/3342) | [Task] 镜像仓库关联遗留问题收尾：页面与删除生命周期 | OPEN | 待处理 | 3.0 | — | 0/4 子项关闭 | — | 0 |
| [#3335](https://github.com/theriseunion/freeland/issues/3335) | [Bug] 组件坞在平台组件禁用后仍显示平台组件 | OPEN | 待处理 | 3.0 | — | — | — | 0 |
| [#3287](https://github.com/theriseunion/freeland/issues/3287) | [Bug] 190 Pod 终端 WebSocket 无条件放行任意 Origin | OPEN | 待处理 | 3.0 | — | — | — | 0 |
| [#3270](https://github.com/theriseunion/freeland/issues/3270) | [Bug] 普通登录外壳读取管理目录403导致远程页面误报不存在 | OPEN | 进行中 | 3.0 | [#3342](https://github.com/theriseunion/freeland/issues/3342) | — | — | 0 |
| [#3255](https://github.com/theriseunion/freeland/issues/3255) | [Bug] 只读用户在镜像源列表中仍可点击编辑入口 | OPEN | 待处理 | 3.0 | — | — | — | 0 |
| [#3254](https://github.com/theriseunion/freeland/issues/3254) | [Bug] 镜像源地址缺少格式校验，中文和 278 字符超长地址可保存 | OPEN | 待处理 | 3.0 | — | — | — | 0 |
| [#3253](https://github.com/theriseunion/freeland/issues/3253) | [Bug] 镜像源 provider 可通过 PUT 从 SWR 改为 Harbor，未拒绝不可变字段修改 | OPEN | 待处理 | 3.0 | — | — | — | 0 |
| [#3093](https://github.com/theriseunion/freeland/issues/3093) | [Bug] 扩展中心未提供升级中状态筛选，升级中的插件菜单返回 404 | OPEN | 待处理 | 3.0 | — | — | — | 0 |
| [#3073](https://github.com/theriseunion/freeland/issues/3073) | [Bug] GW3166-001 fluent-bit 归档配置缺失 controller/plugin-server 与独立 S3 链路 | OPEN | 待处理 | 3.0 | — | — | — | 0 |
| [#3034](https://github.com/theriseunion/freeland/issues/3034) | [Swiss] 修复旧集成详情参数契约并核对导航入口 | OPEN | 待处理 | 3.0 | — | — | — | 0 |
| [#3026](https://github.com/theriseunion/freeland/issues/3026) | [registry] 托管写操作迟到响应可能覆盖新项目目录 | OPEN | 待处理 | 3.0 | [#3342](https://github.com/theriseunion/freeland/issues/3342) | — | — | 1 |
| [#3025](https://github.com/theriseunion/freeland/issues/3025) | [registry] 独立外部镜像 Tab，并修复未选集群时的托管配置误提示 | OPEN | 进行中 | 3.0 | [#3342](https://github.com/theriseunion/freeland/issues/3342) | — | — | 7 |
| [#3015](https://github.com/theriseunion/freeland/issues/3015) | [Task] 将 logs 插件 ClickHouse 系统日志 TTL 纳入部署配置 | OPEN | 待处理 | 3.0 | — | — | — | 0 |
| [#3014](https://github.com/theriseunion/freeland/issues/3014) | [Task] 日志内容检索缺可用倒排索引：24h 窗口查询超预算（精确 total 非需求） | OPEN | 待上线 | 3.0 | — | — | — | 1 |
| [#2978](https://github.com/theriseunion/freeland/issues/2978) | [Task] storage 平台菜单补 authKey（依赖 #2645 RoleTemplate-only 迁移） | OPEN | 待处理 | 3.0 | — | — | — | 0 |
| [#2972](https://github.com/theriseunion/freeland/issues/2972) | [Task] 平台侧插件菜单 authKey 清扫：65 个 scope=platform 菜单仍未判权（R5，逐插件子单） | OPEN | 待处理 | 3.0 | — | — | — | 0 |
| [#2949](https://github.com/theriseunion/freeland/issues/2949) | [Task] model-x 回收站恢复改走自有后端 + rise-kit SDK（#2938 删除平台 /restore 的前置） | OPEN | 待处理 | 3.0 | — | — | — | 1 |
| [#2948](https://github.com/theriseunion/freeland/issues/2948) | [Task] 扩展仓 12 个包未纳入类型门（64 条既有诊断）：补脚本并加防绕过守卫 | OPEN | 推迟解决 | 3.0 | — | — | — | 0 |
| [#2910](https://github.com/theriseunion/freeland/issues/2910) | [需求] 新用户自助初始化（注册引导 / 自助创建工作空间） | OPEN | 待处理 | 3.0 | — | — | — | 0 |
| [#2855](https://github.com/theriseunion/freeland/issues/2855) | [需求] Console 租户侧数据存储（公共存储 + 私有存储） | OPEN | 进行中 | 3.0 | — | — | — | 1 |
| [#2830](https://github.com/theriseunion/freeland/issues/2830) | [Bug] 回收站文案承诺「到期后由平台清理」，但平台没有任何清理实现 | OPEN | 推迟解决 | 3.0 | — | — | — | 0 |
| [#2826](https://github.com/theriseunion/freeland/issues/2826) | [Bug] model-x 推理服务删除归档缺少 recyclerecords 的 create 权限 | OPEN | 待处理 | 3.0 | — | — | — | 0 |
| [#2646](https://github.com/theriseunion/freeland/issues/2646) | [Task] 验证 RoleTemplate-only 插件与 Scope 内用户授权（母单 #2633） | OPEN | 进行中 | 3.0 | [#2633](https://github.com/theriseunion/freeland/issues/2633) | — | #2645（关闭）,#2644（关闭）,#2643（关闭）,#2642（关闭）,#2641（关闭）,#2640（关闭）,#2639（关闭）,#2637（关闭） | 3 |
| [#2638](https://github.com/theriseunion/freeland/issues/2638) | [Task] 只读核查 rg-meta 插件旧 IAMRole 引用并出迁移方案（母单 #2633） | OPEN | 进行中 | 3.0 | [#2633](https://github.com/theriseunion/freeland/issues/2633) | — | — | 5 |
| [#2409](https://github.com/theriseunion/freeland/issues/2409) | [Bug] GPUStack 大模型管理（模型上架/推理实例）500：插件后端 Pod 缺失，ReverseProxy 上游连接被拒 | OPEN | 推迟解决 | 3.0 | — | — | — | 0 |
| [#2384](https://github.com/theriseunion/freeland/issues/2384) | [Bug] 【容器管理-工作负载】无状态/有状态/守护进程集/任务/定时任务/容器组详情页持续处于 Pending | OPEN/REOPENED | 已修复 | 3.0 | — | 3/3 子项关闭 | — | 1 |
| [#2355](https://github.com/theriseunion/freeland/issues/2355) | [需求] 五类工作负载历史日志与 CronJob 双层身份完成验收（母单 #2135） | OPEN | 推迟解决 | 3.0 | [#2135](https://github.com/theriseunion/freeland/issues/2135) | — | — | 0 |
| [#2354](https://github.com/theriseunion/freeland/issues/2354) | [需求] Deployment 按 UID 检索滚动及删除后的历史日志（母单 #2135） | OPEN | 推迟解决 | 3.0 | [#2135](https://github.com/theriseunion/freeland/issues/2135) | — | #2353（关闭） | 3 |
| [#2305](https://github.com/theriseunion/freeland/issues/2305) | [Bug] 应用商店 404：app.theriseunion.io API 组未实现，页面数据接口全部 404 | OPEN | 推迟解决 | 3.0 | — | — | — | 0 |
| [#2272](https://github.com/theriseunion/freeland/issues/2272) | [需求] 账号锁定与本地密码生命周期管理（母单） | OPEN | 待处理 | 3.0 | — | 0/2 子项关闭 | — | 0 |
| [#2135](https://github.com/theriseunion/freeland/issues/2135) | [需求] 按工作负载检索历史日志，覆盖滚动更新和资源删除 | OPEN | 推迟解决 | 3.0 | — | 1/3 子项关闭 | #2133（关闭） | 1 |
| [#2114](https://github.com/theriseunion/freeland/issues/2114) | [需求] Global CLI 首版：用户登录与插件校验打包发布 | OPEN/REOPENED | 已修复 | 3.0 | [#2104](https://github.com/theriseunion/freeland/issues/2104) | 4/4 子项关闭 | — | 3 |
| [#2104](https://github.com/theriseunion/freeland/issues/2104) | [需求] Global 插件交付与安装闭环：CLI、CRD、性能与全新部署 | OPEN | 进行中 | 3.0 | — | 1/4 子项关闭 | — | 6 |
| [#2090](https://github.com/theriseunion/freeland/issues/2090) | [安全] storage 目录卷独立评审：apiserver 无应用层认证等 1 高 2 中 4 低 | OPEN | 推迟解决 | 3.0 | — | — | — | 2 |
| [#1981](https://github.com/theriseunion/freeland/issues/1981) | [Bug] ascend-112 成员存储服务使用 host 身份，fy-test 创建存储卷失败 | OPEN | 待上线 | 3.0 | — | — | #2032（关闭） | 1 |
| [#1768](https://github.com/theriseunion/freeland/issues/1768) | [协作] 各插件按平台镜像契约 v1 整改：执行 /plugin-image-contract，开 PR | OPEN | 进行中 | 3.0 | [#1767](https://github.com/theriseunion/freeland/issues/1767) | — | — | 46 |
| [#1767](https://github.com/theriseunion/freeland/issues/1767) | [需求] 平台镜像拉取凭据：全局默认 + 按集群覆盖，经 Karmada 下发，插件安装时注入 | OPEN | 进行中 | 3.0 | — | 0/2 子项关闭 | — | 4 |
| [#1672](https://github.com/theriseunion/freeland/issues/1672) | [需求] 本地登录密码策略：失败次数上限、定期改密、首次改密、禁用缺省口令 | OPEN | 待处理 | 3.0 | [#2272](https://github.com/theriseunion/freeland/issues/2272) | — | — | 0 |
| [#1671](https://github.com/theriseunion/freeland/issues/1671) | [需求] 用户账号支持主动锁定与超时未登录自动锁定 | OPEN | 待处理 | 3.1 | [#2272](https://github.com/theriseunion/freeland/issues/2272) | — | — | 0 |
| [#1613](https://github.com/theriseunion/freeland/issues/1613) | [需求] 应用商店与应用商店管理两个插件：承接工作空间应用管理、应用模板并打通后端 | OPEN | 待处理 | 3.1 | — | — | — | 0 |
| [#1611](https://github.com/theriseunion/freeland/issues/1611) | [需求] 集群管理（kube-infra）新增集群级「应用路由」（Ingress）列表与详情 | OPEN | 待上线 | 3.0 | — | — | — | 1 |
| [#1610](https://github.com/theriseunion/freeland/issues/1610) | [需求] 集群概览：成员集群的资源指标全部为空（显示「成员集群监控暂不支持」） | OPEN | 待处理 | 3.0 | — | — | — | 0 |
| [#1559](https://github.com/theriseunion/freeland/issues/1559) | [需求] 个人 SSH 密钥与个人 API 密钥的归属、存储和项目维度（讨论） | OPEN | 推迟解决 | 3.0 | — | — | — | 0 |
| [#1537](https://github.com/theriseunion/freeland/issues/1537) | [Task] 扩展中心插件名称与描述的英文化：Plugin CR / 注册表缺英文字段，需先定方案（母单 #1455） | OPEN | 进行中 | 3.0 | [#1455](https://github.com/theriseunion/freeland/issues/1455) | — | — | 0 |
| [#1474](https://github.com/theriseunion/freeland/issues/1474) | [需求] 插件页面集群列表按“用户授权 ∩ 插件已安装”过滤 | OPEN | 待处理 | 3.0 | — | — | — | 1 |
| [#1452](https://github.com/theriseunion/freeland/issues/1452) | [Feature] 为 KubeEdge/OpenYurt 提供集群节点 Join Command API | OPEN | 待处理 | 3.1 | — | — | — | 1 |
| [#1450](https://github.com/theriseunion/freeland/issues/1450) | [Feature] 通过 PluginClusterInstall 安全交付 OpenYurt 运行时 | OPEN | 待处理 | 3.1 | — | — | — | 1 |
| [#1395](https://github.com/theriseunion/freeland/issues/1395) | [Task] 插件安装链路性能优化：安装/values 请求不再逐插件调用 K8s，并分段测量端到端耗时 | OPEN | 进行中 | 3.0 | [#2104](https://github.com/theriseunion/freeland/issues/2104) | — | — | 8 |
| [#1394](https://github.com/theriseunion/freeland/issues/1394) | [Bug] registry 公共镜像撤销永远停在 pending：删除 PropagationPolicy 后 Karmada 未撤回 member 副本 | OPEN | 待上线 | 3.0 | — | — | — | 1 |
| [#1392](https://github.com/theriseunion/freeland/issues/1392) | [需求] 平台为每个插件自动提供 Karmada 访问身份（第一步：统一，高权限） | OPEN | 待上线 | 3.0 | — | — | — | 10 |
| [#1364](https://github.com/theriseunion/freeland/issues/1364) | [需求] 镜像项目存储额度：独立 quota CRD + EDGE APISERVER 统一处理（Harbor per-project quota 执行端） | OPEN | 推迟解决 | 3.1 | — | — | — | 0 |
| [#1352](https://github.com/theriseunion/freeland/issues/1352) | [Task] 收紧 member 上为 Karmada 集群代理临时放开的 RBAC 权限 | OPEN | 推迟解决 | 3.1 | — | — | — | 0 |
| [#1347](https://github.com/theriseunion/freeland/issues/1347) | [Bug] registry 公共镜像删除接口返回 404：写请求路由到 rg-meta，读请求走 Karmada plane | OPEN | 待上线 | 3.0 | — | — | — | 0 |
| [#1311](https://github.com/theriseunion/freeland/issues/1311) | [需求] registry 按 CAMP 模式重构：独立镜像凭证、镜像源只存端点、公共镜像浏览远端选仓库 | OPEN | 待上线 | 3.0 | — | — | #1346（关闭） | 16 |
| [#854](https://github.com/theriseunion/freeland/issues/854) | [global-config] 005 二期：private 读 + 调用方身份认证（网关 strip + re-inject X-Plugin-Identity） | OPEN | 推迟解决 | 3.0 | — | — | — | 0 |
| [#853](https://github.com/theriseunion/freeland/issues/853) | [global-config] GC-C：schema Hide 生命周期一致性（handleUninstall 死代码 / disabled 是否 Hide） | OPEN | 待上线 | 3.0 | — | — | — | 1 |
| [#809](https://github.com/theriseunion/freeland/issues/809) | [需求] Rise Global website 开发文档与架构白皮书同步当前代码 | OPEN | 待上线 | 3.0 | — | — | — | 3 |
| [#564](https://github.com/theriseunion/freeland/issues/564) | [需求] 新的部署方式 - 前端 | OPEN | 进行中 | 3.0 | — | — | #563（开放） | 0 |
| [#563](https://github.com/theriseunion/freeland/issues/563) | [需求] 新的部署方式 - 服务端 | OPEN | 待处理 | 3.0 | [#2104](https://github.com/theriseunion/freeland/issues/2104) | — | — | 2 |
| [#314](https://github.com/theriseunion/freeland/issues/314) | [需求] 镜像源端到端支持 Harbor 与华为 SWR —— 现在整条链路只认 harbor | OPEN | 待上线 | 3.0 | — | — | — | 0 |

## 分配给我 · 已关闭（171）

| Issue | 标题 | GitHub 状态 / 原因 | Project 状态 | 里程碑 | 原生父项 | 原生子项 | 原生前置依赖 | PR 引用数 |
|---|---|---|---|---|---|---|---|---:|
| [#3249](https://github.com/theriseunion/freeland/issues/3249) | [Bug] 190 两个成员的 Console/apiserver 未跟随宿主发布，存在插件兼容性故障 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 3 |
| [#3070](https://github.com/theriseunion/freeland/issues/3070) | [Bug] 托管仓库可选 Global 凭据，保存却因只查本地同名 Secret 失败 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2995](https://github.com/theriseunion/freeland/issues/2995) | — | — | 2 |
| [#3037](https://github.com/theriseunion/freeland/issues/3037) | [Bug] 托管仓库配置页缺少集群选择，无法管理成员集群配置 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2995](https://github.com/theriseunion/freeland/issues/2995) | — | — | 1 |
| [#3033](https://github.com/theriseunion/freeland/issues/3033) | [Task] 网关向插件传递可信 OAPI 请求上下文（母单 #2995） | CLOSED/COMPLETED | 已修复 | 3.0 | [#2995](https://github.com/theriseunion/freeland/issues/2995) | — | — | 4 |
| [#3031](https://github.com/theriseunion/freeland/issues/3031) | [Task] Registry 旧 API 退役与两轴路径收口（母单 #2995） | CLOSED/COMPLETED | 已修复 | 3.0 | [#2995](https://github.com/theriseunion/freeland/issues/2995) | — | #3033（关闭）,#3030（关闭）,#3029（关闭）,#3028（关闭）,#3027（关闭） | 4 |
| [#3030](https://github.com/theriseunion/freeland/issues/3030) | [Task] Registry 页面与扩展插件调用方切换新 API（母单 #2995） | CLOSED/COMPLETED | 已修复 | 3.0 | [#2995](https://github.com/theriseunion/freeland/issues/2995) | — | #3029（关闭）,#3028（关闭） | 1 |
| [#3029](https://github.com/theriseunion/freeland/issues/3029) | [Task] Framework ImageSelect 与 Console registry 调用切换新 API（母单 #2995） | CLOSED/COMPLETED | 已修复 | 3.0 | [#2995](https://github.com/theriseunion/freeland/issues/2995) | — | — | 1 |
| [#3028](https://github.com/theriseunion/freeland/issues/3028) | [Task] Registry canonical 路由与真实子资源 RBAC（母单 #2995） | CLOSED/COMPLETED | 已修复 | 3.0 | [#2995](https://github.com/theriseunion/freeland/issues/2995) | — | #3033（关闭） | 4 |
| [#3027](https://github.com/theriseunion/freeland/issues/3027) | [Task] 业务 OAPI 显式集群资源路径的两跳授权保持一致（母单 #2995） | CLOSED/COMPLETED | 已修复 | 3.0 | [#2995](https://github.com/theriseunion/freeland/issues/2995) | — | #3028（关闭） | 5 |
| [#3019](https://github.com/theriseunion/freeland/issues/3019) | [Bug] 项目事件页请求走错入口，导致工作空间用户403 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 2 |
| [#3011](https://github.com/theriseunion/freeland/issues/3011) | [Console] 停止 resources+workspaces 改写并切换两轴路径 + 阶段 2 拒绝旧形式（#2987 1b） | CLOSED/COMPLETED | 已修复 | 3.0 | [#2987](https://github.com/theriseunion/freeland/issues/2987) | — | — | 6 |
| [#3010](https://github.com/theriseunion/freeland/issues/3010) | [框架][requestinfo] 应用侧两轴 scope 解析通用化 + 插件 RoleTemplate 迁移（#2987 1a，先合） | CLOSED/COMPLETED | 已修复 | 3.0 | [#2987](https://github.com/theriseunion/freeland/issues/2987) | — | — | 6 |
| [#2995](https://github.com/theriseunion/freeland/issues/2995) | [registry][API 规范] 镜像空间 API 按 #2987 两轴规范重构（应用侧 workspaces/projects + 资源侧 clusters/namespaces） | CLOSED/COMPLETED | 已修复 | 3.0 | [#2987](https://github.com/theriseunion/freeland/issues/2987) | 8/8 子项关闭 | #3070（关闭）,#3010（关闭） | 14 |
| [#2987](https://github.com/theriseunion/freeland/issues/2987) | [框架][API 规范] 删除 requestinfo 的 API group 特判：统一资源侧(/clusters+namespaces)与应用侧(workspaces+projects)两类 API 路径 | CLOSED/COMPLETED | 已修复 | 3.0 | — | 3/3 子项关闭 | — | 6 |
| [#2985](https://github.com/theriseunion/freeland/issues/2985) | [Bug] 管理面操作日志 OR 并集命中普通 apiserver 日志，total 虚高且真实审计行被稀释 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 4 |
| [#2982](https://github.com/theriseunion/freeland/issues/2982) | [Task] resource-center/ai-infra 占位菜单改为 hidden（母单 #2972） | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 3 |
| [#2981](https://github.com/theriseunion/freeland/issues/2981) | [Task] platform-config 平台菜单补 admin-only authKey（母单 #2972） | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#2980](https://github.com/theriseunion/freeland/issues/2980) | [Task] design-system demo 菜单改为 hidden（母单 #2972） | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#2977](https://github.com/theriseunion/freeland/issues/2977) | [Task] storage 与 oauth-app 平台菜单补 authKey（母单 #2972） | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 2 |
| [#2976](https://github.com/theriseunion/freeland/issues/2976) | [Bug] TestHostedCatalogEndToEnd 在 CI 间歇失败：刷新意图未被处理模块再次消费 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 3 |
| [#2975](https://github.com/theriseunion/freeland/issues/2975) | [Task] recycle-rule 平台菜单补 authKey（母单 #2972） | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#2974](https://github.com/theriseunion/freeland/issues/2974) | [Task] billing 平台菜单补 authKey（母单 #2972） | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#2973](https://github.com/theriseunion/freeland/issues/2973) | [Task] metering 平台菜单补 authKey（母单 #2972） | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#2971](https://github.com/theriseunion/freeland/issues/2971) | [Task] model-x 其余 boss 页与跨插件平台菜单权限补齐（R5 authKey / benchmark platform viewer / cluster-scoped 读迁聚合） | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 2 |
| [#2970](https://github.com/theriseunion/freeland/issues/2970) | [Bug] model-x 推理实例 boss 列表直连 Clusterpedia，非 admin 平台角色 403（应迁 aggregate 平台视角） | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 2 |
| [#2969](https://github.com/theriseunion/freeland/issues/2969) | [Task] host Console 对 member 项目的插件 OAPI 未按项目集群路由，回收站恢复落到 host（#2825 第 15 条遗留） | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#2968](https://github.com/theriseunion/freeland/issues/2968) | [Bug] 成员集群缺 recyclerecords.task.rise.io CRD，novanotebook 回收站在 member 不可用（#2825 第 15 条） | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 0 |
| [#2967](https://github.com/theriseunion/freeland/issues/2967) | [Task] 算力容器回收站端到端验收（dev）：删除→回收站→恢复（已关机）→彻底删除 + 非管理员权限 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 0 |
| [#2965](https://github.com/theriseunion/freeland/issues/2965) | [Task] 190/ascend-112 日志 ClickHouse 资源与容量风险：host 1 核、member 节点磁盘 100% | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 0 |
| [#2955](https://github.com/theriseunion/freeland/issues/2955) | [Task] model-x 推理服务 boss 档补 platform viewer 模板与 authKey，取消 variant 权限门 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 3 |
| [#2954](https://github.com/theriseunion/freeland/issues/2954) | [Task] rg-meta bootstrap 未固化 karmada-apiserver Recreate/aggregated 等待，重启后 OpenAPI v2 重复 path 阻塞 ArgoCD | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 2 |
| [#2953](https://github.com/theriseunion/freeland/issues/2953) | [Bug] logs 未来时间校验的 400 报文把字段名写成不存在的 time_validation | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#2952](https://github.com/theriseunion/freeland/issues/2952) | [Bug] 操作日志（管理面）混入登录事件，行显示 login undefined、状态与模块为空 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#2947](https://github.com/theriseunion/freeland/issues/2947) | [需求] 用户信息新增手机号字段 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#2946](https://github.com/theriseunion/freeland/issues/2946) | [需求] 审计与登录记录需能区分同名重建前后的两个主体（母单 #29） | CLOSED/COMPLETED | 已修复 | 3.0 | [#29](https://github.com/theriseunion/freeland/issues/29) | — | — | 8 |
| [#2945](https://github.com/theriseunion/freeland/issues/2945) | [需求] 同名用户重建后不得继承已删除用户的授权（母单 #29） | CLOSED/COMPLETED | 已修复 | 3.0 | [#29](https://github.com/theriseunion/freeland/issues/29) | — | — | 1 |
| [#2944](https://github.com/theriseunion/freeland/issues/2944) | [Bug] novanotebook 回收站模板授权的 API 组与插件路由不一致，非管理员读回收站 403（母单 #2633） | CLOSED/COMPLETED | 已修复 | 3.0 | [#2633](https://github.com/theriseunion/freeland/issues/2633) | — | — | 1 |
| [#2938](https://github.com/theriseunion/freeland/issues/2938) | [Task] 删除平台 /restore 端点（#2825 第 6 项）：直接终态，不做兼容/fallback | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 0 |
| [#2937](https://github.com/theriseunion/freeland/issues/2937) | [Bug] 租户首页与 ai-base 项目镜像页调用已删除的 project-names 端点 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#2936](https://github.com/theriseunion/freeland/issues/2936) | [Task] #2851 实现 rise-kit 回收站 Go SDK 与单测示例 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2851](https://github.com/theriseunion/freeland/issues/2851) | — | — | 1 |
| [#2935](https://github.com/theriseunion/freeland/issues/2935) | [Bug] 日志检索默认12小时查询触发ClickHouse 30秒超时 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#2934](https://github.com/theriseunion/freeland/issues/2934) | [Task] 托管仓库配置表单校验与后端/K8s 口径对齐 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2854](https://github.com/theriseunion/freeland/issues/2854) | — | #2920（关闭） | 0 |
| [#2933](https://github.com/theriseunion/freeland/issues/2933) | [Task] 真实环境闭环验收 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2854](https://github.com/theriseunion/freeland/issues/2854) | — | #2929（关闭）,#2928（关闭）,#2925（关闭）,#2924（关闭）,#2923（关闭） | 1 |
| [#2932](https://github.com/theriseunion/freeland/issues/2932) | [Task] 冻结路径回归保护 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2854](https://github.com/theriseunion/freeland/issues/2854) | — | — | 1 |
| [#2931](https://github.com/theriseunion/freeland/issues/2931) | [Task] 目录对账与外部变更一致性 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2854](https://github.com/theriseunion/freeland/issues/2854) | — | #2925（关闭）,#2924（关闭） | 0 |
| [#2930](https://github.com/theriseunion/freeland/issues/2930) | [Task] 声明式处理恢复：Controller 重建、Harbor 长期不可用与重放安全 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2854](https://github.com/theriseunion/freeland/issues/2854) | — | #2929（关闭）,#2922（关闭） | 0 |
| [#2929](https://github.com/theriseunion/freeland/issues/2929) | [Task] 声明式项目删除与托管清理 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2854](https://github.com/theriseunion/freeland/issues/2854) | — | #2922（关闭） | 2 |
| [#2928](https://github.com/theriseunion/freeland/issues/2928) | [Task] 三类实例创建入口预选与既有消费凭据 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2854](https://github.com/theriseunion/freeland/issues/2854) | — | #2927（关闭）,#2924（关闭） | 0 |
| [#2927](https://github.com/theriseunion/freeland/issues/2927) | [Task] 公共镜像页签：筛选、搜索、卡片/列表与详情 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2854](https://github.com/theriseunion/freeland/issues/2854) | — | #2921（关闭） | 0 |
| [#2926](https://github.com/theriseunion/freeland/issues/2926) | [Task] 私有侧来源区分与既有外部镜像登记接入 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2854](https://github.com/theriseunion/freeland/issues/2854) | — | #2921（关闭） | 0 |
| [#2925](https://github.com/theriseunion/freeland/issues/2925) | [Task] 托管内容操作：加 tag、删 tag、删镜像与真实容量 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2854](https://github.com/theriseunion/freeland/issues/2854) | — | #2924（关闭） | 1 |
| [#2924](https://github.com/theriseunion/freeland/issues/2924) | [Task] 托管目录：push 后刷新即可选 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2854](https://github.com/theriseunion/freeland/issues/2854) | — | #2922（关闭） | 1 |
| [#2923](https://github.com/theriseunion/freeland/issues/2923) | [Task] 空间信息区与项目空间凭据 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2854](https://github.com/theriseunion/freeland/issues/2854) | — | #2922（关闭） | 1 |
| [#2922](https://github.com/theriseunion/freeland/issues/2922) | [Task] 项目托管空间「立即初始化」端到端 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2854](https://github.com/theriseunion/freeland/issues/2854) | — | #2921（关闭） | 1 |
| [#2921](https://github.com/theriseunion/freeland/issues/2921) | [Task] 租户镜像仓库入口与私有页骨架 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2854](https://github.com/theriseunion/freeland/issues/2854) | — | #2920（关闭） | 1 |
| [#2920](https://github.com/theriseunion/freeland/issues/2920) | [Task] PrivateRegistry：集群托管仓库配置面 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2854](https://github.com/theriseunion/freeland/issues/2854) | — | — | 1 |
| [#2918](https://github.com/theriseunion/freeland/issues/2918) | [Task] Go module path 从 riseaicloud 迁移到 theriseunion（SDK 引用前置） | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 2 |
| [#2863](https://github.com/theriseunion/freeland/issues/2863) | [Bug] 日志检索成员集群(hwglobal-member)日志数据面接口超时，检索不可用 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 4 |
| [#2862](https://github.com/theriseunion/freeland/issues/2862) | [Bug] 日志检索主集群(host)数据集配置未知，检索不可用（logs 插件未配置 ilogtail.dataset） | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#2856](https://github.com/theriseunion/freeland/issues/2856) | [Bug] 扩展仓全量 tsc --noEmit 在 main 上失败（89 条既有诊断）：类型门不可用 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 0 |
| [#2854](https://github.com/theriseunion/freeland/issues/2854) | [需求] Console 租户侧镜像仓库（公共镜像 + 私有镜像） | CLOSED/COMPLETED | 已修复 | 3.0 | — | 15/15 子项关闭 | — | 3 |
| [#2851](https://github.com/theriseunion/freeland/issues/2851) | [Task] 回收站 Go 操作库（SDK）实现 —— #2825 决策实施 | CLOSED/COMPLETED | 已修复 | 3.0 | — | 1/1 子项关闭 | — | 1 |
| [#2828](https://github.com/theriseunion/freeland/issues/2828) | [Task] 回收站遗留组件去向确认 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 0 |
| [#2827](https://github.com/theriseunion/freeland/issues/2827) | [Task] 算力容器回收站改正确：正确使用 SDK + 去除无关代码 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 2 |
| [#2825](https://github.com/theriseunion/freeland/issues/2825) | [需求分析] 明确推理实例回收站的插件归属与统一回收站边界 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 3 |
| [#2823](https://github.com/theriseunion/freeland/issues/2823) | [需求] 回收站 需要单独拆出来 | CLOSED/NOT_PLANNED | 已修复 | 3.0 | — | — | — | 0 |
| [#2707](https://github.com/theriseunion/freeland/issues/2707) | fix: report unsupported console build rename environment | CLOSED/COMPLETED | 已修复 | 3.0 | [#2701](https://github.com/theriseunion/freeland/issues/2701) | — | — | 0 |
| [#2706](https://github.com/theriseunion/freeland/issues/2706) | fix: diagnose and support worktree pre-push rename constraints | CLOSED/COMPLETED | 已修复 | 3.0 | [#2701](https://github.com/theriseunion/freeland/issues/2701) | — | — | 0 |
| [#2705](https://github.com/theriseunion/freeland/issues/2705) | [Task] #2704 cli-only 文档 PR 执行切片 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2704](https://github.com/theriseunion/freeland/issues/2704) | — | — | 1 |
| [#2704](https://github.com/theriseunion/freeland/issues/2704) | [Task] #2694 合入后 cli-only PR 真实 CI 验收 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2694](https://github.com/theriseunion/freeland/issues/2694) | 1/1 子项关闭 | #2703（关闭） | 2 |
| [#2703](https://github.com/theriseunion/freeland/issues/2703) | [Task] #2694 新增轻量 CLI CI workflow 与门禁说明 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2694](https://github.com/theriseunion/freeland/issues/2694) | — | — | 1 |
| [#2702](https://github.com/theriseunion/freeland/issues/2702) | [Task] #2651 CLI 大目录确认 RED/GREEN 与有界读取修复 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2651](https://github.com/theriseunion/freeland/issues/2651) | — | — | 0 |
| [#2701](https://github.com/theriseunion/freeland/issues/2701) | [Bug] pre-push 钩子在工作树内 console 构建失败（EXDEV 跨设备 rename），与改动无关地挡住推送 | CLOSED/NOT_PLANNED | 不解决 | 3.0 | — | 2/2 子项关闭 | — | 4 |
| [#2694](https://github.com/theriseunion/freeland/issues/2694) | [Task] Global CLI 无 CI 覆盖：cli/** 变更不触发任何 workflow | CLOSED/COMPLETED | 已修复 | 3.0 | — | 2/2 子项关闭 | — | 4 |
| [#2652](https://github.com/theriseunion/freeland/issues/2652) | [Bug] Global CLI 默认端口拼写导致同一服务器凭据失配 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2114](https://github.com/theriseunion/freeland/issues/2114) | — | — | 1 |
| [#2651](https://github.com/theriseunion/freeland/issues/2651) | [Bug] Global CLI 大目录上架确认受固定响应大小限制 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2114](https://github.com/theriseunion/freeland/issues/2114) | 1/1 子项关闭 | — | 1 |
| [#2650](https://github.com/theriseunion/freeland/issues/2650) | [Bug] Global CLI 异常退出后凭据锁无法恢复 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2114](https://github.com/theriseunion/freeland/issues/2114) | — | — | 1 |
| [#2649](https://github.com/theriseunion/freeland/issues/2649) | [Bug] Global CLI 打包失败后保留同版本残包 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2114](https://github.com/theriseunion/freeland/issues/2114) | — | — | 3 |
| [#2645](https://github.com/theriseunion/freeland/issues/2645) | [Task] storage 插件只交付 RoleTemplate，移除 3 个 IAMRole（母单 #2633） | CLOSED/COMPLETED | 已修复 | 3.0 | [#2633](https://github.com/theriseunion/freeland/issues/2633) | — | #2637（关闭） | 2 |
| [#2644](https://github.com/theriseunion/freeland/issues/2644) | [Task] registry 插件只交付 RoleTemplate，移除 3 个 IAMRole（母单 #2633） | CLOSED/COMPLETED | 已修复 | 3.0 | [#2633](https://github.com/theriseunion/freeland/issues/2633) | — | #2637（关闭） | 1 |
| [#2643](https://github.com/theriseunion/freeland/issues/2643) | [Task] recycle-rule 插件只交付 RoleTemplate，移除 2 个 IAMRole（母单 #2633） | CLOSED/COMPLETED | 已修复 | 3.0 | [#2633](https://github.com/theriseunion/freeland/issues/2633) | — | #2637（关闭） | 2 |
| [#2642](https://github.com/theriseunion/freeland/issues/2642) | [Task] novanotebook 插件只交付 RoleTemplate，移除 2 个 IAMRole（母单 #2633） | CLOSED/COMPLETED | 已修复 | 3.0 | [#2633](https://github.com/theriseunion/freeland/issues/2633) | — | #2637（关闭） | 2 |
| [#2641](https://github.com/theriseunion/freeland/issues/2641) | [Task] metering 插件只交付 RoleTemplate，移除 2 个 IAMRole（母单 #2633） | CLOSED/COMPLETED | 已修复 | 3.0 | [#2633](https://github.com/theriseunion/freeland/issues/2633) | — | #2637（关闭） | 1 |
| [#2640](https://github.com/theriseunion/freeland/issues/2640) | [Task] export 插件只交付 RoleTemplate，移除 1 个 IAMRole（母单 #2633） | CLOSED/COMPLETED | 已修复 | 3.0 | [#2633](https://github.com/theriseunion/freeland/issues/2633) | — | #2637（关闭） | 1 |
| [#2639](https://github.com/theriseunion/freeland/issues/2639) | [Task] billing 插件只交付 RoleTemplate，移除 4 个 IAMRole（母单 #2633） | CLOSED/COMPLETED | 已修复 | 3.0 | [#2633](https://github.com/theriseunion/freeland/issues/2633) | — | #2637（关闭） | 1 |
| [#2637](https://github.com/theriseunion/freeland/issues/2637) | [Task] 拒绝插件 IAMRole/Category 并保护旧角色（母单 #2633） | CLOSED/COMPLETED | 已修复 | 3.0 | [#2633](https://github.com/theriseunion/freeland/issues/2633) | — | — | 8 |
| [#2632](https://github.com/theriseunion/freeland/issues/2632) | [Task] #2601 rg-meta 低权 Cluster 响应与控制台验收 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2601](https://github.com/theriseunion/freeland/issues/2601) | — | — | 0 |
| [#2630](https://github.com/theriseunion/freeland/issues/2630) | [Task] #2601 Cluster 响应脱敏与兼容性回归 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2601](https://github.com/theriseunion/freeland/issues/2601) | — | — | 1 |
| [#2603](https://github.com/theriseunion/freeland/issues/2603) | [Task] 2384 合并后 rg-meta 部署与六类详情验收 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2384](https://github.com/theriseunion/freeland/issues/2384) | — | — | 0 |
| [#2601](https://github.com/theriseunion/freeland/issues/2601) | [Bug] tenant 集群查询缺少 connection 凭据字段脱敏 | CLOSED/COMPLETED | 已修复 | 3.0 | — | 2/2 子项关闭 | — | 1 |
| [#2597](https://github.com/theriseunion/freeland/issues/2597) | [Task] 2384 rg-meta 存在工作负载详情验收 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2384](https://github.com/theriseunion/freeland/issues/2384) | — | — | 1 |
| [#2596](https://github.com/theriseunion/freeland/issues/2596) | [Task] 2384 工作负载详情 i18n 请求循环永久回归 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2384](https://github.com/theriseunion/freeland/issues/2384) | — | — | 1 |
| [#2587](https://github.com/theriseunion/freeland/issues/2587) | [Bug] rg-meta config-qzl registry 读面错误，集群作用域被 scope Cluster NoMatch 阻断 | CLOSED/NOT_PLANNED | 不解决 | 3.0 | [#2329](https://github.com/theriseunion/freeland/issues/2329) | — | — | 0 |
| [#2549](https://github.com/theriseunion/freeland/issues/2549) | [Task] 补齐插件禁用正向生命周期 rg-meta 现场验收（母单 #1994） | CLOSED/NOT_PLANNED | 不解决 | 3.0 | [#1994](https://github.com/theriseunion/freeland/issues/1994) | — | — | 0 |
| [#2375](https://github.com/theriseunion/freeland/issues/2375) | [Bug] 操作审计页面默认时间窗加载失败 400（time parameter error: time_validation='' - future times not allowed） | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 0 |
| [#2353](https://github.com/theriseunion/freeland/issues/2353) | [需求] 可靠 Pod 与容器身份从采集贯通公开日志明细（母单 #2135） | CLOSED/COMPLETED | 已修复 | 3.0 | [#2135](https://github.com/theriseunion/freeland/issues/2135) | — | — | 2 |
| [#2329](https://github.com/theriseunion/freeland/issues/2329) | [Bug] 参数管理作用域切换为 host 集群报 502（host 无 kubeconfig） | CLOSED/NOT_PLANNED | 不解决 | 3.0 | — | 1/1 子项关闭 | #2587（关闭） | 4 |
| [#2271](https://github.com/theriseunion/freeland/issues/2271) | [需求] 扩展中心组件浏览、配置安装与升级交付（母单） | CLOSED/COMPLETED | 已修复 | 3.0 | — | 5/5 子项关闭 | — | 2 |
| [#2134](https://github.com/theriseunion/freeland/issues/2134) | [需求] 日志概览展示窗口内产生过日志的逻辑容器数量 | CLOSED/COMPLETED | 已部署 | 3.0 | [#2127](https://github.com/theriseunion/freeland/issues/2127) | — | #2129（关闭）,#2132（关闭） | 4 |
| [#2133](https://github.com/theriseunion/freeland/issues/2133) | [需求] 日志按关键词、项目、容器组和容器组合检索并支持历史资源 | CLOSED/COMPLETED | 已部署 | 3.0 | [#2127](https://github.com/theriseunion/freeland/issues/2127) | — | #2131（关闭）,#2130（关闭）,#2132（关闭） | 1 |
| [#2132](https://github.com/theriseunion/freeland/issues/2132) | [需求] 日志检索按集群展示最近 12 小时总量与 30 分钟趋势 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2127](https://github.com/theriseunion/freeland/issues/2127) | — | #2128（关闭） | 2 |
| [#2131](https://github.com/theriseunion/freeland/issues/2131) | [Bug] 容器日志聚合将高级关键词表达式当普通子串，匹配语义与明细不同 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2127](https://github.com/theriseunion/freeland/issues/2127) | — | — | 3 |
| [#2130](https://github.com/theriseunion/freeland/issues/2130) | [Bug] 容器日志聚合忽略 container_name，统计与明细结果不一致 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2127](https://github.com/theriseunion/freeland/issues/2127) | — | — | 3 |
| [#2129](https://github.com/theriseunion/freeland/issues/2129) | [Bug] 容器日志 distinct_count 聚合引用不存在的 severity 字段并返回 500 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2127](https://github.com/theriseunion/freeland/issues/2127) | — | — | 3 |
| [#2128](https://github.com/theriseunion/freeland/issues/2128) | [Bug] 容器日志小时聚合默认请求返回 500，排序字段 time_bucket 不存在 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2127](https://github.com/theriseunion/freeland/issues/2127) | — | — | 5 |
| [#2127](https://github.com/theriseunion/freeland/issues/2127) | [需求] 按集群组织基础日志检索（首版） | CLOSED/COMPLETED | 已修复 | 3.0 | — | 7/7 子项关闭 | — | 1 |
| [#2101](https://github.com/theriseunion/freeland/issues/2101) | [Bug] rg-meta扩展中心导航回登录页，但有效会话userinfo仍返回200 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 0 |
| [#2100](https://github.com/theriseunion/freeland/issues/2100) | [Bug] 发布回填在 compare API 失败时放行旧发布并回退已部署版本（母单 #2092） | CLOSED/NOT_PLANNED | 推迟解决 | 3.0 | [#2092](https://github.com/theriseunion/freeland/issues/2092) | — | — | 1 |
| [#2094](https://github.com/theriseunion/freeland/issues/2094) | [Bug] 目录升级在镜像契约配置未就绪时仍成功写入目标版本（母单 #2092） | CLOSED/COMPLETED | 已修复 | 3.0 | [#2092](https://github.com/theriseunion/freeland/issues/2092) | — | — | 1 |
| [#2093](https://github.com/theriseunion/freeland/issues/2093) | [Bug] 插件发布验收脚本在旧或缺失 UMD 时仍返回成功（#2092 子单） | CLOSED/COMPLETED | 已修复 | 3.0 | [#2092](https://github.com/theriseunion/freeland/issues/2092) | — | — | 1 |
| [#2092](https://github.com/theriseunion/freeland/issues/2092) | [Task] 整改 Rise Global 构建、发布与部署验收链路（#1544 复盘） | CLOSED/COMPLETED | 已修复 | 3.0 | — | 3/3 子项关闭 | — | 2 |
| [#2091](https://github.com/theriseunion/freeland/issues/2091) | [Bug] ascend-112 NFS 目录删除在 renameat2 隔离阶段返回 EINVAL | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#2032](https://github.com/theriseunion/freeland/issues/2032) | [Bug] ascend-112 缺少默认 StorageProfile，fy-test 新建存储卷返回 400 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 0 |
| [#2025](https://github.com/theriseunion/freeland/issues/2025) | [Bug] 扩展中心「集群部署」不展示主集群 host，新增部署却仍可选 host | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 2 |
| [#1994](https://github.com/theriseunion/freeland/issues/1994) | [Bug] 插件禁用缺少反向依赖检查，且会删除 IAM 配置 | CLOSED/NOT_PLANNED | 不解决 | 3.0 | — | 1/1 子项关闭 | — | 2 |
| [#1977](https://github.com/theriseunion/freeland/issues/1977) | [Bug] 平台缺少统一的插件 CRD 升级交付与漂移校验机制 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#1961](https://github.com/theriseunion/freeland/issues/1961) | 190 member 项目无法选择平台镜像：registry 未部署且旧镜像未进入广播 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 2 |
| [#1872](https://github.com/theriseunion/freeland/issues/1872) | [Bug] observe 新增 CRD 放在 chart 的 crds/ 目录，从老版本升级时 CRD 不会安装，插件 Failed | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | #1977（关闭） | 0 |
| [#1695](https://github.com/theriseunion/freeland/issues/1695) | [Bug] rg-meta（meta 与 member 分离形态）上 observe 后端就绪探针一直 503：本地无 Workspace CRD，未使用平台注入的 Global 平面凭证 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#1677](https://github.com/theriseunion/freeland/issues/1677) | [Bug] member 项目的插件 /oapis 请求转发到 member 时丢失身份，按 anonymous 返回 403 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 0 |
| [#1670](https://github.com/theriseunion/freeland/issues/1670) | [需求] 扩展中心恢复界面升级入口，升级时同步更新组件 CRD | CLOSED/COMPLETED | 已修复 | 3.0 | [#2271](https://github.com/theriseunion/freeland/issues/2271) | — | — | 1 |
| [#1669](https://github.com/theriseunion/freeland/issues/1669) | [需求] 扩展组件安装向导：按 values.schema 呈现配置表单并校验 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2271](https://github.com/theriseunion/freeland/issues/2271) | — | — | 1 |
| [#1668](https://github.com/theriseunion/freeland/issues/1668) | [需求] 扩展组件详情页展示截图、README、License、依赖与更新日志 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2271](https://github.com/theriseunion/freeland/issues/2271) | — | — | 2 |
| [#1667](https://github.com/theriseunion/freeland/issues/1667) | [需求] 扩展中心列表：增加按类型、授权状态筛选 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2271](https://github.com/theriseunion/freeland/issues/2271) | — | — | 1 |
| [#1666](https://github.com/theriseunion/freeland/issues/1666) | [需求] 扩展中心列表：分类按组件元数据分组，新发布组件突出显示 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2271](https://github.com/theriseunion/freeland/issues/2271) | — | — | 1 |
| [#1660](https://github.com/theriseunion/freeland/issues/1660) | [Bug] registry lease 抢占测试偶发 409：测试的 Update 与 leader 续约并发且不重试 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 3 |
| [#1658](https://github.com/theriseunion/freeland/issues/1658) | [Bug] storage file-manager 依赖 openat2，112 集群 Kylin 节点上返回 ENOSYS，文件操作全部失败 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 3 |
| [#1590](https://github.com/theriseunion/freeland/issues/1590) | [Bug] 成员集群 console 没有任何插件页面：成员实例的插件列表为空，PCI / agent 下发的插件在成员 console 不可见 | CLOSED/COMPLETED | 已修复 | 3.0 | — | 1/1 子项关闭 | #1677（关闭） | 16 |
| [#1552](https://github.com/theriseunion/freeland/issues/1552) | [Bug] gpustack 模型上架、推理实例、模型目录、API Key 与概览页在英文界面下仍显示中文（母单 #1455） | CLOSED/NOT_PLANNED | 推迟解决 | 3.0 | [#1455](https://github.com/theriseunion/freeland/issues/1455) | — | — | 1 |
| [#1544](https://github.com/theriseunion/freeland/issues/1544) | [Bug] storage 存储卷列表、存储卷详情与文件浏览在英文界面下仍显示中文（母单 #1455） | CLOSED/COMPLETED | 已修复 | 3.0 | [#1455](https://github.com/theriseunion/freeland/issues/1455) | — | — | 1 |
| [#1534](https://github.com/theriseunion/freeland/issues/1534) | [Bug] 个人中心页 /core/profile 没有接入「用户中心」侧边栏，与 SSH 密钥 / API 密钥页互相无法导航 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 2 |
| [#1528](https://github.com/theriseunion/freeland/issues/1528) | [Task] storage 存储卷详情与文件浏览页的页面规范违规整改（母单 #1455） | CLOSED/COMPLETED | 已修复 | 3.0 | [#1455](https://github.com/theriseunion/freeland/issues/1455) | — | — | 1 |
| [#1511](https://github.com/theriseunion/freeland/issues/1511) | [Bug] PCI 控制器：升级成功后立即再次升级、循环往复（读到旧缓存并用旧状态覆盖 values hash） | CLOSED/COMPLETED | 已修复 | 3.0 | [#1401](https://github.com/theriseunion/freeland/issues/1401) | — | — | 1 |
| [#1508](https://github.com/theriseunion/freeland/issues/1508) | [Bug] PCI / Plugin 控制器：release 卡在 pending-upgrade 且没有成功版本时只会 rollback，永远卡住 | CLOSED/COMPLETED | 已修复 | 3.0 | [#1401](https://github.com/theriseunion/freeland/issues/1401) | — | — | 2 |
| [#1499](https://github.com/theriseunion/freeland/issues/1499) | [Bug] KubeEdge CloudCore hostNetwork 单副本滚动升级端口死锁 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 2 |
| [#1492](https://github.com/theriseunion/freeland/issues/1492) | [Bug] PluginClusterInstall 客户端渲染禁用 Helm lookup 并可能轮换 Secret | CLOSED/NOT_PLANNED | 已修复 | 3.0 | — | — | — | 1 |
| [#1487](https://github.com/theriseunion/freeland/issues/1487) | [Bug] ChartMuseum 回填未覆盖 values-rg-meta 导致 dev catalog 滞后 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 2 |
| [#1486](https://github.com/theriseunion/freeland/issues/1486) | [Bug] PluginClusterInstall 在 workload CrashLoop 时仍报告 Installed | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#1485](https://github.com/theriseunion/freeland/issues/1485) | [Bug] KubeEdge CloudStream 缺少 TLS 文件导致 CloudCore 崩溃 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 7 |
| [#1477](https://github.com/theriseunion/freeland/issues/1477) | [Bug] SWR 基础镜像同步未保证新仓库公开可拉取 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#1476](https://github.com/theriseunion/freeland/issues/1476) | [Bug] PluginClusterInstall 创建成功后状态初始化偶发返回 NotFound | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#1451](https://github.com/theriseunion/freeland/issues/1451) | [Bug] NodeGroup 节点管理缺少安全可用的添加节点闭环 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 2 |
| [#1393](https://github.com/theriseunion/freeland/issues/1393) | [Bug] 删除插件时 Helm 卸载失败仍移除 finalizer，release 永久残留 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#1391](https://github.com/theriseunion/freeland/issues/1391) | [Bug] 插件 agent 的 Helm 版本记录在 Karmada 上无上限增长（registry 6702、storage 2693，合计约 186 MiB） | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#1390](https://github.com/theriseunion/freeland/issues/1390) | [Task] 删除平台侧遗留的 storage 挂载 HMAC 签名与 key（rise-global-extension#990 后续） | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 3 |
| [#1381](https://github.com/theriseunion/freeland/issues/1381) | [Task] 将 SWR 仓库 risecloud/rise-plugin-observe 设为公开：rg-meta 上 observe-apiserver 匿名拉取 401，持续 ImagePullBackOff | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 0 |
| [#1365](https://github.com/theriseunion/freeland/issues/1365) | [Task] IAM 成员绑定与默认角色命名碰撞修复 | CLOSED/COMPLETED | 已修复 | 3.0 | — | 1/1 子项关闭 | — | 2 |
| [#1356](https://github.com/theriseunion/freeland/issues/1356) | [需求] 镜像管理：技术说明与使用说明 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#1349](https://github.com/theriseunion/freeland/issues/1349) | [Bug] system-workspace 的项目列表包含 kube-system、rise-system-images 等系统 namespace | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 0 |
| [#1346](https://github.com/theriseunion/freeland/issues/1346) | [Bug] Karmada 集群代理：member 上的 karmada-impersonator 无权模拟 system:serviceaccounts:karmada-system 组，返回 403 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 0 |
| [#1292](https://github.com/theriseunion/freeland/issues/1292) | [Bug] 集群组件安装因 release name 超过 Helm 53 字符上限失败（Plugin 名重复拼接） | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#1284](https://github.com/theriseunion/freeland/issues/1284) | [Bug] 平台安装 chart 的 crds/ 在 GitOps 链路无交付路径——skipCrds + storage-only include 导致 IAM CRD 静默缺失 | CLOSED/COMPLETED | 已修复 | 3.0 | [#2104](https://github.com/theriseunion/freeland/issues/2104) | — | — | 3 |
| [#1192](https://github.com/theriseunion/freeland/issues/1192) | [需求] member 控制台无法打开插件页面（member 未安装插件，仅有配置副本） | CLOSED/COMPLETED | 已修复 | 3.0 | [#1590](https://github.com/theriseunion/freeland/issues/1590) | — | — | 1 |
| [#1188](https://github.com/theriseunion/freeland/issues/1188) | [需求] 镜像选择 Demo 增加「公共配置」只读读取页 | CLOSED/COMPLETED | 已修复 | 3.0 | [#562](https://github.com/theriseunion/freeland/issues/562) | — | — | 2 |
| [#1187](https://github.com/theriseunion/freeland/issues/1187) | [需求] 全局配置服务：技术说明与使用说明 | CLOSED/COMPLETED | 已修复 | 3.0 | [#562](https://github.com/theriseunion/freeland/issues/562) | — | — | 2 |
| [#1085](https://github.com/theriseunion/freeland/issues/1085) | [Bug] storage 的 RBAC 守卫测试在 main 恒定失败：#856 给 roletemplates/iamroles 加 Helm 守卫后测试读不到文档 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 2 |
| [#1062](https://github.com/theriseunion/freeland/issues/1062) | [Task] registry-apiserver 在插件层自造跨集群路由 + 神身份 + request-assertion，应清理为解耦形态并收敛到平台通用路由 | CLOSED/NOT_PLANNED | 不解决 | 3.0 | — | — | — | 5 |
| [#1027](https://github.com/theriseunion/freeland/issues/1027) | workspace IAMRole spec 每秒翻烧饼 → CacheInvalidator 风暴 → apiserver OOM(根因:Workspace status 自旋 + materializer 破坏性覆写) | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#900](https://github.com/theriseunion/freeland/issues/900) | [需求] 镜像选择 Demo 增加可跨集群读取的公开配置 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 4 |
| [#863](https://github.com/theriseunion/freeland/issues/863) | [需求] 目录卷根载体与保留生命周期契约（母单 #857） | CLOSED/COMPLETED | 已修复 | 3.0 | [#857](https://github.com/theriseunion/freeland/issues/857) | — | — | 2 |
| [#860](https://github.com/theriseunion/freeland/issues/860) | [需求] 目录卷使用检查、保留恢复与永久清理（母单 #857） | CLOSED/COMPLETED | 已修复 | 3.0 | [#857](https://github.com/theriseunion/freeland/issues/857) | — | #1677（关闭）,#858（关闭）,#859（关闭） | 5 |
| [#859](https://github.com/theriseunion/freeland/issues/859) | [需求] 算力负载挂载多个目录卷（母单 #857） | CLOSED/COMPLETED | 已修复 | 3.0 | [#857](https://github.com/theriseunion/freeland/issues/857) | — | #858（关闭） | 3 |
| [#858](https://github.com/theriseunion/freeland/issues/858) | [需求] 目录卷创建与文件操作（母单 #857） | CLOSED/COMPLETED | 已修复 | 3.0 | [#857](https://github.com/theriseunion/freeland/issues/857) | — | #1677（关闭）,#863（关闭） | 4 |
| [#857](https://github.com/theriseunion/freeland/issues/857) | [需求] 存储卷目录化：打通创建、挂载、保留恢复与清理流程 | CLOSED/COMPLETED | 已修复 | 3.0 | — | 4/4 子项关闭 | — | 24 |
| [#855](https://github.com/theriseunion/freeland/issues/855) | [global-config] 004 Karmada 分发三项 minor：幂等 envtest / 源 CM 删除分支测试 / member 集合口径 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 1 |
| [#682](https://github.com/theriseunion/freeland/issues/682) | [Bug] nodegroup 被 SDK 声明为菜单 scope，但宿主导航不支持 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 5 |
| [#600](https://github.com/theriseunion/freeland/issues/600) | [Bug] 插件目录冷请求解压并缓存全部历史 Chart，可再次触发 rise-apiserver OOM | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 3 |
| [#562](https://github.com/theriseunion/freeland/issues/562) | [需求] 支持多集群的全局参数设置 | CLOSED/COMPLETED | 已修复 | 3.0 | — | 2/2 子项关闭 | — | 0 |
| [#316](https://github.com/theriseunion/freeland/issues/316) | [Task] 补一份 console/boss 两侧按钮权限与 API 调用的规范示例（以推理服务为范例） | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 2 |
| [#315](https://github.com/theriseunion/freeland/issues/315) | [Bug] 推理服务实例 Tab 的终端模态能弹出但连不上，进不到 shell | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 2 |
| [#19](https://github.com/theriseunion/freeland/issues/19) | [Bug] 弹性 CI runner（self-hosted-gmtc6-*）连不上 ghcr.io，导致容器构建随机失败 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 0 |

## 我创建、其他人负责或未分配（16）

| Issue | 标题 | GitHub 状态 / 原因 | Project 状态 | 里程碑 | 原生父项 | 原生子项 | 原生前置依赖 | PR 引用数 |
|---|---|---|---|---|---|---|---|---:|
| [#3092](https://github.com/theriseunion/freeland/issues/3092) | [需求] storage 租户 API 按 #2987 统一应用侧路径：改造对照表 | OPEN | 待处理 | 3.0 | — | — | — | 0 |
| [#3062](https://github.com/theriseunion/freeland/issues/3062) | [需求] BOSS 存储管理（存储后端接入 + 公共目录管理） | OPEN | 待处理 | 3.0 | — | — | — | 2 |
| [#3047](https://github.com/theriseunion/freeland/issues/3047) | [Task] 日志栈安装/升级时的存储介质选择与前置检查（口径 + chart + runbook） | OPEN | 待处理 | 3.0 | — | — | — | 0 |
| [#3036](https://github.com/theriseunion/freeland/issues/3036) | [Task] 审计页首屏去精确总数（with_total/has_more 落地）与 integration 测试修复 | OPEN | 待处理 | 3.0 | — | — | — | 0 |
| [#3035](https://github.com/theriseunion/freeland/issues/3035) | [Task] 写路径余量加固：exporter 超时对齐 / 重试幂等 / 批次大小 | OPEN | 待处理 | 3.0 | — | — | — | 0 |
| [#3032](https://github.com/theriseunion/freeland/issues/3032) | [Bug] 已有 Host 集群读取权限，读取项目事件仍返回403 | OPEN | 待上线 | 3.0 | — | — | — | 3 |
| [#3024](https://github.com/theriseunion/freeland/issues/3024) | [Task] 控制面静态 Pod（owner=Node）的身份语义与 unknown 占比收敛 | OPEN | 待处理 | 3.0 | — | — | — | 0 |
| [#3023](https://github.com/theriseunion/freeland/issues/3023) | [Task] 190 日志 ClickHouse：数据目录换本地盘（现阶段）+ 存储介质压测 | OPEN | 待处理 | 3.0 | — | — | — | 1 |
| [#3012](https://github.com/theriseunion/freeland/issues/3012) | [Bug] logs 插件入库写路径低效：单批约 10s 且超时重试导致 3 倍重复入库（190 实测） | OPEN | 待处理 | 3.0 | — | — | — | 1 |
| [#2979](https://github.com/theriseunion/freeland/issues/2979) | [Bug] NovaInference/NovaCustomService 删除卡 finalizer：控制器 30s 超时不收敛 | OPEN | 不解决 | 3.0 | [#3342](https://github.com/theriseunion/freeland/issues/3342) | — | — | 1 |
| [#2708](https://github.com/theriseunion/freeland/issues/2708) | [需求] CI/CD 应用镜像仓库迁移到 Harbor risecloud 项目 | OPEN | 进行中 | 3.0 | [#1767](https://github.com/theriseunion/freeland/issues/1767) | — | — | 0 |
| [#2633](https://github.com/theriseunion/freeland/issues/2633) | [Bug] 插件不得提供 IAMRole：框架把 IAMRole 列为插件全局路由 GVK，7 个插件共 17 个 IAMRole | OPEN | 进行中 | 3.0 | — | 9/12 子项关闭 | — | 14 |
| [#2460](https://github.com/theriseunion/freeland/issues/2460) | [Task] IAM 名称兼容文档缺少标准索引入口（母单 #1365） | CLOSED/NOT_PLANNED | 不解决 | 3.0 | [#1365](https://github.com/theriseunion/freeland/issues/1365) | — | — | 1 |
| [#1344](https://github.com/theriseunion/freeland/issues/1344) | [Bug] chartmuseum 滚动重启期间插件升级下载 chart 失败后停在 Failed，不自动重试 | CLOSED/NOT_PLANNED | 已修复 | 3.0 | — | — | — | 0 |
| [#1083](https://github.com/theriseunion/freeland/issues/1083) | [Bug] 镜像「配置公共源」允许切换/选项目命名空间为来源，与全局命名空间单一来源架构冲突 | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 5 |
| [#1067](https://github.com/theriseunion/freeland/issues/1067) | [Task] 插件 /oapis 跨集群收敛到平台层通用路由(去插件侧重复) | CLOSED/COMPLETED | 已修复 | 3.0 | — | — | — | 4 |

## 数据覆盖与限制

完整读取 Project 的 2987 个条目；详细读取 251 个 Issue（主集合及作者集合247个，额外亲属上下文4个），包含 1520 条评论。每个已读取详情对象的 subIssues、blockedBy、blocking、comments、closedByPullRequestsReferences、交叉引用事件均翻页至结束。祖先/后代图并未无限递归抓取项目外的全部节点。

GitHub 不能证明当前 DSH 会话仍存在或谁持有本地执行权；本报告没有核对远端文本提到的 Session 是否为真实当前绑定。
