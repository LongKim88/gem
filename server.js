/* =========================================================================
   JEM — API 서버 (Express + node:sqlite)
   실행: npm start  →  http://localhost:4600
   - 공개(소비자): 가게/상품 조회
   - 가게 관리자: 로그인, 내 상품 업로드(10개 제한)/삭제, B2B 피드, 주문
   - 플랫폼(본사): 전체 가게/주문 관리, 계정 발급
   ========================================================================= */
"use strict";

const express = require("express");
const session = require("express-session");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const { db, CATEGORIES, FREE_PRODUCT_LIMIT, seedIfEmpty, reseedIfStale } = require("./db");

seedIfEmpty();   // 비어있으면 샘플 시드
reseedIfStale(); // 카테고리 개편으로 옛 데모 데이터만 남았으면 새 구조로 재시드

const app = express();
const PORT = process.env.PORT || 4600;
app.set("trust proxy", 1); // Render/프록시 뒤 HTTPS 인식
app.disable("x-powered-by");

// 업로드 저장 위치: 배포 환경 영구 디스크(DATA_DIR)/uploads, 로컬은 프로젝트 uploads/
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------- 미들웨어 ---------- */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "jem-dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", secure: "auto", maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);

// 정적 파일 (앱 코드는 짧은 캐시)
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));
// 업로드 이미지: 파일명이 고유(불변)하므로 1년 강력 캐시
app.use(
  "/uploads",
  express.static(UPLOAD_DIR, {
    immutable: true,
    maxAge: "365d",
    setHeaders: (res) => res.setHeader("Cache-Control", "public, max-age=31536000, immutable"),
  })
);

// 이미지 업로드 (multer — 메모리 버퍼로 받아 sharp로 후처리)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 원본 8MB까지 허용(어차피 압축해서 저장)
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error("이미지 파일만 업로드할 수 있습니다."));
  },
});

/* 업로드 이미지 최적화
   - 상세용: 최대 1200px, WebP q78
   - 목록/피드 썸네일: 500x500 커버 크롭, WebP q72
   결과 파일명은 고유 → 장기 캐시 안전 */
async function processImage(buffer) {
  const base = "p_" + Date.now() + "_" + Math.round(Math.random() * 1e6);
  const detailName = base + ".webp";
  const thumbName = base + "_thumb.webp";
  await sharp(buffer)
    .rotate() // EXIF 방향 자동 보정 (폰 사진 대응)
    .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toFile(path.join(UPLOAD_DIR, detailName));
  await sharp(buffer)
    .rotate()
    .resize({ width: 500, height: 500, fit: "cover", position: "attention" })
    .webp({ quality: 72 })
    .toFile(path.join(UPLOAD_DIR, thumbName));
  return { image: "/uploads/" + detailName, thumb: "/uploads/" + thumbName };
}

/* 가게 커버(대표) 이미지 — 상세 히어로용 가로형 1장 */
async function processCover(buffer) {
  const name = "c_" + Date.now() + "_" + Math.round(Math.random() * 1e6) + ".webp";
  await sharp(buffer)
    .rotate()
    .resize({ width: 1200, height: 750, fit: "cover", position: "attention" })
    .webp({ quality: 80 })
    .toFile(path.join(UPLOAD_DIR, name));
  return "/uploads/" + name;
}

