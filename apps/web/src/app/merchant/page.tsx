'use client';

import React, { useEffect, useRef, useState } from 'react';
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
  EyeOff,
  RefreshCw,
  Sparkles,
  ShieldCheck,
  Clock,
  Trash2,
  Pencil,
  Leaf,
  MapPin,
  Wallet,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { formatVnd } from '@/lib/shop-client';
import {
  getMerchantStore,
  updateMerchantStore,
  getMerchantProducts,
  removeResellProduct,
  stopSellingMerchantProduct,
  updateMerchantProduct,
  listMerchantOrders,
  countMerchantOrders,
  listFulfilOrders,
  updateMerchantOrderStatus,
  pauseMerchantOrders,
  type MerchantStore,
  type MerchantProduct,
  type UpdateMerchantStoreInput,
} from '@/lib/merchant-client';
import { pageRange } from '@/lib/admin-client';
import { ORDER_STATUS_LABELS } from '@/lib/export-csv';
import { BTN_LINK_DANGER, BTN_PRIMARY, BTN_SMALL, FIELD_CLASS, INPUT_CLASS, ScrollRegion, TOUCH_H } from '@/components/admin/ui';
import { DEFAULT_THEME_COLOR, THEME_COLORS } from './theme-colors';
import { formatDate } from '@/lib/format-date';
import { FulfilOrdersTab } from './fulfil-orders-tab';
import { SettlementTab } from './settlement-tab';
import { MerchantReturnsSection } from './merchant-returns';
import { CreateProductModal, EditProductModal } from './product-form';

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

type MerchantTab = 'store' | 'fulfil' | 'products' | 'settlement' | 'shipping' | 'payoutAccount' | 'orders';

const TAB_DEFS: { k: MerchantTab; label: string; icon: typeof Store; merchantOnly?: boolean }[] = [
  { k: 'store', label: 'Gian hàng & Subdomain', icon: Store },
  { k: 'fulfil', label: 'Đơn cần giao', icon: Truck, merchantOnly: true },
  { k: 'products', label: 'Sản phẩm', icon: Package },
  { k: 'orders', label: 'Đơn qua gian hàng', icon: ShoppingBag },
  { k: 'settlement', label: 'Đối soát', icon: Wallet, merchantOnly: true },
  { k: 'shipping', label: 'Giao hàng & liên hệ', icon: MapPin, merchantOnly: true },
  { k: 'payoutAccount', label: 'Tài khoản nhận đối soát', icon: CreditCard, merchantOnly: true },
];
const TAB_KEYS = new Set<string>(TAB_DEFS.map((t) => t.k));

/**
 * Tab đang xem nằm trên URL (`/merchant?tab=fulfil`) để F5/Back giữ chỗ và gửi link được. Đọc window.location sau khi mount,
 * ghi bằng history.replaceState (cùng cách trang /admin làm, không cần Suspense cho useSearchParams).
 */
function readTabFromUrl(): MerchantTab | null {
  if (typeof window === 'undefined') return null;
  const t = new URLSearchParams(window.location.search).get('tab');
  return t && TAB_KEYS.has(t) ? (t as MerchantTab) : null;
}

function writeTabToUrl(tab: MerchantTab) {
  if (typeof window === 'undefined') return;
  const sp = new URLSearchParams(window.location.search);
  if (tab === 'store') sp.delete('tab');
  else sp.set('tab', tab);
  const qs = sp.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  iconClass,
  textValue = false,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
  icon: typeof Store;
  iconClass: string;
  textValue?: boolean;
}) {
  return (
    <div className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-stone-500">{label}</span>
        <Icon className={`h-4 w-4 ${iconClass}`} aria-hidden="true" />
      </div>
      <p className={`mt-2 font-bold text-stone-900 ${textValue ? 'text-sm' : 'text-2xl'}`}>{value}</p>
      <span className="text-[11px] text-stone-500">{hint}</span>
    </div>
  );
}

