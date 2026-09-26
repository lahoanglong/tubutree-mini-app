'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { listPosCredits, type AdminPosCredit } from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';
import { vnDayKey } from '@/lib/loyalty-pos';
import { INPUT_CLASS } from './ui';

/** Tổng hợp nhanh cho dòng tóm tắt đầu bảng. */
export function summarizePosCredits(rows: AdminPosCredit[]) {
  return rows.reduce(
    (s, r) => ({ count: s.count + 1, points: s.points + r.points, orderTotal: s.orderTotal + r.orderTotal }),
    { count: 0, points: 0, orderTotal: 0 },
  );
}

/**
 * Sổ tích điểm tại quầy (ADMIN): ai cộng, cho ai, hoá đơn nào, bao nhiêu điểm. Lọc theo ngày giờ VN,
 * nhân viên, thành viên — bấm tên trong bảng để lọc theo người đó. API trả tối đa 200 dòng mới nhất.
 */
export function PosCreditsTab() {
  const [day, setDay] = useState(() => vnDayKey());
  const [staffUserId, setStaffUserId] = useState('');
  const [memberId, setMemberId] = useState('');
  const q = useQuery({
    queryKey: ['admin-pos-credits', day, staffUserId, memberId],
    queryFn: () => listPosCredits({ day: day || undefined, staffUserId, memberId }),
  });
  const sum = summarizePosCredits(q.data ?? []);
  const filtered = !!(staffUserId || memberId);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-neutral-900">Sổ tích điểm tại quầy</h2>
        <Link href="/admin/pos" className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700">
          Mở màn thu ngân
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-3">
        <label className="text-xs">
          <span className="font-medium text-neutral-700">Ngày (giờ VN)</span>
          <input type="date" className={`${INPUT_CLASS} mt-1 w-40`} value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="font-medium text-neutral-700">Mã nhân viên</span>
          <input
            className={`${INPUT_CLASS} mt-1 w-56 font-mono`}
            placeholder="userId nhân viên"
            value={staffUserId}
            maxLength={40}
            onChange={(e) => setStaffUserId(e.target.value.trim())}
          />
        </label>
        <label className="text-xs">
          <span className="font-medium text-neutral-700">Mã thành viên</span>
          <input
            className={`${INPUT_CLASS} mt-1 w-56 font-mono`}
            placeholder="userId thành viên"
            value={memberId}
            maxLength={40}
            onChange={(e) => setMemberId(e.target.value.trim())}
          />
        </label>
        {(filtered || day) && (
          <button
            type="button"
            onClick={() => {
              setDay('');
              setStaffUserId('');
              setMemberId('');
            }}
            className="rounded border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
          >
            Xoá lọc (xem mọi ngày)
          </button>
        )}
      </div>

      {q.isLoading && <p className="text-sm text-neutral-500">Đang tải…</p>}
      {q.isError && <p className="text-sm text-red-600">{q.error instanceof Error ? q.error.message : 'Không tải được sổ tích điểm.'}</p>}
      {q.data && (
        <>
          <p className="text-xs text-neutral-600">
            <b>{sum.count}</b> hoá đơn · <b>{sum.points.toLocaleString('vi-VN')}</b> điểm · doanh thu quầy{' '}
            <b>{formatVnd(sum.orderTotal)}</b>
            {sum.count >= 200 && ' · chỉ hiển thị 200 dòng mới nhất, lọc hẹp hơn để xem đủ'}
          </p>
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Thời gian</th>
                  <th className="px-3 py-2 font-medium">Hoá đơn</th>
                  <th className="px-3 py-2 font-medium">Thành viên</th>
                  <th className="px-3 py-2 font-medium">Nhân viên</th>
                  <th className="px-3 py-2 text-right font-medium">Tổng tiền</th>
                  <th className="px-3 py-2 text-right font-medium">Điểm</th>
                </tr>
              </thead>
              <tbody>
                {q.data.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-xs text-neutral-400">
                      Chưa có lượt tích điểm tại quầy nào{day ? ` ngày ${day}` : ''}.
                    </td>
                  </tr>
                ) : (
                  q.data.map((r) => (
                    <tr key={r.id} className="border-t border-neutral-100 align-top">
                      <td className="px-3 py-2 text-xs text-neutral-500">{new Date(r.createdAt).toLocaleString('vi-VN')}</td>
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs font-semibold">{r.receiptId}</div>
                        {r.note && <div className="text-[11px] text-neutral-500">{r.note}</div>}
                      </td>
                      <td className="px-3 py-2">
                        <button type="button" className="text-left hover:underline" onClick={() => setMemberId(r.member.id)} title="Lọc theo thành viên này">
                          <div className="font-medium">{r.member.name ?? 'Thành viên'}</div>
                          <div className="text-[11px] text-neutral-500">
                            {r.member.memberCode}
                            {r.member.phone ? ` · ${r.member.phone}` : ''}
                          </div>
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <button type="button" className="text-left hover:underline" onClick={() => setStaffUserId(r.staff.id)} title="Lọc theo nhân viên này">
                          <div className="font-medium">{r.staff.name ?? 'Nhân viên'}</div>
                          {r.staff.phone && <div className="text-[11px] text-neutral-500">{r.staff.phone}</div>}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right">{formatVnd(r.orderTotal)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-green-700">
                        +{r.points}
                        {r.multiplier !== 1 && <div className="text-[11px] font-normal text-neutral-500">×{r.multiplier}</div>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
