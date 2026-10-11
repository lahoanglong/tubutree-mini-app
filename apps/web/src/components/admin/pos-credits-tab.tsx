'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { listPosCredits, type AdminPosCredit } from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';
import { vnDayKey } from '@/lib/loyalty-pos';
import { personLabel } from '@/lib/admin-pickers';
import type { PickedItem } from './search-picker';
import { UserPicker } from './user-picker';
import { BTN_XS_SECONDARY, INPUT_CLASS, TOUCH_H } from './ui';

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
  const [staff, setStaff] = useState<PickedItem | null>(null);
  const [member, setMember] = useState<PickedItem | null>(null);
  const staffUserId = staff?.id ?? '';
  const memberId = member?.id ?? '';
  const q = useQuery({
    queryKey: ['admin-pos-credits', day, staffUserId, memberId],
    queryFn: () => listPosCredits({ day: day || undefined, staffUserId, memberId }),
  });
  const sum = summarizePosCredits(q.data ?? []);
  const filtered = !!(staffUserId || memberId);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-stone-900">Sổ tích điểm tại quầy</h2>
        <Link
          href="/admin/pos"
          className={`inline-flex items-center ${TOUCH_H} rounded-control bg-forest-600 px-3 py-1.5 text-xs font-medium text-stone-0 hover:bg-forest-700`}
        >
          Mở màn thu ngân
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-card border border-stone-200 bg-stone-0 p-3">
        <label className="text-xs">
          <span className="font-medium text-stone-700">Ngày (giờ VN)</span>
          <input type="date" className={`${INPUT_CLASS} mt-1 w-40`} value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
        <div className="w-full text-xs sm:w-64">
          <span className="font-medium text-stone-700">Nhân viên</span>
          <UserPicker className="mt-1 w-full" label="Lọc theo nhân viên" value={staff} onChange={setStaff} />
        </div>
        <div className="w-full text-xs sm:w-64">
          <span className="font-medium text-stone-700">Thành viên</span>
          <UserPicker className="mt-1 w-full" label="Lọc theo thành viên" value={member} onChange={setMember} />
        </div>
        {(filtered || day) && (
          <button
            type="button"
            onClick={() => {
              setDay('');
              setStaff(null);
              setMember(null);
            }}
            className={BTN_XS_SECONDARY}
          >
            Xoá lọc (xem mọi ngày)
          </button>
        )}
      </div>

      {q.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {q.isError && <p className="text-sm text-danger-fg">{q.error instanceof Error ? q.error.message : 'Không tải được sổ tích điểm.'}</p>}
      {q.data && (
        <>
          <p className="text-xs text-stone-600">
            <b>{sum.count}</b> hoá đơn · <b>{sum.points.toLocaleString('vi-VN')}</b> điểm · doanh thu quầy{' '}
            <b>{formatVnd(sum.orderTotal)}</b>
            {sum.count >= 200 && ' · chỉ hiển thị 200 dòng mới nhất, lọc hẹp hơn để xem đủ'}
          </p>
          <div className="overflow-x-auto rounded-card border border-stone-200 bg-stone-0">
            <table className="w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs text-stone-500">
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
                    <td colSpan={6} className="py-6 text-center text-xs text-stone-500">
                      Chưa có lượt tích điểm tại quầy nào{day ? ` ngày ${day}` : ''}.
                    </td>
                  </tr>
                ) : (
                  q.data.map((r) => (
                    <tr key={r.id} className="border-t border-stone-200 align-top">
                      <td className="px-3 py-2 text-xs text-stone-500">{new Date(r.createdAt).toLocaleString('vi-VN')}</td>
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs font-semibold">{r.receiptId}</div>
                        {r.note && <div className="text-[11px] text-stone-500">{r.note}</div>}
                      </td>
                      <td className="px-3 py-2">
                        <button type="button" className="min-h-[44px] text-left hover:underline sm:min-h-0" onClick={() => setMember({ id: r.member.id, label: personLabel(r.member.name, r.member.phone, 'Thành viên') })} title="Lọc theo thành viên này">
                          <div className="font-medium">{r.member.name ?? 'Thành viên'}</div>
                          <div className="text-[11px] text-stone-500">
                            {r.member.memberCode}
                            {r.member.phone ? ` · ${r.member.phone}` : ''}
                          </div>
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <button type="button" className="min-h-[44px] text-left hover:underline sm:min-h-0" onClick={() => setStaff({ id: r.staff.id, label: personLabel(r.staff.name, r.staff.phone, 'Nhân viên') })} title="Lọc theo nhân viên này">
                          <div className="font-medium">{r.staff.name ?? 'Nhân viên'}</div>
                          {r.staff.phone && <div className="text-[11px] text-stone-500">{r.staff.phone}</div>}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right">{formatVnd(r.orderTotal)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-forest-700">
                        +{r.points}
                        {r.multiplier !== 1 && <div className="text-[11px] font-normal text-stone-500">×{r.multiplier}</div>}
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
