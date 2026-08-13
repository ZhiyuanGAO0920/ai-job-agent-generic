# 默认画像模板（profile/default-profile.json）

首次启动「我的画像」向导时，会加载本文件作为初始值。你可以把它改成团队 / 组织级的默认画像。

## 字段说明
- `name` / `city` / `education` / `contact`：基本信息
- `targetRoles` / `industries`：目标岗位与行业
- `resume`：简历正文（真实、完整）
- `knowledge`：补充资料数组，每项 `{ id, title, content }`
- `hardPrefs` / `redLines` / `narrative`：求职硬偏好 / 风险红线 / 职业叙事
- `scoring`：`{ weights:{skill,experience,industry,growth}, threshold }`，权重后端会自动归一化
- `functionPreset`：职能预设名（通用 / 技术 / 产品 / 运营 / 设计）

## 行为
用户保存后画像存于浏览器 localStorage，互不影响；本文件仅作为"首次打开"的默认值。也可通过 GET `/api/profile` 读取本文件。