export default function MerchantPage() {
  const { user, status, initialized } = useAuth();
  const [tab, setTabState] = useState<MerchantTab>('store');
  useEffect(() => {
    const t = readTabFromUrl();
    if (t) setTabState(t);
  }, []);
  const setTab = (t: MerchantTab) => {
    setTabState(t);
    writeTabToUrl(t);
  };

  // `enabled` là bắt buộc, không phải tối ưu: hook chạy TRƯỚC guard bên dưới, nên khi tải lại
  // trang lúc đã đăng nhập, các request này bay đi trong lúc AuthProvider còn đang refresh phiên.
  // Chúng chưa có access token → 401 (guard JWT trả rất nhanh vì không chạm DB) → client-api tự
  // gọi refresh với ĐÚNG refresh token mà AuthProvider đang dùng. Backend xoay token single-use
  // và coi lần dùng lại là reuse → thu hồi TOÀN BỘ phiên của user, văng khỏi cả web lẫn Mini App.
  const authed = status === 'authenticated';
  const storeQ = useQuery({ queryKey: ['merchant-store'], queryFn: getMerchantStore, enabled: authed });
  const store = storeQ.data;
  const selfFulfils = store?.type === 'MERCHANT';
  // Cùng queryKey/limit với trang 1 của ProductsTab → dùng chung cache. Số trên thẻ KPI đọc meta tổng
  // (ownTotal/resellTotal) — đếm `.length` của trang đầu thì không bao giờ vượt cỡ trang.
  const productsQ = useQuery({ queryKey: ['merchant-products', 1], queryFn: () => getMerchantProducts(1), enabled: authed });
  // Gian hàng CTV: kho Tubu xử lý mọi đơn, thẻ chỉ đếm đơn Tubu đang xử lý (đọc meta.total, limit=1).
  const tubuProcessingQ = useQuery({
    queryKey: ['merchant-orders', 'count', 'CONFIRMED'],
    queryFn: () => countMerchantOrders('CONFIRMED'),
    enabled: authed && !!store && !selfFulfils,
  });
  // Gian hàng tự giao: đếm đơn đang chờ chính đối tác (CONFIRMED + PACKED) từ `counts` của danh sách đơn cần giao.
  const fulfilQ = useQuery({
    queryKey: ['merchant-fulfil-orders', 'kpi'],
    queryFn: () => listFulfilOrders(undefined, 1, 1),
    enabled: authed && selfFulfils,
  });
  const visibleTabs = TAB_DEFS.filter((t) => !t.merchantOnly || selfFulfils);
  const activeTab: MerchantTab = store && !visibleTabs.some((t) => t.k === tab) ? 'store' : tab;
  // Thanh tab cuộn ngang ở màn hẹp: mở bằng ?tab= thì tab đang chọn có thể nằm ngoài khung nhìn. Chỉ cuộn ngang thanh tab,
  // không dùng scrollIntoView vì nó kéo cả trang xuống.
  const tablistRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = tablistRef.current;
    const el = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!list || !el) return;
    if (el.offsetLeft < list.scrollLeft || el.offsetLeft + el.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = Math.max(0, el.offsetLeft - 16);
    }
  }, [activeTab, visibleTabs.length]);

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
      <main className="mx-auto max-w-md px-4 py-20 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-forest-50 text-forest-700 shadow-card">
          <Store className="h-8 w-8" aria-hidden="true" />
        </div>
        <h1 className="mt-4 font-display text-2xl font-semibold text-stone-900">Cổng Quản Trị Đối Tác</h1>
        <p className="mt-2 text-sm text-stone-600">
          Vui lòng đăng nhập tài khoản đối tác doanh nghiệp để quản lý gian hàng, sản phẩm và đơn hàng.
        </p>
        <Link
          href="/dang-nhap"
          className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-control bg-forest-600 px-6 py-2.5 text-sm font-semibold text-stone-0 shadow-card transition hover:bg-forest-700"
        >
          <span>Đăng nhập ngay</span>
        </Link>
      </main>
    );
  }

  // BE giới hạn portal này cho DEALER/AFFILIATE/ADMIN (merchant.controller.ts). Không kiểm tra ở
  // đây thì khách lẻ bấm "Kênh Đối Tác" ở header (nút luôn hiện) sẽ thấy nguyên khung portal —
  // tiêu đề, thẻ số liệu 0, các tab — kèm một hộp lỗi 403. Trang /admin đã kiểm; trang này sót.
  if (user && !['DEALER', 'AFFILIATE', 'ADMIN'].includes(user.role)) {
    return (
      <main className="mx-auto max-w-md px-4 py-20 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-forest-50 text-forest-700 shadow-card">
          <Store className="h-8 w-8" aria-hidden="true" />
        </div>
        <h1 className="mt-4 font-display text-2xl font-semibold text-stone-900">Kênh dành cho đối tác</h1>
        <p className="mt-2 text-sm text-stone-600">
          Tài khoản của bạn chưa phải đại lý hoặc cộng tác viên. Đăng ký trong Mini App Tubu Tree
          để mở kênh bán hàng riêng.
        </p>
      </main>
    );
  }

  const ownCount = productsQ.data?.meta?.ownTotal ?? 0;
  const resellCount = productsQ.data?.meta?.resellTotal ?? 0;
  const fulfilCounts = fulfilQ.data?.counts;
  const toShip = (fulfilCounts?.CONFIRMED ?? 0) + (fulfilCounts?.PACKED ?? 0);
  const canCreateProducts = selfFulfils;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      {/* ── Top Header Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-stone-200 bg-stone-0 p-5 shadow-card sm:p-6">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="break-words font-display text-xl font-semibold tracking-tight text-stone-900 sm:text-2xl">
              {store?.title ?? 'Cổng Quản Trị Gian Hàng Đối Tác'}
            </h1>
            {store && (
              <span className="inline-flex items-center gap-1 rounded-full bg-forest-100 px-2.5 py-0.5 text-xs font-semibold text-forest-800">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                {selfFulfils ? 'Đối tác tự giao' : 'Gian hàng CTV'}
              </span>
            )}
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

      {/* ── KPI ── */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {canCreateProducts && (
          <KpiCard label="Sản phẩm riêng" value={ownCount} hint="Do gian hàng tự đăng" icon={Package} iconClass="text-forest-700" />
        )}
        <KpiCard label="Sản phẩm bán lại" value={resellCount} hint="Từ kho Tubu Tree" icon={Sparkles} iconClass="text-honey-600" />
        {selfFulfils ? (
          <KpiCard label="Đơn cần giao" value={toShip} hint="Bạn tự đóng gói và gửi" icon={Truck} iconClass="text-info-fg" />
        ) : (
          <KpiCard
            label="Đơn đang xử lý"
            value={tubuProcessingQ.data ?? 0}
            hint="Kho Tubu đóng gói và giao"
            icon={ShoppingBag}
            iconClass="text-info-fg"
          />
        )}
        <KpiCard
          label="Trạng thái shop"
          value={store?.isPublished ? 'Hoạt động công khai' : 'Đang ẩn'}
          textValue
          hint={`Mã: ${store?.slug ?? '—'}`}
          icon={Store}
          iconClass="text-success-fg"
        />
      </div>

      {/* ── Navigation Tabs ── */}
      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Mục quản lý gian hàng"
        className="relative mt-6 flex gap-2 overflow-x-auto border-b border-stone-200 pb-0.5 scrollbar-none lg:flex-wrap lg:overflow-visible"
      >
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.k;
          return (
            <button
              key={t.k}
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(t.k)}
              className={`flex min-h-[44px] items-center gap-2 whitespace-nowrap px-4 py-3 text-sm font-semibold transition-all ${
                isActive
                  ? 'border-b-2 border-forest-600 text-forest-800'
                  : 'text-stone-500 hover:text-stone-900'
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? 'text-forest-600' : 'text-stone-500'}`} aria-hidden="true" />
              <span>{t.label}</span>
              {t.k === 'fulfil' && toShip > 0 && (
                <span className="rounded-full bg-danger-fg px-1.5 text-[10px] font-bold text-stone-0">{toShip}</span>
              )}
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
            {activeTab === 'store' && (
              <StoreSettingsTab
                store={store}
                previewProducts={[
                  ...(productsQ.data?.ownProducts ?? []).filter((p) => p.approvalStatus === 'APPROVED' && p.isActive !== false),
                  ...(productsQ.data?.resellProducts ?? []),
                ]}
                onUpdated={() => storeQ.refetch()}
              />
            )}
            {activeTab === 'fulfil' && (
              <div className="space-y-6">
                <FulfilOrdersTab />
                <MerchantReturnsSection />
              </div>
            )}
            {activeTab === 'products' && <ProductsTab canCreate={canCreateProducts} />}
            {activeTab === 'orders' && <OrdersTab selfFulfils={selfFulfils} onOpenFulfil={() => setTab('fulfil')} />}
            {activeTab === 'settlement' && <SettlementTab />}
            {activeTab === 'shipping' && <ShippingTab store={store} onUpdated={() => storeQ.refetch()} />}
            {activeTab === 'payoutAccount' && <PayoutAccountTab store={store} onUpdated={() => storeQ.refetch()} />}
          </>
        )}
      </div>
    </main>
  );
}

