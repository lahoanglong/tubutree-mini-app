import Link from 'next/link';
import { ShieldCheck, Truck, RotateCcw, Sparkles, Store, ChevronRight } from 'lucide-react';
import { getProducts, getBrands } from '@/lib/api';
import ProductCard from '@/components/product-card';

export const revalidate = 300;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) {
  const { brand } = await searchParams;
  const [products, brands] = await Promise.all([
    getProducts(brand ? { brand } : {}),
    getBrands(),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      {/* ── Biophilic Hero Section ── */}
      <section className="relative mb-8 overflow-hidden rounded-3xl bg-gradient-to-br from-leaf-900 via-leaf-800 to-primary-900 px-6 py-10 sm:px-10 sm:py-14 text-white shadow-lg">
        {/* Subtle background decorative shapes */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-leaf-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-12 h-64 w-64 rounded-full bg-primary-500/20 blur-3xl" />

        <div className="relative z-10 max-w-2xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-leaf-400/30 bg-leaf-500/20 px-3.5 py-1 text-xs font-semibold tracking-wide text-leaf-200 backdrop-blur-md">
            <Sparkles className="h-3.5 w-3.5 text-primary-300" />
            <span>SỐNG XANH AN LÀNH · 100% NGUYÊN BẢN VIỆT NAM</span>
          </div>

          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl leading-tight">
            Mỹ Phẩm & Tiêu Dùng <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-primary-300 via-leaf-200 to-white bg-clip-text text-transparent">
              Sinh Học Thuần Khiết
            </span>
          </h1>

          <p className="mt-4 text-sm sm:text-base leading-relaxed text-leaf-100/90 max-w-xl">
            Tuyển chọn những sản phẩm sống xanh lành tính nhất từ các nhà xưởng nông nghiệp bền vững. 
            An toàn cho cả gia đình, giảm phát thải và chung tay bảo vệ môi trường.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <a
              href="#san-pham"
              className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-primary-700 active:scale-95"
            >
              <span>Mua sắm ngay</span>
              <ChevronRight className="h-4 w-4" />
            </a>

            <Link
              href="/merchant"
              className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/20 active:scale-95"
            >
              <Store className="h-4 w-4 text-leaf-300" />
              <span>Mở gian hàng Đối tác</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Trust Pillars Bar ── */}
      <section className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3.5 rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-sm">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-leaf-50 text-leaf-700">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-neutral-900">100% Thuần Chay & Lành Tính</h4>
            <p className="text-[11px] text-neutral-500">Đạt chuẩn kiểm định, an toàn cho làn da</p>
          </div>
        </div>

        <div className="flex items-center gap-3.5 rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-sm">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-neutral-900">Giao Hàng Nhanh Toàn Quốc</h4>
            <p className="text-[11px] text-neutral-500">Đóng gói vật liệu phân hủy sinh học</p>
          </div>
        </div>

        <div className="flex items-center gap-3.5 rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-sm">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-leaf-50 text-leaf-700">
            <RotateCcw className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-neutral-900">Đổi Trả Miễn Phí 7 Ngày</h4>
            <p className="text-[11px] text-neutral-500">Cam kết hoàn tiền nếu không hài lòng</p>
          </div>
        </div>
      </section>

      {/* ── Brand Filter Section ── */}
      <section id="san-pham" className="mb-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-neutral-900 sm:text-xl">Danh Mục Thương Hiệu</h2>
          <span className="text-xs text-neutral-500">{products.length} sản phẩm đang bán</span>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          <Link
            href="/"
            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
              !brand
                ? 'bg-primary-600 text-white shadow-sm ring-2 ring-primary-600/30'
                : 'border border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50'
            }`}
          >
            Tất cả sản phẩm
          </Link>
          {brands.map((b) => {
            const isActive = brand === b.brand;
            return (
              <Link
                key={b.brand}
                href={`/?brand=${encodeURIComponent(b.brand)}#san-pham`}
                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-primary-600 text-white shadow-sm ring-2 ring-primary-600/30 font-semibold'
                    : 'border border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                {b.brand} <span className="text-[10px] opacity-75">({b.count})</span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── Products Showcase Grid ── */}
      {products.length === 0 ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-12 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-leaf-50 text-leaf-600">
            <Sparkles className="h-6 w-6" />
          </div>
          <h3 className="mt-3 text-base font-bold text-neutral-800">Chưa có sản phẩm phù hợp</h3>
          <p className="mt-1 text-xs text-neutral-500 max-w-sm mx-auto">
            Hiện chưa có sản phẩm nào thuộc bộ lọc này hoặc hệ thống đang được cập nhật thêm nguồn hàng mới.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-xl bg-primary-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-primary-700"
          >
            Xem toàn bộ sản phẩm
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 sm:gap-5">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </main>
  );
}

