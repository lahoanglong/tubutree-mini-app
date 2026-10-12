import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { GET, HEAD } from './route';

const go = (url: string, slug: string) => GET(new NextRequest(url), { params: Promise.resolve({ slug }) });

// PC-7: Content Kit (API content-kit.service.ts) sinh link `/product/<slug>?ref=<mã CTV>` dùng được cho Mini App, còn
// miniapp ghép thêm domain web khi `app.miniapp_base_url` chưa cấu hình. Web chỉ có /san-pham/<slug> nên link đó 404 và
// khách bấm link CTV chia sẻ không thấy sản phẩm. Đường cũ chuyển về đường đúng và giữ nguyên ?ref= để CTV vẫn có hoa hồng.
describe('/product/[slug] (link Content Kit cũ) chuyển sang /san-pham/[slug]', () => {
  it('307, giữ slug và mã giới thiệu ?ref=', async () => {
    const res = await go('https://app.tubutree.com/product/tra-xanh?ref=ABC123', 'tra-xanh');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/san-pham/tra-xanh?ref=ABC123');
  });

  it('không có query thì không thêm dấu ?', async () => {
    const res = await go('https://app.tubutree.com/product/tra-xanh', 'tra-xanh');
    expect(res.headers.get('location')).toBe('/san-pham/tra-xanh');
  });

  it('giữ nguyên mọi tham số (utm_*, tham số lặp)', async () => {
    const res = await go('https://app.tubutree.com/product/dau-goi?ref=X1&utm_source=zalo&tag=a&tag=b', 'dau-goi');
    expect(res.headers.get('location')).toBe('/san-pham/dau-goi?ref=X1&utm_source=zalo&tag=a&tag=b');
  });

  // Location tương đối (Next không sửa Location của route handler): đi theo host/giao thức khách đang dùng, không phụ
  // thuộc host nội bộ sau reverse proxy.
  it('Location luôn tương đối và bắt đầu bằng /san-pham/, kể cả khi slug có ký tự lạ', async () => {
    for (const slug of ['a b', '..%2F..%2Fevil.com', '//evil.com', 'x\\evil']) {
      const loc = (await go('https://app.tubutree.com/product/x', slug)).headers.get('location')!;
      expect(loc.startsWith('/san-pham/'), loc).toBe(true);
      expect(loc).not.toContain('://');
    }
  });

  it('chấp nhận params dạng đồng bộ (Next 14) lẫn Promise (Next 15)', async () => {
    const sync = await GET(new NextRequest('https://app.tubutree.com/product/tra-xanh'), { params: { slug: 'tra-xanh' } });
    expect(sync.headers.get('location')).toBe('/san-pham/tra-xanh');
  });

  it('HEAD cũng chuyển hướng (bộ xem trước link của Zalo/Facebook dò bằng HEAD)', async () => {
    const res = await HEAD(new NextRequest('https://app.tubutree.com/product/tra-xanh?ref=A'), { params: Promise.resolve({ slug: 'tra-xanh' }) });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/san-pham/tra-xanh?ref=A');
  });
});
