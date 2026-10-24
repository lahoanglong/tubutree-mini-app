'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CircleCheck, RefreshCw } from 'lucide-react';
import {
  dismissOpsWebhookEvent,
  getOpsHealth,
  recomputeSoldCounts,
  resolveGomdonAlert,
  retryOpsWebhookEvent,
  runPancakeSync,
  sendOpsTestEmail,
  type OpsCronJob,
  type OpsEmailChannel,
  type OpsWebhookChannel,
  type OpsHealth,
  type OpsWebhookEvent,
} from '@/lib/admin-client';
import { ApiError } from '@/lib/client-api';
import { formatDateTime } from '@/lib/format-date';
import { smtpErrorSummary } from '@/lib/ops-email-error';
import { useConfirm } from './confirm-dialog';
import { BTN_DANGER_OUTLINE, BTN_SECONDARY, BTN_XS_SECONDARY, Notice, ScrollRegion, LoadError } from './ui';

const PUSH_STATUS_LABELS: Record<string, string> = {
  PENDING: 'chờ đẩy',
  PUSHING: 'đang đẩy',
  FAILED: 'đẩy lỗi',
  STALE: 'quá hạn tự đẩy',
  NOT_CONFIGURED: 'chưa cấu hình',
  WAITING_PAYMENT: 'chờ thanh toán',
  WAITING_STOCK: 'chờ đủ hàng',
};

const QUEUE_LABELS: Record<string, string> = {
  'pancake-push': 'Đẩy đơn sang Pancake',
  'pancake-events': 'Webhook Pancake',
  'gomdon-push': 'Vận đơn Gomdon',
  'gomdon-events': 'Webhook Gomdon',
  notifications: 'Thông báo (ZNS / in-app)',
  'zalo-oa-events': 'Sự kiện Zalo OA',
  'support-chat-forward': 'Chuyển tin chat CSKH vào nhóm Zalo',
  'support-chat-notify': 'Chuông báo trả lời chat CSKH',
};

function cronOutcomeLabel(j: OpsCronJob): string {
  if (j.lastOutcome === 'THREW') return 'Ném lỗi';
  if (j.lastOutcome === 'ERRORS') return `Lỗi ${j.lastErrorCount} lần ghi log`;
  if (j.lastOutcome === 'SKIPPED') return 'Bỏ qua';
  return 'OK';
}

const OPS_HEALTH_KEY = ['admin-ops-health'] as const;

const ago = (iso: string | null) => (iso ? formatDateTime(iso) : 'chưa có');
const newer = (a: string | null | undefined, b: string | null | undefined) => !!a && (!b || a > b);

/** Số tồn tuyệt đối đã cũ: chạy lại sẽ đè tồn kho mới hơn (hồi sinh hàng đã bán) — API cũng từ chối. */
const isStaleStockEvent = (e: OpsWebhookEvent) => e.source === 'pancake' && e.eventType === 'variation.stock_changed';

const OPEN_ORDER_BTN = 'min-h-[44px] text-xs font-medium text-forest-700 hover:underline sm:min-h-0';

type Act = (run: () => Promise<{ message?: string } | unknown>, ok: string) => void;

function Card({ title, children, after }: { title: string; children: ReactNode; after?: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      <h3 className="font-display text-sm font-semibold text-stone-900">{title}</h3>
      <dl className="mt-2 space-y-1 text-sm">{children}</dl>
      {after}
    </section>
  );
}

function Row({ label, value, warn }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3">
      <dt className="text-stone-600">{label}</dt>
      <dd className={`font-medium ${warn ? 'text-danger-fg' : 'text-stone-900'}`}>{value}</dd>
    </div>
  );
}

/**
 * Sức khoẻ vận hành (PLATFORM-5): Pancake, Gomdon, hàng đợi, đơn kẹt — cùng ngưỡng mà cron báo động dùng — kèm các nút
 * vận hành trước đây chỉ gọi được bằng API tay (đồng bộ danh mục Pancake, tính lại số đã bán).
 */
