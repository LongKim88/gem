/* =========================================================================
   make-brand-logos.js — 브랜드 로고를 사이트 규격으로 정규화
   사용: node scripts/make-brand-logos.js
   - 원본(검정 로고 / 흰 배경) → 흰색 로고 / 투명 배경 WebP
   - 여백 트림 후 동일 캔버스(440x200)에 맞춰 크기·여백 통일
   - 새 브랜드는 아래 GROUPS 에 { 브랜드id: '파일명' } 만 추가
   ========================================================================= */
"use strict";
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const OUT_DIR = path.join(__dirname, "..", "public", "assets", "img");

// 원본 폴더별 { 브랜드id: 파일명 }
const GROUPS = [
  {
    dir: "/Users/long/Downloads/골프 로고/",
    map: {
      pxg: "PXG.jpg", malbon: "malbon.jpg", gfore: "gfore.jpg",
      titleist: "titleist.jpg", amazingcre: "amazingcre.jpg", anewgolf: "anewgolf.jpg",
    },
  },
  {
    dir: "/Users/long/Downloads/명품 인쇄용/",
    map: {
      louisvuitton: "LOUISVUITTON.png", gucci: "GUCCI.png", dior: "DIOR.jpg",
      prada: "PRADA.png", celine: "CELINE.png", saintlaurent: "SAINTLAURENT.png",
      goyard: "1.jfif", moncler: "MONCLER.png", burberry: "BURBERRYS.png",
      balenciaga: "BALENCIAGA.png",
      // 미확보: chanel, bottegaveneta → 로고 없으면 브랜드명 타이포로 자동 표시됨
    },
  },
];

const BOX_W = 440, BOX_H = 200, INNER_W = 380, INNER_H = 150;

(async () => {
  let n = 0, skipped = [];
  for (const { dir, map } of GROUPS) {
    for (const [id, file] of Object.entries(map)) {
      const src = path.join(dir, file);
      if (!fs.existsSync(src)) { skipped.push(`${id} (원본 없음: ${file})`); continue; }
      // 1) 흰 배경으로 평탄화 → 여백 트림 → 흑백 → 반전 (별도 패스여야 순서 보장)
      const negated = await sharp(src)
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .trim({ threshold: 20 }).greyscale().negate().png().toBuffer();
      // 2) 동일 박스에 맞춤 (검정 = 투명이 될 영역)
      const a = await sharp(negated)
        .resize({ width: INNER_W, height: INNER_H, fit: "contain", background: { r: 0, g: 0, b: 0 } })
        .extend({
          top: (BOX_H - INNER_H) / 2 | 0, bottom: (BOX_H - INNER_H) / 2 | 0,
          left: (BOX_W - INNER_W) / 2 | 0, right: (BOX_W - INNER_W) / 2 | 0,
          background: { r: 0, g: 0, b: 0 },
        })
        .greyscale().raw().toBuffer({ resolveWithObject: true });
      // 3) 흰색 판 + 위 결과를 알파로 → 흰 로고 / 투명 배경
      const { width: W, height: H } = a.info;
      await sharp({ create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } } })
        .joinChannel(a.data, { raw: { width: W, height: H, channels: 1 } })
        .webp({ quality: 92, alphaQuality: 100 })
        .toFile(path.join(OUT_DIR, `brand-${id}.webp`));
      console.log(`✅ brand-${id}.webp`);
      n++;
    }
  }
  console.log(`\n총 ${n}개 생성` + (skipped.length ? `, 건너뜀: ${skipped.join(", ")}` : ""));
  console.log("※ 로고를 교체하면 db.js 의 logo 경로 뒤 ?v= 숫자를 올려 캐시를 무효화하세요.");
})().catch((e) => { console.error("실패:", e.message); process.exit(1); });
