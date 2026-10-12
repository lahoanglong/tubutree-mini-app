import type { NextRequest } from 'next/server';

type Ctx = { params: Promise<{ slug: string }> | { slug: string } };

/**
 * Link Content Kit và chia sẻ của Mini App có dạng `/product/<slug>?ref=<mã CTV>`; trang sản phẩm của web nằm ở
 * `/san-pham/<slug>`. Route handler chứ không phải `redirect()` trong page: root có `loading.tsx` nên page đã bắt đầu
 * stream 200 trước khi redirect chạy, còn handler trả được 307 thật. 307 (không phải 308) để trình duyệt/CDN không ghim
 * lại nếu sau này đổi đường dẫn. `?ref=` đi theo sang trang đích, nơi `ReferralCapture` (layout) ghi nhận hoa hồng cho CTV.
 *
 * Location tương đối: Next không sửa Location của route handler, nên nó theo host/giao thức khách đang dùng thay vì host nội
 * bộ sau reverse proxy.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  const { slug } = await params;
  return new Response(null, {
    status: 307,
    headers: { Location: `/san-pham/${encodeURIComponent(slug)}${request.nextUrl.search}` },
  });
}

export const HEAD = GET;
