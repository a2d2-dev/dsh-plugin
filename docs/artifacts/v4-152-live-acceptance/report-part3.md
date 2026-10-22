# #152 v4 真实验收第三部分（执行中）

## 目的

在既有 preview http://10.126.126.12:18782/ 核验自然语言持续委托、Block、等待让槽、串行推进及关闭补偿。仅操作 A=#160、B=#161、X=#162，run 为 `v4-152-6b252218-r01`。不改 P/C/E、业务代码、Host、插件或 profile，不重启服务。

## 步骤与记录

- 首步在锁定验收 worktree 执行 `pwd && git branch --show-current && git pull --ff-only`：目录正确，分支 `test/152-preview-live`，Already up to date，exit 0。
- 使用 agent-browser 技能，浏览器命令均带 `--session qa152c`。首次 Python 登录包装器因 `python` 不存在失败，改用 `python3` 成功（不输出口令）。浏览器登录后自动初始化空白 New Session；它不是 A/B/X 模型执行，预览比较使用后续基线。
- 浏览器仅交互快照省略 details/summary，初步误判无持续委托；读取 DOM 后确认来源表头有折叠入口，展开后正常可见。关闭浏览器并重新登录也有同入口，不以此判产品缺陷。boot rev `abf3d8e5c684`；插件 entry rev `4eab34b975e0`；bootstrap batch `761246ab4baa`；含插件的 application batch `e6d73b2ad96b`，这两个 batch 同时存在。
- 资源配置 UI 明文提示“授权整个当前来源的开放 Issue；浏览中的 Project view 与 Issue 筛选不改变委托范围。已有规则保留原负责人和标签约束。”首次配置无标签控件，因此通过正式服务端 continuous.configure 只创建暂停规则：@me + `qa:v4-152-6b252218-r01-serial`，隔离 workspace `b2c6edcf-bb21-4925-8ccd-6b0e503de5dc`，runtime `c01a3a7b-6deb-4820-9896-548d14220162`，codex/gpt-6.1-sol medium，standard/workspace-write，enabled=false。
- 创建命令返回 HTTP503 work-record-unavailable，但读取规则确认已经持久化：规则 ID `373d1174-fcb6-49e9-aed0-2ebdb98281aa` v1。并带 source-snapshot-unavailable: Continuous processing requires a complete version-matched repository candidate scan。原始回执保存在 part3/01-configure-response.json。
- UI 填入中文委托原话，明确只 A→B、排除 X/P/C/E/其它开发 Issue/freeland/Project14、隔离目录、只写各自 proof、等待令和补同步语义。首次保存失败 HTTP503；再次 UI 保存成功，规则 v2 / draftVersion1 / plans=[]，原话已持久化。
- 当前真实模型预览已点击两次，页面返回 work-record-unavailable，尚无有效计划，未启用。正在继续其余安全可执行项。

## 已核对的专用远端身份

| fixture | number | nodeId | 初始远端状态 |
|---|---:|---|---|
| A | 160 | I_kwDOUmfSE88AAAABY_H0fQ | Open |
| B | 161 | I_kwDOUmfSE88AAAABY_H3PQ | Open |
| X | 162 | I_kwDOUmfSE88AAAABY_H6TA | Open |

三项 assignee 均为 imneov，均有本 run 的 serial 标签；A 另有 touch 标签。读取用 gh，每条 gh 所在 shell 先 export HOME=/root。隔离目录基线只有 README 和其它执行者的 E.proof.json，无 A/B/X proof。

## 未验证

计划成功、真实模型 request/usage、Block 持久化、启用、A-wait→B-done→A-resume、关闭冲突及补同步、在途暂停、浏览器关闭后自动推进尚未验证；本报告不会用固定安排或静态代码替代真实运行。
