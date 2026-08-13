// ============================================================
// AI 求职 Agent · 前端逻辑
// 示例模式：纯前端渲染内置 SAMPLE_RESULT（无 Key 预览用）
// 真实模式：POST /api/evaluate 调本地 Node 代理
// 批量模式：POST /api/rank 批量评估 + 排序 + 勾选定制
// 档案模式：localStorage / 服务端双持久化，管理投递状态
// ============================================================

const $ = (sel, root) => (root || document).querySelector(sel);

const els = {
  jd: $("#jd-input"),
  ocrBtn: $("#ocr-btn"),
  ocrFile: $("#ocr-file"),
  ocrStatus: $("#ocr-status"),
  batchJd: $("#batch-jd-input"),
  resume: $("#resume-input"),
  model: $("#model-select"),
  singleInput: $("#single-input"),
  batchInput: $("#batch-input"),
  inputPanel: $(".input-panel"),
  resumeWrap: $("#resume-wrap"),
  linkWrap: $("#link-wrap"),
  linkInput: $("#link-input"),
  modelConfig: $("#model-config"),
  btn: $("#evaluate-btn"),
  status: $("#status-line"),
  empty: $("#empty-state"),
  result: $("#result-content"),
  tailorContent: $("#tailor-content"),
  interviewContent: $("#interview-content"),
  batchContent: $("#batch-content"),
  batchTable: $("#batch-table"),
  batchDetail: $("#batch-detail"),
  archiveContent: $("#archive-content"),
  archiveStats: $("#archive-stats"),
  archiveList: $("#archive-list"),
  archiveDetail: $("#archive-detail"),
  exportJson: $("#export-json"),
  importJson: $("#import-json"),
  importFile: $("#import-file"),
};

let currentMode = "live";
let lastTailorJd = "";
let lastBatch = [];

// ============ 持久化层（localStorage / 服务端双写） ============
const STORE_KEY = "aijob_records_v1";
const STATUS_META = {
  candidate: { label: "候选", cls: "st-candidate" },
  applied:   { label: "已投", cls: "st-applied" },
  interview: { label: "面试", cls: "st-interview" },
  offer:     { label: "Offer", cls: "st-offer" },
  rejected:  { label: "拒信", cls: "st-rejected" },
  nofit:     { label: "不投", cls: "st-nofit" },
};
const STATUS_ORDER = ["candidate", "applied", "interview", "offer", "rejected", "nofit"];

let storeMode = null; // 'server' | 'local' | null(未定)

