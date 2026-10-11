'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Store,
  CreditCard,
  Truck,
  Package,
  ShoppingBag,
  ExternalLink,
  Plus,
  CheckCircle2,
  AlertCircle,
  Eye,
  RefreshCw,
  Sparkles,
  ShieldCheck,
  Info,
  X,
  Clock,
  Trash2,
  Check,
  Leaf,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { formatVnd } from '@/lib/shop-client';
import {
  getMerchantStore,
  updateMerchantStore,
  getMerchantProducts,
  createMerchantProduct,
  addResellProduct,
  removeResellProduct,
  listMerchantOrders,
  countMerchantOrders,
  updateMerchantOrderStatus,
  type MerchantStore,
  type MerchantProduct,
  type MerchantOrder,
  type UpdateMerchantStoreInput,
  type CreateMerchantProductInput,
} from '@/lib/merchant-client';
import { pageRange } from '@/lib/admin-client';
import { ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS } from '@/lib/export-csv';
import { BTN_LINK_DANGER, BTN_PRIMARY, BTN_SMALL, FIELD_CLASS, INPUT_CLASS, TOUCH_H } from '@/components/admin/ui';
import { DEFAULT_THEME_COLOR, THEME_COLORS } from './theme-colors';

const POPULAR_BANKS = [
  { bin: '970436', name: 'Vietcombank (VCB)' },
  { bin: '970407', name: 'Techcombank (TCB)' },
  { bin: '970422', name: 'MB Bank (Quân Đội)' },
  { bin: '970415', name: 'VietinBank (CTG)' },
  { bin: '970418', name: 'BIDV' },
  { bin: '970416', name: 'ACB (Á Châu)' },
  { bin: '970432', name: 'VPBank' },
  { bin: '970423', name: 'TPBank' },
  { bin: '970403', name: 'Sacombank' },
  { bin: '970441', name: 'VIB' },
];

// Nhãn đứng riêng một dòng phía trên (không bọc `label`), nên ô nhập tự chừa khoảng cách và cao 44px khi chạm.
const MERCHANT_INPUT = `mt-1 ${INPUT_CLASS} ${TOUCH_H}`;

const subTabClass = (active: boolean) =>
  `rounded-control px-3 py-1.5 text-xs font-medium ${TOUCH_H} ${
    active ? 'bg-forest-600 text-stone-0' : 'border border-stone-450 bg-stone-0 text-stone-700'
  }`;

// Nút chuyển trạng thái đơn (chỉ ADMIN thấy): cùng họ nút hành động của order-status-actions bên admin.
const ORDER_ACTION = `${TOUCH_H} rounded-control px-2.5 py-1 text-xs font-medium text-stone-0 disabled:opacity-50`;

type MerchantTab = 'store' | 'banking' | 'warehouse' | 'products' | 'orders';