export function OpsHealthTab({ onOpenOrder, isAdmin = true }: { onOpenOrder?: (code: string) => void; isAdmin?: boolean }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const q = useQuery({ queryKey: OPS_HEALTH_KEY, queryFn: getOpsHealth, refetchInterval: 60_000 });
  const done = (text: string) => {
    setMsg({ tone: 'success', text });
    void qc.invalidateQueries({ queryKey: OPS_HEALTH_KEY });
  };
  const fail = (e: unknown) => setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'Thao tác lỗi.' });
  const [busy, setBusy] = useState(false);
  const msgRef = useRef<HTMLDivElement>(null);
  // Nút thao tác nằm ở các danh sách phía dưới, thông báo kết quả ở đầu trang: kéo thông báo vào tầm nhìn.
  useEffect(() => {
    if (msg) msgRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [msg]);
  const act: Act = (run, ok) => {
    setBusy(true);
    setMsg(null);
    run()
      .then((r) => done((r as { message?: string } | null)?.message ?? ok))
      .catch(fail)
      .finally(() => setBusy(false));
  };
  const askDismiss = async (e: OpsWebhookEvent) => {
    const ok = await confirm({
      title: 'Đánh dấu webhook đã xử lý?',
      message: isStaleStockEvent(e)
        ? 'Chỉ bấm sau khi đã chạy Đồng bộ danh mục Pancake để tồn kho lấy số mới. Sự kiện sẽ không còn tính vào báo động và không được chạy lại tự động.'
        : `Chỉ bấm khi đã sửa tay đơn ${e.orderRef ?? 'liên quan'} cho đúng trạng thái. Sự kiện sẽ không còn tính vào báo động và không được chạy lại tự động.`,
      confirmLabel: 'Đã xử lý',
    });
    if (ok) act(() => dismissOpsWebhookEvent(e.source, e.id), 'Đã đánh dấu đã xử lý.');
  };
  const askCloseAlert = async (id: string, orderCode: string) => {
    const ok = await confirm({
      title: 'Đóng báo động Gomdon?',
      message: `Đơn ${orderCode} sẽ rời hàng đợi "Cần xử lý thu gom" nếu không còn báo động nào khác. Chỉ đóng khi đã xử lý xong.`,
      confirmLabel: 'Đóng báo động',
    });
    if (ok) act(() => resolveGomdonAlert(id), 'Đã đóng báo động.');
  };
  const sync = useMutation({
    mutationFn: (withStock: boolean) => runPancakeSync(withStock),
    onSuccess: (r) => done(`Đã đồng bộ ${r.synced} sản phẩm từ Pancake${r.stockOverwritten ? ' (đã ghi đè tồn kho)' : ''}.`),
    onError: fail,
  });
  const recompute = useMutation({
    mutationFn: recomputeSoldCounts,
    onSuccess: (r) => done(`Đã tính lại số đã bán cho ${r.updated} sản phẩm.`),
    onError: fail,
  });

  const askSync = async (withStock: boolean) => {
    const ok = await confirm(
      withStock
        ? {
            title: 'Đồng bộ và ghi đè tồn kho?',
            message:
              'Tồn kho mọi sản phẩm sẽ lấy đúng số của Pancake và xoá phần đang giữ chỗ cho đơn chưa lên kho. Chỉ dùng khi tồn kho trên Tubu đã lệch thật.',
            confirmLabel: 'Ghi đè tồn kho',
            tone: 'danger',
          }
        : {
            title: 'Đồng bộ danh mục Pancake ngay?',
            message: 'Lấy lại toàn bộ sản phẩm từ Pancake (tên, giá, biến thể). Tồn kho cập nhật theo chênh lệch như lượt tự động.',
            confirmLabel: 'Đồng bộ',
          },
    );
    if (ok) sync.mutate(withStock);
  };
  const askRecompute = async () => {
    if (await confirm({ title: 'Tính lại số đã bán?', message: 'Đếm lại "đã bán" của mọi sản phẩm từ đơn đã giao.', confirmLabel: 'Tính lại' })) {
      recompute.mutate();
    }
  };

  return (
    <div className="space-y-4">
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-stone-900">Sức khoẻ hệ thống</h2>
        <button type="button" onClick={() => void q.refetch()} className={`${BTN_SECONDARY} inline-flex items-center gap-1.5`}>
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          Làm mới
        </button>
      </div>
      {q.isLoading && <p className="text-sm text-stone-500">Đang kiểm tra…</p>}
      {q.isError && <LoadError onRetry={() => void q.refetch()} retrying={q.isFetching}>Không tải được tình trạng hệ thống.</LoadError>}
      {msg && (
        <div ref={msgRef}>
          <Notice tone={msg.tone} role={msg.tone === 'danger' ? 'alert' : 'status'}>
            {msg.text}
          </Notice>
        </div>
      )}
      {q.data && (
        <HealthBody
          h={q.data}
          onOpenOrder={onOpenOrder}
          canTestEmail={isAdmin}
          busy={busy}
          onRetry={(e) => act(() => retryOpsWebhookEvent(e.source, e.id), 'Đã đưa sự kiện vào hàng đợi xử lý lại.')}
          onDismiss={(e) => void askDismiss(e)}
          onCloseAlert={(id, code) => void askCloseAlert(id, code)}
        />
      )}

      <section aria-label="Công cụ vận hành" className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
        <h3 className="font-display text-sm font-semibold text-stone-900">Công cụ vận hành</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={sync.isPending} onClick={() => void askSync(false)} className={BTN_SECONDARY}>
            {sync.isPending ? 'Đang đồng bộ…' : 'Đồng bộ danh mục Pancake'}
          </button>
          <button type="button" disabled={sync.isPending} onClick={() => void askSync(true)} className={BTN_DANGER_OUTLINE}>
            Đồng bộ + ghi đè tồn kho
          </button>
          <button type="button" disabled={recompute.isPending} onClick={() => void askRecompute()} className={BTN_SECONDARY}>
            {recompute.isPending ? 'Đang tính…' : 'Tính lại số đã bán'}
          </button>
        </div>
      </section>
    </div>
  );
}

