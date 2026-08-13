// ============================================================
// 回归自检（零依赖）：node server/selfcheck.js
// 覆盖：
//   1) 评分权重归一化（normalizeWeights）
//   2) 服务端确定性重算总分 / recommend（normalizeEvalResult）
//   3) 模型输出缺失 / 非法字段的兜底（防前端崩溃）
//   4) 上游调用超时保护（fetchWithTimeout）
//   5) 评分 prompt 防护（注入 / 红线 / 锚定）
//   6) 路由层冒烟（起真实服务器 + 注入 fetch 故障，零外部 LLM 调用）：
//      Host 校验 / records 回环 / rank 失败隔离 / 瞬态失败重试
// 新增评分/调用逻辑时必须在此补断言，防止回归。
// ============================================================
const http = require("http");
const { normalizeWeights, normalizeEvalResult, fetchWithTimeout, buildEvalSystemPrompt, server, isAllowedHost } = require("./server.js");

let failed = 0;
function assert(name, cond, detail) {
  if (cond) console.log("  ✓ " + name);
  else { failed++; console.error("  ✗ " + name + (detail ? " → " + detail : "")); }
}
const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

// 直接发 node:http 请求（不经过全局 fetch，便于在注入 fetch 故障时仍能打本机服务）
function rawRequest(method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: server.address().port,
        method,
        path,
        headers: {
          Host: `127.0.0.1:${server.address().port}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...extraHeaders,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", reject);
    if (body) req.end(body);
    else req.end();
  });
}

async function main() {
  // ---------- 1) 权重归一化 ----------
  console.log("[1] 权重归一化");
  {
    const w = normalizeWeights({ skill: 40, experience: 30, industry: 20, growth: 10 });
    assert("40/30/20/10 → skill=0.4", Math.abs(w.skill - 0.4) < 1e-9, JSON.stringify(w));
    assert("总和 = 1", Math.abs(sum(w) - 1) < 1e-9, String(sum(w)));
  }
  {
    const w = normalizeWeights(null);
    // 默认权重 0.35/0.3/0.15/0.1 归一化后：0.35/0.9 = 0.3889（UI 标签同样按归一化展示，设计一致）
    assert("空输入回落默认并归一化 (skill≈0.3889)", Math.abs(w.skill - 0.35 / 0.9) < 1e-9, JSON.stringify(w));
    assert("总和 = 1", Math.abs(sum(w) - 1) < 1e-9, String(sum(w)));
  }
  {
    const w = normalizeWeights({ skill: 0.5 });
    assert("缺失维度有默认值且总和=1", Math.abs(sum(w) - 1) < 1e-9 && Object.values(w).every((v) => v > 0), JSON.stringify(w));
  }
  {
    const w = normalizeWeights({ skill: 0, growth: -1 });
    assert("非法权重(0/负数)回落默认且总和=1", Math.abs(sum(w) - 1) < 1e-9 && Object.values(w).every((v) => v > 0), JSON.stringify(w));
  }

  // ---------- 2) 确定性重算：模型故意给错总分与 recommend，必须被纠正 ----------
  console.log("[2] 总分 / recommend 重算");
  const modelOut = {
    job_title: "测试岗", company: "测试公司",
    overall_score: 5.0, recommend: true, // ← 模型错误输出（应被覆盖）
    dimensions: [
      { key: "skill", name: "技能匹配", weight: 0.4, score: 4.0, rationale: "a" },
      { key: "experience", name: "经历相关性", weight: 0.3, score: 3.0, rationale: "b" },
      { key: "industry", name: "行业匹配", weight: 0.2, score: 2.0, rationale: "c" },
      { key: "growth", name: "职业成长", weight: 0.1, score: 5.0, rationale: "d" },
    ],
    risks: [], summary: "s",
  };
  {
    // 权重 0.4/0.3/0.2/0.1 总和=1（归一化为恒等），期望：4*0.4+3*0.3+2*0.2+5*0.1 = 3.4
    const r = normalizeEvalResult(JSON.parse(JSON.stringify(modelOut)), {
      weights: { skill: 0.4, experience: 0.3, industry: 0.2, growth: 0.1 }, threshold: 4.0,
    });
    assert("总分重算 = 3.4（覆盖模型 5.0）", r.overall_score === 3.4, String(r.overall_score));
    assert("recommend 重算 = false（覆盖模型 true）", r.recommend === false, String(r.recommend));
    assert("threshold 回传 4.0", r.threshold === 4.0, String(r.threshold));
    assert("dimensions 权重 = 实际归一化权重", Math.abs(r.dimensions[0].weight - 0.4) < 1e-9);
  }
  {
    const r = normalizeEvalResult(JSON.parse(JSON.stringify(modelOut)), { threshold: 3.0 });
    assert("threshold=3.0 时 recommend = true", r.recommend === true, String(r.recommend));
  }
  {
    const r = normalizeEvalResult(JSON.parse(JSON.stringify(modelOut)), null);
    assert("无 scoring 输入用默认权重与 4.0 阈值", r.threshold === 4.0 && r.recommend === false, String(r.recommend));
  }

  // ---------- 3) 缺失 / 非法字段兜底（防前端 toFixed 崩溃） ----------
  console.log("[3] 非法输出兜底");
  {
    const r = normalizeEvalResult({ dimensions: [{ key: "skill", score: "高" }] }, null);
    assert("非法 score 兜底为 0", r.dimensions[0].score === 0, String(r.dimensions[0].score));
    assert("缺维度补齐为 4 个", r.dimensions.length === 4, String(r.dimensions.length));
    assert("rationale 缺失兜底为空串", r.dimensions[0].rationale === "");
  }
  {
    const r = normalizeEvalResult({ dimensions: "not-an-array" }, null);
    assert("dimensions 非数组 → 补齐 4 维", r.dimensions.length === 4 && r.overall_score === 0, String(r.overall_score));
  }

  // ---------- 4) 上游超时保护：挂起的上游必须在超时后被中止 ----------
  console.log("[4] 上游调用超时保护");
  const hang = http.createServer(() => { /* 永不响应 */ });
  await new Promise((resolve) => hang.listen(0, "127.0.0.1", resolve));
  const hangUrl = `http://127.0.0.1:${hang.address().port}/never`;
  try {
    await fetchWithTimeout(hangUrl, {}, 300);
    assert("挂起的上游应在 300ms 后中止", false, "未抛出异常");
  } catch (e) {
    assert("挂起的上游应在 300ms 后中止 (AbortError)", e && e.name === "AbortError", String(e));
  }
  hang.close();

  // ---------- 5) 评分 prompt 防注入 / 红线硬约束 / 打分锚定 ----------
  console.log("[5] 评分 prompt 防护");
  const p = buildEvalSystemPrompt({ weights: null, threshold: 4.0 }, "风险红线：不接受异地");
  {
    const checks = [
      ["JD/简历声明为不可信外部数据（注入防护）", "不可信的外部数据"],
      ["打分尺度锚定（5.0 定义）", "5.0"],
      ["红线为硬性否决项", "硬性否决"],
      ["命中红线 recommend 必须为 false", "recommend 必须为 false"],
      ["红线命中标 level=red", "level=red"],
      ["默认权重归一化后注入 prompt (39%)", "weight 39%"],
      ["阈值注入 prompt (4.0)", "4.0"],
      ["服务端确定性重算声明", "确定性重算"],
    ];
    for (const [name, kw] of checks) {
      assert(`${name} (「${kw}」)`, p.includes(kw), "prompt 缺少关键片段");
    }
  }

  // ---------- 6) 路由层冒烟：起真实服务器（临时端口），全部确定性、零外部 LLM 调用 ----------
  console.log("[6] 路由层冒烟");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    {
      const r = await fetch(base + "/api/health");
      const j = await r.json();
      assert("GET /api/health → 200 {ok:true}", r.status === 200 && j.ok === true, `${r.status} ${JSON.stringify(j)}`);
    }
    {
      // node:http 可覆盖 Host 头（浏览器/undici 禁止），用来验证 Host 校验的拒绝分支
      const res = await rawRequest("GET", "/api/health", null, { Host: "evil.example.com" });
      assert("伪造 Host: evil.example.com → 403", res.status === 403, String(res.status));
    }
    {
      const cases = [
        ["localhost", true], ["localhost:3000", true], ["127.0.0.1:3199", true],
        ["[::1]:3000", true], ["0.0.0.0:3000", true],
        ["evil.example.com", false], ["localhost.evil.com", false],
        ["127.0.0.1.attacker.com", false], ["", false],
      ];
      for (const [h, want] of cases) {
        assert(`isAllowedHost("${h}") = ${want}`, isAllowedHost(h) === want, String(isAllowedHost(h)));
      }
    }
    {
      // records 回环：写入 → 回读 → 恢复原数据（不污染用户档案）
      const before = (await (await fetch(base + "/api/records")).json()).records;
      const probe = [{ id: "selfcheck-probe", job_title: "自检探针" }];
      try {
        await fetch(base + "/api/records", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ records: probe }),
        });
        const after = (await (await fetch(base + "/api/records")).json()).records;
        assert("records 写入并回读一致", Array.isArray(after) && after.length === 1 && after[0].id === "selfcheck-probe", JSON.stringify(after).slice(0, 120));
      } finally {
        await fetch(base + "/api/records", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ records: before }),
        });
      }
      const restored = (await (await fetch(base + "/api/records")).json()).records;
      assert("records 原数据已恢复", JSON.stringify(restored) === JSON.stringify(before), JSON.stringify(restored).slice(0, 120));
    }
    {
      // rank 失败隔离：注入全局 fetch 网络故障（确定性，不发真实 LLM 请求）。
      // 外层请求走 rawRequest（node:http，不经全局 fetch），服务端内 callLLM 的 fetch 被注入故障。
      const realFetch = global.fetch;
      global.fetch = async () => { throw new Error("模拟网络中断（自检注入）"); };
      try {
        const r = await rawRequest("POST", "/api/rank", JSON.stringify({ jds: ["", "自检岗位"], model: "deepseek", scoring: null }));
        const j = JSON.parse(r.body);
        assert("rank：200 + 2 条结果（单条失败不拖垮整批）", r.status === 200 && Array.isArray(j.results) && j.results.length === 2, `${r.status} ${r.body.slice(0, 200)}`);
        assert("rank：空 JD 走跳过分支（error=empty）", j.results.some((x) => x.error === "empty"), r.body.slice(0, 300));
        assert("rank：网络失败仅污染单条（error 注入，整批仍 200）", j.results.some((x) => x.error === "模拟网络中断（自检注入）"), r.body.slice(0, 300));
        assert("rank：全部结果已分配 rank 序号", j.results.every((x) => typeof x.rank === "number"), r.body.slice(0, 200));
      } finally {
        global.fetch = realFetch;
      }
    }
    {
      // 瞬态失败重试：第一次调用注入网络故障，第二次返回正常评估 → 断言重试命中且结果正常
      const realFetch = global.fetch;
      let calls = 0;
      global.fetch = async () => {
        if (++calls === 1) throw new Error("首次调用模拟网络中断");
        return new Response(JSON.stringify({
          content: [{ type: "text", text: JSON.stringify({
            job_title: "自检岗", company: "自检公司", overall_score: 3.0, recommend: false,
            dimensions: [{ key: "skill", name: "技能匹配", score: 3, rationale: "r" }],
            risks: [], summary: "s",
          }) }],
          usage: { input_tokens: 10, output_tokens: 20 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      };
      try {
        const r = await rawRequest("POST", "/api/rank", JSON.stringify({ jds: ["自检岗位"], model: "deepseek", scoring: null }));
        const j = JSON.parse(r.body);
        assert("重试：首次网络失败后第 2 次成功（共 2 次上游调用）", calls === 2, `calls=${calls}`);
        assert("重试：结果正常、无 error 标记", r.status === 200 && j.results.length === 1 && j.results[0].job_title === "自检岗" && !j.results[0].error, r.body.slice(0, 300));
      } finally {
        global.fetch = realFetch;
      }
    }
    {
      // 截断重试耗尽：上游两次都返回被截断的 JSON（无闭合括号）→ 重试恰好 1 次后 502 + 可读错误，进程存活
      const realFetch = global.fetch;
      let calls = 0;
      global.fetch = async () => {
        calls++;
        return new Response(JSON.stringify({
          content: [{ type: "text", text: '{"job_title": "截断的JSON", "dimensions": [{"key": "skill", "score":' }],
          usage: { input_tokens: 10, output_tokens: 2048 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      };
      try {
        const r = await rawRequest("POST", "/api/evaluate", JSON.stringify({ jd: "自检岗位", model: "deepseek", scoring: null }));
        const j = JSON.parse(r.body);
        assert("截断 JSON：重试恰好 1 次（共 2 次调用）", calls === 2, `calls=${calls}`);
        assert("截断 JSON：重试耗尽 → 502 + 可读错误（进程不崩）", r.status === 502 && typeof j.error === "string" && j.error.includes("可解析"), `${r.status} ${r.body.slice(0, 200)}`);
      } finally {
        global.fetch = realFetch;
      }
    }
  } finally {
    server.close();
    if (server.closeAllConnections) server.closeAllConnections();
  }
}

main().then(() => {
  console.log(failed === 0 ? "\n全部通过 ✅" : `\n${failed} 项失败 ❌`);
  process.exit(failed === 0 ? 0 : 1);
});
