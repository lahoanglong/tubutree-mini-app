import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck, Truck, RotateCcw, Sparkles, ChevronRight } from 'lucide-react';
import { getProducts, getBrands } from '@/lib/api';
import { firstParam, homeHref, normalizeSearchQuery } from '@/lib/catalog-filter';
import ProductCard from '@/components/product-card';

export const revalidate = 300;

type HomeSearchParams = Promise<{ brand?: string | string[]; q?: string | string[] }>;

// Mỗi từ khoá là một URL riêng: không để công cụ tìm kiếm lập chỉ mục vô số trang kết quả.
export async function generateMetadata({ searchParams }: { searchParams: HomeSearchParams }): Promise<Metadata> {
  const { q } = await searchParams;
  return normalizeSearchQuery(q) ? { robots: { index: false, follow: true } } : {};
}

export default async function HomePage({ searchParams }: { searchParams: HomeSearchParams }) {
  const sp = await searchParams;
  const brand = firstParam(sp.brand);
  const q = normalizeSearchQuery(sp.q);
  const [products, brands] = await Promise.all([
    getProducts({ ...(brand ? { brand } : {}), ...(q ? { q } : {}) }),
    getBrands(),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      {/* ── Hero ── */}
      <section className="relative mb-8 overflow-hidden rounded-sheet bg-forest-800 px-6 py-10 text-stone-0 shadow-raised sm:px-10 sm:py-14">
        {/* Hai mảng sáng mờ làm điểm nhấn nền, không mang thông tin */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-forest-500/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-12 h-64 w-64 rounded-full bg-sage-600/25 blur-3xl" />

        <div className="relative z-10 max-w-2xl">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-forest-300/30 bg-forest-500/20 px-3.5 py-1 text-xs font-semibold tracking-wide text-forest-100 backdrop-blur-md">
            <Sparkles className="h-3.5 w-3.5 text-forest-200" aria-hidden="true" />
            <span>SỐNG XANH AN LÀNH · 100% NGUYÊN BẢN VIỆT NAM</span>
          </p>

          <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
            Mỹ Phẩm & Tiêu Dùng <br className="hidden sm:inline" />
            <span className="text-forest-200">Sinh Học Thuần Khiết</span>
          </h1>

          <p className="mt-4 max-w-xl text-sm leading-relaxed text-forest-100 sm:text-base">
            Tuyển chọn những sản phẩm sống xanh lành tính nhất từ các nhà xưởng nông nghiệp bền vững.
            An toàn cho cả gia đình, giảm phát thải và chung tay bảo vệ môi trường.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <a
              href="#san-pham"
              className="inline-flex min-h-11 items-center gap-2 rounded-control bg-stone-0 px-5 text-sm font-semibold text-forest-700 shadow-card transition hover:bg-forest-50 active:scale-95"
            >
              <span>Mua sắm ngay</span>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      {/* ── Cam kết ── */}
      <section aria-labelledby="cam-ket" className="mb-10">
        <h2 id="cam-ket" className="sr-only">
          Cam kết của Tubu Tree
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex items-center gap-3.5 rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-forest-50 text-forest-700">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-stone-900">100% Thuần Chay & Lành Tính</h3>
              <p className="text-xs text-stone-600">Đạt chuẩn kiểm định, an toàn cho làn da</p>
            </div>
          </div>

          <div className="flex items-center gap-3.5 rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-sage-50 text-sage-700">
              <Truck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-stone-900">Giao Hàng Nhanh Toàn Quốc</h3>
              <p className="text-xs text-stone-600">Đóng gói vật liệu phân hủy sinh học</p>
            </div>
          </div>

          <div className="flex items-center gap-3.5 rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-forest-50 text-forest-700">
              <RotateCcw className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              {/* Chính sách thật (miniapp /about, và chính tab Đổi/Trả của admin): chỉ đổi/trả khi
                  sản phẩm LỖI NHÀ SẢN XUẤT, trong 7 ngày. Hứa "hoàn tiền nếu không hài lòng" là
                  rộng hơn hẳn — khách đổi ý sẽ bị từ chối và có cơ sở khiếu nại. */}
              <h3 className="text-sm font-semibold text-stone-900">Đổi Trả 7 Ngày</h3>
              <p className="text-xs text-stone-600">Hàng lỗi nhà sản xuất — đổi mới hoặc hoàn tiền</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Lọc theo thương hiệu ── */}
      <section id="san-pham" className="mb-6 scroll-mt-32 sm:scroll-mt-20">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-stone-900 sm:text-2xl">Danh Mục Thương Hiệu</h2>
          <span className="text-xs text-stone-600">
            {products.length} sản phẩm {q ? 'phù hợp' : 'đang bán'}
          </span>
        </div>

        {q && (
          <p role="status" className="mb-3 flex flex-wrap items-center gap-x-3 text-sm text-stone-700">
            <span>
              Kết quả tìm kiếm cho “<strong className="break-all font-semibold text-stone-900">{q}</strong>”
            </span>
            <Link href={homeHref({ brand })} className="inline-flex min-h-11 items-center font-semibold text-forest-700 underline">
              Xóa tìm kiếm
            </Link>
          </p>
        )}

        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          <Link
            href={homeHref({ q })}
            aria-current={!brand ? 'true' : undefined}
            className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-all ${
              !brand
                ? 'bg-forest-600 text-stone-0 shadow-card ring-2 ring-forest-600/30'
                : 'border border-stone-300 bg-stone-0 text-stone-700 hover:border-stone-450 hover:bg-stone-50'
            }`}
          >
            Tất cả sản phẩm
          </Link>
          {brands.map((b) => {
            const isActive = brand === b.brand;
            return (
              <Link
                key={b.brand}
                href={homeHref({ brand: b.brand, q })}
                aria-current={isActive ? 'true' : undefined}
                className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-4 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-forest-600 font-semibold text-stone-0 shadow-card ring-2 ring-forest-600/30'
                    : 'border border-stone-300 bg-stone-0 text-stone-700 hover:border-stone-450 hover:bg-stone-50'
                }`}
              >
                {b.brand} <span className="ml-1 text-xs opacity-80">({b.count})</span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── Lưới sản phẩm ── */}
      <section aria-labelledby="danh-sach-san-pham">
        <h2 id="danh-sach-san-pham" className="sr-only">
          Danh sách sản phẩm
        </h2>
        {products.length === 0 ? (
          <div className="rounded-card border border-stone-200 bg-stone-0 p-12 text-center shadow-card">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-forest-50 text-forest-600">
              <Sparkles className="h-6 w-6" aria-hidden="true" />
            </div>
            <h3 className="mt-3 font-display text-lg font-semibold text-stone-900">Chưa có sản phẩm phù hợp</h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-stone-600">
              {q ? (
                <>
                  Không tìm thấy sản phẩm nào cho “<span className="break-all">{q}</span>”. Hãy thử từ khoá ngắn hơn hoặc xem toàn bộ sản phẩm.
                </>
              ) : (
                'Hiện chưa có sản phẩm nào thuộc bộ lọc này hoặc hệ thống đang được cập nhật thêm nguồn hàng mới.'
              )}
            </p>
            <Link
              href="/"
              className="mt-4 inline-flex min-h-11 items-center rounded-control bg-forest-600 px-5 text-sm font-semibold text-stone-0 shadow-card transition hover:bg-forest-700"
            >
              Xem toàn bộ sản phẩm
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 md:grid-cols-4">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