/* ---------- 헬퍼 ---------- */
function currentShop(req) {
  if (!req.session || !req.session.shopId) return null;
  return db.prepare("SELECT * FROM shops WHERE id = ? AND active = 1").get(req.session.shopId) || null;
}
function publicShop(s) {
  return {
    id: s.id, name: s.name, category: s.category, area: s.area,
    tagline: s.tagline, intro: s.intro, kakao: s.kakao, telegram: s.telegram,
    phone: s.phone, address: s.address, mapUrl: s.map_url, image: s.image,
  };
}
function requireAuth(req, res, next) {
  const s = currentShop(req);
  if (!s) return res.status(401).json({ error: "로그인이 필요합니다.", code: "AUTH" });
  req.shop = s;
  next();
}
function requireShop(req, res, next) {
  requireAuth(req, res, () => {
    // 'official'(직영 스토어) = 우리가 직접 파는 상품의 주인. 'shop' = 추후 입점 가게.
    if (req.shop.role !== "shop" && req.shop.role !== "official")
      return res.status(403).json({ error: "가게 또는 직영 계정만 사용할 수 있습니다.", code: "ROLE" });
    next();
  });
}
function requirePlatform(req, res, next) {
  requireAuth(req, res, () => {
    if (req.shop.role !== "platform")
      return res.status(403).json({ error: "플랫폼 관리자만 접근할 수 있습니다.", code: "ROLE" });
    next();
  });
}
function activeProductCount(shopId) {
  return db.prepare("SELECT COUNT(*) AS n FROM products WHERE shop_id = ? AND active = 1").get(shopId).n;
}
/* 업로드 한도 — 직영 스토어는 우리 물건이므로 무제한(null). 입점 가게만 한도 적용. */
function productLimit(shop) {
  return shop.role === "official" ? null : shop.product_limit;
}
/* 직영 상품이 고객 화면의 어느 칸에 걸릴지 — 잘못된 값이면 throw.
   입점 가게 상품은 가게 카테고리를 그대로 따라가므로 전부 NULL. */
function productPlace(req) {
  if (req.shop.role !== "official") return { category: null, subcat: null, brand: null };
  const cat = catalogCat(String(req.body.category || "").trim());
  if (!cat) throw new Error("카테고리를 선택하세요.");
  const subcat = String(req.body.subcat || "").trim();
  if (!(cat.subcats || []).some((x) => x.id === subcat)) throw new Error("하위분류를 선택하세요.");
  const brand = String(req.body.brand || "").trim();
  if (brand && !(cat.brands || []).some((x) => x.id === brand)) throw new Error("브랜드 값이 올바르지 않습니다.");
  return { category: cat.id, subcat, brand: brand || null };
}
/* 상세 블록 [{image,text}] — 폼에서 JSON 문자열로 온다. 빈 블록은 버림. */
function parseDetail(raw) {
  if (raw == null || raw === "") return null;
  let arr;
  try { arr = JSON.parse(raw); } catch (e) { throw new Error("상세 내용 형식이 올바르지 않습니다."); }
  if (!Array.isArray(arr)) throw new Error("상세 내용 형식이 올바르지 않습니다.");
  const blocks = arr
    .map((b) => ({ image: String((b && b.image) || "").trim(), text: String((b && b.text) || "").trim() }))
    .filter((b) => b.image || b.text);
  if (blocks.length > 30) throw new Error("상세 블록은 30개까지입니다.");
  // 업로드 경로 또는 http(s) URL 만 허용 (javascript: 등 차단)
  for (const b of blocks)
    if (b.image && !/^(\/uploads\/|https?:\/\/)/.test(b.image))
      throw new Error("이미지 주소가 올바르지 않습니다.");
  return blocks.length ? JSON.stringify(blocks) : null;
}
/* 상품을 걸 수 있는 카테고리인지 (직판 + 상담 전용 제외) */
function catalogCat(catId) {
  const c = CATEGORIES.find((x) => x.id === catId);
  return c && c.mode === "direct" && !c.consult ? c : null;
}

/* =======================================================================
   공개(소비자) API
   ======================================================================= */
app.get("/api/categories", (req, res) => res.json(CATEGORIES));

// 가게 목록 (?category=women)
app.get("/api/shops", (req, res) => {
  const { category } = req.query;
  let rows;
  if (category) {
    rows = db
      .prepare("SELECT * FROM shops WHERE role='shop' AND active=1 AND category=? ORDER BY id")
      .all(category);
  } else {
    rows = db.prepare("SELECT * FROM shops WHERE role='shop' AND active=1 ORDER BY id").all();
  }
  res.json(rows.map(publicShop));
});

// 가게 상세 + 상품
app.get("/api/shops/:id", (req, res) => {
  const s = db
    .prepare("SELECT * FROM shops WHERE id=? AND role='shop' AND active=1")
    .get(req.params.id);
  if (!s) return res.status(404).json({ error: "가게를 찾을 수 없습니다." });
  const products = db
    .prepare("SELECT id, title, description, price, image, thumb, kind, created_at FROM products WHERE shop_id=? AND active=1 ORDER BY created_at DESC, id DESC")
    .all(s.id);
  res.json({ ...publicShop(s), products });
});

