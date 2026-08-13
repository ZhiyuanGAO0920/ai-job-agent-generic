# /rank — 批量评分 shortlist

## 用法

```text
/rank              # 评估 jds/ 目录下所有 JD
/rank <文件夹>     # 评估指定文件夹下的 JD
```

## 执行步骤

1. 扫描目标目录下所有 `.md` / `.txt` JD 文件。
2. 对每个 JD 并行执行 `/evaluate` 的硬过滤 + 四维评分逻辑。
3. **Deal-breakers veto**：硬过滤命中 `BLOCKED` 的直接进"排除区"，不计入排名。
4. **排序**：按总分降序，生成 ranked shortlist。
5. **附加信号**：
   - 截止日近的标 `URGENT`
   - dead posting（已过期）标 `EXPIRED`
   - 风险 flag 一并展示
6. **输出**：返回表格（公司 / 岗位 / 总分 / 推荐 / 风险），并移交 `/tailor` 处理高分项。

## 输出格式

```markdown
## Ranked Shortlist（共 N 个，排除 M 个）

| # | 公司 | 岗位 | 总分 | 推荐 | 风险 |
|---|---|---|---|---|---|
| 1 | ... | ... | 4.6 | 强推 | - |
| 2 | ... | ... | 4.1 | 可投 | LOCATION_RISK |

### 排除区（命中硬过滤）
- <公司/岗位>：<BLOCKED 原因>
```

## 约束

- 批量也不自动投递，仅排序 + 建议。
- 每个进入 shortlist 的 JD 保留四维明细，供后续 `/tailor` 引用。
