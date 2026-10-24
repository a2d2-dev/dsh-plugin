# Issue #137 真实实例来源验收（2026-10-24）

目的：在当前既有DSH GUI验证规格2来源／目录／导航。Task d659d90c-6dfc-49a5-afe9-025c8d70e087，协调代次2。

记录进行中，未经验证的场景不标为通过，不启动工作，不改变freeland业务数据。

当前宿主checkout HEAD 8282d61299a04f60555f9ce473af174bbe161b02，服务PID3451716。插件为tarball安装，版本号0.0.21但叠加后续补丁。实际安装client.js.map中source-directory.tsx及work-panel-controller.ts逐字匹配f1d6c1b。SHA256分别bad94781ebaf830f8db077f02d559cdfa50fc9109e6f533afc900276061ff1c5、b547f71f0bacf5ee69c566afb1010352e1bdbb316c89ad2d04d60c92262df1ca。浏览器聚合脚本rev=f3afe64639c8，正在进一步核对。watcher在另一checkout，不声称HMR；本轮不重启/替换宿主。

## 本轮发现并修复的缺口

Project／PR页没有展示缓存与本次读取区别：SourceDirectory计算了cache文案却未插入JSX，Issue分支原有提示不会在目录页挂载。最小修复在非Issue公共目录分支、有catalog且不处于读取状态时，显示“缓存 / 最后已知观察”或“本次读取”及目录观察时间。无catalog不声称已有缓存，失败仍保留原错误和缓存事实。

新增真实WorkPanelController＋WorkPanel渲染回归，对Project及PR分别验证本次读取→缓存→权限失败保留缓存→无catalog。原红2失败/1通过，修复后3/3通过，typecheck及构建通过。相关来源全回归与pack随后执行；403仅合同测试，真实不可见仓库返回404，二者不混同。

客户端更新已执行：先逐项比对安装sourcemap的全部src内容，再只替换client.js及map；仅source-directory.tsx变化，其余31个客户端源码、25个host JS资产保留。备份及前后SHA见client-deployment.json；可执行回滚为python3 client_update.py rollback。未重启宿主、未替换配置或会话数据，当前GUI刷新验证继续执行。

## 已执行页面场景

仓库真实识别/确认、账号范围、默认概览、@me及全部负责人、开放/关闭/全部、标签+搜索、有效空及前后分页已记录。Project真实views与GitHub定义对照：任务清单is:open显示24项，全部任务含关闭显示97项并可分页，切回任务清单仍只显示24项。Repo与Project入口打开#137均读取同一Task/规格及当前1历史1会话。

Project/Repo真实PR、状态/搜索/分页、不可见来源404、正在读取、缓存、离线失败保留缓存、恢复、快速切源后最终页面保持新来源、390×844窄屏已记录。窄屏文档宽度390，无整页横向溢出，表格自身可横滚。真实Project入口附unknown:value后显示不支持筛选，未冒充全量；随后恢复原views/1入口。

记录仍在继续，整体验收以最终逐项裁决为准。