// 직판(우리샵) 카테고리 상품 — role 'official' 상점의 상품을 하위카테고리(subcat)와 함께 반환
// (업체가 아니라 우리가 직접 파는 형태. 소비자 shop 목록/피드엔 안 나옴)
app.get("/api/direct/:catId/products", (req, res) => {
  const cat = CATEGORIES.find((c) => c.id === req.params.catId);
  if (!cat || cat.mode !== "direct")
    return res.status(404).json({ error: "직판 카테고리가 아닙니다." });
  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.description, p.price, p.image, p.thumb, p.subcat, p.brand, p.created_at
       FROM products p JOIN shops s ON s.id = p.shop_id
       WHERE s.role='official' AND s.active=1 AND p.active=1
         AND COALESCE(p.category, s.category) = ?
       ORDER BY p.subcat, p.id`
    )
    .all(req.params.catId);
  // 직영 스토어: 해당 카테고리 전담 스토어가 있으면 그것, 없으면 공용 직영 스토어
  const store =
    db.prepare("SELECT name, kakao, phone FROM shops WHERE role='official' AND category=? AND active=1 LIMIT 1").get(req.params.catId) ||
    db.prepare("SELECT name, kakao, phone FROM shops WHERE role='official' AND active=1 ORDER BY id LIMIT 1").get();
  res.json({ products: rows, store: store || null });
});

// 상품 상세 — 링크 공유용. 직영 스토어의 노출 중인 상품만.
app.get("/api/products/:id", (req, res) => {
  const p = db
    .prepare(
      `SELECT p.id, p.title, p.description, p.price, p.image, p.thumb, p.category, p.subcat, p.brand, p.detail
       FROM products p JOIN shops s ON s.id = p.shop_id
       WHERE p.id=? AND s.role='official' AND s.active=1 AND p.active=1`
    )
    .get(req.params.id);
  if (!p) return res.status(404).json({ error: "상품을 찾을 수 없습니다." });
  const store =
    db.prepare("SELECT name, kakao, phone FROM shops WHERE role='official' AND category=? AND active=1 LIMIT 1").get(p.category) ||
    db.prepare("SELECT name, kakao, phone FROM shops WHERE role='official' AND active=1 ORDER BY id LIMIT 1").get();
  res.json({ product: p, store: store || null });
});

/* =======================================================================
   인증
   ======================================================================= */
/* 로그인 시도 제한 — 아이디+IP 조합으로 5회 실패 시 10분 잠금.
   상태는 login_locks 테이블에 있으므로 SQL 로 직접 조회·해제할 수 있다.
     SELECT * FROM login_locks;                        -- 잠긴 계정 보기
     DELETE FROM login_locks WHERE username='store';   -- 특정 계정 풀기 */
const LOGIN_MAX = 5;
const LOGIN_LOCK = "+10 minutes";

function loginKey(req, username) {
  return String(username).trim().toLowerCase() + "|" + req.ip;
}
/* 잠금이 걸려 있으면 남은 밀리초, 아니면 0 */
function loginLockedFor(key) {
  const row = db
    .prepare("SELECT fails, locked_until FROM login_locks WHERE key=? AND locked_until > datetime('now')")
    .get(key);
  if (!row || row.fails < LOGIN_MAX) return 0;
  return Math.max(0, new Date(row.locked_until.replace(" ", "T") + "Z") - Date.now());
}
function noteLoginFail(req, key, username) {
  // 유효기간이 지난 행은 카운트를 1부터 다시 시작 (INSERT ... ON CONFLICT 로 한 번에)
  db.prepare(
    `INSERT INTO login_locks (key, username, ip, fails, locked_until, updated_at)
     VALUES (?, ?, ?, 1, datetime('now', ?), datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       fails = CASE WHEN locked_until > datetime('now') THEN fails + 1 ELSE 1 END,
       locked_until = datetime('now', ?),
       updated_at = datetime('now')`
  ).run(key, String(username).trim(), req.ip || "", LOGIN_LOCK, LOGIN_LOCK);
  db.prepare("DELETE FROM login_locks WHERE locked_until <= datetime('now')").run();
}
function clearLoginFails(key) {
  db.prepare("DELETE FROM login_locks WHERE key=?").run(key);
}

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: "아이디와 비밀번호를 입력하세요." });

  const key = loginKey(req, username);
  const left = loginLockedFor(key);
  if (left > 0)
    return res.status(429).json({
      error: `로그인 시도가 너무 많습니다. ${Math.ceil(left / 60000)}분 후 다시 시도하세요.`,
      code: "LOCKED",
    });

  const s = db.prepare("SELECT * FROM shops WHERE username=? AND active=1").get(String(username).trim());
  if (!s || !bcrypt.compareSync(String(password), s.password_hash)) {
    noteLoginFail(req, key, username);
    return res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
  }
  clearLoginFails(key);
  req.session.shopId = s.id;
  res.json({ id: s.id, name: s.name, role: s.role, category: s.category, username: s.username });
});

// 비밀번호 변경 — 역할 무관, 로그인한 본인 계정
app.patch("/api/auth/password", requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (!bcrypt.compareSync(String(current || ""), req.shop.password_hash))
    return res.status(401).json({ error: "현재 비밀번호가 올바르지 않습니다." });
  if (String(next || "").length < 8)
    return res.status(400).json({ error: "새 비밀번호는 8자 이상이어야 합니다." });
  db.prepare("UPDATE shops SET password_hash=? WHERE id=?").run(bcrypt.hashSync(String(next), 10), req.shop.id);
  res.json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/auth/me", (req, res) => {
  const s = currentShop(req);
  if (!s) return res.json(null);
  res.json({ id: s.id, name: s.name, role: s.role, category: s.category, username: s.username });
});

/* =======================================================================
   가게 관리자 — 내 상품
   ======================================================================= */
app.get("/api/my/profile", requireShop, (req, res) => {
  res.json({
    ...publicShop(req.shop),
    username: req.shop.username,
    productLimit: req.shop.product_limit,
    productCount: activeProductCount(req.shop.id),
  });
});

// 연락처/소개 수정
app.patch("/api/my/profile", requireShop, (req, res) => {
  const b = req.body || {};
  db.prepare(
    "UPDATE shops SET tagline=?, area=?, intro=?, kakao=?, telegram=?, phone=?, address=?, map_url=? WHERE id=?"
  ).run(
    b.tagline ?? req.shop.tagline, b.area ?? req.shop.area, b.intro ?? req.shop.intro,
    b.kakao ?? req.shop.kakao, b.telegram ?? req.shop.telegram, b.phone ?? req.shop.phone,
    b.address ?? req.shop.address, b.mapUrl ?? req.shop.map_url, req.shop.id
  );
  res.json({ ok: true });
});

// 커버(대표) 이미지 업로드
app.post("/api/my/cover", requireShop, upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "이미지를 선택하세요." });
  try {
    const image = await processCover(req.file.buffer);
    db.prepare("UPDATE shops SET image=? WHERE id=?").run(image, req.shop.id);
    res.json({ ok: true, image });
  } catch (e) {
    res.status(400).json({ error: "이미지 처리 중 오류: " + e.message });
  }
});

// 상세 블록용 이미지 1장 업로드 — 저장은 상품 저장 시점에 JSON 으로
app.post("/api/my/upload", requireShop, upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "이미지를 선택하세요." });
  try {
    const out = await processImage(req.file.buffer);
    res.json({ image: out.image, thumb: out.thumb });
  } catch (e) {
    res.status(400).json({ error: "이미지 처리 중 오류: " + e.message });
  }
});

app.get("/api/my/products", requireShop, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM products WHERE shop_id=? AND active=1 ORDER BY created_at DESC, id DESC")
    .all(req.shop.id);
  res.json({
    products: rows,
    limit: productLimit(req.shop),
    count: rows.length,
  });
});

// 상품 업로드 (이미지 선택) — 입점 가게만 한도 적용, 직영은 무제한
app.post("/api/my/products", requireShop, upload.single("image"), async (req, res) => {
  const limit = productLimit(req.shop);
  const count = activeProductCount(req.shop.id);
  if (limit !== null && count >= limit) {
    return res.status(402).json({
      error: `무료 업로드 한도(${limit}개)를 초과했습니다. 추가 업로드는 추후 유료 플랜으로 제공될 예정입니다.`,
      code: "LIMIT",
      limit,
    });
  }
  const { title, description, price } = req.body || {};
  let { kind } = req.body || {};
  if (!title || !String(title).trim())
    return res.status(400).json({ error: "상품명을 입력하세요." });
  kind = kind === "signature" ? "signature" : "new";

  let place;
  try { place = productPlace(req); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const { category, subcat, brand } = place;

  // 이미지: 업로드 파일이 있으면 리사이즈·압축(WebP) + 썸네일 생성, 없으면 URL 사용
  let image = req.body.imageUrl || null;
  let thumb = null;
  if (req.file) {
    try {
      const out = await processImage(req.file.buffer);
      image = out.image;
      thumb = out.thumb;
    } catch (e) {
      return res.status(400).json({ error: "이미지 처리 중 오류: " + e.message });
    }
  }

  let detail;
  try { detail = parseDetail(req.body.detail); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const info = db
    .prepare("INSERT INTO products (shop_id, title, description, price, image, thumb, kind, category, subcat, brand, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(req.shop.id, String(title).trim(), description || null, price || null, image, thumb, kind, category, subcat, brand, detail);
  const product = db.prepare("SELECT * FROM products WHERE id=?").get(Number(info.lastInsertRowid));
  res.status(201).json({ product, count: count + 1, limit });
});

// 상품 수정 — 사진은 새로 올릴 때만 교체, 안 올리면 기존 사진 유지
app.patch("/api/my/products/:id", requireShop, upload.single("image"), async (req, res) => {
  const p = db.prepare("SELECT * FROM products WHERE id=? AND shop_id=? AND active=1").get(req.params.id, req.shop.id);
  if (!p) return res.status(404).json({ error: "상품을 찾을 수 없습니다." });

  const { title, description, price } = req.body || {};
  if (!title || !String(title).trim())
    return res.status(400).json({ error: "상품명을 입력하세요." });
  const kind = req.body.kind === "signature" ? "signature" : "new";

  let place;
  try { place = productPlace(req); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  let { image, thumb } = p;
  if (req.file) {
    try {
      const out = await processImage(req.file.buffer);
      image = out.image;
      thumb = out.thumb;
    } catch (e) {
      return res.status(400).json({ error: "이미지 처리 중 오류: " + e.message });
    }
  }

  let detail;
  try { detail = parseDetail(req.body.detail); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  db.prepare(
    "UPDATE products SET title=?, description=?, price=?, image=?, thumb=?, kind=?, category=?, subcat=?, brand=?, detail=? WHERE id=?"
  ).run(String(title).trim(), description || null, price || null, image, thumb, kind,
        place.category, place.subcat, place.brand, detail, p.id);
  res.json({ product: db.prepare("SELECT * FROM products WHERE id=?").get(p.id) });
});

app.delete("/api/my/products/:id", requireShop, (req, res) => {
  const p = db.prepare("SELECT * FROM products WHERE id=? AND shop_id=?").get(req.params.id, req.shop.id);
  if (!p) return res.status(404).json({ error: "상품을 찾을 수 없습니다." });
  db.prepare("UPDATE products SET active=0 WHERE id=?").run(p.id);
  res.json({ ok: true, count: activeProductCount(req.shop.id) });
});

/* =======================================================================
   B2B 피드 (가게 관리자 전용 · 매일 상품이 올라오는 공용 공간)
   ======================================================================= */
app.get("/api/feed", requireAuth, (req, res) => {
  const { category, kind, today } = req.query;
  // 가게 상품 + 본사 공급 상품 모두 포함 (소비자 API는 role='shop'만 조회하므로 본사 상품은 소비자에 노출 안 됨)
  const where = ["p.active=1", "s.active=1", "s.role IN ('shop','platform')"];
  const params = [];
  // 카테고리: 상품에 지정된 값(본사 공급) 우선, 없으면 가게 카테고리
  if (category) { where.push("COALESCE(p.category, s.category)=?"); params.push(category); }
  if (kind === "new" || kind === "signature") { where.push("p.kind=?"); params.push(kind); }
  if (today === "1") { where.push("date(p.created_at) = date('now','localtime')"); }
  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.description, p.price, p.image, p.thumb, p.kind, p.created_at,
              s.id AS shop_id, s.name AS shop_name,
              COALESCE(p.category, s.category) AS shop_category, s.area AS shop_area,
              (s.role='platform') AS is_platform
       FROM products p JOIN shops s ON s.id = p.shop_id
       WHERE ${where.join(" AND ")}
       ORDER BY p.created_at DESC, p.id DESC`
    )
    .all(...params);
  res.json(rows);
});

