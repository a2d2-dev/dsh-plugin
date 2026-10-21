# #154：18782 唯一受管切换实录（失败，旧 runtime 已运行）

本轮结论：**未部署新版本**。外部 systemd one-shot 退出1，completion为 `failed-needs-external-recovery`。固定5秒门拒新后，runner基于已证静态完整性应用独立a450 rollback并启动原18782；随后rollbackVerify在实际Script响应捕获处失败。原URL可达、旧runtime与旧数据已只读核验，不能标记deployment-verified或完整回滚验收。

## 实验目的与授权

只切换已有18782并证明原URL/数据保留，不涉及18781、生产、真实模型或业务GitHub对象。冻结工具 `5a2ecf35abd4ea64e543e0ef7e64a690a6ed4368`；执行前树HEAD `3a409188f5ac34db95fd959f0675454dfb8f6ea8`，branch `test/v4-acceptance`，tracked clean。

- 唯一final plan SHA256：`4d75ba31e211873b1f9e47f4a9ee70ec8958c9e2befe931e30cd1fdfde6951e7`。
- #150主会话具名执行指令SHA256：`8cb135bd740f5f96d67e3d83e4564cd231fba120236cd60e86f8ec508d1c391c`，parentSessionId=`session-74fb5e20-1456-461b-b5c1-ef5f3b41e018`，requestRef=https://github.com/a2d2-dev/dsh-plugin/issues/150。
- 两SHA均由本执行者实际重算一致；本轮真实指令已覆盖旧准备记录中“指令不存在”的历史状态。未借旧父136或LF名义授权。

## 步骤与命令结果

1. 正式公开只读API采集目标：`session/list`完整成员、逐Session `session/projections` 的inbox（next-turn/next-step）、正式 `/api/remote.mux` 的 `job/list` whole-set首帧。没有读取18781当前owner的job registry来代替preview。窄collector见[执行时collector材料](preview-handover-collector-154.mjs)，无凭据值入库。
2. 23:04:16.834Z采得3Sessions running=false、pendingInputs=0，seq分别26/41/3；三个job/list完整首帧均空。launcher3863422/startTicks31295054，CLI3863429/startTicks31295060。真实前台回执及handover私有exclusive/fsync保存，collector exit0。
3. 独立默认dry-run实际 `ready=true/reasons=[]`、exit0。23:05:39.806Z再次完整查询Session/input/jobs，成员、seq、空jobs、PID/startTicks均未变，独立recheck命令exit0。没有虚构flush、admission lock或product consumed。
4. 唯一启动外部unit `a2d2-v4-141-preview-154-5a2ecf3-02.service`；Type=oneshot、UMask0077、TimeoutStartUSec20min、KillModecontrol-group、固定Node22.23.1及含该Node/bin与/usr/bin的PATH。初始独立systemctl观察MainPID3133165，ControlGroup=`/system.slice/a2d2-v4-141-preview-154-5a2ecf3-02.service`，证明不是DSH子进程替代。通过systemd-run --wait监控job bash-2884，最终实际exit1。
5. runner实际完成单PID TERM→future-spawn hold→旧进程gone→行政stop holder→无写FD/完整zstd/双native静态cut。因固定门拒新，未执行new apply，随后实际rollback-applied。最后rollbackVerify失败，未手工重试或恢复。

## 停机与静态证据

23:06:11.662Z发送单PID信号；旧launcher child-exit记录code0/signalnull/forcedFlag=false。真实旧CLI日志绑定dev64769/inode61631467、owner fd20、offset7184、前缀SHA `a024bcfd3b9b01231e8544b2b2648b64233574281e258b33147ad05976c53cb7`。本次窗口0bytes、可归因、分类no-known-error，窗口SHA `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。没有公开raw CLI日志。

stopElapsedMs实际6681，口径是signal到proven holder收敛，超过未改动的5000ms门。holder metadata为STARTING，start/stop秒值对应23:06:17，观察now对应23:06:18。原旧CLI退出记录没有timestamp，**无法把6681分解为精确CLI退出耗时与holder开销**；不能直接称产品强退，也不能减去估算开销伪造过门。gracefulOutcome保持not inferred。

23:06:22.045Z staticCut.ok=true：3个Session前缀完整，events42/27/4；无写FD=0；全部物理zstd完整；new与rollback只读native均passed。new proof SHA `c0b177f2f7b2c1ecbe9eccd954abf53817b6d17a90bf236735aaf3859d77677f`，rollback proof SHA `00ac9637ec2f29d197acb2d1b6f69f0e6228de42d693c715073fd28aacc9f5c1`。runner在safeStoppedData=true后才实际应用rollback，数据没有被旧快照覆盖。

## 当前实际runtime与数据

23:09:00.534Z只读复核：Supervisor RUNNING，launcher3134479、CLI3134486。真实CLI argv指向独立 `v4-141-rollback-a45068d2/apps/cli/lib/bin.js`；current-run声明Host `a45068d2ec03326c800c68c9bdcd47508e3ccb9c`，原origin `http://10.126.126.12:18782`。

实际安装clientSHA `7af60c97e19076cb251235995bcca86fa59bcdfc1dccb22b8e8e3899d2127b70`，与选定rollback相同、与new不同。实际tgz指纹 `7ae2ed521df692723f8f4ff382b3710482e5824b648c272d7f9b267244b3e208`。completion内deployed字段只是runner预填的计划new资产指纹，不能据此声称fc4fa731/Host8282已上线。

