/* =========================================================================
   JEM · 공개(소비자) SPA — API 연동 버전
   화면 3종: 홈(#/) → 카테고리(#/cat/:catId) → 샵 상세(#/shop/:shopId)
   데이터는 서버 API(/api/...)에서 가져옵니다.
   ========================================================================= */
(function () {
  "use strict";

  const app = document.getElementById("app");
  let CATS = [];               // 카테고리 캐시
  const catMap = {};           // id → {name, icon}

  /* ---------- 유틸 ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function real(v) {
    return v && String(v).indexOf("여기에") === -1 ? v : "";
  }
  async function api(path) {
    const r = await fetch(path, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("API " + r.status);
    return r.json();
  }
  function contactBtn(cls, url, label) {
    return url
      ? `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener">${label}</a>`
      : `<button class="${cls}" type="button" onclick="window.__soon()">${label}</button>`;
  }
  function imgOrPlaceholder(url, icon, alt) {
    if (url && url.trim()) {
      return `<img src="${esc(url)}" alt="${esc(alt || "")}" loading="lazy" decoding="async"
                onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:'${esc(icon)}'}))" />`;
    }
    return `<div class="ph">${esc(icon)}</div>`;
  }
  function topbar(title, sub, backHash) {
    const back = backHash
      ? `<button class="back" onclick="location.hash='${backHash}'" aria-label="뒤로">‹</button>`
      : "";
    return `<header class="topbar">
      ${back}
      <div class="title">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ""}</div>
    </header>`;
  }
  function loading() {
    app.innerHTML = `<div class="view"><div class="empty">불러오는 중…</div></div>`;
  }
  function catIcon(id) { return (catMap[id] && catMap[id].icon) || "🛍️"; }
  function catName(id) { return (catMap[id] && catMap[id].name) || id; }

  /* ---------- 카테고리 로드 ---------- */
  async function ensureCats() {
    if (CATS.length) return;
    CATS = await api("/api/categories");
    CATS.forEach((c) => (catMap[c.id] = c));
  }

  /* ---------- 화면 1: 홈 ---------- */
  async function renderHome() {
    await ensureCats();
    const buttons = CATS.map(function (c) {
      const bg = c.image ? ` style="background-image:url('${esc(c.image)}')"` : "";
      const hasImg = c.image ? " has-img" : "";
      return `
      <button class="cat-btn${hasImg}"${bg} onclick="location.hash='#/cat/${esc(c.id)}'">
        <span class="cat-overlay"></span>
        <span class="cat-text">
          ${c.image ? "" : `<span class="emoji">${esc(c.icon || "▪️")}</span>`}
          <span class="label">${esc(c.name)}</span>
        </span>
      </button>`;
    }).join("");

    app.innerHTML = `
      <div class="view">
        <section class="home-hero">
          <span class="brand"><span class="logo">B</span>베플리카</span>
          <p class="hero-en">Golf &amp; Luxury Collection</p>
          <p>골프웨어부터 명품 패션까지,<br/>원하는 카테고리를 선택해 문의하세요.</p>
        </section>
        <div class="grid">${buttons}</div>
        <div class="home-note">
          💬 상품 문의는 각 샵의 <b>카카오톡 오픈채팅</b>으로 바로 연결됩니다.
        </div>
        <a class="admin-link" href="/admin">🔑 가게 관리자 로그인</a>
        <div class="footer">© 베플리카</div>
      </div>`;
    window.scrollTo(0, 0);
  }

  /* ---------- 화면 2: 카테고리(샵 목록) ---------- */
  async function renderCategory(catId, subcat) {
    await ensureCats();
    if (!catMap[catId]) return renderHome();
    // 직판(우리샵) 모드 카테고리는 업체 목록 대신 하위카테고리 + 상품 직접 노출
    if (catMap[catId].mode === "direct") return renderDirectCategory(catMap[catId], subcat);
    loading();
    let shops = [];
    try { shops = await api("/api/shops?category=" + encodeURIComponent(catId)); }
    catch (e) { shops = []; }

    const cards =
      shops.length
        ? shops
            .map(
              (s) => `
        <div class="shop-card" onclick="location.hash='#/shop/${esc(s.id)}'">
          <div class="thumb">${imgOrPlaceholder(s.image, catIcon(catId), s.name)}</div>
          <div class="info">
            <h3>${esc(s.name)}</h3>
            <div class="tagline">${esc(s.tagline || "")}</div>
            ${s.area ? `<span class="area">📍 ${esc(s.area)}</span>` : ""}
          </div>
          <div class="chev">›</div>
        </div>`
            )
            .join("")
        : `<div class="empty">등록된 샵이 없습니다.<br/>곧 업데이트될 예정입니다.</div>`;

    app.innerHTML = `
      <div class="view">
        ${topbar(catName(catId), `${shops.length}곳`, "#/")}
        <div class="list">${cards}</div>
        <div class="footer">© 베플리카</div>
      </div>`;
    window.scrollTo(0, 0);
  }

  /* ---------- 화면 2-B: 직판(우리샵) 카테고리 — 하위카테고리 + 상품 ---------- */
  async function renderDirectCategory(cat, subcat) {
    const subs = cat.subcats || [];
    const selected = (subcat && subs.some((s) => s.id === subcat)) ? subcat : (subs[0] && subs[0].id);
    loading();
    let data;
    try { data = await api("/api/direct/" + encodeURIComponent(cat.id) + "/products"); }
    catch (e) { data = { products: [], store: null }; }
    const items = (data.products || []).filter((p) => p.subcat === selected);
    const store = data.store || {};
    const kakao = real(store.kakao);
    const phone = real(store.phone);
    const icon = catIcon(cat.id);
    const selName = (subs.find((s) => s.id === selected) || {}).name || "";

    const nav = subs.map((s) =>
      `<button class="subnav-item ${s.id === selected ? "on" : ""}" onclick="location.hash='#/cat/${esc(cat.id)}/${esc(s.id)}'">
         <span class="e">${esc(s.icon || "")}</span>${esc(s.name)}
       </button>`).join("");

    const grid = items.length
      ? `<div class="prod-grid">${items.map((p) => `
          <div class="prod-card">
            <div class="prod-thumb">${imgOrPlaceholder(p.thumb || p.image, icon, p.title)}</div>
            <div class="prod-body">
              <div class="prod-title">${esc(p.title)}</div>
              ${p.description ? `<div class="prod-desc">${esc(p.description)}</div>` : ""}
              <div class="prod-price">${esc(p.price || "문의")}</div>
            </div>
          </div>`).join("")}</div>`
      : `<div class="empty" style="padding:40px 20px">해당 상품이 준비 중입니다.</div>`;

    const bookBar = (kakao || phone)
      ? `<div class="book-bar">
          ${contactBtn("kakao", kakao, "💬 카카오 문의")}
          ${phone ? `<a class="phone" href="tel:${esc(phone)}">📞 전화</a>` : ""}
        </div>`
      : "";

    app.innerHTML = `
      <div class="view detail">
        ${topbar(cat.name, "직영 스토어", "#/")}
        <div class="subnav">${nav}</div>
        <section class="section">
          <h2>${esc(selName)} <small style="color:var(--muted);font-weight:600;font-size:12px">${items.length}개</small></h2>
          ${grid}
        </section>
        <div class="footer">© 베플리카 · 직영 판매 상품</div>
      </div>
      ${bookBar}`;
    window.scrollTo(0, 0);
  }

  /* ---------- 화면 3: 샵 상세 ---------- */
  async function renderShop(shopId) {
    await ensureCats();
    loading();
    let shop;
    try { shop = await api("/api/shops/" + encodeURIComponent(shopId)); }
    catch (e) { return renderHome(); }

    const icon = catIcon(shop.category);
    const kakao = real(shop.kakao);
    const telegram = real(shop.telegram);
    const mapUrl = real(shop.mapUrl);
    const phone = real(shop.phone);

    const products = shop.products || [];
    const news = products.filter((p) => p.kind === "new");
    const sigs = products.filter((p) => p.kind === "signature");

    function productGrid(list) {
      return `<div class="prod-grid">${list
        .map(
          (p) => `<div class="prod-card">
            <div class="prod-thumb">${imgOrPlaceholder(p.thumb || p.image, icon, p.title)}</div>
            <div class="prod-body">
              <div class="prod-title">${esc(p.title)}</div>
              ${p.description ? `<div class="prod-desc">${esc(p.description)}</div>` : ""}
              <div class="prod-price">${esc(p.price || "문의")}</div>
            </div>
          </div>`
        )
        .join("")}</div>`;
    }

    const newsSection = news.length
      ? `<section class="section"><h2>🆕 오늘의 신상</h2>${productGrid(news)}</section>` : "";
    const sigSection = sigs.length
      ? `<section class="section"><h2>⭐ 대표 물품</h2>${productGrid(sigs)}</section>` : "";
    const emptyProducts = products.length ? "" :
      `<section class="section"><div class="empty" style="padding:24px">아직 등록된 상품이 없습니다.</div></section>`;

    const noContact = !kakao;
    const inlineCta = `<section class="section">
        <h2>⚡ 빠른 문의</h2>
        <div class="cta-row">
          ${contactBtn("kakao", kakao, "💬 카카오톡")}
        </div>
        ${noContact ? `<p style="color:var(--muted);font-size:12.5px;margin:10px 0 0;">연락처 준비 중입니다.</p>` : ""}
      </section>`;

    const location = shop.address
      ? `<section class="section">
           <h2>🗺️ 매장 위치</h2>
           <div class="addr-box">
             <input id="addr" value="${esc(shop.address)}" readonly />
             <button onclick="window.__copyAddr()">복사</button>
           </div>
           <div class="copied" id="copied">주소가 복사되었습니다! ✅</div>
           ${mapUrl ? `<a class="btn-map" href="${esc(mapUrl)}" target="_blank" rel="noopener">🗺️ 지도로 열기</a>` : ""}
         </section>`
      : "";

    const bookBar = `<div class="book-bar">
        ${contactBtn("kakao", kakao, "💬 카카오 오픈톡")}
        ${phone ? `<a class="phone" href="tel:${esc(phone)}">📞 전화</a>` : ""}
      </div>`;

    app.innerHTML = `
      <div class="view detail">
        ${topbar(shop.name, catName(shop.category), "#/cat/" + shop.category)}
        <div class="hero">
          ${imgOrPlaceholder(shop.image, icon, shop.name)}
          <div class="overlay">
            <h1>${esc(shop.name)}</h1>
            <p>${esc(shop.tagline || "")}${shop.area ? " · 📍 " + esc(shop.area) : ""}</p>
          </div>
        </div>
        ${shop.intro ? `<section class="section"><h2>🛎️ 소개</h2><p>${esc(shop.intro)}</p></section>` : ""}
        ${newsSection}
        ${sigSection}
        ${emptyProducts}
        ${inlineCta}
        ${location}
        <div class="footer">© 베플리카 · 표시된 정보는 변동될 수 있습니다.</div>
      </div>
      ${bookBar}`;
    window.scrollTo(0, 0);
  }

  window.__soon = function () {
    alert("연락처 준비 중입니다. 곧 오픈 예정입니다! 🙏");
  };
  window.__copyAddr = function () {
    const input = document.getElementById("addr");
    if (!input) return;
    const done = () => {
      const el = document.getElementById("copied");
      if (el) { el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 1800); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(input.value).then(done).catch(() => { input.select(); document.execCommand("copy"); done(); });
    } else { input.select(); document.execCommand("copy"); done(); }
  };

  /* ---------- 라우터 ---------- */
  function route() {
    const hash = location.hash || "#/";
    const parts = hash.replace(/^#\//, "").split("/").filter(Boolean);
    if (parts[0] === "cat" && parts[1]) return renderCategory(parts[1], parts[2]);
    if (parts[0] === "shop" && parts[1]) return renderShop(parts[1]);
    return renderHome();
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("DOMContentLoaded", route);
  if (document.readyState !== "loading") route();
})();
