# TASKS.md — P0 修复：安全 + 评分可信度（2026-08-12）

## 第十轮：审查清单 P1/P2 实施（rank 并发 + 传输重试 + Host 校验 + 请求日志 + 路由冒烟，2026-08-13）

| 字段 | 内容 |
| --- | --- |
| **目标** | 实施上一轮代码审查的 5 项（rank 串行→并发 2、瞬态失败重试 1 次、selfcheck 路由层冒烟、Host 头校验、请求日志）+ 顺带项（LLM 超时 env 可配、rank 未知模型 400、路由未捕获异常兜底）；P3 三项（画像版本号/结果缓存/协议统一）按 PM 裁决搁置 |
| **修改范围（允许）** | `server/server.js`（可配常量/Host 校验/请求日志/callLLM 重试/rank 并发池/maxTokens/导出 server）、`server/selfcheck.js`（[6] 路由冒烟）、本文件 |
| **修改范围（禁止）** | `web/**`（前端零改动）、`.claude/skills/**`、`data/**`、`profile/**`、`start.js`、`README.md`、`.github/workflows/ci.yml`（仅核验：CI 已跑 `node server/selfcheck.js`，新增用例确定性零外部调用，无需改） |
| **停止条件** | 同一验证连续 2 次失败 → 停止汇报（本轮未触发） |
| **验证数据** | 见下方「验证记录 · 第十轮」：selfcheck 46 项全过 + 真实冒烟（发现并修复截断 502，evaluate 86.9s/502 → 47.8s/200） |

### 状态（第十轮）

- [x] P1-1 rank 并发池：默认 2 条并行（`RANK_CONCURRENCY` 可调），逐条 try/catch 失败隔离保留，结果统一按分排序
- [x] P1-2 传输层重试：callLLM 原有重试仅覆盖「JSON 格式错误」（已有），本次补网络抛错 / 超时 / 5xx 重试 1 次（退避 `LLM_RETRY_MS` 默认 1s）；**429 限流与 4xx 不重试**（重试会放大上游压力）；OCR 路径维持不重试（用户可点按钮重试）
- [x] P1-3 selfcheck [6] 路由冒烟：起真实服务器（临时端口 0），覆盖 Host 校验（伪造 Host 403 + 纯函数 9 例）、records 回环（写入→回读→恢复，不污染用户数据）、rank 失败隔离（注入 fetch 网络故障，确定性零 LLM 成本）、重试命中（第 1 次失败第 2 次成功，`calls===2`）、截断重试耗尽（502 + 进程存活）
- [x] P2-4 Host 头校验：`localhost / 127.0.0.1 / 0.0.0.0 / [::1]`（任意端口）放行，其余 403；DNS rebinding 纵深防御（配合既有 Origin 白名单）；curl 实测 `Host: evil.example.com` → 403
- [x] P2-6 请求日志：`[req] ISO时间 方法 路径 → 状态 (耗时ms · N LLM)`，仅 /api 元数据（不记请求体——画像/JD 含个人信息）；LLM 计数用 AsyncLocalStorage 按请求隔离（并发下不错乱），callLLM 与 OCR 都计入
- [x] 顺带 ①：`LLM_TIMEOUT_MS`（默认 120s）替代硬编码，fetchWithTimeout 默认值同步
- [x] 顺带 ②：rank 未知模型 502→400（此前排序后访问 `MODELS[provider].model` 抛 TypeError → 整批 502）
- [x] 顺带 ③：路由未捕获异常兜底（此前 async 回调里 readBody 等未处理拒绝会触发进程退出，现在 500 + 不崩）
- [x] **验证中发现并修复 1 个真实缺陷**：见 F-3（评估 maxTokens 2048 截断 → 502）
- [x] P3 三项（画像 schema 版本号 / 结果缓存 / LLM 协议统一）按 PM 裁决搁置，理由见决策记录

### 验证中发现并修复的缺陷（第十轮）

- **F-3 评估 JSON 被 2048 token 上限截断 → 502**：真实冒烟发现 evaluate 502（86.9s · 2 LLM），两次调用 `out=2048` 均顶满 max_tokens——模型输出被截断 → JSON 无闭合括号 → 格式重试耗尽。这是既有缺陷（审查清单外），重试机制本身按设计工作（恰好重试 1 次）。修复：callLLM 默认 maxTokens 2048 → 4096（与 tailor/interview 一致，一行 + 注释）。修复后实测 evaluate 47.8s/200 · 1 LLM（无浪费重试）。已补确定性回归用例（截断两次 → 502 + 可读错误 + 进程存活）。

### 验证记录 · 第十轮（2026-08-13）

