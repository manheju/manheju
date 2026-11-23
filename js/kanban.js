// 客户看板（免登录只读）：凭链接里的密钥 k 向中转 /dash/data 取归属数据，渲染总览 → 客户名单 → 轨迹。
// 只读：不写任何数据；备注在管理员后台里改，这里只显示。
(function () {
  const cfg = window.MANHEJU_CONFIG || {};
  const BASE = (cfg.apiBase || "").replace(/\/$/, "");
  const K = new URLSearchParams(location.search).get("k") || "";
  const el = document.getElementById("board");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const KIND_LABEL = { enter: "进入小程序", view_store: "看门店", view_type: "看户型", tap_call: "点了电话", tap_qr: "看了二维码" };
  const fmtT = (iso) => { try { return new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }); } catch (e) { return iso || ""; } };
  const shortId = (openid) => "访客 …" + String(openid || "").slice(-4);
  let D = null;

  const dispName = (v) => (v && v.remark ? v.remark : shortId(v ? v.openid : ""));
  function eventsByOpenid() { const m = {}; (D.events || []).forEach((e) => { (m[e.openid] = m[e.openid] || []).push(e); }); return m; }
  function storeName(id) { const s = (D.stores || []).find((x) => x.id === id); return s ? s.name : ""; }
  function typeName(id) { const t = (D.types || []).find((x) => x.id === id); return t ? t.name : ""; }
  function staffOf(code) { return (D.staff || []).find((x) => x.code === code) || null; }
  function visitorStats(v, byOpenid) {
    const evs = byOpenid[v.openid] || [];
    let calls = 0, qrs = 0, last = v.created_at; const storesSeen = [];
    evs.forEach((e) => {
      if (e.kind === "tap_call") calls++;
      if (e.kind === "tap_qr") qrs++;
      if (e.created_at > last) last = e.created_at;
      if (e.kind === "view_store" && e.store_id) { const n = storeName(e.store_id); if (n && !storesSeen.includes(n)) storesSeen.push(n); }
    });
    return { calls, qrs, last, storesSeen };
  }

  async function load() {
    el.innerHTML = '<div class="card"><p class="hint">正在加载…</p></div>';
    try {
      const r = await fetch(BASE + "/dash/data?k=" + encodeURIComponent(K));
      if (r.status === 401) { el.innerHTML = '<div class="card"><p class="err">这个链接不对或已失效。</p><p class="hint">请用店长给的最新看板链接打开；链接丢了找墩墩重发。</p></div>'; return; }
      if (!r.ok) throw new Error("读取失败（" + r.status + "）");
      D = await r.json();
      renderOverview();
    } catch (e) {
      el.innerHTML = '<div class="card"><p class="err">加载失败：' + esc(e.message || e) + '</p><p class="hint">网络慢的话，点下面重试。</p><div class="row"><button class="small" onclick="Kanban.load()">重试</button></div></div>';
    }
  }

  function renderOverview() {
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
      '<p class="hint">归属规则：客户第一次扫谁的码就永久记在谁名下。评业绩看「点电话 / 看二维码」。点「看客户」看名单，再点「看轨迹」看单个客户的完整访问流程。</p>' +
      '<div class="row" style="margin-bottom:10px"><button class="small" onclick="Kanban.load()">刷新数据</button></div>' +
      '<table><tr><th>编号</th><th>姓名</th><th>身份</th><th>客户数</th><th>点电话</th><th>看二维码</th><th>最近活跃</th><th></th></tr>' +
      rows.map((r) =>
        '<tr><td>' + esc(r.s.code) + '</td><td><b>' + esc(r.s.name) + '</b></td>' +
        '<td>' + esc(r.s.role) + '</td><td>' + r.n + '</td><td>' + r.calls + '</td><td>' + r.qrs + '</td>' +
        '<td>' + (r.last ? fmtT(r.last) : "—") + '</td>' +
        '<td><button class="small ghost" onclick="Kanban.customers(\'' + esc(r.s.code) + '\')">看客户</button></td></tr>'
      ).join("") +
      '<tr><td>—</td><td><b>无归属</b></td><td>搜索/通用入口</td><td>' + noneVs.length + '</td><td colspan="4"><button class="small ghost" onclick="Kanban.customers(\'\')">看客户</button></td></tr>' +
      '</table></div>';
  }

  function customers(code) {
    const byOpenid = eventsByOpenid();
    const staff = code ? staffOf(code) : null;
    const vs = D.visitors.filter((v) => (code ? v.staff_code === code : !v.staff_code));
    el.innerHTML =
      '<div class="card"><h2>' + (staff ? esc(staff.name) + "（" + esc(staff.code) + "）名下的客户" : "无归属客户") + '（' + vs.length + '）</h2>' +
      '<div class="row" style="margin-bottom:10px"><button class="small ghost" onclick="Kanban.overview()">← 返回总览</button><button class="small" onclick="Kanban.load()">刷新数据</button></div>' +
      (vs.length ? vs.map((v) => {
        const st = visitorStats(v, byOpenid);
        return '<div class="row" style="border-bottom:1px solid var(--line,#eee);padding:10px 0"><span class="grow"><b>' + esc(dispName(v)) + '</b>' + (v.remark ? ' <span class="hint">' + esc(shortId(v.openid)) + '</span>' : '') +
          '<br><span class="hint">首次进入：' + fmtT(v.created_at) + (v.first_scene ? " · 来源 " + esc(v.first_scene) : "") +
          (st.storesSeen.length ? "<br>逛过：" + esc(st.storesSeen.join("、")) : "") +
          "<br>点电话 " + st.calls + " 次 · 看二维码 " + st.qrs + " 次 · 最后活跃 " + fmtT(st.last) + '</span></span>' +
          '<button class="small ghost" onclick="Kanban.timeline(\'' + esc(v.openid) + '\')">看轨迹</button></div>';
      }).join("") : '<p class="hint">还没有客户。</p>') +
      '</div>';
  }

  function timeline(openid) {
    const v = D.visitors.find((x) => x.openid === openid);
    const staff = v && v.staff_code ? staffOf(v.staff_code) : null;
    const evs = (eventsByOpenid()[openid] || []).slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    el.innerHTML =
      '<div class="card"><h2>' + esc(dispName(v)) + ' 的轨迹</h2>' +
      '<p class="hint">归属：' + (staff ? esc(staff.name) + "（" + esc(staff.code) + "）" : "无归属") +
      (v ? " · 首次进入 " + fmtT(v.created_at) : "") + '</p>' +
      '<div class="row" style="margin-bottom:10px"><button class="small ghost" onclick="Kanban.customers(\'' + (v && v.staff_code ? esc(v.staff_code) : "") + '\')">← 返回客户名单</button></div>' +
      (evs.length ? evs.map((e) => {
        let extra = "";
        if (e.store_id) extra += " · " + esc(storeName(e.store_id));
        if (e.room_type_id) extra += " · " + esc(typeName(e.room_type_id));
        return '<div style="border-bottom:1px solid var(--line,#eee);padding:8px 0"><span class="hint">' + fmtT(e.created_at) + '</span><br><b>' + esc(KIND_LABEL[e.kind] || e.kind) + '</b>' + extra + '</div>';
      }).join("") : '<p class="hint">暂无行为记录。</p>') +
      '</div>';
  }

  window.Kanban = { load, overview: renderOverview, customers, timeline };
  load();
})();