export default function MerchantPage() {
  const { user, status, initialized } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<MerchantTab>('store');

  // `enabled` là bắt buộc, không phải tối ưu: hook chạy TRƯỚC guard bên dưới, nên khi tải lại
  // trang lúc đã đăng nhập, ba request này bay đi trong lúc AuthProvider còn đang refresh phiên.
  // Chúng chưa có access token → 401 (guard JWT trả rất nhanh vì không chạm DB) → client-api tự
  // gọi refresh với ĐÚNG refresh token mà AuthProvider đang dùng. Backend xoay token single-use
  // và coi lần dùng lại là reuse → thu hồi TOÀN BỘ phiên của user, văng khỏi cả web lẫn Mini App.
  const authed = status === 'authenticated';
  const storeQ = useQuery({ queryKey: ['merchant-store'], queryFn: getMerchantStore, enabled: authed });
  // Cùng queryKey/limit với trang 1 của ProductsTab → dùng chung cache. Số trên thẻ KPI đọc meta tổng
  // (ownTotal/resellTotal) — đếm `.length` của trang đầu thì không bao giờ vượt cỡ trang.
  const productsQ = useQuery({ queryKey: ['merchant-products', 1], queryFn: () => getMerchantProducts(1), enabled: authed });
  // Chỉ cần SỐ đơn chờ đóng gói → đọc meta.total (limit=1). Trước đây tải trang đơn đầu rồi `.filter` —
  // vừa sai khi quá 1 trang, vừa crash vì BE trả `{ data, meta }` chứ không phải mảng.
  const pendingOrdersQ = useQuery({
    queryKey: ['merchant-orders', 'count', 'CONFIRMED'],
    queryFn: () => countMerchantOrders('CONFIRMED'),
    enabled: authed,
  });

  // Chờ lượt khôi phục phiên chạy xong: render đầu tiên luôn là 'idle' (xem AuthState.initialized),
  // không chờ thì màn "Cổng Quản Trị Đối Tác — đăng nhập" chớp lên mỗi lần F5.
  if (!initialized || status === 'loading') {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="flex items-center gap-2 text-sm font-medium text-stone-500">
          <RefreshCw className="h-4 w-4 animate-spin text-forest-600" aria-hidden="true" />
          <span>Đang kết nối trung tâm đối tác…</span>
        </div>
      </div>
    );
  }

  if (status !== 'authenticated') {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-forest-50 text-forest-700 shadow-card">
          <Store className="h-8 w-8" aria-hidden="true" />
        </div>
        <h2 className="mt-4 font-display text-2xl font-semibold text-stone-900">Cổng Quản Trị Đối Tác</h2>
        <p className="mt-2 text-sm text-stone-600">
          Vui lòng đăng nhập tài khoản đối tác doanh nghiệp để quản lý gian hàng, kho hàng và đơn hàng.
        </p>
        <Link
          href="/dang-nhap"
          className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-control bg-forest-600 px-6 py-2.5 text-sm font-semibold text-stone-0 shadow-card transition hover:bg-forest-700"
        >
          <span>Đăng nhập ngay</span>
        </Link>
      </div>
    );
  }

  // BE giới hạn portal này cho DEALER/AFFILIATE/ADMIN (merchant.controller.ts). Không kiểm tra ở
  // đây thì khách lẻ bấm "Kênh Đối Tác" ở header (nút luôn hiện) sẽ thấy nguyên khung portal —
  // tiêu đề, 4 thẻ số liệu 0, 5 tab — kèm một hộp lỗi 403. Trang /admin đã kiểm; trang này sót.
  if (user && !['DEALER', 'AFFILIATE', 'ADMIN'].includes(user.role)) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-forest-50 text-forest-700 shadow-card">
          <Store className="h-8 w-8" aria-hidden="true" />
        </div>
        <h2 className="mt-4 font-display text-2xl font-semibold text-stone-900">Kênh dành cho đối tác</h2>
        <p className="mt-2 text-sm text-stone-600">
          Tài khoản của bạn chưa phải đại lý hoặc cộng tác viên. Đăng ký trong Mini App Tubu Tree
          để mở kênh bán hàng riêng.
        </p>
      </div>
    );
  }

  const store = storeQ.data;
  const ownCount = productsQ.data?.meta?.ownTotal ?? 0;
  const resellCount = productsQ.data?.meta?.resellTotal ?? 0;
  const pendingOrdersCount = pendingOrdersQ.data ?? 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      {/* ── Top Header Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-stone-200 bg-stone-0 p-5 shadow-card sm:p-6">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="break-words font-display text-xl font-semibold tracking-tight text-stone-900 sm:text-2xl">
              {store?.title ?? 'Cổng Quản Trị Gian Hàng Đối Tác'}
            </h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-forest-100 px-2.5 py-0.5 text-xs font-semibold text-forest-800">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {store?.type ?? 'MERCHANT'}
            </span>
            {store && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  store.isPublished
                    ? 'bg-success-bg text-success-fg'
                    : 'bg-warning-bg text-warning-fg'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${store.isPublished ? 'bg-success-fg' : 'bg-warning-fg'}`} aria-hidden="true" />
                {store.isPublished ? 'Đang xuất bản' : 'Chưa xuất bản'}
              </span>
            )}
          </div>
          {store?.subdomain && (
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-stone-500">
              <span>Đường dẫn gian hàng riêng:</span>
              <a
                href={`https://${store.subdomain}.tubutree.com`}
                target="_blank"
                rel="noreferrer"
                className="break-all font-semibold text-forest-700 hover:underline"
              >
                https://{store.subdomain}.tubutree.com
              </a>
            </p>
          )}
        </div>

        {store && (
          <div className="flex items-center gap-2">
            <Link
              href={`/s/${store.subdomain || store.slug}`}
              target="_blank"
              className={`inline-flex items-center gap-1.5 rounded-control border border-stone-450 bg-stone-0 px-4 py-2 text-xs font-semibold text-stone-700 transition hover:border-forest-600 hover:bg-forest-50 hover:text-forest-800 ${TOUCH_H}`}
            >
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Xem gian hàng</span>
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
        )}
      </div>

      {/* ── KPI Overview Metric Cards ── */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <div className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-500">Sản phẩm riêng</span>
            <Package className="h-4 w-4 text-forest-700" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-bold text-stone-900">{ownCount}</p>
          <span className="text-[11px] text-stone-500">Do đối tác tự tải lên</span>
        </div>

        <div className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-500">Sản phẩm bán lại</span>
            <Sparkles className="h-4 w-4 text-honey-600" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-bold text-stone-900">{resellCount}</p>
          <span className="text-[11px] text-stone-500">Từ kho Tubu Tree</span>
        </div>

        <div className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-500">Chờ đóng gói</span>
            <ShoppingBag className="h-4 w-4 text-info-fg" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-bold text-stone-900">{pendingOrdersCount}</p>
          <span className="text-[11px] text-stone-500">Cần xuất kho ngay</span>
        </div>

        <div className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-500">Trạng thái shop</span>
            <Store className="h-4 w-4 text-success-fg" aria-hidden="true" />
          </div>
          <p className="mt-2 text-sm font-bold text-stone-900">
            {store?.isPublished ? 'Hoạt động công khai' : 'Tạm khóa / Ẩn'}
          </p>
          <span className="text-[11px] text-stone-500">Mã: {store?.slug}</span>
        </div>
      </div>

      {/* ── Navigation Tabs ── */}
      <div className="mt-6 flex gap-2 overflow-x-auto border-b border-stone-200 pb-0.5 scrollbar-none">
        {[
          { k: 'store', label: 'Gian hàng & Subdomain', icon: Store },
          { k: 'banking', label: 'Tài khoản VietQR', icon: CreditCard },
          { k: 'warehouse', label: 'Kho Hàng & Giao Nhận', icon: Truck },
          { k: 'products', label: 'Quản Lý Sản Phẩm', icon: Package },
          { k: 'orders', label: 'Đơn Hàng Thuộc Kho', icon: ShoppingBag },
        ].map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.k;
          return (
            <button
              key={t.k}
              onClick={() => setTab(t.k as MerchantTab)}
              className={`flex min-h-[44px] items-center gap-2 whitespace-nowrap px-4 py-3 text-sm font-semibold transition-all ${
                isActive
                  ? 'border-b-2 border-forest-600 text-forest-800'
                  : 'text-stone-500 hover:text-stone-900'
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? 'text-forest-600' : 'text-stone-500'}`} aria-hidden="true" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        {storeQ.isLoading && (
          <div className="p-8 text-center text-sm text-stone-500">Đang tải thông tin gian hàng…</div>
        )}
        {storeQ.isError && (
          <div className="rounded-control border border-danger-fg bg-danger-bg p-4 text-sm text-danger-fg">
            {(storeQ.error as Error).message}
          </div>
        )}

        {store && (
          <>
            {tab === 'store' && <StoreSettingsTab store={store} onUpdated={() => storeQ.refetch()} />}
            {tab === 'banking' && <BankingTab store={store} onUpdated={() => storeQ.refetch()} />}
            {tab === 'warehouse' && <WarehouseTab store={store} onUpdated={() => storeQ.refetch()} />}
            {tab === 'products' && <ProductsTab store={store} />}
            {tab === 'orders' && <OrdersTab store={store} />}
          </>
        )}
      </div>
    </main>
  );
}


// ── Tab 1: Cấu hình Gian hàng & Subdomain ──
function StoreSettingsTab({ store, onUpdated }: { store: MerchantStore; onUpdated: () => void }) {
  const [title, setTitle] = useState(store.title ?? '');
  const [headerNote, setHeaderNote] = useState(store.headerNote ?? '');
  const [subdomain, setSubdomain] = useState(store.subdomain ?? '');
  const [themeColor, setThemeColor] = useState(store.themeColor ?? DEFAULT_THEME_COLOR);
  const [coverUrl, setCoverUrl] = useState(store.coverUrl ?? '');
  const [avatarUrl, setAvatarUrl] = useState(store.avatarUrl ?? '');
  const [isPublished, setIsPublished] = useState(store.isPublished ?? true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const mut = useMutation({
    mutationFn: (dto: UpdateMerchantStoreInput) => updateMerchantStore(dto),
    onSuccess: () => {
      setMsg({ ok: true, text: 'Đã lưu cấu hình gian hàng thành công!' });
      onUpdated();
    },
    onError: (e: Error) => {
      setMsg({ ok: false, text: e.message });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    mut.mutate({
      title: title.trim(),
      headerNote: headerNote.trim() || undefined,
      subdomain: subdomain.trim() || undefined,
      themeColor,
      coverUrl: coverUrl.trim() || undefined,
      avatarUrl: avatarUrl.trim() || undefined,
      isPublished,
    });
  };

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      <form onSubmit={handleSubmit} className="space-y-4 rounded-card border border-stone-200 bg-stone-0 p-5 shadow-card sm:p-6 md:col-span-2">
        <h3 className="font-display font-semibold text-stone-900">Thiết lập mặt tiền & Subdomain</h3>

        <div>
          <label className="block text-xs font-medium text-stone-700">Tên gian hàng / Thương hiệu</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className={MERCHANT_INPUT}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-700">Subdomain riêng biệt</label>
          <div className="mt-1 flex min-h-[44px] items-center rounded-control border border-stone-450 bg-stone-50 px-3 py-2 text-sm focus-within:border-forest-600 focus-within:bg-stone-0 sm:min-h-[36px]">
            <span className="text-stone-500">https://</span>
            <input
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
              placeholder="ten-thuong-hieu"
              className="min-w-0 flex-1 bg-transparent px-1 font-semibold text-forest-700"
            />
            <span className="text-stone-500">.tubutree.com</span>
          </div>
          <p className="mt-1 text-xs text-stone-500">Chỉ dùng chữ thường a-z, số 0-9 và dấu gạch ngang (độ dài 3-30 ký tự).</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-700">Màu chủ đạo giao diện (Theme Color)</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {THEME_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                onClick={() => setThemeColor(c.hex)}
                aria-pressed={themeColor === c.hex}
                className={`flex min-h-[44px] items-center gap-1.5 rounded-full border bg-stone-0 px-3 py-1 text-xs font-medium text-stone-700 transition-all sm:min-h-[32px] ${
                  themeColor === c.hex ? 'border-stone-900 ring-2 ring-stone-400' : 'border-stone-450'
                }`}
              >
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: c.hex }} aria-hidden="true" />
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-700">Thông điệp thương hiệu / Slogan</label>
          <textarea
            value={headerNote}
            onChange={(e) => setHeaderNote(e.target.value)}
            rows={2}
            placeholder="Ví dụ: Sản phẩm chăm sóc cơ thể thiên nhiên 100% từ nông sản Việt..."
            className={MERCHANT_INPUT}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-stone-700">URL Logo thương hiệu</label>
            <input
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://..."
              className={MERCHANT_INPUT}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-700">URL Ảnh bìa (Cover Banner)</label>
            <input
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              placeholder="https://..."
              className={MERCHANT_INPUT}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-control border border-stone-200 bg-stone-50 p-3">
          <input
            type="checkbox"
            id="isPublished"
            checked={isPublished}
            onChange={(e) => setIsPublished(e.target.checked)}
            className="h-5 w-5 shrink-0 accent-forest-600"
          />
          <label htmlFor="isPublished" className="cursor-pointer text-xs font-medium text-stone-700">
            <span className="block font-semibold text-stone-900">Xuất bản công khai gian hàng</span>
            Cho phép khách hàng truy cập gian hàng qua subdomain và đường dẫn công khai.
          </label>
        </div>

        {msg && (
          <div
            role={msg.ok ? 'status' : 'alert'}
            className={`rounded-control p-3 text-xs font-medium ${msg.ok ? 'bg-success-bg text-success-fg' : 'bg-danger-bg text-danger-fg'}`}
          >
            {msg.text}
          </div>
        )}

        <button
          type="submit"
          disabled={mut.isPending}
          className={`${BTN_PRIMARY} px-5`}
        >
          {mut.isPending ? 'Đang lưu…' : 'Lưu cấu hình gian hàng'}
        </button>
      </form>

      {/* Live iPhone Mockup Preview Frame */}
      <div className="flex flex-col items-center justify-start rounded-card border border-stone-200 bg-stone-100/60 p-5">
        <div className="mb-3 flex w-full items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wider text-stone-500">Mô phỏng Mobile</h4>
          <span className="rounded-full bg-forest-100 px-2 py-0.5 text-[10px] font-semibold text-forest-700">Live Preview</span>
        </div>

        {/* Realistic iPhone frame */}
        <div className="w-[280px] max-w-full rounded-[40px] border-[6px] border-stone-800 bg-stone-900 p-2 shadow-raised transition-all">
          {/* Dynamic Island / Notch */}
          <div className="relative mx-auto mb-2 flex h-4 w-24 items-center justify-center rounded-full bg-stone-800">
            <div className="absolute left-2.5 h-2 w-2 rounded-full bg-stone-900" />
            <div className="h-2.5 w-2.5 rounded-full border border-stone-700/60 bg-stone-900" />
          </div>

          {/* Screen Content */}
          <div className="flex min-h-[440px] select-none flex-col overflow-hidden rounded-[30px] bg-stone-50 text-left text-stone-900">
            {/* Store Cover inside screen */}
            <div className="relative h-24 w-full bg-stone-300 transition-colors" style={{ backgroundColor: themeColor }}>
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverUrl} alt="Cover" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full opacity-80" style={{ background: `linear-gradient(135deg, ${themeColor} 0%, var(--color-bg-inverse) 100%)` }} />
              )}
            </div>

            {/* Profile Avatar & Info inside screen */}
            <div className="px-3 -mt-6">
              <div className="flex items-end gap-2">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-control border-2 border-stone-0 bg-stone-0 shadow-card">
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-base font-bold text-stone-0" style={{ backgroundColor: themeColor }}>
                      {title.slice(0, 1).toUpperCase() || 'T'}
                    </div>
                  )}
                </div>
                <div className="pb-0.5 min-w-0 flex-1">
                  <h5 className="truncate text-xs font-bold text-stone-900">{title || 'Tên gian hàng'}</h5>
                  <p className="truncate text-[10px] text-stone-500">{subdomain ? `${subdomain}.tubutree.com` : 'subdomain.tubutree.com'}</p>
                </div>
              </div>

              {headerNote && (
                <p className="mt-2 line-clamp-2 rounded-control border border-stone-200 bg-stone-0 p-1.5 text-[10px] leading-tight text-stone-600">
                  {headerNote}
                </p>
              )}

              {/* Sample Product item in screen */}
              <div className="mt-3 rounded-card border border-stone-200 bg-stone-0 p-2 shadow-card">
                <div className="flex gap-2 items-center">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-forest-50 text-base text-forest-700">
                    <Leaf className="h-5 w-5 text-forest-600" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-semibold text-stone-800">Sản phẩm mẫu của Shop</p>
                    <p className="text-[11px] font-bold" style={{ color: themeColor }}>150.000đ</p>
                  </div>
                </div>
              </div>

              {/* CTA sample button */}
              <button
                type="button"
                className="mt-3 w-full rounded-control py-2 text-center text-xs font-bold text-stone-0 shadow-card transition-all"
                style={{ backgroundColor: themeColor }}
              >
                Đặt hàng ngay
              </button>
            </div>

            {/* Bottom Home Indicator */}
            <div className="mt-auto py-2 flex justify-center">
              <div className="h-1 w-20 rounded-full bg-stone-300" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab 2: Tài khoản Nhận Tiền (VietQR) ──