// ── Tab 1: Cấu hình Gian hàng & Subdomain ──
/** Tạm nghỉ (R2-MERCHANT-13): khách không đặt được hàng gian hàng tự giao; đơn đã đặt vẫn phải giao. */
function OrdersPauseControl({ store, onUpdated }: { store: MerchantStore; onUpdated: () => void }) {
  const paused = !!store.ordersPausedAt;
  const [error, setError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: (next: boolean) => pauseMerchantOrders(next),
    onSuccess: () => {
      setError(null);
      onUpdated();
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <div className={`space-y-2 rounded-control border p-3 text-xs ${paused ? 'border-warning-fg bg-warning-bg text-warning-fg' : 'border-stone-200 bg-stone-50 text-stone-700'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="block font-semibold text-stone-900">
            {paused ? `Đang tạm nghỉ từ ${formatDate(store.ordersPausedAt!)}` : 'Đang nhận đơn hàng tự giao'}
          </span>
          {paused
            ? 'Khách không đặt được hàng bạn tự giao. Đơn đã đặt trước đó vẫn cần giao ở tab Đơn cần giao.'
            : 'Nghỉ lễ hoặc tạm hết hàng? Tạm nghỉ để khách không đặt được hàng bạn tự giao. Hàng Tubu giao hộ vẫn bán.'}
        </div>
        <button
          type="button"
          onClick={() => mut.mutate(!paused)}
          disabled={mut.isPending}
          className={paused ? `${BTN_PRIMARY} px-4` : BTN_SMALL}
        >
          {mut.isPending ? 'Đang lưu…' : paused ? 'Mở nhận đơn lại' : 'Tạm nghỉ nhận đơn'}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}

function StoreSettingsTab({
  store,
  previewProducts,
  onUpdated,
}: {
  store: MerchantStore;
  previewProducts: MerchantProduct[];
  onUpdated: () => void;
}) {
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
      // Chuỗi rỗng = xoá giá trị đã lưu (API bỏ qua trường vắng mặt); subdomain thì để trống là không đổi.
      headerNote: headerNote.trim(),
      subdomain: subdomain.trim() || undefined,
      themeColor,
      coverUrl: coverUrl.trim(),
      avatarUrl: avatarUrl.trim(),
      isPublished,
    });
  };

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      <form onSubmit={handleSubmit} className="space-y-4 rounded-card border border-stone-200 bg-stone-0 p-5 shadow-card sm:p-6 md:col-span-2">
        <h2 className="font-display font-semibold text-stone-900">Thiết lập mặt tiền & Subdomain</h2>

        <div>
          <label htmlFor="merchant-store-title" className="block text-xs font-medium text-stone-700">Tên gian hàng / Thương hiệu</label>
          <input
            id="merchant-store-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className={MERCHANT_INPUT}
          />
        </div>

        <div>
          <label htmlFor="merchant-store-subdomain" className="block text-xs font-medium text-stone-700">Subdomain riêng biệt</label>
          <div className="mt-1 flex min-h-[44px] items-center rounded-control border border-stone-450 bg-stone-50 px-3 py-2 text-sm focus-within:border-forest-600 focus-within:bg-stone-0 sm:min-h-[36px]">
            <span className="text-stone-500">https://</span>
            <input
              id="merchant-store-subdomain"
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
          <span id="merchant-store-theme-color" className="block text-xs font-medium text-stone-700">Màu chủ đạo giao diện (Theme Color)</span>
          <div role="group" aria-labelledby="merchant-store-theme-color" className="mt-2 flex flex-wrap gap-2">
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
          <label htmlFor="merchant-store-header-note" className="block text-xs font-medium text-stone-700">Thông điệp thương hiệu / Slogan</label>
          <textarea
            id="merchant-store-header-note"
            value={headerNote}
            onChange={(e) => setHeaderNote(e.target.value)}
            rows={2}
            placeholder="Ví dụ: Sản phẩm chăm sóc cơ thể thiên nhiên 100% từ nông sản Việt..."
            className={MERCHANT_INPUT}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="merchant-store-avatar-url" className="block text-xs font-medium text-stone-700">URL Logo thương hiệu</label>
            <input
              id="merchant-store-avatar-url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://..."
              className={MERCHANT_INPUT}
            />
          </div>
          <div>
            <label htmlFor="merchant-store-cover-url" className="block text-xs font-medium text-stone-700">URL Ảnh bìa (Cover Banner)</label>
            <input
              id="merchant-store-cover-url"
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
            {store.type === 'MERCHANT' &&
              ' Ẩn gian hàng không dừng bán: sản phẩm vẫn hiện ở danh mục chung. Muốn ngừng nhận đơn tự giao, dùng Tạm nghỉ nhận đơn bên dưới.'}
          </label>
        </div>

        {store.type === 'MERCHANT' && <OrdersPauseControl store={store} onUpdated={onUpdated} />}

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
          <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500">Mô phỏng Mobile</h3>
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
            <div className="relative px-3 -mt-6">
              <div className="flex items-start gap-2">
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
                <div className="min-w-0 flex-1 pt-7">
                  <p className="truncate text-xs font-bold text-stone-900">{title || 'Tên gian hàng'}</p>
                  <p className="truncate text-[10px] text-stone-500">{subdomain ? `${subdomain}.tubutree.com` : 'subdomain.tubutree.com'}</p>
                </div>
              </div>

              {headerNote && (
                <p className="mt-2 line-clamp-2 rounded-control border border-stone-200 bg-stone-0 p-1.5 text-[10px] leading-tight text-stone-600">
                  {headerNote}
                </p>
              )}

              {previewProducts.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {previewProducts.slice(0, 2).map((p) => (
                    <div key={p.id} className="flex items-center gap-2 rounded-card border border-stone-200 bg-stone-0 p-2 shadow-card">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-control bg-forest-50">
                        {p.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.thumbnail} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <Leaf className="h-5 w-5 text-forest-600" aria-hidden="true" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-semibold text-stone-800">{p.name}</p>
                        <p className="text-[11px] font-bold" style={{ color: themeColor }}>
                          {formatVnd(p.salePrice ?? p.basePrice)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 rounded-card border border-dashed border-stone-300 p-3 text-center text-[11px] text-stone-500">
                  Gian hàng chưa có sản phẩm nào đang bán.
                </p>
              )}
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

// ── Tài khoản nhận đối soát (chỉ gian hàng tự giao) ──
function PayoutAccountTab({ store, onUpdated }: { store: MerchantStore; onUpdated: () => void }) {
  const [bankBin, setBankBin] = useState(store.bankBin ?? '');
  const [bankAccountNo, setBankAccountNo] = useState(store.bankAccountNo ?? '');
  const [bankAccountName, setBankAccountName] = useState(store.bankAccountName ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const hasAccount = !!store.bankAccountNo;

  const mut = useMutation({
    mutationFn: (dto: UpdateMerchantStoreInput) => updateMerchantStore(dto),
    onSuccess: (_d, dto) => {
      setMsg({ ok: true, text: dto.bankAccountNo ? 'Đã lưu tài khoản nhận đối soát.' : 'Đã gỡ tài khoản nhận đối soát.' });
      onUpdated();
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const bank = POPULAR_BANKS.find((b) => b.bin === bankBin);
    mut.mutate({
      bankName: bank?.name ?? store.bankName ?? '',
      bankBin,
      bankAccountNo: bankAccountNo.trim(),
      bankAccountName: bankAccountName.trim().toUpperCase(),
    });
  };

  const clearAccount = () => {
    setMsg(null);
    setBankBin('');
    setBankAccountNo('');
    setBankAccountName('');
    mut.mutate({ bankName: '', bankBin: '', bankAccountNo: '', bankAccountName: '' });
  };

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      <form onSubmit={handleSubmit} className="space-y-4 rounded-card border border-stone-200 bg-stone-0 p-5 shadow-card sm:p-6 md:col-span-2">
        <div>
          <h2 className="font-display font-semibold text-stone-900">Tài khoản nhận đối soát</h2>
          <p className="mt-1 text-xs text-stone-500">
            Tubu Tree chuyển tiền đối soát các đơn bạn tự giao vào tài khoản này. Khách trả trước qua Ví Tubu thì tiền về Tubu Tree,
            Tubu chuyển lại cho bạn sau khi trừ phí sàn. Đơn COD do bạn tự giao: bạn thu tiền mặt của khách và nộp phí sàn cho Tubu
            theo phiếu ở tab Đối soát.
          </p>
        </div>

        <div>
          <label htmlFor="merchant-bank-name" className="block text-xs font-medium text-stone-700">Ngân hàng</label>
          <select id="merchant-bank-name" value={bankBin} onChange={(e) => setBankBin(e.target.value)} required className={MERCHANT_INPUT}>
            <option value="">Chọn ngân hàng</option>
            {POPULAR_BANKS.map((b) => (
              <option key={b.bin} value={b.bin}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="merchant-bank-account-no" className="block text-xs font-medium text-stone-700">Số tài khoản</label>
          <input
            id="merchant-bank-account-no"
            value={bankAccountNo}
            onChange={(e) => setBankAccountNo(e.target.value.replace(/\s/g, ''))}
            required
            inputMode="numeric"
            maxLength={30}
            placeholder="0123456789"
            className={`${MERCHANT_INPUT} font-semibold tracking-wider`}
          />
        </div>

        <div>
          <label htmlFor="merchant-bank-account-name" className="block text-xs font-medium text-stone-700">Tên chủ tài khoản (viết hoa không dấu)</label>
          <input
            id="merchant-bank-account-name"
            value={bankAccountName}
            onChange={(e) => setBankAccountName(e.target.value.toUpperCase())}
            required
            maxLength={100}
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

        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={mut.isPending} className={`${BTN_PRIMARY} px-5`}>
            {mut.isPending ? 'Đang lưu…' : 'Lưu tài khoản'}
          </button>
          {hasAccount && (
            <button type="button" onClick={clearAccount} disabled={mut.isPending} className={`${BTN_LINK_DANGER} gap-1 text-xs`}>
              <Trash2 className="h-3 w-3" aria-hidden="true" />
              <span>Gỡ tài khoản</span>
            </button>
          )}
        </div>
      </form>

      <div className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-5 text-xs text-stone-600 shadow-card">
        <h3 className="font-semibold text-stone-900">Tiền về gian hàng thế nào?</h3>
        <ul className="list-disc space-y-1 pl-4">
          <li>Khách trả tiền cho Tubu Tree (ví, chuyển khoản) hoặc trả bạn khi nhận hàng (COD).</li>
          <li>Đơn giao xong và hết hạn đổi trả thì vào bảng kê ở tab Đối soát.</li>
          <li>Tubu Tree lập phiếu, chuyển khoản phần thực nhận vào tài khoản này và báo mã giao dịch cho bạn.</li>
        </ul>
      </div>
    </div>
  );
}

const parseMoney = (v: string): number | null => (v.trim() === '' ? null : Number(v));

// ── Giao hàng & liên hệ (chỉ gian hàng tự giao) ──
function ShippingTab({ store, onUpdated }: { store: MerchantStore; onUpdated: () => void }) {
  const [shippingFee, setShippingFee] = useState(store.shippingFee == null ? '' : String(store.shippingFee));
  const [freeShipFrom, setFreeShipFrom] = useState(store.freeShipFrom == null ? '' : String(store.freeShipFrom));
  const [warehousePhone, setWarehousePhone] = useState(store.warehousePhone ?? '');
  const [warehouseAddress, setWarehouseAddress] = useState(store.warehouseAddress ?? '');
  const [warehouseWard, setWarehouseWard] = useState(store.warehouseWard ?? '');
  const [warehouseDistrict, setWarehouseDistrict] = useState(store.warehouseDistrict ?? '');
  const [warehouseCity, setWarehouseCity] = useState(store.warehouseCity ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const mut = useMutation({
    mutationFn: (dto: UpdateMerchantStoreInput) => updateMerchantStore(dto),
    onSuccess: () => {
      setMsg({ ok: true, text: 'Đã lưu cài đặt giao hàng.' });
      onUpdated();
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    mut.mutate({
      shippingFee: parseMoney(shippingFee),
      freeShipFrom: parseMoney(freeShipFrom),
      warehousePhone: warehousePhone.trim(),
      warehouseAddress: warehouseAddress.trim(),
      warehouseWard: warehouseWard.trim(),
      warehouseDistrict: warehouseDistrict.trim(),
      warehouseCity: warehouseCity.trim(),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-4 rounded-card border border-stone-200 bg-stone-0 p-5 shadow-card sm:p-6">
      <div>
        <h2 className="font-display font-semibold text-stone-900">Giao hàng & liên hệ</h2>
        <p className="mt-1 text-xs text-stone-500">
          Áp dụng cho đơn có sản phẩm gian hàng tự giao: khách thấy phí giao này ở giỏ hàng. Số điện thoại và địa chỉ bên dưới
          hiện trên trang gian hàng và trang đơn của khách để liên hệ khi nhận hàng.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="merchant-shipping-fee" className="block text-xs font-medium text-stone-700">Phí giao mỗi đơn (đồng)</label>
          <input
            id="merchant-shipping-fee"
            type="number"
            inputMode="numeric"
            min={0}
            max={500000}
            value={shippingFee}
            onChange={(e) => setShippingFee(e.target.value)}
            placeholder="Để trống: phí mặc định của Tubu Tree"
            className={MERCHANT_INPUT}
          />
        </div>
        <div>
          <label htmlFor="merchant-free-ship-from" className="block text-xs font-medium text-stone-700">Miễn phí giao cho đơn từ (đồng)</label>
          <input
            id="merchant-free-ship-from"
            type="number"
            inputMode="numeric"
            min={0}
            value={freeShipFrom}
            onChange={(e) => setFreeShipFrom(e.target.value)}
            placeholder="Để trống: không miễn phí"
            className={MERCHANT_INPUT}
          />
        </div>
      </div>

      <div>
        <label htmlFor="merchant-warehouse-phone" className="block text-xs font-medium text-stone-700">Số điện thoại khách liên hệ khi giao</label>
        <input
          id="merchant-warehouse-phone"
          value={warehousePhone}
          onChange={(e) => setWarehousePhone(e.target.value)}
          required
          inputMode="tel"
          maxLength={20}
          placeholder="0912345678"
          className={MERCHANT_INPUT}
        />
      </div>

      <div>
        <label htmlFor="merchant-warehouse-address" className="block text-xs font-medium text-stone-700">Địa chỉ gửi hàng và nhận hàng hoàn</label>
        <input
          id="merchant-warehouse-address"
          value={warehouseAddress}
          onChange={(e) => setWarehouseAddress(e.target.value)}
          placeholder="Số nhà, tên đường"
          className={MERCHANT_INPUT}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="merchant-warehouse-ward" className="block text-xs font-medium text-stone-700">Phường / Xã</label>
          <input id="merchant-warehouse-ward" value={warehouseWard} onChange={(e) => setWarehouseWard(e.target.value)} className={MERCHANT_INPUT} />
        </div>
        <div>
          <label htmlFor="merchant-warehouse-district" className="block text-xs font-medium text-stone-700">Quận / Huyện</label>
          <input id="merchant-warehouse-district" value={warehouseDistrict} onChange={(e) => setWarehouseDistrict(e.target.value)} className={MERCHANT_INPUT} />
        </div>
        <div>
          <label htmlFor="merchant-warehouse-city" className="block text-xs font-medium text-stone-700">Tỉnh / Thành phố</label>
          <input id="merchant-warehouse-city" value={warehouseCity} onChange={(e) => setWarehouseCity(e.target.value)} className={MERCHANT_INPUT} />
        </div>
      </div>

      {msg && (
        <div
          role={msg.ok ? 'status' : 'alert'}
          className={`rounded-control p-3 text-xs font-medium ${msg.ok ? 'bg-success-bg text-success-fg' : 'bg-danger-bg text-danger-fg'}`}
        >
          {msg.text}
        </div>
      )}

      <button type="submit" disabled={mut.isPending} className={`${BTN_PRIMARY} px-5`}>
        {mut.isPending ? 'Đang lưu…' : 'Lưu cài đặt giao hàng'}
      </button>
    </form>
  );
}

// ── Tab 4: Quản Lý Sản Phẩm ──
function ProductsTab({ canCreate }: { canCreate: boolean }) {
  const qc = useQueryClient();
  const [subTab, setSubTabState] = useState<'own' | 'resell'>(canCreate ? 'own' : 'resell');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editing, setEditing] = useState<MerchantProduct | null>(null);
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

  const [ownError, setOwnError] = useState<string | null>(null);
  const activeMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      active ? updateMerchantProduct(id, { isActive: true }) : stopSellingMerchantProduct(id),
    onSuccess: () => {
      setOwnError(null);
      void qc.invalidateQueries({ queryKey: ['merchant-products'] });
    },
    onError: (e: unknown) => setOwnError(e instanceof Error ? e.message : 'Không cập nhật được sản phẩm.'),
  });

  return (
    <div className="space-y-4">
      {!canCreate && (
        <div className="rounded-control border border-info-fg bg-info-bg px-3 py-2 text-xs text-info-fg">
          Gian hàng CTV bán lại sản phẩm của Tubu Tree: thêm sản phẩm trong trình tạo gian hàng ở Mini App. Muốn đăng sản phẩm
          riêng, đăng ký làm đại lý để mở gian hàng đối tác.
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {canCreate && (
          <button
            onClick={() => setSubTab('own')}
            aria-pressed={subTab === 'own'}
            className={subTabClass(subTab === 'own')}
          >
            Sản phẩm do tôi đăng ({q.data?.meta?.ownTotal ?? 0})
          </button>
          )}
          <button
            onClick={() => setSubTab('resell')}
            aria-pressed={subTab === 'resell'}
            className={subTabClass(subTab === 'resell')}
          >
            Sản phẩm Tubu Tree bán lại ({q.data?.meta?.resellTotal ?? 0})
          </button>
        </div>

        {subTab === 'own' && canCreate && (
          <button
            onClick={() => setShowCreateModal(true)}
            className={`inline-flex items-center gap-1.5 rounded-control bg-forest-600 px-3.5 py-1.5 text-xs font-semibold text-stone-0 hover:bg-forest-700 ${TOUCH_H}`}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Đăng sản phẩm mới</span>
          </button>
        )}
      </div>

      {ownError && (
        <div role="alert" className="rounded-control border border-danger-fg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          {ownError}
        </div>
      )}
      {removeError && (
        <div role="alert" className="rounded-control border border-danger-fg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          {removeError}
        </div>
      )}

      {q.isLoading && <p className="text-sm text-stone-500">Đang tải danh sách sản phẩm…</p>}
      {q.isError && <p className="text-sm text-danger-fg">Không tải được danh sách sản phẩm.</p>}

      {subTab === 'own' && q.data && (
        <ScrollRegion label="Sản phẩm do tôi đăng" className="rounded-card border border-stone-200 bg-stone-0 shadow-card">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2 font-medium">Sản phẩm</th>
                <th className="px-3 py-2 font-medium">Giá bán</th>
                <th className="px-3 py-2 font-medium">Tồn kho</th>
                <th className="px-3 py-2 font-medium">Giao hàng</th>
                <th className="px-3 py-2 font-medium">Trạng thái</th>
                <th className="px-3 py-2 font-medium">Ngày đăng</th>
                <th className="px-3 py-2 text-right font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {q.data.ownProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-stone-500">
                    Bạn chưa đăng sản phẩm riêng nào. Bấm &quot;Đăng sản phẩm mới&quot; để bắt đầu.
                  </td>
                </tr>
              ) : (
                q.data.ownProducts.map((p) => {
                  const badge =
                    p.approvalStatus === 'APPROVED' ? (
                      p.isActive === false ? (
                        <span className="inline-flex items-center gap-1 rounded bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-700">
                          <EyeOff className="h-3 w-3" aria-hidden="true" /> Đã duyệt (Đang ẩn)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-success-bg px-2 py-0.5 text-xs font-semibold text-success-fg">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Đã duyệt (Đang hiển thị)
                        </span>
                      )
                    ) : p.approvalStatus === 'REJECTED' ? (
                      <span className="inline-flex items-center gap-1 rounded bg-danger-bg px-2 py-0.5 text-xs font-semibold text-danger-fg" title={p.rejectReason ?? ''}>
                        <AlertCircle className="h-3 w-3" aria-hidden="true" /> Từ chối: {p.rejectReason}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded bg-warning-bg px-2 py-0.5 text-xs font-semibold text-warning-fg">
                        <Clock className="h-3 w-3" aria-hidden="true" /> Chờ Tubu Tree duyệt
                      </span>
                    );
                  const tubuFulfils = p.fulfilment === 'TUBU' || !!p.pancakeLinkCode;

                  return (
                    <tr key={p.id} className="hover:bg-stone-50/50">
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-stone-900">{p.name}</div>
                        {p.shortDesc && <div className="line-clamp-1 text-xs text-stone-500">{p.shortDesc}</div>}
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-forest-700">{formatVnd(p.basePrice)}</td>
                      <td className="px-3 py-2.5 text-xs text-stone-600">{p.variations?.[0]?.stock ?? '—'}</td>
                      <td className="px-3 py-2.5 text-xs text-stone-600">
                        {tubuFulfils ? 'Tubu giao hộ' : 'Gian hàng tự giao'}
                        {p.pancakeLinkCode && p.fulfilment !== 'TUBU' && (
                          <div className="text-[11px] text-stone-500">
                            Mã Pancake {p.pancakeLinkCode}, {p.approvalStatus === 'PENDING_REVIEW' ? 'chờ duyệt' : 'đã gỡ liên kết'}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {badge}
                        {p.approvalStatus === 'APPROVED' && p.pendingEdit && (
                          <span className="mt-1 flex w-fit items-center gap-1 rounded bg-warning-bg px-2 py-0.5 text-xs font-semibold text-warning-fg">
                            <Clock className="h-3 w-3" aria-hidden="true" /> Bản sửa chờ duyệt
                          </span>
                        )}
                        {p.approvalStatus === 'APPROVED' && !p.pendingEdit && p.rejectReason && (
                          <span className="mt-1 block text-[11px] font-semibold text-danger-fg" title={p.rejectReason}>
                            Bản sửa bị từ chối: {p.rejectReason}. Sản phẩm vẫn bán nội dung cũ.
                          </span>
                        )}
                        {p.isActive === false && (
                          <span className="mt-1 block text-[11px] font-semibold text-stone-500">Đã ngừng bán</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-stone-500">
                        {formatDate(p.createdAt)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-2">
                          <button type="button" onClick={() => setEditing(p)} className={`${BTN_SMALL} inline-flex items-center gap-1`}>
                            <Pencil className="h-3 w-3" aria-hidden="true" />
                            <span>Sửa</span>
                          </button>
                          {p.isActive === false ? (
                            <button
                              type="button"
                              disabled={activeMut.isPending}
                              onClick={() => activeMut.mutate({ id: p.id, active: true })}
                              className={BTN_SMALL}
                            >
                              Mở bán lại
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={activeMut.isPending}
                              onClick={() => {
                                if (window.confirm(`Ngừng bán ${p.name}? Khách sẽ không đặt được sản phẩm này nữa.`)) {
                                  activeMut.mutate({ id: p.id, active: false });
                                }
                              }}
                              className={`${BTN_LINK_DANGER} text-xs`}
                            >
                              Ngừng bán
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </ScrollRegion>
      )}

      {subTab === 'resell' && q.data && (
        <ScrollRegion label="Sản phẩm Tubu Tree bán lại" className="rounded-card border border-stone-200 bg-stone-0 shadow-card">
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
        </ScrollRegion>
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
      {editing && (
        <EditProductModal
          product={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: ['merchant-products'] });
          }}
        />
      )}
    </div>
  );
}

// ── Đơn qua gian hàng ──
function OrdersTab({ selfFulfils, onOpenFulfil }: { selfFulfils: boolean; onOpenFulfil: () => void }) {
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
          Đơn khách đặt qua gian hàng của bạn. Hàng của kho Tubu Tree do Tubu đóng gói và giao nên hệ thống chỉ hiện khu vực
          nhận hàng, không hiện tên, số điện thoại đầy đủ của khách, và bạn chỉ xem trạng thái.
          {selfFulfils && ' Đơn bạn tự giao (có đủ thông tin người nhận) nằm ở tab Đơn cần giao.'}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display font-semibold text-stone-900">Đơn qua gian hàng</h2>
        <label htmlFor="merchant-orders-status" className="sr-only">Lọc theo trạng thái đơn</label>
        <select
          id="merchant-orders-status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={`${FIELD_CLASS} ${TOUCH_H} text-xs`}
        >
          <option value="">Tất cả trạng thái</option>
          <option value="CONFIRMED">Đã xác nhận</option>
          <option value="PACKED">Đã đóng gói xong</option>
          <option value="SHIPPING">Đang vận chuyển</option>
          <option value="DELIVERED">Đã giao thành công</option>
        </select>
      </div>

      {q.isLoading && <p className="text-sm text-stone-500">Đang tải đơn hàng…</p>}
      {q.isError && <p className="text-sm text-danger-fg">Không tải được danh sách đơn hàng.</p>}

      {q.data && (
        <ScrollRegion label="Đơn qua gian hàng" className="rounded-card border border-stone-200 bg-stone-0 shadow-card">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2.5 font-medium">Mã đơn</th>
                <th className="px-3 py-2.5 font-medium">Khách hàng</th>
                <th className="px-3 py-2.5 font-medium">Sản phẩm</th>
                <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                <th className="px-3 py-2.5 font-medium text-right">Cập nhật đơn</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-xs text-stone-500">
                    {status ? 'Không có đơn nào ở trạng thái này.' : 'Chưa có đơn nào đặt qua gian hàng của bạn.'}
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
                        {o.total == null && o.ownTotal != null && (
                          <div className="pt-1 text-xs font-semibold text-stone-900">Hàng của bạn trong đơn: {formatVnd(o.ownTotal)}</div>
                        )}
                        {o.partial && <div className="text-[11px] text-stone-500">Đơn còn hàng của nơi khác, chỉ hiện hàng của bạn.</div>}
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
                        o.selfFulfilled ? (
                          <div className="inline-flex flex-col items-end gap-1">
                            <span className="text-xs font-semibold text-stone-900">Bạn tự giao</span>
                            <button type="button" onClick={onOpenFulfil} className={BTN_SMALL}>
                              Xem ở tab Đơn cần giao
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs italic text-stone-500">Do kho Tubu xử lý</span>
                        )
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollRegion>
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
