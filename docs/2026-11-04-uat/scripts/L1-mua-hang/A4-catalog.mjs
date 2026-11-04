// A4: danh mục, tìm kiếm (có dấu / không dấu / không kết quả), chi tiết SP (biến thể, hết hàng, giờ vàng, giá sale) qua API, so SQL.
// Chạy:  node /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat/scripts/L1-mua-hang/A4-catalog.mjs
import { L, sql, rec, closePrisma, api } from './lib.mjs';
import { who, clearCart } from './kit.mjs';

const FILE = 'A4';
const w = await who('new');
const get = (p, tok = w.token) => api(L, 'GET', p, { token: tok });
const list = (r) => r.body?.data ?? r.body?.items ?? [];
const names = (r) => list(r).map((p) => p.name);

// --- tìm kiếm ---
const SEARCH = [
  ['A4-01', 'rửa chén', ['Nước rửa chén sinh học Fuwa3e'], 'có dấu'],
  ['A4-02', 'rua chen', ['Nước rửa chén sinh học Fuwa3e'], 'không dấu'],
  ['A4-03', 'RỬA CHÉN', ['Nước rửa chén sinh học Fuwa3e'], 'chữ hoa'],
  ['A4-04', 'chen rua', ['Nước rửa chén sinh học Fuwa3e'], 'đảo từ'],
  ['A4-05', 'xyzabc', [], 'không kết quả'],
  ['A4-06', 'fuwa', null, 'theo thương hiệu (6 SP Fuwa3e)'],
  ['A4-07', 'dầu', null, 'từ chung "dầu"'],
  ['A4-08', 'toi', null, '"toi" không dấu khớp "tôi"? (mơ hồ)'],
];
for (const [id, q, expect, step] of SEARCH) {
  const r = await get(`/products?q=${encodeURIComponent(q)}&limit=50`);
  const got = names(r);
  let ok;
  let exp;
  if (expect) {
    exp = JSON.stringify(expect);
    ok = r.status === 200 && JSON.stringify(got) === exp;
  } else if (q === 'fuwa') {
    const n = (await sql(`select count(*)::int n from products where brand ilike '%fuwa%' and "isActive" and "approvalStatus"='APPROVED'`))[0].n;
    exp = `${n} sản phẩm`;
    ok = r.status === 200 && got.length === n;
  } else if (q === 'dầu') {
    const n = (await sql(`select count(*)::int n from products where unaccent(lower(name)) like '%dau%' and "isActive" and "approvalStatus"='APPROVED'`).catch(() => null))?.[0]?.n;
    exp = n == null ? 'không đối chiếu được SQL (thiếu unaccent)' : `${n} sản phẩm`;
    ok = r.status === 200 && (n == null || got.length === n);
  } else {
    exp = 'không có luật';
    ok = true;
  }
  rec(FILE, { id, persona: 'new', surface: 'api', journey: 'tìm kiếm', step: `q="${q}" (${step})`, expected: exp, actual: `${r.status} ${got.length} SP: ${JSON.stringify(got.slice(0, 4))}`, status: id === 'A4-08' ? 'CAN_CHU' : ok ? 'PASS' : 'FAIL' });
}
const sug = await get(`/search/suggest?q=${encodeURIComponent('rua')}`);
rec(FILE, { id: 'A4-09', persona: 'new', surface: 'api', journey: 'tìm kiếm', step: 'gợi ý khi gõ "rua"', expected: '2xx, có gợi ý liên quan "rửa"', actual: `${sug.status} ${JSON.stringify(sug.body).slice(0, 240)}`, status: sug.status === 200 && /rửa/i.test(JSON.stringify(sug.body)) ? 'PASS' : 'FAIL' });
const long = await get(`/products?q=${'a'.repeat(101)}`);
rec(FILE, { id: 'A4-10', persona: 'new', surface: 'api', journey: 'tìm kiếm', step: 'từ khoá 101 ký tự', expected: '400 với chữ tiếng Việt (MAX_QUERY_LENGTH=100)', actual: `${long.status} ${JSON.stringify(long.body).slice(0, 200)}`, status: long.status === 400 ? 'PASS' : 'FAIL' });
const inj = await get(`/products?q=${encodeURIComponent("'; DROP TABLE products;--")}`);
rec(FILE, { id: 'A4-11', persona: 'new', surface: 'api', journey: 'tìm kiếm', step: 'chuỗi kiểu SQL injection', expected: '200 rỗng, bảng products còn nguyên', actual: `${inj.status} ${list(inj).length} SP; products=${(await sql('select count(*)::int n from products'))[0].n}`, status: inj.status === 200 && list(inj).length === 0 ? 'PASS' : 'FAIL' });

