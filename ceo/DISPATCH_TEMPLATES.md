# Dispatch Templates

Use these templates when drafting `dispatch_subagent` prompts. Fill every placeholder with durable facts; child sessions do not share the main-session context and run as the Agent configured for the requested stage.

## Dev: implementation or fix

```text
任务：<one-sentence goal>

工作目录：<absolute persistent worktree path>（锁定此目录，禁止触碰其他 checkout）
分支：<branch>
第一步：cd 到工作目录，校验 `pwd` 与 `git branch --show-current`，不符即停并汇报。

背景与验收标准：
- <verifiable behavior>
- <verifiable behavior>

范围：
- 只改 <files/directories>
- Out of scope：<explicit exclusions>. 不夹带 unrelated changes，不提交编译产物。

要求：
- 先定位 root cause 再动手，禁止 mock/fallback/表象补丁
- test-first：先写一条会变红的测试，再让它变绿
- 最小改动；改代码同步更新相关文档
- 每完成一个阶段立即 commit，中断后凭 git 现场续跑
- 涉及 UI：用 agent-browser 截图实证，编译通过不等于功能正常
- 完成后 push 到分支，不要合并
- 汇报：做了什么、验证证据（命令输出/截图）、遗留问题。只依据真实 git/命令输出汇报，未验证的写“未验证”
```

## Review: fresh-context adversarial review

```text
对 <worktree absolute path> 中分支 <branch> 相对 <exact base> 的全部改动做对抗式代码审查
（read-only：禁止创建/修改/删除任何文件，禁止 git 写操作）。

方法：先 `git fetch <remote> main`，再 `git diff <exact base>...HEAD` 看全量 + 读相关源文件全文（不只看 diff 上下文）。

以攻击者/挑刺者视角审查，重点：
- 正确性 bug（边界、并发、错误处理）
- 验收标准是否真正满足（对照：<acceptance criteria>）
- 测试是否真实（有无软断言、跳过用例、断言口径掩盖失败）
- scope 蔓延与夹带改动

输出：每个问题给 文件:行号 + 证据 + 严重级别；结论为 APPROVE 或 REQUEST_CHANGES。
不接受 “looks good”：如果真的没问题，需说明你验证了哪些点、如何排除的。
```

Pin the base in the prompt. CEO checks the base first when ruling on review results; a review against the wrong base is unusable.

## Diagnose: root cause

```text
诊断：<symptom in one sentence, with original error or URL>
工作目录：<absolute path>

read-only：禁止创建/修改/删除仓库文件，禁止 git 写操作。目标是根因，不是修复方案先行。

要求：
- 分层定位（网络/证书/运行时/应用/配置），说明每层如何排除
- 错误信息先辨语义：区分正常排除项和真问题
- 每个结论给证据（命令 + 输出摘录）；猜测必须标注为猜测
- 若怀疑是测试环境/断言本身的问题（而非产品缺陷），明确指出并给验证方法

输出：根因 -> 证据链 -> 建议修复方向（含影响面评估）。
```

## CEO closure

After any child returns, verify claims with git and command output before syncing the task issue. For review findings, mark each item as fix or account; keep the current ticket focused on acceptance-breaking or security-proven issues.
