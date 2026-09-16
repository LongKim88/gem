/* =========================================================================
   JEM 관리자 SPA
   - 가게 계정: 내 상품(업로드/10개 제한/삭제) · B2B 피드(주문) · 주문(보낸/받은)
   - 플랫폼 계정: 전체 가게 · 전체 주문 · 계정 발급
   ========================================================================= */
(function () {
  "use strict";

  const root = document.getElementById("admin");
  const state = {
    me: null,
    cats: [],
    catMap: {},
    tab: "products",           // 가게: products | feed | orders
    ordersSub: "received",     // sent | received
    feed: { category: "", kind: "", today: false },
    ptab: "supply",            // 플랫폼: supply | settle | shops | orders | issue
    editing: null,             // 수정 중인 상품 id (null = 신규 등록)
    supplyGroup: "day",        // 공급 상품 구분: day | week | month
    settle: { status: "", period: "all" }, // 정산 필터
  };

  /* ---------- 유틸 ---------- */
  const KIND_LABEL = { new: "신상", signature: "대표" };
  const STATUS_LABEL = { requested: "요청", accepted: "수락됨", shipped: "발송", done: "완료", canceled: "취소" };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function icon(cat) { return (state.catMap[cat] && state.catMap[cat].icon) || "🛍️"; }
  function catName(cat) { return (state.catMap[cat] && state.catMap[cat].name) || cat || ""; }
  /* 카테고리의 subcats/brands 에서 id → 표시 이름 */
  function optName(cat, key, id) {
    const c = state.catMap[cat];
    const o = c && (c[key] || []).find((x) => x.id === id);
    return o ? o.name : id || "";
  }
  /* 상품을 걸 수 있는 카테고리 (구매대행처럼 상담만 하는 칸은 제외) */
  function catalogCats() {
    return state.cats.filter((c) => c.mode === "direct" && !c.consult);
  }
  function ph(iconStr) { return `<div class="ph">${esc(iconStr)}</div>`; }
  function imgOr(url, iconStr, alt) {
    if (url && String(url).trim())
      return `<img src="${esc(url)}" alt="${esc(alt || "")}" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:'${esc(iconStr)}'}))" />`;
    return ph(iconStr);
  }

  async function jget(url) {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    const d = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error((d && d.error) || "오류 " + r.status), { code: d && d.code });
    return d;
  }
  async function jsend(url, method, body) {
    const r = await fetch(url, {
      method, headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body || {}),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error((d && d.error) || "오류 " + r.status), { code: d && d.code });
    return d;
  }
  async function jform(url, formData, method) {
    const r = await fetch(url, { method: method || "POST", body: formData });
    const d = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error((d && d.error) || "오류 " + r.status), { code: d && d.code });
    return d;
  }

  function toast(msg, isErr) {
    let t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = "toast show" + (isErr ? " err" : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = "toast" + (isErr ? " err" : ""); }, 2400);
  }

  /* ---------- 부트 ---------- */
  async function boot() {
    try {
      state.cats = await jget("/api/categories");
      state.cats.forEach((c) => (state.catMap[c.id] = c));
    } catch (e) {}
    try { state.me = await jget("/api/auth/me"); } catch (e) { state.me = null; }
    render();
  }

  function render() {
    if (!state.me) return renderLogin();
    if (state.me.role === "platform") return renderPlatform();
    return renderShop();
  }

  /* =====================================================================
     로그인
     ===================================================================== */
  function renderLogin() {
    root.innerHTML = `
      <div class="login-wrap">
        <div class="brand"><span class="logo">B</span>베플리카</div>
        <div class="sub">가게 관리자 · 플랫폼 로그인</div>
        <div class="login-card">
          <h2>로그인</h2>
          <div class="field">
            <label>아이디</label>
            <input id="lg-user" type="text" autocomplete="username" placeholder="발급받은 아이디" />
          </div>
          <div class="field">
            <label>비밀번호</label>
            <input id="lg-pw" type="password" autocomplete="current-password" placeholder="비밀번호" />
          </div>
          <button class="btn-primary" id="lg-btn">로그인</button>
          <div class="err-msg" id="lg-err"></div>
        </div>
      </div>`;
    const btn = document.getElementById("lg-btn");
    const user = document.getElementById("lg-user");
    const pw = document.getElementById("lg-pw");
    const err = document.getElementById("lg-err");
    async function doLogin() {
      err.textContent = "";
      btn.disabled = true;
      try {
        state.me = await jsend("/api/auth/login", "POST", { username: user.value, password: pw.value });
        state.tab = "products"; state.ptab = "supply";
        render();
      } catch (e) { err.textContent = e.message; btn.disabled = false; }
    }
    btn.onclick = doLogin;
    pw.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
    user.focus();
  }

  async function logout() {
    try { await jsend("/api/auth/logout", "POST", {}); } catch (e) {}
    state.me = null; render();
  }

  /* =====================================================================
     가게 관리자 셸
     ===================================================================== */
  function shell(contentHtml, tabs, activeTab) {
    const navBtns = tabs.map((t) =>
      `<button data-tab="${t.id}" class="nav-item ${t.id === activeTab ? "on" : ""}">
         <span class="ic">${t.icon}</span><span class="lb">${t.label}</span>
       </button>`).join("");
    const roleInfo = state.me.role === "platform"
      ? '<span class="role-pill">본사</span>'
      : ` · ${esc(catName(state.me.category))}`;
    root.innerHTML = `
      <div class="admin-shell">
        <header class="a-topbar">
          <span class="logo">B</span>
          <span class="brand-name">베플리카 <b>Admin</b></span>
          <span class="spacer"></span>
          <div class="who">
            <b>${esc(state.me.name)}</b>
            <small>${esc(state.me.username)}${roleInfo}</small>
          </div>
          <button class="logout" id="btn-logout">로그아웃</button>
        </header>
        <div class="a-body">
          <nav class="a-sidebar">${navBtns}</nav>
          <main class="a-content" id="a-content">${contentHtml}</main>
        </div>
      </div>`;
    document.getElementById("btn-logout").onclick = logout;
    root.querySelectorAll(".a-sidebar button").forEach((b) => {
      b.onclick = () => onTab(b.getAttribute("data-tab"));
    });
  }

  const PW_TAB = { id: "password", icon: "🔑", label: "비밀번호" };
  const SHOP_TABS = [
    { id: "products", icon: "📦", label: "내 상품" },
    { id: "feed", icon: "🛒", label: "B2B 피드" },
    { id: "orders", icon: "🧾", label: "주문" },
    { id: "profile", icon: "⚙️", label: "내 정보" },
    PW_TAB,
  ];
  const PLAT_TABS = [
    { id: "supply", icon: "📦", label: "공급 상품" },
    { id: "settle", icon: "💰", label: "공급 정산" },
    { id: "shops", icon: "🏪", label: "가게" },
    { id: "orders", icon: "🧾", label: "주문" },
    { id: "issue", icon: "➕", label: "계정발급" },
    PW_TAB,
  ];

  function onTab(tab) {
    if (state.me.role === "platform") { state.ptab = tab; renderPlatform(); }
    else { state.tab = tab; renderShop(); }
  }

  function renderShop() {
    shell(`<div class="empty">불러오는 중…</div>`, SHOP_TABS, state.tab);
    if (state.tab === "products") loadProducts();
    else if (state.tab === "feed") loadFeed();
    else if (state.tab === "profile") loadProfile();
    else if (state.tab === "password") renderPassword();
    else loadOrders();
  }

  /* ---------- 내 상품 ---------- */
  async function loadProducts() {
    const c = document.getElementById("a-content");
    let data;
    try { data = await jget("/api/my/products"); }
    catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const { products, limit, count } = data;
    const isOfficial = state.me.role === "official";   // 직영 스토어 = 한도 없음 + 카테고리 직접 지정
    const edit = products.find((x) => x.id === state.editing) || null;
    if (state.editing && !edit) state.editing = null;   // 삭제된 상품을 수정 중이었으면 신규 모드로
    const unlimited = limit == null;
    const full = !unlimited && count >= limit;

    const list = products.length
      ? products.map((p) => {
        const place = [catName(p.category), optName(p.category, "subcats", p.subcat), optName(p.category, "brands", p.brand)]
          .filter(Boolean).join(" › ");
        return `
        <div class="p-item">
          <div class="p-thumb">${imgOr(p.thumb || p.image, icon(p.category || state.me.category), p.title)}</div>
          <div class="p-main">
            <div class="t"><span class="badge ${p.kind}">${KIND_LABEL[p.kind] || ""}</span>${esc(p.title)}</div>
            ${place ? `<div class="m">${esc(place)}</div>` : ""}
            <div class="m">${esc(p.description || "")}</div>
          </div>
          <div class="p-price">${esc(p.price || "문의")}</div>
          <button class="icon-btn" data-action="edit-product" data-id="${p.id}" title="수정">✏️</button>
          <button class="icon-btn" data-action="del-product" data-id="${p.id}" title="삭제">🗑️</button>
        </div>`;
      }).join("")
      : `<div class="empty" style="padding:24px 0">아직 등록한 상품이 없습니다.</div>`;

    const limitCard = unlimited
      ? `<div class="card">
          <div class="limit-note">📦 <b>직영 스토어</b> — 업로드 한도 없이 등록할 수 있습니다. 여기 올린 상품이 <b>고객 화면에 바로 노출</b>됩니다. (현재 ${count}개)</div>
        </div>`
      : `<div class="card">
          <div class="limit-meter">
            <div class="row">
              <b>업로드 한도</b>
              <span class="count"><span class="used">${count}</span> / ${limit}</span>
            </div>
            <div class="bar ${full ? "full" : ""}"><span style="width:${Math.min(100, Math.round((count / limit) * 100))}%"></span></div>
            ${full
              ? `<div class="limit-note locked">⚠️ 무료 한도(${limit}개)를 모두 사용했습니다. 추가 업로드는 추후 <b>유료 플랜</b>으로 제공될 예정입니다.</div>`
              : `<div class="limit-note">기본 ${limit}개까지 무료로 등록할 수 있습니다. (남은 슬롯 ${limit - count}개)</div>`}
          </div>
        </div>`;

    // 직영 계정만: 상품이 걸릴 위치(카테고리 › 하위분류 › 브랜드)를 직접 고른다
    const placeFields = isOfficial
      ? `<div class="row-2">
          <div class="field">
            <label>카테고리 *</label>
            <select name="category" id="up-cat">
              ${catalogCats().map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>하위분류 *</label>
            <select name="subcat" id="up-sub"></select>
          </div>
        </div>
        <div class="field">
          <label>브랜드 (선택)</label>
          <select name="brand" id="up-brand"></select>
        </div>`
      : "";

    c.innerHTML = `
      ${limitCard}

      <div class="card">
        <h2 class="sec">${edit ? "✏️ 상품 수정" : "＋ 상품 등록"}</h2>
        <form id="up-form">
          <div class="field">
            <label>상품명 *</label>
            <input name="title" type="text" placeholder="예: 오버핏 니트 가디건" ${full ? "disabled" : ""} />
          </div>
          ${placeFields}
          <div class="row-2">
            <div class="field">
              <label>가격</label>
              <input name="price" type="text" placeholder="예: 38,000원 / 문의" ${full ? "disabled" : ""} />
            </div>
            <div class="field">
              <label>구분</label>
              <select name="kind" ${full ? "disabled" : ""}>
                <option value="new">오늘의 신상</option>
                <option value="signature">대표 물품</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label>설명 (선택)</label>
            <input name="description" type="text" placeholder="예: 가을 신상 · 4color" ${full ? "disabled" : ""} />
          </div>
          <div class="field">
            <label>사진 ${edit ? "(바꿀 때만 선택 — 비워두면 기존 사진 유지)" : "(선택)"}</label>
            <input name="image" type="file" accept="image/*" ${full && !edit ? "disabled" : ""} />
          </div>
          <button class="btn-primary" type="submit" ${full && !edit ? "disabled" : ""}>${edit ? "수정 저장" : full ? "한도 초과 — 업로드 불가" : "상품 등록"}</button>
          ${edit ? `<button class="btn-ghost" type="button" id="up-cancel">취소</button>` : ""}
          <div class="err-msg" id="up-err"></div>
        </form>
      </div>

      <div class="card">
        <h2 class="sec">내가 등록한 상품 (${count})</h2>
        ${list}
      </div>`;

    // 카테고리를 고르면 그에 속한 하위분류·브랜드만 남긴다
    const catSel = document.getElementById("up-cat");
    function fillPlace() {
      const cat = state.catMap[catSel.value] || {};
      document.getElementById("up-sub").innerHTML =
        (cat.subcats || []).map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("");
      document.getElementById("up-brand").innerHTML =
        `<option value="">선택 안 함</option>` +
        (cat.brands || []).map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("");
    }
    if (catSel) { fillPlace(); catSel.onchange = fillPlace; }

    // 수정 모드: 기존 값으로 폼을 채운다 (하위분류·브랜드는 fillPlace 뒤여야 선택됨)
    const form = document.getElementById("up-form");
    if (edit) {
      form.title.value = edit.title || "";
      form.price.value = edit.price || "";
      form.description.value = edit.description || "";
      form.kind.value = edit.kind || "new";
      if (catSel && edit.category) { catSel.value = edit.category; fillPlace(); }
      if (form.subcat) form.subcat.value = edit.subcat || "";
      if (form.brand) form.brand.value = edit.brand || "";
      document.getElementById("up-cancel").onclick = () => { state.editing = null; loadProducts(); };
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    c.querySelectorAll('[data-action="edit-product"]').forEach((b) => {
      b.onclick = () => { state.editing = Number(b.getAttribute("data-id")); loadProducts(); };
    });

    // 삭제
    c.querySelectorAll('[data-action="del-product"]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm("이 상품을 삭제할까요?")) return;
        try {
          await fetch("/api/my/products/" + b.getAttribute("data-id"), { method: "DELETE" })
            .then((r) => { if (!r.ok) throw new Error("삭제 실패"); });
          toast("삭제되었습니다");
          loadProducts();
        } catch (e) { toast(e.message, true); }
      };
    });

    // 등록 / 수정 저장
    if (form && (edit || !full)) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const errEl = document.getElementById("up-err");
        errEl.textContent = "";
        const fd = new FormData(form);
        if (!String(fd.get("title") || "").trim()) { errEl.textContent = "상품명을 입력하세요."; return; }
        if (isOfficial && !String(fd.get("subcat") || "").trim()) {
          errEl.textContent = "카테고리와 하위분류를 선택하세요."; return;
        }
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true; btn.textContent = "저장 중…";
        try {
          if (edit) await jform("/api/my/products/" + edit.id, fd, "PATCH");
          else await jform("/api/my/products", fd);
          toast(edit ? "수정되었습니다 ✅" : "상품이 등록되었습니다 ✅");
          state.editing = null;
          loadProducts();
        } catch (e2) {
          errEl.textContent = e2.message;
          btn.disabled = false; btn.textContent = edit ? "수정 저장" : "상품 등록";
          if (e2.code === "LIMIT") loadProducts();
        }
      };
    }
  }

  /* ---------- 비밀번호 변경 (모든 역할 공통) ---------- */
  function renderPassword() {
    const c = document.getElementById("a-content");
    c.innerHTML = `
      <div class="card">
        <h2 class="sec">🔑 비밀번호 변경</h2>
        <form id="pw-form">
          <div class="field">
            <label>현재 비밀번호</label>
            <input name="current" type="password" autocomplete="current-password" />
          </div>
          <div class="field">
            <label>새 비밀번호 (8자 이상)</label>
            <input name="next" type="password" autocomplete="new-password" />
          </div>
          <div class="field">
            <label>새 비밀번호 확인</label>
            <input name="confirm" type="password" autocomplete="new-password" />
          </div>
          <button class="btn-primary" type="submit">변경</button>
          <div class="err-msg" id="pw-err"></div>
        </form>
      </div>`;

    const form = document.getElementById("pw-form");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("pw-err");
      errEl.textContent = "";
      const fd = new FormData(form);
      const next = String(fd.get("next") || "");
      if (next.length < 8) { errEl.textContent = "새 비밀번호는 8자 이상이어야 합니다."; return; }
      if (next !== String(fd.get("confirm") || "")) { errEl.textContent = "새 비밀번호가 서로 다릅니다."; return; }
      try {
        await jsend("/api/auth/password", "PATCH", { current: String(fd.get("current") || ""), next });
        toast("비밀번호가 변경되었습니다 ✅");
        form.reset();
      } catch (e2) { errEl.textContent = e2.message; }
    };
  }

  /* ---------- B2B 피드 ---------- */
  async function loadFeed() {
    const c = document.getElementById("a-content");
    const f = state.feed;
    const catChips = [{ id: "", name: "전체" }].concat(state.cats)
      .map((x) => `<button class="chip ${f.category === x.id ? "on" : ""}" data-filter="cat" data-val="${x.id}">${esc(x.name)}</button>`).join("");
    const kindChips = [{ v: "", n: "전체" }, { v: "new", n: "🆕 신상" }, { v: "signature", n: "⭐ 대표" }]
      .map((x) => `<button class="chip ${f.kind === x.v ? "on" : ""}" data-filter="kind" data-val="${x.v}">${esc(x.n)}</button>`).join("");
    const todayChip = `<button class="chip ${f.today ? "on" : ""}" data-filter="today" data-val="1">📅 오늘</button>`;

    c.innerHTML = `
      <div class="filters">${catChips}</div>
      <div class="filters">${kindChips}${todayChip}</div>
      <div id="feed-list"><div class="empty">불러오는 중…</div></div>`;

    c.querySelectorAll("[data-filter]").forEach((b) => {
      b.onclick = () => {
        const kind = b.getAttribute("data-filter");
        const val = b.getAttribute("data-val");
        if (kind === "cat") f.category = val;
        else if (kind === "kind") f.kind = val;
        else if (kind === "today") f.today = !f.today;
        loadFeed();
      };
    });

    const qs = [];
    if (f.category) qs.push("category=" + encodeURIComponent(f.category));
    if (f.kind) qs.push("kind=" + encodeURIComponent(f.kind));
    if (f.today) qs.push("today=1");
    let items = [];
    try { items = await jget("/api/feed" + (qs.length ? "?" + qs.join("&") : "")); }
    catch (e) { document.getElementById("feed-list").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

    const listEl = document.getElementById("feed-list");
    if (!items.length) { listEl.innerHTML = `<div class="empty">조건에 맞는 상품이 없습니다.</div>`; return; }

    listEl.innerHTML = items.map((p) => {
      const mine = p.shop_id === state.me.id;
      return `
      <div class="feed-card" data-pid="${p.id}">
        <div class="f-thumb">${imgOr(p.thumb || p.image, icon(p.shop_category), p.title)}</div>
        <div class="f-main">
          <div class="f-shop">${p.is_platform ? '<span class="supply-tag">본사 공급</span> ' : "🏪 "}${esc(p.shop_name)} · ${esc(catName(p.shop_category))}</div>
          <div class="f-title"><span class="badge ${p.kind}">${KIND_LABEL[p.kind] || ""}</span>${esc(p.title)}</div>
          <div class="f-price">${esc(p.price || "문의")}</div>
          ${mine
            ? `<div class="mine-tag">내 가게 상품 (주문 불가)</div>`
            : `<div class="order-row">
                 <input class="qty" type="number" min="1" value="1" aria-label="수량" />
                 <input class="note" type="text" placeholder="요청사항(선택)" />
                 <button class="btn-order" data-action="order" data-id="${p.id}">주문</button>
               </div>`}
        </div>
      </div>`;
    }).join("");

    listEl.querySelectorAll('[data-action="order"]').forEach((b) => {
      b.onclick = async () => {
        const card = b.closest(".feed-card");
        const qty = parseInt(card.querySelector(".qty").value, 10) || 1;
        const note = card.querySelector(".note").value;
        b.disabled = true; b.textContent = "…";
        try {
          await jsend("/api/orders", "POST", { product_id: Number(b.getAttribute("data-id")), qty, note });
          toast("주문이 접수되었습니다 ✅ (본사 경유)");
          b.textContent = "완료";
        } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = "주문"; }
      };
    });
  }

  /* ---------- 주문 ---------- */
  async function loadOrders() {
    const c = document.getElementById("a-content");
    c.innerHTML = `
      <div class="subtabs">
        <button data-sub="received" class="${state.ordersSub === "received" ? "on" : ""}">📥 받은 주문</button>
        <button data-sub="sent" class="${state.ordersSub === "sent" ? "on" : ""}">📤 보낸 주문</button>
      </div>
      <div id="orders-list"><div class="empty">불러오는 중…</div></div>`;
    c.querySelectorAll("[data-sub]").forEach((b) => {
      b.onclick = () => { state.ordersSub = b.getAttribute("data-sub"); loadOrders(); };
    });

    const listEl = document.getElementById("orders-list");
    const isReceived = state.ordersSub === "received";
    let rows = [];
    try { rows = await jget(isReceived ? "/api/my/orders/received" : "/api/my/orders/sent"); }
    catch (e) { listEl.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    if (!rows.length) { listEl.innerHTML = `<div class="empty">${isReceived ? "받은" : "보낸"} 주문이 없습니다.</div>`; return; }

    listEl.innerHTML = rows.map((o) => {
      const who = isReceived ? "구매: " + esc(o.buyer_name) : "판매: " + esc(o.seller_name);
      let actions = "";
      if (isReceived) {
        if (o.status === "requested") actions = `<button class="go" data-action="ost" data-id="${o.id}" data-st="accepted">수락</button><button class="danger" data-action="ost" data-id="${o.id}" data-st="canceled">거절</button>`;
        else if (o.status === "accepted") actions = `<button class="go" data-action="ost" data-id="${o.id}" data-st="shipped">발송</button><button class="danger" data-action="ost" data-id="${o.id}" data-st="canceled">취소</button>`;
        else if (o.status === "shipped") actions = `<button class="go" data-action="ost" data-id="${o.id}" data-st="done">완료</button>`;
      } else {
        if (o.status === "requested") actions = `<button class="danger" data-action="ost" data-id="${o.id}" data-st="canceled">주문 취소</button>`;
      }
      return `
      <div class="o-item">
        <div class="o-top">
          <div class="o-title">${esc(o.product_title)}</div>
          <span class="status ${o.status}">${STATUS_LABEL[o.status] || o.status}</span>
        </div>
        <div class="o-meta">${who} · 수량 ${o.qty} · 단가 ${esc(o.unit_price || "문의")}</div>
        ${o.note ? `<div class="o-meta">📝 ${esc(o.note)}</div>` : ""}
        <div class="o-meta">${esc((o.created_at || "").replace("T", " ").slice(0, 16))}</div>
        ${actions ? `<div class="o-actions">${actions}</div>` : ""}
      </div>`;
    }).join("");

    listEl.querySelectorAll('[data-action="ost"]').forEach((b) => {
      b.onclick = async () => {
        try {
          await jsend("/api/orders/" + b.getAttribute("data-id") + "/status", "PATCH", { status: b.getAttribute("data-st") });
          toast("주문 상태가 변경되었습니다");
          loadOrders();
        } catch (e) { toast(e.message, true); }
      };
    });
  }

  /* ---------- 내 정보 (프로필 수정) ---------- */
  async function loadProfile() {
    const c = document.getElementById("a-content");
    let p;
    try { p = await jget("/api/my/profile"); }
    catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

    c.innerHTML = `
      <div class="card">
        <h2 class="sec">대표 이미지</h2>
        <div class="cover-row">
          <div class="cover-prev">${imgOr(p.image, icon(p.category), p.name)}</div>
          <div class="cover-actions">
            <label class="btn-ghost" for="cover-file">📷 커버 사진 변경</label>
            <input id="cover-file" type="file" accept="image/*" hidden />
            <div class="hint2">가게 상세 페이지 상단에 크게 노출됩니다. (업로드 시 자동 최적화)</div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2 class="sec">가게 정보</h2>
        <div class="field">
          <label>가게명 · 카테고리</label>
          <input value="${esc(p.name)}  ·  ${esc(catName(p.category))}" disabled />
          <div class="hint2">가게명·카테고리는 본사(플랫폼)에서 관리합니다.</div>
        </div>
        <form id="prof-form">
          <div class="field"><label>한줄소개</label><input name="tagline" value="${esc(p.tagline || "")}" placeholder="예: 데일리 여성 캐주얼" /></div>
          <div class="field"><label>지역</label><input name="area" value="${esc(p.area || "")}" placeholder="예: 동대문 · 온라인" /></div>
          <div class="field"><label>소개</label><textarea name="intro" placeholder="가게 소개를 입력하세요">${esc(p.intro || "")}</textarea></div>
          <div class="row-2">
            <div class="field"><label>카카오 오픈채팅</label><input name="kakao" value="${esc(p.kakao || "")}" placeholder="https://open.kakao.com/..." /></div>
            <div class="field"><label>텔레그램</label><input name="telegram" value="${esc(p.telegram || "")}" placeholder="https://t.me/..." /></div>
          </div>
          <div class="field"><label>전화</label><input name="phone" value="${esc(p.phone || "")}" placeholder="예: 010-0000-0000" /></div>
          <div class="field"><label>매장 주소</label><input name="address" value="${esc(p.address || "")}" placeholder="예: 서울시 ..." /></div>
          <div class="field"><label>지도 링크</label><input name="mapUrl" value="${esc(p.mapUrl || "")}" placeholder="구글맵/네이버지도 URL" /></div>
          <button class="btn-primary" type="submit">저장</button>
          <div class="err-msg" id="prof-err"></div>
        </form>
      </div>`;

    // 커버 사진 업로드
    const cf = document.getElementById("cover-file");
    cf.onchange = async () => {
      if (!cf.files || !cf.files[0]) return;
      const fd = new FormData();
      fd.append("image", cf.files[0]);
      toast("커버 업로드 중…");
      try { await jform("/api/my/cover", fd); toast("커버 사진이 변경되었습니다 ✅"); loadProfile(); }
      catch (e) { toast(e.message, true); }
    };

    // 프로필 저장
    const form = document.getElementById("prof-form");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("prof-err");
      errEl.textContent = "";
      const body = Object.fromEntries(new FormData(form).entries());
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = "저장 중…";
      try { await jsend("/api/my/profile", "PATCH", body); toast("프로필이 저장되었습니다 ✅"); }
      catch (e2) { errEl.textContent = e2.message; }
      btn.disabled = false; btn.textContent = "저장";
    };
  }

  /* =====================================================================
     플랫폼(본사)
     ===================================================================== */
  function renderPlatform() {
    shell(`<div class="empty">불러오는 중…</div>`, PLAT_TABS, state.ptab);
    if (state.ptab === "supply") loadSupply();
    else if (state.ptab === "settle") loadSettlement();
    else if (state.ptab === "shops") loadPShops();
    else if (state.ptab === "orders") loadPOrders();
    else if (state.ptab === "password") renderPassword();
    else renderIssue();
  }

  /* ---------- 공급 정산 (대금청구 추적) ---------- */
  function won(n) { return (n || 0).toLocaleString("ko-KR") + "원"; }
  function priceNum(txt) { const d = String(txt || "").replace(/[^0-9]/g, ""); return d ? parseInt(d, 10) : 0; }
  function inPeriod(created, period) {
    if (period === "all") return true;
    const ym = String(created || "").slice(0, 7);
    const now = new Date();
    const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const pd = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prev = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, "0")}`;
    if (period === "this") return ym === cur;
    if (period === "last") return ym === prev;
    return true;
  }

  async function loadSettlement() {
    const c = document.getElementById("a-content");
    let orders;
    try { orders = await jget("/api/admin/supply-orders"); }
    catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const f = state.settle;

    let rows = orders.filter((o) => inPeriod(o.created_at, f.period));
    if (f.status) rows = rows.filter((o) => o.status === f.status);
    rows.forEach((o) => { o._amt = priceNum(o.unit_price) * o.qty; });

    const totalAmt = rows.filter((o) => o.status !== "canceled").reduce((s, o) => s + o._amt, 0);
    const totalQty = rows.reduce((s, o) => s + o.qty, 0);
    const pending = rows.filter((o) => o.status === "requested").length;

    // 가게별 청구 요약 (취소 제외 금액)
    const byShop = new Map();
    for (const o of rows) {
      if (!byShop.has(o.buyer_shop_id)) byShop.set(o.buyer_shop_id, { name: o.buyer_name, user: o.buyer_username, cnt: 0, qty: 0, amt: 0 });
      const g = byShop.get(o.buyer_shop_id);
      g.cnt++; g.qty += o.qty;
      if (o.status !== "canceled") g.amt += o._amt;
    }
    const shopRows = [...byShop.values()].sort((a, b) => b.amt - a.amt);

    const periodChip = (id, label) => `<button class="chip ${f.period === id ? "on" : ""}" data-flt="period" data-val="${id}">${label}</button>`;
    const statusChip = (id, label) => `<button class="chip ${f.status === id ? "on" : ""}" data-flt="status" data-val="${id}">${label}</button>`;

    const shopTable = shopRows.length
      ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>가게</th><th class="r">주문</th><th class="r">수량</th><th class="r">청구액</th></tr></thead>
          <tbody>
            ${shopRows.map((s) => `<tr>
              <td>${esc(s.name)} <span class="dim">${esc(s.user)}</span></td>
              <td class="r">${s.cnt}건</td><td class="r">${s.qty}</td>
              <td class="r gold">${won(s.amt)}</td></tr>`).join("")}
            <tr class="total"><td>합계</td><td class="r">${rows.length}건</td><td class="r">${totalQty}</td><td class="r gold">${won(totalAmt)}</td></tr>
          </tbody></table></div>`
      : `<div class="empty" style="padding:20px 0">해당 조건의 주문이 없습니다.</div>`;

    const detailTable = rows.length
      ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>일자</th><th>가게</th><th>상품</th><th class="r">수량</th><th class="r">단가</th><th class="r">금액</th><th>상태</th><th>메모</th></tr></thead>
          <tbody>
            ${rows.map((o) => `<tr>
              <td>${esc(String(o.created_at || "").slice(0, 10))}</td>
              <td>${esc(o.buyer_name)}</td>
              <td>${esc(o.product_title)}</td>
              <td class="r">${o.qty}</td>
              <td class="r">${esc(o.unit_price || "-")}</td>
              <td class="r ${o.status === "canceled" ? "dim" : "gold"}">${o.status === "canceled" ? "제외" : won(o._amt)}</td>
              <td><span class="status ${o.status}">${STATUS_LABEL[o.status] || o.status}</span></td>
              <td class="dim">${esc(o.note || "")}</td></tr>`).join("")}
          </tbody></table></div>`
      : `<div class="empty" style="padding:20px 0">해당 조건의 주문이 없습니다.</div>`;

    c.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="k">총 주문</div><div class="v">${rows.length}건</div></div>
        <div class="stat"><div class="k">총 청구액 <span class="dim">(취소 제외)</span></div><div class="v gold">${won(totalAmt)}</div></div>
        <div class="stat"><div class="k">확정 대기 <span class="dim">(요청)</span></div><div class="v">${pending}건</div></div>
      </div>
      <div class="flt-line"><span class="flt-label">기간</span>${periodChip("all", "전체")}${periodChip("this", "이번달")}${periodChip("last", "지난달")}</div>
      <div class="flt-line"><span class="flt-label">상태</span>${statusChip("", "전체")}${statusChip("requested", "요청")}${statusChip("accepted", "수락")}${statusChip("shipped", "발송")}${statusChip("done", "완료")}${statusChip("canceled", "취소")}</div>
      <div class="card wide">
        <h2 class="sec">가게별 청구 요약</h2>
        ${shopTable}
      </div>
      <div class="card wide">
        <h2 class="sec">상세 주문 내역 (${rows.length})</h2>
        ${detailTable}
      </div>`;

    c.querySelectorAll("[data-flt]").forEach((b) => {
      b.onclick = () => {
        const k = b.getAttribute("data-flt"), v = b.getAttribute("data-val");
        if (k === "period") f.period = v; else f.status = v;
        loadSettlement();
      };
    });
  }

  /* ---------- 본사 공급 상품 (일별/주별/월별 구분) ---------- */
  // 등록일(created_at)을 기준으로 기간 키/라벨 계산
  function periodKeyLabel(createdAt, gran) {
    const ds = String(createdAt || "").slice(0, 10); // YYYY-MM-DD
    if (gran === "month") {
      const [y, mo] = ds.split("-");
      return { key: ds.slice(0, 7), label: `${y}년 ${parseInt(mo, 10)}월` };
    }
    if (gran === "week") {
      const dt = new Date(ds + "T00:00:00");
      const dow = (dt.getDay() + 6) % 7; // 0 = 월요일
      const mon = new Date(dt); mon.setDate(dt.getDate() - dow);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      const p2 = (n) => String(n).padStart(2, "0");
      const full = (x) => `${x.getFullYear()}.${p2(x.getMonth() + 1)}.${p2(x.getDate())}`;
      const short = (x) => `${p2(x.getMonth() + 1)}.${p2(x.getDate())}`;
      return { key: full(mon), label: `${full(mon)} ~ ${short(sun)} 주` };
    }
    return { key: ds, label: ds.replace(/-/g, ".") }; // day
  }

  async function loadSupply() {
    const c = document.getElementById("a-content");
    let data;
    try { data = await jget("/api/admin/products"); }
    catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const products = data.products || [];
    const catOpts = state.cats.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("");
    const gran = state.supplyGroup || "day";

    function rowHtml(p) {
      return `
        <div class="p-item">
          <div class="p-thumb">${imgOr(p.thumb || p.image, icon(p.category), p.title)}</div>
          <div class="p-main">
            <div class="t"><span class="badge signature">${esc(catName(p.category))}</span>${esc(p.title)}</div>
            <div class="m">${esc(p.description || "")}${p.description ? " · " : ""}등록 ${esc(String(p.created_at || "").slice(0, 10))}</div>
          </div>
          <div class="p-price">${esc(p.price || "문의")}</div>
          <button class="icon-btn" data-action="del-supply" data-id="${p.id}" title="삭제">🗑️</button>
        </div>`;
    }

    let listHtml;
    if (!products.length) {
      listHtml = `<div class="empty" style="padding:24px 0">아직 등록한 공급 상품이 없습니다.</div>`;
    } else {
      const groups = new Map();
      for (const p of products) {
        const { key, label } = periodKeyLabel(p.created_at, gran);
        if (!groups.has(key)) groups.set(key, { label, items: [] });
        groups.get(key).items.push(p);
      }
      const keys = [...groups.keys()].sort().reverse(); // 최신 기간부터
      listHtml = keys.map((k) => {
        const g = groups.get(k);
        return `<div class="grp">
          <div class="grp-head"><span>${esc(g.label)}</span><span class="grp-count">${g.items.length}개</span></div>
          ${g.items.map(rowHtml).join("")}
        </div>`;
      }).join("");
    }

    const seg = (id, label) =>
      `<button data-group="${id}" class="${gran === id ? "on" : ""}">${label}</button>`;

    c.innerHTML = `
      <div class="card">
        <div class="limit-note">📦 여기 올린 상품은 <b>가게 사장만</b> B2B 피드에서 보고 주문합니다. 일반 소비자에게는 노출되지 않습니다. (업로드 한도 없음)</div>
      </div>
      <div class="card">
        <h2 class="sec">＋ 공급 상품 등록</h2>
        <form id="sup-form">
          <div class="field"><label>상품명 *</label><input name="title" placeholder="예: [본사공급] 베이직 티셔츠" /></div>
          <div class="row-2">
            <div class="field"><label>카테고리 *</label><select name="category">${catOpts}</select></div>
            <div class="field"><label>도매가</label><input name="price" placeholder="예: 도매 8,000원" /></div>
          </div>
          <div class="field"><label>설명 (선택)</label><input name="description" placeholder="예: 대량 입고 · 전 컬러" /></div>
          <div class="field"><label>사진 (선택)</label><input name="image" type="file" accept="image/*" /></div>
          <button class="btn-primary" type="submit">공급 상품 등록</button>
          <div class="err-msg" id="sup-err"></div>
        </form>
      </div>
      <div class="card">
        <div class="sec-row">
          <h2 class="sec" style="margin:0">등록한 공급 상품 (${products.length})</h2>
          <div class="subtabs seg3">${seg("day", "일별")}${seg("week", "주별")}${seg("month", "월별")}</div>
        </div>
        ${listHtml}
      </div>`;

    // 기간 토글 (일/주/월)
    c.querySelectorAll("[data-group]").forEach((b) => {
      b.onclick = () => { state.supplyGroup = b.getAttribute("data-group"); loadSupply(); };
    });
    // 삭제
    c.querySelectorAll('[data-action="del-supply"]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm("이 공급 상품을 삭제할까요?")) return;
        try {
          await fetch("/api/admin/products/" + b.getAttribute("data-id"), { method: "DELETE" })
            .then((r) => { if (!r.ok) throw new Error("삭제 실패"); });
          toast("삭제되었습니다"); loadSupply();
        } catch (e) { toast(e.message, true); }
      };
    });
    // 등록
    const form = document.getElementById("sup-form");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("sup-err");
      errEl.textContent = "";
      const fd = new FormData(form);
      if (!String(fd.get("title") || "").trim()) { errEl.textContent = "상품명을 입력하세요."; return; }
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = "등록 중…";
      try {
        await jform("/api/admin/products", fd);
        toast("공급 상품이 등록되었습니다 ✅");
        loadSupply();
      } catch (e2) {
        errEl.textContent = e2.message;
        btn.disabled = false; btn.textContent = "공급 상품 등록";
      }
    };
  }

  async function loadPShops() {
    const c = document.getElementById("a-content");
    let rows = [];
    try { rows = await jget("/api/admin/shops"); }
    catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    c.innerHTML = `<h2 class="sec">가게 (${rows.length})</h2>` + (rows.length
      ? rows.map((s) => `
        <div class="o-item">
          <div class="o-top">
            <div class="o-title">${esc(s.name)} <span class="role-pill">${esc(catName(s.category))}</span></div>
            <span class="status ${s.productCount >= s.productLimit ? "requested" : "shipped"}">${s.productCount}/${s.productLimit}</span>
          </div>
          <div class="o-meta">아이디: ${esc(s.username)} · 가입 ${esc((s.createdAt || "").slice(0, 10))}</div>
          ${s.tagline ? `<div class="o-meta">${esc(s.tagline)}</div>` : ""}
        </div>`).join("")
      : `<div class="empty">등록된 가게가 없습니다.</div>`);
  }

  async function loadPOrders() {
    const c = document.getElementById("a-content");
    let rows = [];
    try { rows = await jget("/api/admin/orders"); }
    catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    c.innerHTML = `<h2 class="sec">전체 주문 (${rows.length}) · 본사 경유</h2>` + (rows.length
      ? rows.map((o) => `
        <div class="o-item">
          <div class="o-top">
            <div class="o-title">${esc(o.product_title)}</div>
            <span class="status ${o.status}">${STATUS_LABEL[o.status] || o.status}</span>
          </div>
          <div class="o-meta">${esc(o.buyer_name)} → ${esc(o.seller_name)} · 수량 ${o.qty} · 단가 ${esc(o.unit_price || "문의")}</div>
          <div class="o-meta">${esc((o.created_at || "").replace("T", " ").slice(0, 16))}</div>
        </div>`).join("")
      : `<div class="empty">아직 주문이 없습니다.</div>`);
  }

  function renderIssue() {
    const c = document.getElementById("a-content");
    const catOpts = state.cats.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("");
    c.innerHTML = `
      <div class="card">
        <h2 class="sec">가게 계정 발급</h2>
        <form id="issue-form">
          <div class="row-2">
            <div class="field"><label>아이디 *</label><input name="username" placeholder="영문/숫자" /></div>
            <div class="field"><label>비밀번호 *</label><input name="password" placeholder="초기 비밀번호" /></div>
          </div>
          <div class="field"><label>가게명 *</label><input name="name" placeholder="예: 무드샵" /></div>
          <div class="row-2">
            <div class="field"><label>카테고리</label><select name="category">${catOpts}</select></div>
            <div class="field"><label>지역</label><input name="area" placeholder="예: 동대문 · 온라인" /></div>
          </div>
          <div class="field"><label>한줄소개</label><input name="tagline" placeholder="예: 데일리 여성 캐주얼" /></div>
          <div class="row-2">
            <div class="field"><label>카카오 오픈채팅</label><input name="kakao" placeholder="https://open.kakao.com/..." /></div>
            <div class="field"><label>텔레그램</label><input name="telegram" placeholder="https://t.me/..." /></div>
          </div>
          <button class="btn-primary" type="submit">계정 발급</button>
          <div class="err-msg" id="issue-err"></div>
          <div id="issue-result"></div>
        </form>
      </div>`;
    const form = document.getElementById("issue-form");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("issue-err");
      errEl.textContent = "";
      const fd = new FormData(form);
      const body = Object.fromEntries(fd.entries());
      if (!body.username || !body.password || !body.name) { errEl.textContent = "아이디·비밀번호·가게명은 필수입니다."; return; }
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = "발급 중…";
      try {
        await jsend("/api/admin/shops", "POST", body);
        document.getElementById("issue-result").innerHTML =
          `<div class="issued">✅ 발급 완료 — 아이디 <code>${esc(body.username)}</code> / 비밀번호 <code>${esc(body.password)}</code><br/>이 정보를 가게에 전달하세요.</div>`;
        form.reset();
        toast("계정이 발급되었습니다 ✅");
      } catch (e2) { errEl.textContent = e2.message; }
      btn.disabled = false; btn.textContent = "계정 발급";
    };
  }

  boot();
})();
