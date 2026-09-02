'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { formatVnd } from '@/lib/shop-client';
import {
  listDealerApps,
  reviewDealerApp,
  type DealerApp,
  listUsers,
  setUserRole,
  type UserRole,
  listOrders,
  getConfig,
  setConfig,
  createCoupon,
  listBrands,
  createBrand,
  updateBrand,
  verifyBrand,
  listBrandProducts,
  linkBrandByName,
  detachBrandProducts,
  listPromotions,
  createPromotion,
  deletePromotion,
  listDealerRewards,
  createDealerReward,
  deleteDealerReward,
  listFlashSales,
  createFlashSale,
  updateFlashSale,
  addFlashSaleItem,
  deleteFlashSaleItem,
  listFaqs,
  createFaq,
  updateFaq,
  deleteFaq,
  getContentKit,
  saveContentKit,
  listAcademyCourses,
  createAcademyCourse,
  updateAcademyCourse,
  deleteAcademyCourse,
  addAcademyLesson,
  updateAcademyLesson,
  deleteAcademyLesson,
  listQuickReplies,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  type ConfigRow,
  type AdminBrand,
  type BrandCert,
  type AdminFlashSale,
  type AdminFaq,
  type ContentKitFaq,
  type AdminCourse,
  type AdminLesson,
  type AcademyLessonContentType,
  type AdminQuickReply,
} from '@/lib/admin-client';

type Tab = 'dealers' | 'orders' | 'users' | 'config' | 'coupons' | 'brands' | 'flashSales' | 'faqs' | 'contentKit' | 'academy' | 'quickReplies';
const TABS: { k: Tab; label: string }[] = [
  { k: 'dealers', label: 'Đại lý' },
  { k: 'orders', label: 'Đơn hàng' },
  { k: 'users', label: 'Người dùng' },
  { k: 'config', label: 'Cấu hình' },
  { k: 'coupons', label: 'Voucher' },
  { k: 'brands', label: 'Nhãn hàng' },
  { k: 'flashSales', label: 'Flash Sale' },
  { k: 'faqs', label: 'Câu hỏi thường gặp' },
  { k: 'contentKit', label: 'Content Kit CTV' },
  { k: 'academy', label: 'Academy' },
  { k: 'quickReplies', label: 'CSKH mẫu tin nhanh' },
];

export default function AdminPage() {
  const { user, status } = useAuth();
  const [tab, setTab] = useState<Tab>('dealers');

  if (status === 'loading') return <Center>Đang tải…</Center>;
  if (status !== 'authenticated')
    return (
      <Center>
        Cần đăng nhập quản trị.{' '}
        <Link href="/dang-nhap" className="font-semibold text-green-700 underline">Đăng nhập</Link>
      </Center>
    );
  if (user?.role !== 'ADMIN')
    return <Center>Bạn không có quyền truy cập trang quản trị.</Center>;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-xl font-bold">Quản trị Tubu Tree</h1>
      <div className="mt-4 flex gap-2 overflow-x-auto border-b border-neutral-100">
        {TABS.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`whitespace-nowrap px-3 py-2 text-sm font-medium ${
              tab === t.k ? 'border-b-2 border-green-600 text-green-700' : 'text-neutral-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {tab === 'dealers' && <DealersTab />}
        {tab === 'orders' && <OrdersTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'config' && <ConfigTab />}
        {tab === 'coupons' && <CouponsTab />}
        {tab === 'brands' && <BrandsTab />}
        {tab === 'flashSales' && <FlashSalesTab />}
        {tab === 'faqs' && <FaqTab />}
        {tab === 'contentKit' && <ContentKitTab />}
        {tab === 'academy' && <AcademyTab />}
        {tab === 'quickReplies' && <QuickReplyTab />}
      </div>
    </main>
  );
}

function DealersTab() {
  const [filter, setFilter] = useState('PENDING');
  const q = useQuery({ queryKey: ['admin-dealers', filter], queryFn: () => listDealerApps(filter || undefined) });

  return (
    <div>
      <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded border border-neutral-200 px-2 py-1 text-sm">
        {['PENDING', 'APPROVED', 'REJECTED', ''].map((s) => (
          <option key={s} value={s}>{s || 'Tất cả'}</option>
        ))}
      </select>
      <div className="mt-3 space-y-3">
        {q.isError && <p className="text-sm text-red-600">Không tải được danh sách hồ sơ đại lý.</p>}
        {q.data?.map((a) => <DealerRow key={a.id} app={a} />)}
        {q.data?.length === 0 && <Empty>Không có hồ sơ.</Empty>}
      </div>
    </div>
  );
}

function DealerRow({ app: a }: { app: DealerApp }) {
  const qc = useQueryClient();
  const [tierId, setTierId] = useState('');
  const review = useMutation({
    mutationFn: (approve: boolean) =>
      reviewDealerApp(a.id, approve, approve ? tierId.trim() || undefined : undefined, approve ? undefined : 'Không đạt yêu cầu'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-dealers'] }),
  });

  return (
    <div className="rounded-lg border border-neutral-100 bg-white p-4">
      <div className="flex justify-between">
        <span className="font-medium">{a.businessName}</span>
        <span className="text-xs text-neutral-400">{a.status}</span>
      </div>
      <div className="text-sm text-neutral-600">{a.ownerName} · {a.phone}</div>
      <div className="text-sm text-neutral-600">{a.address}</div>
      <div className="mt-2 flex gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {a.cccdFrontUrl && <img src={a.cccdFrontUrl} alt="CCCD trước" className="h-16 rounded border" />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {a.cccdBackUrl && <img src={a.cccdBackUrl} alt="CCCD sau" className="h-16 rounded border" />}
      </div>
      {a.status === 'PENDING' && (
        <div className="mt-3 flex items-center gap-2">
          <input
            placeholder="Tier ID (bắt buộc, vd dealer_l3)"
            value={tierId}
            onChange={(e) => setTierId(e.target.value)}
            className="rounded border border-neutral-200 px-2 py-1 text-sm"
          />
          <button
            onClick={() => review.mutate(true)}
            disabled={review.isPending || !tierId.trim()}
            title={!tierId.trim() ? 'Cần nhập Tier ID để duyệt' : undefined}
            className="rounded bg-green-600 px-3 py-1.5 text-sm text-white disabled:bg-neutral-300"
          >
            Duyệt
          </button>
          <button onClick={() => review.mutate(false)} disabled={review.isPending} className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600">Từ chối</button>
        </div>
      )}
      {review.isError && <p className="mt-1 text-xs text-red-600">{(review.error as Error).message}</p>}
    </div>
  );
}

function OrdersTab() {
  const q = useQuery({ queryKey: ['admin-orders'], queryFn: () => listOrders(1) });
  if (q.isError) return <p className="text-sm text-red-600">Không tải được danh sách đơn hàng.</p>;
  return (
    <Table head={['Mã', 'Trạng thái', 'Thanh toán', 'Tổng', 'Ngày']}>
      {q.data?.data.map((o) => (
        <tr key={o.code} className="border-t border-neutral-100">
          <td className="py-2 font-medium">{o.code}</td>
          <td>{o.status}</td>
          <td>{o.paymentMethod}</td>
          <td>{formatVnd(o.total)}</td>
          <td className="text-neutral-400">{new Date(o.createdAt).toLocaleDateString('vi-VN')}</td>
        </tr>
      ))}
    </Table>
  );
}

const ROLES: UserRole[] = ['CUSTOMER', 'AFFILIATE', 'DEALER', 'STAFF', 'ADMIN'];

function UsersTab() {
  const q = useQuery({ queryKey: ['admin-users'], queryFn: () => listUsers(1) });
  return (
    <div className="space-y-4">
      <GrantRoleForm onDone={() => q.refetch()} />
      {q.isError ? (
        <p className="text-sm text-red-600">Không tải được danh sách người dùng.</p>
      ) : (
        <Table head={['Tên', 'SĐT', 'Vai trò', 'Điểm', 'Ngày']}>
          {q.data?.data.map((u) => (
            <tr key={u.id} className="border-t border-neutral-100">
              <td className="py-2 font-medium">{u.fullName ?? '—'}</td>
              <td>{u.phone ?? '—'}</td>
              <td>{u.role}</td>
              <td>{u.pointsBalance}</td>
              <td className="text-neutral-400">{new Date(u.createdAt).toLocaleDateString('vi-VN')}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

/** Cấp/đổi vai trò theo SĐT — thay script SSH grant-admin.js (có guard @Roles + log ai đổi). */
function GrantRoleForm({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState('');
  // Mặc định vai trò ít quyền nhất (KHÔNG phải ADMIN) — tránh lỡ tay cấp full-quyền cho
  // SĐT chưa kiểm kỹ khi form chỉ dùng để tra cứu/đổi vai trò khác.
  const [role, setRole] = useState<UserRole>('CUSTOMER');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const mut = useMutation({
    mutationFn: () => setUserRole(phone.trim(), role),
    onSuccess: (r) => {
      setMsg({ ok: true, text: `Đã đổi ${r.phone ?? r.id}: ${r.previousRole} → ${r.role}` });
      setPhone('');
      onDone();
    },
    onError: (e: unknown) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Lỗi cấp quyền' }),
  });
  const submit = () => {
    setMsg(null);
    if (role === 'ADMIN' && !window.confirm(`Cấp quyền ADMIN (toàn quyền quản trị) cho SĐT ${phone.trim()}?`)) return;
    mut.mutate();
  };
  return (
    <div className="rounded-lg border border-neutral-200 p-4">
      <h3 className="mb-2 text-sm font-semibold">Cấp / đổi vai trò theo SĐT</h3>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
          placeholder="SĐT (user đã mở Mini App)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <select
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole)}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <button
          className="rounded bg-green-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          disabled={!phone.trim() || mut.isPending}
          onClick={submit}
        >
          {mut.isPending ? 'Đang lưu…' : 'Cấp quyền'}
        </button>
      </div>
      {msg && (
        <p className={`mt-2 text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>
      )}
    </div>
  );
}

function ConfigTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-config'], queryFn: () => getConfig() });
  if (q.isError) return <p className="text-sm text-red-600">Không tải được danh sách cấu hình.</p>;
  return (
    <div className="space-y-2">
      {q.data?.map((c) => <ConfigItem key={c.key} row={c} onSaved={() => qc.invalidateQueries({ queryKey: ['admin-config'] })} />)}
    </div>
  );
}

function ConfigItem({ row, onSaved }: { row: ConfigRow; onSaved: () => void }) {
  const [val, setVal] = useState(JSON.stringify(row.value));
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(val);
      } catch {
        throw new Error('JSON không hợp lệ');
      }
      return setConfig(row.key, parsed);
    },
    onSuccess: onSaved,
    onError: (e) => setErr(e instanceof Error ? e.message : 'Lỗi'),
  });
  return (
    <div className="rounded-lg border border-neutral-100 bg-white p-3">
      <div className="text-sm font-medium">{row.key}</div>
      {row.description && <div className="text-xs text-neutral-400">{row.description}</div>}
      <div className="mt-1 flex gap-2">
        <input value={val} onChange={(e) => setVal(e.target.value)} className="flex-1 rounded border border-neutral-200 px-2 py-1 font-mono text-sm" />
        <button onClick={() => save.mutate()} className="rounded bg-green-600 px-3 py-1 text-sm text-white">Lưu</button>
      </div>
      {err && <div className="text-xs text-red-600">{err}</div>}
    </div>
  );
}

function CouponsTab() {
  const [f, setF] = useState({ code: '', type: 'PERCENT', value: 10, startAt: '', endAt: '', scope: 'PUBLIC' });
  const [msg, setMsg] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      createCoupon({
        code: f.code,
        type: f.type as 'PERCENT' | 'AMOUNT' | 'FREESHIP',
        value: Number(f.value),
        startAt: new Date(f.startAt || Date.now()).toISOString(),
        endAt: new Date(f.endAt || Date.now() + 30 * 864e5).toISOString(),
        scope: f.scope as 'PUBLIC',
      }),
    onSuccess: () => setMsg('Đã tạo voucher!'),
    onError: (e) => setMsg(e instanceof Error ? e.message : 'Lỗi'),
  });
  return (
    <div className="max-w-md space-y-2">
      <input placeholder="Mã (vd WELCOME30)" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} className="w-full rounded border border-neutral-200 px-3 py-2 text-sm" />
      <div className="flex gap-2">
        <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="rounded border border-neutral-200 px-2 py-2 text-sm">
          <option value="PERCENT">% giảm</option>
          <option value="AMOUNT">Giảm tiền</option>
          <option value="FREESHIP">Freeship</option>
        </select>
        <input type="number" placeholder="Giá trị" value={f.value} onChange={(e) => setF({ ...f, value: Number(e.target.value) })} className="w-28 rounded border border-neutral-200 px-3 py-2 text-sm" />
      </div>
      <div className="flex gap-2">
        <input type="date" value={f.startAt} onChange={(e) => setF({ ...f, startAt: e.target.value })} className="flex-1 rounded border border-neutral-200 px-3 py-2 text-sm" />
        <input type="date" value={f.endAt} onChange={(e) => setF({ ...f, endAt: e.target.value })} className="flex-1 rounded border border-neutral-200 px-3 py-2 text-sm" />
      </div>
      <button onClick={() => create.mutate()} disabled={!f.code} className="w-full rounded bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:bg-neutral-300">Tạo voucher</button>
      {msg && <p className="text-sm text-green-700">{msg}</p>}
    </div>
  );
}

function BrandsTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-brands'], queryFn: listBrands });
  const [form, setForm] = useState({ name: '', tagline: '' });
  const create = useMutation({
    mutationFn: () => createBrand({ name: form.name.trim(), tagline: form.tagline.trim() || undefined }),
    onSuccess: () => { setForm({ name: '', tagline: '' }); void qc.invalidateQueries({ queryKey: ['admin-brands'] }); },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-100 bg-white p-3">
        <input placeholder="Tên nhãn (vd Dừa Bến Tre)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="flex-1 rounded border border-neutral-200 px-3 py-2 text-sm" />
        <input placeholder="Tagline" value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} className="flex-1 rounded border border-neutral-200 px-3 py-2 text-sm" />
        <button onClick={() => create.mutate()} disabled={!form.name.trim() || create.isPending} className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:bg-neutral-300">Tạo nhãn</button>
      </div>
      {create.isError && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}

      <div className="space-y-3">
        {q.isError && <p className="text-sm text-red-600">Không tải được danh sách nhãn hàng.</p>}
        {q.data?.map((b) => <BrandRow key={b.id} brand={b} />)}
        {q.data?.length === 0 && <Empty>Chưa có nhãn hàng. Tạo nhãn đầu tiên ở trên.</Empty>}
      </div>

      <DealerRewardsSection />
    </div>
  );
}