```text
① node --check server/server.js / server/selfcheck.js 通过
② node server/selfcheck.js → 46 项断言全部通过 ✅（26 旧 + 20 新：
   [6] 路由冒烟 health/Host 403/isAllowedHost×9/records 回环×2/rank 失败隔离×4/重试命中×2/截断耗尽×2；
   输出可见 [req] 日志与「1008ms · 0 LLM」「1031ms · 1 LLM」——退避 1s 生效、首次抛错不计 LLM）
③ 真实冒烟（PORT=3199，DeepSeek 真实调用，修复前代码）：
   health 200 / Host 伪造 403 / 未知模型 400 / 静态页 200 ✅
   evaluate 单 JD → 502（86.9s · 2 LLM，两次 out=2048 顶满 → F-3 截断根因确认）✅暴露缺陷
   rank 3 JD → 200（134.8s · 6 LLM = 3 JD × 2 次截断重试；并发 2 生效：
   LLM 时间线 10:15:06/10:15:44 两链并行，串行需 ~260s）
④ 真实冒烟（修复后代码）：
   evaluate 单 JD → 200（47.8s · 1 LLM，无浪费重试）✅
   rank 2 JD → 200（44.0s · 2 LLM，两路并行：2 次调用 ≈ 单次调用耗时，串行需 ~90s+）✅
   [req] POST /api/evaluate → 200 (47824ms · 1 LLM) / POST /api/rank → 200 (43965ms · 2 LLM)（日志口径正确）✅
⑤ env 覆盖冒烟：RANK_CONCURRENCY=3 / LLM_TIMEOUT_MS=5000 / LLM_RETRY_MS=200 启动正常，rank 空 JD×3 返回 3 条 empty ✅
⑥ 清理：3199/3198 均无监听残留、smoke_rank*.json 已删、data/records.json 经回环测试已恢复原值
⑦ 剩余手动回归项（未做，建议用户回归）：live/tailor/interview/ats/ocr 五项真实模式 + 前端页面
```

## 第九轮：脚本移出桌面（解决重复显示，同日追加）

