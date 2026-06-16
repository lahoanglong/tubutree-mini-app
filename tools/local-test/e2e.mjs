// E2E smoke hành trình B2C — chạy với API đang chạy (mặc định local http://localhost:3001/api).
// Đổi đích: API_BASE=https://api.tubutree.com/api node e2e.mjs  (LƯU Ý: prod sẽ tạo đơn thật ở bước 13).
const BASE = process.env.API_BASE ?? 'http://localhost:3001/api';
const PLACE_ORDER = process.env.PLACE_ORDER !== '0'; // đặt PLACE_ORDER=0 để bỏ qua tạo đơn (tránh rác prod)
let token = null;
const results = [];
function log(step, ok, detail) { results.push(ok); console.log(`${ok ? '✅' : '❌'} ${step}${detail ? ' — ' + detail : ''}`); }
async function call(method, path, body, auth = true, extraHeaders = {}) {
  const headers = { 'content-type': 'application/json', ...extraHeaders };
  if (auth && token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  let json; try { json = JSON.parse(await res.text()); } catch { json = null; }
  return { status: res.status, json };
}

(async () => {
  console.log('API_BASE =', BASE, '| PLACE_ORDER =', PLACE_ORDER);
  let r = await call('GET', '/health', null, false);
  log('health', r.status === 200 && r.json?.status === 'ok');

  r = await call('GET', '/brands', null, false);
  log('brands ≥8', (r.json?.length ?? 0) >= 8, `${r.json?.length} brand`);

  r = await call('GET', '/products?limit=100', null, false);
  const items = r.json?.data ?? [];
  const withImg = items.filter((p) => p.thumbnail).length;
  log('products ≥40', items.length >= 40, `${items.length} SP, ${withImg} có ảnh`);

  r = await call('POST', '/auth/guest', { deviceId: 'e2e-' + Date.now() }, false);
  token = r.json?.accessToken;
  log('đăng nhập khách', !!token);

  const slug = items.find((p) => p.brand === 'Visante')?.slug ?? items[0]?.slug;
  r = await call('GET', '/products/' + slug, null, false);
  const variationId = r.json?.variations?.[0]?.id;
  log('chi tiết SP', !!variationId, r.json?.name);

  r = await call('POST', '/cart/items', { variationId, quantity: 2 });
  log('thêm giỏ', r.status < 400);
  r = await call('GET', '/cart');
  log('xem giỏ', (r.json?.items?.length ?? 0) > 0, `subtotal=${r.json?.subtotal}`);

  r = await call('POST', '/me/addresses', {
    recipient: 'Nguyễn Văn Long', phone: '0901234567', province: 'TP. Hồ Chí Minh', district: 'Quận 1',
    ward: 'Phường Bến Nghé', street: '123 Lê Lợi', provinceCode: '79', districtCode: '760', wardCode: '26734', isDefault: true,
  });
  const addressId = r.json?.id;
  log('thêm địa chỉ', !!addressId);

  r = await call('POST', '/checkout/quote', { addressId });
  log('báo giá', r.status < 400, `total=${r.json?.total}, ship=${r.json?.shippingFee}, điểm=${r.json?.pointsEarned}`);

  if (PLACE_ORDER) {
    const idem = 'e2e-' + Date.now();
    r = await call('POST', '/checkout/place-order', { addressId, paymentMethod: 'COD' }, true, { 'idempotency-key': idem });
    const code = r.json?.code;
    log('đặt đơn COD', !!code && r.json?.status === 'CONFIRMED', `mã=${code}`);
    const r2 = await call('POST', '/checkout/place-order', { addressId, paymentMethod: 'COD' }, true, { 'idempotency-key': idem });
    log('idempotency', r2.json?.code === code, 'gọi lại = cùng đơn');
  } else {
    // Dọn giỏ test (không tạo đơn).
    for (const it of (await call('GET', '/cart')).json?.items ?? []) await call('DELETE', '/cart/items/' + it.id);
    console.log('↷ bỏ qua đặt đơn (PLACE_ORDER=0), đã dọn giỏ');
  }

  r = await call('GET', '/game/profile'); log('Vườn Xanh profile', r.status === 200);
  r = await call('POST', '/game/check-in', {}); log('điểm danh game', r.status < 400);
  r = await call('GET', '/me/loyalty'); log('loyalty', r.status === 200, `hạng=${r.json?.tier?.name}`);

  const pass = results.filter(Boolean).length;
  console.log(`\n=== ${pass}/${results.length} bước PASS ===`);
  if (pass < results.length) process.exit(1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