function BankingTab({ store, onUpdated }: { store: MerchantStore; onUpdated: () => void }) {
  const [bankName, setBankName] = useState(store.bankName ?? POPULAR_BANKS[0]!.name);
  const [bankBin, setBankBin] = useState(store.bankBin ?? POPULAR_BANKS[0]!.bin);
  const [bankAccountNo, setBankAccountNo] = useState(store.bankAccountNo ?? '');
  const [bankAccountName, setBankAccountName] = useState(store.bankAccountName ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleBankSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = POPULAR_BANKS.find((b) => b.name === e.target.value);
    if (selected) {
      setBankName(selected.name);
      setBankBin(selected.bin);
    }
  };

  const mut = useMutation({
    mutationFn: (dto: UpdateMerchantStoreInput) => updateMerchantStore(dto),
    onSuccess: () => {
      setMsg({ ok: true, text: 'Đã cập nhật thông tin nhận tiền thành công!' });
      onUpdated();
    },
    onError: (e: Error) => {
      setMsg({ ok: false, text: e.message });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    mut.mutate({
      bankName,
      bankBin,
      bankAccountNo: bankAccountNo.trim(),
      bankAccountName: bankAccountName.trim().toUpperCase(),
    });
  };

  // URL VietQR mẫu
  const sampleQrUrl =
    bankBin && bankAccountNo
      ? `https://img.vietqr.io/image/${bankBin}-${bankAccountNo}-compact.png?amount=150000&addInfo=MAU-DON-HANG`
      : null;

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      <form onSubmit={handleSubmit} className="space-y-4 rounded-card border border-stone-200 bg-stone-0 p-5 shadow-card sm:p-6 md:col-span-2">
        <div>
          <h3 className="font-display font-semibold text-stone-900">Tài khoản Ngân Hàng Nhận Tiền Trực Tiếp</h3>
          <p className="mt-1 text-xs text-stone-500">
            Khi khách hàng đặt đơn trên subdomain của bạn và chọn thanh toán chuyển khoản, hệ thống sẽ tự động tạo mã VietQR trỏ thẳng về tài khoản này.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-700">Ngân hàng thụ hưởng</label>
          <select
            value={bankName}
            onChange={handleBankSelect}
            className={MERCHANT_INPUT}
          >
            {POPULAR_BANKS.map((b) => (
              <option key={b.bin} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-700">Số tài khoản ngân hàng</label>
          <input
            value={bankAccountNo}
            onChange={(e) => setBankAccountNo(e.target.value.trim())}
            required
            placeholder="0123456789"
            className={`${MERCHANT_INPUT} font-semibold tracking-wider`}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-700">Tên chủ tài khoản (viết hoa không dấu)</label>
          <input
            value={bankAccountName}
            onChange={(e) => setBankAccountName(e.target.value.toUpperCase())}
            required
            placeholder="NGUYEN VAN A"
            className={`${MERCHANT_INPUT} font-semibold`}
          />
        </div>

        {msg && (
          <div
            role={msg.ok ? 'status' : 'alert'}
            className={`rounded-control p-3 text-xs font-medium ${msg.ok ? 'bg-success-bg text-success-fg' : 'bg-danger-bg text-danger-fg'}`}
          >
            {msg.text}
          </div>
        )}

        <button
          type="submit"
          disabled={mut.isPending}
          className={`${BTN_PRIMARY} px-5`}
        >
          {mut.isPending ? 'Đang lưu…' : 'Lưu tài khoản ngân hàng'}
        </button>
      </form>

      {/* VietQR Preview */}
      <div className="rounded-card border border-stone-200 bg-stone-50 p-5 text-center">
        <h4 className="text-xs font-semibold uppercase text-stone-500">Mô phỏng VietQR khách quét</h4>
        {sampleQrUrl ? (
          <div className="mt-3 flex flex-col items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sampleQrUrl} alt="VietQR Mẫu" className="h-60 w-60 max-w-full rounded-control border border-stone-200 bg-stone-0 p-2 shadow-card" />
            <p className="mt-2 text-xs font-semibold text-stone-900">{bankAccountName || 'TÊN CHỦ TÀI KHOẢN'}</p>
            <p className="break-words text-xs text-stone-500">{bankName} - {bankAccountNo}</p>
          </div>
        ) : (
          <div className="mt-8 text-xs text-stone-500">Vui lòng nhập số tài khoản để kiểm tra mã VietQR.</div>
        )}
      </div>
    </div>
  );
}

// ── Tab 3: Kho Hàng & Giao Nhận ──
function WarehouseTab({ store, onUpdated }: { store: MerchantStore; onUpdated: () => void }) {
  const [warehouseAddress, setWarehouseAddress] = useState(store.warehouseAddress ?? '');
  const [warehouseCity, setWarehouseCity] = useState(store.warehouseCity ?? '');
  const [warehouseDistrict, setWarehouseDistrict] = useState(store.warehouseDistrict ?? '');
  const [warehouseWard, setWarehouseWard] = useState(store.warehouseWard ?? '');
  const [warehousePhone, setWarehousePhone] = useState(store.warehousePhone ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const mut = useMutation({
    mutationFn: (dto: UpdateMerchantStoreInput) => updateMerchantStore(dto),
    onSuccess: () => {
      setMsg({ ok: true, text: 'Đã cập nhật địa chỉ kho hàng thành công!' });
      onUpdated();
    },
    onError: (e: Error) => {
      setMsg({ ok: false, text: e.message });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    mut.mutate({
      warehouseAddress: warehouseAddress.trim(),
      warehouseCity: warehouseCity.trim(),
      warehouseDistrict: warehouseDistrict.trim(),
      warehouseWard: warehouseWard.trim(),
      warehousePhone: warehousePhone.trim(),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-4 rounded-card border border-stone-200 bg-stone-0 p-5 shadow-card sm:p-6">
      <div>
        <h3 className="font-display font-semibold text-stone-900">Địa Chỉ Kho Hàng & Xuất Kiện Riêng</h3>
        <p className="mt-1 text-xs text-stone-500">
          Địa chỉ kho này sẽ dùng để tính toán phí ship cho khách hàng và in trên vận đơn gửi hàng của đối tác.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-stone-700">Số nhà, tên đường, khu công nghiệp / toà nhà</label>
        <input
          value={warehouseAddress}
          onChange={(e) => setWarehouseAddress(e.target.value)}
          required
          placeholder="Số 45 Đường số 8, KDC Him Lam..."
          className={MERCHANT_INPUT}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-stone-700">Tỉnh / Thành phố</label>
          <input
            value={warehouseCity}
            onChange={(e) => setWarehouseCity(e.target.value)}
            required
            placeholder="TP. Hồ Chí Minh"
            className={MERCHANT_INPUT}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-700">Quận / Huyện</label>
          <input
            value={warehouseDistrict}
            onChange={(e) => setWarehouseDistrict(e.target.value)}
            required
            placeholder="Quận 7"
            className={MERCHANT_INPUT}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-700">Phường / Xã</label>
          <input
            value={warehouseWard}
            onChange={(e) => setWarehouseWard(e.target.value)}
            required
            placeholder="Phường Tân Hưng"
            className={MERCHANT_INPUT}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-stone-700">Số điện thoại liên hệ kho / điều phối vận chuyển</label>
        <input
          value={warehousePhone}
          onChange={(e) => setWarehousePhone(e.target.value)}
          required
          placeholder="0912345678"
          className={MERCHANT_INPUT}
        />
      </div>

      {msg && (
        <div
            role={msg.ok ? 'status' : 'alert'}
            className={`rounded-control p-3 text-xs font-medium ${msg.ok ? 'bg-success-bg text-success-fg' : 'bg-danger-bg text-danger-fg'}`}
          >
          {msg.text}
        </div>
      )}

      <button
        type="submit"
        disabled={mut.isPending}
        className={`${BTN_PRIMARY} px-5`}
      >
        {mut.isPending ? 'Đang lưu…' : 'Lưu địa chỉ kho hàng'}
      </button>
    </form>
  );
}

// ── Tab 4: Quản Lý Sản Phẩm ──
function ProductsTab({ store }: { store: MerchantStore }) {
  const qc = useQueryClient();
  const [subTab, setSubTabState] = useState<'own' | 'resell'>('own');
  const [showCreateModal, setShowCreateModal] = useState(false);
  // BE phân trang CẢ 2 danh sách bằng cùng page/limit (merchant.service.listMyProducts) → 1 số trang,
  // về trang 1 khi đổi danh sách.
  const [page, setPage] = useState(1);
  const setSubTab = (t: 'own' | 'resell') => {
    setSubTabState(t);
    setPage(1);
  };

  const q = useQuery({
    queryKey: ['merchant-products', page],
    queryFn: () => getMerchantProducts(page),
    placeholderData: keepPreviousData,
  });
  const listTotal = (subTab === 'own' ? q.data?.meta?.ownTotal : q.data?.meta?.resellTotal) ?? 0;
  const listShown = (subTab === 'own' ? q.data?.ownProducts.length : q.data?.resellProducts.length) ?? 0;
  const lastPage = q.data ? pageRange(q.data.meta, listTotal, listShown).totalPages : 1;
  // Gỡ/duyệt làm trang hiện tại rỗng (vd gỡ SP cuối của trang cuối) → lùi về trang cuối còn dữ liệu.
  useEffect(() => {
    if (q.data && !q.isPlaceholderData && page > lastPage) setPage(lastPage);
  }, [q.data, q.isPlaceholderData, page, lastPage]);

  // Trước đây nút "Gỡ khỏi shop" gọi await removeResellProduct(p.id) TRỰC TIẾP trong onClick,
  // không try/catch, không hiện lỗi, không có state busy/disable — API lỗi (403/404/…) thì màn
  // hình im lặng, đối tác bấm lại nhiều lần tưởng web bị treo. Bọc bằng useMutation, mirror đúng
  // pattern updateMut ở OrdersTab cùng file (mutation dùng chung cho cả bảng + banner lỗi phía trên).
  const [removeError, setRemoveError] = useState<string | null>(null);
  const removeMut = useMutation({
    mutationFn: (productId: string) => removeResellProduct(productId),
    onSuccess: () => {
      setRemoveError(null);
      void qc.invalidateQueries({ queryKey: ['merchant-products'] });
    },
    onError: (e: unknown) =>
      setRemoveError(e instanceof Error ? e.message : 'Không gỡ được sản phẩm khỏi gian hàng.'),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSubTab('own')}
            aria-pressed={subTab === 'own'}
            className={subTabClass(subTab === 'own')}
          >
            Sản phẩm do tôi đăng ({q.data?.meta?.ownTotal ?? 0})
          </button>
          <button
            onClick={() => setSubTab('resell')}
            aria-pressed={subTab === 'resell'}
            className={subTabClass(subTab === 'resell')}
          >
            Sản phẩm Tubu Tree bán lại ({q.data?.meta?.resellTotal ?? 0})
          </button>
        </div>

        {subTab === 'own' && (
          <button
            onClick={() => setShowCreateModal(true)}
            className={`inline-flex items-center gap-1.5 rounded-control bg-forest-600 px-3.5 py-1.5 text-xs font-semibold text-stone-0 hover:bg-forest-700 ${TOUCH_H}`}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Đăng sản phẩm mới</span>
          </button>
        )}
      </div>

      {removeError && (
        <div role="alert" className="rounded-control border border-danger-fg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          {removeError}
        </div>
      )}

      {q.isLoading && <p className="text-sm text-stone-500">Đang tải danh sách sản phẩm…</p>}
      {q.isError && <p className="text-sm text-danger-fg">Không tải được danh sách sản phẩm.</p>}

      {subTab === 'own' && q.data && (
        <div className="overflow-x-auto rounded-card border border-stone-200 bg-stone-0 shadow-card">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2 font-medium">Sản phẩm</th>
                <th className="px-3 py-2 font-medium">Giá bán</th>
                <th className="px-3 py-2 font-medium">Tồn kho</th>
                <th className="px-3 py-2 font-medium">Trạng thái kiểm duyệt</th>
                <th className="px-3 py-2 font-medium">Ngày đăng</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {q.data.ownProducts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-xs text-stone-500">
                    Bạn chưa đăng sản phẩm riêng nào. Bấm &quot;Đăng sản phẩm mới&quot; để bắt đầu.
                  </td>
                </tr>
              ) : (
                q.data.ownProducts.map((p) => {
                  const badge =
                    p.approvalStatus === 'APPROVED' ? (
                      <span className="inline-flex items-center gap-1 rounded bg-success-bg px-2 py-0.5 text-xs font-semibold text-success-fg">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Đã duyệt (Đang hiển thị)
                      </span>
                    ) : p.approvalStatus === 'REJECTED' ? (
                      <span className="inline-flex items-center gap-1 rounded bg-danger-bg px-2 py-0.5 text-xs font-semibold text-danger-fg" title={p.rejectReason ?? ''}>
                        <AlertCircle className="h-3 w-3" aria-hidden="true" /> Từ chối: {p.rejectReason}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded bg-warning-bg px-2 py-0.5 text-xs font-semibold text-warning-fg">
                        <Clock className="h-3 w-3" aria-hidden="true" /> Chờ Admin duyệt
                      </span>
                    );

                  return (
                    <tr key={p.id} className="hover:bg-stone-50/50">
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-stone-900">{p.name}</div>
                        {p.shortDesc && <div className="line-clamp-1 text-xs text-stone-500">{p.shortDesc}</div>}
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-forest-700">{formatVnd(p.basePrice)}</td>
                      <td className="px-3 py-2.5 text-xs text-stone-600">{p.variations?.[0]?.stock ?? '—'}</td>
                      <td className="px-3 py-2.5">{badge}</td>
                      <td className="px-3 py-2.5 text-xs text-stone-500">
                        {new Date(p.createdAt).toLocaleDateString('vi-VN')}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'resell' && q.data && (
        <div className="overflow-x-auto rounded-card border border-stone-200 bg-stone-0 shadow-card">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2 font-medium">Sản phẩm Tubu Tree</th>
                <th className="px-3 py-2 font-medium">Giá bán</th>
                <th className="px-3 py-2 font-medium text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {q.data.resellProducts.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-xs text-stone-500">
                    Bạn chưa chọn bán lại sản phẩm Tubu Tree nào trên gian hàng.
                  </td>
                </tr>
              ) : (
                q.data.resellProducts.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-stone-900">{p.name}</div>
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-forest-700">{formatVnd(p.basePrice)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={() => {
                          if (window.confirm(`Gỡ sản phẩm ${p.name} khỏi gian hàng?`)) {
                            removeMut.mutate(p.id);
                          }
                        }}
                        disabled={removeMut.isPending}
                        className={`${BTN_LINK_DANGER} gap-1 text-xs`}
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                        <span>{removeMut.isPending ? 'Đang gỡ…' : 'Gỡ khỏi shop'}</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {q.data && (
        <Pager
          meta={q.data.meta}
          total={listTotal}
          shown={listShown}
          busy={q.isPlaceholderData}
          onPage={setPage}
        />
      )}

      {showCreateModal && (
        <CreateProductModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            void qc.invalidateQueries({ queryKey: ['merchant-products'] });
          }}
        />
      )}
    </div>
  );
}

// ── Modal Đăng sản phẩm mới ──
function CreateProductModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [shortDesc, setShortDesc] = useState('');
  const [basePrice, setBasePrice] = useState(100000);
  const [stock, setStock] = useState(50);
  const [imageUrl, setImageUrl] = useState('');
  const [certifications, setCertifications] = useState('Thuần chay, Hữu cơ, Không thử nghiệm trên động vật');
  const [msg, setMsg] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (dto: CreateMerchantProductInput) => createMerchantProduct(dto),
    onSuccess: () => onSuccess(),
    onError: (e: Error) => setMsg(e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    mut.mutate({
      name: name.trim(),
      description: description.trim(),
      shortDesc: shortDesc.trim() || undefined,
      basePrice: Number(basePrice),
      stock: Number(stock),
      images: imageUrl ? [imageUrl.trim()] : [],
      certifications: certifications ? certifications.split(',').map((c) => c.trim()) : [],
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-sheet bg-stone-0 p-5 shadow-raised sm:p-6">
        <div className="flex items-center justify-between gap-2 border-b border-stone-200 pb-3">
          <h3 className="font-display font-semibold text-stone-900">Đăng sản phẩm mới lên gian hàng</h3>
          <button
            onClick={onClose}
            aria-label="Đóng"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-stone-500 hover:bg-stone-100 hover:text-stone-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-control bg-info-bg p-3 text-xs text-info-fg">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Sản phẩm sẽ được gửi đến Admin Tubu Tree kiểm duyệt tiêu chuẩn xanh trong 24h trước khi hiển thị công khai.</span>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-stone-700">Tên sản phẩm *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Nước rửa chén bồ hòn sinh học 500ml..."
              className={MERCHANT_INPUT}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-stone-700">Giá bán (VNĐ) *</label>
              <input
                type="number"
                value={basePrice}
                onChange={(e) => setBasePrice(Number(e.target.value))}
                required
                min={1000}
                className={`${MERCHANT_INPUT} font-semibold`}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-700">Số lượng tồn kho ban đầu *</label>
              <input
                type="number"
                value={stock}
                onChange={(e) => setStock(Number(e.target.value))}
                required
                min={1}
                className={MERCHANT_INPUT}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-700">Mô tả ngắn</label>
            <input
              value={shortDesc}
              onChange={(e) => setShortDesc(e.target.value)}
              placeholder="Chiết xuất bồ hòn tự nhiên, an toàn cho da nhạy cảm..."
              className={MERCHANT_INPUT}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-700">Nội dung mô tả chi tiết *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={3}
              placeholder="Công dụng, thành phần, hướng dẫn sử dụng, hạn sử dụng..."
              className={MERCHANT_INPUT}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-700">Tiêu chuẩn / Chứng nhận xanh (phân cách bằng dấu phẩy)</label>
            <input
              value={certifications}
              onChange={(e) => setCertifications(e.target.value)}
              className={MERCHANT_INPUT}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-700">URL hình ảnh sản phẩm</label>
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
              className={MERCHANT_INPUT}
            />
          </div>

          {msg && (
            <p role="alert" className="text-xs text-danger-fg">
              {msg}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-stone-200 pt-3">
            <button
              type="button"
              onClick={onClose}
              className={`${TOUCH_H} rounded-control border border-stone-450 bg-stone-0 px-4 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50`}
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={mut.isPending}
              className={`${TOUCH_H} rounded-control bg-forest-600 px-4 py-1.5 text-xs font-semibold text-stone-0 hover:bg-forest-700 disabled:bg-stone-200 disabled:text-stone-500`}
            >
              {mut.isPending ? 'Đang gửi…' : 'Gửi kiểm duyệt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Tab 5: Đơn Hàng Xuất Kho ──
function OrdersTab({ store }: { store: MerchantStore }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  // P0 A5-03=A6-02 & A5-04=A6-36 (docs/audit-2026-09): BE giờ chỉ trả tên/SĐT/địa chỉ đầy đủ VÀ
  // chỉ cho tự chuyển trạng thái đơn khi caller là ADMIN — CTV/đại lý không thực sự giao hàng (mọi
  // đơn đều do kho Tubu xử lý qua Pancake, xem A5-34) nên không có tín hiệu nào để tin lời tự khai
  // "đã giao". FE ẩn hẳn nút chuyển trạng thái + hiện ghi chú thay vì để bấm rồi báo lỗi 403.
  const isAdmin = user?.role === 'ADMIN';
  const [status, setStatusState] = useState('');
  const [page, setPage] = useState(1);
  const setStatus = (s: string) => {
    setStatusState(s);
    setPage(1);
  };

  // BE trả `{ data, meta }` (phân trang, mặc định 20 đơn/trang) — xem listMerchantOrders.
  const q = useQuery({
    queryKey: ['merchant-orders', status, page],
    queryFn: () => listMerchantOrders(status || undefined, page),
    placeholderData: keepPreviousData,
  });
  const orders = q.data?.data ?? [];
  const lastPage = q.data ? pageRange(q.data.meta, q.data.meta.total, orders.length).totalPages : 1;
  // Đơn vừa chuyển trạng thái rời khỏi bộ lọc làm trang cuối rỗng → lùi về trang cuối còn đơn.
  useEffect(() => {
    if (q.data && !q.isPlaceholderData && page > lastPage) setPage(lastPage);
  }, [q.data, q.isPlaceholderData, page, lastPage]);

  // Trước đây mutation này KHÔNG có onError và nút không disable khi đang chạy: API trả
  // 400/403 thì màn hình không đổi gì cả, đối tác bấm lại 4-5 lần rồi tưởng hệ thống hỏng.
  const [updateError, setUpdateError] = useState<string | null>(null);
  const updateMut = useMutation({
    mutationFn: ({ id, newStatus }: { id: string; newStatus: string }) =>
      updateMerchantOrderStatus(id, newStatus),
    onSuccess: () => {
      setUpdateError(null);
      void qc.invalidateQueries({ queryKey: ['merchant-orders'] });
    },
    onError: (e: unknown) =>
      setUpdateError(e instanceof Error ? e.message : 'Không cập nhật được trạng thái đơn.'),
  });

  return (
    <div className="space-y-4">
      {updateError && (
        <div role="alert" className="rounded-control border border-danger-fg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          {updateError}
        </div>
      )}
      {!isAdmin && (
        <div className="rounded-control border border-info-fg bg-info-bg px-3 py-2 text-xs text-info-fg">
          Đơn do kho Tubu Tree xử lý giao nhận nên hệ thống ẩn bớt tên/SĐT đầy đủ và địa chỉ chi
          tiết của khách, chỉ hiện khu vực (Phường/Quận/Tỉnh). Trạng thái đơn cũng do kho Tubu tự
          cập nhật — bạn chỉ xem, không tự chuyển trạng thái tại đây được.
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display font-semibold text-stone-900">Đơn Hàng Xuất Phát Từ Kho Của Bạn</h3>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Lọc theo trạng thái đơn"
          className={`${FIELD_CLASS} ${TOUCH_H} text-xs`}
        >
          <option value="">Tất cả trạng thái</option>
          <option value="CONFIRMED">Chờ đóng gói (Đã xác nhận)</option>
          <option value="PACKED">Đã đóng gói xong</option>
          <option value="SHIPPING">Đang vận chuyển</option>
          <option value="DELIVERED">Đã giao thành công</option>
        </select>
      </div>

      {q.isLoading && <p className="text-sm text-stone-500">Đang tải đơn hàng…</p>}
      {q.isError && <p className="text-sm text-danger-fg">Không tải được danh sách đơn hàng.</p>}

      {q.data && (
        <div className="overflow-x-auto rounded-card border border-stone-200 bg-stone-0 shadow-card">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2.5 font-medium">Mã đơn</th>
                <th className="px-3 py-2.5 font-medium">Khách hàng</th>
                <th className="px-3 py-2.5 font-medium">Sản phẩm xuất kho</th>
                <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                <th className="px-3 py-2.5 font-medium text-right">Cập nhật đơn</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-xs text-stone-500">
                    {status ? 'Không có đơn nào ở trạng thái này.' : 'Chưa có đơn hàng nào phát sinh cho kho của bạn.'}
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id} className="hover:bg-stone-50/50">
                    <td className="px-3 py-3 font-semibold text-stone-900">{o.code}</td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-stone-900">{o.user?.fullName ?? 'Khách mua'}</div>
                      <div className="text-xs text-stone-500">{o.user?.phone}</div>
                      {/* Địa chỉ giao: BE vẫn trả `shippingAddress` trong đơn, nhưng bảng này
                          chỉ hiện tên + SĐT → đối tác mở tab để ĐÓNG GÓI mà không có địa chỉ
                          ghi vận đơn, phải hỏi lại Tubu từng đơn.
                          Với caller không phải ADMIN, BE đã bỏ hẳn recipient/phone/street (A5-04=
                          A6-36) — chỉ còn ward/district/province, nên dòng "recipient · phone"
                          chỉ hiện khi còn ít nhất 1 trong 2 (tránh hiện trơ " · "). */}
                      {o.shippingAddress && (
                        <div className="mt-1 text-xs text-stone-600">
                          {(o.shippingAddress.recipient || o.shippingAddress.phone) && (
                            <div>
                              {[o.shippingAddress.recipient, o.shippingAddress.phone].filter(Boolean).join(' · ')}
                            </div>
                          )}
                          <div>
                            {[
                              o.shippingAddress.street,
                              o.shippingAddress.ward,
                              o.shippingAddress.district,
                              o.shippingAddress.province,
                            ]
                              .filter(Boolean)
                              .join(', ')}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="space-y-1">
                        {o.items?.map((it) => (
                          <div key={it.id} className="text-xs text-stone-700">
                            • {it.productName}{it.variationName ? ` (${it.variationName})` : ''} <span className="font-semibold">x{it.quantity}</span> ({formatVnd(it.unitPrice)})
                            {!!it.backorderedQty && (
                              <span className="ml-1.5 rounded-full bg-warning-bg px-1.5 py-0.5 text-[10px] font-semibold text-warning-fg">
                                Đặt trước {it.backorderedQty}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-700">
                        {ORDER_STATUS_LABELS[o.status] ?? o.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {isAdmin ? (
                        <div className="inline-flex gap-1.5">
                          {o.status === 'CONFIRMED' && (
                            <button
                              onClick={() => updateMut.mutate({ id: o.id, newStatus: 'PACKED' })}
                              disabled={updateMut.isPending}
                              className={`${ORDER_ACTION} bg-sage-700 hover:brightness-90`}
                            >
                              Đã đóng gói
                            </button>
                          )}
                          {o.status === 'PACKED' && (
                            <button
                              onClick={() => updateMut.mutate({ id: o.id, newStatus: 'SHIPPING' })}
                              disabled={updateMut.isPending}
                              className={`${ORDER_ACTION} bg-forest-800 hover:brightness-90`}
                            >
                              Bắt đầu giao
                            </button>
                          )}
                          {o.status === 'SHIPPING' && (
                            <button
                              onClick={() => updateMut.mutate({ id: o.id, newStatus: 'DELIVERED' })}
                              disabled={updateMut.isPending}
                              className={`${ORDER_ACTION} bg-forest-600 hover:bg-forest-700`}
                            >
                              Đã giao
                            </button>
                          )}
                        </div>
                      ) : (
                        // P0 A5-03=A6-02: BE đã chặn hẳn self-transition cho DEALER/AFFILIATE (403) —
                        // ẩn nút thay vì để đối tác bấm rồi nhận lỗi.
                        <span className="text-xs italic text-stone-500">Do kho Tubu xử lý</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {q.data && (
        <Pager
          meta={q.data.meta}
          total={q.data.meta.total}
          shown={orders.length}
          busy={q.isPlaceholderData}
          onPage={setPage}
        />
      )}
    </div>
  );
}

/** Thanh "Hiển thị 21–40/45 · ← Trang trước · Trang sau →" dùng chung cho bảng sản phẩm + đơn. */
function Pager({
  meta,
  total,
  shown,
  busy,
  onPage,
}: {
  meta: { page: number; limit: number };
  total: number;
  shown: number;
  busy: boolean;
  onPage: (page: number) => void;
}) {
  if (total === 0) return null;
  const r = pageRange(meta, total, shown);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
      <span>{r.label}</span>
      {r.totalPages > 1 && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPage(meta.page - 1)}
            disabled={!r.hasPrev || busy}
            className={BTN_SMALL}
          >
            ← Trang trước
          </button>
          <span>
            Trang {meta.page}/{r.totalPages}
          </span>
          <button
            type="button"
            onClick={() => onPage(meta.page + 1)}
            disabled={!r.hasNext || busy}
            className={BTN_SMALL}
          >
            Trang sau →
          </button>
        </div>
      )}
    </div>
  );
}