/* =======================================================================
   주문 (모든 주문은 플랫폼을 경유 — buyer/seller/platform 이 조회)
   ======================================================================= */
app.post("/api/orders", requireShop, (req, res) => {
  const { product_id, qty, note } = req.body || {};
  const p = db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(product_id);
  if (!p) return res.status(404).json({ error: "상품을 찾을 수 없습니다." });
  if (p.shop_id === req.shop.id)
    return res.status(400).json({ error: "본인 가게의 상품은 주문할 수 없습니다." });
  const q = Math.max(1, parseInt(qty, 10) || 1);
  const info = db
    .prepare(
      `INSERT INTO orders (buyer_shop_id, seller_shop_id, product_id, product_title, unit_price, qty, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.shop.id, p.shop_id, p.id, p.title, p.price, q, note || null);
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(Number(info.lastInsertRowid));
  res.status(201).json({ order });
});

// 내가 보낸 주문
app.get("/api/my/orders/sent", requireShop, (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.*, s.name AS seller_name FROM orders o JOIN shops s ON s.id=o.seller_shop_id
       WHERE o.buyer_shop_id=? ORDER BY o.created_at DESC, o.id DESC`
    )
    .all(req.shop.id);
  res.json(rows);
});

// 내가 받은 주문 (내 상품에 대한 주문)
app.get("/api/my/orders/received", requireShop, (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.*, b.name AS buyer_name FROM orders o JOIN shops b ON b.id=o.buyer_shop_id
       WHERE o.seller_shop_id=? ORDER BY o.created_at DESC, o.id DESC`
    )
    .all(req.shop.id);
  res.json(rows);
});

const ORDER_STATUSES = ["requested", "accepted", "shipped", "done", "canceled"];
app.patch("/api/orders/:id/status", requireShop, (req, res) => {
  const { status } = req.body || {};
  if (!ORDER_STATUSES.includes(status))
    return res.status(400).json({ error: "잘못된 상태값입니다." });
  const o = db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);
  if (!o) return res.status(404).json({ error: "주문을 찾을 수 없습니다." });
  const isSeller = o.seller_shop_id === req.shop.id;
  const isBuyer = o.buyer_shop_id === req.shop.id;
  if (!isSeller && !isBuyer)
    return res.status(403).json({ error: "이 주문을 변경할 권한이 없습니다." });
  // 구매자는 '요청' 상태에서만 취소 가능. 그 외 상태 변경은 판매자.
  if (isBuyer && !isSeller && !(status === "canceled" && o.status === "requested"))
    return res.status(403).json({ error: "구매자는 요청 상태에서만 취소할 수 있습니다." });
  db.prepare("UPDATE orders SET status=? WHERE id=?").run(status, o.id);
  res.json({ ok: true, status });
});

/* =======================================================================
   플랫폼(본사) — 전체 관리 + 계정 발급
   ======================================================================= */
app.get("/api/admin/shops", requirePlatform, (req, res) => {
  const rows = db.prepare("SELECT * FROM shops WHERE role='shop' ORDER BY id").all();
  res.json(
    rows.map((s) => ({
      ...publicShop(s),
      username: s.username,
      active: s.active,
      productCount: activeProductCount(s.id),
      productLimit: s.product_limit,
      createdAt: s.created_at,
    }))
  );
});

app.get("/api/admin/orders", requirePlatform, (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.*, b.name AS buyer_name, s.name AS seller_name
       FROM orders o JOIN shops b ON b.id=o.buyer_shop_id JOIN shops s ON s.id=o.seller_shop_id
       ORDER BY o.created_at DESC, o.id DESC`
    )
    .all();
  res.json(rows);
});

