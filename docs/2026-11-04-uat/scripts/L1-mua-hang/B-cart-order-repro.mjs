// Tái hiện: sửa số lượng một dòng giỏ làm dòng đó nhảy xuống cuối giỏ (GET /cart không có orderBy).
// Chạy:  node /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat/scripts/L1-mua-hang/B-cart-order-repro.mjs
import { L, api, closePrisma, rec } from './lib.mjs';
import { V, fresh, fillCart } from './kit.mjs';

const w = await fresh('ord1');
await fillCart(w, [[V.LAUNDRY, 1], [V.HANDWASH, 1], [V.SERUM30, 1]]);
const names = async () => (await api(L, 'GET', '/cart', { token: w.token })).body.items.map((i) => `${i.productName.split(' ').slice(0, 3).join(' ')} x${i.quantity}`);
const before = await names();
const items = (await api(L, 'GET', '/cart', { token: w.token })).body.items;
await api(L, 'PATCH', `/cart/items/${items[0].id}`, { token: w.token, body: { quantity: 2 } });
const after = await names();
const stable = after[0].startsWith(before[0].split(' x')[0]);
console.log('trước :', before);
console.log('sau   :', after);
rec('B', { id: 'B-cart-order', persona: 'ord1', surface: 'api', journey: 'giỏ', step: 'sửa SL dòng đầu rồi đọc lại giỏ', expected: 'thứ tự dòng giữ nguyên (dòng vừa sửa vẫn ở vị trí cũ)', actual: `trước ${JSON.stringify(before)}; sau ${JSON.stringify(after)}`, status: stable ? 'PASS' : 'FAIL' });
await closePrisma();
