import type { APIRequestContext } from '@playwright/test';

/**
 * Chọn sản phẩm có sẵn trong DB e2e cho các spec web PDP: phần server của Next gọi API thật nên spec cần slug thật;
 * mọi lời gọi từ trình duyệt đi qua mock. Trả null khi API chưa lên hoặc DB chưa có sản phẩm để spec tự bỏ qua kèm lý do.
 */
const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;

export interface PdpProduct {
  slug: string;
  variations: { id: string; stock: number }[];
}

async function detailOf(request: APIRequestContext, slug: string): Promise<PdpProduct | null> {
  const r = await request.get(`${API_ORIGIN}/api/products/${encodeURIComponent(slug)}`).catch(() => null);
  return r?.ok() ? ((await r.json()) as PdpProduct) : null;
}

async function listSlugs(request: APIRequestContext, limit: number): Promise<string[]> {
  const res = await request.get(`${API_ORIGIN}/api/products?limit=${limit}`).catch(() => null);
  if (!res?.ok()) return [];
  return ((await res.json()) as { data?: { slug: string }[] }).data?.map((x) => x.slug) ?? [];
}

export async function firstProduct(request: APIRequestContext): Promise<PdpProduct | null> {
  const [slug] = await listSlugs(request, 1);
  return slug ? detailOf(request, slug) : null;
}

/** Sản phẩm đầu tiên (theo thứ tự danh sách) có từ 2 phân loại: cần cho ca chip hết hàng, nên không có thì spec phải skip, không được qua lặng lẽ. */
export async function multiVariationProduct(request: APIRequestContext, scan = 50): Promise<PdpProduct | null> {
  for (const slug of await listSlugs(request, scan)) {
    const d = await detailOf(request, slug);
    if (d && d.variations.length >= 2) return d;
  }
  return null;
}