// 가게 계정 발급
app.post("/api/admin/shops", requirePlatform, (req, res) => {
  const b = req.body || {};
  if (!b.username || !b.password || !b.name)
    return res.status(400).json({ error: "아이디·비밀번호·가게명은 필수입니다." });
  const exists = db.prepare("SELECT 1 FROM shops WHERE username=?").get(String(b.username).trim());
  if (exists) return res.status(409).json({ error: "이미 존재하는 아이디입니다." });
  const hash = bcrypt.hashSync(String(b.password), 10);
  const info = db
    .prepare(
      "INSERT INTO shops (username, password_hash, role, name, category, area, tagline, kakao, telegram, phone) VALUES (?, ?, 'shop', ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      String(b.username).trim(), hash, b.name, b.category || null, b.area || null,
      b.tagline || null, b.kakao || null, b.telegram || null, b.phone || null
    );
  res.status(201).json({ id: Number(info.lastInsertRowid), username: b.username });
});

/* 본사 공급 상품 — 가게에게 뿌리는 도매 상품 (10개 한도 없음, 카테고리 지정)
   → B2B 피드에만 노출, 소비자 사이트에는 안 보임 */
app.get("/api/admin/products", requirePlatform, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM products WHERE shop_id=? AND active=1 ORDER BY created_at DESC, id DESC")
    .all(req.shop.id);
  res.json({ products: rows });
});

