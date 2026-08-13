// ============================================================
// 通用版 · 求职画像系统（profile.js）
// 职责：
//   1. 画像在 localStorage 持久化，首次使用强制向导填写
//   2. 画像包含：基本信息 / 简历正文 / 补充资料(知识库) / 求职偏好 / 评分配置
//   3. 把画像转换成发给后端的 payload（resume / knowledge / careerGoal / scoring）
//   4. 知识库增删改、评分权重与阈值配置、画像导入导出
// 本文件完全通用，不含任何个人硬编码。
// ============================================================

const Profile = (() => {
  const PROFILE_KEY = "aijob_profile_v2";
  const WEIGHT_KEYS = [
    { key: "skill", name: "技能匹配" },
    { key: "experience", name: "经历相关性" },
    { key: "industry", name: "行业匹配" },
    { key: "growth", name: "职业成长" },
  ];

  // 职能评分预设（选中后写入权重，用户仍可微调）
  const PRESETS = {
    通用: { skill: 0.35, experience: 0.3, industry: 0.15, growth: 0.1 },
    技术: { skill: 0.4, experience: 0.3, industry: 0.15, growth: 0.15 },
    产品: { skill: 0.35, experience: 0.35, industry: 0.15, growth: 0.15 },
    运营: { skill: 0.3, experience: 0.3, industry: 0.2, growth: 0.2 },
    设计: { skill: 0.35, experience: 0.3, industry: 0.2, growth: 0.15 },
  };

  // 各职能预设的说明（选中后展示，帮助用户理解权重取向）
  const PRESET_DESC = {
    通用: "四维均衡（技能35 / 经历30 / 行业15 / 成长10）。适合绝大多数岗位，尤其职能边界模糊或首次使用。",
    技术: "技能权重最高（40%），硬实力与项目经验优先，行业略降。适合研发、算法、测试、数据工程等重技术岗。",
    产品: "技能与经历并重（35% / 35%），强调方法论沉淀与行业理解。适合产品经理、产品运营、增长等。",
    运营: "经历与成长并重（30% / 20%），看重落地结果与行业熟悉度。适合内容、用户、活动、电商运营等。",
    设计: "技能权重最高（35%），经历次之，看重作品质量与行业审美。适合 UI/UX、视觉、交互设计等。",
  };

  function defaultScoring() {
    return { weights: { skill: 0.35, experience: 0.3, industry: 0.15, growth: 0.1 }, threshold: 4.0 };
  }

  // 内置兜底默认画像（与 profile/default-profile.json 保持一致；优先用服务端模板）
  function embeddedDefault() {
    return {
      name: "", city: "", education: "", contact: "",
      targetRoles: "", industries: "",
      resume: "",
      knowledge: [
        { id: "k1", title: "核心工作经历 / 项目 1", content: "" },
        { id: "k2", title: "核心工作经历 / 项目 2", content: "" },
      ],
      hardPrefs: "", redLines: "", narrative: "",
      scoring: defaultScoring(),
      functionPreset: "通用",
    };
  }

  let current = null;     // 当前激活画像
  let serverDefault = null; // 服务端默认模板（best-effort）
  let wizardOpen = false;

  // ---------- 存取 ----------
  function load() {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (raw) { current = JSON.parse(raw); return true; }
    } catch (_) {}
    return false;
  }
  function save(p) {
    current = p;
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (_) {}
  }
  function hasProfile() {
    return !!(current && (current.resume && current.resume.trim() || current.name && current.name.trim()));
  }
  function get() { return current || embeddedDefault(); }

  async function fetchServerDefault() {
    try {
      const r = await fetch("/api/profile");
      if (r.ok) { serverDefault = await r.json(); }
    } catch (_) {}
    return serverDefault;
  }

  // ---------- 转换成后端 payload ----------
  function buildPayload(p) {
    p = p || get();
    const header = [
      p.name && `姓名：${p.name}`,
      p.city && `期望城市：${p.city}`,
      p.education && `学历：${p.education}`,
      p.contact && `联系方式：${p.contact}`,
    ].filter(Boolean).join("\n");
    const resume = [header, p.resume].filter(Boolean).join("\n\n");
    const knowledge = (p.knowledge || [])
      .filter((k) => k && k.content && k.content.trim())
      .map((k) => `## ${k.title || "补充资料"}\n${k.content.trim()}`)
      .join("\n\n");
    const careerGoalParts = [
      p.targetRoles && `目标岗位：${p.targetRoles}`,
      p.industries && `目标行业：${p.industries}`,
      p.hardPrefs && `求职硬偏好：${p.hardPrefs}`,
      p.redLines && `风险红线：${p.redLines}`,
      p.narrative && `职业叙事：${p.narrative}`,
    ].filter(Boolean).join("\n");
    return {
      resume,
      knowledge,
      careerGoal: careerGoalParts,
      scoring: p.scoring || defaultScoring(),
    };
  }

  // ---------- 分步向导：步骤条 + 上一步/下一步 ----------
  let pfStep = 0;
  const PF_STEPS = 6;
  function goStep(n) {
    if (n < 0 || n >= PF_STEPS) return;
    pfStep = n;
    document.querySelectorAll(".pf-section").forEach((s, i) => {
      s.classList.toggle("hidden", i !== n);
    });
    document.querySelectorAll(".pf-step").forEach((s, i) => {
      s.classList.toggle("active", i === n);
      s.classList.toggle("done", i < n);
      if (i === n) s.setAttribute("aria-current", "step");
      else s.removeAttribute("aria-current");
    });
    const prev = document.getElementById("pf-step-prev");
    const next = document.getElementById("pf-step-next");
    if (prev) prev.disabled = n === 0;
    if (next) next.disabled = n === PF_STEPS - 1;
    // 末步是云端存档：进入时刷新列表，避免陈旧（首次打开 openWizard 已拉过）
    if (n === PF_STEPS - 1) {
      listCloud().then(() => renderCloud(activeCloudName || (current && current.name) || null));
    }
  }

  // ---------- 向导 UI ----------
  function openWizard() {
    if (wizardOpen) return;
    wizardOpen = true;
    const base = current || serverDefault || embeddedDefault();
    const overlay = document.getElementById("profile-overlay");
    if (!overlay) return;
    overlay.classList.remove("hidden");
    fillForm(base);
    bindWizard();
    goStep(0); // 每次打开回到第一步
    // 打开向导时拉取云端画像列表，便于切换 / 恢复
    listCloud().then(() => renderCloud(activeCloudName || (current && current.name) || null));
  }
  function closeWizard() {
    const overlay = document.getElementById("profile-overlay");
    if (overlay) overlay.classList.add("hidden");
    wizardOpen = false;
  }

  function fillForm(p) {
    p = p || embeddedDefault();
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v || ""; };
    set("pf-name", p.name);
    set("pf-city", p.city);
    set("pf-education", p.education);
    set("pf-contact", p.contact);
    set("pf-targetRoles", p.targetRoles);
    set("pf-industries", p.industries);
    set("pf-resume", p.resume);
    set("pf-hardPrefs", p.hardPrefs);
    set("pf-redLines", p.redLines);
    set("pf-narrative", p.narrative);
    const scoring = p.scoring || defaultScoring();
    set("pf-threshold", scoring.threshold);
    const tEl = document.getElementById("pf-threshold-val");
    if (tEl) tEl.textContent = Number(scoring.threshold).toFixed(1);
    const preset = p.functionPreset && PRESETS[p.functionPreset] ? p.functionPreset : "通用";
    const pEl = document.getElementById("pf-preset");
    if (pEl) pEl.value = preset;
    updatePresetDesc(preset);
    WEIGHT_KEYS.forEach((d) => {
      const s = document.getElementById("pf-w-" + d.key);
      if (s) s.value = Math.round((scoring.weights[d.key] || 0) * 100);
    });
    updateWeightLabels();
    renderKnowledge(p.knowledge || []);
  }

  function readForm() {
    const get = (id) => { const e = document.getElementById(id); return e ? e.value : ""; };
    const scoring = { weights: {}, threshold: Number(get("pf-threshold")) || 4.0 };
    WEIGHT_KEYS.forEach((d) => {
      const s = document.getElementById("pf-w-" + d.key);
      scoring.weights[d.key] = s ? Number(s.value) / 100 : 0;
    });
    const presetEl = document.getElementById("pf-preset");
    return {
      name: get("pf-name").trim(),
      city: get("pf-city").trim(),
      education: get("pf-education").trim(),
      contact: get("pf-contact").trim(),
      targetRoles: get("pf-targetRoles").trim(),
      industries: get("pf-industries").trim(),
      resume: get("pf-resume").trim(),
      knowledge: readKnowledge(),
      hardPrefs: get("pf-hardPrefs").trim(),
      redLines: get("pf-redLines").trim(),
      narrative: get("pf-narrative").trim(),
      scoring,
      functionPreset: presetEl ? presetEl.value : "通用",
    };
  }

  // ---------- 知识库 CRUD ----------
  let kbItems = [];
  function renderKnowledge(items) {
    kbItems = (items || []).map((k) => ({ id: k.id || "k" + Math.random().toString(36).slice(2, 8), title: k.title || "", content: k.content || "" }));
    const wrap = document.getElementById("pf-kb-list");
    if (!wrap) return;
    wrap.innerHTML = kbItems.map((k, i) => `
      <div class="kb-item" data-idx="${i}">
        <div class="kb-item-head">
          <input class="kb-title" data-idx="${i}" placeholder="资料标题（如：XX 公司产品经历）" value="${escAttr(k.title)}" />
          <button class="kb-del" data-idx="${i}" title="删除">✕</button>
        </div>
        <textarea class="kb-content" data-idx="${i}" placeholder="填写真实经历 / 项目细节，可引用量化数据。简历定制与评估会基于这些真实内容，绝不编造。">${escHtml(k.content)}</textarea>
      </div>`).join("");
    wrap.querySelectorAll(".kb-del").forEach((b) => b.addEventListener("click", () => {
      kbItems.splice(Number(b.dataset.idx), 1);
      renderKnowledge(kbItems);
    }));
  }
  function readKnowledge() {
    const wrap = document.getElementById("pf-kb-list");
    if (!wrap) return kbItems;
    const titles = wrap.querySelectorAll(".kb-title");
    const contents = wrap.querySelectorAll(".kb-content");
    const out = [];
    titles.forEach((t, i) => {
      out.push({ id: "k" + i, title: t.value.trim(), content: contents[i].value });
    });
    return out;
  }
  function addKnowledge() {
    kbItems.push({ id: "k" + Math.random().toString(36).slice(2, 8), title: "", content: "" });
    renderKnowledge(kbItems);
  }

  // ---------- 权重显示 + 预设 ----------
  function updateWeightLabels() {
    let sum = 0;
    WEIGHT_KEYS.forEach((d) => {
      const s = document.getElementById("pf-w-" + d.key);
      if (s) sum += Number(s.value);
    });
    WEIGHT_KEYS.forEach((d) => {
      const s = document.getElementById("pf-w-" + d.key);
      const lab = document.getElementById("pf-w-" + d.key + "-val");
      if (s && lab) {
        const pct = sum > 0 ? (Number(s.value) / sum) * 100 : 0;
        lab.textContent = pct.toFixed(0) + "%";
      }
    });
  }

  // ---------- 绑定 ----------
  function bindWizard() {
    const overlay = document.getElementById("profile-overlay");
    if (!overlay || overlay.dataset.bound) return;
    overlay.dataset.bound = "1";

    document.getElementById("profile-close").addEventListener("click", () => {
      // 关闭前若已有画像则直接关；否则允许关（进入示例态）
      closeWizard();
    });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeWizard(); });

    WEIGHT_KEYS.forEach((d) => {
      const s = document.getElementById("pf-w-" + d.key);
      if (s) s.addEventListener("input", updateWeightLabels);
    });
    const thr = document.getElementById("pf-threshold");
    if (thr) thr.addEventListener("input", () => {
      const t = document.getElementById("pf-threshold-val");
      if (t) t.textContent = Number(thr.value).toFixed(1);
    });
    const preset = document.getElementById("pf-preset");
    if (preset) preset.addEventListener("change", () => {
      const w = PRESETS[preset.value];
      if (w) WEIGHT_KEYS.forEach((d) => {
        const s = document.getElementById("pf-w-" + d.key);
        if (s) s.value = Math.round(w[d.key] * 100);
      });
      updateWeightLabels();
      updatePresetDesc(preset.value);
    });

    // ---------- 云端画像（多画像 / 跨设备） ----------
    const cloudSave = document.getElementById("pf-cloud-save");
    if (cloudSave) cloudSave.addEventListener("click", async () => {
      const p = readForm();
      if (!p.resume.trim() && !p.name.trim()) {
        alert("请至少填写「简历正文」或「姓名」，再保存到云端。");
        return;
      }
      const nameEl = document.getElementById("pf-cloud-name");
      let name = nameEl ? nameEl.value.trim() : "";
      if (!name) name = p.name.trim() || "默认画像";
      try {
        await saveCloud(name, p);
        activeCloudName = name;
        await listCloud();
        renderCloud(activeCloudName);
        flashCloud("已保存到云端：" + name);
        if (window.__onProfileSaved) window.__onProfileSaved();
      } catch (e) { alert(e.message); }
    });
    const cloudRefresh = document.getElementById("pf-cloud-refresh");
    if (cloudRefresh) cloudRefresh.addEventListener("click", async () => {
      await listCloud();
      renderCloud(activeCloudName || (current && current.name) || null);
      flashCloud("已刷新云端列表。");
    });

    document.querySelectorAll(".pf-step").forEach((s, i) => s.addEventListener("click", () => goStep(i)));
    const stepPrev = document.getElementById("pf-step-prev");
    const stepNext = document.getElementById("pf-step-next");
    if (stepPrev) stepPrev.addEventListener("click", () => goStep(pfStep - 1));
    if (stepNext) stepNext.addEventListener("click", () => goStep(pfStep + 1));

    document.getElementById("pf-kb-add").addEventListener("click", addKnowledge);

    document.getElementById("profile-save").addEventListener("click", () => {
      const p = readForm();
      if (!p.resume.trim() && !p.name.trim()) {
        alert("请至少填写「简历正文」或「姓名」，否则大模型没有你的信息可评估。");
        return;
      }
      save(p);
      closeWizard();
      if (window.__onProfileSaved) window.__onProfileSaved();
    });

    document.getElementById("profile-sample").addEventListener("click", () => {
      fillForm(SAMPLE_PROFILE);
    });

    document.getElementById("profile-export").addEventListener("click", () => {
      const p = readForm();
      const blob = new Blob([JSON.stringify(p, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `求职画像_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    document.getElementById("profile-import").addEventListener("click", () => {
      const f = document.getElementById("profile-import-file");
      if (f) f.click();
    });
    const fi = document.getElementById("profile-import-file");
    if (fi) fi.addEventListener("change", async () => {
      const file = fi.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const p = JSON.parse(text);
        if (!p || typeof p !== "object") throw new Error("格式错误");
        save(p);
        fillForm(p);
        alert("画像已导入。");
      } catch (e) { alert("导入失败：" + e.message); }
      fi.value = "";
    });
  }

  // ---------- 职能预设说明 ----------
  function updatePresetDesc(name) {
    const e = document.getElementById("pf-preset-desc");
    if (e) e.textContent = PRESET_DESC[name] || "";
  }

  // ---------- 云端画像（多画像持久化 + 跨设备） ----------
  let cloudNames = [];
  let activeCloudName = null;
  async function listCloud() {
    try {
      const r = await fetch("/api/profiles");
      if (r.ok) { const j = await r.json(); cloudNames = (j.names || []); }
    } catch (_) { cloudNames = []; }
    return cloudNames;
  }
  async function saveCloud(name, p) {
    p = p || get();
    const r = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, profile: p }),
    });
    if (!r.ok) throw new Error((await r.json()).error || "保存失败");
    return true;
  }
  async function loadCloud(name) {
    const r = await fetch("/api/profiles?name=" + encodeURIComponent(name));
    if (!r.ok) throw new Error((await r.json()).error || "读取失败");
    const j = await r.json();
    save(j.profile); // 同步到本地 active
    return j.profile;
  }
  async function deleteCloud(name) {
    const r = await fetch("/api/profiles?name=" + encodeURIComponent(name), { method: "DELETE" });
    if (!r.ok) throw new Error((await r.json()).error || "删除失败");
    return true;
  }
  function flashCloud(msg) {
    const e = document.getElementById("pf-cloud-msg");
    if (e) e.textContent = msg;
  }
  function renderCloud(activeName) {
    const wrap = document.getElementById("pf-cloud-list");
    if (!wrap) return;
    if (!cloudNames.length) {
      wrap.innerHTML = '<p class="cloud-empty">云端暂无画像。填写后输入名称点「保存到云端」即可建立第一个。</p>';
      return;
    }
    wrap.innerHTML = cloudNames.map((n) => `
      <div class="cloud-row ${n === activeName ? "active" : ""}">
        <span class="cloud-name">${escHtml(n)}${n === activeName ? " · 当前" : ""}</span>
        <span class="cloud-actions">
          <button class="ghost-btn small cloud-load" data-name="${escAttr(n)}">载入</button>
          <button class="ghost-btn small cloud-del" data-name="${escAttr(n)}">删除</button>
        </span>
      </div>`).join("");
    wrap.querySelectorAll(".cloud-load").forEach((b) => b.addEventListener("click", async () => {
      try {
        const p = await loadCloud(b.dataset.name);
        activeCloudName = b.dataset.name;
        fillForm(p);
        flashCloud("已载入「" + b.dataset.name + "」，并已同步到本机。");
        if (window.__onProfileSaved) window.__onProfileSaved();
      } catch (e) { alert(e.message); }
    }));
    wrap.querySelectorAll(".cloud-del").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm("确认删除云端画像「" + b.dataset.name + "」？此操作不可恢复。")) return;
      try {
        await deleteCloud(b.dataset.name);
        if (activeCloudName === b.dataset.name) activeCloudName = null;
        await listCloud();
        renderCloud(activeCloudName || (current && current.name) || null);
        flashCloud("已删除「" + b.dataset.name + "」。");
      } catch (e) { alert(e.message); }
    }));
  }

  // ---------- 小工具 ----------
  function escHtml(s) { return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
  function escAttr(s) { return escHtml(s).replace(/"/g, "&quot;"); }

  // ---------- 对外 API ----------
  return {
    PROFILE_KEY, WEIGHT_KEYS, PRESETS, PRESET_DESC, defaultScoring,
    init() { load(); fetchServerDefault(); },
    get, hasProfile, save, buildPayload, openWizard, closeWizard, fetchServerDefault,
    listCloud, saveCloud, loadCloud, deleteCloud, renderCloud,
    // 供 app.js 注入保存后回调
    onSaved(fn) { window.__onProfileSaved = fn; },
  };
})();
