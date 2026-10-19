#!/usr/bin/env node
// Người dùng theo vai trò + dữ liệu nghiệp vụ cho DB mẫu, chạy trên lane có API đang bật (build-template.sh gọi với lane 9).
// Chỉ dòng users được chèn thẳng bằng Prisma (như AuthService tạo khi khách đăng nhập Zalo lần đầu; API không có đường tạo user khác).
// Mọi thứ còn lại đi qua endpoint thật của app bằng token ký đúng payload: đổi vai trò, nhóm việc STAFF, hồ sơ + duyệt đại lý, đăng ký CTV,
// gian hàng + duyệt, nhãn hàng + chủ nhãn, lô thẻ hộp hàng sàn, flash sale, địa chỉ, giỏ, đặt đơn COD, webhook Pancake giao xong.
// Dùng: seed-roles.mjs <lane>   (ghi personas.json cạnh script)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { HARNESS, apiOk, api, closePrisma, jsonOut, lane, prismaFor, sleep } from './lib.mjs';
import { sendOrderStatus } from './pancake-webhook.mjs';

const L = lane(process.argv[2] ?? 9);
const prisma = prismaFor(L);
const now = new Date();
const log = (...a) => console.log(`[seed-roles ${new Date().toISOString().slice(11, 19)}]`, ...a);

export const PERSONAS = [
  { id: 'uat_new', name: 'Lê Thu Mới', phone: '0901000001', onboard: false, note: 'Khách mới: chưa đơn, SĐT đã xác minh, chưa làm onboarding' },
  { id: 'uat_new_nophone', name: 'Trần Chưa Số', phone: null, onboard: false, note: 'Khách mới: chưa đơn, KHÔNG có SĐT' },
  { id: 'uat_returning', name: 'Nguyễn Thị Quay Lại', phone: '0901000003', onboard: true, note: 'Khách quay lại: hạng Lộc Biếc, có điểm, đơn cũ đã giao, có địa chỉ mặc định' },
  { id: 'uat_ctv', name: 'Phạm Văn CTV', phone: '0901000004', onboard: true, note: 'CTV (AFFILIATE), gian hàng ĐÃ DUYỆT, đã đăng' },
  { id: 'uat_ctv_pending', name: 'Võ Thị Chờ Duyệt', phone: '0901000005', onboard: true, note: 'CTV (AFFILIATE), gian hàng đã đăng, CHỜ DUYỆT' },
  { id: 'uat_dealer', name: 'Đại Lý Xanh Tươi', phone: '0901000006', onboard: true, note: 'Đại lý (DEALER) duyệt qua hồ sơ, bậc DEALER_2' },
  { id: 'uat_staff', name: 'Nhân Viên Quầy', phone: '0901000007', onboard: true, note: 'STAFF không nhóm việc (quầy, đổi vỏ, chấm công)' },
  { id: 'uat_kho', name: 'Nhân Viên Kho', phone: '0901000014', onboard: true, note: 'STAFF nhóm KHO' },
  { id: 'uat_ketoan', name: 'Kế Toán Tubu', phone: '0901000008', onboard: true, note: 'STAFF nhóm KE_TOAN' },
  { id: 'uat_marketing', name: 'Marketing Tubu', phone: '0901000009', onboard: true, note: 'STAFF nhóm MARKETING' },
  { id: 'uat_cskh', name: 'CSKH Kiểm Duyệt', phone: '0901000010', onboard: true, note: 'STAFF nhóm CSKH (kiểm duyệt cộng đồng)' },
  { id: 'uat_brand', name: 'Chủ Nhãn Fuwa3e', phone: '0901000011', onboard: true, note: 'CUSTOMER, chủ nhãn hàng Fuwa3e (Brand.ownerUserId)' },
  { id: 'uat_admin', name: 'Admin UAT', phone: '0901000012', onboard: true, note: 'ADMIN (dòng gốc, như grant-admin.js)' },
];

const zaloIdOf = (id) => `uat-zalo-${id.slice(4).replace(/_/g, '-')}`;
const refOf = (id) => `UAT${id.slice(4).replace(/_/g, '').toUpperCase()}`.slice(0, 16);
const as = (user) => ({ user });
const ADMIN = as('uat_admin');

async function upsertUsers() {
  for (const p of PERSONAS) {
    const data = {
      zaloId: zaloIdOf(p.id),
      fullName: p.name,
      phone: p.phone,
      phoneVerifiedAt: p.phone ? now : null,
      referralCode: refOf(p.id),
      role: p.id === 'uat_admin' ? 'ADMIN' : 'CUSTOMER',
    };
    await prisma.user.upsert({ where: { id: p.id }, update: {}, create: { id: p.id, ...data } });
  }
  log(`users: ${PERSONAS.length} dòng`);
  for (const p of PERSONAS.filter((x) => x.onboard)) {
    await apiOk(L, 'POST', '/me/onboarding', { ...as(p.id), body: { segments: ['home_clean', 'eco'] } });
  }
  log('onboarding xong cho các vai trò không phải khách mới');
}