三Session逐项比较pre-stop与rollback-live-cut：27/42/4条accepted事件原样保留，无增加、无丢失，cwd/config均相同。当前workspace/runtime/work材料也与pre-stop一致：

| 材料 | SHA256 |
|---|---|
| workspace | `ee8cdb002169e8d394b11433938df796aaf6d48a0569a3407a5e474815a1a40b` |
| runtime | `9d754788874282c0f3b7d9b52b6b24569bfe13329b3e43301d724e0340e7b7a0` |
| work | `bb3bba619f0ea13e0470355faec234ccae2be482dd597707ae4e4c4e4f0695bb` |

## 浏览器失败与断言边界

rollbackVerify实际status1、signalnull、stdout为空；确切脱敏stderr：`actual loaded Script response capture incomplete`。固定collector仅在“当前frame/loader没有Script”或“当前Script存在failed/body缺失”时抛此错误；原run尚未保存分支明细，不能从它直接断言HTTP、client或产品失败。

[1440桌面实拍](preview-154-rollback-desktop.png)与[390窄屏实拍](preview-154-rollback-narrow.png)由授权runner使用agent-browser在原URL实际生成，SHA分别 `8aa5463acb73378b3b5efe951b038099cdf4c41cb05a5e37b29251e3335356e1` / `094a6221829313cb0c3e7f3dc0b83a7b76aebdac3d371a0f05363337af0553a5`。可见DSH壳、3会话及旧A²D²入口，Preview Notice仍覆盖页面，只证明可达，不证明交互验收或实际loaded JS指纹绑定。

只读源码核对：Host用classic script、preload as=script；WelcomeNotice的标题实际是h2，符合现有选择器。它异步load，当前验证只等Global panels；若dialog尚未出现会返回false并继续。该机制说明截图不能单凭标题推定产品故障，但原次是否恰为此时序仍未验证。

## CEO另行授权的一次只读CDP诊断

原失败后CEO明确允许一次专属browser/CDP诊断，未授权重试切换。新私有目录 `/tmp/a2d2-v4-154-cdp-diagnosis-01`；只在诊断副本补响应错误元数据，不改冻结工具或原failed run。单一专属session内对比同步CLI阻塞与异步导航，两段均保持total/resource buffer各16777216、禁cache/bypassSW和frame/loader身份规则，不route/mock、不点击Notice、不输入消息。命令exit0，finally关闭本次browser。

结果是**未复现原失败，不能宣称具体根因已定位**。同步与异步各捕获当前document的5个Script body，getResponseBody错误0；同步总解码字节13060679（小于16MiB）。同步frame=`EF9BEF770D73FDA2E412FFB7D4811C00`、loader=`DE5463186BDD8F736610184F8A3BFEDB`，目标combo requestId=`3166670.6`、1217190字节，bodySHA `d618e6c74f8482e2c693f14a13c732096826349c124078239a0c981bc9cef92a`；大combo requestId=`3166670.5`、10429302字节。异步loader=`FAF76B5A8F720D9293BD594F55ED4316`、目标requestId=`3166670.109`，取得同一目标bodySHA。所有resourceType=Script，cache标志false。实际失败run没有保存requestId/errorCode，不能用本次成功请求伪造其失败元数据，也不能声称异步已证修复。

DOM实际确认：DIV、role=dialog、aria-label=Preview Notice、H2文本Preview Notice、Continue enabled，原选择器确实包含它。alertdialog猜测被排除；原截图覆盖的具体时序仍待定位。

[完整脱敏CDP/ARIA元数据与诊断代码SHA](preview-cdp-diagnosis-154.json)保留具体URL/request/frame/loader/body bytes/error字段，不含Cookie/headers/token登录URL或body明文。这是故障诊断，未做完整selected-client/singleton组合绑定，不替代原rollbackVerify结果。诊断后再次正式只读采cut和inbox：3Sessions前缀/config仍保留、零运行/零待输入，3项JSON材料仍与pre-stop一致。

## 交接与后续最小动作

systemd终态：LoadState loaded、ActiveState/SubState failed、Result exit-code、ExecMainCode1、ExecMainStatus1。单次runner的拒新是实际安全门结论，仍不能证明CLI真实强退。当前旧runtime运行且数据保留，**无需为“恢复”再次重启**。已授权的一次只读诊断未复现捕获失败；建议后续若修工具，先test-first保留失败分支的requestId/frame/loader/body error元数据，再由证据决定是否改同步调用，不能据成功诊断宣称修复，更不能扩大buffer或放宽身份/5秒门。未来新切换应基于当前managed rollback的真实独立退出receipt/日志重新绑定，不复用本次旧PID/hold计时；须由CEO另发新阶段指令，不覆盖本run或清lock。

[脱敏机器实录及全部private证据路径/hash](preview-deployment-154.json)保留完整索引。原失败journal/completion/private日志、lock、新输入与全部数据保留；plan重算仍为4d75…，冻结scripts与5a2ecf35逐字节一致。当前未改产品/Host/工具/plan、未重建制品、未触碰18781或其它服务、未发真实模型/业务对象任务。所有本阶段job输出收齐后交回写权，#152/#150整体验收仍未完成。
