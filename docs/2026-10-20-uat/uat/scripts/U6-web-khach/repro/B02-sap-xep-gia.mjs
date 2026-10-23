// U6-B02: "Giá tăng"/"Giá giảm" sắp theo giá gốc (basePrice) nên sai thứ tự khi sản phẩm có giá khuyến mãi (salePrice).
// Chạy:  node repro/B02-sap-xep-gia.mjs   (lane 6 đang chạy). Kỳ vọng sau khi sửa: danh sách theo giá hiệu lực (salePrice ?? basePrice) tăng/giảm đều.
import { api, L, finish, Recorder } from '../_lib.mjs';
const rec = new Recorder('repro-B02');
await rec.run('U6-B02', { role: 'Khách ghé (API công khai dùng chung web + Mini App)', journey: 'Sắp xếp giá', steps: 'GET /products?sort=price_asc&limit=60 và sort=price_desc', expected: 'Thứ tự theo giá khách phải trả (salePrice nếu có, không thì basePrice)' }, async (c) => {
  for (const [sort, dir] of [['price_asc', 1], ['price_desc', -1]]) {
    const r = await api(L, 'GET', `/products?sort=${sort}&limit=60`, {});
    const items = r.body?.data ?? r.body?.items ?? r.body ?? [];
    const eff = items.map((p) => p.salePrice ?? p.basePrice);
    const sorted = [...eff].sort((a, b) => dir * (a - b));
    c.ev(`${sort} giá hiệu lực`, eff.join(','));
    c.ok(`${sort}: giá hiệu lực đúng thứ tự ${dir > 0 ? 'tăng' : 'giảm'}`, JSON.stringify(eff) === JSON.stringify(sorted), { got: eff.slice(0, 14), want: sorted.slice(0, 14) });
  }
});
await finish(rec);