async function staffRoles() {
  const perms = { uat_staff: [], uat_kho: ['KHO'], uat_ketoan: ['KE_TOAN'], uat_marketing: ['MARKETING'], uat_cskh: ['CSKH'] };
  for (const [id, list] of Object.entries(perms)) {
    const p = PERSONAS.find((x) => x.id === id);
    await apiOk(L, 'POST', '/admin/users/role', { ...ADMIN, body: { phone: p.phone, role: 'STAFF' } });
    if (list.length) await apiOk(L, 'PUT', `/admin/users/${id}/staff-permissions`, { ...ADMIN, body: { permissions: list } });
  }
  log('STAFF: quầy, KHO, KE_TOAN, MARKETING, CSKH');
}

async function dealer() {
  await apiOk(L, 'POST', '/dealer/apply', {
    ...as('uat_dealer'),
    body: {
      businessName: 'Cửa hàng Xanh Tươi UAT',
      taxCode: '0312345678',
      ownerName: 'Đại Lý Xanh Tươi',
      phone: '0901000006',
      address: '45 Nguyễn Trãi, Phường Bến Thành, TP Hồ Chí Minh',
      cccdFrontUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
      cccdBackUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
      monthlyVolumeEstimate: 30_000_000,
    },
  });
  const app = await prisma.dealerApplication.findFirst({ where: { userId: 'uat_dealer', status: 'PENDING' } });
  await apiOk(L, 'POST', `/admin/dealer-applications/${app.id}/review`, { ...ADMIN, body: { approve: true, tierId: 'DEALER_2' } });
  log('đại lý: hồ sơ đã duyệt, bậc DEALER_2');
}

async function affiliates() {
  const products = await prisma.product.findMany({ where: { isActive: true }, select: { id: true }, take: 4, orderBy: { id: 'asc' } });
  const out = {};
  for (const [id, title, approve] of [
    ['uat_ctv', 'Góc Xanh Của Phạm CTV', true],
    ['uat_ctv_pending', 'Nhà Sạch Của Võ Thị', false],
  ]) {
    await apiOk(L, 'POST', '/affiliate/register', { ...as(id), body: {} });
    const sf = await apiOk(L, 'POST', '/storefront', as(id));
    await apiOk(L, 'PATCH', '/storefront/me', { ...as(id), body: { title, headerNote: 'Gian hàng UAT — sản phẩm xanh chọn lọc' } });
    const col = await apiOk(L, 'POST', '/storefront/me/collections', { ...as(id), body: { title: 'Sản phẩm nổi bật' } });
    for (const p of products) await apiOk(L, 'POST', `/storefront/me/collections/${col.id}/items`, { ...as(id), body: { productId: p.id } });
    await apiOk(L, 'POST', '/storefront/me/publish', { ...as(id), body: { isPublished: true } });
    if (approve) await apiOk(L, 'POST', `/admin/storefronts/${sf.id}/approval`, { ...ADMIN, body: { approved: true } });
    const row = await prisma.storefront.findUnique({ where: { id: sf.id }, select: { slug: true, isPublished: true, approvedAt: true } });
    out[id] = row;
    log(`CTV ${id}: gian hàng /s/${row.slug} đăng=${row.isPublished} duyệt=${Boolean(row.approvedAt)}`);
  }
  return out;
}

async function brandOwner() {
  let brand = (await apiOk(L, 'GET', '/admin/brands', ADMIN)).find?.((b) => b.slug === 'fuwa3e');
  if (!brand) {
    brand = await apiOk(L, 'POST', '/admin/brands', {
      ...ADMIN,
      body: { name: 'Fuwa3e', slug: 'fuwa3e', tagline: 'Tẩy rửa sinh học từ enzyme', origin: 'Việt Nam', isPublished: true },
    });
  }
  await apiOk(L, 'PATCH', `/admin/brands/${brand.id}`, { ...ADMIN, body: { ownerUserId: 'uat_brand' } });
  const linked = await apiOk(L, 'POST', `/admin/brands/${brand.id}/link-by-name`, ADMIN);
  log(`nhãn Fuwa3e ${brand.id}: chủ uat_brand, gắn sản phẩm ${JSON.stringify(linked)}`);
  return brand.id;
}

