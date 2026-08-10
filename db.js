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
  // 전면 직판(우리 직영) 모델: 5개 카테고리 모두 mode 'direct' (업체 리스트 없이 하위분류 → 상품 직접 노출)
  // 골프는 3단계: 대분류(골프) → 하위 카테고리(의류/가방/신발/소품) → 브랜드
  { id: "golf", name: "골프", icon: "🏌️", image: "assets/img/cat-golfwear.webp", mode: "direct",
    subcats: [
      { id: "wear", name: "의류", image: "assets/img/p-golfpolo.webp" },
      { id: "bag", name: "가방", image: "assets/img/g-cartbag.webp" },
      { id: "shoes", name: "신발", image: "assets/img/g-shoe-white.webp" },
      { id: "acc", name: "소품", image: "assets/img/cat-golfacc.webp" },
    ],
    brands: [
      { id: "pxg", name: "PXG", logo: "assets/img/brand-pxg.webp?v=2" },
      { id: "malbon", name: "Malbon", logo: "assets/img/brand-malbon.webp?v=2" },
      { id: "gfore", name: "G/FORE", logo: "assets/img/brand-gfore.webp?v=2" },
      { id: "titleist", name: "Titleist", logo: "assets/img/brand-titleist.webp?v=2" },
      { id: "amazingcre", name: "AmazingCre", logo: "assets/img/brand-amazingcre.webp?v=2" },
      { id: "anewgolf", name: "ANEW GOLF", logo: "assets/img/brand-anewgolf.webp?v=2" },
    ] },
  { id: "bags", name: "가방", icon: "👜", image: "assets/img/cat-luxgoods.webp", mode: "direct",
    subcats: [
      { id: "tote", name: "토트백", image: "assets/img/p-tote.webp" },
      { id: "cross", name: "크로스백", image: "assets/img/p-crossbag.webp" },
    ] },
  { id: "clothing", name: "의류", icon: "🧥", image: "assets/img/cat-luxwear.webp", mode: "direct",
    subcats: [
      { id: "outer", name: "아우터", image: "assets/img/p-cashcoat.webp" },
      { id: "top", name: "상의", image: "assets/img/p-golfknit.webp" },
      { id: "bottom", name: "하의", image: "assets/img/p-golfpants.webp" },
    ] },
  { id: "shoes", name: "신발", icon: "👟", image: "assets/img/cat-shoes.webp", mode: "direct",
    subcats: [
      { id: "sneakers", name: "스니커즈", image: "assets/img/shoe-white.webp" },
      { id: "dress", name: "구두", image: "assets/img/shoe-loafer.webp" },
    ] },
  { id: "acc", name: "소품", icon: "💎", image: "assets/img/cat-luxacc.webp", mode: "direct",
    subcats: [ { id: "jewelry", name: "주얼리", image: "assets/img/p-necklace.webp" } ] },
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
  try { db.exec("ALTER TABLE products ADD COLUMN brand TEXT"); } catch (e) {}  // 브랜드(3단계)

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

  // === 직영 스토어(우리 직판) — 모든 상품을 베플리카가 직접 판매 ===
  // (B2B 입점/중간유통 마진 기능은 코드에 남아있으나 현재 비활성: 입점 벤더 없음)
  const storeId = insertShop({
    username: "store", password: "store1234", role: "official", name: "베플리카",
    tagline: "직영 스토어",
    kakao: "https://open.kakao.com/o/여기에_오픈채팅_링크",
  });

  // [상품명, 카테고리, 하위분류, 이미지슬러그, 가격, 설명, 브랜드]
  const catalog = [
    // === 골프 > 의류 ===
    ["남성 골프 폴로 티셔츠", "golf", "wear", "p-golfpolo", "148,000원", "냉감 · 4color", "pxg"],
    ["하프집업 니트", "golf", "wear", "p-golfknit", "168,000원", "", "malbon"],
    ["방풍 골프 자켓", "golf", "wear", "p-golfjacket", "289,000원", "", "gfore"],
    ["스판 골프 팬츠", "golf", "wear", "p-golfpants", "162,000원", "", "titleist"],
    ["여성 플리츠 스커트", "golf", "wear", "p-golfskirt", "154,000원", "", "amazingcre"],
    ["여성 골프 원피스", "golf", "wear", "g-dress", "198,000원", "", "anewgolf"],
    ["남성 퀼팅 베스트", "golf", "wear", "g-vest", "228,000원", "", "pxg"],
    // === 골프 > 가방 ===
    ["캐디백", "golf", "bag", "g-cartbag", "690,000원", "경량 카트백", "pxg"],
    ["스탠드백", "golf", "bag", "g-standbag", "540,000원", "", "malbon"],
    ["보스턴백", "golf", "bag", "g-bostonbag", "380,000원", "", "gfore"],
    ["골프 파우치", "golf", "bag", "g-pouch", "128,000원", "", "titleist"],
    ["여성 캐디백", "golf", "bag", "g-cartbag", "720,000원", "", "amazingcre"],
    ["경량 보스턴백", "golf", "bag", "g-bostonbag", "340,000원", "", "anewgolf"],
    // === 골프 > 신발 ===
    ["화이트 스파이크 골프화", "golf", "shoes", "g-shoe-white", "289,000원", "방수", "pxg"],
    ["스파이크리스 골프화", "golf", "shoes", "g-shoe-black", "259,000원", "", "malbon"],
    ["니트 골프 스니커즈", "golf", "shoes", "g-shoe-knit", "245,000원", "", "gfore"],
    ["투어 스파이크 골프화", "golf", "shoes", "g-shoe-white", "298,000원", "", "titleist"],
    ["여성 스파이크리스", "golf", "shoes", "g-shoe-black", "239,000원", "", "amazingcre"],
    ["데일리 골프화", "golf", "shoes", "g-shoe-knit", "215,000원", "", "anewgolf"],
    // === 골프 > 소품 ===
    ["투어 3피스 골프공 (12구)", "golf", "acc", "d-ball-tour", "72,000원", "화이트 · 3피스", "titleist"],
    ["컬러 골프공 세트", "golf", "acc", "d-ball-color", "48,000원", "파스텔 6구", "malbon"],
    ["골프 버킷햇", "golf", "acc", "d-cap-bucket", "89,000원", "자외선 차단", "malbon"],
    ["골프 캡", "golf", "acc", "d-cap-ball", "79,000원", "", "pxg"],
    ["골프 바이저", "golf", "acc", "d-cap-visor", "72,000원", "", "amazingcre"],
    ["프리미엄 양피 장갑", "golf", "acc", "d-glove-leather", "42,000원", "양피 · 좌/우", "gfore"],
    ["여름 메쉬 장갑", "golf", "acc", "d-glove-mesh", "36,000원", "통기성", "anewgolf"],
    ["헤드커버 세트", "golf", "acc", "g-headcover", "128,000원", "니트 3P", "gfore"],
    ["골프 우산", "golf", "acc", "g-umbrella", "98,000원", "", "titleist"],
    ["레더 골프 벨트", "golf", "acc", "g-belt", "118,000원", "", "pxg"],
    // 가방
    ["레더 토트백", "bags", "tote", "p-tote", "240,000원", "베스트"],
    ["미니 크로스백", "bags", "cross", "p-crossbag", "175,000원", ""],
    // 의류
    ["캐시미어 코트", "clothing", "outer", "p-cashcoat", "320,000원", "차콜/카멜"],
    ["울 블레이저", "clothing", "outer", "p-blazer", "180,000원", ""],
    ["방풍 자켓", "clothing", "outer", "p-golfjacket", "89,000원", ""],
    ["폴로 티셔츠", "clothing", "top", "p-golfpolo", "48,000원", "냉감 · 4color"],
    ["하프집업 니트", "clothing", "top", "p-golfknit", "58,000원", ""],
    ["스판 슬랙스", "clothing", "bottom", "p-golfpants", "62,000원", ""],
    ["플리츠 스커트", "clothing", "bottom", "p-golfskirt", "54,000원", ""],
    // 신발
    ["화이트 스니커즈", "shoes", "sneakers", "shoe-white", "89,000원", "미니멀"],
    ["청키 스니커즈", "shoes", "sneakers", "shoe-chunky", "98,000원", ""],
    ["페니 로퍼", "shoes", "dress", "shoe-loafer", "120,000원", "탄 레더"],
    ["더비 슈즈", "shoes", "dress", "shoe-derby", "145,000원", ""],
    // 소품
    ["실버 체인 목걸이", "acc", "jewelry", "p-necklace", "68,000원", ""],
    ["골드 브레이슬릿", "acc", "jewelry", "p-bracelet", "95,000원", ""],
  ];
  const P = "/assets/img/";
  const ip = db.prepare("INSERT INTO products (shop_id, title, description, price, image, thumb, category, subcat, brand, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')");
  for (const [t, cat, sub, slug, price, desc, brand] of catalog) {
    const img = P + slug + ".webp";
    ip.run(storeId, t, desc || null, price, img, img, cat, sub, brand || null);
  }
  void platformId; // 본사 계정은 관리자 로그인용으로 유지 (현재 시드엔 미사용)

  // ※ B2B 입점 벤더 시드는 현재 모델(전면 직판)에서 비활성화.
  //   기능(입점 가게 계정·B2B 피드·주문/정산)은 코드에 그대로 남아 있어,
  //   추후 가게 계정을 발급하면 바로 다시 동작합니다.

  return true;
}