| 字段 | 内容 |
| --- | --- |
| **目标** | 用户资源管理器开启「显示隐藏文件」（Hidden=1），旧 .cmd/.bat 与新 .lnk 同时可见 → 桌面 6 组同名重复图标。将 6 个脚本移出桌面，.lnk 重新指向 |
| **修改范围（允许）** | 新建 `D:\GaoZhiyuan\launchers\`、6 个脚本移动 + 清除隐藏属性、6 个 .lnk TargetPath 更新、删除过时 hide_originals.ps1、本文件 |
| **修改范围（禁止）** | 脚本内容零改动（内部均为绝对路径，移动安全）、图标文件、项目代码 |
| **停止条件** | 同一问题连续 2 次修改后验证仍失败 → 停止汇报 |
| **验证数据** | 见下方「验证记录 · 第九轮」 |

### 状态（第九轮）

- [x] 6 脚本 → `D:\GaoZhiyuan\launchers\`，隐藏属性清除（属性=Archive），桌面 .cmd/.bat 清零
- [x] 6 个 .lnk TargetPath 更新，回读全部指向新路径且目标存在
- [x] 端到端回归 3 组全过（见验证记录）

### 验证记录 · 第九轮（2026-08-12）

1. **移动校验**：`.lnk 回读` 6/6 指向 `D:\GaoZhiyuan\launchers\*`，Test-Path 全 True，属性全 Archive（隐藏已清）✅
2. **桌面检查**：`Get-ChildItem $desktop -File | where .cmd/.bat` 为 0 ✅
3. **回归 1（后台闭环）**：后台.lnk → 3100 `{"ok":true}` + pid=10748 → 停止.lnk → 3100 关闭 + pid 删除 ✅
4. **回归 2（通用版）**：通用版.lnk → 3000 `{"ok":true}` → PID 47576 清理 ✅
5. **回归 3（旧版）**：旧版.lnk → 3000 `{"ok":true}` → 清理 ✅
6. **EIA**：.lnk 指向存在（Test-Path True）；bat 内容未变（第七轮已验证全链路），8002 服务保持原状态未动 ✅
7. **残留**：3000/3100 无监听、无 pid 文件 ✅
8. **踩坑复用**：`Get-Item` 对带隐藏属性文件需 `-Force`（第八轮第 3 条经验，本轮再次命中后 1 次修正通过）

## 第八轮：桌面快捷方式换新图标（同日追加）

| 字段 | 内容 |
| --- | --- |
| **目标** | 桌面 6 个启动脚本换好看图标。`.cmd/.bat` 无法自定义图标（图标来自关联 cmd.exe）→ 建 `.lnk` 快捷方式 + 自定义 `.ico`，原脚本隐藏（用户选：字母徽章风格 + 隐藏原文件） |
| **修改范围（允许）** | 新建 `C:\Users\GaoZhiyuan\Icons\`（6 个多尺寸 .ico + 生成器 gen_icons.ps1 + hide_originals.ps1 + verify_pixels.ps1）、桌面新建 6 个 .lnk、原 6 个脚本加隐藏属性、本文件 |
| **修改范围（禁止）** | 原脚本内容零改动（仅加隐藏属性）、求职 Agent / EIA 项目代码、其他桌面文件 |
| **停止条件** | 同一问题连续 2 次修改后验证仍失败 → 停止汇报（本轮无触发，PowerShell 字节写入问题 1 次定位即修复） |
| **验证数据** | 见文末「验证记录 · 第八轮」 |

### 状态（第八轮）

- [x] 6 个多尺寸 ICO：16/32/48 BMP + 256 PNG 四档，品牌色圆角渐变徽章（通用版靛蓝 #3B5BDB / 旧版青绿 #0CA678 / 后台版深靛+月牙 / EIA 紫 #7048E8 / 停止红+白方块 / Codex 深灰）
- [x] 6 个 .lnk 创建并绑定图标（Description 已写），原脚本 6/6 隐藏成功
- [x] 修复 2 个 PowerShell 陷阱（见验证记录第 5 条）
- [x] 端到端实测：后台.lnk → 3100 起服务 + pid 文件 → 停止.lnk → 端口关闭 + pid 删除

### 踩坑记录（第八轮，防再犯）

1. **PowerShell 函数输出 byte[] 被管道拆散**：`return $ms.ToArray()` 经函数管道后变成 Object[]（元素仍是字节），`BinaryWriter.Write(Object[])` 重载解析后**每次调用只写 1 字节** → ICO 数据区只剩「3 字节 + PNG」。教训：函数返回二进制必须 `[byte[]]` 显式转型或 `Write-Output -NoEnumerate`。诊断抓手：目录区长度正确但文件总长不对。
2. **attrib.exe 一次仅接受 1 个文件参数**：多文件调用报「参数格式不正确 -」。单文件逐条调用正常。
3. **PS 5.1 Get-Item 默认看不到隐藏文件**：隐藏属性文件的 `Get-Item` 报「找不到项」，必须 `-Force`。此前读到的「Hidden=False」是错误结果（Get-Item 失败 → $null → False），勿误判。

## 第七轮：桌面启动快捷方式核验（同日追加）

| 字段 | 内容 |
| --- | --- |
| **目标** | 核验桌面 6 个启动脚本是否全部可用；发现故障项做根因修复并回归 |
| **修改范围（允许）** | `D:\GaoZhiyuan\ai-job-agent-generic\start.js`、`server/server.js`（listen 守卫）、`C:\Users\GaoZhiyuan\Desktop\停止通用版AI求职Agent.cmd`、`D:\GaoZhiyuan\Enterprise Insight Agent V4\scripts\launch_hidden.ps1`（BOM 修复）、本文件 |
| **修改范围（禁止）** | `D:\GaoZhiyuan\Enterprise Insight Agent V4\重启服务.bat`（仅读取核验）、`Codex.cmd`（仅逻辑核验）、通用版其余源码 |
| **停止条件** | 同一问题连续 2 次修改后验证仍失败 → 停止汇报（本轮无触发） |
| **验证数据** | 见文末「验证记录 · 第七轮」 |

### 状态（第七轮）

- [x] ① `AI求职Agent.cmd`（旧版项目）— 无需修复，3000 起服务，标题「AI 求职 Agent · 岗位评估工作台」
- [x] ② `AI求职Agent-通用版.cmd` — **根因 1 修复**：start.js `require()` 加载 server.js 时 `require.main === module` 守卫为假 → 静默退出。修复：start.js 置 `LAUNCH_SERVER=1`，server.js 守卫扩展为 `require.main === module \|\| process.env.LAUNCH_SERVER === "1"`
- [x] ③ `AI求职Agent-通用版-后台.cmd`（3100 + PID 文件）+ `停止通用版AI求职Agent.cmd` — **根因 2 修复**：cmd IF 块内 `(PID %PID%)` 圆括号语法错 + `%PID%` 延迟展开为空。修复：`for /f "usebackq delims=" %%P` 运行时展开 + 文本去括号；完整启停闭环验证
- [x] ④ `启动EIA-V4.bat` → `launch_hidden.ps1` — **根因 3 修复**：ps1 UTF-8 无 BOM，中文注释经 GBK 解码错乱吞换行 → 代码行并入注释（"意外的 }"）。修复：加 UTF-8 BOM（内容零改动）；修复过程自伤第 1 行丢 `# E` 前缀（tail -c +4 误跳 3 字节）→ 从备份重建，最终字节 `EF BB BF 23 20 45 49 41` 回归确认
- [x] ⑤ `Codex.cmd`（附加核验）— 编码命令解码核验：7892 端口探测 → 可用则设 HTTP(S)_PROXY → 启动 Codex 应用；逻辑自洽，未实际启动（第三方 GUI 应用）

### 第七轮根因摘要

