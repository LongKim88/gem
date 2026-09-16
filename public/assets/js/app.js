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
          <p>골프 · 럭셔리 · 구매대행<br/>원하는 카테고리를 선택해 문의하세요.</p>
        </section>
        <div class="grid grid-stack">${buttons}</div>
        <div class="home-note">
          💬 상품 문의·주문은 <b>카카오톡 오픈채팅</b>으로 바로 연결됩니다.
        </div>
        <a class="admin-link" href="/admin">🔑 가게 관리자 로그인</a>
        <div class="footer">© 베플리카</div>
      </div>`;
    window.scrollTo(0, 0);
  }

  /* ---------- 화면 2: 카테고리(샵 목록) ---------- */
  async function renderCategory(catId, subcat, brand) {
    await ensureCats();
    if (!catMap[catId]) return renderHome();
    // 직판(우리샵) 모드 카테고리는 업체 목록 대신 하위카테고리(+브랜드) + 상품 직접 노출
    if (catMap[catId].mode === "direct") return renderDirectCategory(catMap[catId], subcat, brand);
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

  /* ---------- 화면 2-B: 직판 2단계 — 하위 카테고리 타일(홈과 동일한 형태) ---------- */
  function renderSubcatGrid(cat) {
    const buttons = (cat.subcats || []).map((s) => {
      const bg = s.image ? ` style="background-image:url('${esc(s.image)}')"` : "";
      const hasImg = s.image ? " has-img" : "";
      return `
      <button class="cat-btn sub-tile${hasImg}"${bg} onclick="location.hash='#/cat/${esc(cat.id)}/${esc(s.id)}'">
        <span class="cat-overlay"></span>
        <span class="cat-text">
          <span class="sub-tile-name">${esc(s.name)}</span>
        </span>
      </button>`;
    }).join("");

    app.innerHTML = `
      <div class="view">
        ${topbar(cat.name, "직영 스토어", "#/")}
        <div class="grid">${buttons}</div>
        <div class="footer">© 베플리카</div>
      </div>`;
    window.scrollTo(0, 0);
  }

  /* ---------- 화면 2-B': 구매대행 상담 페이지 ---------- */
  async function renderConsult(cat, subcat) {
    const sub = (cat.subcats || []).find((s) => s.id === subcat) || {};
    loading();
    let store = {};
    try {
      const d = await api("/api/direct/" + encodeURIComponent(cat.id) + "/products");
      store = d.store || {};
    } catch (e) {}
    const kakao = real(store.kakao);
    const phone = real(store.phone);

    const steps = [
      ["원하는 상품 알려주기", "브랜드·모델명, 또는 사진·상품 링크를 보내주세요."],
      ["견적 안내", "상품가 · 수수료 · 배송비를 포함한 총 금액을 안내드립니다."],
      ["결제 후 구매 진행", "확인해 주시면 현지에서 정품으로 구매를 진행합니다."],
      ["배송 및 수령", "진행 상황을 단계별로 안내드리고 국내로 배송합니다."],
    ];

    app.innerHTML = `
      <div class="view detail">
        ${topbar(sub.name || cat.name, cat.name, "#/cat/" + cat.id)}

        <section class="section consult-hero">
          <h2>💬 ${esc(sub.name || "")} 구매대행 상담</h2>
          <p>찾으시는 상품을 알려주시면 <b>대신 구매해서 배송</b>해 드립니다.<br/>
             매장에 없는 모델도 문의해 주세요.</p>
        </section>

        <section class="section">
          <h2>📋 진행 절차</h2>
          <ol class="steps">
            ${steps.map(([t, d]) => `
              <li>
                <div class="s-title">${esc(t)}</div>
                <div class="s-desc">${esc(d)}</div>
              </li>`).join("")}
          </ol>
        </section>

        <section class="section">
          <h2>📝 문의 시 알려주시면 빠릅니다</h2>
          <ul class="tips">
            <li>브랜드 / 모델명 (또는 상품 사진·링크)</li>
            <li>사이즈 · 색상 등 옵션</li>
            <li>희망 수량, 필요하신 시기</li>
          </ul>
        </section>

        <section class="section consult-cta">
          <a class="kakao-big" ${kakao ? `href="${esc(kakao)}" target="_blank" rel="noopener"` : `href="#" onclick="event.preventDefault();window.__soon()"`}>
            💬 카카오톡 오픈채팅으로 상담하기
          </a>
          <p class="cta-note">${kakao ? "버튼을 누르면 오픈채팅으로 연결됩니다." : "상담 채널 준비 중입니다. 곧 오픈 예정입니다."}</p>
        </section>

        <div class="footer">© 베플리카 · 구매대행</div>
      </div>
      <div class="book-bar">
        ${contactBtn("kakao", kakao, "💬 카카오 상담")}
        ${phone ? `<a class="phone" href="tel:${esc(phone)}">📞 전화</a>` : ""}
      </div>`;
    window.scrollTo(0, 0);
  }

  /* ---------- 화면 2-C: 직판 3단계 — 브랜드 타일 ---------- */
  function renderBrandGrid(cat, subcat) {
    const sub = (cat.subcats || []).find((s) => s.id === subcat) || {};
    const buttons = (cat.brands || []).map((b) => `
      <button class="cat-btn brand-tile" onclick="location.hash='#/cat/${esc(cat.id)}/${esc(subcat)}/${esc(b.id)}'" aria-label="${esc(b.name)}">
        <span class="cat-text">
          ${b.logo
            ? `<img class="brand-logo" src="${esc(b.logo)}" alt="${esc(b.name)}" loading="lazy" decoding="async"
                 onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'brand-tile-name',textContent:'${esc(b.name)}'}))" />`
            : `<span class="brand-tile-name">${esc(b.name)}</span>`}
        </span>
      </button>`).join("");

    app.innerHTML = `
      <div class="view">
        ${topbar(sub.name || cat.name, cat.name, "#/cat/" + cat.id)}
        <div class="grid">${buttons}</div>
        <div class="footer">© 베플리카</div>
      </div>`;
    window.scrollTo(0, 0);
  }

  /* ---------- 화면 2-D: 직판 4단계 — 상품 목록(+상단 브랜드 이동 칩) ---------- */
  async function renderDirectCategory(cat, subcat, brand) {
    const subs = cat.subcats || [];
    const brands = cat.brands || [];
    // 2단계: 하위 카테고리 미선택 → 하위 카테고리 타일
    if (subs.length && !subs.some((s) => s.id === subcat)) return renderSubcatGrid(cat);
    // 상담형 카테고리(구매대행): 상품 목록 대신 상담 페이지
    if (cat.consult) return renderConsult(cat, subcat);
    // 3단계: 브랜드가 있는 카테고리인데 브랜드 미선택 → 브랜드 타일
    if (brands.length && !brands.some((b) => b.id === brand)) return renderBrandGrid(cat, subcat);
    const selected = subcat;
    const selBrand = (brand && brands.some((b) => b.id === brand)) ? brand : "";
    loading();
    let data;
    try { data = await api("/api/direct/" + encodeURIComponent(cat.id) + "/products"); }
    catch (e) { data = { products: [], store: null }; }
    let items = (data.products || []).filter((p) => p.subcat === selected);
    if (selBrand) items = items.filter((p) => p.brand === selBrand);
    const store = data.store || {};
    const kakao = real(store.kakao);
    const phone = real(store.phone);
    const icon = catIcon(cat.id);
    const selName = (subs.find((s) => s.id === selected) || {}).name || "";

    // 상단 브랜드 이동 칩 — 다른 메이커로 바로 이동
    const brandNav = brands.length
      ? `<div class="brandnav">
           ${brands.map((b) =>
             `<button class="brand-chip ${b.id === selBrand ? "on" : ""}" onclick="location.hash='#/cat/${esc(cat.id)}/${esc(selected)}/${esc(b.id)}'">${esc(b.name)}</button>`
           ).join("")}
         </div>`
      : "";

    const brandName = (id) => (brands.find((b) => b.id === id) || {}).name || "";

    const grid = items.length
      ? `<div class="prod-grid">${items.map((p) => `
          <div class="prod-card" onclick="location.hash='#/p/${p.id}'">
            <div class="prod-thumb">${imgOrPlaceholder(p.thumb || p.image, icon, p.title)}</div>
            <div class="prod-body">
              ${p.brand && brandName(p.brand) ? `<div class="prod-brand">${esc(brandName(p.brand))}</div>` : ""}
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
        ${topbar(
          selBrand ? brandName(selBrand) : (selName || cat.name),
          selBrand ? cat.name + " · " + selName : cat.name,
          brands.length ? "#/cat/" + cat.id + "/" + selected : (subs.length ? "#/cat/" + cat.id : "#/")
        )}
        ${brandNav}
        <section class="section">
          <h2>${esc(selBrand ? brandName(selBrand) : selName)} <small style="color:var(--muted);font-weight:600;font-size:12px">${items.length}개</small></h2>
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

  /* ---------- 화면 3: 상품 상세 ---------- */
  async function renderProduct(id) {
    loading();
    await ensureCats();
    let d;
    try { d = await api("/api/products/" + encodeURIComponent(id)); }
    catch (e) {
      app.innerHTML = `<div class="view"><div class="empty">상품을 찾을 수 없습니다.</div></div>`;
      return;
    }
    const p = d.product;
    const store = d.store || {};
    const cat = catMap[p.category] || {};
    const sub = (cat.subcats || []).find((x) => x.id === p.subcat) || {};
    const brand = (cat.brands || []).find((x) => x.id === p.brand) || {};
    const kakao = real(store.kakao);
    const phone = real(store.phone);
    // 뒤로: 온 경로가 있으면 그 목록으로, 없으면 홈
    const back = p.category
      ? "#/cat/" + p.category + (p.subcat ? "/" + p.subcat + (p.brand ? "/" + p.brand : "") : "")
      : "#/";

    app.innerHTML = `
      <div class="view detail">
        ${topbar(brand.name || sub.name || cat.name || "상품", [cat.name, sub.name].filter(Boolean).join(" · "), back)}

        <div class="p-hero">${imgOrPlaceholder(p.image || p.thumb, cat.icon || "🛍️", p.title)}</div>

        <section class="section p-info">
          ${brand.name ? `<div class="prod-brand">${esc(brand.name)}</div>` : ""}
          <h1 class="p-name">${esc(p.title)}</h1>
          <div class="p-price">${esc(p.price || "문의")}</div>
          ${p.description ? `<p class="p-desc">${esc(p.description)}</p>` : ""}
        </section>

        <section class="section">
          <div class="p-meta">
            ${[["카테고리", cat.name], ["분류", sub.name], ["브랜드", brand.name]]
              .filter(([, v]) => v)
              .map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}
          </div>
        </section>

        <div class="book-bar">
          ${contactBtn("kakao", kakao, "💬 이 상품 문의")}
          ${phone ? `<a class="phone" href="tel:${esc(phone)}">📞 전화</a>` : ""}
        </div>
        <div class="footer">© 베플리카 · 직영 판매 상품</div>
      </div>`;
    window.scrollTo(0, 0);
  }

  /* ---------- 라우터 ---------- */
  function route() {
    const hash = location.hash || "#/";
    const parts = hash.replace(/^#\//, "").split("/").filter(Boolean);
    if (parts[0] === "cat" && parts[1]) return renderCategory(parts[1], parts[2], parts[3]);
    if (parts[0] === "p" && parts[1]) return renderProduct(parts[1]);
    if (parts[0] === "shop" && parts[1]) return renderShop(parts[1]);
    return renderHome();
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("DOMContentLoaded", route);
  if (document.readyState !== "loading") route();
})();