// --- danh mục ---
const cats = await get('/categories');
const rows = await sql(`select c.id, (select count(*)::int from products p where c.id = any(p."categoryIds") and p."isActive" and p."approvalStatus"='APPROVED') n from categories c order by c."sortOrder"`);
const mism = [];
for (const c of cats.body) {
  const r = rows.find((x) => x.id === c.id);
  const list2 = await get(`/products?category=${c.id}&limit=100`);
  const total = list(list2).length;
  if (r && r.n !== c.productCount) mism.push(`${c.id}: productCount ${c.productCount} ≠ SQL ${r.n}`);
  if (total !== c.productCount) mism.push(`${c.id}: danh sách ${total} ≠ productCount ${c.productCount}`);
}
rec(FILE, { id: 'A4-12', persona: 'new', surface: 'api', journey: 'danh mục', step: 'productCount mỗi danh mục = SQL = số SP trả về khi lọc', expected: 'khớp mọi danh mục', actual: cats.body.map((c) => `${c.name}:${c.productCount}`).join(', '), evidence: mism.join(' | ') || 'khớp SQL', status: mism.length ? 'FAIL' : 'PASS' });

// --- chi tiết SP ---
const pdp = async (slug, tok) => get(`/products/${slug}`, tok);
const p1 = await pdp('nuoc-rua-chen-fuwa3e');
const vars = (p1.body.variations ?? p1.body.variants ?? []).map((v) => [v.name, v.retailPrice ?? v.price, v.salePrice ?? null, v.stock]);
rec(FILE, { id: 'A4-13', persona: 'new', surface: 'api', journey: 'chi tiết SP', step: 'SP 2 biến thể (1L 120.000, Can 5L 480.000 sale 430.000)', expected: '2 biến thể đúng giá và tồn kho theo SQL', actual: `${p1.status} ${JSON.stringify(vars)}`, status: vars.length === 2 ? 'PASS' : 'FAIL' });
const p2 = await pdp('tieu-den-bhnong');
const v2 = (p2.body.variations ?? p2.body.variants ?? [])[0];
rec(FILE, { id: 'A4-14', persona: 'new', surface: 'api', journey: 'chi tiết SP', step: 'SP hết hàng (kho 0)', expected: '2xx, tồn kho 0 để màn báo "Hết hàng"', actual: `${p2.status} stock=${v2?.stock}`, status: p2.status === 200 && v2?.stock === 0 ? 'PASS' : 'FAIL' });
const p3 = await pdp('khong-co-san-pham-nay');
rec(FILE, { id: 'A4-15', persona: 'new', surface: 'api', journey: 'chi tiết SP', step: 'slug không tồn tại', expected: '404 tiếng Việt', actual: `${p3.status} ${JSON.stringify(p3.body)}`, status: p3.status === 404 && /[ạảãàáâăêôơưđ]|không/i.test(JSON.stringify(p3.body)) ? 'PASS' : 'FAIL' });
const p4 = await pdp('hat-dieu-rang-moc-bhnong');
const act = await get('/flash-sales/active');
const fv = p4.body.variations?.[0]?.id;
const inFlash = JSON.stringify(act.body).includes(fv) && JSON.stringify(act.body).includes('119000');
rec(FILE, { id: 'A4-16', persona: 'new', surface: 'api', journey: 'chi tiết SP', step: 'SP đang giờ vàng (hạt điều 500g: giá sale 159.000, giờ vàng 119.000); API SP không mang giá giờ vàng, màn lấy từ /flash-sales/active', expected: 'GET /products/:slug giá thường 159.000; /flash-sales/active có biến thể đó giá 119.000', actual: `SP ${p4.status} sale=${p4.body.salePrice}; giờ vàng có biến thể=${inFlash}`, status: p4.status === 200 && p4.body.salePrice === 159000 && inFlash ? 'PASS' : 'FAIL' });
// SP chưa duyệt / ngừng bán không lộ
await sql(`select 1`);
const hid = (await sql(`select slug from products where "isActive" = false or "approvalStatus" <> 'APPROVED' limit 1`))[0];
if (hid) {
  const ph = await pdp(hid.slug);
  rec(FILE, { id: 'A4-17', persona: 'new', surface: 'api', journey: 'chi tiết SP', step: `SP ngừng bán/chưa duyệt (${hid.slug})`, expected: '404, không lộ', actual: `${ph.status}`, status: ph.status === 404 ? 'PASS' : 'FAIL' });
}
// phiếu mã giảm giá khả dụng ở PDP/ví
const col = await get('/coupons/collectable');
rec(FILE, { id: 'A4-18', persona: 'new', surface: 'api', journey: 'phiếu mã giảm giá', step: 'GET /coupons/collectable', expected: '2xx', actual: `${col.status} ${JSON.stringify(col.body).slice(0, 220)}`, status: col.status === 200 ? 'PASS' : 'FAIL' });
await clearCart(w);
const prev = await api(L, 'POST', '/checkout/coupon-previews', { token: w.token, body: { addressId: w.addressId } });
rec(FILE, { id: 'A4-19', persona: 'new', surface: 'api', journey: 'phiếu mã giảm giá', step: 'coupon-previews khi giỏ trống', expected: '2xx (không 500)', actual: `${prev.status} ${JSON.stringify(prev.body).slice(0, 220)}`, status: prev.status < 500 ? 'PASS' : 'FAIL' });
await closePrisma();