function BrandRow({ brand }: { brand: AdminBrand }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const refreshBrands = () => qc.invalidateQueries({ queryKey: ['admin-brands'] });
  const [rowErr, setRowErr] = useState<string | null>(null);
  const onRowError = (e: unknown) => setRowErr(e instanceof Error ? e.message : 'Có lỗi xảy ra, vui lòng thử lại.');
  const patch = useMutation({
    mutationFn: (body: Partial<{ isPublished: boolean }>) => updateBrand(brand.id, body),
    onSuccess: () => { setRowErr(null); refreshBrands(); },
    onError: onRowError,
  });
  const verify = useMutation({
    mutationFn: (v: boolean) => verifyBrand(brand.id, v),
    onSuccess: () => { setRowErr(null); refreshBrands(); },
    onError: onRowError,
  });
  const [ownerInput, setOwnerInput] = useState('');
  const assignOwner = useMutation({
    mutationFn: () => updateBrand(brand.id, { ownerUserId: ownerInput.trim() }),
    onSuccess: () => { setOwnerInput(''); refreshBrands(); },
  });
  const products = useQuery({ queryKey: ['admin-brand-products', brand.id], queryFn: () => listBrandProducts(brand.id), enabled: open });
  const promos = useQuery({ queryKey: ['admin-brand-promos', brand.id], queryFn: () => listPromotions(brand.id), enabled: open });
  const link = useMutation({
    mutationFn: () => linkBrandByName(brand.id),
    onSuccess: () => { setRowErr(null); qc.invalidateQueries({ queryKey: ['admin-brand-products', brand.id] }); },
    onError: onRowError,
  });
  const detach = useMutation({
    mutationFn: (pid: string) => detachBrandProducts(brand.id, [pid]),
    onSuccess: () => { setRowErr(null); qc.invalidateQueries({ queryKey: ['admin-brand-products', brand.id] }); },
    onError: onRowError,
  });
  const [promo, setPromo] = useState({ title: '', subtitle: '', startAt: '', endAt: '' });
  const addPromo = useMutation({
    mutationFn: () => createPromotion(brand.id, {
      title: promo.title.trim(), subtitle: promo.subtitle.trim() || undefined,
      startAt: new Date(promo.startAt || Date.now()).toISOString(),
      endAt: new Date(promo.endAt || Date.now() + 30 * 864e5).toISOString(),
    }),
    onSuccess: () => { setPromo({ title: '', subtitle: '', startAt: '', endAt: '' }); void qc.invalidateQueries({ queryKey: ['admin-brand-promos', brand.id] }); },
  });
  const delPromo = useMutation({
    mutationFn: (pid: string) => deletePromotion(pid),
    onSuccess: () => { setRowErr(null); qc.invalidateQueries({ queryKey: ['admin-brand-promos', brand.id] }); },
    onError: onRowError,
  });

  return (
    <div className="rounded-lg border border-neutral-100 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 font-medium">
            {brand.name}
            {brand.isVerified && <span className="rounded-full bg-green-600 px-2 py-0.5 text-xs text-white">✓ Chính hãng</span>}
            {!brand.isPublished && <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600">Nháp</span>}
          </div>
          <div className="text-xs text-neutral-400">/{brand.slug} · {brand.followerCount} theo dõi</div>
        </div>
        <button onClick={() => setOpen((o) => !o)} className="text-sm text-green-700 underline">{open ? 'Thu gọn' : 'Quản lý'}</button>
      </div>

      {open && (
        <div className="mt-3 space-y-4 border-t border-neutral-100 pt-3">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => patch.mutate({ isPublished: !brand.isPublished })} className="rounded border border-neutral-200 px-3 py-1.5 text-sm">
              {brand.isPublished ? 'Ẩn (chuyển nháp)' : 'Đăng (publish)'}
            </button>
            <button onClick={() => verify.mutate(!brand.isVerified)} className="rounded border border-neutral-200 px-3 py-1.5 text-sm">
              {brand.isVerified ? 'Bỏ chính hãng' : 'Cấp ✓ chính hãng'}
            </button>
            <button onClick={() => link.mutate()} disabled={link.isPending} className="rounded bg-green-600 px-3 py-1.5 text-sm text-white disabled:bg-neutral-300">
              Gán SP theo tên nhãn
            </button>
            {link.data && <span className="self-center text-sm text-green-700">Đã gán {link.data.linked} SP</span>}
          </div>
          {rowErr && <p className="text-xs text-red-600">{rowErr}</p>}

          {/* Gán chủ nhãn (lộ trình B) — đối tác tự quản nhãn trong Mini App */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-neutral-500">Chủ nhãn (userId):</span>
            <input
              placeholder="userId đối tác"
              value={ownerInput}
              onChange={(e) => setOwnerInput(e.target.value)}
              className="flex-1 rounded border border-neutral-200 px-2 py-1"
            />
            <button onClick={() => assignOwner.mutate()} disabled={!ownerInput.trim() || assignOwner.isPending} className="rounded border border-neutral-200 px-3 py-1 disabled:opacity-50">
              Gán chủ nhãn
            </button>
            {assignOwner.isSuccess && <span className="text-green-700">Đã gán ✓</span>}
            {assignOwner.isError && <span className="text-red-600">{(assignOwner.error as Error).message}</span>}
          </div>

          <BrandInfoForm brand={brand} />

          <div>
            <div className="mb-1 text-sm font-medium">Sản phẩm ({products.data?.length ?? 0})</div>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {products.data?.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded border border-neutral-100 px-2 py-1 text-sm">
                  <span className="truncate">{p.name}</span>
                  <button onClick={() => detach.mutate(p.id)} className="ml-2 shrink-0 text-xs text-red-600">Gỡ</button>
                </div>
              ))}
              {products.data?.length === 0 && <p className="text-xs text-neutral-400">Chưa có SP. Bấm “Gán SP theo tên nhãn” để liên kết catalog.</p>}
            </div>
          </div>

          <div>
            <div className="mb-1 text-sm font-medium">Khuyến mãi</div>
            <div className="space-y-1">
              {promos.data?.map((pm) => (
                <div key={pm.id} className="flex items-center justify-between rounded border border-neutral-100 px-2 py-1 text-sm">
                  <span>{pm.title}{pm.subtitle ? ` · ${pm.subtitle}` : ''}</span>
                  <button onClick={() => delPromo.mutate(pm.id)} className="ml-2 shrink-0 text-xs text-red-600">Xoá</button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <input placeholder="Tiêu đề (MUA 2 TẶNG 1)" value={promo.title} onChange={(e) => setPromo({ ...promo, title: e.target.value })} className="flex-1 rounded border border-neutral-200 px-2 py-1 text-sm" />
              <input placeholder="Mô tả" value={promo.subtitle} onChange={(e) => setPromo({ ...promo, subtitle: e.target.value })} className="flex-1 rounded border border-neutral-200 px-2 py-1 text-sm" />
              <input type="date" value={promo.startAt} onChange={(e) => setPromo({ ...promo, startAt: e.target.value })} className="rounded border border-neutral-200 px-2 py-1 text-sm" />
              <input type="date" value={promo.endAt} onChange={(e) => setPromo({ ...promo, endAt: e.target.value })} className="rounded border border-neutral-200 px-2 py-1 text-sm" />
              <button onClick={() => addPromo.mutate()} disabled={!promo.title.trim()} className="rounded bg-green-600 px-3 py-1 text-sm text-white disabled:bg-neutral-300">Thêm KM</button>
            </div>
            {addPromo.isError && <p className="mt-1 text-xs text-red-600">{(addPromo.error as Error).message}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function BrandInfoForm({ brand }: { brand: AdminBrand }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    logoUrl: brand.logoUrl ?? '',
    coverUrl: brand.coverUrl ?? '',
    tagline: brand.tagline ?? '',
    origin: brand.origin ?? '',
    story: brand.story ?? '',
  });
  const [certs, setCerts] = useState<BrandCert[]>(brand.certifications ?? []);
  const save = useMutation({
    mutationFn: () =>
      updateBrand(brand.id, {
        logoUrl: f.logoUrl.trim(),
        coverUrl: f.coverUrl.trim(),
        tagline: f.tagline.trim(),
        origin: f.origin.trim(),
        story: f.story.trim(),
        certifications: certs.filter((c) => c.code.trim() && c.label.trim()),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-brands'] }),
  });

  const setCert = (i: number, patch: Partial<BrandCert>) =>
    setCerts((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  return (
    <div className="rounded-lg border border-neutral-100 bg-neutral-50/50 p-3">
      <div className="mb-2 text-sm font-medium">Thông tin nhãn</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input placeholder="Logo URL" value={f.logoUrl} onChange={(e) => setF({ ...f, logoUrl: e.target.value })} className="rounded border border-neutral-200 px-2 py-1 text-sm" />
        <input placeholder="Cover URL" value={f.coverUrl} onChange={(e) => setF({ ...f, coverUrl: e.target.value })} className="rounded border border-neutral-200 px-2 py-1 text-sm" />
        <input placeholder="Tagline" value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} className="rounded border border-neutral-200 px-2 py-1 text-sm" />
        <input placeholder="Nguồn gốc (vd Bến Tre)" value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} className="rounded border border-neutral-200 px-2 py-1 text-sm" />
      </div>
      <textarea placeholder="Câu chuyện thương hiệu" value={f.story} onChange={(e) => setF({ ...f, story: e.target.value })} rows={3} className="mt-2 w-full rounded border border-neutral-200 px-2 py-1 text-sm" />

      <div className="mt-3 text-sm font-medium">Chứng nhận (chỉ cái ✓ đã xác minh mới hiện cho khách)</div>
      <div className="space-y-1">
        {certs.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <input placeholder="Mã (ORG)" value={c.code} onChange={(e) => setCert(i, { code: e.target.value })} className="w-24 rounded border border-neutral-200 px-2 py-1" />
            <input placeholder="Nhãn (Hữu cơ USDA)" value={c.label} onChange={(e) => setCert(i, { label: e.target.value })} className="flex-1 rounded border border-neutral-200 px-2 py-1" />
            <input placeholder="Proof URL" value={c.proofUrl ?? ''} onChange={(e) => setCert(i, { proofUrl: e.target.value })} className="w-40 rounded border border-neutral-200 px-2 py-1" />
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={c.verified ?? false} onChange={(e) => setCert(i, { verified: e.target.checked })} /> ✓ verified
            </label>
            <button onClick={() => setCerts((cs) => cs.filter((_, idx) => idx !== i))} className="text-xs text-red-600">Xoá</button>
          </div>
        ))}
      </div>
      <button onClick={() => setCerts((cs) => [...cs, { code: '', label: '', verified: false }])} className="mt-1 text-sm text-green-700 underline">+ Thêm chứng nhận</button>

      <div className="mt-2">
        <button onClick={() => save.mutate()} disabled={save.isPending} className="rounded bg-green-600 px-4 py-1.5 text-sm text-white disabled:bg-neutral-300">Lưu thông tin</button>
        {save.isSuccess && <span className="ml-2 text-sm text-green-700">Đã lưu ✓</span>}
        {save.isError && <span className="ml-2 text-sm text-red-600">{(save.error as Error).message}</span>}
      </div>
    </div>
  );
}

function DealerRewardsSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-dealer-rewards'], queryFn: listDealerRewards });
  const [f, setF] = useState({ type: 'TOUR', title: '', description: '', threshold: 50000000, period: 'QUARTER' });
  const create = useMutation({
    mutationFn: () => createDealerReward({
      type: f.type as 'TOUR' | 'GIFT' | 'OTHER', title: f.title.trim(),
      description: f.description.trim() || undefined, threshold: Number(f.threshold), period: f.period,
    }),
    onSuccess: () => { setF({ type: 'TOUR', title: '', description: '', threshold: 50000000, period: 'QUARTER' }); void qc.invalidateQueries({ queryKey: ['admin-dealer-rewards'] }); },
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteDealerReward(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-dealer-rewards'] }),
  });

  return (
    <div className="rounded-lg border border-neutral-100 bg-white p-4">
      <div className="mb-2 font-medium">🏪 Chương trình đại lý (thưởng doanh số)</div>
      <div className="space-y-1">
        {q.isError && <p className="text-xs text-red-600">Không tải được danh sách chương trình.</p>}
        {q.data?.map((d) => (
          <div key={d.id} className="flex items-center justify-between rounded border border-neutral-100 px-2 py-1 text-sm">
            <span>[{d.type}] {d.title} · mốc {formatVnd(d.threshold)}/{d.period === 'YEAR' ? 'năm' : 'quý'}{d.brandId ? '' : ' · toàn shop'}</span>
            <button onClick={() => del.mutate(d.id)} className="ml-2 shrink-0 text-xs text-red-600">Xoá</button>
          </div>
        ))}
        {q.data?.length === 0 && <p className="text-xs text-neutral-400">Chưa có chương trình.</p>}
        {del.isError && <p className="text-xs text-red-600">{(del.error as Error).message}</p>}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="rounded border border-neutral-200 px-2 py-1 text-sm">
          <option value="TOUR">Tour</option>
          <option value="GIFT">Quà</option>
          <option value="OTHER">Khác</option>
        </select>
        <select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} className="rounded border border-neutral-200 px-2 py-1 text-sm">
          <option value="QUARTER">Theo quý</option>
          <option value="YEAR">Theo năm</option>
        </select>
        <input placeholder="Tiêu đề (Tour Phú Quốc)" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className="flex-1 rounded border border-neutral-200 px-2 py-1 text-sm" />
        <input type="number" placeholder="Mốc doanh số" value={f.threshold} onChange={(e) => setF({ ...f, threshold: Number(e.target.value) })} className="w-36 rounded border border-neutral-200 px-2 py-1 text-sm" />
        <button onClick={() => create.mutate()} disabled={!f.title.trim()} className="rounded bg-green-600 px-3 py-1 text-sm text-white disabled:bg-neutral-300">Thêm</button>
      </div>
      {create.isError && <p className="mt-1 text-xs text-red-600">{(create.error as Error).message}</p>}
    </div>
  );
}

function FlashSalesTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-flash-sales'], queryFn: listFlashSales });
  const [f, setF] = useState({ title: '', startAt: '', endAt: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const create = useMutation({
    mutationFn: () =>
      createFlashSale({
        title: f.title.trim(),
        startAt: new Date(f.startAt).toISOString(),
        endAt: new Date(f.endAt).toISOString(),
      }),
    onSuccess: () => {
      setF({ title: '', startAt: '', endAt: '' });
      setMsg({ ok: true, text: 'Đã tạo đợt flash sale!' });
      void qc.invalidateQueries({ queryKey: ['admin-flash-sales'] });
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Lỗi tạo đợt flash sale' }),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-100 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold">Tạo đợt Flash Sale</h3>
        <div className="flex flex-wrap items-end gap-2">
          <input
            placeholder="Tên đợt (vd Flash Sale cuối tuần)"
            value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value })}
            className="flex-1 rounded border border-neutral-200 px-3 py-2 text-sm"
          />
          <input
            type="datetime-local"
            value={f.startAt}
            onChange={(e) => setF({ ...f, startAt: e.target.value })}
            className="rounded border border-neutral-200 px-3 py-2 text-sm"
          />
          <input
            type="datetime-local"
            value={f.endAt}
            onChange={(e) => setF({ ...f, endAt: e.target.value })}
            className="rounded border border-neutral-200 px-3 py-2 text-sm"
          />
          <button
            onClick={() => { setMsg(null); create.mutate(); }}
            disabled={!f.title.trim() || !f.startAt || !f.endAt || create.isPending}
            className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:bg-neutral-300"
          >
            {create.isPending ? 'Đang tạo…' : 'Tạo đợt'}
          </button>
        </div>
        {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>}
      </div>

      <div className="space-y-3">
        {q.isError && <p className="text-sm text-red-600">Không tải được danh sách flash sale.</p>}
        {q.data?.map((s) => <FlashSaleRow key={s.id} sale={s} />)}
        {q.data?.length === 0 && <Empty>Chưa có đợt flash sale nào. Tạo đợt đầu tiên ở trên.</Empty>}
      </div>
    </div>
  );
}

function FlashSaleRow({ sale }: { sale: AdminFlashSale }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-flash-sales'] });
  const [rowErr, setRowErr] = useState<string | null>(null);
  const toggleActive = useMutation({
    mutationFn: () => updateFlashSale(sale.id, { isActive: !sale.isActive }),
    onSuccess: () => { setRowErr(null); refresh(); },
    onError: (e) => setRowErr(e instanceof Error ? e.message : 'Có lỗi xảy ra'),
  });
  const delItem = useMutation({
    mutationFn: (itemId: string) => deleteFlashSaleItem(itemId),
    onSuccess: () => { setRowErr(null); refresh(); },
    onError: (e) => setRowErr(e instanceof Error ? e.message : 'Có lỗi xảy ra'),
  });
  const [item, setItem] = useState({ variationId: '', flashPrice: 0, quota: 0, perUserLimit: '' });
  const [itemErr, setItemErr] = useState<string | null>(null);
  const addItem = useMutation({
    mutationFn: () =>
      addFlashSaleItem(sale.id, {
        variationId: item.variationId.trim(),
        flashPrice: Number(item.flashPrice),
        quota: Number(item.quota),
        perUserLimit: item.perUserLimit ? Number(item.perUserLimit) : undefined,
      }),
    onSuccess: () => {
      setItem({ variationId: '', flashPrice: 0, quota: 0, perUserLimit: '' });
      setItemErr(null);
      refresh();
    },
    onError: (e) => setItemErr(e instanceof Error ? e.message : 'Lỗi thêm sản phẩm'),
  });

  const fmt = (iso: string) => new Date(iso).toLocaleString('vi-VN');

  return (
    <div className="rounded-lg border border-neutral-100 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 font-medium">
            {sale.title}
            <span className={`rounded-full px-2 py-0.5 text-xs text-white ${sale.isActive ? 'bg-green-600' : 'bg-neutral-400'}`}>
              {sale.isActive ? 'Đang bật' : 'Đang tắt'}
            </span>
          </div>
          <div className="text-xs text-neutral-400">{fmt(sale.startAt)} → {fmt(sale.endAt)}</div>
        </div>
        <button onClick={() => toggleActive.mutate()} disabled={toggleActive.isPending} className="rounded border border-neutral-200 px-3 py-1.5 text-sm">
          {sale.isActive ? 'Tắt' : 'Bật'}
        </button>
      </div>
      {rowErr && <p className="mt-1 text-sm text-red-600">{rowErr}</p>}

      <div className="mt-3 border-t border-neutral-100 pt-3">
        <div className="mb-1 text-sm font-medium">Sản phẩm trong đợt ({sale.items.length})</div>
        <div className="space-y-1">
          {sale.items.map((it) => (
            <div key={it.id} className="flex items-center justify-between rounded border border-neutral-100 px-2 py-1 text-sm">
              <span className="truncate">
                Variation {it.variationId} · {formatVnd(it.flashPrice)} · đã bán {it.soldCount}/{it.quota} · giới hạn {it.perUserLimit}/khách
              </span>
              <button onClick={() => delItem.mutate(it.id)} className="ml-2 shrink-0 text-xs text-red-600">Xoá</button>
            </div>
          ))}
          {sale.items.length === 0 && <p className="text-xs text-neutral-400">Chưa có sản phẩm nào trong đợt này.</p>}
        </div>

        <div className="mt-2 flex flex-wrap items-end gap-2">
          <input placeholder="Variation ID" value={item.variationId} onChange={(e) => setItem({ ...item, variationId: e.target.value })} className="flex-1 rounded border border-neutral-200 px-2 py-1 text-sm" />
          <input type="number" placeholder="Giá flash" value={item.flashPrice} onChange={(e) => setItem({ ...item, flashPrice: Number(e.target.value) })} className="w-28 rounded border border-neutral-200 px-2 py-1 text-sm" />
          <input type="number" placeholder="Quota" value={item.quota} onChange={(e) => setItem({ ...item, quota: Number(e.target.value) })} className="w-24 rounded border border-neutral-200 px-2 py-1 text-sm" />
          <input type="number" placeholder="Giới hạn/khách" value={item.perUserLimit} onChange={(e) => setItem({ ...item, perUserLimit: e.target.value })} className="w-32 rounded border border-neutral-200 px-2 py-1 text-sm" />
          <button onClick={() => addItem.mutate()} disabled={!item.variationId.trim() || addItem.isPending} className="rounded bg-green-600 px-3 py-1.5 text-sm text-white disabled:bg-neutral-300">
            Thêm SP
          </button>
        </div>
        <p className="mt-1 text-xs text-neutral-400">Variation ID là id của biến thể sản phẩm (lấy từ trang quản lý sản phẩm).</p>
        {itemErr && <p className="mt-1 text-sm text-red-600">{itemErr}</p>}
      </div>
    </div>
  );
}

// ── FAQ / câu trả lời nhanh (CSKH + nạp vào AI tư vấn) ──
function FaqTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-faqs'], queryFn: listFaqs });
  const [form, setForm] = useState({ category: '', question: '', answer: '', sortOrder: 0 });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const create = useMutation({
    mutationFn: () =>
      createFaq({
        category: form.category.trim() || undefined,
        question: form.question.trim(),
        answer: form.answer.trim(),
        sortOrder: Number(form.sortOrder) || 0,
      }),
    onSuccess: () => {
      setForm({ category: '', question: '', answer: '', sortOrder: 0 });
      setMsg({ ok: true, text: 'Đã thêm câu hỏi thường gặp!' });
      void qc.invalidateQueries({ queryKey: ['admin-faqs'] });
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Lỗi tạo câu hỏi thường gặp' }),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-100 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold">Thêm câu hỏi thường gặp</h3>
        <p className="mb-2 text-xs text-neutral-400">Nội dung này cũng được nạp vào ngữ cảnh của AI tư vấn để trả lời nhất quán.</p>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <input
              placeholder="Nhóm (vd Vận chuyển, Đổi trả)"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-56 rounded border border-neutral-200 px-3 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="Thứ tự hiển thị"
              value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
              className="w-32 rounded border border-neutral-200 px-3 py-2 text-sm"
            />
          </div>
          <input
            placeholder="Câu hỏi"
            value={form.question}
            onChange={(e) => setForm({ ...form, question: e.target.value })}
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
          />
          <textarea
            placeholder="Câu trả lời"
            value={form.answer}
            onChange={(e) => setForm({ ...form, answer: e.target.value })}
            rows={3}
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
          />
          <button
            onClick={() => { setMsg(null); create.mutate(); }}
            disabled={!form.question.trim() || !form.answer.trim() || create.isPending}
            className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:bg-neutral-300"
          >
            {create.isPending ? 'Đang thêm…' : 'Thêm câu hỏi'}
          </button>
        </div>
        {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>}
      </div>

      <div className="space-y-2">
        {q.isError && <p className="text-sm text-red-600">Không tải được danh sách câu hỏi thường gặp.</p>}
        {q.data?.map((f) => <FaqRow key={f.id} faq={f} />)}
        {q.data?.length === 0 && <Empty>Chưa có câu hỏi thường gặp nào. Thêm câu đầu tiên ở trên.</Empty>}
      </div>
    </div>
  );
}

function FaqRow({ faq }: { faq: AdminFaq }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-faqs'] });
  const [rowErr, setRowErr] = useState<string | null>(null);
  const onRowError = (e: unknown) => setRowErr(e instanceof Error ? e.message : 'Có lỗi xảy ra, vui lòng thử lại.');
  const toggleActive = useMutation({
    mutationFn: () => updateFaq(faq.id, { isActive: !faq.isActive }),
    onSuccess: () => { setRowErr(null); refresh(); },
    onError: onRowError,
  });
  const del = useMutation({
    mutationFn: () => deleteFaq(faq.id),
    onSuccess: () => { setRowErr(null); refresh(); },
    onError: onRowError,
  });
  const [f, setF] = useState({ category: faq.category ?? '', question: faq.question, answer: faq.answer, sortOrder: faq.sortOrder });
  const save = useMutation({
    mutationFn: () =>
      updateFaq(faq.id, {
        category: f.category.trim() || undefined,
        question: f.question.trim(),
        answer: f.answer.trim(),
        sortOrder: Number(f.sortOrder) || 0,
      }),
    onSuccess: () => { setOpen(false); refresh(); },
  });

  return (
    <div className="rounded-lg border border-neutral-100 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {faq.category && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">{faq.category}</span>}
            <span className={`rounded-full px-2 py-0.5 text-xs text-white ${faq.isActive ? 'bg-green-600' : 'bg-neutral-400'}`}>
              {faq.isActive ? 'Đang hiện' : 'Đang ẩn'}
            </span>
            <span className="text-xs text-neutral-400">thứ tự {faq.sortOrder}</span>
          </div>
          <div className="mt-1 font-medium">{faq.question}</div>
          <div className="mt-0.5 whitespace-pre-line text-sm text-neutral-600">{faq.answer}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button onClick={() => setOpen((o) => !o)} className="text-sm text-green-700 underline">{open ? 'Đóng' : 'Sửa'}</button>
          <button onClick={() => toggleActive.mutate()} disabled={toggleActive.isPending} className="text-xs text-neutral-500 underline">
            {faq.isActive ? 'Ẩn' : 'Hiện'}
          </button>
          <button onClick={() => del.mutate()} disabled={del.isPending} className="text-xs text-red-600 underline">Xoá</button>
        </div>
      </div>
      {rowErr && <p className="mt-1 text-xs text-red-600">{rowErr}</p>}

      {open && (
        <div className="mt-3 space-y-2 border-t border-neutral-100 pt-3">
          <div className="flex flex-wrap gap-2">
            <input placeholder="Nhóm" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className="w-56 rounded border border-neutral-200 px-2 py-1 text-sm" />
            <input type="number" placeholder="Thứ tự" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} className="w-32 rounded border border-neutral-200 px-2 py-1 text-sm" />
          </div>
          <input placeholder="Câu hỏi" value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} className="w-full rounded border border-neutral-200 px-2 py-1 text-sm" />
          <textarea placeholder="Câu trả lời" value={f.answer} onChange={(e) => setF({ ...f, answer: e.target.value })} rows={3} className="w-full rounded border border-neutral-200 px-2 py-1 text-sm" />
          <button
            onClick={() => save.mutate()}
            disabled={!f.question.trim() || !f.answer.trim() || save.isPending}
            className="rounded bg-green-600 px-3 py-1.5 text-sm text-white disabled:bg-neutral-300"
          >
            {save.isPending ? 'Đang lưu…' : 'Lưu'}
          </button>
          {save.isError && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        </div>
      )}
    </div>
  );
}

// ── CSKH Quick-reply (mẫu tin nhanh + auto-reply Zalo OA) ──
function parseKeywords(raw: string): string[] {
  return raw.split(',').map((k) => k.trim()).filter(Boolean);
}

function QuickReplyTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-quick-replies'], queryFn: listQuickReplies });
  const [form, setForm] = useState({ category: '', keywords: '', title: '', content: '', isGreeting: false });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const create = useMutation({
    mutationFn: () =>
      createQuickReply({
        category: form.category.trim() || undefined,
        keywords: parseKeywords(form.keywords),
        title: form.title.trim(),
        content: form.content.trim(),
        isGreeting: form.isGreeting,
      }),
    onSuccess: () => {
      setForm({ category: '', keywords: '', title: '', content: '', isGreeting: false });
      setMsg({ ok: true, text: 'Đã thêm mẫu tin nhanh!' });
      void qc.invalidateQueries({ queryKey: ['admin-quick-replies'] });
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Lỗi tạo mẫu tin nhanh' }),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-100 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold">Thêm mẫu tin nhanh</h3>
        <p className="mb-2 text-xs text-neutral-400">
          Dùng để auto-reply khi khách nhắn vào Zalo OA — so khớp từ khoá (cách nhau bằng dấu phẩy),
          hoặc bật &quot;Lời chào tự động&quot; để gửi cho tin nhắn đầu tiên của khách.
        </p>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <input
              placeholder="Nhóm (vd Vận chuyển, Đổi trả)"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-56 rounded border border-neutral-200 px-3 py-2 text-sm"
            />
            <input
              placeholder="Tên nội bộ"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-56 rounded border border-neutral-200 px-3 py-2 text-sm"
            />
          </div>
          <input
            placeholder="Từ khoá kích hoạt, cách nhau bằng dấu phẩy (vd ship, phí vận chuyển)"
            value={form.keywords}
            onChange={(e) => setForm({ ...form, keywords: e.target.value })}
            disabled={form.isGreeting}
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm disabled:bg-neutral-50 disabled:text-neutral-400"
          />
          <textarea
            placeholder="Nội dung tin trả lời"
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            rows={3}
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
          />
          <label className="flex items-center gap-2 text-sm text-neutral-600">
            <input
              type="checkbox"
              checked={form.isGreeting}
              onChange={(e) => setForm({ ...form, isGreeting: e.target.checked })}
            />
            Dùng làm lời chào tự động (tin nhắn đầu tiên của khách)
          </label>
          <button
            onClick={() => { setMsg(null); create.mutate(); }}
            disabled={!form.title.trim() || !form.content.trim() || create.isPending}
            className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:bg-neutral-300"
          >
            {create.isPending ? 'Đang thêm…' : 'Thêm mẫu tin'}
          </button>
        </div>
        {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>}
      </div>

      <div className="space-y-2">
        {q.isError && <p className="text-sm text-red-600">Không tải được danh sách mẫu tin nhanh.</p>}
        {q.data?.map((r) => <QuickReplyRow key={r.id} item={r} />)}
        {q.data?.length === 0 && <Empty>Chưa có mẫu tin nhanh nào. Thêm mẫu đầu tiên ở trên.</Empty>}
      </div>
    </div>
  );
}

function QuickReplyRow({ item }: { item: AdminQuickReply }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-quick-replies'] });
  const [rowErr, setRowErr] = useState<string | null>(null);
  const onRowError = (e: unknown) => setRowErr(e instanceof Error ? e.message : 'Có lỗi xảy ra, vui lòng thử lại.');
  const toggleActive = useMutation({
    mutationFn: () => updateQuickReply(item.id, { isActive: !item.isActive }),
    onSuccess: () => { setRowErr(null); refresh(); },
    onError: onRowError,
  });
  const del = useMutation({
    mutationFn: () => deleteQuickReply(item.id),
    onSuccess: () => { setRowErr(null); refresh(); },
    onError: onRowError,
  });
  const [f, setF] = useState({
    category: item.category ?? '',
    keywords: item.keywords.join(', '),
    title: item.title,
    content: item.content,
    isGreeting: item.isGreeting,
  });
  const save = useMutation({
    mutationFn: () =>
      updateQuickReply(item.id, {
        category: f.category.trim() || undefined,
        keywords: parseKeywords(f.keywords),
        title: f.title.trim(),
        content: f.content.trim(),
        isGreeting: f.isGreeting,
      }),
    onSuccess: () => { setOpen(false); refresh(); },
  });

  return (
    <div className="rounded-lg border border-neutral-100 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {item.category && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">{item.category}</span>}
            {item.isGreeting && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Lời chào</span>}
            <span className={`rounded-full px-2 py-0.5 text-xs text-white ${item.isActive ? 'bg-green-600' : 'bg-neutral-400'}`}>
              {item.isActive ? 'Đang bật' : 'Đang tắt'}
            </span>
          </div>
          <div className="mt-1 font-medium">{item.title}</div>
          {item.keywords.length > 0 && (
            <div className="mt-0.5 text-xs text-neutral-400">Từ khoá: {item.keywords.join(', ')}</div>
          )}
          <div className="mt-0.5 whitespace-pre-line text-sm text-neutral-600">{item.content}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button onClick={() => setOpen((o) => !o)} className="text-sm text-green-700 underline">{open ? 'Đóng' : 'Sửa'}</button>
          <button onClick={() => toggleActive.mutate()} disabled={toggleActive.isPending} className="text-xs text-neutral-500 underline">
            {item.isActive ? 'Tắt' : 'Bật'}
          </button>
          <button onClick={() => del.mutate()} disabled={del.isPending} className="text-xs text-red-600 underline">Xoá</button>
        </div>
      </div>
      {rowErr && <p className="mt-1 text-xs text-red-600">{rowErr}</p>}

      {open && (
        <div className="mt-3 space-y-2 border-t border-neutral-100 pt-3">
          <div className="flex flex-wrap gap-2">
            <input placeholder="Nhóm" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className="w-56 rounded border border-neutral-200 px-2 py-1 text-sm" />
            <input placeholder="Tên nội bộ" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className="w-56 rounded border border-neutral-200 px-2 py-1 text-sm" />
          </div>
          <input
            placeholder="Từ khoá, cách nhau bằng dấu phẩy"
            value={f.keywords}
            onChange={(e) => setF({ ...f, keywords: e.target.value })}
            disabled={f.isGreeting}
            className="w-full rounded border border-neutral-200 px-2 py-1 text-sm disabled:bg-neutral-50 disabled:text-neutral-400"
          />
          <textarea placeholder="Nội dung" value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} rows={3} className="w-full rounded border border-neutral-200 px-2 py-1 text-sm" />
          <label className="flex items-center gap-2 text-sm text-neutral-600">
            <input type="checkbox" checked={f.isGreeting} onChange={(e) => setF({ ...f, isGreeting: e.target.checked })} />
            Dùng làm lời chào tự động
          </label>
          <button
            onClick={() => save.mutate()}
            disabled={!f.title.trim() || !f.content.trim() || save.isPending}
            className="rounded bg-green-600 px-3 py-1.5 text-sm text-white disabled:bg-neutral-300"
          >
            {save.isPending ? 'Đang lưu…' : 'Lưu'}
          </button>
          {save.isError && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        </div>
      )}
    </div>
  );
}

// ── Content Kit CTV (bài mẫu/USP/FAQ/media per-sản phẩm) ──
function ContentKitTab() {
  const [productId, setProductId] = useState('');
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['admin-content-kit', loadedId],
    queryFn: () => getContentKit(loadedId as string),
    enabled: !!loadedId,
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-100 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold">Soạn Content Kit theo sản phẩm</h3>
        <p className="mb-2 text-xs text-neutral-400">
          Nhập Product ID (lấy từ trang quản lý nhãn hàng/sản phẩm). Trong caption dùng{' '}
          <code>{'{ten_ctv}'}</code> và <code>{'{link}'}</code> — hệ thống sẽ tự chèn tên CTV + link giới thiệu khi CTV xem.
        </p>
        <div className="flex gap-2">
          <input
            placeholder="Product ID"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="flex-1 rounded border border-neutral-200 px-3 py-2 text-sm"
          />
          <button
            onClick={() => setLoadedId(productId.trim())}
            disabled={!productId.trim()}
            className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:bg-neutral-300"
          >
            Tải
          </button>
        </div>
      </div>

      {loadedId && q.isLoading && <p className="text-sm text-neutral-400">Đang tải…</p>}
      {loadedId && q.isError && <p className="text-sm text-red-600">{(q.error as Error).message}</p>}
      {loadedId && q.isSuccess && (
        <ContentKitEditor key={loadedId} productId={loadedId} initial={q.data} />
      )}
    </div>
  );
}

function ContentKitEditor({
  productId,
  initial,
}: {
  productId: string;
  initial: { captions: string[]; usps: string[]; faqs: ContentKitFaq[] | null; videoUrls: string[] } | null;
}) {
  const qc = useQueryClient();
  const [captions, setCaptions] = useState((initial?.captions ?? []).join('\n'));
  const [usps, setUsps] = useState((initial?.usps ?? []).join('\n'));
  const [videoUrls, setVideoUrls] = useState((initial?.videoUrls ?? []).join('\n'));
  const [faqs, setFaqs] = useState<ContentKitFaq[]>(initial?.faqs ?? []);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const toLines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

  const save = useMutation({
    mutationFn: () =>
      saveContentKit(productId, {
        captions: toLines(captions),
        usps: toLines(usps),
        videoUrls: toLines(videoUrls),
        faqs: faqs.filter((f) => f.q.trim() && f.a.trim()),
      }),
    onSuccess: () => {
      setMsg({ ok: true, text: 'Đã lưu Content Kit!' });
      void qc.invalidateQueries({ queryKey: ['admin-content-kit', productId] });
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Lỗi lưu Content Kit' }),
  });

  const setFaq = (i: number, patch: Partial<ContentKitFaq>) =>
    setFaqs((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));

  return (
    <div className="rounded-lg border border-neutral-100 bg-white p-4">
      <div className="mb-2 text-sm font-medium">Sản phẩm: {productId}</div>

      <label className="mb-1 block text-xs font-medium text-neutral-500">Bài mẫu (mỗi dòng 1 caption)</label>
      <textarea
        value={captions}
        onChange={(e) => setCaptions(e.target.value)}
        rows={5}
        placeholder={'Mình đang dùng sản phẩm này, ưng lắm! Mua qua {link} nhé {ten_ctv} 🌿'}
        className="mb-3 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
      />

      <label className="mb-1 block text-xs font-medium text-neutral-500">USP / điểm bán hàng (mỗi dòng 1 ý)</label>
      <textarea
        value={usps}
        onChange={(e) => setUsps(e.target.value)}
        rows={3}
        placeholder={'Nguyên liệu tự nhiên 100%'}
        className="mb-3 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
      />

      <label className="mb-1 block text-xs font-medium text-neutral-500">Video URL (mỗi dòng 1 link)</label>
      <textarea
        value={videoUrls}
        onChange={(e) => setVideoUrls(e.target.value)}
        rows={2}
        placeholder={'https://...'}
        className="mb-3 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
      />

      <div className="mb-1 text-xs font-medium text-neutral-500">FAQ (câu hỏi thường gặp)</div>
      <div className="space-y-1">
        {faqs.map((f, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <input
              placeholder="Câu hỏi"
              value={f.q}
              onChange={(e) => setFaq(i, { q: e.target.value })}
              className="flex-1 rounded border border-neutral-200 px-2 py-1"
            />
            <input
              placeholder="Câu trả lời"
              value={f.a}
              onChange={(e) => setFaq(i, { a: e.target.value })}
              className="flex-1 rounded border border-neutral-200 px-2 py-1"
            />
            <button onClick={() => setFaqs((fs) => fs.filter((_, idx) => idx !== i))} className="text-xs text-red-600">
              Xoá
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => setFaqs((fs) => [...fs, { q: '', a: '' }])}
        className="mt-1 text-sm text-green-700 underline"
      >
        + Thêm FAQ
      </button>

      <div className="mt-3">
        <button
          onClick={() => { setMsg(null); save.mutate(); }}
          disabled={save.isPending}
          className="rounded bg-green-600 px-4 py-1.5 text-sm text-white disabled:bg-neutral-300"
        >
          {save.isPending ? 'Đang lưu…' : 'Lưu Content Kit'}
        </button>
        {msg && <span className={`ml-2 text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</span>}
      </div>
    </div>
  );
}

// ── CTV Academy (khoá học/bài học đào tạo CTV) ──
function AcademyTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-academy-courses'], queryFn: listAcademyCourses });
  const [form, setForm] = useState({ title: '', description: '', coverUrl: '', sortOrder: 0 });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const create = useMutation({
    mutationFn: () =>
      createAcademyCourse({
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        coverUrl: form.coverUrl.trim() || undefined,
        sortOrder: Number(form.sortOrder) || 0,
      }),
    onSuccess: () => {
      setForm({ title: '', description: '', coverUrl: '', sortOrder: 0 });
      setMsg({ ok: true, text: 'Đã tạo khoá học!' });
      void qc.invalidateQueries({ queryKey: ['admin-academy-courses'] });
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Lỗi tạo khoá học' }),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-100 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold">Tạo khoá học mới</h3>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <input
              placeholder="Tiêu đề khoá học"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="flex-1 rounded border border-neutral-200 px-3 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="Thứ tự"
              value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
              className="w-28 rounded border border-neutral-200 px-3 py-2 text-sm"
            />
          </div>
          <input
            placeholder="Cover URL"
            value={form.coverUrl}
            onChange={(e) => setForm({ ...form, coverUrl: e.target.value })}
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
          />
          <textarea
            placeholder="Mô tả"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
          />
          <button
            onClick={() => { setMsg(null); create.mutate(); }}
            disabled={!form.title.trim() || create.isPending}
            className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:bg-neutral-300"
          >
            {create.isPending ? 'Đang tạo…' : 'Tạo khoá học'}
          </button>
        </div>
        {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>}
      </div>

      <div className="space-y-3">
        {q.isError && <p className="text-sm text-red-600">Không tải được danh sách khoá học.</p>}
        {q.data?.map((c) => <CourseRow key={c.id} course={c} />)}
        {q.data?.length === 0 && <Empty>Chưa có khoá học nào. Tạo khoá đầu tiên ở trên.</Empty>}
      </div>
    </div>
  );
}

function CourseRow({ course }: { course: AdminCourse }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-academy-courses'] });
  const [rowErr, setRowErr] = useState<string | null>(null);
  const onRowError = (e: unknown) => setRowErr(e instanceof Error ? e.message : 'Có lỗi xảy ra, vui lòng thử lại.');
  const togglePublish = useMutation({
    mutationFn: () => updateAcademyCourse(course.id, { isPublished: !course.isPublished }),
    onSuccess: () => { setRowErr(null); refresh(); },
    onError: onRowError,
  });
  const del = useMutation({
    mutationFn: () => deleteAcademyCourse(course.id),
    onSuccess: () => { setRowErr(null); refresh(); },
    onError: onRowError,
  });
  const [f, setF] = useState({
    title: course.title,
    description: course.description ?? '',
    coverUrl: course.coverUrl ?? '',
    sortOrder: course.sortOrder,
  });
  const save = useMutation({
    mutationFn: () =>
      updateAcademyCourse(course.id, {
        title: f.title.trim(),
        description: f.description.trim() || undefined,
        coverUrl: f.coverUrl.trim() || undefined,
        sortOrder: Number(f.sortOrder) || 0,
      }),
    onSuccess: refresh,
  });

  const [lesson, setLesson] = useState<{
    title: string;
    contentType: AcademyLessonContentType;
    videoUrl: string;
    body: string;
    sortOrder: number;
  }>({ title: '', contentType: 'ARTICLE', videoUrl: '', body: '', sortOrder: 0 });
  const addLesson = useMutation({
    mutationFn: () =>
      addAcademyLesson(course.id, {
        title: lesson.title.trim(),
        contentType: lesson.contentType,
        videoUrl: lesson.contentType === 'VIDEO' ? lesson.videoUrl.trim() || undefined : undefined,
        body: lesson.contentType === 'ARTICLE' ? lesson.body.trim() || undefined : undefined,
        sortOrder: Number(lesson.sortOrder) || 0,
      }),
    onSuccess: () => {
      setLesson({ title: '', contentType: 'ARTICLE', videoUrl: '', body: '', sortOrder: 0 });
      refresh();
    },
  });

  return (
    <div className="rounded-lg border border-neutral-100 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 font-medium">
            {course.title}
            <span className={`rounded-full px-2 py-0.5 text-xs text-white ${course.isPublished ? 'bg-green-600' : 'bg-neutral-400'}`}>
              {course.isPublished ? 'Đã đăng' : 'Nháp'}
            </span>
          </div>
          <div className="text-xs text-neutral-400">{course.lessons.length} bài học · thứ tự {course.sortOrder}</div>
        </div>
        <button onClick={() => setOpen((o) => !o)} className="text-sm text-green-700 underline">{open ? 'Thu gọn' : 'Quản lý'}</button>
      </div>

      {open && (
        <div className="mt-3 space-y-4 border-t border-neutral-100 pt-3">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => togglePublish.mutate()} disabled={togglePublish.isPending} className="rounded border border-neutral-200 px-3 py-1.5 text-sm">
              {course.isPublished ? 'Chuyển về nháp' : 'Đăng (publish)'}
            </button>
            <button onClick={() => del.mutate()} disabled={del.isPending} className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600">
              Xoá khoá học
            </button>
          </div>
          {rowErr && <p className="text-xs text-red-600">{rowErr}</p>}

          <div className="rounded-lg border border-neutral-100 bg-neutral-50/50 p-3">
            <div className="mb-2 text-sm font-medium">Thông tin khoá học</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input placeholder="Tiêu đề" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className="rounded border border-neutral-200 px-2 py-1 text-sm" />
              <input type="number" placeholder="Thứ tự" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} className="rounded border border-neutral-200 px-2 py-1 text-sm" />
              <input placeholder="Cover URL" value={f.coverUrl} onChange={(e) => setF({ ...f, coverUrl: e.target.value })} className="rounded border border-neutral-200 px-2 py-1 text-sm sm:col-span-2" />
            </div>
            <textarea placeholder="Mô tả" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={2} className="mt-2 w-full rounded border border-neutral-200 px-2 py-1 text-sm" />
            <button onClick={() => save.mutate()} disabled={!f.title.trim() || save.isPending} className="mt-2 rounded bg-green-600 px-4 py-1.5 text-sm text-white disabled:bg-neutral-300">
              {save.isPending ? 'Đang lưu…' : 'Lưu thông tin'}
            </button>
            {save.isSuccess && <span className="ml-2 text-sm text-green-700">Đã lưu ✓</span>}
            {save.isError && <span className="ml-2 text-sm text-red-600">{(save.error as Error).message}</span>}
          </div>

          <div>
            <div className="mb-1 text-sm font-medium">Bài học ({course.lessons.length})</div>
            <div className="space-y-1">
              {course.lessons.map((l) => <LessonRow key={l.id} lesson={l} />)}
              {course.lessons.length === 0 && <p className="text-xs text-neutral-400">Chưa có bài học nào.</p>}
            </div>

            <div className="mt-2 space-y-2 rounded border border-neutral-100 p-2">
              <div className="flex flex-wrap gap-2">
                <input
                  placeholder="Tiêu đề bài học"
                  value={lesson.title}
                  onChange={(e) => setLesson({ ...lesson, title: e.target.value })}
                  className="flex-1 rounded border border-neutral-200 px-2 py-1 text-sm"
                />
                <select
                  value={lesson.contentType}
                  onChange={(e) => setLesson({ ...lesson, contentType: e.target.value as AcademyLessonContentType })}
                  className="rounded border border-neutral-200 px-2 py-1 text-sm"
                >
                  <option value="ARTICLE">Bài viết</option>
                  <option value="VIDEO">Video</option>
                </select>
                <input
                  type="number"
                  placeholder="Thứ tự"
                  value={lesson.sortOrder}
                  onChange={(e) => setLesson({ ...lesson, sortOrder: Number(e.target.value) })}
                  className="w-24 rounded border border-neutral-200 px-2 py-1 text-sm"
                />
              </div>
              {lesson.contentType === 'VIDEO' ? (
                <input
                  placeholder="Video URL"
                  value={lesson.videoUrl}
                  onChange={(e) => setLesson({ ...lesson, videoUrl: e.target.value })}
                  className="w-full rounded border border-neutral-200 px-2 py-1 text-sm"
                />
              ) : (
                <textarea
                  placeholder="Nội dung bài viết"
                  value={lesson.body}
                  onChange={(e) => setLesson({ ...lesson, body: e.target.value })}
                  rows={3}
                  className="w-full rounded border border-neutral-200 px-2 py-1 text-sm"
                />
              )}
              <button
                onClick={() => addLesson.mutate()}
                disabled={!lesson.title.trim() || addLesson.isPending}
                className="rounded bg-green-600 px-3 py-1.5 text-sm text-white disabled:bg-neutral-300"
              >
                Thêm bài học
              </button>
              {addLesson.isError && <p className="text-xs text-red-600">{(addLesson.error as Error).message}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LessonRow({ lesson }: { lesson: AdminLesson }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-academy-courses'] });
  const del = useMutation({
    mutationFn: () => deleteAcademyLesson(lesson.id),
    onSuccess: refresh,
  });
  const [f, setF] = useState({
    title: lesson.title,
    contentType: lesson.contentType,
    videoUrl: lesson.videoUrl ?? '',
    body: lesson.body ?? '',
    sortOrder: lesson.sortOrder,
  });
  const save = useMutation({
    mutationFn: () =>
      updateAcademyLesson(lesson.id, {
        title: f.title.trim(),
        contentType: f.contentType,
        videoUrl: f.contentType === 'VIDEO' ? f.videoUrl.trim() : undefined,
        body: f.contentType === 'ARTICLE' ? f.body.trim() : undefined,
        sortOrder: Number(f.sortOrder) || 0,
      }),
    onSuccess: () => { setOpen(false); refresh(); },
  });

  return (
    <div className="rounded border border-neutral-100 px-2 py-1 text-sm">
      <div className="flex items-center justify-between">
        <span className="truncate">
          [{lesson.contentType === 'VIDEO' ? 'Video' : 'Bài viết'}] {lesson.title} · thứ tự {lesson.sortOrder}
        </span>
        <div className="flex shrink-0 gap-2">
          <button onClick={() => setOpen((o) => !o)} className="text-xs text-green-700 underline">{open ? 'Đóng' : 'Sửa'}</button>
          <button onClick={() => del.mutate()} disabled={del.isPending} className="text-xs text-red-600 underline">Xoá</button>
        </div>
      </div>
      {del.isError && <p className="mt-1 text-xs text-red-600">{(del.error as Error).message}</p>}
      {open && (
        <div className="mt-2 space-y-2 border-t border-neutral-100 pt-2">
          <div className="flex flex-wrap gap-2">
            <input placeholder="Tiêu đề" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className="flex-1 rounded border border-neutral-200 px-2 py-1" />
            <select
              value={f.contentType}
              onChange={(e) => setF({ ...f, contentType: e.target.value as AcademyLessonContentType })}
              className="rounded border border-neutral-200 px-2 py-1"
            >
              <option value="ARTICLE">Bài viết</option>
              <option value="VIDEO">Video</option>
            </select>
            <input type="number" placeholder="Thứ tự" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} className="w-24 rounded border border-neutral-200 px-2 py-1" />
          </div>
          {f.contentType === 'VIDEO' ? (
            <input placeholder="Video URL" value={f.videoUrl} onChange={(e) => setF({ ...f, videoUrl: e.target.value })} className="w-full rounded border border-neutral-200 px-2 py-1" />
          ) : (
            <textarea placeholder="Nội dung bài viết" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={3} className="w-full rounded border border-neutral-200 px-2 py-1" />
          )}
          <button onClick={() => save.mutate()} disabled={!f.title.trim() || save.isPending} className="rounded bg-green-600 px-3 py-1 text-white disabled:bg-neutral-300">
            {save.isPending ? 'Đang lưu…' : 'Lưu'}
          </button>
          {save.isError && <p className="text-xs text-red-600">{(save.error as Error).message}</p>}
        </div>
      )}
    </div>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-100 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-neutral-50 text-xs text-neutral-500">
          <tr>{head.map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="px-3">{children}</tbody>
      </table>
    </div>
  );
}
function Center({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-3xl px-4 py-20 text-center text-neutral-600">{children}</main>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-neutral-100 bg-white p-6 text-center text-sm text-neutral-500">{children}</p>;
}