const EMAIL_STATE_LABELS = { DISABLED: 'Chưa bật', READY: 'Đang bật', MISCONFIGURED: 'Cấu hình chưa đủ' } as const;

const TEST_EMAIL_THROTTLED = 'Đã bấm gửi thử quá nhiều lần. Chờ khoảng một phút rồi thử lại.';
const TEST_EMAIL_FAILED = 'Gửi email thử không thành công';

type TestOutcome = { ok: boolean; text: string; smtpCause?: string };

/**
 * API trả lỗi SMTP của lần gửi thử dạng "Gửi email thử lỗi — <lời chỉ> Chi tiết: <lỗi gốc>" hoặc "Gửi email thử lỗi: <lỗi gốc>".
 * Cả lời chỉ lẫn lỗi gốc đã nằm trên thẻ (từ trạng thái vừa ghi), nên thông báo không chép lại; chỉ giữ nguyên nhân đã dịch
 * để dùng khi thẻ không tải lại được.
 */
function describeTestFailure(e: unknown): TestOutcome {
  if (e instanceof ApiError && e.status === 429) return { ok: false, text: TEST_EMAIL_THROTTLED };
  if (!(e instanceof Error)) return { ok: false, text: 'Gửi email thử lỗi.' };
  const withHint = /^Gửi email thử lỗi — (.+?) Chi tiết: (.+)$/s.exec(e.message);
  const plain = /^Gửi email thử lỗi: (.+)$/s.exec(e.message);
  if (withHint) return { ok: false, text: TEST_EMAIL_FAILED, smtpCause: smtpErrorSummary({ hint: withHint[1], raw: withHint[2] }) };
  if (plain) return { ok: false, text: TEST_EMAIL_FAILED, smtpCause: smtpErrorSummary({ raw: plain[1] }) };
  return { ok: false, text: e.message };
}

/**
 * Email là kênh thứ hai của báo động vận hành; lỗi SMTP không thành "sự cố" mới nên chỉ lộ ra ở thẻ này. Nút "Gửi email thử"
 * (ADMIN, như endpoint) chỉ có khi kênh đang bật: chưa bật hay cấu hình dở dang thì chưa có gì để thử, thẻ đã nêu cần đặt gì.
 * Lỗi hiện đúng một lần ở thẻ (câu tiếng Việt + chi tiết kỹ thuật thu gọn); sau mỗi lần gửi thử thẻ tải lại trạng thái trước khi
 * hiện thông báo, nên không còn lời chỉ của lỗi cũ nằm cạnh kết quả mới.
 */