1. **Node 守卫误杀启动器**（②）：`require.main === module` 只拦截直接 `node server.js` 之外的加载；start.js 一键启动器恰好走 `require()`。已用 `LAUNCH_SERVER` 环境变量显式授权（CLAUDE.md 第 8 条：确定性标志代码层实现，不靠自觉）。
2. **cmd 块解析 + 延迟展开**（③）：IF 块内文本含 `()` 破坏块解析；`set /p` 赋值后块内 `%PID%` 在解析期已展开为空。改 `for /f` 运行时展开。
3. **PowerShell 5.1 编码**（④）：无 BOM 的 UTF-8 ps1 被按 GBK 解码，奇数字节中文注释吞换行。有 BOM 则强制 UTF-8，逐字节零改动。

## 第六轮：P2 体验优化（同日追加）

| 字段 | 内容 |
| --- | --- |
| **目标** | P2 四项：①评估区投递链接 + 已投 N 天跟进提示 ②画像向导分步化（6 步步骤条 + 上一步/下一步）③模式切换 aria 键盘导航（←/→/Home/End + focus-visible）④示例模式结果加「示例数据 · 非真实评估」角标 |
| **修改范围（允许）** | `web/index.html`（步骤条/link 输入区/aria-selected）、`web/app.js`（followBadge/followTip/sampleBadge/goStep 联动/aria 导航/buildRadar 健壮性）、`web/profile.js`（goStep 向导）、`web/styles.css`、本文件 |
| **修改范围（禁止）** | `server/**`（本轮未动服务端）、`.claude/skills/**`、`README.md` |
| **停止条件** | 任一验证连续 2 次失败 → 停止汇报 |
| **验证数据** | 见文末「验证记录 · 第六轮」 |

### 状态（第六轮）

- [x] P2-1 投递链接：真实评分模式下显示「投递链接」输入，评估后存入档案，档案详情可点击回访
- [x] P2-1 跟进提示：已投递记录显示「已投 N 天」角标，>7 天橙色「 · 建议跟进」+ 详情内跟进文案（两档：逾期/未逾期）
- [x] P2-2 画像向导：6 步步骤条（可点击跳转，完成步高亮），上一步/下一步首末步自动禁用，进入末步自动刷新云端列表，每次打开回到第 1 步
- [x] P2-3 aria 导航：mode-btn 全量 aria-selected + roving tabindex；←/→ 循环切换并同步焦点，Home/End 直达首尾；:focus-visible 焦点环
- [x] P2-4 示例角标：单岗位 / 简历定制 / 面试准备三个渲染入口统一前置角标
- [x] **验证中发现并修复 2 个真实缺陷**（见下方 F-1/F-2）

### 验证中发现并修复的缺陷（第六轮）

- **F-1 示例模式误触发真实 API**：`goTailor` 无示例守卫（`goInterview` 有），用户在示例模式点「联动定制」会先切真实模式并调用 LLM。修复：goTailor 前置 `currentMode === "sample"` 分支渲染示例结果；并移除 runTailor 中不可达的示例分支（单一事实源）。
- **F-2 空维度档案详情崩溃**：`buildRadar` 中 `const n = dims.length || 4` 在 `dims=[]` 时 n=4 但 `dims[0..3]` 为 undefined → `dims[i].name` 抛 TypeError，整个详情视图（含跟进提示）无法渲染。修复：`Math.max(dims.length, 4)` + 标签空值守卫。

## 第五轮：UI/PM 审查后 P1 优化（同日追加）

| 字段 | 内容 |
| --- | --- |
| **目标** | UI/PM 审查后 P1 四项：①滑杆归一化说明 ②rank 畸形输入 502→400 ③批量排序导出 CSV ④档案模式隐藏输入区 |
| **修改范围（允许）** | `server/server.js`（rank 校验）、`web/app.js`（els/setMode/CSV 导出）、`web/index.html`（按钮/文案/favicon）、`web/styles.css`（batch-tools/mode-archive 布局） |
| **停止条件** | 任一验证连续 2 次失败 → 停止汇报 |
| **验证数据** | 见文末「验证记录 · 第五轮」 |

### 状态（第五轮）

- [x] P1-1 滑杆归一化：实测发现 `updateWeightLabels` 已显示归一化值（39%/33%/17%/11%），仅补说明文案明确语义（审查判断修正：此项非缺陷，实为已实现）
- [x] P1-2 rank 元素类型校验：非字符串元素 → 400「jds 必须是字符串数组」（原为 502 内部错误）
- [x] P1-3 批量排序导出 CSV：表头对齐 job_search_tracker.csv（公司/岗位/来源URL/投递时间/匹配总分/推荐/风险flag/状态/下一步动作/备注），BOM 前缀防 Excel 中文乱码
- [x] P1-4 档案模式隐藏输入面板：body.mode-archive + 单列布局，结果区占满
- [x] favicon 404 消除（data: 内联）

