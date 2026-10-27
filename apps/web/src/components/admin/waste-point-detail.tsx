'use client';

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cashWordingMessage, findCashWording, type AdminWastePointDTO, type WastePointStaffRole } from '@tubutree/shared-types';
import {
  addWastePointStaff,
  approveWastePerk,
  clearWastePerk,
  getWastePointReport,
  listWasteRequests,
  rejectWastePerk,
  removeWastePointStaff,
} from '@/lib/admin-client';
import { ApiError } from '@/lib/client-api';
import { formatCount } from '@/lib/checkout-points';
import { formatDate, formatDateTime } from '@/lib/format-date';
import { useConfirm } from './confirm-dialog';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_XS_DANGER, BTN_XS_SECONDARY, FIELD_CLASS, Field, INPUT_CLASS, Notice, ScrollRegion, ToneBadge, LoadError } from './ui';
import type { PickedItem } from './search-picker';
import { UserPicker } from './user-picker';

const MAX_STAFF = 5;
const ROLE_LABELS: Record<WastePointStaffRole, string> = { OWNER: 'Chủ điểm', STAFF: 'Nhân viên' };
const TH = 'px-2 py-2 text-left text-xs font-medium text-stone-600';
const TD = 'px-2 py-2 align-top text-sm text-stone-800';

