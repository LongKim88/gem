/* =========================================================================
   JEM — 데이터베이스 (Node 내장 node:sqlite)
   - 테이블: shops(계정), products(상품), orders(주문)
   - 최초 실행 시 비어있으면 샘플 데이터 시드
   ========================================================================= */
"use strict";

const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");

// 데이터 저장 위치: 배포 환경에선 영구 디스크 경로(DATA_DIR), 로컬은 프로젝트의 data/
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "jem.db");
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

/* 카테고리 (공개 사이트 + 관리자 공통) */
const CATEGORIES = [
  { id: "golfwear", name: "골프 의류", icon: "🏌️", image: "assets/img/cat-golfwear.webp" },
  {
    id: "golfacc", name: "골프 잡화", icon: "⛳", image: "assets/img/cat-golfacc.webp",
    // 직판(우리샵) 모드: 업체 목록 대신 상단 하위 카테고리 → 상품 직접 노출
    mode: "direct",
    subcats: [
      { id: "balls", name: "골프공", icon: "⛳" },
      { id: "caps", name: "모자", icon: "🧢" },
      { id: "gloves", name: "장갑", icon: "🧤" },
    ],
  },
  { id: "luxwear", name: "명품 의류", icon: "🧥", image: "assets/img/cat-luxwear.webp" },
  { id: "luxgoods", name: "명품 잡화", icon: "👜", image: "assets/img/cat-luxgoods.webp" },
  { id: "luxacc", name: "명품 악세사리", icon: "💎", image: "assets/img/cat-luxacc.webp" },
];

/* 무료 업로드 기본 한도 (초과 시 향후 과금 — 지금은 잠금만) */
const FREE_PRODUCT_LIMIT = 10;

/* ---------- 스키마 ---------- */
function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shops (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'shop',   -- 'shop' | 'platform'
      name          TEXT NOT NULL,
      category      TEXT,                            -- 카테고리 id (플랫폼은 NULL)
      area          TEXT,
      tagline       TEXT,
      intro         TEXT,
      kakao         TEXT,
      telegram      TEXT,
      phone         TEXT,
      address       TEXT,
      map_url       TEXT,
      image         TEXT,
      product_limit INTEGER NOT NULL DEFAULT ${FREE_PRODUCT_LIMIT},
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id     INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      description TEXT,
      price       TEXT,                              -- "45,000원" / "문의" 등 자유 텍스트
      image       TEXT,                              -- 상세용 이미지 경로(/uploads/..) 또는 URL
      thumb       TEXT,                              -- 목록/피드용 썸네일 경로 (자동 생성)
      category    TEXT,                              -- 본사 공급 상품용 카테고리(가게 상품은 NULL → 가게 카테고리 사용)
      kind        TEXT NOT NULL DEFAULT 'new',       -- 'new'(오늘의 신상) | 'signature'(대표물품)
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_shop_id  INTEGER NOT NULL REFERENCES shops(id),
      seller_shop_id INTEGER NOT NULL REFERENCES shops(id),
      product_id     INTEGER REFERENCES products(id) ON DELETE SET NULL,
      product_title  TEXT NOT NULL,                  -- 주문 시점 스냅샷
      unit_price     TEXT,                           -- 주문 시점 스냅샷
      qty            INTEGER NOT NULL DEFAULT 1,
      note           TEXT,
      status         TEXT NOT NULL DEFAULT 'requested', -- requested|accepted|shipped|done|canceled
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // 기존 DB 대상 마이그레이션: 없으면 컬럼 추가 (있으면 무시)
  try { db.exec("ALTER TABLE products ADD COLUMN thumb TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE products ADD COLUMN category TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE products ADD COLUMN subcat TEXT"); } catch (e) {} // 직판 하위 카테고리

  db.exec(`CREATE INDEX IF NOT EXISTS idx_products_shop ON products(shop_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_shop_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_shop_id);`);
}

