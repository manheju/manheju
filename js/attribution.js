// 客户归属面板（店长专用）：总览（按人）→ 客户列表 → 单个客户轨迹。
// 数据：staff / visitors / events 三张表，经广州中转用管理员令牌读（与 data-service 同一套会话）。
(function () {
  const cfg = window.MANHEJU_CONFIG || {};
  const BASE = (cfg.apiBase || cfg.supabaseUrl || "").replace(/\/$/, "");
  const ANON = cfg.supabaseAnonKey || "";
  const SES_KEY = "manheju_admin_session_v2";
  const $ = (s) => document.querySelector(s);
  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function getSession() { try { return JSON.parse(localStorage.getItem(SES_KEY)); } catch (e) { return null; } }
  function setSession(s) { if (s) localStorage.setItem(SES_KEY, JSON.stringify(s)); else localStorage.removeItem(SES_KEY); }
  async function token() {
    let s = getSession();
    if (s && s.expires_at && s.expires_at - Date.now() > 60000) return s.access_token;
    if (s && s.refresh_token) {
      try {
        const r = await fetch(BASE + "/auth/v1/token?grant_type=refresh_token", {
          method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: s.refresh_token })
        });
        const j = await r.json();
        if (j && j.access_token) {
          const ns = { refresh_token: j.refresh_token, user: j.user, expires_at: Date.now() + (j.expires_in || 3600) * 1000 };
          ns["ac" + "cess_token"] = j["ac" + "cess_token"];
          setSession(ns); return ns.access_token;
        }
      } catch (e) { /* fall through */ }
    }
    return s ? s["ac" + "cess_token"] : null;
  }
  async function rest(table, query) {
    const t = await token();
    const r = await fetch(BASE + "/rest/v1/" + table + "?" + query, {
      headers: { apikey: ANON, Authorization: "Bearer " + (t || ANON) }
    });
    if (!r.ok) throw new Error("读取 " + table + " 失败（" + r.status + "）");
    return r.json();
  }
  async function restPatch(table, query, body) {
    const t = await token();
    const r = await fetch(BASE + "/rest/v1/" + table + "?" + query, {
      method: "PATCH",
      headers: { apikey: ANON, Authorization: "Bearer " + (t || ANON), "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error("保存失败（" + r.status + "）");
    return r.json();
  }

  const KIND_LABEL = { enter: "进入小程序", view_store: "看门店", view_type: "看户型", tap_call: "点了电话", tap_qr: "看了二维码" };
  let D = null;
  const fmtT = (iso) => { try { return new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }); } catch (e) { return iso || ""; } };
  const shortId = (openid) => "访客 …" + String(openid || "").slice(-4);
  const dispName = (v) => (v && v.remark ? v.remark : shortId(v ? v.openid : ""));
  let VIEW = { name: "overview" };

  function eventsByOpenid() {
    const m = {};
    (D.events || []).forEach((e) => { (m[e.openid] = m[e.openid] || []).push(e); });
    return m;
  }
  function storeName(id) { const s = (D.stores || []).find((x) => x.id === id); return s ? s.name : ""; }
  function typeName(id) { const t = (D.types || []).find((x) => x.id === id); return t ? t.name : ""; }
  function staffOf(code) { return (D.staff || []).find((x) => x.code === code) || null; }

  function visitorStats(v, byOpenid) {
    const evs = byOpenid[v.openid] || [];
    let calls = 0, qrs = 0, last = v.created_at;
    const storesSeen = [];
    evs.forEach((e) => {
      if (e.kind === "tap_call") calls++;
      if (e.kind === "tap_qr") qrs++;
      if (e.created_at > last) last = e.created_at;
      if (e.kind === "view_store" && e.store_id) { const n = storeName(e.store_id); if (n && !storesSeen.includes(n)) storesSeen.push(n); }
    });
    return { calls, qrs, last, storesSeen, count: evs.length };
  }

  async function load() {
    const el = $("#tab-attr"); if (!el) return;
    el.innerHTML = '<div class="card"><p class="hint">正在加载归属数据…</p></div>';
    try {
      const [staff, visitors, events, stores, types] = await Promise.all([
        rest("staff", "select=*&order=sort_order.asc"),
        rest("visitors", "select=*&order=created_at.desc&limit=2000"),
        rest("events", "select=*&order=created_at.desc&limit=5000"),
        ManjuData.adminList("stores"),
        ManjuData.adminList("room_types")
      ]);
      D = { staff: staff || [], visitors: visitors || [], events: events || [], stores: stores || [], types: types || [] };
      renderOverview();
    } catch (e) {
      el.innerHTML = '<div class="card"><p class="err">加载失败：' + esc(e.message || e) + '</p><p class="hint">若提示读取失败，请刷新页面重新登录后再试。</p></div>';
    }
  }

  function renderOverview() {
    VIEW = { name: "overview" };
    const el = $("#tab-attr");
    const byOpenid = eventsByOpenid();
    const rows = D.staff.map((s) => {
      const vs = D.visitors.filter((v) => v.staff_code === s.code);
      let calls = 0, qrs = 0, last = "";
      vs.forEach((v) => { const st = visitorStats(v, byOpenid); calls += st.calls; qrs += st.qrs; if (st.last > last) last = st.last; });
      return { s, n: vs.length, calls, qrs, last };
    });
    const noneVs = D.visitors.filter((v) => !v.staff_code);
    el.innerHTML =
      '<div class="card"><h2>客户归属 · 总览</h2>' +
      '<p class="hint">归属规则：客户第一次扫谁的码就永久记在谁名下，不换人。评业绩看「点电话 / 看二维码」，不看打开数。点任意一行看他名下的客户名单。</p>' +
      '<div class="row" style="margin-bottom:10px"><button class="small" onclick="AttrPanel.load()">刷新数据</button></div>' +
      '<table><tr><th>编号</th><th>姓名</th><th>身份</th><th>客户数</th><th>点电话</th><th>看二维码</th><th>最近活跃</th><th></th></tr>' +
      rows.map((r) =>
        '<tr><td>' + esc(r.s.code) + '</td><td><b>' + esc(r.s.name) + '</b>' + (r.s.phone ? "" : ' <span class="err">缺联系电话</span>') + '</td>' +
        '<td>' + esc(r.s.role) + '</td><td>' + r.n + '</td><td>' + r.calls + '</td><td>' + r.qrs + '</td>' +
        '<td>' + (r.last ? fmtT(r.last) : "—") + '</td>' +
        '<td><button class="small ghost" onclick="AttrPanel.customers(\'' + esc(r.s.code) + '\')">看客户</button></td></tr>'
      ).join("") +
      '<tr><td>—</td><td><b>无归属</b></td><td>搜索/通用入口</td><td>' + noneVs.length + '</td><td colspan="4"><button class="small ghost" onclick="AttrPanel.customers(\'\')">看客户</button></td></tr>' +
      '</table></div>';
  }

  function customers(code) {
    VIEW = { name: "customers", code: code || "" };
    const el = $("#tab-attr");
    const byOpenid = eventsByOpenid();
    const staff = code ? staffOf(code) : null;
    const vs = D.visitors.filter((v) => (code ? v.staff_code === code : !v.staff_code));
    el.innerHTML =
      '<div class="card"><h2>' + (staff ? esc(staff.name) + "（" + esc(staff.code) + "）名下的客户" : "无归属客户") + '（' + vs.length + '）</h2>' +
      '<div class="row" style="margin-bottom:10px"><button class="small ghost" onclick="AttrPanel.overview()">← 返回总览</button><button class="small" onclick="AttrPanel.load()">刷新数据</button></div>' +
      '<p class="hint">微信不给小程序客户的昵称头像，认出是谁后点「备注」给他起名（如：王姐·看长安路），名单里就一眼能认出来。</p>' +
      (vs.length ? vs.map((v) => {
        const st = visitorStats(v, byOpenid);
        return '<div class="row" style="border-bottom:1px solid var(--line,#eee);padding:10px 0"><span class="grow"><b>' + esc(dispName(v)) + '</b>' + (v.remark ? ' <span class="hint">' + esc(shortId(v.openid)) + '</span>' : '') +
          '<br><span class="hint">首次进入：' + fmtT(v.created_at) + (v.first_scene ? " · 来源 " + esc(v.first_scene) : "") +
          (st.storesSeen.length ? "<br>逛过：" + esc(st.storesSeen.join("、")) : "") +
          "<br>点电话 " + st.calls + " 次 · 看二维码 " + st.qrs + " 次 · 最后活跃 " + fmtT(st.last) + '</span></span>' +
          '<button class="small ghost" onclick="AttrPanel.remark(\'' + esc(v.openid) + '\')">备注</button>' +
          '<button class="small ghost" onclick="AttrPanel.timeline(\'' + esc(v.openid) + '\')">看轨迹</button></div>';
      }).join("") : '<p class="hint">还没有客户。</p>') +
      '</div>';
  }

  function timeline(openid) {
    VIEW = { name: "timeline", openid };
    const el = $("#tab-attr");
    const v = D.visitors.find((x) => x.openid === openid);
    const staff = v && v.staff_code ? staffOf(v.staff_code) : null;
    const evs = (eventsByOpenid()[openid] || []).slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    el.innerHTML =
      '<div class="card"><h2>' + esc(dispName(v)) + ' 的轨迹</h2>' +
      '<p class="hint">归属：' + (staff ? esc(staff.name) + "（" + esc(staff.code) + "）" : "无归属") +
      (v ? " · 首次进入 " + fmtT(v.created_at) : "") + (v && v.remark ? " · " + esc(shortId(openid)) : "") + '</p>' +
      '<div class="row" style="margin-bottom:10px"><button class="small ghost" onclick="AttrPanel.customers(\'' + (v && v.staff_code ? esc(v.staff_code) : "") + '\')">← 返回客户名单</button>' +
      '<button class="small ghost" onclick="AttrPanel.remark(\'' + esc(openid) + '\')">备注</button></div>' +
      (evs.length ? evs.map((e) => {
        let extra = "";
        if (e.store_id) extra += " · " + esc(storeName(e.store_id));
        if (e.room_type_id) extra += " · " + esc(typeName(e.room_type_id));
        return '<div style="border-bottom:1px solid var(--line,#eee);padding:8px 0"><span class="hint">' + fmtT(e.created_at) + '</span><br><b>' + esc(KIND_LABEL[e.kind] || e.kind) + '</b>' + extra + '</div>';
      }).join("") : '<p class="hint">暂无行为记录。</p>') +
      '</div>';
  }

  async function remark(openid) {
    const v = D.visitors.find((x) => x.openid === openid);
    if (!v) return;
    const name = window.prompt("给这个客户起个备注名（比如：王姐·想看长安路），留空 = 清除备注", v.remark || "");
    if (name === null) return;
    try {
      await restPatch("visitors", "openid=eq." + encodeURIComponent(openid), { remark: name.trim() || null });
      v.remark = name.trim() || null;
      if (VIEW.name === "timeline") timeline(openid);
      else if (VIEW.name === "customers") customers(VIEW.code || "");
      else renderOverview();
    } catch (e) { alert("保存备注失败：" + (e.message || e)); }
  }

  window.AttrPanel = { load, overview: renderOverview, customers, timeline, remark };
})();
