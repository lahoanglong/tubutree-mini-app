'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { StaffRole } from '@tubutree/app-core/api/staff';
import { adminStaffQuery } from '@tubutree/app-core/queries/staff';
import { grantDoneText, grantPermissionsHint } from '@tubutree/app-core/staff-copy';
import { coreHttp } from '@/lib/core-http';
import { usePressLock } from '@/lib/use-press-lock';
import { settleWithin } from '@/lib/settle-within';
import { reloadWhenStale } from '@/lib/stale-write-rejection';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { grantStaffRole, revokeStaffRole, setStaffPermissions, STAFF_PERMISSION_LABELS, STAFF_PERMISSION_SHORT, type StaffPermission } from '@/lib/admin-client';
import { errText } from '@/components/staff/staff-shell';
import { formatDate } from '@/lib/format-date';
import { useConfirm } from './confirm-dialog';
import { BTN_LINK_DANGER, BTN_PRIMARY, chipClass, Field, INPUT_CLASS, Notice, ToneBadge } from './ui';

const PHONE_RE = /^0\d{8,10}$/;
const ROLE_LABEL: Record<StaffRole, string> = { STAFF: 'Nhân viên', ADMIN: 'Quản trị' };
const PERMISSIONS = Object.keys(STAFF_PERMISSION_SHORT) as StaffPermission[];
/** Hạn của lời mời do API trả; kiểu dùng chung (app-core) chưa khai báo trường này nên đọc qua đây. Lời mời cũ không có hạn thì null. */
const inviteExpiry = (p: object): string | null => (p as { expiresAt?: string | null }).expiresAt ?? null;

