// Luồng 3: theo dõi đơn và mua lại (returning, 375).
// Cần web-2.mjs đã chạy (đọc orderCode trong results.json). Chạy từ gốc worktree.
import fs from 'node:fs';
import path from 'node:path';
import { startFlow, warm, sh, H, LANE, R, fmtTable } from './flow-lib.mjs';

const prev = JSON.parse(fs.readFileSync(path.join(R, 'screens/flows/web/2-tim-mua/results.json'), 'utf8'));
const code = prev.orderCode;
await warm(['/', '/tai-khoan', '/tai-khoan/don-hang', `/tai-khoan/don-hang/${code}`, '/gio-hang']);

const F = await startFlow({ flow: '3-theo-doi-mua-lai', persona: 'webret' });
const p = F.page;
await F.firstLoad('Mở trang chủ (có đơn vừa đặt ' + code + ')');
await F.tap('Bấm tab Cá nhân', p.getByRole('link', { name: 'Cá nhân' }).locator('visible=true').first());
await F.tap('Bấm Xem tất cả (Đơn của tôi)', F.text('Xem tất cả'));
await F.tap(`Mở đơn ${code}`, p.getByRole('link', { name: new RegExp(code) }).first());
await F.look('Chi tiết đơn lúc mới đặt (xem dòng thời gian)', { note: 'có dòng thời gian 4 mốc; chưa có ngày giao dự kiến' });

// Đơn đi tiếp phía kho (không phải chạm của khách): xác nhận -> đóng gói -> đang giao.
sh('node', [`${H}/pancake-webhook.mjs`, String(LANE), code, 'packed']);
sh('node', [`${H}/pancake-webhook.mjs`, String(LANE), code, 'shipped', '--tracking', 'UATGHN9999001', '--carrier', 'GHN']);
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
await F.look('Kéo tải lại chi tiết đơn sau khi kho giao cho GHN (0 chạm, tải lại)', { note: 'xem có mã vận đơn, mốc, dự kiến giao' });

// Giao thành công (phía vận chuyển, không phải chạm của khách) để đơn có nút Mua lại.
sh('node', [`${H}/pancake-webhook.mjs`, String(LANE), code, 'delivered']);
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
await F.look('Chi tiết đơn sau khi giao thành công (0 chạm, tải lại)', { note: 'xem nút Mua lại đơn này và mốc Giao thành công' });
await F.tap('Bấm nút quay lại (<) về danh sách đơn', p.getByRole('button', { name: 'Quay lại' }).first());
await F.look('Danh sách đơn');
await F.tap(`Bấm Mua lại ở đơn ${code} (đã giao)`, p.locator('li', { hasText: code }).getByRole('button', { name: 'Mua lại' }).first());
await F.look('Sau khi bấm Mua lại', { note: 'mở bảng Mua lại, chưa vào giỏ' });
await F.tap('Bấm "Thêm vào giỏ" trong bảng Mua lại', p.getByRole('button', { name: /Thêm vào giỏ/ }).first());
await F.look('Sau khi thêm vào giỏ (xem đã tới giỏ chưa)');
const body = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const out = F.save({ orderCode: code, bodyHead: body.slice(0, 500) });
console.log(fmtTable(out));
console.log('tổng chạm', out.touches);
await F.close();
