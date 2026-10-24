# #226 已完成 Task 接续入口验证

## 目的

确认已验收 Task 的接续页保留置灰「准备接续」，显示「任务阶段：done（已验收完成）」与不能继续接续的原因；未完成当前协调仍可用，历史、评审及缺资格会话不能启用。验证范围为真实组件渲染与编译，不触发真实 Task 接续。

基线：`de0e42c811bc18cfaced67a6292c15e5faef75e1`。分支：`fix/226-continuation-disabled-status`。提交前 `git ls-remote origin refs/heads/main` 仍返回该基线。

## 步骤与记录

所有命令在锁定任务工作树执行，逐次检查退出状态；没有软断言、skip 或修改测试超时。

| 命令／步骤 | 结果 |
| --- | --- |
| 初次执行组件测试 | exit 254：工作树尚无 vitest，属于依赖缺失 |
| `corepack pnpm install --offline --frozen-lockfile --ignore-scripts` | exit 0；锁定依赖离线安装，无安装脚本 |
| `TMPDIR=$PWD/.local/tmp corepack pnpm exec vitest run tests/client/execution-components.spec.ts`，修复前 | exit 1；1 fail / 2 pass；真实静态渲染没有「准备接续」按钮 |
| 同一组件测试，组件修复后 | exit 0；3 pass；完成时无 handler／误传 handler 均显示 disabled 按钮与 done 原因 |
| `TMPDIR=$PWD/.local/tmp corepack pnpm exec vitest run tests/client/execution-continuation-render.spec.ts`，接线修复前 | exit 1；5 fail / 6 pass；native 与 Issue 完成事实没有传给组件，按钮缺失或错误可用 |
| 组件与接线初次绿测 | exit 0；2 文件 14 pass |
| 首次 `corepack pnpm typecheck` | exit 2；测试夹具将宿主观察状态写为合同不支持的 `completed`；修正为实际支持的 `inactive` |
| 最终 `corepack pnpm typecheck` | exit 0；服务端与客户端类型检查通过 |
| `corepack pnpm build` | exit 0；产物仅在本工作树忽略目录生成；现有 tsdown `external` / `noExternal` 弃用警告 |
| 最终相关回归（下方完整命令） | exit 0；6 文件 44 pass |
| `git diff --check` | exit 0 |

最终相关回归命令：

```sh
TMPDIR=$PWD/.local/tmp corepack pnpm exec vitest run \
  tests/client/execution-components.spec.ts \
  tests/client/execution-continuation-render.spec.ts \
  tests/client/v4-integrated-render.spec.ts \
  tests/client/v4-source-render.spec.ts \
  tests/client/session-handoff-entry.spec.ts \
  tests/client/work-completed-status.spec.ts
```

新增渲染回归覆盖 `task.completion`、`progress.completion`、`progress.processingState=completed`；未完成当前协调；history / review / related；当前会话不匹配；缺少 actual；宿主 idle / inactive 与 GitHub closed 不能代替 Task 完成。原有 taken 内容投递重试渲染与 #223 当前会话导航回归保持通过。现有生产组件夹具仅增加 useRef 支持，加载真实 native TSX 与回调；夹具不接真实服务。

## 未验证项

未执行完整测试套件；以上 44 项通过不代表全量测试通过。GUI、部署与真实 freeland#3473 页面验证未在本轮执行。没有修改真实 Task 的状态、owner、epoch 或绑定账本，没有触发真实「准备接续」。
