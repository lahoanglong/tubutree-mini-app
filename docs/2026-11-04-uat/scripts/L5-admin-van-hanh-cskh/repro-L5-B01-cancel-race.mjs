// L5-B01: CSKH/Admin "Huỷ đơn" thua race với "Đã nhận tiền" (hoặc "Đã đóng gói") nhưng API trả 2xx dù đơn KHÔNG bị huỷ.
// Chạy: PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH node <đường dẫn>/repro-L5-B01-cancel-race.mjs   (từ gốc worktree uat-1104, lane 5 đang chạy)
// Thoát mã 1 nếu tái hiện (có lần huỷ trả 2xx mà đơn không CANCELLED).
import { call, placeOrder, orderRow, sleep } from './_lib.mjs';
let reproduced = 0;
for (let i = 0; i < 6; i++) {
  const { code } = await placeOrder('returning', { method: 'BANK_TRANSFER' });
  const o = await orderRow(code);
  const [pay, cancel] = await Promise.all([
    call('ketoan', 'POST', `/admin/orders/${o.id}/confirm-payment`, {}),
    call('cskh', 'PUT', `/admin/orders/${o.id}/status`, { status: 'CANCELLED', note: 'repro L5-B01' }),
  ]);
  await sleep(1000);
  const after = await orderRow(code);
  const lost = cancel.status >= 200 && cancel.status < 300 && after.status !== 'CANCELLED';
  if (lost) reproduced++;
  console.log(`#${i + 1} ${code}: Đã nhận tiền ${pay.status}; Huỷ ${cancel.status} (body.status=${cancel.body?.status}); đơn cuối ${after.status}/${after.ps}${lost ? '  <-- huỷ báo 2xx nhưng đơn không bị huỷ' : ''}`);
}
console.log(reproduced ? `TÁI HIỆN ${reproduced}/6` : 'không tái hiện');
process.exit(reproduced ? 1 : 0);
