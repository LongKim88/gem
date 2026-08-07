/* =========================================================================
   apply-images.js — 상품/가게에 이미지(그림) 일괄 연결
   사용: node scripts/apply-images.js
   - public/assets/img/ 의 생성 이미지를 DB의 각 상품(title 기준)·가게(username 기준)에 매핑
   - DB를 다시 시드(초기화)한 뒤 이미지가 사라지면 이 스크립트만 다시 실행하면 복구됨
   ========================================================================= */
"use strict";
const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const db = new DatabaseSync(path.join(__dirname, "..", "data", "jem.db"));
db.exec("PRAGMA busy_timeout=4000;");
const P = "/assets/img/";

// 상품명 → 이미지 슬러그
const PRODUCTS = {
  "남성 골프 폴로 티셔츠": "p-golfpolo",
  "여성 플리츠 골프 스커트": "p-golfskirt",
  "방풍 골프 자켓": "p-golfjacket",
  "스판 골프 팬츠": "p-golfpants",
  "하프집업 니트": "p-golfknit",
  "골프 캡": "p-golfcap",
  "양피 골프 장갑": "p-golfglove",
  "볼마커 세트": "p-ballmarker",
  "캐시미어 코트": "p-cashcoat",
  "울 블레이저": "p-blazer",
  "레더 토트백": "p-tote",
  "미니 크로스백": "p-crossbag",
  "실버 체인 목걸이": "p-necklace",
  "골드 브레이슬릿": "p-bracelet",
  "[본사공급] 기능성 골프 티셔츠": "p-supgolftee",
  "[본사공급] 프리미엄 골프 장갑": "p-supglove",
  "[본사공급] 캐시미어 혼방 코트": "p-supcoat",
  "[본사공급] 실버 미니 목걸이": "p-supnecklace",
};

// 가게 username → 커버 이미지 슬러그
const SHOP_COVERS = {
  greenfair: "cover-greenfair",
  teeup: "cover-teeup",
  birdieshop: "cover-birdieshop",
  raum: "cover-raum",
  maisonbag: "cover-maisonbag",
  luce: "cover-luce",
};

let pn = 0, sn = 0;
const up = db.prepare("UPDATE products SET image=?, thumb=? WHERE title=?");
for (const [title, slug] of Object.entries(PRODUCTS)) {
  const img = P + slug + ".webp";
  pn += up.run(img, img, title).changes;
}
const us = db.prepare("UPDATE shops SET image=? WHERE username=?");
for (const [user, slug] of Object.entries(SHOP_COVERS)) {
  sn += us.run(P + slug + ".webp", user).changes;
}
console.log(`✅ 이미지 연결 완료 — 상품 ${pn}건, 가게 커버 ${sn}건`);
