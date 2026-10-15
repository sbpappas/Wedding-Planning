(() => {
  // ---------- constants ----------
  const BUCKETS = [
    { key: "m12", label: "12+ months out", dueMonths: 12, startMonths: 24 },
    { key: "m9",  label: "9–11 months out", dueMonths: 9, startMonths: 12 },
    { key: "m6",  label: "6–8 months out", dueMonths: 6, startMonths: 9 },
    { key: "m4",  label: "4–5 months out", dueMonths: 4, startMonths: 6 },
    { key: "m2",  label: "2–3 months out", dueMonths: 2, startMonths: 4 },
    { key: "m1",  label: "The final month", dueMonths: 0.25, startMonths: 2 },
    { key: "w1",  label: "Wedding week", dueMonths: 0, startMonths: 0.25 },
    { key: "after", label: "After the wedding", dueMonths: -1.5, startMonths: 0 },
  ];
  const CATEGORIES = ["Venue", "Catering", "Photo & video", "Attire & beauty", "Flowers & decor", "Music & entertainment", "Stationery", "Rings", "Officiant & ceremony", "Cake & desserts", "Transport", "Favors & gifts", "Honeymoon", "Legal & admin", "Other"];
  const STAGES = [["researching", "Researching"], ["contacted", "Contacted"], ["quoted", "Quote in hand"], ["booked", "Booked"], ["passed", "Passed"]];
  const DSTATUS = [["open", "Open"], ["leaning", "Leaning"], ["decided", "Decided"]];
  const IDEA_TAGS = ["Ceremony", "Reception", "Attire", "Flowers", "Stationery", "Food & drink", "Music", "Palette", "Other"];

  // ---------- state ----------
  const S = { settings: {}, decisions: [], tasks: [], budget: [], vendors: [], ideas: [], research: [], loaded: false };
  let db = null, readOnly = false;
  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  let tab = store.get("tab", "tasks");
  let taskFilter = store.get("taskFilter", "open");
  let vendorView = store.get("vendorView", "pipeline");
  let compareKey = store.get("compareKey", "");

  // ---------- helpers ----------
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => (n == null || isNaN(n)) ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
  const num = (v) => { if (v === "" || v == null) return null; const n = Number(v); return isNaN(n) ? null : n; };
  const partner = () => (S.settings.partnerName || "").trim() || "Partner";
  const me = () => (S.settings.myName || "").trim() || "Samuel";
  const ownerLabel = (o) => o === "partner" ? partner() : o === "me" ? me() : "Both";
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const weddingDate = () => {
    const v = S.settings.weddingDate; if (!v) return null;
    const [y, m, d] = v.split("-").map(Number); if (!y) return null;
    return new Date(y, m - 1, d);
  };
  const minusMonths = (date, months) => {
    const d = new Date(date);
    const whole = Math.trunc(months), frac = months - whole;
    d.setMonth(d.getMonth() - whole);
    if (frac) d.setDate(d.getDate() - Math.round(frac * 30));
    return d;
  };
  const fmtDate = (d, opts = { month: "short", day: "numeric", year: "numeric" }) => d ? d.toLocaleDateString("en-US", opts) : "";
  const bucketOf = (k) => BUCKETS.find((b) => b.key === k) || BUCKETS[0];
  const dueFor = (task) => {
    if (task.due) { const [y, m, d] = task.due.split("-").map(Number); return new Date(y, m - 1, d); }
    const w = weddingDate(); if (!w) return null;
    return minusMonths(w, bucketOf(task.bucket).dueMonths);
  };
  const isLate = (t) => { if (t.done) return false; const d = dueFor(t); return d && d < today(); };
  const byOrder = (a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.title || a.name || a.category || "").localeCompare(String(b.title || b.name || b.category || ""));

  function toast(msg) {
    const el = document.createElement("div"); el.className = "toast"; el.textContent = msg;
    document.body.appendChild(el); setTimeout(() => el.remove(), 2600);
  }
  function writeFailed(e) {
    if (e && e.code === "invalid_argument") { readOnly = true; renderNotice(); toast("You can view this planner but not edit it."); }
    else if (e && e.code === "quota_exceeded") toast("The planner is full. Delete a few old items and try again.");
    else toast("Couldn't save. Check your connection and try again.");
  }

  // ---------- data ----------
  async function start() {
    render();
    db = window.claude?.use ? await window.claude.use("db") : null;
    if (!db) { renderNotice(); return; }
    db.doc("meta/settings").onSnapshot((s) => { S.settings = s.exists ? { ...s.data() } : {}; S.loaded = true; render(); }, () => {});
    for (const c of ["decisions", "tasks", "budget", "vendors", "ideas", "research"]) {
      db.collection(c).onSnapshot((snap) => {
        S[c] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        S.loaded = true; render();
      }, () => {});
    }
  }
  async function save(col, id, data) {
    if (!db) { toast("Saving isn't available in this view."); return false; }
    try {
      if (id) await db.collection(col).doc(id).update(data);
      else await db.collection(col).add(data);
      return true;
    } catch (e) { writeFailed(e); return false; }
  }
  async function remove(col, id) {
    try { await db.collection(col).doc(id).delete(); return true; } catch (e) { writeFailed(e); return false; }
  }

  // ---------- masthead ----------
  function renderMast() {
    $("#names").innerHTML = `${esc(partner())} <em>&amp;</em> ${esc(me())}`;
    const w = weddingDate();
    const where = (S.settings.location || "").trim();
    $("#when").textContent = w
      ? fmtDate(w, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) + (where ? ` · ${where}` : "")
      : (where ? `${where} · date not set yet` : "Date not set yet");
    if (w) {
      const days = Math.round((w - today()) / 864e5);
      $("#count").innerHTML = days > 0
        ? `<div class="big num">${days}</div><div class="lbl">days to go</div>`
        : days === 0 ? `<div class="big">Today</div><div class="lbl">congratulations</div>`
        : `<div class="big num">${-days}</div><div class="lbl">days married</div>`;
    } else $("#count").innerHTML = `<div class="lbl">Set your date under<br>Big decisions</div>`;

    const total = S.tasks.length, done = S.tasks.filter((t) => t.done).length, late = S.tasks.filter(isLate).length;
    const decided = S.decisions.filter((d) => d.status === "decided").length;
    const chips = [];
    if (S.decisions.length) chips.push(`<span class="chip"><b class="num">${decided}/${S.decisions.length}</b> big decisions made</span>`);
    if (total) chips.push(`<span class="chip"><b class="num">${done}/${total}</b> tasks done</span>`);
    if (late) chips.push(`<span class="chip alert"><b class="num">${late}</b> overdue</span>`);
    if (S.settings.budget) chips.push(`<span class="chip">Budget <b class="num">${money(S.settings.budget)}</b></span>`);
    if (S.settings.guests) chips.push(`<span class="chip">About <b class="num">${esc(S.settings.guests)}</b> guests</span>`);
    $("#stats").innerHTML = chips.join("");
    $("#n-tasks").textContent = total ? ` ${total - done}` : "";
    $("#n-vendors").textContent = S.vendors.length ? ` ${S.vendors.length}` : "";
    $("#n-ideas").textContent = S.ideas.length ? ` ${S.ideas.length}` : "";
  }

  function renderNotice() {
    const n = $("#notice");
    if (startedLookup && !db) {
      n.innerHTML = `<div class="notice">Shared data isn't available in this view. Open the planner on claude.ai while signed in to see and edit your plans.</div>`;
    } else if (readOnly) {
      n.innerHTML = `<div class="notice">You have view-only access. Ask the owner to share this planner with you as a Contributor so you can edit it too.</div>`;
    } else n.innerHTML = "";
  }
  let startedLookup = false;

  // ---------- views ----------
  function render() {
    renderMast();
    document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    const v = $("#view");
    const views = { basics: viewBasics, tasks: viewTasks, budget: viewBudget, vendors: viewVendors, ideas: viewIdeas };
    v.innerHTML = (views[tab] || viewTasks)();
  }

  function viewBasics() {
    const s = S.settings;
    const ds = [...S.decisions].sort(byOrder);
    return `
      <form class="panel basics" id="basicsForm">
        <div class="head"><h3>The basics</h3><span class="muted" style="font-size:13px">Everything else is planned around these.</span></div>
        <label class="f">Your name<input id="b-me" name="myName" value="${esc(s.myName || "Samuel")}"></label>
        <label class="f">Partner's name<input id="b-partner" name="partnerName" value="${esc(s.partnerName || "")}" placeholder="Partner"></label>
        <label class="f">Wedding date<input id="b-date" type="date" name="weddingDate" value="${esc(s.weddingDate || "")}"></label>
        <label class="f">Total budget (USD)<input id="b-budget" type="number" min="0" step="500" name="budget" value="${esc(s.budget ?? "")}" placeholder="e.g. 10000"></label>
        <label class="f">Guest count<input id="b-guests" type="number" min="0" name="guests" value="${esc(s.guests ?? "")}" placeholder="e.g. 120"></label>
        <label class="f">Location<input id="b-loc" name="location" value="${esc(s.location || "")}" placeholder="City or venue"></label>
        <div style="grid-column:1/-1;display:flex;justify-content:flex-end"><button class="btn primary" type="submit">Save basics</button></div>
      </form>
      <div class="bar"><h2>Big decisions</h2><button class="btn" data-add="decisions">Add a decision</button></div>
      ${ds.length ? `<div class="decisions">${ds.map((d) => {
        const st = DSTATUS.find(([k]) => k === d.status) || DSTATUS[0];
        return `<button class="panel dcard" data-edit="decisions" data-id="${esc(d.id)}">
          <div class="top"><h3>${esc(d.title)}</h3><span class="pill ${esc(st[0])}">${st[1]}</span></div>
          ${d.decision ? `<div class="answer">${esc(d.decision)}</div>` : ""}
          ${d.notes ? `<div class="muted" style="font-size:14px">${esc(d.notes)}</div>` : ""}
          ${d.unlocks ? `<div class="unlocks">Unlocks: ${esc(d.unlocks)}</div>` : ""}
        </button>`;
      }).join("")}</div>` : emptyState("No decisions yet", "Add the choices you two need to make first, like budget, guest count, season and vibe.")}`;
  }

  function viewTasks() {
    if (!S.tasks.length) return `<div class="bar"><h2>Timeline</h2><button class="btn primary" data-add="tasks">Add a task</button></div>` + emptyState("Your checklist will appear here", "Tasks are grouped by how many months before the wedding they're due. Add your first one to get started.");
    const done = S.tasks.filter((t) => t.done).length;
    const f = taskFilter;
    const keep = (t) => f === "all" ? true : f === "open" ? !t.done : f === "late" ? isLate(t) : (t.owner || "both") === f;
    const w = weddingDate(), now = today();
    const groups = BUCKETS.map((b) => {
      const items = S.tasks.filter((t) => (t.bucket || "m12") === b.key && keep(t)).sort(byOrder);
      if (!items.length) return "";
      let due = "", isNow = false;
      if (w) {
        const end = minusMonths(w, b.dueMonths), startD = minusMonths(w, b.startMonths);
        due = b.key === "after" ? `in the weeks after` : `by ${fmtDate(end)}`;
        isNow = now >= startD && now <= end;
      }
      return `<section class="group${isNow ? " now" : ""}"><header><h3>${b.label}</h3>${due ? `<span class="due">${due}</span>` : ""}${isNow ? `<span class="pill leaning">You are here</span>` : ""}</header>
        ${items.map(taskRow).join("")}</section>`;
    }).join("");
    const fb = (k, l) => `<button type="button" data-filter="${k}" aria-pressed="${f === k}">${esc(l)}</button>`;
    return `<div class="bar"><h2>Timeline</h2><button class="btn primary" data-add="tasks">Add a task</button></div>
      <div class="progress" title="${done} of ${S.tasks.length} done"><span style="width:${(done / S.tasks.length * 100).toFixed(1)}%"></span></div>
      <div class="bar"><div class="filters">${fb("open", "To do")}${fb("all", "All")}${fb("late", "Overdue")}${fb("me", me())}${fb("partner", partner())}${fb("both", "Both")}</div>
      ${w ? "" : `<span class="muted" style="font-size:13px">Set a date to see due dates.</span>`}</div>
      ${groups || emptyState("Nothing here", f === "late" ? "Nothing is overdue. Nice work." : "No tasks match this filter.")}`;
  }
  function taskRow(t) {
    const d = dueFor(t), late = isLate(t);
    return `<div class="task${t.done ? " done" : ""}">
      <input type="checkbox" id="chk-${esc(t.id)}" data-toggle="${esc(t.id)}" ${t.done ? "checked" : ""} aria-label="Mark ${esc(t.title)} done">
      <div class="t" data-edit="tasks" data-id="${esc(t.id)}">
        <div class="title">${esc(t.title)}</div>
        <div class="meta">${t.category ? `<span>${esc(t.category)}</span>` : ""}${d && t.due ? `<span>due ${fmtDate(d)}</span>` : ""}${late ? `<span class="late">Overdue</span>` : ""}${t.notes ? `<span>${esc(t.notes.length > 80 ? t.notes.slice(0, 80) + "…" : t.notes)}</span>` : ""}</div>
      </div>
      <span class="who">${esc(ownerLabel(t.owner || "both"))}</span>
    </div>`;
  }

  function viewBudget() {
    const total = num(S.settings.budget);
    const rows = [...S.budget].sort(byOrder);
    const head = `<div class="bar"><h2>Budget</h2><button class="btn primary" data-add="budget">Add a category</button></div>`;
    if (!rows.length) return head + emptyState("No budget categories yet", "Add categories like venue, catering and photography to track targets, quotes and payments.");
    const pctSum = rows.reduce((a, r) => a + (num(r.pct) || 0), 0);
    let committed = 0, paid = 0;
    const body = rows.map((r) => {
      const target = total != null && r.pct != null ? total * r.pct / 100 : null;
      const c = Math.max(num(r.quoted) || 0, num(r.paid) || 0);
      committed += c; paid += num(r.paid) || 0;
      const over = target != null && c > target;
      const pctUsed = target ? Math.min(100, c / target * 100) : 0;
      const status = !c ? `<span class="pill quiet">No quote</span>` : over ? `<span class="pill over">Over ${money(c - target)}</span>` : target != null ? `<span class="pill">${money(target - c)} left</span>` : `<span class="pill quiet">Quoted</span>`;
      return `<tr data-edit="budget" data-id="${esc(r.id)}">
        <td><div style="font-weight:500">${esc(r.category)}</div><div class="meter"><span class="${over ? "over" : ""}" style="width:${pctUsed.toFixed(0)}%"></span></div></td>
        <td class="r num">${r.pct != null ? esc(r.pct) + "%" : "—"}</td>
        <td class="r num">${money(target)}</td>
        <td class="r num">${r.quoted != null ? money(r.quoted) : "—"}</td>
        <td class="r num">${r.paid != null ? money(r.paid) : "—"}</td>
        <td>${status}</td></tr>`;
    }).join("");
    const left = total != null ? total - committed : null;
    const pays = rows.filter((r) => r.depositDue).map((r) => ({ ...r, d: new Date(r.depositDue + "T00:00:00") })).sort((a, b) => a.d - b.d);
    return head + `
      ${total == null ? `<div class="notice">Set a total budget under Big decisions to turn these percentages into dollar targets.</div>` : ""}
      <div class="kpis">
        <div class="panel kpi"><div class="eyebrow">Total budget</div><div class="v num">${money(total)}</div></div>
        <div class="panel kpi"><div class="eyebrow">Committed</div><div class="v num">${money(committed)}</div></div>
        <div class="panel kpi"><div class="eyebrow">Paid so far</div><div class="v num">${money(paid)}</div></div>
        <div class="panel kpi"><div class="eyebrow">Uncommitted</div><div class="v num ${left != null && left < 0 ? "neg" : ""}">${money(left)}</div></div>
      </div>
      ${Math.round(pctSum) !== 100 ? `<div class="notice">Category targets add up to ${Math.round(pctSum)}% of the budget, not 100%.</div>` : ""}
      <div class="panel tablewrap"><table>
        <thead><tr><th>Category</th><th class="r">Share</th><th class="r">Target</th><th class="r">Quoted</th><th class="r">Paid</th><th>Status</th></tr></thead>
        <tbody>${body}</tbody></table></div>
      <div class="payments"><h3>Upcoming payments</h3>
        ${pays.length ? pays.map((p) => `<div class="payrow"><span>${esc(p.category)}${p.depositAmount ? ` · <span class="num">${money(p.depositAmount)}</span>` : ""}</span><span class="num ${p.d < today() ? "late" : "muted"}">${fmtDate(p.d)}</span></div>`).join("") : `<p class="muted" style="margin:0;font-size:14px">Add a payment due date to a category and it will show up here.</p>`}
      </div>`;
  }

  const vendorKey = (v) => (v.type || "").trim() || v.category || "Other";
  const score = (v) => {
    const parts = [v.scoreStyle, v.scoreBudget, v.scoreReviews].map(num);
    return parts.some((x) => x != null) ? parts.reduce((a, x) => a + (x || 0), 0) : null;
  };
  const extUrl = (u) => /^https?:\/\//.test(u) ? u : "https://" + u;
  const igUrl = (h) => "https://instagram.com/" + String(h).replace(/^@/, "");
  const shortCount = (n) => n == null ? "" : n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n);
  const priceRange = (v) => v.priceLow != null && v.priceHigh != null ? `${money(v.priceLow)}–${money(v.priceHigh)}` : v.priceLow != null ? `from ${money(v.priceLow)}` : v.price != null ? money(v.price) : "—";
  const stageLabel = (k) => (STAGES.find(([s]) => s === k) || STAGES[0])[1];
  function emailFor(v) {
    if (v.emailDraft) return v.emailDraft;
    const b = S.research.find((r) => r.type === vendorKey(v));
    return b?.template ? b.template.replaceAll("{name}", v.name || "") : "";
  }

  function viewVendors() {
    const vb = (k, l) => `<button type="button" data-vview="${k}" aria-pressed="${vendorView === k}">${l}</button>`;
    const head = `<div class="bar"><h2>Vendors</h2><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <div class="filters" role="group" aria-label="Vendor view">${vb("pipeline", "Pipeline")}${vb("compare", "Compare")}</div>
      <button class="btn primary" data-add="vendors">Add a vendor</button></div></div>`;
    return head + (vendorView === "compare" ? viewCompare() : viewPipeline());
  }

  function viewPipeline() {
    if (!S.vendors.length) return emptyState("No vendors yet", "Track every venue, caterer and photographer you look at, from first search to signed contract.");
    return `<div class="stages">${STAGES.map(([k, l]) => {
      const vs = S.vendors.filter((v) => (v.stage || "researching") === k).sort(byOrder);
      if (k === "passed" && !vs.length) return "";
      return `<div class="stage"><h3>${l} <span class="n">${vs.length}</span></h3>
        ${vs.length ? vs.map((v) => `<button class="panel vcard" data-edit="vendors" data-id="${esc(v.id)}">
          <span class="name">${esc(v.name)}</span>
          <span class="sub">${esc(vendorKey(v))}${v.price != null || v.priceLow != null ? ` · <span class="num">${priceRange(v)}</span>` : ""}</span>
          ${score(v) != null ? `<span class="score num">Scored ${score(v)}/30</span>` : ""}
          ${v.notes ? `<span class="sub">${esc(v.notes.length > 90 ? v.notes.slice(0, 90) + "…" : v.notes)}</span>` : ""}
        </button>`).join("") : `<div class="none">None yet</div>`}</div>`;
    }).join("")}</div>`;
  }

  function viewCompare() {
    const keys = [...new Set([
      ...S.research.map((r) => (r.type || "").trim()).filter(Boolean),
      ...S.vendors.filter((v) => score(v) != null || (v.type || "").trim()).map(vendorKey),
    ])];
    if (!keys.length) return emptyState("No vendor research yet",
      "Start a research brief for the vendor you're hiring next. Claude finds the top options near you, scores the best five on style, budget and reviews, and lines them up here side by side with an outreach email for each.")
      + `<div style="text-align:center;margin-top:14px"><button class="btn primary" data-add="research">Start a research brief</button></div>`;
    const key = keys.includes(compareKey) ? compareKey : keys[0];
    const brief = S.research.find((r) => (r.type || "").trim() === key);
    const vs = S.vendors.filter((v) => vendorKey(v) === key).sort((a, b) =>
      (a.stage === "passed") - (b.stage === "passed") || (score(b) ?? -1) - (score(a) ?? -1) || byOrder(a, b));
    let rank = 0;
    const ranked = vs.map((v) => ({ v, rank: v.stage !== "passed" && score(v) != null ? ++rank : null, s: score(v) }));

    const nav = `<div class="cmpnav"><div class="filters">${keys.map((k) => `<button type="button" data-compare="${esc(k)}" aria-pressed="${k === key}">${esc(k)}</button>`).join("")}</div>
      <button class="btn" data-add="research">New research brief</button></div>`;

    const briefHtml = brief ? `<section class="panel brief">
        <div class="top"><div><div class="eyebrow">Research brief</div><h3>${esc(key)}</h3></div>
          <button class="btn" data-edit="research" data-id="${esc(brief.id)}">Edit brief</button></div>
        <dl class="facts">
          <div><dt>Style</dt><dd>${esc(brief.style || "—")}</dd></div>
          <div><dt>Budget</dt><dd class="num">${brief.budgetLow != null || brief.budgetHigh != null ? `${money(brief.budgetLow)}–${money(brief.budgetHigh)}` : "—"}</dd></div>
          <div><dt>Deal-breakers</dt><dd>${esc(brief.dealBreakers || "None listed")}</dd></div>
        </dl>
        ${brief.status === "requested" ? `<div class="notice">Ready for research. In Claude Code, say: <b>"Run vendor research for the ${esc(key)} brief in the wedding hub."</b></div>` : ""}
        ${brief.sendTip ? `<div class="muted" style="font-size:14px"><b>When to send:</b> ${esc(brief.sendTip)}</div>` : ""}
      </section>`
      : `<section class="panel brief"><div class="top"><div><div class="eyebrow">No brief yet</div><h3>${esc(key)}</h3></div>
        <button class="btn" data-add="research">Add a brief</button></div></section>`;

    if (!vs.length) return nav + briefHtml + emptyState("Nothing to compare yet", "Once research runs, the top five options appear here, ranked.");

    const table = `<div class="panel tablewrap"><table class="cmp">
      <thead><tr><th>#</th><th>Vendor</th><th>Score</th><th class="r">Style</th><th class="r">Budget</th><th class="r">Reviews</th><th class="r">Price</th><th>Rating</th><th>Stage</th></tr></thead>
      <tbody>${ranked.map(({ v, rank, s }) => `<tr data-edit="vendors" data-id="${esc(v.id)}">
        <td class="num">${rank ?? ""}</td>
        <td><span class="vname">${esc(v.name)}</span></td>
        <td class="num">${s != null ? `${s}/30<div class="meter"><span style="width:${(s / 30 * 100).toFixed(0)}%"></span></div>` : "—"}</td>
        <td class="r num">${v.scoreStyle ?? "—"}</td><td class="r num">${v.scoreBudget ?? "—"}</td><td class="r num">${v.scoreReviews ?? "—"}</td>
        <td class="r num" style="white-space:nowrap">${priceRange(v)}</td>
        <td class="num" style="white-space:nowrap">${v.rating != null ? `★ ${esc(v.rating)}` : ""}${v.reviewCount != null ? ` · ${esc(v.reviewCount)}` : ""}</td>
        <td><span class="pill ${v.stage === "booked" ? "" : "quiet"}">${stageLabel(v.stage)}</span></td>
      </tr>`).join("")}</tbody></table></div>`;

    const cards = `<div class="vdetails">${ranked.map(({ v, rank, s }) => {
      const email = emailFor(v);
      return `<article class="panel vdetail${v.stage === "passed" ? " passed" : ""}">
        <header>${rank ? `<span class="rank num">${rank}</span>` : ""}<div><h3>${esc(v.name)}</h3>${v.business && v.business !== v.name ? `<div class="sub">${esc(v.business)}</div>` : ""}</div>
          <span class="pill ${v.stage === "booked" ? "" : "quiet"}">${stageLabel(v.stage)}</span></header>
        <div class="links">${v.link ? `<a href="${esc(extUrl(v.link))}" target="_blank" rel="noopener">Website</a>` : ""}${v.instagram ? `<a href="${esc(igUrl(v.instagram))}" target="_blank" rel="noopener">@${esc(String(v.instagram).replace(/^@/, ""))}</a>${v.followers != null ? `<span class="muted num">${shortCount(v.followers)} followers</span>` : ""}` : ""}</div>
        ${s != null ? `<div class="scores"><div><b class="num">${v.scoreStyle ?? "—"}</b><span>Style</span></div><div><b class="num">${v.scoreBudget ?? "—"}</b><span>Budget</span></div><div><b class="num">${v.scoreReviews ?? "—"}</b><span>Reviews</span></div></div>` : ""}
        ${v.whyFit ? `<p class="why">${esc(v.whyFit)}</p>` : ""}
        <dl class="facts"><div><dt>Price for your size</dt><dd class="num">${priceRange(v)}</dd></div>
          <div><dt>Reviews</dt><dd class="num">${v.rating != null ? `★ ${esc(v.rating)}` : "—"}${v.reviewCount != null ? ` from ${esc(v.reviewCount)}` : ""}</dd></div>
          ${v.contact ? `<div><dt>Contact</dt><dd>${esc(v.contact)}</dd></div>` : ""}</dl>
        ${v.reviewQuote ? `<blockquote>“${esc(v.reviewQuote)}”${v.reviewDate ? `<cite>${esc(v.reviewDate)}</cite>` : ""}</blockquote>` : ""}
        ${v.redFlag ? `<div class="flag"><b>Watch out:</b> ${esc(v.redFlag)}</div>` : ""}
        ${email ? `<details id="det-${esc(v.id)}"><summary>Outreach email</summary><pre class="email" id="email-${esc(v.id)}">${esc(email)}</pre></details>` : ""}
        <div class="acts">${email ? `<button class="btn primary" data-copy="${esc(v.id)}">Copy email</button>` : ""}
          ${(v.stage || "researching") === "researching" ? `<button class="btn" data-contacted="${esc(v.id)}">Mark contacted</button>` : ""}
          <button class="btn" data-edit="vendors" data-id="${esc(v.id)}">Edit</button></div>
      </article>`;
    }).join("")}</div>`;
    return nav + briefHtml + table + cards;
  }

  function viewIdeas() {
    const head = `<div class="bar"><h2>Ideas</h2><button class="btn primary" data-add="ideas">Add an idea</button></div>`;
    if (!S.ideas.length) return head + emptyState("Start your mood board", "Save links, notes and colors you love. Add a color code to an idea to build your palette.");
    const colors = S.ideas.filter((i) => /^#[0-9a-f]{3,8}$/i.test(i.color || ""));
    return head + `
      ${colors.length ? `<div class="eyebrow" style="margin-bottom:8px">Palette</div><div class="swatches">${colors.map((c) => `<div class="sw"><i style="background:${esc(c.color)}"></i>${esc(c.title)}</div>`).join("")}</div>` : ""}
      <div class="ideas">${[...S.ideas].sort(byOrder).map((i) => `<div class="panel idea" data-edit="ideas" data-id="${esc(i.id)}">
        ${/^#[0-9a-f]{3,8}$/i.test(i.color || "") ? `<div class="chipcolor" style="background:${esc(i.color)}"></div>` : ""}
        ${i.tag ? `<span class="eyebrow">${esc(i.tag)}</span>` : ""}
        <h3>${esc(i.title)}</h3>
        ${i.note ? `<p>${esc(i.note)}</p>` : ""}
        ${i.link ? `<a href="${esc(/^https?:\/\//.test(i.link) ? i.link : "https://" + i.link)}" target="_blank" rel="noopener">${esc(i.link.replace(/^https?:\/\//, "").slice(0, 60))}</a>` : ""}
      </div>`).join("")}</div>`;
  }

  function emptyState(title, body) {
    return `<div class="empty"><strong>${esc(title)}</strong>${esc(body)}</div>`;
  }

  // ---------- editor ----------
  const opt = (pairs, val) => pairs.map(([v, l]) => `<option value="${esc(v)}"${String(val ?? "") === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("");
  const SCHEMAS = {
    tasks: { name: "task", fields: () => [
      ["title", "Task", "text"],
      ["bucket", "When", "select", BUCKETS.map((b) => [b.key, b.label])],
      ["owner", "Who", "select", [["both", "Both"], ["me", me()], ["partner", partner()]]],
      ["category", "Category", "select", [["", "—"], ...CATEGORIES.map((c) => [c, c])]],
      ["due", "Exact due date (optional)", "date"],
      ["notes", "Notes", "textarea"],
      ["done", "Done", "check"],
    ], defaults: { bucket: "m12", owner: "both" } },
    decisions: { name: "decision", fields: () => [
      ["title", "Decision", "text"],
      ["status", "Status", "select", DSTATUS],
      ["decision", "What you chose", "text"],
      ["notes", "Options and notes", "textarea"],
      ["unlocks", "What it unlocks", "text"],
    ], defaults: { status: "open", order: 50 } },
    budget: { name: "budget category", fields: () => [
      ["category", "Category", "text"],
      ["pct", "Share of budget (%)", "number"],
      ["quoted", "Quoted (USD)", "number"],
      ["paid", "Paid so far (USD)", "number"],
      ["depositDue", "Next payment due", "date"],
      ["depositAmount", "Next payment amount (USD)", "number"],
      ["notes", "Notes", "textarea"],
    ], defaults: { order: 50 } },
    vendors: { name: "vendor", fields: () => [
      ["name", "Name", "text"],
      ["category", "Category", "select", CATEGORIES.map((c) => [c, c])],
      ["stage", "Stage", "select", STAGES],
      ["price", "Price or quote (USD)", "number"],
      ["contact", "Contact", "text"],
      ["link", "Website", "text"],
      ["notes", "Notes", "textarea"],
      ["_h", "Research details", "heading"],
      ["type", "Vendor type (e.g. Photographer)", "text"],
      ["business", "Business name", "text"],
      ["instagram", "Instagram handle", "text"],
      ["followers", "Instagram followers", "number"],
      ["rating", "Average rating (out of 5)", "number"],
      ["reviewCount", "Number of reviews", "number"],
      ["priceLow", "Typical price, low (USD)", "number"],
      ["priceHigh", "Typical price, high (USD)", "number"],
      ["scoreStyle", "Style match (0–10)", "number"],
      ["scoreBudget", "Budget fit (0–10)", "number"],
      ["scoreReviews", "Review strength (0–10)", "number"],
      ["whyFit", "Why they fit", "textarea"],
      ["reviewQuote", "Recent review quote", "textarea"],
      ["reviewDate", "Review date and source", "text"],
      ["redFlag", "Red flag", "text"],
      ["emailDraft", "Outreach email", "textarea"],
    ], defaults: { stage: "researching", category: "Venue" } },
    research: { name: "research brief", fields: () => [
      ["type", "Vendor type (e.g. Photographer)", "text"],
      ["category", "Budget category", "select", CATEGORIES.map((c) => [c, c])],
      ["style", "Your style in 3–5 words", "text"],
      ["budgetLow", "Budget for this vendor, low (USD)", "number"],
      ["budgetHigh", "Budget for this vendor, high (USD)", "number"],
      ["dealBreakers", "Deal-breakers", "textarea"],
      ["status", "Status", "select", [["requested", "Ready for Claude to research"], ["done", "Research done"], ["draft", "Still drafting"]]],
      ["_h", "Filled in after research", "heading"],
      ["template", "Email template for the other options ({name} = vendor)", "textarea"],
      ["sendTip", "Best time to send", "text"],
    ], defaults: { status: "requested", category: "Photo & video" } },
    ideas: { name: "idea", fields: () => [
      ["title", "Title", "text"],
      ["tag", "Tag", "select", IDEA_TAGS.map((t) => [t, t])],
      ["note", "Note", "textarea"],
      ["link", "Link", "text"],
      ["color", "Color code (e.g. #8FA89B)", "text"],
    ], defaults: { tag: "Other" } },
  };
  const NUMERIC = new Set(["pct", "quoted", "paid", "price", "depositAmount", "followers", "rating", "reviewCount", "priceLow", "priceHigh", "scoreStyle", "scoreBudget", "scoreReviews", "budgetLow", "budgetHigh"]);

  function openEditor(col, id) {
    const sc = SCHEMAS[col]; if (!sc) return;
    const item = id ? S[col].find((x) => x.id === id) : { ...sc.defaults };
    if (!item) return;
    const fields = sc.fields().map(([k, label, type, opts]) => {
      const fid = `ed-${col}-${k}`;
      const v = item[k];
      if (type === "heading") return `<div class="eyebrow" style="margin-top:8px;padding-top:12px;border-top:1px solid var(--line)">${esc(label)}</div>`;
      if (type === "select") return `<label class="f">${esc(label)}<select id="${fid}" name="${k}">${opt(opts, v)}</select></label>`;
      if (type === "textarea") return `<label class="f">${esc(label)}<textarea id="${fid}" name="${k}">${esc(v || "")}</textarea></label>`;
      if (type === "check") return `<label class="check"><input type="checkbox" id="${fid}" name="${k}" ${v ? "checked" : ""}> ${esc(label)}</label>`;
      return `<label class="f">${esc(label)}<input id="${fid}" name="${k}" type="${type}" ${type === "number" ? 'step="any" min="0"' : ""} value="${esc(v ?? "")}"${k === "title" || k === "name" || (col === "research" && k === "type") || (k === "category" && type === "text") ? " required" : ""}></label>`;
    }).join("");
    $("#layer").innerHTML = `<div class="scrim" id="scrim"><form class="panel sheet" id="editor">
      <h2>${id ? "Edit" : "New"} ${esc(sc.name)}</h2>${fields}
      <div class="actions">${id ? `<button type="button" class="btn danger" id="del">Delete</button>` : "<span></span>"}
      <div class="right"><button type="button" class="btn" id="cancel">Cancel</button><button class="btn primary" type="submit">Save</button></div></div>
    </form></div>`;
    const form = $("#editor");
    form.querySelector("input,select,textarea")?.focus();
    const close = () => { $("#layer").innerHTML = ""; };
    $("#cancel").onclick = close;
    $("#scrim").addEventListener("click", (e) => { if (e.target.id === "scrim") close(); });
    form.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    const del = $("#del");
    if (del) del.onclick = async () => {
      if (!del.classList.contains("armed")) { del.classList.add("armed"); del.textContent = "Tap again to delete"; return; }
      if (await remove(col, id)) { close(); toast("Deleted"); }
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const data = id ? {} : { ...sc.defaults };
      for (const [k, , type] of sc.fields()) {
        if (type === "heading") continue;
        const el = form.elements[k];
        if (type === "check") data[k] = el.checked;
        else if (NUMERIC.has(k)) data[k] = num(el.value);
        else data[k] = el.value.trim();
      }
      if (!id && col === "tasks") data.done = !!data.done;
      if (await save(col, id, data)) {
        if (col === "research") { compareKey = data.type; vendorView = "compare"; store.set("compareKey", compareKey); store.set("vendorView", vendorView); render(); }
        close(); toast("Saved");
      }
    };
  }

  // ---------- events ----------
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-tab],[data-add],[data-edit],[data-filter],[data-vview],[data-compare],[data-copy],[data-contacted]");
    if (!t) return;
    if (t.dataset.vview) { vendorView = t.dataset.vview; store.set("vendorView", vendorView); render(); return; }
    if (t.dataset.compare) { compareKey = t.dataset.compare; store.set("compareKey", compareKey); render(); return; }
    if (t.dataset.contacted) { if (await save("vendors", t.dataset.contacted, { stage: "contacted" })) toast("Moved to Contacted"); return; }
    if (t.dataset.copy) {
      const v = S.vendors.find((x) => x.id === t.dataset.copy); if (!v) return;
      const text = emailFor(v);
      try { await navigator.clipboard.writeText(text); toast("Email copied"); }
      catch {
        const det = document.getElementById("det-" + v.id), pre = document.getElementById("email-" + v.id);
        if (det) det.open = true;
        if (pre) { const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
        toast("Email selected. Press Ctrl+C or Cmd+C to copy.");
      }
      return;
    }
    if (t.dataset.tab) { tab = t.dataset.tab; store.set("tab", tab); render(); return; }
    if (t.dataset.filter) { taskFilter = t.dataset.filter; store.set("taskFilter", taskFilter); render(); return; }
    if (t.dataset.add) { openEditor(t.dataset.add); return; }
    if (t.dataset.edit) { openEditor(t.dataset.edit, t.dataset.id); }
  });
  document.addEventListener("change", async (e) => {
    const id = e.target.dataset?.toggle; if (!id) return;
    await save("tasks", id, { done: e.target.checked });
  });
  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "basicsForm") return;
    e.preventDefault();
    const f = e.target.elements;
    const data = {
      myName: f.myName.value.trim(), partnerName: f.partnerName.value.trim(),
      weddingDate: f.weddingDate.value, budget: num(f.budget.value), guests: num(f.guests.value),
      location: f.location.value.trim(),
    };
    if (!db) { toast("Saving isn't available in this view."); return; }
    try { await db.doc("meta/settings").set({ ...S.settings, ...data }); toast("Basics saved"); }
    catch (err) { writeFailed(err); }
  });

  start().finally(() => { startedLookup = true; renderNotice(); });
})();