## 第四轮：发布就绪（GitHub 公开推送准备，同日追加）

| 字段 | 内容 |
| --- | --- |
| **目标** | 清除通用化残留（人名 / 特定项目名 / 五维文案），补齐发布要素（package.json / MIT LICENSE / CI），验证无敏感文件入库 |
| **修改范围（允许）** | `.claude/commands/*.md`、`CLAUDE.md`、`README.md`、`web/index.html`（文案）、`web/sample-data.js`（注释）；新建 `package.json`、`LICENSE`、`.github/workflows/ci.yml`；`git init`（本地，不 push） |
| **修改范围（禁止）** | `server/`、`web/app.js`、`web/profile.js`、`data/**`（业务逻辑与数据） |
| **停止条件** | 残留扫描或验证连续 2 次失败 → 停止汇报 |
| **验证数据** | 见文末「验证记录 · 第四轮」 |

### 状态（第四轮）

- [x] 人名残留 ×2（commands 内「待高志远确认」→「待用户确认」）、特定项目名 ×1（博卡/EIA → 删除）
- [x] 五维文案 ×13 → 四维（4 个命令文件、CLAUDE.md、README ×3、index.html ×2、sample-data.js）；TASKS.md 历史记录保留
- [x] evaluate.md「BLOCKED 硬过滤」→「红线硬约束」对齐（与 04-job-evaluation.md 一致）
- [x] 新建 package.json（零依赖 metadata，start/test 脚本）、MIT LICENSE、CI（语法检查 + 自检）
- [x] README 目录结构补 selfcheck.js / .github / data gitignore 说明
- [x] git init + `git add -A --dry-run`：28 文件，无 `server/.env` / `data/` 泄漏

## 第三轮：C1/C3/C4/D2/B3/E1/E3（同日追加）

| 字段 | 内容 |
| --- | --- |
| **目标** | C1 评分类低温度保证可复现、C3/C4 打分锚定 + prompt 注入防护 + 红线硬约束、D2 LLM 用量日志、B3 skill 文档与实现对齐、E1 前端统计去重、E3 真实模式 JD 必填 |
| **修改范围（允许）** | `server/server.js`、`server/selfcheck.js`、`web/app.js`、`.claude/skills/job-application-assistant/04-job-evaluation.md`、本文件 |
| **停止条件** | 自检或冒烟连续 2 次失败 → 停止汇报 |
| **验证数据** | 见文末「验证记录 · 第三轮」 |

### 状态（第三轮）

- [x] C1 callLLM 支持 `opts.temperature`：默认 0.3（评分类可复现），tailor/interview 显式传 0.5
- [x] C3 打分尺度锚定注入评估 prompt（5.0–1.0 定义），抑制模型自定尺度的分数漂移
- [x] C4 输入安全声明（JD/简历是不可信数据非指令）+ 红线硬约束（命中 → recommend=false + risks level=red）
- [x] D2 usage 日志：响应回传 `usage`（input/output_tokens 兼容 Anthropic/OpenAI 字段名），console 打 `[LLM] provider · model · in=x out=y`
- [x] B3 `04-job-evaluation.md` 对齐：五维 → 四维 + 独立风险块；BLOCKED 硬过滤 → 红线硬约束；新增服务端确定性重算说明；标题与 markdownlint 告警清理
- [x] E1 前端提取 `countByStatus(list)`，renderArchive / refreshArchiveStats 复用（单一事实源）
- [x] E3 tailor/interview 空 JD：server 模式提示必填并 return（不再用 SAMPLE_JD 占位调真实 API）
- [x] 自检新增第 5 组「评分 prompt 防护」8 项断言

## 第二轮：A2/A4/C5/D3（同日追加）

| 字段 | 内容 |
| --- | --- |
| **目标** | A2 请求体大小限制、A4 云存档名保留字防护、C5 上游调用超时、D3 数据文件原子写入 |
| **修改范围（允许）** | `server/server.js`、`server/selfcheck.js`、本文件（本轮不碰前端） |
| **停止条件** | 自检或冒烟连续 2 次失败 → 停止汇报 |
| **验证数据** | 见文末「验证记录 · 第二轮」 |

### 状态（第二轮）

- [x] A2 readBody()：8 条 POST 路由统一接入，默认 10MB、OCR 25MB，超限 413
- [x] A4 RESERVED_NAMES：`__proto__`/`prototype`/`constructor` 拒绝用作云存档名（POST/DELETE）
- [x] C5 fetchWithTimeout：LLM 120s、OCR 60s，AbortError 转友好报错
- [x] D3 atomicWrite：tmp+rename 原子替换
- [x] 自检新增第 4 组「上游超时保护」用例