function EmailChannelCard({ email, canTest }: { email: OpsEmailChannel; canTest: boolean }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const failing = newer(email.lastErrorAt, email.lastOkAt);

  /** Tải lại sức khoẻ; trả kênh email mới, hoặc null nếu không tải được (thẻ còn giữ dữ liệu cũ). */
  const reload = async (): Promise<OpsEmailChannel | null> => {
    try {
      await qc.refetchQueries({ queryKey: OPS_HEALTH_KEY }, { throwOnError: true });
      return qc.getQueryData<OpsHealth>(OPS_HEALTH_KEY)?.alertChannels?.email ?? null;
    } catch {
      return null;
    }
  };

  const askTest = async () => {
    if (sendingRef.current) return;
    const ok = await confirm({
      title: 'Gửi email thử?',
      message: `Hệ thống sẽ gửi một email thử tới ${email.recipients} địa chỉ nhận báo động. Không ảnh hưởng báo động thật. Sau khi gửi, kiểm tra hộp thư (cả thư rác).`,
      confirmLabel: 'Gửi email thử',
    });
    if (!ok || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setResult(null);
    let outcome: TestOutcome;
    try {
      const r = await sendOpsTestEmail();
      outcome = { ok: true, text: r.message || 'Đã gửi email thử.' };
    } catch (e) {
      outcome = describeTestFailure(e);
    }
    const fresh = await reload();
    const shownOnCard = !!fresh && newer(fresh.lastErrorAt, fresh.lastOkAt);
    sendingRef.current = false;
    setSending(false);
    if (outcome.smtpCause) {
      setResult({ ok: false, text: shownOnCard ? `${outcome.text}. Nguyên nhân ở dòng lỗi phía trên.` : `${outcome.text}: ${outcome.smtpCause}` });
    } else {
      setResult({ ok: outcome.ok, text: outcome.text });
    }
  };

  return (
    <Card
      title="Báo động qua email"
      after={
        <div className="mt-1 space-y-1">
          {email.state === 'DISABLED' && (
            <p className="text-xs text-stone-500">Muốn nhận báo động qua email, nhờ người quản trị máy chủ đặt OPS_ALERT_EMAIL_TO, SMTP_HOST và SMTP_FROM.</p>
          )}
          {email.issues.map((issue) => (
            <p key={issue} className="break-words text-xs text-danger-fg">
              {issue}
            </p>
          ))}
          {failing && (
            <div className="space-y-0.5">
              <p className="break-words text-xs font-medium text-danger-fg">
                {smtpErrorSummary({ kind: email.lastErrorKind, hint: email.lastErrorHint, raw: email.lastError })}
              </p>
              {email.lastError && (
                <details className="text-xs text-stone-600">
                  <summary className="flex min-h-[44px] cursor-pointer items-center hover:underline sm:min-h-0">Chi tiết kỹ thuật</summary>
                  <p className="break-words pb-1 font-mono text-stone-600">{email.lastError}</p>
                </details>
              )}
            </div>
          )}
          {canTest && email.state === 'READY' && (
            <div className="pt-1">
              <button type="button" disabled={sending} aria-busy={sending} onClick={() => void askTest()} className={BTN_XS_SECONDARY}>
                {sending ? 'Đang gửi…' : 'Gửi email thử'}
              </button>
            </div>
          )}
          {result && (
            <Notice tone={result.ok ? 'success' : 'danger'} role={result.ok ? 'status' : 'alert'}>
              {result.text}
            </Notice>
          )}
          {dialog}
        </div>
      }
    >
      <Row label="Trạng thái" value={EMAIL_STATE_LABELS[email.state]} warn={email.state === 'MISCONFIGURED'} />
      {email.state === 'READY' && <Row label="Người nhận" value={`${email.recipients} địa chỉ`} />}
      {email.state === 'READY' && (
        <Row
          label="Lần gửi gần nhất"
          value={failing ? `Lỗi ${ago(email.lastErrorAt)}` : email.lastOkAt ? `OK ${ago(email.lastOkAt)}` : 'chưa gửi'}
          warn={failing}
        />
      )}
    </Card>
  );
}

const WEBHOOK_STATE_LABELS = { DISABLED: 'Chưa bật', READY: 'Đang bật' } as const;

/** Câu tiếng Việt cho lần gửi webhook lỗi gần nhất; chuỗi gốc (HTTP 410, lỗi mạng) chỉ nằm ở "Chi tiết kỹ thuật". */
function webhookErrorSummary(w: OpsWebhookChannel): string {
  const hint = w.lastErrorHint?.trim();
  if (hint) return hint;
  if (w.lastErrorKind === 'PERMANENT') return 'Hook báo động bị từ chối hẳn. Kiểm tra OPS_ALERT_WEBHOOK_URL.';
  return 'Hook báo động tạm thời chưa nhận được. Hệ thống tự gửi lại ở lượt kiểm sau (5 phút).';
}

/**
 * Webhook là kênh báo động ngoài thứ hai (Slack/Zalo): hook bị thu hồi (410) chỉ ghi log máy chủ nên thẻ này là chỗ duy nhất admin
 * biết báo động bên ngoài đã mất. Cùng luật "lỗi mới hơn lần gửi được" như thẻ email.
 */
function WebhookChannelCard({ webhook }: { webhook: OpsWebhookChannel }) {
  const failing = newer(webhook.lastErrorAt, webhook.lastOkAt);
  return (
    <Card
      title="Báo động qua webhook"
      after={
        <div className="mt-1 space-y-1">
          {webhook.state === 'DISABLED' && (
            <p className="text-xs text-stone-500">Đặt OPS_ALERT_WEBHOOK_URL (Slack hoặc Zalo) để nhận báo động qua webhook.</p>
          )}
          {failing && (
            <div className="space-y-0.5">
              <p className="break-words text-xs font-medium text-danger-fg">{webhookErrorSummary(webhook)}</p>
              {webhook.lastError && (
                <details className="text-xs text-stone-600">
                  <summary className="flex min-h-[44px] cursor-pointer items-center hover:underline sm:min-h-0">Chi tiết kỹ thuật</summary>
                  <p className="break-words pb-1 font-mono text-stone-600">{webhook.lastError}</p>
                </details>
              )}
            </div>
          )}
        </div>
      }
    >
      <Row label="Trạng thái" value={WEBHOOK_STATE_LABELS[webhook.state]} />
      {webhook.state === 'READY' && (
        <Row
          label="Lần gửi gần nhất"
          value={failing ? `Lỗi ${ago(webhook.lastErrorAt)}` : webhook.lastOkAt ? `OK ${ago(webhook.lastOkAt)}` : 'chưa gửi'}
          warn={failing}
        />
      )}
    </Card>
  );
}

function ListSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      <h3 className="font-display text-sm font-semibold text-stone-900">{title}</h3>
      <ul className="mt-2 divide-y divide-stone-100 text-sm">{children}</ul>
    </section>
  );
}

