'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getSupportBridge,
  listSupportGroups,
  logoutSupportBridge,
  reconnectSupportBridge,
  startSupportQr,
  testSupportBridge,
  updateSupportSettings,
  type SupportBridgeStatus,
  type SupportQrState,
} from '@/lib/admin-client';
import { isoToVnHHMM } from '@/lib/week';
import type { Tone } from '@/lib/recycling';
import { useConfirm } from '../confirm-dialog';
import { BTN_DANGER_OUTLINE, BTN_PRIMARY, BTN_SECONDARY, FIELD_CLASS, LoadError, Notice, ToneBadge } from '../ui';
import { QrModal } from './qr-modal';

export const BRIDGE_QUERY_KEY = ['admin-support-bridge'];

const ENABLE_RISK =
  'Tài khoản Zalo cá nhân làm cầu nối có thể bị Zalo khoá theo điều khoản của Zalo, nên hãy dùng một SIM riêng cho việc này. Không mở Zalo PC/Web bằng tài khoản đó, vì sẽ làm cầu nối mất kết nối.';

function stateView(s: SupportBridgeStatus): { tone: Tone; text: string } {
  switch (s.state) {
    case 'CONNECTED':
      return { tone: 'success', text: 'Đang kết nối' };
    case 'CONNECTING':
      return { tone: 'warning', text: 'Đang thiết lập kết nối…' };
    case 'NEED_QR':
      return { tone: 'warning', text: 'Cần quét QR' };
    case 'KICKED':
      return { tone: 'danger', text: 'Đăng nhập nơi khác' };
    default:
      return { tone: 'danger', text: s.since ? `Mất kết nối từ ${isoToVnHHMM(s.since)}` : 'Mất kết nối' };
  }
}

/** "từ 10:05, cách đây 2 giờ": thời lượng thô theo phút/giờ/ngày để chủ cửa hàng biết tin đã nằm chờ bao lâu. */
function outageSince(since: string | null): string {
  if (!since) return '';
  const ms = Date.now() - new Date(since).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60_000);
  const ago = min < 1 ? 'vừa mới' : min < 60 ? `${min} phút trước` : min < 1440 ? `${Math.floor(min / 60)} giờ trước` : `${Math.floor(min / 1440)} ngày trước`;
  return ` từ ${isoToVnHHMM(since)} (${ago})`;
}