app.post("/api/admin/products", requirePlatform, upload.single("image"), async (req, res) => {
  const { title, description, price, category } = req.body || {};
  if (!title || !String(title).trim())
    return res.status(400).json({ error: "상품명을 입력하세요." });
  if (!category || !CATEGORIES.some((c) => c.id === category))
    return res.status(400).json({ error: "카테고리를 선택하세요." });
  let image = req.body.imageUrl || null;
  let thumb = null;
  if (req.file) {
    try {
      const out = await processImage(req.file.buffer);
      image = out.image;
      thumb = out.thumb;
    } catch (e) {
      return res.status(400).json({ error: "이미지 처리 중 오류: " + e.message });
    }
  }
  const info = db
    .prepare("INSERT INTO products (shop_id, title, description, price, image, thumb, category, kind) VALUES (?, ?, ?, ?, ?, ?, ?, 'new')")
    .run(req.shop.id, String(title).trim(), description || null, price || null, image, thumb, category);
  const product = db.prepare("SELECT * FROM products WHERE id=?").get(Number(info.lastInsertRowid));
  res.status(201).json({ product });
});

app.delete("/api/admin/products/:id", requirePlatform, (req, res) => {
  const p = db.prepare("SELECT * FROM products WHERE id=? AND shop_id=?").get(req.params.id, req.shop.id);
  if (!p) return res.status(404).json({ error: "상품을 찾을 수 없습니다." });
  db.prepare("UPDATE products SET active=0 WHERE id=?").run(p.id);
  res.json({ ok: true });
});

/* 공급 상품 주문 현황 (정산/대금청구용) — 본사가 판매자인 주문 = 공급 상품 주문 */
app.get("/api/admin/supply-orders", requirePlatform, (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.id, o.buyer_shop_id, o.product_id, o.product_title, o.unit_price, o.qty,
              o.note, o.status, o.created_at,
              b.name AS buyer_name, b.username AS buyer_username, b.category AS buyer_category,
              p.category AS product_category
       FROM orders o
       JOIN shops b ON b.id = o.buyer_shop_id
       LEFT JOIN products p ON p.id = o.product_id
       WHERE o.seller_shop_id = ?
       ORDER BY o.created_at DESC, o.id DESC`
    )
    .all(req.shop.id);
  res.json(rows);
});

/* 나이스 URL: /admin → 관리자 페이지 */
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

/* multer/기타 에러 핸들러 */
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || "요청 처리 중 오류" });
  next();
});

app.listen(PORT, () => {
  console.log(`JEM 서버 실행 → http://localhost:${PORT}`);
  console.log(`관리자 페이지 → http://localhost:${PORT}/admin`);
});