async function detectStore() {
  if (storeMode) return storeMode;
  try {
    const r = await fetch("/api/health", { method: "GET" });
    storeMode = r.ok ? "server" : "local";
  } catch {
    storeMode = "local";
  }
  return storeMode;
}
function localLoad() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
}
function localSave(list) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch { /* 配额或隐私模式 */ }
}
async function loadRecords() {
  await detectStore();
  if (storeMode === "server") {
    try { const r = await fetch("/api/records"); const d = await r.json(); return d.records || []; }
    catch { storeMode = "local"; return localLoad(); }
  }
  return localLoad();
}
async function persistRecords(list) {
  if (storeMode === "server") {
    try {
      await fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: list }),
      });
      return;
    } catch { storeMode = "local"; }
  }
  localSave(list);
}
function genId() { return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function normJd(jd) { return (jd || "").replace(/\s+/g, " ").trim(); }
function findRec(list, jd) { const n = normJd(jd); return list.find((r) => normJd(r.jd) === n); }
// 是否建议投递：优先信任后端确定性重算的 recommend；旧数据缺失时按后端回传阈值兜底
function isGo(r) {
  return r.recommend === true || (r.recommend == null && (r.overall_score ?? 0) >= (r.threshold ?? 4.0));
}

async function upsertEval(data, link) {
  const list = await loadRecords();
  const jd = data.jd || "";
  const ev = {
    job_title: data.job_title, company: data.company, overall_score: data.overall_score,
    recommend: data.recommend, threshold: data.threshold, dimensions: data.dimensions || [],
    risks: data.risks || [], summary: data.summary, model: data.model,
  };
  let rec = findRec(list, jd);
  if (rec) {
    rec.jobTitle = rec.jobTitle || ev.job_title;
    rec.company = rec.company || ev.company;
    rec.eval = ev; rec.updatedAt = Date.now();
  } else {
    rec = {
      id: genId(), createdAt: Date.now(), updatedAt: Date.now(),
      jobTitle: ev.job_title || "未命名岗位", company: ev.company || "",
      jd, eval: ev, tailor: null, interview: null,
      status: "candidate", appliedAt: null, link: "", notes: "",
    };
    list.unshift(rec);
  }
  if (link) rec.link = link; // 投递链接：评估时填写则直接存入档案
  await persistRecords(list);
  return rec;
}
async function attachTailor(jd, data) {
  const list = await loadRecords();
  let rec = findRec(list, jd);
  if (!rec) {
    rec = {
      id: genId(), createdAt: Date.now(), updatedAt: Date.now(),
      jobTitle: data.job_title || "未命名岗位", company: "", jd,
      eval: null, tailor: null, interview: null,
      status: "candidate", appliedAt: null, link: "", notes: "",
    };
    list.unshift(rec);
  }
  rec.tailor = {
    job_title: data.job_title, tailored_resume: data.tailored_resume,
    keywords: data.keywords, coverage: data.coverage, honesty_notes: data.honesty_notes,
    checklist: data.checklist, summary: data.summary, model: data.model,
  };
  rec.updatedAt = Date.now();
  await persistRecords(list);
  return rec;
}
async function attachInterview(jd, data) {
  const list = await loadRecords();
  let rec = findRec(list, jd);
  if (!rec) {
    rec = {
      id: genId(), createdAt: Date.now(), updatedAt: Date.now(),
      jobTitle: data.job_title || "未命名岗位", company: "", jd,
      eval: null, tailor: null, interview: null,
      status: "candidate", appliedAt: null, link: "", notes: "",
    };
    list.unshift(rec);
  }
  rec.interview = {
    job_title: data.job_title, questions: data.questions, weakness_prep: data.weakness_prep,
    ask_interviewer: data.ask_interviewer, summary: data.summary, model: data.model,
  };
  rec.updatedAt = Date.now();
  await persistRecords(list);
  return rec;
}
async function updateRecordStatus(id, status) {
  const list = await loadRecords();
  const r = list.find((x) => x.id === id);
  if (r) {
    r.status = status;
    if (status === "applied" && !r.appliedAt) r.appliedAt = Date.now();
    r.updatedAt = Date.now();
    await persistRecords(list);
  }
}
async function deleteRecord(id) {
  const list = await loadRecords();
  await persistRecords(list.filter((x) => x.id !== id));
}
async function importRecords(records) {
  const list = await loadRecords();
  records.forEach((nr) => { if (nr && nr.id && !list.find((x) => x.id === nr.id)) list.unshift(nr); });
  await persistRecords(list);
}

// ---- 模式切换 ----
function setMode(mode) {
  const btn = document.querySelector(`.mode-btn[data-mode="${mode}"]`);
  if (!btn) return;
  document.querySelectorAll(".mode-btn").forEach((x) => {
    x.classList.remove("active");
    x.setAttribute("aria-selected", "false"); // 键盘导航（ARIA tabs）：仅当前项可 Tab 聚焦
    x.tabIndex = -1;
  });
  btn.classList.add("active");
  btn.setAttribute("aria-selected", "true");
  btn.tabIndex = 0;
  currentMode = mode;
  const useSingle = mode === "live" || mode === "tailor" || mode === "interview";
  const isArchive = mode === "archive";
  const isSample = mode === "sample";
  els.singleInput.classList.toggle("hidden", !useSingle);
  els.batchInput.classList.toggle("hidden", mode !== "batch");
  els.resumeWrap.classList.toggle("hidden", isSample || isArchive);
  els.linkWrap.classList.toggle("hidden", mode !== "live");
  els.modelConfig.classList.toggle("hidden", isSample || isArchive);
  els.btn.classList.toggle("hidden", isArchive);
  // 档案模式只做管理：隐藏整个输入面板，结果区占满（布局见 CSS body.mode-archive）
  els.inputPanel.classList.toggle("hidden", isArchive);
  document.body.classList.toggle("mode-archive", isArchive);
  els.status.textContent = "";
  if (isArchive) renderArchive();
}

document.querySelectorAll(".mode-btn").forEach((b) => {
  b.addEventListener("click", () => setMode(b.dataset.mode));
});

// 键盘导航：←/→ 在模式间循环切换（并同步焦点，Home/End 直达首尾）
const modeOrder = ["live", "tailor", "batch", "interview", "archive", "sample"];
document.querySelector(".mode-switch").addEventListener("keydown", (e) => {
  const keys = { ArrowRight: 1, ArrowLeft: -1, Home: -99, End: 99 };
  const step = keys[e.key];
  if (!step) return;
  e.preventDefault();
  let idx = modeOrder.indexOf(currentMode);
  if (e.key === "Home") idx = 0;
  else if (e.key === "End") idx = modeOrder.length - 1;
  else idx = (idx + step + modeOrder.length) % modeOrder.length;
  const next = document.querySelector(`.mode-btn[data-mode="${modeOrder[idx]}"]`);
  setMode(next.dataset.mode);
  next.focus();
});

// ---- 画像系统接入（通用版） ----
function getActivePayload() {
  return Profile.buildPayload(Profile.get());
}
function getResumeForRequest() {
  const override = els.resume.value.trim();
  if (override) return override;
  return getActivePayload().resume || "";
}
function updateProfileChip() {
  const chip = document.getElementById("profile-chip");
  if (!chip) return;
  if (Profile.hasProfile()) {
    const p = Profile.get();
    chip.textContent = "已设置：" + (p.name || "我的画像");
    chip.classList.add("set");
  } else {
    chip.textContent = "未设置 · 点此填写";
    chip.classList.remove("set");
  }
}
function bindProfile() {
  const btn = document.getElementById("profile-btn");
  if (btn) btn.addEventListener("click", () => Profile.openWizard());
  Profile.onSaved(updateProfileChip);
  updateProfileChip();
}
// 真实评分前确保有画像；无则打开向导并返回 false
function ensureProfileForReal() {
  if (Profile.hasProfile() || els.resume.value.trim()) return true;
  els.status.textContent = "请先点右上角「👤 我的画像」填写你的信息，或使用「载入示例」。";
  Profile.openWizard();
  return false;
}

// ---- 主入口 ----
els.btn.addEventListener("click", async () => {
  if (currentMode === "sample") {
    if (!els.jd.value.trim()) els.jd.value = SAMPLE_JD;
    renderSingle(SAMPLE_RESULT);
    els.status.textContent = "示例模式 · 已加载内置评估结果。";
    return;
  }
  if (currentMode === "live") {
    const jd = els.jd.value.trim();
    if (!jd) { els.status.textContent = "请先粘贴岗位 JD。"; return; }
    await runLive(jd);
    return;
  }
  if (currentMode === "tailor") {
    if (!els.jd.value.trim()) {
      // 真实模式（server 存档）下不允许用示例 JD 占位——示例内容不是真实岗位
      if (storeMode === "server") { els.status.textContent = "请先粘贴岗位 JD（真实模式不支持示例 JD 占位）。"; return; }
      els.jd.value = SAMPLE_JD;
    }
    await runTailor(els.jd.value.trim());
    return;
  }
  if (currentMode === "interview") {
    if (!els.jd.value.trim()) {
      if (storeMode === "server") { els.status.textContent = "请先粘贴岗位 JD（真实模式不支持示例 JD 占位）。"; return; }
      els.jd.value = SAMPLE_JD;
    }
    await runInterview(els.jd.value.trim());
    return;
  }
  if (currentMode === "batch") {
    const raw = els.batchJd.value.trim();
    if (!raw) { els.status.textContent = "请粘贴至少一个岗位 JD（用 === 分隔多个）。"; return; }
    const jds = raw.split(/===+/).map((s) => s.trim()).filter(Boolean);
    if (jds.length === 0) { els.status.textContent = "未解析到有效 JD。"; return; }
    await runBatch(jds);
    return;
  }
});

// ---- 真实单岗位 ----
async function runLive(jd) {
  if (!ensureProfileForReal()) return;
  els.btn.disabled = true;
  els.status.textContent = "正在调用大模型评估……（通常 15–40 秒）";
  try {
    const pl = getActivePayload();
    const body = { jd, resume: getResumeForRequest(), model: els.model.value, knowledge: pl.knowledge, careerGoal: pl.careerGoal, scoring: pl.scoring };
    const resp = await fetch("/api/evaluate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `服务端返回 ${resp.status}`);
    data.jd = jd; // 回填 JD，供单岗位详情「定制简历」联动
    renderSingle(data);
    const rec = await upsertEval(data, els.linkInput.value.trim() || undefined);
    els.status.textContent = `真实评分完成 · 已存入档案（${STATUS_META[rec.status].label}） · 模型：${data.model || els.model.value}`;
  } catch (err) {
    els.status.textContent = "⚠️ " + err.message;
  } finally {
    els.btn.disabled = false;
  }
}

// ---- 批量排序 ----
async function runBatch(jds) {
  if (!ensureProfileForReal()) return;
  els.btn.disabled = true;
  els.status.textContent = `正在批量评估 ${jds.length} 个岗位（串行调用，请耐心等待）……`;
  try {
    const pl = getActivePayload();
    const body = { jds, resume: getResumeForRequest(), model: els.model.value, knowledge: pl.knowledge, careerGoal: pl.careerGoal, scoring: pl.scoring };
    const resp = await fetch("/api/rank", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `服务端返回 ${resp.status}`);
    renderBatch(data.results || []);
    els.status.textContent = `批量评估完成 · 共 ${data.results.length} 个岗位 · 模型：${data.model || els.model.value}（勾选后可批量定制简历）`;
  } catch (err) {
    els.status.textContent = "⚠️ " + err.message;
  } finally {
    els.btn.disabled = false;
  }
}

function renderBatch(results) {
  lastBatch = results;
  els.empty.classList.add("hidden");
  els.result.classList.add("hidden");
  els.tailorContent.classList.add("hidden");
  els.interviewContent.classList.add("hidden");
  els.batchContent.classList.remove("hidden");

  const bar = $("#batch-tailor-bar");
  if (bar) bar.classList.remove("hidden");
  const expBtn = $("#batch-export-csv");
  if (expBtn) expBtn.onclick = exportBatchCsv;

  const rows = results
    .map((r) => {
      const go = isGo(r);
      const riskMini = (r.risks || [])
        .map((x) => `<span class="risk-mini"><span class="dot ${x.level || "yellow"}"></span>${esc(x.title)}</span>`)
        .join("");
      const err = r.error ? `<span style="color:var(--danger)">⚠ ${esc(r.error)}</span>` : "";
      const chk = !r.error ? `<input type="checkbox" class="bt-check" data-rank="${r.rank}" ${go ? "checked" : ""}/>` : "";
      const saveBtn = r.jd && !r.error ? `<button class="mini-action arc-save" data-rank="${r.rank}">存入候选</button>` : "";
      const op = go
        ? `<button class="mini-action" data-rank="${r.rank}">定制简历</button>`
        : `<span class="op-disabled">不推荐</span>`;
      return `<tr data-rank="${r.rank}">
        <td class="bt-check-cell">${chk}</td>
        <td class="rank-num">${r.rank}</td>
        <td><div class="job-title" style="font-size:14px">${esc(r.job_title || "—")}</div><div class="job-company">${esc(r.company || "")}</div>${err}</td>
        <td class="rank-score">${(r.overall_score ?? 0).toFixed(1)}<div class="mini">/5.0</div></td>
        <td>${go ? '<span class="tag-go">投</span>' : '<span class="tag-no">弃</span>'}</td>
        <td>${riskMini || "—"}</td>
        <td>${saveBtn}</td>
        <td>${op}</td>
      </tr>`;
    })
    .join("");

  els.batchTable.innerHTML = `<table class="rank-table">
    <thead><tr><th>选</th><th>#</th><th>岗位 / 公司</th><th>总分</th><th>建议</th><th>风险</th><th>存档</th><th>操作</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
  els.batchDetail.innerHTML = "";

  els.batchTable.querySelectorAll("tbody tr").forEach((tr) => {
    tr.addEventListener("click", () => {
      els.batchTable.querySelectorAll("tr").forEach((x) => x.classList.remove("selected"));
      tr.classList.add("selected");
      const r = results.find((x) => String(x.rank) === tr.dataset.rank);
      els.batchDetail.innerHTML = buildDetailHTML(r);
      if (r.jd && isGo(r)) {
        const b = document.createElement("button");
        b.className = "tailor-jump";
        b.textContent = "📝 据此 JD 一键定制简历";
        b.addEventListener("click", () => goTailor(r.jd));
        els.batchDetail.prepend(b);
      }
    });
  });

  els.batchTable.querySelectorAll("button.mini-action:not(.arc-save)").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = results.find((x) => String(x.rank) === btn.dataset.rank);
      if (r && r.jd) goTailor(r.jd);
    });
  });

  els.batchTable.querySelectorAll(".arc-save").forEach((b) => {
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const r = results.find((x) => String(x.rank) === b.dataset.rank);
      if (r && r.jd) {
        await upsertEval(r);
        b.textContent = "✓ 已存";
        b.disabled = true;
        els.status.textContent = "已存入档案（候选）。";
      }
    });
  });

  const tbtn = $("#batch-tailor-btn");
  if (tbtn) {
    tbtn.onclick = () => {
      const checked = [...els.batchTable.querySelectorAll(".bt-check:checked")].map((c) => c.dataset.rank);
      const jds = results.filter((r) => checked.includes(String(r.rank)) && r.jd && !r.error).map((r) => r.jd);
      runBatchTailor(jds);
    };
  }
}

// ---- 批量定制简历 ----
async function runBatchTailor(jds) {
  if (!jds.length) { els.status.textContent = "请先勾选要定制的岗位。"; return; }
  if (!confirm(`确认对 ${jds.length} 个岗位批量生成定制简历？\n将调用 ${jds.length} 次大模型（约 ${jds.length * 30} 秒，成本约 ${jds.length} 次 API 调用）。`)) return;
  const pl = getActivePayload();
  const prog = $("#batch-tailor-progress");
  let done = 0, fail = 0;
  if (prog) prog.textContent = `批量定制中 0/${jds.length}……`;
  for (const jd of jds) {
    try {
      const body = { jd, resume: getResumeForRequest(), model: els.model.value, knowledge: pl.knowledge, careerGoal: pl.careerGoal, scoring: pl.scoring };
      const resp = await fetch("/api/tailor", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || resp.status);
      await attachTailor(jd, data);
      done++;
    } catch (e) { fail++; }
    if (prog) prog.textContent = `批量定制中 ${done + fail}/${jds.length}（成功 ${done}，失败 ${fail}）……`;
  }
  if (prog) prog.textContent = `批量定制完成：成功 ${done}，失败 ${fail}。结果已存入档案，可在「档案·投递」查看。`;
}

function renderSingle(r) {
  els.empty.classList.add("hidden");
  els.batchContent.classList.add("hidden");
  els.result.classList.remove("hidden");
  els.result.innerHTML = sampleBadge() + buildDetailHTML(r);
  if (r.jd) {
    const btn = document.createElement("button");
    btn.className = "tailor-jump";
    btn.textContent = "📝 据此 JD 一键定制简历";
    btn.addEventListener("click", () => goTailor(r.jd));
    els.result.prepend(btn);
  }
}

// 示例模式角标：让「内置示例」与「真实产出」一眼可辨（防误把示例当真实评估结果）
function sampleBadge() {
  return currentMode === "sample" ? `<div class="sample-badge">示例数据 · 非真实评估</div>` : "";
}

// ---- 批量排序 → 导出 CSV（表头对齐 job_search_tracker.csv，可直接续用追踪） ----
function exportBatchCsv() {
  if (!lastBatch.length) { els.status.textContent = "暂无批量结果可导出。"; return; }
  const HEAD = ["公司", "岗位", "来源URL", "投递时间", "匹配总分", "推荐", "风险flag", "状态", "下一步动作", "备注"];
  const csvEsc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = lastBatch.map((r) => [
    r.company || "", r.job_title || "", "", "",
    r.overall_score ?? "",
    isGo(r) ? "推荐" : "不推荐",
    (r.risks || []).map((x) => `${x.level}:${x.title}`).join("|"),
    "", "", "",
  ].map(csvEsc).join(","));
  // BOM 前缀保证 Excel 打开中文不乱码
  const csv = "﻿" + [HEAD.join(","), ...rows].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `岗位排序_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---- 简历定制 ----
async function runTailor(jd) {
  lastTailorJd = jd || SAMPLE_JD;
  if (!ensureProfileForReal()) return;
  els.btn.disabled = true;
  els.status.textContent = "正在调用大模型生成定制简历……（通常 25–50 秒）";
  try {
    const pl = getActivePayload();
    const body = { jd, resume: getResumeForRequest(), model: els.model.value, knowledge: pl.knowledge, careerGoal: pl.careerGoal, scoring: pl.scoring };
    const resp = await fetch("/api/tailor", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `服务端返回 ${resp.status}`);
    renderTailor(data);
    await attachTailor(jd, data);
    els.status.textContent = `定制简历完成 · 已存入档案 · 模型：${data.model || els.model.value}`;
  } catch (err) {
    els.status.textContent = "⚠️ " + err.message;
  } finally {
    els.btn.disabled = false;
  }
}

function renderTailor(r) {
  els.empty.classList.add("hidden");
  els.result.classList.add("hidden");
  els.batchContent.classList.add("hidden");
  els.interviewContent.classList.add("hidden");
  els.tailorContent.classList.remove("hidden");
  els.tailorContent.innerHTML = sampleBadge() + buildTailorHTML(r);
  bindTailorActions(els.tailorContent, r, lastTailorJd);
}

function buildTailorHTML(r) {
  const resumeHtml = mdToHtml(r.tailored_resume || "（模型未返回简历正文）");
  const cov = (r.coverage || [])
    .map(
      (c) => `<li class="cov-item ${c.covered ? "yes" : "no"}">
        <span class="cov-dot"></span>
        <span><span class="cov-kw">${esc(c.keyword)}</span><span class="cov-note">${esc(c.note || "")}</span></span>
      </li>`
    )
    .join("");
  const honest = (r.honesty_notes || []).length
    ? (r.honesty_notes || []).map((h) => `<li class="honest-item">⚠ ${esc(h)}</li>`).join("")
    : `<li class="honest-item muted">无明确缺口，所有 JD 要求均有真实经历支撑。</li>`;
  const checks = (r.checklist || [])
    .map(
      (c) => `<li class="chk-item ${c.pass ? "pass" : "fail"}">
        <span class="chk-mark">${c.pass ? "✓" : "✕"}</span><span>${esc(c.item)}</span>
      </li>`
    )
    .join("");
  return `
    <div class="tailor-head">
      <h2 class="panel-title">📝 定制简历 · ${esc(r.job_title || "目标岗位")}</h2>
      <div class="tailor-actions">
        <button id="copy-resume" class="ghost-btn">复制 Markdown</button>
        <button id="download-resume" class="ghost-btn">下载 .md</button>
        <button id="export-pdf" class="ghost-btn primary-ghost">导出 PDF 终稿</button>
        <button id="ats-check" class="ghost-btn">🔍 ATS 校验</button>
      </div>
    </div>
    <div class="resume-preview">${resumeHtml}</div>
    <div class="block"><h3 class="block-title">🎯 关键词覆盖 <span class="block-sub">绿=真实经历可追溯 / 红=诚实标注缺口</span></h3><ul class="cov-list">${cov}</ul></div>
    <div class="block"><h3 class="block-title">🛡️ 诚实边界（Honesty Rule）</h3><ul class="honest-list">${honest}</ul></div>
    <div class="block"><h3 class="block-title">✅ ATS / 完整性自检</h3><ul class="chk-list">${checks}</ul></div>
    <div class="summary-box">${esc(r.summary || "")}</div>
    <div id="ats-result" class="ats-result hidden"></div>
    <div class="tailor-actions" style="margin-top:14px"><button id="gen-interview" class="ghost-btn">🎤 生成模拟面试</button></div>
  `;
}

function bindTailorActions(container, r, jd) {
  const md = r.tailored_resume || "";
  const cp = $("#copy-resume", container);
  if (cp) cp.addEventListener("click", () =>
    navigator.clipboard.writeText(md).then(
      () => (els.status.textContent = "已复制 Markdown 到剪贴板。"),
      () => (els.status.textContent = "复制失败，请手动选择文本。")
    )
  );
  const dl = $("#download-resume", container);
  if (dl) dl.addEventListener("click", () => {
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `定制简历_${r.job_title || "target"}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  const pdf = $("#export-pdf", container);
  if (pdf) pdf.addEventListener("click", () => exportPdf(r));
  const ats = $("#ats-check", container);
  if (ats) ats.addEventListener("click", () => runAts(jd || lastTailorJd, r.tailored_resume || ""));
  const gi = $("#gen-interview", container);
  if (gi) gi.addEventListener("click", () => goInterview(lastTailorJd, r.tailored_resume || ""));
}

// ---- 排序 / 评估 → 定制 联动 ----
async function goTailor(jd) {
  if (!jd || !jd.trim()) { els.status.textContent = "该岗位缺少 JD 文本，无法联动定制。"; return; }
  // 示例模式：联动也只出示例结果，绝不误触真实 API（与 goInterview 的示例守卫对齐）
  if (currentMode === "sample") {
    renderTailor(SAMPLE_TAILOR_RESULT);
    els.status.textContent = "示例模式 · 已加载定制简历示例。";
    return;
  }
  setMode("tailor");
  els.jd.value = jd;
  els.status.textContent = "已带入岗位 JD，正在生成定制简历……";
  await runTailor(jd);
}

// ---- 面试准备 ----
async function runInterview(jd, resumeOverride) {
  if (currentMode === "sample") {
    renderInterview(SAMPLE_INTERVIEW_RESULT);
    els.status.textContent = "示例模式 · 已加载模拟面试示例。";
    return;
  }
  if (!ensureProfileForReal()) return;
  els.btn.disabled = true;
  els.status.textContent = "正在调用大模型生成模拟面试……（通常 25–50 秒）";
  try {
    const pl = getActivePayload();
    const body = { jd, resume: resumeOverride || getResumeForRequest(), model: els.model.value, knowledge: pl.knowledge, careerGoal: pl.careerGoal, scoring: pl.scoring };
    const resp = await fetch("/api/interview", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `服务端返回 ${resp.status}`);
    renderInterview(data);
    await attachInterview(jd, data);
    els.status.textContent = `模拟面试生成完成 · 已存入档案 · 模型：${data.model || els.model.value}`;
  } catch (err) {
    els.status.textContent = "⚠️ " + err.message;
  } finally {
    els.btn.disabled = false;
  }
}

function buildInterviewHTML(r) {
  const qHtml = (r.questions || [])
    .map((q) => {
      const pts = (q.points || []).map((p) => `<li>${esc(p)}</li>`).join("");
      const ev = q.evidence
        ? `<div class="iv-evidence"><span class="iv-ev-label">真实证据</span>${esc(q.evidence)}</div>`
        : "";
      const diffClass = q.difficulty === "压力" ? "diff-hard" : q.difficulty === "高频" ? "diff-hot" : "diff-mid";
      return `<div class="iv-card">
        <div class="iv-card-head">
          <span class="iv-cat">${esc(q.category)}</span>
          <span class="iv-diff ${diffClass}">${esc(q.difficulty || "中频")}</span>
        </div>
        <div class="iv-question">${esc(q.question)}</div>
        <div class="iv-intent"><b>考察意图：</b>${esc(q.intent || "—")}</div>
        <div class="iv-points-title">参考回答要点</div>
        <ul class="iv-points">${pts}</ul>
        ${ev}
      </div>`;
    })
    .join("");
  const weak = (r.weakness_prep || []).map((w) => `<li>${esc(w)}</li>`).join("");
  const ask = (r.ask_interviewer || []).map((a) => `<li>${esc(a)}</li>`).join("");
  return `
    <div class="interview-head">
      <h2 class="panel-title">🎤 模拟面试 · ${esc(r.job_title || "目标岗位")}</h2>
    </div>
    <div class="iv-grid">${qHtml}</div>
    <div class="block"><h3 class="block-title">🛡️ 短板应对话术</h3><ul class="iv-weak">${weak}</ul></div>
    <div class="block"><h3 class="block-title">🔁 建议反问面试官</h3><ul class="iv-ask">${ask}</ul></div>
    <div class="summary-box">${esc(r.summary || "")}</div>
  `;
}

function renderInterview(r) {
  els.empty.classList.add("hidden");
  els.result.classList.add("hidden");
  els.batchContent.classList.add("hidden");
  els.tailorContent.classList.add("hidden");
  els.interviewContent.classList.remove("hidden");
  els.interviewContent.innerHTML = sampleBadge() + buildInterviewHTML(r);
}

// ---- 简历定制 → 面试准备 联动 ----
async function goInterview(jd, resume) {
  jd = jd || SAMPLE_JD;
  if (currentMode === "sample") {
    renderInterview(SAMPLE_INTERVIEW_RESULT);
    els.status.textContent = "示例模式 · 已加载模拟面试示例。";
    return;
  }
  setMode("interview");
  els.jd.value = jd;
  els.status.textContent = "已带入岗位 JD，正在生成模拟面试……";
  await runInterview(jd, resume);
}

// ---- 极简 Markdown -> HTML ----
function mdToHtml(md) {
  const lines = String(md || "").split("\n");
  let html = "";
  let inList = false;
  const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inline(esc(line.replace(/^\s*[-*]\s+/, "")))}</li>`;
      continue;
    }
    closeList();
    if (/^#{1,3}\s+/.test(line)) {
      const lvl = line.match(/^#+/)[0].length;
      const txt = inline(esc(line.replace(/^#{1,3}\s+/, "")));
      html += `<h${lvl} class="rm-h${lvl}">${txt}</h${lvl}>`;
      continue;
    }
    if (/^\s*-{3,}\s*$/.test(line)) { html += "<hr/>"; continue; }
    if (line.trim() === "") continue;
    html += `<p>${inline(esc(line))}</p>`;
  }
  closeList();
  return html;
}
function inline(s) { return s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"); }

// ---- 详情 HTML（单岗位 & 批量详情共用） ----
function buildDetailHTML(r) {
  const go = isGo(r);
  const thr = Number(r.threshold ?? 4.0);
  const badge = `<div class="recommend-badge ${go ? "go" : "no"}">${go ? "✓ 建议投递（≥ " + thr.toFixed(1) + "）" : "✕ 暂不推荐（< " + thr.toFixed(1) + "）"}</div>`;
  const dims = (r.dimensions || [])
    .map((d) => {
      const pct = Math.max(0, Math.min(100, (d.score / 5) * 100));
      return `<div class="bd-item">
        <span class="bd-name">${esc(d.name)}</span>
        <span class="bd-bar"><span class="bd-bar-fill" style="width:${pct}%"></span></span>
        <span class="bd-score">${d.score.toFixed(1)}</span>
        <span class="bd-weight">×${(d.weight * 100).toFixed(0)}%</span>
      </div>`;
    })
    .join("");
  const risks = (r.risks || [])
    .map(
      (x) => `<li class="risk-item ${x.level || "yellow"}">
        <span class="risk-dot"></span>
        <span><span class="risk-title">${esc(x.title)}</span><span class="risk-detail">${esc(x.detail)}</span></span>
      </li>`
    )
    .join("");
  const rats = (r.dimensions || [])
    .map(
      (d) => `<div class="rat-item">
        <div class="rat-head"><span>${esc(d.name)}</span><span class="rat-score">${d.score.toFixed(1)} / 5</span></div>
        <div class="rat-text">${esc(d.rationale || "—")}</div>
      </div>`
    )
    .join("");
  return `
    <div class="score-card">
      <div class="score-main"><div class="score-number">${(r.overall_score ?? 0).toFixed(1)}</div><div class="score-scale">/ 5.0</div></div>
      <div class="score-meta"><div class="job-title">${esc(r.job_title || "—")}</div><div class="job-company">${esc(r.company || "")}</div>${badge}</div>
    </div>
    <div class="viz-row">
      <div class="radar-wrap"><div class="radar">${buildRadar(r.dimensions || [])}</div></div>
      <div class="breakdown">${dims}</div>
    </div>
    <div class="block"><h3 class="block-title">⚠️ 独立风险块 <span class="block-sub">不计入总分，但影响决策</span></h3><ul class="risk-list">${risks}</ul></div>
    <div class="block"><h3 class="block-title">🔍 可解释评分理由</h3><div class="rationale-list">${rats}</div></div>
    <div class="summary-box">${esc(r.summary || "")}</div>
  `;
}

// ---- SVG 雷达图 ----
function buildRadar(dims) {
  const size = 280;
  const cx = size / 2;
  const cy = size / 2;
  const R = 100;
  // 空 dims（旧档案 / 异常数据）也不崩溃：按 4 轴画骨架，无数据时标签留空
  const n = Math.max(dims.length, 4);
  const angle = (i) => (-90 + (360 / n) * i) * (Math.PI / 180);
  const pt = (i, r) => [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];
  let svg = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">`;
  for (let g = 1; g <= 5; g++) {
    const r = (R * g) / 5;
    const pts = [];
    for (let i = 0; i < n; i++) pts.push(pt(i, r).map((v) => v.toFixed(1)).join(","));
    svg += `<polygon points="${pts.join(" ")}" fill="none" stroke="#e4e8f0" stroke-width="1"/>`;
  }
  for (let i = 0; i < n; i++) {
    const dim = dims[i];
    const [x, y] = pt(i, R);
    svg += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e4e8f0" stroke-width="1"/>`;
    const [lx, ly] = pt(i, R + 22);
    const anchor = Math.abs(lx - cx) < 5 ? "middle" : lx > cx ? "start" : "end";
    svg += `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${anchor}" font-size="12" font-weight="700" fill="#1f2733">${dim ? esc(dim.name) : ""}</text>`;
    svg += `<text x="${lx.toFixed(1)}" y="${(ly + 18).toFixed(1)}" text-anchor="${anchor}" font-size="11" fill="#5b6675">${dim ? dim.score.toFixed(1) : ""}</text>`;
  }
  if (dims.length) {
    const dpts = dims
      .map((d, i) => pt(i, (R * Math.max(0, Math.min(5, d.score))) / 5).map((v) => v.toFixed(1)).join(","))
      .join(" ");
    svg += `<polygon points="${dpts}" fill="rgba(59,91,219,0.22)" stroke="#3b5bdb" stroke-width="2.5"/>`;
    for (let i = 0; i < n; i++) {
      const [x, y] = pt(i, (R * Math.max(0, Math.min(5, dims[i].score))) / 5);
      svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="#3b5bdb"/>`;
    }
  }
  svg += `</svg>`;
  return svg;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ---- ATS 校验（校验定制简历的机器可解析度 + 关键词匹配） ----
async function runAts(jd, resume) {
  const box = $("#ats-result");
  if (!box) return;
  if (!jd || !jd.trim()) { els.status.textContent = "缺少 JD 文本，无法做 ATS 校验。"; return; }
  box.classList.remove("hidden");
  box.innerHTML = `<div class="ats-loading">正在校验 ATS 友好度与关键词匹配……（约 10–25 秒）</div>`;
  try {
    const body = { jd, resume, model: els.model.value };
    const resp = await fetch("/api/ats", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `服务端返回 ${resp.status}`);
    renderAts(data);
    els.status.textContent = `ATS 校验完成 · 友好度 ${data.ats_score ?? "—"}/100 · 关键词匹配 ${data.keyword_match ?? "—"}/100`;
  } catch (err) {
    box.innerHTML = `<div class="ats-error">⚠️ ${esc(err.message)}</div>`;
  }
}

function renderAts(r) {
  const box = $("#ats-result");
  if (!box) return;
  const cov = (r.covered_keywords || []).map((k) => `<span class="kw yes">${esc(k)}</span>`).join("");
  const miss = (r.missing_keywords || []).map((m) =>
    `<li class="kw-miss"><span class="kw-miss-k">${esc(m.keyword)}</span><span class="kw-miss-s">${esc(m.suggestion || "")}</span></li>`
  ).join("");
  const fmts = (r.format_issues || []).map((f) =>
    `<li class="fmt-item ${f.pass ? "pass" : "fail"}"><span class="fmt-mark">${f.pass ? "✓" : "✕"}</span><span><b>${esc(f.item || "")}</b> ${esc(f.suggestion || "")}</span></li>`
  ).join("");
  const sugs = (r.suggestions || []).map((s) => `<li>${esc(s)}</li>`).join("");
  box.innerHTML = `
    <div class="ats-head"><h3 class="block-title">🔍 ATS 校验结果</h3></div>
    <div class="ats-scores">
      <div class="ats-score-card"><div class="ats-score-num">${r.ats_score ?? "—"}</div><div class="ats-score-label">ATS 友好度</div></div>
      <div class="ats-score-card"><div class="ats-score-num">${r.keyword_match ?? "—"}</div><div class="ats-score-label">关键词匹配</div></div>
    </div>
    <div class="block"><h3 class="block-title">✅ 已覆盖关键词</h3><div class="kw-list">${cov || '<span class="muted">无</span>'}</div></div>
    <div class="block"><h3 class="block-title">⚠️ 缺失关键词（建议补充）</h3><ul class="kw-miss-list">${miss || '<li class="muted">无明显缺失</li>'}</ul></div>
    <div class="block"><h3 class="block-title">📐 格式 / 解析检查</h3><ul class="fmt-list">${fmts || '<li class="muted">无</li>'}</ul></div>
    <div class="block"><h3 class="block-title">💡 改进建议</h3><ul class="sug-list">${sugs || '<li class="muted">无</li>'}</ul></div>
    <div class="summary-box">${esc(r.summary || "")}</div>
  `;
}

// ---- 导出 ATS 友好 PDF 终稿 ----
function exportPdf(r) {
  const resumeHtml = mdToHtml(r.tailored_resume || "（模型未返回简历正文）");
  const jobTitle = r.job_title || "target";
  const docHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>简历_${esc(jobTitle)}</title>
<style>
  @page { margin: 15mm; }
  * { box-sizing: border-box; }
  body { font-family: "PingFang SC","Microsoft YaHei","Hiragino Sans GB",Arial,sans-serif; color:#14181f; font-size:10.5pt; line-height:1.62; margin:0; }
  h1 { font-size:19pt; font-weight:800; margin:0 0 3px; }
  h2 { font-size:12.5pt; font-weight:700; margin:15px 0 5px; border-bottom:1.5px solid #2b3340; padding-bottom:3px; color:#1b2330; }
  h3 { font-size:11pt; font-weight:700; margin:11px 0 3px; }
  p { margin:4px 0; }
  ul { margin:4px 0 4px 20px; padding:0; }
  li { margin:2.5px 0; }
  hr { border:none; border-top:1px solid #c4ccd6; margin:11px 0; }
  .footnote { margin-top:18px; font-size:8.5pt; color:#8a93a0; border-top:1px dashed #c4ccd6; padding-top:6px; }
</style>
</head>
<body>
${resumeHtml}
<div class="footnote">本简历由 AI 求职 Agent 生成 · 内容经候选人本人核对，遵循「诚实边界」原则，未虚构经历。</div>
<script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script>
</body>
</html>`;
  const w = window.open("", "_blank");
  if (w) {
    w.document.open();
    w.document.write(docHtml);
    w.document.close();
    return;
  }
  els.status.textContent = "⚠️ 浏览器拦截了弹窗，已改用后台打印（若未弹出，请允许本站点弹窗）。";
  const ifr = document.createElement("iframe");
  ifr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(ifr);
  const idoc = ifr.contentWindow.document;
  idoc.open();
  idoc.write(docHtml);
  idoc.close();
  ifr.contentWindow.focus();
  ifr.contentWindow.print();
}

// ============ 档案 · 投递面板 ============
function hideAllResults() {
  [els.result, els.tailorContent, els.interviewContent, els.batchContent].forEach((e) => e.classList.add("hidden"));
}

// 按投递状态统计档案数（renderArchive / refreshArchiveStats 共用，保持单一事实源）
function countByStatus(list) {
  const counts = {};
  STATUS_ORDER.forEach((s) => (counts[s] = 0));
  list.forEach((r) => { const s = r.status || "candidate"; counts[s] = (counts[s] || 0) + 1; });
  return counts;
}

async function renderArchive() {
  hideAllResults();
  els.archiveContent.classList.remove("hidden");
  const list = await loadRecords();
  const counts = countByStatus(list);
  els.archiveStats.innerHTML = STATUS_ORDER.map(
    (s) => `<div class="stat-chip ${STATUS_META[s].cls}"><span class="stat-num">${counts[s] || 0}</span><span class="stat-label">${STATUS_META[s].label}</span></div>`
  ).join("");

  if (!list.length) {
    els.archiveList.innerHTML =
      '<div class="empty-archive">还没有岗位档案。去「真实评分」或「批量排序」评估岗位，结果会自动存入这里；评估后可改投递状态、查看 / 导出。</div>';
    els.archiveDetail.classList.add("hidden");
    return;
  }
  const p = (f) => (f ? "✓" : "·");
  const followBadge = (r) => {
    if (r.status !== "applied" || !r.appliedAt) return "";
    const d = Math.floor((Date.now() - r.appliedAt) / 86400000);
    return `<div class="arc-follow ${d > 7 ? "overdue" : ""}">已投 ${d} 天${d > 7 ? " · 建议跟进" : ""}</div>`;
  };
  els.archiveList.innerHTML = list
    .map((r) => {
      const score = r.eval ? r.eval.overall_score.toFixed(1) : "—";
      const st = STATUS_META[r.status || "candidate"];
      const time = new Date(r.updatedAt || r.createdAt).toLocaleString("zh-CN", {
        month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      });
      return `<div class="arc-card" data-id="${r.id}">
        <div class="arc-main">
          <div class="arc-job">${esc(r.jobTitle || "未命名岗位")}</div>
          <div class="arc-company">${esc(r.company || "")}</div>
          <div class="arc-products">评 ${p(!!r.eval)} · 简 ${p(!!r.tailor)} · 面 ${p(!!r.interview)}</div>
          ${followBadge(r)}
        </div>
        <div class="arc-score">${score}<span class="arc-scale">/5</span></div>
        <select class="arc-status ${st.cls}" data-id="${r.id}">${STATUS_ORDER.map(
          (s) => `<option value="${s}" ${s === (r.status || "candidate") ? "selected" : ""}>${STATUS_META[s].label}</option>`
        ).join("")}</select>
        <div class="arc-time">${time}</div>
        <button class="arc-del" data-id="${r.id}" title="删除">🗑</button>
      </div>`;
    })
    .join("");

  els.archiveList.querySelectorAll(".arc-status").forEach((sel) => {
    sel.addEventListener("change", async () => {
      await updateRecordStatus(sel.dataset.id, sel.value);
      await refreshArchiveStats();
    });
  });
  els.archiveList.querySelectorAll(".arc-del").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm("确认删除这条岗位档案？（含评估 / 定制简历 / 面试准备）")) {
        await deleteRecord(btn.dataset.id);
        renderArchive();
      }
    });
  });
  els.archiveList.querySelectorAll(".arc-card").forEach((card) => {
    card.addEventListener("click", () => showArchiveDetail(card.dataset.id));
  });
  els.archiveDetail.classList.add("hidden");
}

async function refreshArchiveStats() {
  const list = await loadRecords();
  const counts = countByStatus(list);
  els.archiveStats.innerHTML = STATUS_ORDER.map(
    (s) => `<div class="stat-chip ${STATUS_META[s].cls}"><span class="stat-num">${counts[s] || 0}</span><span class="stat-label">${STATUS_META[s].label}</span></div>`
  ).join("");
}

async function showArchiveDetail(id) {
  const list = await loadRecords();
  const r = list.find((x) => x.id === id);
  if (!r) return;
  const followTip = r.status === "applied" && r.appliedAt
    ? (() => {
        const d = Math.floor((Date.now() - r.appliedAt) / 86400000);
        return d > 7
          ? `<div class="arc-follow-tip">⏰ 已投递 ${d} 天无更新，建议主动跟进一次（问进展 / 补作品 / 约电话）。</div>`
          : `<div class="arc-follow-tip">📮 已投递 ${d} 天。可安排在第 7 天左右跟进一次。</div>`;
      })()
    : "";
  let html = `<div class="arc-detail-head"><div>
      <h2 class="panel-title">${esc(r.jobTitle || "未命名岗位")} · ${esc(r.company || "")}</h2>
      <div class="arc-detail-meta">状态：<b>${STATUS_META[r.status || "candidate"].label}</b> · 更新：${new Date(r.updatedAt || r.createdAt).toLocaleString("zh-CN")}</div>
    </div><button id="arc-back" class="ghost-btn">← 返回列表</button></div>
    ${followTip}`;
  if (r.link || r.notes) {
    html += `<div class="arc-detail-note">${r.link ? `🔗 <a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.link)}</a><br/>` : ""}${r.notes ? `📝 ${esc(r.notes)}` : ""}</div>`;
  }
  html += `<div class="arc-detail-actions"><button id="arc-edit" class="ghost-btn">✏️ 编辑投递信息（链接 / 备注）</button></div>`;
  if (r.eval) html += `<div class="arc-section-label">🔍 评估结果</div>` + buildDetailHTML(r.eval);
  else html += `<div class="arc-tip">尚未评估。去「真实评分」粘贴 JD 后会自动归档。</div>`;
  if (r.tailor) html += `<div class="arc-section-label">📝 定制简历</div>` + buildTailorHTML(r.tailor);
  if (r.interview) html += `<div class="arc-section-label">🎤 面试准备</div>` + buildInterviewHTML(r.interview);
  els.archiveDetail.innerHTML = html;
  els.archiveDetail.classList.remove("hidden");

  const back = $("#arc-back", els.archiveDetail);
  if (back) back.addEventListener("click", () => els.archiveDetail.classList.add("hidden"));

  const edit = $("#arc-edit", els.archiveDetail);
  if (edit) edit.addEventListener("click", async () => {
    const link = prompt("投递链接（可留空）：", r.link || "");
    if (link === null) return;
    const notes = prompt("备注（可留空）：", r.notes || "");
    if (notes === null) return;
    const lst = await loadRecords();
    const rec = lst.find((x) => x.id === id);
    if (rec) {
      rec.link = link.trim(); rec.notes = notes.trim(); rec.updatedAt = Date.now();
      await persistRecords(lst);
      showArchiveDetail(id);
    }
  });

  if (r.tailor) {
    const t = r.tailor;
    const cp = $("#copy-resume", els.archiveDetail);
    if (cp) cp.onclick = () => navigator.clipboard.writeText(t.tailored_resume || "").then(
      () => (els.status.textContent = "已复制 Markdown 到剪贴板。"),
      () => (els.status.textContent = "复制失败，请手动选择文本。")
    );
    const dl = $("#download-resume", els.archiveDetail);
    if (dl) dl.onclick = () => {
      const blob = new Blob([t.tailored_resume || ""], { type: "text/markdown;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `定制简历_${t.job_title || "target"}.md`;
      a.click();
      URL.revokeObjectURL(a.href);
    };
    const pdf = $("#export-pdf", els.archiveDetail);
    if (pdf) pdf.onclick = () => exportPdf(t);
    const ats = $("#ats-check", els.archiveDetail);
    if (ats) ats.onclick = () => runAts(r.jd || lastTailorJd, t.tailored_resume || "");
  }
}

// ---- 档案导出 / 导入备份 ----
function bindArchiveTools() {
  if (els.exportJson) els.exportJson.addEventListener("click", async () => {
    const list = await loadRecords();
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: Date.now(), records: list }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `求职档案_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  if (els.importJson) els.importJson.addEventListener("click", () => els.importFile && els.importFile.click());
  if (els.importFile) els.importFile.addEventListener("change", async () => {
    const f = els.importFile.files[0];
    if (!f) return;
    try {
      const text = await f.text();
      const data = JSON.parse(text);
      const recs = Array.isArray(data) ? data : data.records || [];
      if (!recs.length) { els.status.textContent = "导入文件为空。"; return; }
      await importRecords(recs);
      els.status.textContent = `已导入 ${recs.length} 条档案。`;
      renderArchive();
    } catch (e) {
      els.status.textContent = "导入失败：" + e.message;
    }
    els.importFile.value = "";
  });
}

// ---- JD 截图 OCR ----
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result || "").split(",")[1] || "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function ocrImage(file) {
  if (!file || !file.type || !file.type.startsWith("image/")) return;
  if (storeMode !== "server") {
    els.ocrStatus.textContent = "✗ 需先启动本地服务（node server/server.js）才能识别截图";
    return;
  }
  els.ocrStatus.textContent = "识别中…";
  try {
    const b64 = await fileToBase64(file);
    const resp = await fetch("/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: b64, mediaType: file.type || "image/png" }),
    });
    const j = await resp.json();
    if (!resp.ok) throw new Error(j.error || "OCR 失败");
    const txt = (j.text || "").trim();
    if (!txt) { els.ocrStatus.textContent = "✗ 未识别到文字，请换更清晰的截图"; return; }
    const cur = els.jd.value.trim();
    els.jd.value = cur ? cur + "\n\n" + txt : txt;
    els.ocrStatus.textContent = "✓ 已识别填入（" + txt.length + " 字）";
  } catch (e) {
    els.ocrStatus.textContent = "✗ " + e.message;
  }
}

function bindOcr() {
  if (els.ocrBtn) els.ocrBtn.addEventListener("click", () => els.ocrFile && els.ocrFile.click());
  if (els.ocrFile) els.ocrFile.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) ocrImage(e.target.files[0]);
    e.target.value = "";
  });
  if (els.jd) {
    els.jd.addEventListener("paste", (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const it of items) {
        if (it.type && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) { e.preventDefault(); ocrImage(f); break; }
        }
      }
    });
    ["dragover", "dragenter"].forEach((ev) => els.jd.addEventListener(ev, (e) => { e.preventDefault(); els.jd.classList.add("drop-active"); }));
    ["dragleave", "drop"].forEach((ev) => els.jd.addEventListener(ev, (e) => { e.preventDefault(); els.jd.classList.remove("drop-active"); }));
    els.jd.addEventListener("drop", (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && f.type && f.type.startsWith("image/")) ocrImage(f);
    });
  }
}

// ---- 初始化：检测后端，决定默认模式 ----
async function init() {
  Profile.init();
  bindProfile();
  bindArchiveTools();
  bindOcr();
  await detectStore();
  if (storeMode === "server") {
    setMode("live");
    els.status.textContent = "本地服务已连接 · 档案持久化保存到服务端文件（清缓存不丢）。";
  } else {
    setMode("sample");
    els.status.textContent = "未检测到本地服务（node server/server.js）。已切换示例预览；真实评分请先启动服务，档案存于浏览器本地。";
  }
}
init();