function reconnectSteps(state: SupportBridgeStatus['state'], isAdmin: boolean): string {
  if (!isAdmin) return 'Nhờ quản trị viên nối lại cầu nối. Trong lúc đó hãy trả lời khách ngay ở tab này.';
  switch (state) {
    case 'NEED_QR':
      return 'Bấm "Đăng nhập Zalo" rồi quét mã QR bằng Zalo của tài khoản cầu nối.';
    case 'KICKED':
      return 'Tài khoản cầu nối vừa được mở ở nơi khác (Zalo máy tính hoặc web). Đóng Zalo đó lại rồi bấm "Kết nối lại".';
    case 'CONNECTING':
      return 'Cầu nối đang nối lại, chờ vài phút. Nếu vẫn chưa được thì bấm "Kết nối lại".';
    default:
      return 'Bấm "Kết nối lại". Nếu vẫn chưa được, bấm "Đăng nhập Zalo" và quét mã QR bằng Zalo của tài khoản cầu nối.';
  }
}

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** Trạng thái cầu nối Zalo; chỉ ADMIN có thêm đăng nhập, đăng xuất, nhóm nhận tin, công tắc chat. */
export function BridgeCard({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const statusQ = useQuery({ queryKey: BRIDGE_QUERY_KEY, queryFn: getSupportBridge, refetchInterval: 30_000 });
  const status = statusQ.data;
  const connected = status?.state === 'CONNECTED';
  const groupsQ = useQuery({ queryKey: ['admin-support-groups'], queryFn: listSupportGroups, enabled: isAdmin && connected });

  const [qr, setQr] = useState<SupportQrState | null>(null);
  const [groupId, setGroupId] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Chỉ theo groupId: mỗi lần poll trả đối tượng mới (checkedAt đổi) và sẽ xoá lựa chọn nhóm chưa lưu.
  const savedGroupId = status?.groupId;
  useEffect(() => {
    if (savedGroupId !== undefined) setGroupId(savedGroupId);
  }, [savedGroupId]);

  const refresh = () => qc.invalidateQueries({ queryKey: BRIDGE_QUERY_KEY });
  const fail = (fallback: string) => (e: unknown) => setNote({ ok: false, text: errText(e, fallback) });

  const login = useMutation({
    mutationFn: startSupportQr,
    onSuccess: (r) => {
      setNote(null);
      setQr(r);
    },
    onError: fail('Không lấy được mã QR.'),
  });
  const logout = useMutation({
    mutationFn: logoutSupportBridge,
    onSuccess: () => {
      setNote({ ok: true, text: 'Đã đăng xuất tài khoản cầu nối.' });
      void refresh();
    },
    onError: fail('Không đăng xuất được.'),
  });
  const reconnect = useMutation({
    mutationFn: reconnectSupportBridge,
    onSuccess: () => {
      setNote({ ok: true, text: 'Đã yêu cầu kết nối lại.' });
      void refresh();
    },
    onError: fail('Không kết nối lại được.'),
  });
  const saveGroup = useMutation({
    mutationFn: () => updateSupportSettings({ groupId }),
    onSuccess: (r) => {
      setNote(r.bridgeSynced ? { ok: true, text: 'Đã lưu nhóm nhận tin.' } : { ok: false, text: 'Đã lưu nhóm, nhưng chưa báo được cho cầu nối. Hệ thống sẽ thử lại sau ít phút.' });
      void refresh();
    },
    onError: fail('Không lưu được nhóm.'),
  });
  const test = useMutation({
    mutationFn: testSupportBridge,
    onMutate: () => setTestResult(null),
    onSuccess: () => setTestResult({ ok: true, text: 'Đã gửi tin thử vào nhóm. Kiểm tra nhóm Zalo.' }),
    onError: (e) => setTestResult({ ok: false, text: errText(e, 'Không gửi được tin thử.') }),
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => updateSupportSettings({ enabled }),
    onSuccess: () => void refresh(),
    onError: fail('Không đổi được công tắc chat.'),
  });

  const onToggle = async () => {
    if (!status) return;
    setNote(null);
    const next = !status.enabled;
    if (next && (!connected || !status.groupId)) {
      setNote({ ok: false, text: 'Chưa bật được chat: cầu nối đang kết nối và đã chọn nhóm nhận tin thì mới bật.' });
      return;
    }
    const ok = await confirm(
      next
        ? { title: 'Bật chat với khách?', message: `Khách sẽ chat được với Tubu Tree và tin được chuyển vào nhóm Zalo.\n${ENABLE_RISK}`, confirmLabel: 'Bật chat' }
        : { title: 'Tắt chat với khách?', message: 'Khách sẽ thấy chat tạm đóng và không gửi được tin mới.', confirmLabel: 'Tắt chat', tone: 'danger' },
    );
    if (ok) toggle.mutate(next);
  };
  const onLogout = async () => {
    const ok = await confirm({
      title: 'Đăng xuất tài khoản cầu nối?',
      message: 'Phiên đã lưu bị xoá. Tin của khách vẫn được lưu nhưng không chuyển vào Zalo cho tới khi quét QR đăng nhập lại.',
      confirmLabel: 'Đăng xuất',
      tone: 'danger',
    });
    if (ok) logout.mutate();
  };

  const busy = login.isPending || logout.isPending || reconnect.isPending || saveGroup.isPending || toggle.isPending;
  const view = status ? stateView(status) : null;
  const groups = groupsQ.data?.groups ?? [];
  // Chờ quét QR mà còn lỗi (thường là tệp phiên cũ chưa xoá được): vẫn cho đăng xuất để cầu nối xoá lại.
  const hasSession = status && (['CONNECTED', 'CONNECTING', 'KICKED', 'ERROR'].includes(status.state) || (status.state === 'NEED_QR' && !!status.lastError));

  return (
    <section aria-labelledby="bridge-h" className="space-y-3 rounded-card border border-stone-200 bg-stone-0 p-4">
      <h2 id="bridge-h" className="font-display text-lg font-semibold text-stone-900">Cầu nối Zalo</h2>
      {statusQ.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {statusQ.isError && <LoadError onRetry={() => void statusQ.refetch()} retrying={statusQ.isFetching}>Không tải được trạng thái cầu nối Zalo.</LoadError>}
      {status && view && (
        <>
          <div data-bridge-state={status.state} className="flex flex-wrap items-center gap-2 text-sm">
            <ToneBadge tone={view.tone}>{view.text}</ToneBadge>
            {status.avatar && (
              // eslint-disable-next-line @next/next/no-img-element -- ảnh đại diện Zalo, miền không cố định
              <img src={status.avatar} alt="" referrerPolicy="no-referrer" className="h-7 w-7 rounded-full" />
            )}
            {status.displayName && <span className="font-medium text-stone-900">{status.displayName}</span>}
            {status.lastError && <span className="min-w-0 break-words text-xs text-stone-500">{status.lastError}</span>}
          </div>

          {status.enabled && !connected && (
            <div data-bridge-down>
              <Notice tone="danger" role="alert">
                <strong>Tin khách đang không tới nhóm Zalo{outageSince(status.since)}.</strong> Khách vẫn gửi được tin và tin được giữ lại
                {status.waitingCount ? ` (đang có ${status.waitingCount} cuộc chat chờ chuyển)` : ''}, nhưng nhân viên trong nhóm Zalo chưa thấy.{' '}
                {reconnectSteps(status.state, isAdmin)}
                {isAdmin && ' Chưa nối lại được thì tắt công tắc "Cho khách chat" bên dưới để khách thấy số điện thoại hỗ trợ thay vì chờ.'}
              </Notice>
            </div>
          )}

          {connected && status.deaf && (
            <div data-bridge-deaf>
              <Notice tone="danger" role="alert">
                Cầu nối báo đang kết nối nhưng không nhận được tin nào từ nhóm sau lần gửi gần nhất. Tin nhân viên trả lời có thể đang bị mất: bấm Kết nối lại.
              </Notice>
            </div>
          )}

          {isAdmin && (
            <>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => login.mutate()}>
                  {login.isPending ? 'Đang lấy mã…' : 'Đăng nhập Zalo'}
                </button>
                {/* Đang kết nối mà còn lỗi (lưu phiên, tệp cũ): kết nối lại sẽ lưu lại phiên đang chạy, không phải đăng xuất. */}
                {((status.state !== 'CONNECTED' && status.state !== 'NEED_QR') || (status.state === 'CONNECTED' && (!!status.lastError || !!status.deaf))) && (
                  <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => reconnect.mutate()}>
                    {reconnect.isPending ? 'Đang kết nối…' : 'Kết nối lại'}
                  </button>
                )}
                {hasSession && (
                  <button type="button" className={BTN_DANGER_OUTLINE} disabled={busy} onClick={() => void onLogout()}>
                    {logout.isPending ? 'Đang đăng xuất…' : 'Đăng xuất'}
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <label className="block min-w-0 flex-1 basis-56 text-xs">
                  <span className="font-medium text-stone-700">Nhóm nhận tin</span>
                  <select
                    name="groupId"
                    value={groupId}
                    onChange={(e) => setGroupId(e.target.value)}
                    disabled={busy}
                    className={`mt-1 min-h-[44px] w-full sm:min-h-[36px] ${FIELD_CLASS}`}
                  >
                    <option value="">Chưa chọn nhóm</option>
                    {status.groupId && !groups.some((g) => g.id === status.groupId) && <option value={status.groupId}>Nhóm đang chọn ({status.groupId})</option>}
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} · {g.memberCount} thành viên
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className={BTN_SECONDARY} disabled={busy || groupId === status.groupId} onClick={() => saveGroup.mutate()}>
                  {saveGroup.isPending ? 'Đang lưu…' : 'Lưu nhóm'}
                </button>
                <button type="button" className={BTN_SECONDARY} disabled={test.isPending || !status.groupId} onClick={() => test.mutate()}>
                  {test.isPending ? 'Đang gửi…' : 'Gửi tin thử'}
                </button>
              </div>
              {groupsQ.isError && <p className="text-xs text-danger-fg">Không lấy được danh sách nhóm của tài khoản cầu nối.</p>}
              {testResult && (
                <p data-test-result role={testResult.ok ? 'status' : 'alert'} className={`text-xs ${testResult.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
                  {testResult.text}
                </p>
              )}

              <div className="flex items-center gap-3 border-t border-stone-200 pt-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={status.enabled}
                  aria-label="Cho khách chat"
                  disabled={busy}
                  onClick={() => void onToggle()}
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${status.enabled ? 'bg-forest-600' : 'bg-stone-300'}`}
                >
                  <span className={`inline-block h-5 w-5 rounded-full bg-stone-0 shadow transition-transform ${status.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <span className="text-sm text-stone-700">
                  Cho khách chat: {status.enabled ? 'đang bật' : 'đang tắt'}
                  {status.enabled && !connected && <span className="text-danger-fg"> (nhưng cầu nối đang mất kết nối)</span>}
                </span>
              </div>
            </>
          )}
          {note && (note.ok ? <Notice tone="success" role="status">{note.text}</Notice> : <Notice tone="danger" role="alert">{note.text}</Notice>)}
        </>
      )}
      {dialog}
      {qr && (
        <QrModal
          initial={qr}
          onClose={() => setQr(null)}
          onSuccess={() => {
            void refresh();
            void qc.invalidateQueries({ queryKey: ['admin-support-groups'] });
          }}
        />
      )}
    </section>
  );
}