| 字段 | 内容 |
| --- | --- |
| **目标** | 修复审查发现的 4 个 P0 问题：A1 越权访问、A3 畸形 URL 崩溃、B1 总分/推荐由模型计算、B2 前端硬编码阈值与后端冲突 |
| **修改范围（允许）** | `server/server.js`、`web/app.js`、新增 `server/selfcheck.js`、本文件 |
| **修改范围（禁止）** | `web/index.html`、`web/styles.css`、`web/profile.js`、`web/sample-data.js`、`.claude/skills/**`、`start.js`、`data/**`、`README.md` |
| **停止条件** | 自检或冒烟验证连续 2 次失败 → 停止并汇报，不继续硬扛 |
| **验证数据** | ① `node server/selfcheck.js` 全过；② 服务冒烟：本机 200 / 恶意 Origin 403 / 畸形 URL 400 且进程存活；③ `node --check` 语法通过 |

## 状态

- [x] A1 服务端绑定 127.0.0.1 + Origin 白名单（拒绝外部站点调用）
- [x] A3 decodeURIComponent 异常捕获（畸形 URL 返回 400，不再崩溃进程）
- [x] B1 服务端确定性重算 overall_score / recommend（evaluate + rank 两条路由）
- [x] B2 前端统一用 recommend / threshold，去除硬编码 4.0（含档案详情）
- [x] 回归自检脚本 server/selfcheck.js
- [x] 冒烟验证（见下方验证记录）

## 验证记录

```text
（2026-08-12 已完成）
① node server/selfcheck.js → 17 项断言全部通过 ✅
② 服务冒烟（PORT=3199）：
   本机访问 /api/health        → 200
   恶意 Origin: evil-site.com  → 403（拦截）
   Origin: null (file://)      → 200（放行）
   畸形 URL /api/%zz           → 400（不崩溃）
   畸形 URL 后 health          → 200（进程存活）
   静态页 /                    → 200
   netstat: TCP 127.0.0.1:3199 LISTENING（仅回环绑定）✅
③ node --check server/server.js / web/app.js / server/selfcheck.js 语法通过
```

## 验证记录 · 第二轮（2026-08-12）

```text
① node server/selfcheck.js → 18 项断言全部通过 ✅（新增：挂起上游 300ms 内 AbortError 中止）
② 服务冒烟（PORT=3199，.env 已配置真实 Key）：
   正常 POST /api/evaluate        → 200，真实调用 DeepSeek，返回含归一化权重 0.3889、
                                    overall_score=0（无简历→模型诚实给0）、recommend=false（服务端重算生效）✅
   12MB 超大请求体                → 413（A2 生效），且后续 health 仍 200（进程存活）✅
   存档名 "__proto__"             → 400「系统保留字」（A4 生效）✅
   正常云存档 保存/列表/删除        → 200 / 200 / 200（D3 写入路径正常）✅
   GET /api/records               → 200 ✅
③ node --check 语法通过；过程中修复了路由转换遗留的孤儿括号（6 处，已逐一规整）
```

## 验证记录 · 第三轮（2026-08-12）

```text
① node --check server/server.js / server/selfcheck.js / web/app.js 语法通过
② node server/selfcheck.js → 26 项断言全部通过 ✅（新增第 5 组：prompt 含「不可信的外部数据」「硬性否决」
   「recommend 必须为 false」「level=red」「weight 39%」「4.0」「确定性重算」）
③ 服务冒烟（PORT=3199，真实 DeepSeek 调用 14.7s）：
   POST /api/evaluate → 200；响应含 usage {input_tokens:1051, output_tokens:1050}（D2 生效）✅
   console 日志 → [LLM] deepseek · deepseek-v4-pro · in=1051 out=1050 · 14:58:52（D2 生效）✅
   overall_score=0 / recommend=false / threshold=4 / 权重 0.3889（B1 重算回归无恙）✅
   JD 乱码被模型如实标 red 风险（诚实约束回归无恙）✅
   C1 temperature：调用成功（200），黑盒无法观测温度值；解析逻辑经语法 + 审查验证
   E3 前端守卫：node --check 通过；行为属浏览器交互，未做自动化覆盖
④ 发现并记录：模型 provider 名为 deepseek/glm（非 deepseek-chat），传错名返回 400「未知模型」
```

## 验证记录 · 第四轮（2026-08-12）

```text
① 残留扫描：grep 高志远/博卡/EIA/五维 → 仅剩 TASKS.md 历史记录行（预期保留），其余零残留 ✅
② node --check ×3 + node server/selfcheck.js → 26 项断言全部通过 ✅
③ package.json JSON 解析有效 ✅
④ git add -A --dry-run：28 个文件待提交；
   server/.env（真实密钥）不在清单 ✅、data/（用户数据）不在清单 ✅、
   server/.env.example（占位符）在清单 ✅（应提交）
⑤ profile/README.md 抽查为纯通用说明 ✅
```

## 验证记录 · 第五轮（2026-08-12）