function HealthBody({
  h,
  onOpenOrder,
  canTestEmail,
  busy,
  onRetry,
  onDismiss,
  onCloseAlert,
}: {
  h: OpsHealth;
  onOpenOrder?: (code: string) => void;
  canTestEmail: boolean;
  busy: boolean;
  onRetry: (e: OpsWebhookEvent) => void;
  onDismiss: (e: OpsWebhookEvent) => void;
  onCloseAlert: (id: string, orderCode: string) => void;
}) {
  const t = h.thresholds;
  const events = [...h.pancake.failedEvents, ...h.gomdon.failedEvents];
  const eventsTotal = h.pancake.webhookFailedOpen + h.pancake.webhookStuck + h.gomdon.webhookFailedOpen;
  const openOrder = (code: string) =>
    onOpenOrder ? (
      <button type="button" onClick={() => onOpenOrder(code)} className={OPEN_ORDER_BTN}>
        Mở đơn →
      </button>
    ) : null;
  const gomdonLoginError = newer(h.gomdon.connection?.lastErrorAt, h.gomdon.connection?.lastOkAt);
  return (
    <>
      {h.problems.length > 0 ? (
        <div role="alert" className="rounded-card border border-danger-fg bg-danger-bg px-4 py-3 text-sm text-danger-fg">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
            {h.problems.length} sự cố đang vượt ngưỡng (admin được báo in-app, nhắc lại sau {t.repeatHours} giờ)
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-6">
            {h.problems.map((p) => (
              <li key={p.key}>{p.message}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="flex items-center gap-2 rounded-card border border-success-fg bg-success-bg px-4 py-3 text-sm text-success-fg">
          <CircleCheck aria-hidden="true" className="h-4 w-4 shrink-0" />
          Mọi chỉ số trong ngưỡng · kiểm lúc {formatDateTime(h.generatedAt)}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card
          title="Pancake"
          after={h.pancake.catalog.lastError && <p className="mt-1 break-words text-xs text-stone-500">Lỗi gần nhất: {h.pancake.catalog.lastError}</p>}
        >
          <Row label="Cấu hình" value={h.pancake.configured ? 'Đã cấu hình' : 'Chưa cấu hình'} warn={!h.pancake.configured} />
          <Row label="Đẩy đơn thành công gần nhất" value={ago(h.pancake.lastPushOkAt)} />
          <Row label="Nhận webhook gần nhất" value={ago(h.pancake.lastWebhookAt)} />
          <Row label="Xử lý webhook gần nhất" value={ago(h.pancake.lastWebhookProcessedAt)} />
          <Row label="Webhook lỗi chưa xử lý" value={h.pancake.webhookFailedOpen} warn={h.pancake.webhookFailedOpen > 0} />
          <Row label="Webhook kẹt chưa xử lý" value={h.pancake.webhookStuck} warn={h.pancake.webhookStuck > 0} />
          <Row label="Đơn chưa lên Pancake" value={h.pancake.unsynced} />
          <Row label={`Đơn kẹt quá ${t.unsyncedMinutes} phút`} value={h.pancake.stuck} warn={h.pancake.stuck >= t.stuckOrders} />
          <Row label="Đơn cần xử lý theo Pancake" value={h.pancake.attention} warn={h.pancake.attention > 0} />
          <Row
            label="Đồng bộ danh mục"
            value={
              h.pancake.catalog.lastErrorAt && (!h.pancake.catalog.lastOkAt || h.pancake.catalog.lastErrorAt > h.pancake.catalog.lastOkAt)
                ? `Lỗi ${ago(h.pancake.catalog.lastErrorAt)}`
                : `OK ${ago(h.pancake.catalog.lastOkAt)}${h.pancake.catalog.detail?.count !== undefined ? ` · ${h.pancake.catalog.detail.count} SP` : ''}`
            }
            warn={!!h.pancake.catalog.lastErrorAt && (!h.pancake.catalog.lastOkAt || h.pancake.catalog.lastErrorAt > h.pancake.catalog.lastOkAt)}
          />
        </Card>
        <Card
          title="Gomdon (thu kèm rác)"
          after={h.gomdon.connection?.lastError && <p className="mt-1 break-words text-xs text-stone-500">Lỗi gần nhất: {h.gomdon.connection.lastError}</p>}
        >
          <Row label="Cấu hình" value={h.gomdon.configured ? 'Đã cấu hình' : 'Chưa cấu hình'} />
          <Row
            label="Kết nối Gomdon"
            value={
              h.gomdon.credentialsRejected
                ? 'Bị từ chối đăng nhập'
                : gomdonLoginError
                  ? `Lỗi ${ago(h.gomdon.connection?.lastErrorAt ?? null)}`
                  : h.gomdon.connection?.lastOkAt
                    ? `OK ${ago(h.gomdon.connection.lastOkAt)}`
                    : 'chưa gọi'
            }
            warn={h.gomdon.credentialsRejected || gomdonLoginError}
          />
          <Row label="Nhận webhook gần nhất" value={ago(h.gomdon.lastWebhookAt)} />
          <Row label="Webhook lỗi chưa xử lý" value={h.gomdon.webhookFailedOpen} warn={h.gomdon.webhookFailedOpen > 0} />
          <Row label={`Đơn thu gom chờ vận đơn quá ${t.gomdonBacklogMinutes} phút`} value={h.gomdon.backlog} warn={h.gomdon.backlog > 0} />
          <Row label="Báo động chưa đóng" value={h.gomdon.openAlerts} warn={h.gomdon.openAlerts > 0} />
          <Row label="Đơn cần xử lý thu gom" value={h.gomdon.attention} warn={h.gomdon.attention > 0} />
        </Card>
        {h.alertChannels?.email && <EmailChannelCard email={h.alertChannels.email} canTest={canTestEmail} />}
        {h.alertChannels?.webhook && <WebhookChannelCard webhook={h.alertChannels.webhook} />}
      </div>

      <section aria-label="Hàng đợi" className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
        <h3 className="font-display text-sm font-semibold text-stone-900">Hàng đợi xử lý nền</h3>
        {!h.queues.ok ? (
          <p className="mt-2 text-sm text-danger-fg">Không đọc được hàng đợi: {h.queues.error}</p>
        ) : (
          <ScrollRegion label="Bảng hàng đợi" className="mt-2">
            <table className="w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs text-stone-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Hàng đợi</th>
                  <th className="px-3 py-2 font-medium">Chờ</th>
                  <th className="px-3 py-2 font-medium">Đang chạy</th>
                  <th className="px-3 py-2 font-medium">Hẹn lại</th>
                  <th className="px-3 py-2 font-medium">Lỗi 1 giờ</th>
                  <th className="px-3 py-2 font-medium">Lỗi đang giữ</th>
                </tr>
              </thead>
              <tbody>
                {h.queues.items.map((r) => (
                  <tr key={r.name} className="border-t border-stone-100">
                    <td className="px-3 py-2">{QUEUE_LABELS[r.name] ?? r.name}</td>
                    <td className="px-3 py-2">{r.waiting}</td>
                    <td className="px-3 py-2">{r.active}</td>
                    <td className="px-3 py-2">{r.delayed}</td>
                    <td className={`px-3 py-2 ${r.failedLastHour >= t.queueFailed1h ? 'font-semibold text-danger-fg' : ''}`}>{r.failedLastHour}</td>
                    <td className="px-3 py-2 text-stone-500">{r.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>

      {h.cronJobs && h.cronJobs.length > 0 && (
        <section aria-label="Tác vụ nền" className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
          <h3 className="font-display text-sm font-semibold text-stone-900">Tác vụ nền (cron)</h3>
          <ScrollRegion label="Bảng tác vụ nền" className="mt-2">
            <table className="w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs text-stone-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Tác vụ</th>
                  <th className="px-3 py-2 font-medium">Kết quả gần nhất</th>
                  <th className="px-3 py-2 font-medium">Lần chạy gần nhất</th>
                  <th className="px-3 py-2 font-medium">Thành công gần nhất</th>
                  <th className="px-3 py-2 font-medium">Lỗi gần nhất</th>
                  <th className="px-3 py-2 font-medium">Lỗi liên tiếp</th>
                </tr>
              </thead>
              <tbody>
                {[...h.cronJobs]
                  .sort((a, b) => b.consecutiveFailures - a.consecutiveFailures || a.job.localeCompare(b.job))
                  .map((j) => (
                    <tr key={j.job} className="border-t border-stone-100 align-top">
                      <td className="px-3 py-2 font-medium text-stone-900">{j.job}</td>
                      <td className={`px-3 py-2 ${j.lastOutcome === 'ERRORS' || j.lastOutcome === 'THREW' ? 'text-danger-fg' : 'text-stone-600'}`}>{cronOutcomeLabel(j)}</td>
                      <td className="px-3 py-2 text-xs text-stone-500">
                        {j.lastOutcome === 'SKIPPED' ? (
                          <span className="block">Bỏ qua lúc {formatDateTime(j.lastFinishedAt)}</span>
                        ) : (
                          <>
                            <span className="block">Bắt đầu {formatDateTime(j.lastStartedAt)}</span>
                            <span className="block">Xong {formatDateTime(j.lastFinishedAt)}</span>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2">{ago(j.lastSuccessAt)}</td>
                      <td className="px-3 py-2">
                        {j.lastError ? (
                          <>
                            <span className="block text-xs text-stone-500">{formatDateTime(j.lastErrorAt ?? j.lastFinishedAt)}</span>
                            <span className={`block break-words text-xs ${j.consecutiveFailures > 0 ? 'text-danger-fg' : 'text-stone-500'}`}>{j.lastError}</span>
                          </>
                        ) : (
                          <span className="text-stone-500">chưa có</span>
                        )}
                      </td>
                      <td className={`px-3 py-2 ${j.consecutiveFailures > 0 ? 'font-semibold text-danger-fg' : 'text-stone-500'}`}>{j.consecutiveFailures}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </ScrollRegion>
        </section>
      )}

      {events.length > 0 && (
        <ListSection title="Webhook lỗi cần xử lý">
          {events.map((e) => (
            <li key={`${e.source}-${e.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="text-xs font-medium text-stone-500">{e.source === 'pancake' ? 'Pancake' : 'Gomdon'} · </span>
                <b className="text-stone-900">{e.orderRef ?? 'Không rõ đơn'}</b>
                <span className="text-xs text-stone-500">
                  {' '}
                  · {e.eventType} · {e.status === 'FAILED' ? 'lỗi' : 'kẹt chưa xử lý'} · {e.attempts} lần thử · nhận {formatDateTime(e.receivedAt)}
                </span>
                {e.error && <span className="block break-words text-xs text-danger-fg">{e.error}</span>}
                {isStaleStockEvent(e) && (
                  <span className="block text-xs text-stone-500">
                    Tồn kho cũ không chạy lại được — chạy Đồng bộ danh mục Pancake rồi bấm Đã xử lý.
                  </span>
                )}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {!isStaleStockEvent(e) && (
                  <button type="button" disabled={busy} onClick={() => onRetry(e)} className={BTN_XS_SECONDARY}>
                    Chạy lại
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => onDismiss(e)} className={BTN_XS_SECONDARY}>
                  Đã xử lý
                </button>
                {e.orderRef && !e.orderRef.startsWith('#') && openOrder(e.orderRef)}
              </span>
            </li>
          ))}
          <li className="py-2 text-xs text-stone-500">
            Tổng {eventsTotal} sự kiện. Chạy lại khi đã sửa nguyên nhân; Đã xử lý khi đã chỉnh tay đơn cho đúng trạng thái.
          </li>
        </ListSection>
      )}

      {h.pancake.attentionOrders.length > 0 && (
        <ListSection title="Đơn cần xử lý tay trên Pancake">
          {h.pancake.attentionOrders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <b className="text-stone-900">{o.code}</b>
                {o.pancakeAttentionAt && <span className="text-xs text-stone-500"> · từ {formatDateTime(o.pancakeAttentionAt)}</span>}
                {o.pancakeAttention && <span className="block break-words text-xs text-danger-fg">{o.pancakeAttention}</span>}
              </span>
              {openOrder(o.code)}
            </li>
          ))}
          {h.pancake.attention > h.pancake.attentionOrders.length && (
            <li className="py-2 text-xs text-stone-500">Còn {h.pancake.attention - h.pancake.attentionOrders.length} đơn khác ở bộ lọc “Cần xử lý Pancake”.</li>
          )}
        </ListSection>
      )}

      {h.gomdon.alerts.length > 0 && (
        <ListSection title="Báo động Gomdon chưa đóng">
          {h.gomdon.alerts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <b className="text-stone-900">{a.orderCode}</b>
                <span className="text-xs text-stone-500"> · {formatDateTime(a.createdAt)}</span>
                <span className="block break-words text-xs text-danger-fg">{a.message}</span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy} onClick={() => onCloseAlert(a.id, a.orderCode)} className={BTN_XS_SECONDARY}>
                  Đóng báo động
                </button>
                {openOrder(a.orderCode)}
              </span>
            </li>
          ))}
        </ListSection>
      )}

      {h.gomdon.backlogOrders.length > 0 && (
        <ListSection title="Đơn thu gom chờ vận đơn Gomdon">
          {h.gomdon.backlogOrders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <b className="text-stone-900">{o.code}</b>
                <span className="text-xs text-stone-500">
                  {' '}
                  · đặt {formatDateTime(o.createdAt)} · {o.gomdonStatus === 'CREATING' ? 'đang tạo vận đơn' : 'chưa tạo được vận đơn'}
                </span>
              </span>
              {openOrder(o.code)}
            </li>
          ))}
          <li className="py-2 text-xs text-stone-500">
            Hệ thống tự thử lại; quá 60 phút đơn được đẩy sang kho kèm ghi chú tạo vận đơn tay. Kiểm kết nối Gomdon ở thẻ trên.
          </li>
        </ListSection>
      )}

      {h.orders && h.orders.deliveredEffectsOrders.length > 0 && (
        <ListSection title={`Đơn đã giao chưa xong việc sau giao (${h.orders.deliveredEffectsPending})`}>
          {h.orders.deliveredEffectsOrders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <b className="text-stone-900">{o.code}</b>
                {o.deliveredAt && <span className="text-xs text-stone-500"> · giao {formatDateTime(o.deliveredAt)}</span>}
              </span>
              {openOrder(o.code)}
            </li>
          ))}
          <li className="py-2 text-xs text-stone-500">
            Mở đơn rồi bấm “Chạy lại việc sau giao” (chỉ ADMIN). Đơn giao quá cửa sổ cron ({h.orders.deliveredEffectsStale} đơn) không tự chạy lại.
          </li>
        </ListSection>
      )}

      {h.pancake.stuckOrders.length > 0 && (
        <section aria-label="Đơn kẹt" className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
          <h3 className="font-display text-sm font-semibold text-stone-900">
            Đơn kẹt chưa lên Pancake ({h.pancake.stuck}
            {h.pancake.stuck > h.pancake.stuckOrders.length ? `, hiện ${h.pancake.stuckOrders.length} cũ nhất` : ''})
          </h3>
          <ul className="mt-2 divide-y divide-stone-100 text-sm">
            {h.pancake.stuckOrders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <b className="text-stone-900">{o.code}</b>
                  <span className="text-xs text-stone-500"> · đặt {formatDateTime(o.createdAt)} · {PUSH_STATUS_LABELS[o.pancakePushStatus ?? ''] ?? o.pancakePushStatus ?? 'chưa đẩy'} · {o.pancakePushAttempts} lần thử</span>
                  {o.pancakeSyncError && <span className="block break-words text-xs text-danger-fg">{o.pancakeSyncError}</span>}
                </span>
                {openOrder(o.code)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
