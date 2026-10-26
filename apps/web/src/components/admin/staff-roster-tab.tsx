'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { grantStaff, revokeStaff, type StaffRole } from '@tubutree/app-core/api/staff';
import { adminStaffQuery } from '@tubutree/app-core/queries/staff';
import { coreHttp } from '@/lib/core-http';
import { setStaffPermissions, STAFF_PERMISSION_LABELS, STAFF_PERMISSION_SHORT, type StaffPermission } from '@/lib/admin-client';
import { errText } from '@/components/staff/staff-shell';
import { useConfirm } from './confirm-dialog';
import { BTN_LINK_DANGER, BTN_PRIMARY, chipClass, Field, INPUT_CLASS, Notice, ToneBadge } from './ui';

const PHONE_RE = /^0\d{8,10}$/;
const ROLE_LABEL: Record<StaffRole, string> = { STAFF: 'Nhân viên', ADMIN: 'Quản trị' };

/** Nhân sự: danh sách người có quyền, cấp quyền theo SĐT (STAFF hoặc ADMIN), thu hồi và huỷ lời mời chờ mở app. */
export function StaffRosterTab() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const staffQ = useQuery(adminStaffQuery(coreHttp));
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<StaffRole>('STAFF');
  const [msg, setMsg] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin-staff'] });

  const grantM = useMutation({
    mutationFn: () => grantStaff(coreHttp, phone.trim(), role),
    onSuccess: (r) => {
      setMsg({ tone: 'success', text: r.applied ? 'Đã cấp quyền & áp ngay.' : 'Đã lưu quyền (sẽ áp khi họ mở app).' });
      setPhone('');
      refresh();
    },
    onError: (e) => setMsg({ tone: 'danger', text: errText(e) }),
  });

  const revokeM = useMutation({
    mutationFn: (p: string) => revokeStaff(coreHttp, p),
    onSuccess: (res) => {
      setMsg(
        res.storeBlocked
          ? {
              tone: 'warning',
              text: 'Đã gỡ quyền, nhưng gian hàng đối tác của người này còn việc dở nên được giữ nguyên và họ có thể chưa dùng được Cổng người bán. Xử lý ở tab "Đơn đối tác & đối soát" trên web admin xong thì: gian hàng loại CTV tắt cờ đối tác; gian hàng loại MERCHANT không tắt bằng cờ được, hãy đặt lại vai trò cho người này. Hoặc đặt lại vai trò DEALER để giữ nguyên gian hàng.',
            }
          : { tone: 'success', text: 'Đã thu hồi quyền.' },
      );
      refresh();
    },
    onError: (e) => setMsg({ tone: 'danger', text: errText(e) }),
  });

  // Cấp ADMIN là nâng quyền toàn hệ thống, rủi ro hơn hẳn STAFF nên hỏi thêm một bước.
  const submitGrant = async () => {
    if (role === 'ADMIN') {
      const ok = await confirm({
        title: 'Cấp quyền ADMIN?',
        message: `Xác nhận cấp quyền ADMIN (toàn quyền quản trị) cho SĐT ${phone.trim()}?`,
        confirmLabel: 'Cấp quyền ADMIN',
        tone: 'danger',
      });
      if (!ok) return;
    }
    grantM.mutate();
  };

  // Hạ quyền nhầm một quản trị viên thì chỉ người còn quyền mới cấp lại được.
  const askRevoke = async (p: string, who: string) => {
    const ok = await confirm({
      title: 'Thu hồi quyền?',
      message: `Thu hồi quyền của ${who}? Người này sẽ mất toàn bộ quyền nhân viên/quản trị.`,
      confirmLabel: 'Thu hồi',
      tone: 'danger',
    });
    if (ok) revokeM.mutate(p);
  };

  const askCancelInvite = async (p: string) => {
    const ok = await confirm({
      title: 'Huỷ lời mời?',
      message: `Huỷ lời mời chờ mở app của SĐT ${p}? Muốn cấp lại phải thêm lại từ đầu.`,
      confirmLabel: 'Huỷ lời mời',
      cancelLabel: 'Giữ lời mời',
      tone: 'danger',
    });
    if (ok) revokeM.mutate(p);
  };

  return (
    <div className="space-y-4">
      {dialog}
      <h2 className="font-display text-lg font-semibold text-stone-900">Nhân sự</h2>
      {msg && (
        <Notice tone={msg.tone} role={msg.tone === 'danger' ? 'alert' : 'status'}>
          {msg.text}
        </Notice>
      )}

      <form
        className="space-y-3 rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card"
        onSubmit={(e) => {
          e.preventDefault();
          void submitGrant();
        }}
      >
        <h3 className="text-sm font-semibold text-stone-900">Thêm nhân sự theo SĐT</h3>
        <Field label="Số điện thoại">
          <input
            type="tel"
            inputMode="numeric"
            placeholder="Số điện thoại (VD 09xxxxxxxx)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
        <div role="group" aria-label="Vai trò" className="flex flex-wrap gap-2">
          {(['STAFF', 'ADMIN'] as const).map((r) => (
            <button key={r} type="button" aria-pressed={role === r} onClick={() => setRole(r)} className={chipClass(role === r)}>
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        <button type="submit" disabled={!PHONE_RE.test(phone.trim()) || grantM.isPending} className={BTN_PRIMARY}>
          Lưu quyền
        </button>
      </form>

      {staffQ.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {staffQ.isError && (
        <div role="alert" className="text-sm text-danger-fg">
          {errText(staffQ.error)}{' '}
          <button type="button" onClick={() => void staffQ.refetch()} className="font-medium underline">
            Thử lại
          </button>
        </div>
      )}

      {staffQ.data && (
        <>
          {staffQ.data.members.length === 0 && <p className="text-sm text-stone-500">Chưa có nhân sự. Nhập số điện thoại ở trên để cấp quyền.</p>}
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {staffQ.data.members.map((m) => (
              <li key={m.id} className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 text-sm">
                    <div className="break-words font-medium text-stone-900">{m.fullName ?? 'Chưa có tên'}</div>
                    <div className="text-xs text-stone-600">
                      {m.phone ?? '—'} · <ToneBadge tone={m.role === 'ADMIN' ? 'warning' : 'neutral'}>{ROLE_LABEL[m.role]}</ToneBadge>
                    </div>
                  </div>
                  {m.phone && (
                    <button
                      type="button"
                      aria-label={`Thu hồi · ${m.fullName ?? m.phone}`}
                      disabled={revokeM.isPending}
                      onClick={() => void askRevoke(m.phone as string, m.fullName ?? (m.phone as string))}
                      className={`${BTN_LINK_DANGER} shrink-0`}
                    >
                      Thu hồi
                    </button>
                  )}
                </div>
                {m.role === 'STAFF' && <PermissionPicker key={`${m.id}:${(m.staffPermissions ?? []).join(',')}`} userId={m.id} current={(m.staffPermissions ?? []) as StaffPermission[]} onSaved={refresh} />}
                {m.role === 'ADMIN' && <p className="text-xs text-stone-500">Quản trị thấy và làm được mọi việc.</p>}
              </li>
            ))}
          </ul>

          {staffQ.data.pendingInvites.length > 0 && (
            <section aria-label="Chờ mở app" className="space-y-2">
              <h3 className="text-sm font-semibold text-stone-900">Chờ mở app</h3>
              <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {staffQ.data.pendingInvites.map((p) => (
                  <li key={p.phone} className="flex items-center justify-between gap-2 rounded-card border border-stone-200 bg-stone-50 p-3 text-sm">
                    <span>
                      {p.phone} · {ROLE_LABEL[p.role]}
                    </span>
                    <button
                      type="button"
                      aria-label={`Huỷ lời mời · ${p.phone}`}
                      disabled={revokeM.isPending}
                      onClick={() => void askCancelInvite(p.phone)}
                      className={BTN_LINK_DANGER}
                    >
                      Huỷ
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** Nhóm việc quyết định nhân viên thấy mục nào và gọi được việc nào; máy chủ kiểm lại từng lần gọi nên bỏ tick là mất quyền ngay. */
function PermissionPicker({ userId, current, onSaved }: { userId: string; current: StaffPermission[]; onSaved: () => void }) {
  const [perms, setPerms] = useState<StaffPermission[]>(current);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const save = useMutation({
    mutationFn: () => setStaffPermissions(userId, perms),
    onSuccess: (r) => {
      setMsg({ tone: 'success', text: r.changed ? 'Đã lưu nhóm việc. Nhân viên thấy mục mới ở lần mở trang kế tiếp.' : 'Không có gì thay đổi.' });
      onSaved();
    },
    onError: (e) => setMsg({ tone: 'danger', text: errText(e) }),
  });
  const dirty = [...perms].sort().join(',') !== [...current].sort().join(',');
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-semibold text-stone-700">Nhóm việc</legend>
      <p className="text-xs text-stone-500">Không chọn nhóm nào: chỉ dùng quầy thu ngân, Đổi rác và chấm công.</p>
      {(Object.keys(STAFF_PERMISSION_SHORT) as StaffPermission[]).map((p) => (
        <label key={p} className="flex min-h-[44px] items-start gap-2 py-1 text-sm sm:min-h-[32px]">
          <input
            type="checkbox"
            checked={perms.includes(p)}
            onChange={(e) => setPerms((cur) => (e.target.checked ? [...cur, p] : cur.filter((x) => x !== p)))}
            className="mt-0.5 h-4 w-4 shrink-0 accent-forest-600"
          />
          <span className="min-w-0">
            <span className="font-medium text-stone-900">{STAFF_PERMISSION_SHORT[p]}</span>
            <span className="block break-words text-xs text-stone-500">{STAFF_PERMISSION_LABELS[p].split(' — ')[1]}</span>
          </span>
        </label>
      ))}
      <button type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate()} className={BTN_PRIMARY}>
        {save.isPending ? 'Đang lưu…' : 'Lưu nhóm việc'}
      </button>
      {msg && (
        <Notice tone={msg.tone} role={msg.tone === 'danger' ? 'alert' : 'status'}>
          {msg.text}
        </Notice>
      )}
    </fieldset>
  );
}
