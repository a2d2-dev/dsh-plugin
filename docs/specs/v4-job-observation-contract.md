# v4 后台作业观察与结果回执契约

## 目标与裁决

#138 在固定宿主 a45068d2ec03326c800c68c9bdcd47508e3ccb9c 上证实：公开 job list/get/readAt 无最终结果已收取事实，read 改变调用方消费游标；持久 tool/result 仅记录 message/error/meta，当前 tool-jobs 未写稳定 job 回执。插件不能解析结果文本、按时间猜归属或将按钮点击当作模型已消费。

为 v4 真实执行图及安全接续，补一个小而正式的宿主观察接口。它归宿主 jobs 模块，插件只消费其事实，不读取宿主私有内存或重建作业系统。

## 必须满足的 Interface

- 非消费观察，输入为真实 owner 和 job 标识，输出当前 JobView、registry epoch、稳定 job instance 身份、最终结果是否可收取／已交付的具名状态。
- 观察不得改变输出 cursor 或收取最终结果，不得将其他 owner 或 unowned job 合并为当前 Task 的作业。
- 真实 job_output 收取终态输出时，把稳定 registryEpoch／jobId／instanceId 与终态交付事实放入标准 tool result.meta，使宿主既有持久化能记录回执。重复读取与未知回执必须有明确语义。
- “已收取／已交付”不等于模型理解或业务验收。若没有公开的 model admission／消费证据，产品显示消费未知，不能伪造 consumed。
- registry 重启后必须能辨别旧 instance；不要求本次让裸进程跨重启继续运行。插件可将丢失的旧 registry 作业呈现为历史／不可恢复，不能错配同名新作业或假报仍运行。
- 接续安全边界依据在途 job 与尚待交付的终态结果；真实 job_output 收取后能解除相应等待，不能形成不可解除的永久阻塞。
- 兼容已有实现和调用者：默认调用语义、owner 隔离、等待／取消及 readAt 观察不退化。

## 验收

通过 jobs 的公开 seam 和真实 local registry／tool-jobs 组合验证：观察不消费、owner 拒绝、pending 到 terminal delivered 的时序、重复收取、registry 重启防误配、稳定 meta 经真实 tool result 日志保存、既有取消及readAt行为。不得仅 mock 一个总返回成功的 JobRegistry。

## 范围

只改宿主 jobs public contract、jobs-local、tool-jobs 和相应测试／变更说明。独立持久工作树与分支，当前 dev checkout 和运行产物保持不动。分支推送至现有 imneov/deepseek-harness fork，禁止向官方镜像提交 PR。实际部署由最终 #141 统一执行并核对原 URL 与旧数据。
