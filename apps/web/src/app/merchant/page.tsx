'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  updateMerchantOrderStatus,
  type MerchantStore,
  type MerchantProduct,
  type UpdateMerchantStoreInput,
  type CreateMerchantProductInput,
} from '@/lib/merchant-client';
import { ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS } from '@/lib/export-csv';

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

const THEME_COLORS = [
  { label: 'Xanh Lá Tự Nhiên', hex: '#16a34a' },
  { label: 'Xanh Ngọc Lục Bảo', hex: '#0d9488' },
  { label: 'Cam Đất Mộc Mạc', hex: '#ea580c' },
  { label: 'Xanh Navy Hiện Đại', hex: '#1d4ed8' },
  { label: 'Tím Oải Hương', hex: '#7c3aed' },
  { label: 'Nâu Gỗ Trầm', hex: '#78350f' },
];

type MerchantTab = 'store' | 'banking' | 'warehouse' | 'products' | 'orders';

export default function MerchantPage() {
  const { user, status } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<MerchantTab>('store');

  const storeQ = useQuery({ queryKey: ['merchant-store'], queryFn: getMerchantStore });
  const productsQ = useQuery({ queryKey: ['merchant-products'], queryFn: getMerchantProducts });
  const ordersQ = useQuery({ queryKey: ['merchant-orders'], queryFn: () => listMerchantOrders() });

  if (status === 'loading') {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="flex items-center gap-2 text-sm font-medium text-neutral-500">
          <RefreshCw className="h-4 w-4 animate-spin text-leaf-600" />
          <span>Đang kết nối trung tâm đối tác…</span>
        </div>
      </div>
    );
  }

  if (status !== 'authenticated') {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-leaf-50 text-leaf-700 shadow-sm">
          <Store className="h-8 w-8" />
        </div>
        <h2 className="mt-4 text-2xl font-bold text-neutral-900">Cổng Quản Trị Đối Tác</h2>
        <p className="mt-2 text-sm text-neutral-600">
          Vui lòng đăng nhập tài khoản đối tác doanh nghiệp để quản lý gian hàng, kho hàng và đơn hàng.
        </p>
        <Link
          href="/dang-nhap"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary-600 px-6 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-primary-700"
        >
          <span>Đăng nhập ngay</span>
        </Link>
      </div>
    );
  }

  const store = storeQ.data;
  const ownCount = productsQ.data?.ownProducts?.length ?? 0;
  const resellCount = productsQ.data?.resellProducts?.length ?? 0;
  const pendingOrdersCount = ordersQ.data?.filter((o: any) => o.status === 'CONFIRMED')?.length ?? 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      {/* ── Top Header Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-neutral-200/80 bg-white p-5 sm:p-6 shadow-sm">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-extrabold text-neutral-900 tracking-tight">
              {store?.title ?? 'Cổng Quản Trị Gian Hàng Đối Tác'}
            </h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-leaf-100 px-2.5 py-0.5 text-xs font-semibold text-leaf-800">
              <ShieldCheck className="h-3.5 w-3.5" />
              {store?.type ?? 'MERCHANT'}
            </span>
            {store && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  store.isPublished
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${store.isPublished ? 'bg-emerald-600' : 'bg-amber-600'}`} />
                {store.isPublished ? 'Đang xuất bản' : 'Chưa xuất bản'}
              </span>
            )}
          </div>
          {store?.subdomain && (
            <p className="flex items-center gap-1.5 text-xs text-neutral-500">
              <span>Đường dẫn gian hàng riêng:</span>
              <a
                href={`https://${store.subdomain}.tubutree.com`}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-leaf-700 hover:underline"
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
              className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2 text-xs font-semibold text-neutral-700 shadow-sm transition hover:border-leaf-600 hover:bg-leaf-50 hover:text-leaf-800"
            >
              <Eye className="h-3.5 w-3.5" />
              <span>Xem gian hàng</span>
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        )}
      </div>

      {/* ── KPI Overview Metric Cards ── */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <div className="rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500">Sản phẩm riêng</span>
            <Package className="h-4 w-4 text-leaf-700" />
          </div>
          <p className="mt-2 text-2xl font-bold text-neutral-900">{ownCount}</p>
          <span className="text-[11px] text-neutral-400">Do đối tác tự tải lên</span>
        </div>

        <div className="rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500">Sản phẩm bán lại</span>
            <Sparkles className="h-4 w-4 text-primary-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-neutral-900">{resellCount}</p>
          <span className="text-[11px] text-neutral-400">Từ kho Tubu Tree</span>
        </div>

        <div className="rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500">Chờ đóng gói</span>
            <ShoppingBag className="h-4 w-4 text-indigo-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-neutral-900">{pendingOrdersCount}</p>
          <span className="text-[11px] text-neutral-400">Cần xuất kho ngay</span>
        </div>

        <div className="rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500">Trạng thái shop</span>
            <Store className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-sm font-bold text-neutral-900">
            {store?.isPublished ? 'Hoạt động công khai' : 'Tạm khóa / Ẩn'}
          </p>
          <span className="text-[11px] text-neutral-400">Mã: {store?.slug}</span>
        </div>
      </div>

      {/* ── Navigation Tabs ── */}
      <div className="mt-6 flex gap-2 overflow-x-auto border-b border-neutral-200 pb-0.5 scrollbar-none">
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
              className={`flex items-center gap-2 whitespace-nowrap px-4 py-3 text-sm font-semibold transition-all ${
                isActive
                  ? 'border-b-2 border-leaf-600 text-leaf-800'
                  : 'text-neutral-500 hover:text-neutral-900'
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? 'text-leaf-600' : 'text-neutral-400'}`} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        {storeQ.isLoading && (
          <div className="p-8 text-center text-sm text-neutral-500">Đang tải thông tin gian hàng…</div>
        )}
        {storeQ.isError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
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
  const [themeColor, setThemeColor] = useState(store.themeColor ?? '#16a34a');
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
      <form onSubmit={handleSubmit} className="space-y-4 md:col-span-2 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h3 className="font-semibold text-neutral-900">Thiết lập mặt tiền & Subdomain</h3>

        <div>
          <label className="block text-xs font-medium text-neutral-700">Tên gian hàng / Thương hiệu</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-green-600 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-700">Subdomain riêng biệt</label>
          <div className="mt-1 flex items-center rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm focus-within:border-green-600 focus-within:bg-white">
            <span className="text-neutral-400">https://</span>
            <input
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
              placeholder="ten-thuong-hieu"
              className="flex-1 bg-transparent px-1 font-semibold text-green-700 focus:outline-none"
            />
            <span className="text-neutral-500">.tubutree.com</span>
          </div>
          <p className="mt-1 text-xs text-neutral-400">Chỉ dùng chữ thường a-z, số 0-9 và dấu gạch ngang (độ dài 3-30 ký tự).</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-700">Màu chủ đạo giao diện (Theme Color)</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {THEME_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                onClick={() => setThemeColor(c.hex)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                  themeColor === c.hex ? 'border-neutral-900 ring-2 ring-neutral-400' : 'border-neutral-200'
                }`}
              >
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: c.hex }} />
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-700">Thông điệp thương hiệu / Slogan</label>
          <textarea
            value={headerNote}
            onChange={(e) => setHeaderNote(e.target.value)}
            rows={2}
            placeholder="Ví dụ: Sản phẩm chăm sóc cơ thể thiên nhiên 100% từ nông sản Việt..."
            className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-green-600 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-neutral-700">URL Logo thương hiệu</label>
            <input
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://..."
              className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-green-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-700">URL Ảnh bìa (Cover Banner)</label>
            <input
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              placeholder="https://..."
              className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-green-600 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <input
            type="checkbox"
            id="isPublished"
            checked={isPublished}
            onChange={(e) => setIsPublished(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-300 text-green-600 focus:ring-green-500"
          />
          <label htmlFor="isPublished" className="cursor-pointer text-xs font-medium text-neutral-700">
            <span className="block font-semibold text-neutral-900">Xuất bản công khai gian hàng</span>
            Cho phép khách hàng truy cập gian hàng qua subdomain và đường dẫn công khai.
          </label>
        </div>

        {msg && (
          <div className={`rounded-lg p-3 text-xs font-medium ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
            {msg.text}
          </div>
        )}

        <button
          type="submit"
          disabled={mut.isPending}
          className="rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:bg-neutral-300"
        >
          {mut.isPending ? 'Đang lưu…' : 'Lưu cấu hình gian hàng'}
        </button>
      </form>

      {/* Live iPhone Mockup Preview Frame */}
      <div className="rounded-2xl border border-neutral-200/80 bg-neutral-100/60 p-5 flex flex-col items-center justify-start">
        <div className="flex items-center justify-between w-full mb-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500">Mô phỏng Mobile</h4>
          <span className="text-[10px] font-semibold text-leaf-700 bg-leaf-100/80 px-2 py-0.5 rounded-full">Live Preview</span>
        </div>

        {/* Realistic iPhone frame */}
        <div className="w-[280px] rounded-[40px] border-[6px] border-neutral-800 bg-neutral-900 p-2 shadow-2xl transition-all">
          {/* Dynamic Island / Notch */}
          <div className="relative mx-auto mb-2 h-4 w-24 rounded-full bg-neutral-800 flex items-center justify-center">
            <div className="h-2 w-2 rounded-full bg-neutral-950 absolute left-2.5" />
            <div className="h-2.5 w-2.5 rounded-full bg-neutral-900 border border-neutral-700/60" />
          </div>

          {/* Screen Content */}
          <div className="overflow-hidden rounded-[30px] bg-neutral-50 min-h-[440px] flex flex-col text-neutral-900 text-left select-none">
            {/* Store Cover inside screen */}
            <div className="relative h-24 w-full bg-neutral-300 transition-colors" style={{ backgroundColor: themeColor }}>
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverUrl} alt="Cover" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full opacity-80" style={{ background: `linear-gradient(135deg, ${themeColor} 0%, #1e293b 100%)` }} />
              )}
            </div>

            {/* Profile Avatar & Info inside screen */}
            <div className="px-3 -mt-6">
              <div className="flex items-end gap-2">
                <div className="h-12 w-12 rounded-xl border-2 border-white overflow-hidden bg-white shadow-sm shrink-0">
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center font-bold text-white text-base" style={{ backgroundColor: themeColor }}>
                      {title.slice(0, 1).toUpperCase() || 'T'}
                    </div>
                  )}
                </div>
                <div className="pb-0.5 min-w-0 flex-1">
                  <h5 className="font-bold text-xs truncate text-neutral-900">{title || 'Tên gian hàng'}</h5>
                  <p className="text-[10px] text-neutral-400 truncate">{subdomain ? `${subdomain}.tubutree.com` : 'subdomain.tubutree.com'}</p>
                </div>
              </div>

              {headerNote && (
                <p className="mt-2 text-[10px] text-neutral-600 line-clamp-2 leading-tight bg-white p-1.5 rounded-lg border border-neutral-200/50">
                  {headerNote}
                </p>
              )}

              {/* Sample Product item in screen */}
              <div className="mt-3 rounded-xl border border-neutral-200 bg-white p-2 shadow-sm">
                <div className="flex gap-2 items-center">
                  <div className="h-10 w-10 rounded-lg bg-leaf-50 flex items-center justify-center text-leaf-700 shrink-0 text-base">
                    <Leaf className="h-5 w-5 text-leaf-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold truncate text-neutral-800">Sản phẩm mẫu của Shop</p>
                    <p className="text-[11px] font-bold" style={{ color: themeColor }}>150.000đ</p>
                  </div>
                </div>
              </div>

              {/* CTA sample button */}
              <button
                type="button"
                className="mt-3 w-full rounded-xl py-2 text-center text-xs font-bold text-white shadow-sm transition-all"
                style={{ backgroundColor: themeColor }}
              >
                Đặt hàng ngay
              </button>
            </div>

            {/* Bottom Home Indicator */}
            <div className="mt-auto py-2 flex justify-center">
              <div className="h-1 w-20 rounded-full bg-neutral-300" />
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
      <form onSubmit={handleSubmit} className="space-y-4 md:col-span-2 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div>
          <h3 className="font-semibold text-neutral-900">Tài khoản Ngân Hàng Nhận Tiền Trực Tiếp</h3>
          <p className="mt-1 text-xs text-neutral-500">
            Khi khách hàng đặt đơn trên subdomain của bạn và chọn thanh toán chuyển khoản, hệ thống sẽ tự động tạo mã VietQR trỏ thẳng về tài khoản này.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-700">Ngân hàng thụ hưởng</label>
          <select
            value={bankName}
            onChange={handleBankSelect}
            className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-green-600 focus:outline-none"
          >
            {POPULAR_BANKS.map((b) => (
              <option key={b.bin} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-700">Số tài khoản ngân hàng</label>
          <input
            value={bankAccountNo}
            onChange={(e) => setBankAccountNo(e.target.value.trim())}
            required
            placeholder="0123456789"
            className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm font-semibold tracking-wider text-neutral-800 focus:border-green-600 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-700">Tên chủ tài khoản (viết hoa không dấu)</label>
          <input
            value={bankAccountName}
            onChange={(e) => setBankAccountName(e.target.value.toUpperCase())}
            required
            placeholder="NGUYEN VAN A"
            className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-800 focus:border-green-600 focus:outline-none"
          />
        </div>

        {msg && (
          <div className={`rounded-lg p-3 text-xs font-medium ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
            {msg.text}
          </div>
        )}

        <button
          type="submit"
          disabled={mut.isPending}
          className="rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:bg-neutral-300"
        >
          {mut.isPending ? 'Đang lưu…' : 'Lưu tài khoản ngân hàng'}
        </button>
      </form>

      {/* VietQR Preview */}
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-5 text-center">
        <h4 className="text-xs font-semibold uppercase text-neutral-500">Mô phỏng VietQR khách quét</h4>
        {sampleQrUrl ? (
          <div className="mt-3 flex flex-col items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sampleQrUrl} alt="VietQR Mẫu" className="h-60 w-60 rounded-lg border border-neutral-200 bg-white p-2 shadow-sm" />
            <p className="mt-2 text-xs font-semibold text-neutral-800">{bankAccountName || 'TÊN CHỦ TÀI KHOẢN'}</p>
            <p className="text-xs text-neutral-500">{bankName} - {bankAccountNo}</p>
          </div>
        ) : (
          <div className="mt-8 text-xs text-neutral-400">Vui lòng nhập số tài khoản để kiểm tra mã VietQR.</div>
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
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <div>
        <h3 className="font-semibold text-neutral-900">Địa Chỉ Kho Hàng & Xuất Kiện Riêng</h3>
        <p className="mt-1 text-xs text-neutral-500">
          Địa chỉ kho này sẽ dùng để tính toán phí ship cho khách hàng và in trên vận đơn gửi hàng của đối tác.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-700">Số nhà, tên đường, khu công nghiệp / toà nhà</label>
        <input
          value={warehouseAddress}
          onChange={(e) => setWarehouseAddress(e.target.value)}
          required
          placeholder="Số 45 Đường số 8, KDC Him Lam..."
          className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-green-600 focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-neutral-700">Tỉnh / Thành phố</label>
          <input
            value={warehouseCity}
            onChange={(e) => setWarehouseCity(e.target.value)}
            required
            placeholder="TP. Hồ Chí Minh"
            className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-green-600 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-700">Quận / Huyện</label>
          <input
            value={warehouseDistrict}
            onChange={(e) => setWarehouseDistrict(e.target.value)}
            required
            placeholder="Quận 7"
            className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-green-600 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-700">Phường / Xã</label>
          <input
            value={warehouseWard}
            onChange={(e) => setWarehouseWard(e.target.value)}
            required
            placeholder="Phường Tân Hưng"
            className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-green-600 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-700">Số điện thoại liên hệ kho / điều phối vận chuyển</label>
        <input
          value={warehousePhone}
          onChange={(e) => setWarehousePhone(e.target.value)}
          required
          placeholder="0912345678"
          className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-green-600 focus:outline-none"
        />
      </div>

      {msg && (
        <div className={`rounded-lg p-3 text-xs font-medium ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {msg.text}
        </div>
      )}

      <button
        type="submit"
        disabled={mut.isPending}
        className="rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:bg-neutral-300"
      >
        {mut.isPending ? 'Đang lưu…' : 'Lưu địa chỉ kho hàng'}
      </button>
    </form>
  );
}

// ── Tab 4: Quản Lý Sản Phẩm ──
function ProductsTab({ store }: { store: MerchantStore }) {
  const qc = useQueryClient();
  const [subTab, setSubTab] = useState<'own' | 'resell'>('own');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const q = useQuery({ queryKey: ['merchant-products'], queryFn: getMerchantProducts });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            onClick={() => setSubTab('own')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              subTab === 'own' ? 'bg-green-600 text-white' : 'border border-neutral-200 bg-white text-neutral-700'
            }`}
          >
            Sản phẩm do tôi đăng ({q.data?.ownProducts.length ?? 0})
          </button>
          <button
            onClick={() => setSubTab('resell')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              subTab === 'resell' ? 'bg-green-600 text-white' : 'border border-neutral-200 bg-white text-neutral-700'
            }`}
          >
            Sản phẩm Tubu Tree bán lại ({q.data?.resellProducts.length ?? 0})
          </button>
        </div>

        {subTab === 'own' && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-leaf-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-leaf-700"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Đăng sản phẩm mới</span>
          </button>
        )}
      </div>

      {q.isLoading && <p className="text-sm text-neutral-500">Đang tải danh sách sản phẩm…</p>}
      {q.isError && <p className="text-sm text-red-600">Không tải được danh sách sản phẩm.</p>}

      {subTab === 'own' && q.data && (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-xs text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Sản phẩm</th>
                <th className="px-3 py-2 font-medium">Giá bán</th>
                <th className="px-3 py-2 font-medium">Tồn kho</th>
                <th className="px-3 py-2 font-medium">Trạng thái kiểm duyệt</th>
                <th className="px-3 py-2 font-medium">Ngày đăng</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {q.data.ownProducts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-xs text-neutral-400">
                    Bạn chưa đăng sản phẩm riêng nào. Bấm &quot;Đăng sản phẩm mới&quot; để bắt đầu.
                  </td>
                </tr>
              ) : (
                q.data.ownProducts.map((p) => {
                  const badge =
                    p.approvalStatus === 'APPROVED' ? (
                      <span className="inline-flex items-center gap-1 rounded bg-leaf-100 px-2 py-0.5 text-xs font-semibold text-leaf-800">
                        <CheckCircle2 className="h-3 w-3 text-leaf-600" /> Đã duyệt (Đang hiển thị)
                      </span>
                    ) : p.approvalStatus === 'REJECTED' ? (
                      <span className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800" title={p.rejectReason ?? ''}>
                        <AlertCircle className="h-3 w-3 text-red-600" /> Từ chối: {p.rejectReason}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        <Clock className="h-3 w-3 text-amber-600" /> Chờ Admin duyệt
                      </span>
                    );

                  return (
                    <tr key={p.id} className="hover:bg-neutral-50/50">
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-neutral-900">{p.name}</div>
                        {p.shortDesc && <div className="text-xs text-neutral-500 line-clamp-1">{p.shortDesc}</div>}
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-leaf-700">{formatVnd(p.basePrice)}</td>
                      <td className="px-3 py-2.5 text-xs text-neutral-600">{p.variations?.[0]?.stock ?? '—'}</td>
                      <td className="px-3 py-2.5">{badge}</td>
                      <td className="px-3 py-2.5 text-xs text-neutral-400">
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
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-xs text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Sản phẩm Tubu Tree</th>
                <th className="px-3 py-2 font-medium">Giá bán</th>
                <th className="px-3 py-2 font-medium text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {q.data.resellProducts.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-xs text-neutral-400">
                    Bạn chưa chọn bán lại sản phẩm Tubu Tree nào trên gian hàng.
                  </td>
                </tr>
              ) : (
                q.data.resellProducts.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-neutral-900">{p.name}</div>
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-leaf-700">{formatVnd(p.basePrice)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={async () => {
                          if (window.confirm(`Gỡ sản phẩm ${p.name} khỏi gian hàng?`)) {
                            await removeResellProduct(p.id);
                            void qc.invalidateQueries({ queryKey: ['merchant-products'] });
                          }
                        }}
                        className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Gỡ khỏi shop</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
          <h3 className="font-bold text-neutral-900">Đăng sản phẩm mới lên gian hàng</h3>
          <button onClick={onClose} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
          <Info className="h-4 w-4 shrink-0 text-blue-600 mt-0.5" />
          <span>Sản phẩm sẽ được gửi đến Admin Tubu Tree kiểm duyệt tiêu chuẩn xanh trong 24h trước khi hiển thị công khai.</span>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-neutral-700">Tên sản phẩm *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Nước rửa chén bồ hòn sinh học 500ml..."
              className="mt-1 w-full rounded border border-neutral-200 px-3 py-1.5 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-neutral-700">Giá bán (VNĐ) *</label>
              <input
                type="number"
                value={basePrice}
                onChange={(e) => setBasePrice(Number(e.target.value))}
                required
                min={1000}
                className="mt-1 w-full rounded border border-neutral-200 px-3 py-1.5 text-sm font-semibold"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700">Số lượng tồn kho ban đầu *</label>
              <input
                type="number"
                value={stock}
                onChange={(e) => setStock(Number(e.target.value))}
                required
                min={1}
                className="mt-1 w-full rounded border border-neutral-200 px-3 py-1.5 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700">Mô tả ngắn</label>
            <input
              value={shortDesc}
              onChange={(e) => setShortDesc(e.target.value)}
              placeholder="Chiết xuất bồ hòn tự nhiên, an toàn cho da nhạy cảm..."
              className="mt-1 w-full rounded border border-neutral-200 px-3 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700">Nội dung mô tả chi tiết *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={3}
              placeholder="Công dụng, thành phần, hướng dẫn sử dụng, hạn sử dụng..."
              className="mt-1 w-full rounded border border-neutral-200 px-3 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700">Tiêu chuẩn / Chứng nhận xanh (phân cách bằng dấu phẩy)</label>
            <input
              value={certifications}
              onChange={(e) => setCertifications(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-200 px-3 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700">URL hình ảnh sản phẩm</label>
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
              className="mt-1 w-full rounded border border-neutral-200 px-3 py-1.5 text-sm"
            />
          </div>

          {msg && <p className="text-xs text-red-600">{msg}</p>}

          <div className="flex justify-end gap-2 pt-3 border-t border-neutral-100">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-neutral-200 px-4 py-1.5 text-xs font-medium text-neutral-700"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={mut.isPending}
              className="rounded bg-green-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:bg-neutral-300"
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
  const [status, setStatus] = useState('');

  const q = useQuery({
    queryKey: ['merchant-orders', status],
    queryFn: () => listMerchantOrders(status || undefined),
  });

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
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {updateError}
        </div>
      )}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-neutral-900">Đơn Hàng Xuất Phát Từ Kho Của Bạn</h3>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded border border-neutral-200 bg-white px-3 py-1.5 text-xs"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="CONFIRMED">Chờ đóng gói (Đã xác nhận)</option>
          <option value="PACKED">Đã đóng gói xong</option>
          <option value="SHIPPING">Đang vận chuyển</option>
          <option value="DELIVERED">Đã giao thành công</option>
        </select>
      </div>

      {q.isLoading && <p className="text-sm text-neutral-500">Đang tải đơn hàng…</p>}
      {q.isError && <p className="text-sm text-red-600">Không tải được danh sách đơn hàng.</p>}

      {q.data && (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-xs text-neutral-500">
              <tr>
                <th className="px-3 py-2.5 font-medium">Mã đơn</th>
                <th className="px-3 py-2.5 font-medium">Khách hàng</th>
                <th className="px-3 py-2.5 font-medium">Sản phẩm xuất kho</th>
                <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                <th className="px-3 py-2.5 font-medium text-right">Cập nhật đơn</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {q.data.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-xs text-neutral-400">
                    Chưa có đơn hàng nào phát sinh cho kho của bạn.
                  </td>
                </tr>
              ) : (
                q.data.map((o: any) => (
                  <tr key={o.id} className="hover:bg-neutral-50/50">
                    <td className="px-3 py-3 font-semibold text-neutral-900">{o.code}</td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-neutral-900">{o.user?.fullName ?? 'Khách mua'}</div>
                      <div className="text-xs text-neutral-500">{o.user?.phone}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="space-y-1">
                        {o.items?.map((it: any) => (
                          <div key={it.id} className="text-xs text-neutral-700">
                            • {it.productTitle} <span className="font-semibold">x{it.quantity}</span> ({formatVnd(it.price)})
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-700">
                        {ORDER_STATUS_LABELS[o.status] ?? o.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="inline-flex gap-1.5">
                        {o.status === 'CONFIRMED' && (
                          <button
                            onClick={() => updateMut.mutate({ id: o.id, newStatus: 'PACKED' })}
                            disabled={updateMut.isPending}
                            className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                          >
                            Đã đóng gói
                          </button>
                        )}
                        {o.status === 'PACKED' && (
                          <button
                            onClick={() => updateMut.mutate({ id: o.id, newStatus: 'SHIPPING' })}
                            disabled={updateMut.isPending}
                            className="rounded bg-purple-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                          >
                            Bắt đầu giao
                          </button>
                        )}
                        {o.status === 'SHIPPING' && (
                          <button
                            onClick={() => updateMut.mutate({ id: o.id, newStatus: 'DELIVERED' })}
                            disabled={updateMut.isPending}
                            className="rounded bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            Đã giao
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