```text
① node --check server/server.js / web/app.js 通过；selfcheck 26 项全过
② rank 校验四用例（新服务进程实测，修正了 kill %1 不生效导致旧进程冒充的验证坑）：
   对象数组 → 400「jds 必须是字符串数组」✅
   混合类型 [str,42] → 400 ✅
   空数组 → 400（回归）✅
   正常字符串数组 → 200（真实调用 16s，校验未误伤）✅
③ Playwright 真实浏览器验证：
   档案模式：输入面板隐藏 / body.mode-archive / 布局单列 / 按钮隐藏 / 档案可见（6/6）✅
   批量排序：导出按钮存在 + exportBatchCsv 已定义 ✅
   切回真实模式：输入面板恢复 / 双列布局恢复（3/3）✅
   画像向导：滑杆标签 39%/33%/17%/11%（归一化）+ 新说明文案 ✅
④ 过程发现：Git Bash `kill %1` 不杀真实 node 进程（job control 失效），
   曾导致冒烟打到旧代码进程；改用 netstat 取 PID + taskkill 精确清理。
   教训：验证前先确认监听进程是当前代码（EADDRINUSE 即中招）。
```

## 验证记录 · 第六轮（2026-08-12）

```text
① node --check web/app.js / web/profile.js 通过；selfcheck 26 项断言全过（服务端未动，回归无恙）
② Playwright 真实浏览器（127.0.0.1:3199，无头用户态验证，全部为 DOM 实测）：
   P2-1 投递链接：
     live 模式 link-wrap 可见 ✅ / archive 模式隐藏（setMode 联动）✅
     upsertEval 带 link 存储 → 档案详情渲染 <a> 且 href 正确 ✅
   P2-1 跟进角标（服务端注入 10 天前/3 天前已投记录）：
     「逾期跟进岗」→「已投 10 天 · 建议跟进」+ overdue 橙色 ✅
     「待跟进岗」→「已投 3 天」（无 overdue）✅
     详情提示：逾期档「⏰ 已投递 10 天无更新，建议主动跟进一次…」✅
               未逾期档「📮 已投递 3 天。可安排在第 7 天左右跟进一次。」✅
   P2-2 向导：打开弹窗 → 步骤 1 激活、其余 5 节隐藏、上一步禁用 ✅
     下一步 → 步骤 2（done 高亮 +1）✅；点步骤条直达第 6 步（5 done + 1 active、下一步禁用）✅
     载入示例 → 保存并使用 → 正常 ✅
   P2-3 aria：初始 aria-selected true/false + tabindex 0/-1 ✅
     ArrowRight：live→tailor，焦点随动、aria-selected 更新 ✅
     ArrowRight×2 + End + ArrowRight → batch→sample→live（循环包裹）✅
     :focus-visible 规则存在于样式表 ✅
   P2-4 角标：示例模式评估 →「示例数据 · 非真实评估」置顶 ✅
     goTailor 示例守卫（直接调用验证）：状态「示例模式 · 已加载定制简历示例。」、不进入真实 API（按钮未禁用、模式未切走）✅
   F-2 回归：空维度记录点开详情不再崩溃，雷达图正常渲染 ✅
③ 验证中发现 F-1（goTailor 示例守卫缺失，示例模式联动误触发真实 LLM 调用）→ 已修复
   与 F-2（buildRadar 空 dims 崩溃，详情视图整体不可用）→ 已修复，均经回归
④ 清理：验证产生的服务端记录 / localStorage 种子已全部清除（serverCountAfter=0），无用户数据残留
```

## 验证记录 · 第七轮（2026-08-12）

1. **总览**：桌面 6 个脚本（5 启动 + 1 停止），4 项实测启动、2 项静态核验。
2. **① 旧版** `AI求职Agent.cmd`：`cd /d D:\GaoZhiyuan\ai-job-agent` + workbuddy node 22.22.2 start.js。实测 3000 LISTEN，curl 200，页面标题「AI 求职 Agent · 岗位评估工作台」✅ 无需修复
3. **② 通用版** `AI求职Agent-通用版.cmd`：修复前 exit 0 无任何输出、无监听（静默退出）。根因链：server.js 第 863 行 `if (require.main === module)` 守卫 → start.js `require()` 加载时守卫为假 → 不 listen → 事件循环排空退出。修复后实测 3000 LISTEN（PID 29824），curl 200，标题「AI 求职 Agent（通用版）· 岗位评估工作台」✅；`node --check` + selfcheck 26 断言回归 ✅
4. **③ 后台 + 停止闭环**：
   - 停止脚本修复前报「此时不应有 ...。」（块内括号）且 PID 未展开（延迟展开）。最小复现确认：`cmd /c "if exist C:\Windows ( echo (PID 123) )"` 必失败；去括号后成功。
   - 修复后完整闭环实测：启动 → `data/server.pid` 写入（PID 匹配 49000→47840 两次）→ health 200 → 停止脚本输出 "Stopped." → 端口 3100 关闭、pid 文件已删 ✅