async function configs() {
  await apiOk(L, 'PUT', '/admin/config', {
    ...ADMIN,
    body: {
      key: 'pancake.order_source_map',
      value: { marketplaceIds: { '-3': 'shopee', '-4': 'lazada', '-9': 'tiktok' }, chatSources: ['-1|fb-page-tubu|'] },
    },
  });
  log('pancake.order_source_map: thêm nguồn chat "-1|fb-page-tubu|" (đơn CSKH lên Pancake, B9)');
}

async function couponBatch() {
  const endAt = new Date(now.getTime() + 60 * 86_400_000);
  const res = await apiOk(L, 'POST', '/admin/coupon-batches', {
    ...as('uat_marketing'),
    body: { prefix: 'HOPSAN', quantity: 30, type: 'AMOUNT', value: 30000, minOrder: 199000, startAt: now.toISOString(), endAt: endAt.toISOString(), newCustomerOnly: true },
  });
  const codes = await prisma.coupon.findMany({ where: { batch: 'HOPSAN' }, select: { code: true }, orderBy: { code: 'asc' } });
  log(`lô thẻ hộp hàng sàn HOPSAN: ${codes.length} mã (tạo bởi uat_marketing qua /admin/coupon-batches)`);
  return { result: res, codes: codes.map((c) => c.code) };
}

async function flashSale() {
  const vars = await prisma.variation.findMany({
    where: { isActive: true, stock: { gte: 20 }, retailPrice: { gte: 100000 }, product: { isActive: true } },
    select: { id: true, sku: true, retailPrice: true, salePrice: true, product: { select: { name: true } } },
    orderBy: { sku: 'asc' },
    take: 3,
  });
  const start = new Date(now.getTime() - 10 * 60_000);
  const end = new Date(now.getTime() + 6 * 86_400_000);
  const sale = await apiOk(L, 'POST', '/admin/flash-sales', { ...ADMIN, body: { title: 'Flash Sale UAT — giá sốc 6 ngày', startAt: start.toISOString(), endAt: end.toISOString() } });
  const items = [];
  for (const v of vars) {
    const base = v.salePrice ?? v.retailPrice;
    const flashPrice = Math.max(1000, Math.round((base * 0.75) / 1000) * 1000);
    await apiOk(L, 'POST', `/admin/flash-sales/${sale.id}/items`, { ...ADMIN, body: { variationId: v.id, flashPrice, quota: 50, perUserLimit: 2 } });
    items.push({ sku: v.sku, product: v.product.name, base, flashPrice });
  }
  log(`flash sale ${sale.id} ${start.toISOString()} → ${end.toISOString()}: ${items.map((i) => `${i.sku} ${i.flashPrice}`).join(', ')}`);
  return { id: sale.id, startAt: start, endAt: end, items, skus: vars.map((v) => v.sku) };
}

