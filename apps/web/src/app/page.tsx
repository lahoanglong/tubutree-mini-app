import Link from 'next/link';
import { ShieldCheck, Truck, RotateCcw, Sparkles, ChevronRight } from 'lucide-react';
import { getProductsPage, getCategories, type CategoryItem } from '@/lib/api';
import { browseHref, EMPTY_SEARCH_STATE } from '@/lib/search-state';
import ProductCard, { PRIORITY_CARDS } from '@/components/product-card';

export const revalidate = 300;

/** Số sản phẩm ở dải nổi bật của trang chủ; muốn xem thêm, lọc hay tìm thì sang /san-pham. */
const FEATURED_COUNT = 12;

/** Danh mục là phần thêm cho trang chủ: API danh mục lỗi thì bỏ hàng này chứ không làm hỏng cả lưới sản phẩm. */
const loadCategories = (): Promise<CategoryItem[]> => getCategories().catch(() => []);

const COMMITMENTS = [
  { Icon: ShieldCheck, tone: 'bg-forest-50 text-forest-700', title: 'Thuần Chay & Lành Tính', note: 'Đạt chuẩn kiểm định, an toàn cho làn da' },
  { Icon: Truck, tone: 'bg-sage-50 text-sage-700', title: 'Giao Hàng Nhanh Toàn Quốc', note: 'Đóng gói vật liệu phân hủy sinh học' },
  // Chính sách thật (miniapp /about, và chính tab Đổi/Trả của admin): chỉ đổi/trả khi sản phẩm LỖI NHÀ SẢN XUẤT, trong
  // 7 ngày. Hứa "hoàn tiền nếu không hài lòng" là rộng hơn hẳn — khách đổi ý sẽ bị từ chối và có cơ sở khiếu nại.
  { Icon: RotateCcw, tone: 'bg-forest-50 text-forest-700', title: 'Đổi Trả 7 Ngày', note: 'Hàng lỗi nhà sản xuất — đổi mới hoặc hoàn tiền' },
];

export default async function HomePage() {
  const categories = await loadCategories();
  const shelf = categories.filter((c) => c.productCount === undefined || c.productCount > 0);
  const result = await getProductsPage({});
  const products = result.data.slice(0, FEATURED_COUNT);

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
            <span>SỐNG XANH AN LÀNH · NGUỒN GỐC VIỆT NAM</span>
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
              href="/san-pham"
              className="inline-flex min-h-11 items-center gap-2 rounded-control bg-stone-0 px-5 text-sm font-semibold text-forest-700 shadow-card transition hover:bg-forest-50 active:scale-95"
            >
              <span>Mua sắm ngay</span>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      {/* ── Mua theo danh mục: khách mới có lối vào ngay dưới hero, trước phần cam kết ── */}
      {shelf.length > 0 && (
        <nav aria-label="Mua theo danh mục" className="mb-6">
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {shelf.map((c) => (
              <Link
                key={c.id}
                href={browseHref({ ...EMPTY_SEARCH_STATE, category: c.id })}
                className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full border border-stone-300 bg-stone-0 px-4 text-sm font-medium text-stone-700 transition-all hover:border-stone-450 hover:bg-stone-50"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </nav>
      )}

      {/* ── Cam kết: một hàng ba ô ở mọi cỡ màn hình; điện thoại chỉ giữ tiêu đề để vừa hàng ── */}
      <section aria-labelledby="cam-ket" className="mb-8">
        <h2 id="cam-ket" className="sr-only">
          Cam kết của Tubu Tree
        </h2>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {COMMITMENTS.map(({ Icon, tone, title, note }) => (
            <div
              key={title}
              className="flex flex-col items-center gap-2 rounded-card border border-stone-200 bg-stone-0 p-3 text-center shadow-card sm:flex-row sm:gap-3.5 sm:p-4 sm:text-left"
            >
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-control ${tone}`}>
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-stone-900 sm:text-sm">{title}</h3>
                <p className="hidden text-xs text-stone-600 sm:block">{note}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Sản phẩm nổi bật ── */}
      <section id="san-pham" className="mb-6 scroll-mt-32 sm:scroll-mt-20">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-stone-900 sm:text-2xl">Sản Phẩm Nổi Bật</h2>
          <Link href="/san-pham" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-forest-700 underline">
            Xem tất cả sản phẩm
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
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
              Hiện chưa có sản phẩm nào hoặc hệ thống đang được cập nhật thêm nguồn hàng mới.
            </p>
            <Link
              href="/san-pham"
              className="mt-4 inline-flex min-h-11 items-center rounded-control bg-forest-600 px-5 text-sm font-semibold text-stone-0 shadow-card transition hover:bg-forest-700"
            >
              Xem toàn bộ sản phẩm
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 md:grid-cols-4">
            {products.map((p, i) => (
              <ProductCard key={p.id} product={p} priority={i < PRIORITY_CARDS} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
