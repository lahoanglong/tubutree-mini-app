// Chạy lần lượt mọi nhóm ca của U6 (tuần tự, KHÔNG song song vì dùng chung khách/giỏ/tồn kho), rồi đối chiếu tiền/điểm và sinh bảng báo cáo.
// Bắt đầu từ lane mới:  bash docs/2026-10-20-uat/tools/uat-harness/lane-down.sh 6 --drop ; bash .../lane-up.sh 6 --web ; node run-all.mjs
// Chạy lại một vài ca:  ONLY=U6-32,U6-35 node d-checkout.mjs  (kết quả cũ của ca khác trong cùng file được giữ).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const groups = ['a-guest', 'b-login', 'c-cart', 'd-checkout', 'e-orders', 'f-account', 'g-misc', 'h-layout', 'i-blocked', 'reconcile', 'make-report'];
const only = process.argv[2] ? process.argv[2].split(',') : groups;
for (const g of groups.filter((x) => only.includes(x))) {
  console.log(`\n######## ${g}`);
  const r = spawnSync('node', [path.join(HERE, `${g}.mjs`)], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) console.log(`(${g} thoát mã ${r.status})`);
}
