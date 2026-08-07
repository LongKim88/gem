/* =========================================================================
   add-direct-store.js — 골프잡화 직판(우리샵) 전환 마이그레이션 (비파괴)
   사용: node scripts/add-direct-store.js
   - 기존 데이터(주문 등) 유지하면서:
     1) subcat 컬럼 보장
     2) 골프잡화 벤더 '버디샵' 숨김(active=0)
     3) 직영 스토어 'gearshop'(role official) + 하위카테고리 상품 추가 (중복 방지)
   ========================================================================= */
"use strict";
const { DatabaseSync } = require("node:sqlite");
const bcrypt = require("bcryptjs");
const path = require("path");

const db = new DatabaseSync(path.join(__dirname, "..", "data", "jem.db"));
db.exec("PRAGMA busy_timeout=4000;");
try { db.exec("ALTER TABLE products ADD COLUMN subcat TEXT"); } catch (e) {}

// 1) 골프잡화 벤더 숨김 (직판 전환) — 기존 주문 참조는 유지됨
const hid = db.prepare("UPDATE shops SET active=0 WHERE username='birdieshop' AND role='shop'").run().changes;

// 2) 직영 스토어 + 상품 (없을 때만)
let store = db.prepare("SELECT id FROM shops WHERE username='gearshop'").get();
if (!store) {
  const hash = bcrypt.hashSync("shop1234", 10);
  const info = db.prepare(
    "INSERT INTO shops (username, password_hash, role, name, category, area, tagline, intro, kakao) VALUES (?,?,?,?,?,?,?,?,?)"
  ).run(
    "gearshop", hash, "official", "베플리카 골프기어", "golfacc",
    "공식 스토어", "베플리카 직영 골프 잡화",
    "베플리카가 직접 판매하는 골프 잡화 스토어입니다.",
    "https://open.kakao.com/o/여기에_오픈채팅_링크"
  );
  const sid = Number(info.lastInsertRowid);
  const prods = [
    ["투어 3피스 골프공 (12구)", "32,000원", "balls", "d-ball-tour", "화이트 · 3피스"],
    ["컬러 골프공 세트", "22,000원", "balls", "d-ball-color", "파스텔 6구"],
    ["골프 버킷햇", "34,000원", "caps", "d-cap-bucket", "자외선 차단"],
    ["골프 캡", "29,000원", "caps", "d-cap-ball", ""],
    ["골프 바이저", "26,000원", "caps", "d-cap-visor", ""],
    ["프리미엄 양피 장갑", "21,000원", "gloves", "d-glove-leather", "양피 · 좌/우"],
    ["여름 메쉬 장갑", "16,000원", "gloves", "d-glove-mesh", "통기성"],
  ];
  const ip = db.prepare(
    "INSERT INTO products (shop_id, title, description, price, image, thumb, kind, category, subcat) VALUES (?,?,?,?,?,?, 'new', 'golfacc', ?)"
  );
  for (const [t, price, sub, slug, desc] of prods) {
    const img = "/assets/img/" + slug + ".webp";
    ip.run(sid, t, desc || null, price, img, img, sub);
  }
  console.log(`✅ 직영 스토어 추가 + 상품 ${prods.length}개 (버디샵 숨김 ${hid})`);
} else {
  console.log(`ℹ️  직영 스토어 이미 존재 (버디샵 숨김 ${hid})`);
}