/* ---------- 시드 ---------- */
function insertShop(s) {
  const hash = bcrypt.hashSync(s.password, 10);
  const stmt = db.prepare(`
    INSERT INTO shops (username, password_hash, role, name, category, area, tagline, intro, kakao, telegram, phone, image)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    s.username,
    hash,
    s.role || "shop",
    s.name,
    s.category || null,
    s.area || null,
    s.tagline || null,
    s.intro || null,
    s.kakao || null,
    s.telegram || null,
    s.phone || null,
    s.image || null
  );
  return Number(info.lastInsertRowid);
}

function insertProduct(shopId, p) {
  db.prepare(`
    INSERT INTO products (shop_id, title, description, price, image, thumb, kind, category, subcat)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(shopId, p.title, p.description || null, p.price || null, p.image || null, p.image || null, p.kind || "new", p.category || null, p.subcat || null);
}

function seedIfEmpty() {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM shops").get();
  if (n > 0) return false;

  // 플랫폼(본사) 계정 — 모든 주문/가게를 관리 + 공급 상품 배포
  const platformId = insertShop({
    username: "jem",
    password: "jem1234",
    role: "platform",
    name: "베플리카 본사",
    tagline: "플랫폼 관리자",
  });

  // 본사 공급(도매) 상품 — 가게 사장만 B2B 피드에서 봄, 소비자는 안 보임
  // ago: 등록일을 서로 다르게(오늘/이번주/지난주/지난달) 두어 일별·주별·월별 구분 데모
  const supply = [
    { title: "[본사공급] 기능성 골프 티셔츠", category: "golfwear", price: "도매 15,000원", description: "흡습속건 · 전 사이즈", ago: "-0 days" },
    { title: "[본사공급] 프리미엄 골프 장갑", category: "golfacc", price: "도매 7,000원", description: "양피 · 좌/우", ago: "-2 days" },
    { title: "[본사공급] 캐시미어 혼방 코트", category: "luxwear", price: "도매 89,000원", description: "차콜/카멜", ago: "-9 days" },
    { title: "[본사공급] 실버 미니 목걸이", category: "luxacc", price: "도매 12,000원", description: "925 실버", ago: "-40 days" },
  ];
  const supplyProducts = [];
  for (const p of supply) {
    const info = db.prepare(
      `INSERT INTO products (shop_id, title, description, price, category, kind, created_at)
       VALUES (?, ?, ?, ?, ?, 'new', datetime('now', ?))`
    ).run(platformId, p.title, p.description || null, p.price || null, p.category, p.ago || "+0 days");
    supplyProducts.push({ id: Number(info.lastInsertRowid), title: p.title, price: p.price, category: p.category });
  }

  // 샘플 가게 계정 (username / 비밀번호: shop1234)
  const shops = [
    {
      username: "greenfair", password: "shop1234", name: "그린페어웨이", category: "golfwear",
      area: "온라인", tagline: "남녀 골프웨어 편집샵", image: "/assets/img/cover-greenfair.webp",
      intro: "필드룩부터 라운딩 데일리까지. 신상 매주 입고.",
      kakao: "https://open.kakao.com/o/여기에_오픈채팅_링크",
      products: [
        { title: "남성 골프 폴로 티셔츠", price: "48,000원", kind: "new", description: "냉감 · 4color", image: "/assets/img/p-golfpolo.webp" },
        { title: "여성 플리츠 골프 스커트", price: "54,000원", kind: "signature", description: "베스트", image: "/assets/img/p-golfskirt.webp" },
        { title: "방풍 골프 자켓", price: "89,000원", kind: "new", image: "/assets/img/p-golfjacket.webp" },
      ],
    },
    {
      username: "teeup", password: "shop1234", name: "티업", category: "golfwear",
      area: "온라인", tagline: "프리미엄 골프 의류", image: "/assets/img/cover-teeup.webp",
      intro: "라운딩을 위한 프리미엄 라인.",
      products: [
        { title: "스판 골프 팬츠", price: "62,000원", kind: "signature", image: "/assets/img/p-golfpants.webp" },
        { title: "하프집업 니트", price: "58,000원", kind: "new", image: "/assets/img/p-golfknit.webp" },
      ],
    },
    {
      // 골프 잡화 직영 스토어(우리샵) — role 'official' → 업체 목록/피드엔 안 나오고, 직판 모드로만 노출
      username: "gearshop", password: "shop1234", role: "official", name: "베플리카 골프기어",
      category: "golfacc", area: "공식 스토어", tagline: "베플리카 직영 골프 잡화",
      intro: "베플리카가 직접 판매하는 골프 잡화 스토어입니다.",
      kakao: "https://open.kakao.com/o/여기에_오픈채팅_링크",
      products: [
        { title: "투어 3피스 골프공 (12구)", price: "32,000원", subcat: "balls", image: "/assets/img/d-ball-tour.webp", description: "화이트 · 3피스" },
        { title: "컬러 골프공 세트", price: "22,000원", subcat: "balls", image: "/assets/img/d-ball-color.webp", description: "파스텔 6구" },
        { title: "골프 버킷햇", price: "34,000원", subcat: "caps", image: "/assets/img/d-cap-bucket.webp", description: "자외선 차단" },
        { title: "골프 캡", price: "29,000원", subcat: "caps", image: "/assets/img/d-cap-ball.webp" },
        { title: "골프 바이저", price: "26,000원", subcat: "caps", image: "/assets/img/d-cap-visor.webp" },
        { title: "프리미엄 양피 장갑", price: "21,000원", subcat: "gloves", image: "/assets/img/d-glove-leather.webp", description: "양피 · 좌/우" },
        { title: "여름 메쉬 장갑", price: "16,000원", subcat: "gloves", image: "/assets/img/d-glove-mesh.webp", description: "통기성" },
      ],
    },
    {
      username: "raum", password: "shop1234", name: "라움 셀렉트", category: "luxwear",
      area: "온라인", tagline: "명품 의류 편집샵", image: "/assets/img/cover-raum.webp",
      intro: "시즌 셀렉트 아우터·자켓.",
      products: [
        { title: "캐시미어 코트", price: "320,000원", kind: "signature", description: "차콜/카멜", image: "/assets/img/p-cashcoat.webp" },
        { title: "울 블레이저", price: "180,000원", kind: "new", image: "/assets/img/p-blazer.webp" },
      ],
    },
    {
      username: "maisonbag", password: "shop1234", name: "메종 백", category: "luxgoods",
      area: "온라인", tagline: "명품 잡화 · 가방", image: "/assets/img/cover-maisonbag.webp",
      intro: "레더 백 & 소품.",
      products: [
        { title: "레더 토트백", price: "240,000원", kind: "signature", description: "베스트", image: "/assets/img/p-tote.webp" },
        { title: "미니 크로스백", price: "175,000원", kind: "new", image: "/assets/img/p-crossbag.webp" },
      ],
    },
    {
      username: "luce", password: "shop1234", name: "루체 주얼리", category: "luxacc",
      area: "온라인", tagline: "명품 악세사리 · 주얼리", image: "/assets/img/cover-luce.webp",
      intro: "데일리 실버·골드 주얼리.",
      products: [
        { title: "실버 체인 목걸이", price: "68,000원", kind: "new", image: "/assets/img/p-necklace.webp" },
        { title: "골드 브레이슬릿", price: "95,000원", kind: "signature", image: "/assets/img/p-bracelet.webp" },
      ],
    },
  ];

  const shopByUser = {};
  for (const s of shops) {
    const id = insertShop(s);
    shopByUser[s.username] = id;
    for (const p of s.products || []) insertProduct(id, p);
  }

  // 공급 상품 주문 샘플 (정산/대금청구 데모용) — 구매자=가게, 판매자=본사
  const sp = {};
  for (const p of supplyProducts) sp[p.category] = p; // 카테고리로 참조
  function seedOrder(buyerUser, prod, qty, status, ago, note) {
    if (!shopByUser[buyerUser] || !prod) return;
    db.prepare(
      `INSERT INTO orders (buyer_shop_id, seller_shop_id, product_id, product_title, unit_price, qty, note, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`
    ).run(shopByUser[buyerUser], platformId, prod.id, prod.title, prod.price, qty, note || null, status, ago);
  }
  seedOrder("greenfair",  sp.golfwear, 50, "done",      "-3 days",  "완납");
  seedOrder("maisonbag",  sp.luxwear,  30, "shipped",   "-1 days",  "");
  seedOrder("raum",       sp.luxwear,  20, "accepted",  "-0 days",  "추가 발주 예정");
  seedOrder("greenfair",  sp.golfacc,  10, "requested", "-0 days",  "");
  seedOrder("teeup",      sp.golfacc,  15, "canceled",  "-2 days",  "재고 부족으로 취소");
  seedOrder("greenfair",  sp.luxacc,    5, "done",      "-20 days", "지난달 주문");

  return true;
}

init();

module.exports = { db, CATEGORIES, FREE_PRODUCT_LIMIT, seedIfEmpty };

/* 직접 실행 시 시드 (npm run seed) */
if (require.main === module) {
  const did = seedIfEmpty();
  console.log(did ? "✅ 시드 완료" : "ℹ️  이미 데이터가 있어 시드를 건너뜀");
  console.log("로그인 예시 → 플랫폼: jem / jem1234,  가게: greenfair / shop1234");
}