/* ---------- 카테고리 개편 시 자동 정리 ----------
   상품의 카테고리가 '전부' 현재 CATEGORIES 에 없는 옛 값일 때만 초기화 후 재시드한다.
   → 현재 카테고리에 속한 상품이 하나라도 있으면(=실데이터 존재) 절대 건드리지 않음. */
function reseedIfStale() {
  const valid = new Set(CATEGORIES.map((c) => c.id));
  const cats = db
    .prepare("SELECT DISTINCT category AS c FROM products WHERE active=1 AND category IS NOT NULL")
    .all()
    .map((r) => r.c);
  if (!cats.length) return false;
  if (cats.some((c) => valid.has(c))) return false; // 유효 데이터 있음 → 유지
  db.exec("DELETE FROM orders;");
  db.exec("DELETE FROM products;");
  db.exec("DELETE FROM shops;");
  const did = seedIfEmpty();
  if (did) console.log("♻️  카테고리 개편 감지 — 옛 데모 데이터를 새 구조로 재시드했습니다.");
  return did;
}

init();

module.exports = { db, CATEGORIES, FREE_PRODUCT_LIMIT, seedIfEmpty, reseedIfStale };

/* 직접 실행 시 시드 (npm run seed) */
if (require.main === module) {
  const did = seedIfEmpty();
  console.log(did ? "✅ 시드 완료" : "ℹ️  이미 데이터가 있어 시드를 건너뜀");
  console.log("로그인 예시 → 플랫폼: jem / jem1234,  가게: greenfair / shop1234");
}