/** Tháng hiện tại theo giờ Việt Nam dạng yyyy-MM, ghép từ formatDate (dd/MM/yyyy) để không dùng API định dạng ngày. */
function currentMonthKey(): string {
  const [, mm, yyyy] = formatDate(Date.now()).split('/');
  return `${yyyy}-${mm}`;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Thao tác thất bại.');

export function WastePointDetail({
  point,
  onClose,
  searchDebounceMs,
}: {
  point: AdminWastePointDTO;
  onClose: () => void;
  searchDebounceMs?: number;
}) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [picked, setPicked] = useState<PickedItem | null>(null);
  const [role, setRole] = useState<WastePointStaffRole>('STAFF');
  const [month, setMonth] = useState(currentMonthKey);
  const [err, setErr] = useState<string | null>(null);

  const activeStaff = point.staff.filter((s) => s.isActive);
  const hasOwner = activeStaff.some((s) => s.role === 'OWNER');
  const full = activeStaff.length >= MAX_STAFF;
  const isPartner = point.kind === 'PARTNER';

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-ops-inbox'] });
    return qc.invalidateQueries({ queryKey: ['admin-waste-points'] });
  };
  const onError = (e: unknown) => setErr(errText(e));
  const onPerkError = (e: unknown) => {
    setErr(errText(e));
    if (e instanceof ApiError && e.status === 409) void refresh();
  };

  const add = useMutation({
    mutationFn: (v: { userId: string; role: WastePointStaffRole }) => addWastePointStaff(point.id, v),
    onSuccess: () => { setErr(null); setPicked(null); setRole('STAFF'); return refresh(); },
    onError,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => removeWastePointStaff(point.id, userId),
    onSuccess: () => { setErr(null); return refresh(); },
    onError,
  });
  const approve = useMutation({
    mutationFn: (expectedPendingText: string) => approveWastePerk(point.id, expectedPendingText),
    onSuccess: () => { setErr(null); return refresh(); },
    onError: onPerkError,
  });
  const reject = useMutation({
    mutationFn: (expectedPendingText: string) => rejectWastePerk(point.id, expectedPendingText),
    onSuccess: () => { setErr(null); return refresh(); },
    onError: onPerkError,
  });

  const clear = useMutation({
    mutationFn: () => clearWastePerk(point.id),
    onSuccess: () => { setErr(null); return refresh(); },
    onError,
  });

  const credits = useInfiniteQuery({
    queryKey: ['admin-waste-requests', { status: 'COMPLETED', pointId: point.id }],
    queryFn: ({ pageParam }) => listWasteRequests({ status: 'COMPLETED', pointId: point.id, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const report = useQuery({
    queryKey: ['admin-waste-point-report', point.id, month],
    queryFn: () => getWastePointReport(point.id, month),
    enabled: month !== '',
  });
  const creditRows = (credits.data?.pages ?? []).flatMap((p) => p.rows);

  const askRemove = async (userId: string, name: string, staffRole: WastePointStaffRole) => {
    const hasPerk = point.perkText !== null || point.perkPendingText !== null;
    const ok = await confirm({
      title: 'Gỡ người khỏi điểm',
      message:
        staffRole === 'OWNER'
          ? `Gỡ chủ điểm sẽ dừng cả điểm: khách không thấy điểm, người ở điểm không xác nhận được cho tới khi thêm chủ mới.${hasPerk ? ' Ưu đãi của điểm cũng được gỡ.' : ''}`
          : `${name} không còn xác nhận được ở ${point.name}.`,
      confirmLabel: 'Gỡ',
      tone: 'danger',
    });
    if (ok) remove.mutate(userId);
  };
  const askPerk = async (kind: 'approve' | 'reject') => {
    const text = point.perkPendingText;
    if (!text) return;
    const ok = await confirm(
      kind === 'approve'
        ? { title: 'Duyệt ưu đãi riêng', message: `Ưu đãi "${text}" sẽ hiện cho khách ở ${point.name}.`, confirmLabel: 'Duyệt' }
        : { title: 'Từ chối ưu đãi riêng', message: `Ưu đãi "${text}" sẽ không hiện cho khách ở ${point.name}.`, confirmLabel: 'Từ chối', tone: 'danger' },
    );
    if (ok) (kind === 'approve' ? approve : reject).mutate(text);
  };

  const askClear = async () => {
    const ok = await confirm({
      title: 'Gỡ ưu đãi đang hiện',
      message:
        `Ưu đãi "${point.perkText}" sẽ không còn hiện cho khách ở ${point.name}.` +
        (point.perkPendingText !== null ? ` Ưu đãi đang chờ duyệt "${point.perkPendingText}" cũng bị bỏ.` : ''),
      confirmLabel: 'Gỡ ưu đãi',
      tone: 'danger',
    });
    if (ok) clear.mutate();
  };

  return (
    <section data-point-detail={point.id} className="space-y-4 rounded-control border border-stone-200 bg-stone-0 p-4" aria-label={`Chi tiết ${point.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-stone-900">{`Chi tiết ${point.name}`}</h3>
        <button type="button" className={BTN_SECONDARY} onClick={onClose}>Đóng</button>
      </div>
      {err && <Notice tone="danger" role="alert">{err}</Notice>}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-stone-900">Người ở điểm</h3>
        {isPartner ? (
          <>
            <ScrollRegion label="Người ở điểm">
              <table className="w-full min-w-[520px] border-collapse">
                <thead>
                  <tr className="border-b border-stone-200">
                    <th className={TH}>Họ tên</th>
                    <th className={TH}>Số điện thoại</th>
                    <th className={TH}>Vai</th>
                    <th className={TH}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {point.staff.map((s) => (
                    <tr key={s.userId} data-staff={s.userId} className="border-b border-stone-100">
                      <td className={TD}>{s.fullName ?? '—'}</td>
                      <td className={TD}>{s.phone ?? '—'}</td>
                      <td className={TD}>
                        <div className="flex flex-wrap items-center gap-1">
                          <span>{ROLE_LABELS[s.role]}</span>
                          {!s.isActive && <ToneBadge tone="neutral">Đã gỡ</ToneBadge>}
                        </div>
                      </td>
                      <td className={TD}>
                        {s.isActive && (
                          <button type="button" className={BTN_XS_DANGER} disabled={remove.isPending} onClick={() => void askRemove(s.userId, s.fullName ?? 'Người này', s.role)}>
                            Gỡ
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1">
                <Field label="Người dùng">
                  <UserPicker value={picked} onChange={setPicked} label="Người dùng" debounceMs={searchDebounceMs} />
                </Field>
              </div>
              <Field label="Vai">
                <select name="staffRole" className={FIELD_CLASS} value={role} onChange={(e) => setRole(e.target.value as WastePointStaffRole)}>
                  <option value="STAFF">{ROLE_LABELS.STAFF}</option>
                  <option value="OWNER" disabled={hasOwner}>{hasOwner ? 'Điểm đã có chủ điểm; gỡ chủ cũ trước' : ROLE_LABELS.OWNER}</option>
                </select>
              </Field>
              <button
                type="button"
                className={BTN_PRIMARY}
                disabled={!picked || full || add.isPending || (role === 'OWNER' && hasOwner)}
                onClick={() => picked && add.mutate({ userId: picked.id, role })}
              >
                Thêm người
              </button>
            </div>
            {full && <p className="text-xs text-warning-fg">Tối đa 5 người ở một điểm</p>}
            <p className="text-xs text-stone-600">Chỉ admin gắn người ở điểm. Chủ điểm phải là chủ gian hàng đối tác.</p>
          </>
        ) : (
          <p className="text-sm text-stone-700">Kho phân quyền theo vai trò nhân viên, không gắn người ở điểm.</p>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-stone-900">Ưu đãi riêng</h3>
        <p className="text-sm text-stone-800">{point.perkText ?? 'Chưa có'}</p>
        {point.perkText && findCashWording(point.perkText) !== null && (
          <Notice tone="warning" role="status">
            Ưu đãi này đã được duyệt trước khi có luật mới và có chữ thưởng hay trả bằng tiền. Khách vẫn đang thấy nó. Hãy xem lại, nếu không phù hợp thì bấm
            &quot;Gỡ ưu đãi đang hiện&quot; (hoặc nhờ chủ điểm gửi lại bản mới để duyệt).
          </Notice>
        )}
        {point.perkText && (
          <div>
            <button type="button" className={BTN_XS_DANGER} disabled={clear.isPending} onClick={() => void askClear()}>Gỡ ưu đãi đang hiện</button>
          </div>
        )}
        {point.perkPendingText && (
          <div className="space-y-2">
            <Notice tone="warning">
              <span className="block font-medium">Chờ duyệt</span>
              <span className="block">{point.perkPendingText}</span>
            </Notice>
            <p className="text-xs text-stone-600">
              Chỉ duyệt ưu đãi bằng giảm giá hoặc quà. Zalo không cho thưởng hay trả bằng tiền, nên không duyệt chữ như tiền mặt, chuyển khoản, hoàn tiền, thưởng tiền, &quot;tặng 10k&quot;.
            </p>
            {findCashWording(point.perkPendingText) !== null && (
              <Notice tone="danger" role="alert">
                Ưu đãi này có chữ nói về tiền. {cashWordingMessage(point.perkPendingText)} Hãy từ chối ưu đãi này.
              </Notice>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BTN_PRIMARY} disabled={approve.isPending || reject.isPending || findCashWording(point.perkPendingText) !== null} onClick={() => void askPerk('approve')}>Duyệt ưu đãi</button>
              <button type="button" className={BTN_SECONDARY} disabled={approve.isPending || reject.isPending} onClick={() => void askPerk('reject')}>Từ chối ưu đãi</button>
            </div>
          </div>
        )}
        <p className="text-xs text-stone-600">Ưu đãi do cửa hàng tự chịu, không liên quan Điểm Xanh.</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-stone-900">Nhật ký cộng điểm</h3>
        {credits.isError && <LoadError onRetry={() => void credits.refetch()} retrying={credits.isFetching}>Không tải được nhật ký cộng điểm.</LoadError>}
        <ScrollRegion label="Nhật ký cộng điểm">
          <table className="w-full min-w-[520px] border-collapse">
            <thead>
              <tr className="border-b border-stone-200">
                <th className={TH}>Mã</th>
                <th className={TH}>Khách</th>
                <th className={TH}>Điểm</th>
                <th className={TH}>Hoàn tất lúc</th>
              </tr>
            </thead>
            <tbody>
              {creditRows.map((r) => (
                <tr key={r.id} className="border-b border-stone-100">
                  <td className={TD}>{r.code}</td>
                  <td className={TD}>{r.customerName}</td>
                  <td className={TD}>{r.pointsAwarded === null ? '—' : `${formatCount(r.pointsAwarded)} điểm`}</td>
                  <td className={TD}>{r.completedAt ? formatDateTime(r.completedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
        {credits.isSuccess && creditRows.length === 0 && <p className="text-sm text-stone-600">Chưa có lượt cộng điểm nào.</p>}
        {credits.hasNextPage && (
          <button type="button" className={BTN_XS_SECONDARY} disabled={credits.isFetchingNextPage} onClick={() => void credits.fetchNextPage()}>
            Xem thêm
          </button>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-stone-900">Số lượng trong tháng</h3>
        <Field label="Tháng">
          <input type="month" className={`${INPUT_CLASS} max-w-[200px]`} value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        {report.isError && <LoadError onRetry={() => void report.refetch()} retrying={report.isFetching}>Không tải được số lượng trong tháng.</LoadError>}
        {report.data && (
          <div className="space-y-1 text-sm text-stone-800">
            <ul className="list-disc pl-5">
              {report.data.units.map((u) => <li key={u.itemId}>{`${u.itemName}: ${formatCount(u.qty)} ${u.unitLabel}`}</li>)}
            </ul>
            <p>{`${formatCount(report.data.confirmations)} lượt xác nhận`}</p>
            <p>{`${formatCount(report.data.pointsAwarded)} điểm đã cộng`}</p>
          </div>
        )}
      </div>
      {dialog}
    </section>
  );
}
