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
  type ConfigRow,
} from '@/lib/admin-client';

type Tab = 'dealers' | 'orders' | 'users' | 'config' | 'coupons';
const TABS: { k: Tab; label: string }[] = [
  { k: 'dealers', label: 'Đại lý' },
  { k: 'orders', label: 'Đơn hàng' },
  { k: 'users', label: 'Người dùng' },
  { k: 'config', label: 'Cấu hình' },
  { k: 'coupons', label: 'Voucher' },
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
