'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { formatVnd } from '@/lib/shop-client';
import {
  listDealerApps,
  reviewDealerApp,
  listUsers,
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
  type ConfigRow,
  type AdminBrand,
  type BrandCert,
} from '@/lib/admin-client';

type Tab = 'dealers' | 'orders' | 'users' | 'config' | 'coupons' | 'brands';
const TABS: { k: Tab; label: string }[] = [
  { k: 'dealers', label: 'Đại lý' },
  { k: 'orders', label: 'Đơn hàng' },
  { k: 'users', label: 'Người dùng' },
  { k: 'config', label: 'Cấu hình' },
  { k: 'coupons', label: 'Voucher' },
  { k: 'brands', label: 'Nhãn hàng' },
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
      </div>
    </main>
  );
}

function DealersTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('PENDING');
  const q = useQuery({ queryKey: ['admin-dealers', filter], queryFn: () => listDealerApps(filter || undefined) });
  const [tierId, setTierId] = useState('');

  const review = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      reviewDealerApp(id, approve, approve ? tierId || undefined : undefined, approve ? undefined : 'Không đạt yêu cầu'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-dealers'] }),
  });

  return (
    <div>
      <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded border border-neutral-200 px-2 py-1 text-sm">
        {['PENDING', 'APPROVED', 'REJECTED', ''].map((s) => (
          <option key={s} value={s}>{s || 'Tất cả'}</option>
        ))}
      </select>
      <div className="mt-3 space-y-3">
        {q.data?.map((a) => (
          <div key={a.id} className="rounded-lg border border-neutral-100 bg-white p-4">
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
                  placeholder="Tier ID (vd dealer_l3)"
                  value={tierId}
                  onChange={(e) => setTierId(e.target.value)}
                  className="rounded border border-neutral-200 px-2 py-1 text-sm"
                />
                <button onClick={() => review.mutate({ id: a.id, approve: true })} className="rounded bg-green-600 px-3 py-1.5 text-sm text-white">Duyệt</button>
                <button onClick={() => review.mutate({ id: a.id, approve: false })} className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600">Từ chối</button>
              </div>
            )}
          </div>
        ))}
        {q.data?.length === 0 && <Empty>Không có hồ sơ.</Empty>}
      </div>
    </div>
  );
}

function OrdersTab() {
  const q = useQuery({ queryKey: ['admin-orders'], queryFn: () => listOrders(1) });
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

function UsersTab() {
  const q = useQuery({ queryKey: ['admin-users'], queryFn: () => listUsers(1) });
  return (
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
  );
}

function ConfigTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-config'], queryFn: () => getConfig() });
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
  const patch = useMutation({
    mutationFn: (body: Partial<{ isPublished: boolean }>) => updateBrand(brand.id, body),
    onSuccess: refreshBrands,
  });
  const verify = useMutation({
    mutationFn: (v: boolean) => verifyBrand(brand.id, v),
    onSuccess: refreshBrands,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-brand-products', brand.id] }),
  });
  const detach = useMutation({
    mutationFn: (pid: string) => detachBrandProducts(brand.id, [pid]),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-brand-products', brand.id] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-brand-promos', brand.id] }),
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
  const [f, setF] = useState({ type: 'TOUR', title: '', description: '', threshold: 50000000 });
  const create = useMutation({
    mutationFn: () => createDealerReward({
      type: f.type as 'TOUR' | 'GIFT' | 'OTHER', title: f.title.trim(),
      description: f.description.trim() || undefined, threshold: Number(f.threshold),
    }),
    onSuccess: () => { setF({ type: 'TOUR', title: '', description: '', threshold: 50000000 }); void qc.invalidateQueries({ queryKey: ['admin-dealer-rewards'] }); },
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteDealerReward(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-dealer-rewards'] }),
  });

  return (
    <div className="rounded-lg border border-neutral-100 bg-white p-4">
      <div className="mb-2 font-medium">🏪 Chương trình đại lý (thưởng doanh số)</div>
      <div className="space-y-1">
        {q.data?.map((d) => (
          <div key={d.id} className="flex items-center justify-between rounded border border-neutral-100 px-2 py-1 text-sm">
            <span>[{d.type}] {d.title} · mốc {formatVnd(d.threshold)}/{d.period === 'YEAR' ? 'năm' : 'quý'}{d.brandId ? '' : ' · toàn shop'}</span>
            <button onClick={() => del.mutate(d.id)} className="ml-2 shrink-0 text-xs text-red-600">Xoá</button>
          </div>
        ))}
        {q.data?.length === 0 && <p className="text-xs text-neutral-400">Chưa có chương trình.</p>}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="rounded border border-neutral-200 px-2 py-1 text-sm">
          <option value="TOUR">Tour</option>
          <option value="GIFT">Quà</option>
          <option value="OTHER">Khác</option>
        </select>
        <input placeholder="Tiêu đề (Tour Phú Quốc)" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className="flex-1 rounded border border-neutral-200 px-2 py-1 text-sm" />
        <input type="number" placeholder="Mốc doanh số" value={f.threshold} onChange={(e) => setF({ ...f, threshold: Number(e.target.value) })} className="w-36 rounded border border-neutral-200 px-2 py-1 text-sm" />
        <button onClick={() => create.mutate()} disabled={!f.title.trim()} className="rounded bg-green-600 px-3 py-1 text-sm text-white disabled:bg-neutral-300">Thêm</button>
      </div>
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