5. **④ EIA** `启动EIA-V4.bat`：
   - 修复前第 20 行「意外的 }」：ps1 无 BOM，第 2/6/19 行中文注释字节数为奇（59/41/17B），GBK 解码后注释吞掉 `\n` 使后续代码并入注释。
   - 修复后（BOM + 原内容零改动）：第 1 行字节 `EF BB BF 23 20 45 49 41`（BOM + `# EIA`）✅；`[scriptblock]::Create` PARSE_OK ✅；`-File` 实测运行日志**零错误** ✅；8002 health `{"status":"ok","version":"4.0.0"}` ✅；服务按链路重启（PID 57724→37592→16476），浏览器已打开 ✅
6. **⑤ Codex.cmd**：EncodedCommand 解码核验——TcpClient 7892 探测（300ms）→ 连通设 HTTP_PROXY/HTTPS_PROXY → Start-Process Codex 应用（AppsFolder 协议）。逻辑自洽；未启动 GUI。
7. **残留清理**：3000/3100 无测试监听残留；`data/` 无残留 pid 文件；EIA 8002 为快捷方式正常启动态（预期用户状态）。
8. **回归**：通用版项目服务端零改动除 listen 守卫；selfcheck 26 项断言全过。

## 验证记录 · 第八轮（2026-08-12）

1. **ICO 结构字节级核验**：generic.ico 共 23460 字节 = 头(70) + 16px@70(1128) + 32px@1198(4264) + 48px@5462(9640) + 256PNG@15102(8358)；BMP 头（`28 00 00 00`）首现于 70、PNG 魔数位于 15102，与目录区声明逐一吻合 ✅
2. **可加载性**：`System.Drawing.Icon` 构造 6/6 成功；`ExtractAssociatedIcon`（Shell 层）对 6 个 .lnk 全部解析出 32x32 图标 → Explorer 显示链路通 ✅
3. **像素断言**（无法看图，改确定性断言）：圆角外 (4,4) 全透明 a0 6/6；顶/底渐变值符合品牌色（如 generic 顶 (56,87,212)→底 (50,79,199)）；background 月牙 (180,95)=255 白、(225,47)=渐变非白（挖洞正确）；stop 中心纯白；文字白色像素命中（eia-E、codex-x），其余采样点落在字形镂空/字距处属正常 ✅
4. **原脚本隐藏**：6/6 = `Hidden, Archive`（attrib 实测）；.lnk 指向隐藏目标可正常执行 ✅
5. **端到端实测**：`AI求职Agent-通用版.lnk` → 3000 `{"ok":true}`（测试后清理）；`AI求职Agent-通用版-后台.lnk` → 3100 `{"ok":true}` + `data/server.pid`=28924（与监听 PID 一致）→ `停止通用版AI求职Agent.lnk` → 3100 关闭 + pid 文件删除 ✅（可见版启动器不写 pid 文件，停止脚本只服务后台版——设计如此，非缺陷）
6. **回归**：通用版/EIA 项目代码零改动；原 6 脚本内容零改动（仅属性）；桌面其余文件未动。

## 决策记录（DECISIONS 摘要）

- **决策**：总分与 recommend 由服务端代码重算，覆盖模型输出。
- **理由**：权重/阈值是确定性输入，纯计算应代码层实现（CLAUDE.md 第 8 条），且模型算术有幻觉风险。
- **放弃的替代方案**：信任模型返回的 overall_score（不可控、不可复现）。

- **决策（第十轮）**：rank 并发默认 2（`RANK_CONCURRENCY` 可调）+ 传输层重试 1 次（退避 1s，429/4xx 不重试）+ 评估 maxTokens 2048→4096。
- **理由**：并发直接缩短批评估墙钟（实测 2 条并行 44s ≈ 单条 48s，串行需 ~90s+）；重试提升网络抖动下成功率且不放大限流（429 除外）；截断是「JSON 不可解析」重试的头号原因（实测两次 out=2048 顶满 → 502），4096 与 tailor/interview 一致。
- **数据支撑**：第十轮验证记录（evaluate 86.9s/502 → 47.8s/200；rank 2JD 44s/2 LLM；selfcheck 路由冒烟注入 fetch 故障确定性验证重试与隔离）。
- **放弃的替代方案**：默认并发 4（上游限流风险）、全错误类型重试（429 重试会放大压力，故显式排除）、P3 三项——画像版本号（触发条件未到，等 schema 真变更时随变更落地）、结果缓存（同 JD+同画像复评低频且诚实约束要标「复用日期」，ROI 为负）、协议统一（两路径无实际故障，前置条件 GLM anthropic 端点支持图像未验证）。
- **结果**：已实施并验证（见第十轮记录）；剩余手动回归 5 项待用户确认。