async function returningCustomer(flashSkus) {
  const u = as('uat_returning');
  const addr = await apiOk(L, 'POST', '/me/addresses', {
    ...u,
    body: {
      recipient: 'Nguyễn Thị Quay Lại', phone: '0901000003', province: 'Thành phố Hồ Chí Minh', district: '', ward: 'Phường Bến Thành',
      street: '12 Lê Lợi', provinceCode: '84_VN79', districtCode: '', wardCode: '84_VN7926743', isDefault: true,
    },
  });
  // Đơn cũ đủ lớn để vào Lộc Biếc (minPoints 30.000 / minSpending 1.500.000 trong seed TIERS): ~1,6 triệu tiền hàng.
  const v = await prisma.variation.findFirst({
    where: { isActive: true, stock: { gte: 30 }, retailPrice: { gte: 150000 }, product: { isActive: true }, sku: { notIn: flashSkus } },
    orderBy: { retailPrice: 'desc' },
  });
  const unit = v.salePrice ?? v.retailPrice;
  const qty = Math.ceil(1_650_000 / unit);
  await apiOk(L, 'POST', '/cart/items', { ...u, body: { variationId: v.id, quantity: qty, addSource: 'pdp' } });
  const quote = await apiOk(L, 'POST', '/checkout/quote', { ...u, body: { addressId: addr.id } });
  const placed = await apiOk(L, 'POST', '/checkout/place-order', {
    ...u,
    headers: { 'idempotency-key': randomUUID() },
    body: { addressId: addr.id, paymentMethod: 'COD', expectedTotal: quote.total, note: 'Đơn cũ dựng cho UAT' },
  });
  const code = placed.code ?? placed.order?.code ?? placed.orders?.[0]?.code;
  log(`đơn cũ ${code}: ${qty} × ${v.sku} (${unit}đ), tổng ${quote.total}đ`);
  for (let i = 0; i < 40; i++) {
    const o = await prisma.order.findUnique({ where: { code }, select: { pancakeOrderId: true, pancakePushStatus: true, pancakeSyncError: true } });
    if (o?.pancakeOrderId) break;
    if (i === 39) throw new Error(`đơn ${code} chưa lên giả Pancake: ${JSON.stringify(o)}`);
    await sleep(500);
  }
  const shipped = await sendOrderStatus(L, code, 'shipped');
  const delivered = await sendOrderStatus(L, code, 'delivered');
  log(`webhook Pancake: shipped → ${shipped.event?.status}/${shipped.order?.status}, delivered → ${delivered.event?.status}/${delivered.order?.status}`);
  const order = await prisma.order.findUnique({ where: { code } });
  if (order.status !== 'DELIVERED') throw new Error(`đơn ${code} chưa DELIVERED: ${order.status}`);
  // Lùi mốc 40 ngày: đơn thành "đơn cũ", điểm qua cửa sổ đổi/trả (returns.window_days) nên dùng được ngay.
  const DAYS = 40;
  await prisma.$executeRawUnsafe(
    `UPDATE orders SET "createdAt" = "createdAt" - interval '${DAYS} days', "deliveredAt" = "deliveredAt" - interval '${DAYS} days',
       "shippedAt" = "shippedAt" - interval '${DAYS} days', "deliveredEffectsAt" = "deliveredEffectsAt" - interval '${DAYS} days' WHERE code = $1`,
    code,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE points_transactions SET "createdAt" = "createdAt" - interval '${DAYS} days', "expiresAt" = "expiresAt" - interval '${DAYS} days' WHERE "refId" = $1`,
    order.id,
  );
  const tiers = execFileSync('node', [path.join(HARNESS, 'run-job.mjs'), String(L.n), 'tiers.recalc'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const after = await prisma.user.findUnique({ where: { id: 'uat_returning' }, select: { tierId: true, pointsBalance: true } });
  log(`khách quay lại: hạng ${after.tierId}, ${after.pointsBalance} điểm (job tiers.recalc: ${tiers.trim().split('\n').slice(-1)[0] ?? ''})`);
  if (after.tierId !== 'LOC_BIEC' && after.tierId !== 'DAI_THU') {
    log(`CẢNH BÁO: recalcTiers không đưa khách lên Lộc Biếc (tierId=${after.tierId}); xem điều kiện hạng`);
  }
  return { orderCode: code, addressId: addr.id, ...after };
}

async function summary(extra) {
  const users = await prisma.user.findMany({
    where: { id: { in: PERSONAS.map((p) => p.id) } },
    select: { id: true, zaloId: true, phone: true, role: true, staffPermissions: true, tierId: true, pointsBalance: true, metadata: true },
  });
  const sfs = await prisma.storefront.findMany({ where: { ownerUserId: { in: PERSONAS.map((p) => p.id) } }, select: { ownerUserId: true, slug: true, approvedAt: true, isPublished: true } });
  const rows = PERSONAS.map((p) => {
    const u = users.find((x) => x.id === p.id);
    const sf = sfs.find((s) => s.ownerUserId === p.id);
    return {
      alias: p.id.slice(4),
      id: u.id,
      zaloId: u.zaloId,
      phone: u.phone,
      role: u.role,
      staffPermissions: u.staffPermissions,
      tierId: u.tierId,
      pointsBalance: u.pointsBalance,
      dealerTierId: u.metadata?.dealerTierId ?? null,
      storefront: sf ? { slug: sf.slug, published: sf.isPublished, approved: Boolean(sf.approvedAt) } : null,
      note: p.note,
    };
  });
  const out = { builtAt: now.toISOString(), lane: L.n, db: L.db, personas: rows, ...extra };
  fs.writeFileSync(path.join(HARNESS, 'personas.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

try {
  await upsertUsers();
  await staffRoles();
  await dealer();
  const storefronts = await affiliates();
  const brandId = await brandOwner();
  await configs();
  // JwtStrategy đọc role/nhóm việc qua SessionStateService (cache 5 giây, đổi role không xoá cache): chờ hết cache trước khi
  // dùng tài khoản vừa đổi vai trò (uat_marketing đã bị cache là CUSTOMER lúc làm onboarding).
  await sleep(5500);
  const batch = await couponBatch();
  const flash = await flashSale();
  const returning = await returningCustomer(flash.skus);
  const s = await summary({ storefronts, brandId, couponBatch: { prefix: 'HOPSAN', codes: batch.codes }, flashSale: flash, returning });
  jsonOut(s.personas.map(({ alias, id, zaloId, phone, role, staffPermissions, tierId, pointsBalance }) => ({ alias, id, zaloId, phone, role, staffPermissions, tierId, pointsBalance })));
  const check = await api(L, 'GET', '/auth/me', as('uat_returning'));
  log(`kiểm /auth/me uat_returning → ${check.status} role=${check.body?.role} points=${check.body?.pointsBalance}`);
} catch (e) {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
} finally {
  await closePrisma();
}
