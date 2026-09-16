/* 로그인 잠금 조회·해제
     node scripts/locks.js            잠긴 계정 보기
     node scripts/locks.js store      해당 아이디 잠금 풀기
     node scripts/locks.js --all      전부 풀기                      */
"use strict";
const { db } = require("../db");

const arg = process.argv[2];
if (!arg) {
  const rows = db.prepare("SELECT username, ip, fails, locked_until FROM login_locks ORDER BY updated_at DESC").all();
  if (!rows.length) return console.log("잠긴 계정이 없습니다.");
  console.log("아이디 | IP | 실패 | 해제 시각(UTC)");
  for (const r of rows) console.log(`${r.username} | ${r.ip} | ${r.fails}회 | ${r.locked_until}`);
} else {
  const n = arg === "--all"
    ? db.prepare("DELETE FROM login_locks").run()
    : db.prepare("DELETE FROM login_locks WHERE username=?").run(arg);
  console.log(`잠금 ${n.changes}건을 해제했습니다.`);
}