/** Nhân sự: danh sách người có quyền, cấp quyền theo SĐT (STAFF hoặc ADMIN), thu hồi và huỷ lời mời chờ mở app. */
export function StaffRosterTab({ meId }: { meId?: string } = {}) {
  const qc = useQueryClient();
  const { ask, dialog } = useConfirm();
  const staffQ = useQuery(adminStaffQuery(coreHttp));
  const retryStaff = usePressLock(() => staffQ.refetch());
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<StaffRole>('STAFF');
  const [newPerms, setNewPerms] = useState<StaffPermission[]>([]);
  const [msg, setMsg] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null);
  // Trả lời hứa làm mới để khoá giữ tới khi danh sách nhân sự mới về (tối đa `settleWithin`): nhả sớm thì người vừa thu hồi còn nút "Thu hồi" và bấm lại được.
  // Lệnh bị từ chối 404/409 (người đã mất quyền ở máy khác, lời mời hết hạn) cũng tải lại, vì dòng đang hiện đã cũ; cả ba lệnh đều có ô nhập (SĐT, nhóm việc, lý do) nên 400 là lỗi nhập, chỉ hiện lời lỗi.
  // Quy tắc này chỉ quyết định việc CHỜ tải lại trước khi nhả khoá: trên production MutationCache vẫn làm cũ khoá admin-* ở lỗi khác.
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-staff'] });
  // Lời báo thành công của từng ô nhóm việc nằm ở đây, không ở trong ô: ô dựng lại bằng `key` khi nhóm việc đổi sau lần làm mới.
  const [pickerNotes, setPickerNotes] = useState<Record<string, string>>({});
  // Thêm lại SĐT của người đã là nhân viên: máy chủ thay nhóm cũ bằng nhóm chọn ở đây, nên báo trước nhóm họ đang có.
  const typedPhone = phone.trim();
  const existingStaff = role === 'STAFF' ? staffQ.data?.members.find((m) => m.role === 'STAFF' && m.phone === typedPhone) : undefined;
  const existingNames = existingStaff ? PERMISSIONS.filter((p) => existingStaff.staffPermissions?.includes(p)).map((p) => STAFF_PERMISSION_SHORT[p]) : null;
  // Lời mời đang chờ trùng SĐT: chọn nhóm thì thay nhóm của lời mời, để trống thì lời mời giữ nhóm đã ghi.
  const pendingInvite = role === 'STAFF' && !existingStaff ? staffQ.data?.pendingInvites.find((i) => i.role === 'STAFF' && i.phone === typedPhone) : undefined;
  const pendingNames = pendingInvite ? PERMISSIONS.filter((p) => pendingInvite.staffPermissions?.includes(p)).map((p) => STAFF_PERMISSION_SHORT[p]) : null;

  // Nhóm việc đang gõ và SĐT là chữ khách nhập: chỉ xoá khi vẫn đúng như lúc gửi, để chữ gõ thêm trong lúc chờ không mất.
  const grantM = useLockedMutation({
    // Nhóm việc chỉ có nghĩa với nhân viên; không chọn nhóm nào thì không gửi khoá permissions để máy chủ giữ nguyên nhóm đã lưu.
    mutationFn: async (reason: string) => {
      const to = phone.trim();
      const names = PERMISSIONS.filter((p) => newPerms.includes(p)).map((p) => STAFF_PERMISSION_SHORT[p]);
      const r = await grantStaffRole(to, role, reason, role === 'STAFF' && newPerms.length ? newPerms : undefined);
      return { r, to, names, alreadyStaff: existingNames !== null, sentPerms: newPerms };
    },
    onSuccess: ({ r, to, names, alreadyStaff, sentPerms }) => {
      setMsg({ tone: 'success', text: grantDoneText(r, to, names, alreadyStaff) });
      setPhone((cur) => (cur.trim() === to ? '' : cur));
      setNewPerms((cur) => (cur === sentPerms ? [] : cur));
      return settleWithin(refresh());
    },
    onError: (e) => {
      setMsg({ tone: 'danger', text: errText(e) });
      // SĐT, nhóm việc và lý do do admin nhập: 400 là lỗi nhập (SĐT sai dạng, tự cấp cho chính mình...), chỉ 404/409 tải lại.
      return reloadWhenStale(e, refresh, true);
    },
  });

  const revokeM = useLockedMutation({
    mutationFn: (v: { phone: string; reason: string }) => revokeStaffRole(v.phone, v.reason),
    onSuccess: (res) => {
      setMsg(
        res.storeBlocked
          ? {
              tone: 'warning',
              text: 'Đã gỡ quyền, nhưng gian hàng đối tác của người này còn việc dở nên được giữ nguyên và họ có thể chưa dùng được Cổng người bán. Xử lý ở tab "Đơn đối tác & đối soát" trên web admin xong thì: gian hàng loại CTV tắt quyền đối tác; gian hàng loại MERCHANT không tắt bằng cờ được, hãy đặt lại vai trò cho người này. Hoặc đặt lại vai trò DEALER để giữ nguyên gian hàng.',
            }
          : { tone: 'success', text: 'Đã thu hồi quyền.' },
      );
      return settleWithin(refresh());
    },
    onError: (e) => {
      setMsg({ tone: 'danger', text: errText(e) });
      return reloadWhenStale(e, refresh, true);
    },
  });

  /** Hỏi lý do (bắt buộc, ít nhất 3 ký tự). Trả null khi bỏ qua hoặc lý do quá ngắn (đã báo ở khung thông báo). */
  const askReason = async (opts: { title: string; message: string; confirmLabel: string; cancelLabel?: string; tone?: 'danger'; label: string; placeholder: string }) => {
    const reason = await ask({
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel,
      cancelLabel: opts.cancelLabel,
      tone: opts.tone,
      input: { label: opts.label, placeholder: opts.placeholder, required: true, maxLength: 500 },
    });
    if (reason === null) return null;
    if (reason.length < 3) {
      setMsg({ tone: 'danger', text: 'Lý do cần ít nhất 3 ký tự.' });
      return null;
    }
    return reason;
  };

  // Cấp ADMIN là nâng quyền toàn hệ thống, rủi ro hơn hẳn STAFF nên hộp xác nhận nói rõ hơn.
  const submitGrant = async () => {
    if (grantM.isPending) return;
    setMsg(null);
    const reason = await askReason(
      role === 'ADMIN'
        ? {
            title: 'Cấp quyền ADMIN?',
            message: `Xác nhận cấp quyền ADMIN (toàn quyền quản trị) cho SĐT ${phone.trim()}?`,
            confirmLabel: 'Cấp quyền ADMIN',
            tone: 'danger',
            label: 'Lý do cấp quyền',
            placeholder: 'VD: quản lý mới của công ty',
          }
        : {
            title: 'Cấp quyền nhân viên?',
            message: `Cấp quyền nhân viên cho SĐT ${phone.trim()}?`,
            confirmLabel: 'Cấp quyền',
            label: 'Lý do cấp quyền',
            placeholder: 'VD: nhân viên kho mới vào làm',
          },
    );
    if (reason !== null) grantM.mutate(reason);
  };

  // Hạ quyền nhầm một quản trị viên thì chỉ người còn quyền mới cấp lại được.
  const askRevoke = async (p: string, who: string) => {
    if (revokeM.isPending) return;
    setMsg(null);
    const reason = await askReason({
      title: 'Thu hồi quyền?',
      message: `Thu hồi quyền của ${who}? Người này sẽ mất toàn bộ quyền nhân viên/quản trị.`,
      confirmLabel: 'Thu hồi',
      tone: 'danger',
      label: 'Lý do thu hồi',
      placeholder: 'VD: nhân viên đã nghỉ việc',
    });
    if (reason !== null) revokeM.mutate({ phone: p, reason });
  };

  const askCancelInvite = async (p: string) => {
    if (revokeM.isPending) return;
    setMsg(null);
    const reason = await askReason({
      title: 'Huỷ lời mời?',
      message: `Huỷ lời mời chờ mở app của SĐT ${p}? Muốn cấp lại phải thêm lại từ đầu.`,
      confirmLabel: 'Huỷ lời mời',
      cancelLabel: 'Giữ lời mời',
      tone: 'danger',
      label: 'Lý do huỷ lời mời',
      placeholder: 'VD: nhập nhầm số điện thoại',
    });
    if (reason !== null) revokeM.mutate({ phone: p, reason });
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
            maxLength={11}
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
        {role === 'STAFF' && (
          <div className="space-y-1">
            <div role="group" aria-label="Nhóm việc cho người mới" className="flex flex-wrap gap-2">
              {PERMISSIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={newPerms.includes(p)}
                  onClick={() => setNewPerms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))}
                  className={chipClass(newPerms.includes(p))}
                >
                  {STAFF_PERMISSION_SHORT[p]}
                </button>
              ))}
            </div>
            <p className="text-xs text-stone-500">{grantPermissionsHint(existingNames, pendingNames)}</p>
          </div>
        )}
        <button
          type="submit"
          disabled={!PHONE_RE.test(phone.trim())}
          aria-busy={grantM.isPending || undefined}
          aria-disabled={grantM.isPending || undefined}
          className={BTN_PRIMARY}
        >
          Lưu quyền
        </button>
      </form>

      {staffQ.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {staffQ.isError && (
        <div role="alert" className="text-sm text-danger-fg">
          {errText(staffQ.error)}{' '}
          <button type="button" onClick={retryStaff.press} aria-busy={retryStaff.busy || undefined} aria-disabled={retryStaff.busy || undefined} className="font-medium underline">
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
                  {m.id === meId && <span className="shrink-0 text-xs text-stone-500">(bạn)</span>}
                  {m.phone && m.id !== meId && (
                    <button
                      type="button"
                      aria-label={`Thu hồi · ${m.fullName ?? m.phone}`}
                      aria-busy={(revokeM.isPending && revokeM.variables?.phone === m.phone) || undefined}
                      aria-disabled={revokeM.isPending || undefined}
                      onClick={() => void askRevoke(m.phone as string, m.fullName ?? (m.phone as string))}
                      className={`${BTN_LINK_DANGER} shrink-0`}
                    >
                      Thu hồi
                    </button>
                  )}
                </div>
                {m.role === 'STAFF' && (
                  <PermissionPicker
                    key={`${m.id}:${(m.staffPermissions ?? []).join(',')}`}
                    current={(m.staffPermissions ?? []) as StaffPermission[]}
                    save={async (perms, reason) => (await setStaffPermissions(m.id, perms, reason)).changed}
                    savedText="Đã lưu nhóm việc. Nhân viên thấy mục mới ở lần mở trang kế tiếp."
                    note={pickerNotes[m.id]}
                    onNote={(text) => setPickerNotes((cur) => ({ ...cur, [m.id]: text ?? '' }))}
                    onFail={(text) => setMsg({ tone: 'danger', text })}
                    onSaved={refresh}
                  />
                )}
                {m.role === 'ADMIN' && <p className="text-xs text-stone-500">Quản trị thấy và làm được mọi việc.</p>}
              </li>
            ))}
          </ul>

          {staffQ.data.pendingInvites.length > 0 && (
            <section aria-label="Chờ mở app" className="space-y-2">
              <h3 className="text-sm font-semibold text-stone-900">Chờ mở app</h3>
              <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {staffQ.data.pendingInvites.map((p) => (
                  <li key={p.phone} className="space-y-2 rounded-card border border-stone-200 bg-stone-50 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0">
                        {p.phone} · {ROLE_LABEL[p.role]}
                        {inviteExpiry(p) && <span className="block text-xs text-stone-500">Hết hạn {formatDate(inviteExpiry(p))}</span>}
                      </span>
                      <button
                        type="button"
                        aria-label={`Thu hồi lời mời · ${p.phone}`}
                        aria-busy={(revokeM.isPending && revokeM.variables?.phone === p.phone) || undefined}
                        aria-disabled={revokeM.isPending || undefined}
                        onClick={() => void askCancelInvite(p.phone)}
                        className={`${BTN_LINK_DANGER} shrink-0`}
                      >
                        Thu hồi
                      </button>
                    </div>
                    {p.role === 'STAFF' && (
                      <PermissionPicker
                        key={`${p.phone}:${(p.staffPermissions ?? []).join(',')}`}
                        current={(p.staffPermissions ?? []) as StaffPermission[]}
                        save={async (perms, reason) => {
                          await grantStaffRole(p.phone, 'STAFF', reason, perms);
                          return true;
                        }}
                        savedText="Đã lưu nhóm việc của lời mời. Họ nhận đúng nhóm này khi mở app lần đầu."
                        note={pickerNotes[p.phone]}
                        onNote={(text) => setPickerNotes((cur) => ({ ...cur, [p.phone]: text ?? '' }))}
                        onFail={(text) => setMsg({ tone: 'danger', text })}
                        onSaved={refresh}
                      />
                    )}
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
function PermissionPicker({
  current,
  save: persist,
  savedText,
  note,
  onNote,
  onFail,
  onSaved,
}: {
  current: StaffPermission[];
  /** Lưu danh sách nhóm; trả về có thay đổi thật hay không. */
  save: (perms: StaffPermission[], reason: string) => Promise<boolean>;
  savedText: string;
  /** Lời báo thành công do thẻ cha giữ: ô này bị dựng lại (đổi `key`) ngay khi nhóm việc mới về, state của chính nó sẽ mất. */
  note: string | undefined;
  onNote: (text: string | null) => void;
  /** Lời lỗi đi lên khung thông báo chung: dòng này có thể biến mất khi danh sách tải lại sau lệnh bị từ chối. */
  onFail: (text: string) => void;
  onSaved: () => Promise<unknown>;
}) {
  const [perms, setPerms] = useState<StaffPermission[]>(current);
  const { ask, dialog } = useConfirm();
  // Giữ tới khi danh sách nhân sự mới về (tối đa `settleWithin`); lệnh bị từ chối vì dòng đã cũ thì tải lại rồi mới nhả.
  const save = useLockedMutation({
    mutationFn: (v: { reason: string; perms: StaffPermission[] }) => persist(v.perms, v.reason),
    onSuccess: (changed) => {
      onNote(changed ? savedText : 'Không có gì thay đổi.');
      return settleWithin(onSaved());
    },
    onError: (e) => {
      onFail(errText(e));
      return reloadWhenStale(e, onSaved, true);
    },
  });
  const dirty = [...perms].sort().join(',') !== [...current].sort().join(',');
  const askSave = async () => {
    if (save.isPending) return;
    onNote(null);
    const reason = await ask({
      title: 'Lưu nhóm việc',
      message: 'Đổi nhóm việc? Bỏ tick là mất quyền ngay.',
      confirmLabel: 'Lưu nhóm việc',
      input: { label: 'Lý do đổi nhóm việc', placeholder: 'VD: chuyển sang phụ trách kho', required: true, maxLength: 500 },
    });
    if (reason === null) return;
    if (reason.length < 3) {
      onFail('Lý do cần ít nhất 3 ký tự.');
      return;
    }
    save.mutate({ reason, perms });
  };
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-semibold text-stone-700">Nhóm việc</legend>
      <p className="text-xs text-stone-500">Không chọn nhóm nào: chỉ dùng quầy thu ngân, Đổi rác và chấm công.</p>
      {PERMISSIONS.map((p) => (
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
      {/* Đang lưu giữ aria-busy/aria-disabled chứ không `disabled`: nút đang giữ focus mà bị vô hiệu thì Chromium thả focus về body. Chưa đổi gì thì vẫn disabled thật. */}
      <button
        type="button"
        disabled={!dirty}
        aria-busy={save.isPending || undefined}
        aria-disabled={save.isPending || undefined}
        onClick={() => void askSave()}
        className={`${BTN_PRIMARY} aria-disabled:opacity-60`}
      >
        {save.isPending ? 'Đang lưu…' : 'Lưu nhóm việc'}
      </button>
      {note && (
        <Notice tone="success" role="status">
          {note}
        </Notice>
      )}
      {dialog}
    </fieldset>
  );
}
