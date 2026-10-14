'use client';

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CircleCheck, RefreshCw } from 'lucide-react';
import { getOpsHealth, recomputeSoldCounts, runPancakeSync, type OpsHealth } from '@/lib/admin-client';
import { formatDateTime } from '@/lib/format-date';
import { useConfirm } from './confirm-dialog';
import { BTN_DANGER_OUTLINE, BTN_SECONDARY, Notice, ScrollRegion } from './ui';

const QUEUE_LABELS: Record<string, string> = {
  'pancake-push': 'Đẩy đơn sang Pancake',
  'pancake-events': 'Webhook Pancake',
  'gomdon-push': 'Vận đơn Gomdon',
  'gomdon-events': 'Webhook Gomdon',
  notifications: 'Thông báo (ZNS / in-app)',
  'zalo-oa-events': 'Sự kiện Zalo OA',
};

const ago = (iso: string | null) => (iso ? formatDateTime(iso) : 'chưa có');

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      <h3 className="font-display text-sm font-semibold text-stone-900">{title}</h3>
      <dl className="mt-2 space-y-1 text-sm">{children}</dl>
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
export function OpsHealthTab({ onOpenOrder }: { onOpenOrder?: (code: string) => void }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const q = useQuery({ queryKey: ['admin-ops-health'], queryFn: getOpsHealth, refetchInterval: 60_000 });
  const done = (text: string) => {
    setMsg({ tone: 'success', text });
    void qc.invalidateQueries({ queryKey: ['admin-ops-health'] });
  };
  const fail = (e: unknown) => setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'Thao tác lỗi.' });
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
      {q.isError && <p className="text-sm text-danger-fg">Không tải được tình trạng hệ thống.</p>}
      {q.data && <HealthBody h={q.data} onOpenOrder={onOpenOrder} />}

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
        {msg && (
          <div className="mt-2">
            <Notice tone={msg.tone} role={msg.tone === 'danger' ? 'alert' : 'status'}>
              {msg.text}
            </Notice>
          </div>
        )}
      </section>
    </div>
  );
}

function HealthBody({ h, onOpenOrder }: { h: OpsHealth; onOpenOrder?: (code: string) => void }) {
  const t = h.thresholds;
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
        <Card title="Pancake">
          <Row label="Cấu hình" value={h.pancake.configured ? 'Đã cấu hình' : 'Chưa cấu hình'} warn={!h.pancake.configured} />
          <Row label="Đẩy đơn thành công gần nhất" value={ago(h.pancake.lastPushOkAt)} />
          <Row label="Nhận webhook gần nhất" value={ago(h.pancake.lastWebhookAt)} />
          <Row label="Xử lý webhook gần nhất" value={ago(h.pancake.lastWebhookProcessedAt)} />
          <Row label="Webhook lỗi 24 giờ" value={h.pancake.webhookFailed24h} warn={h.pancake.webhookFailed24h > 0} />
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
          {h.pancake.catalog.lastError && <p className="break-words text-xs text-stone-500">Lỗi gần nhất: {h.pancake.catalog.lastError}</p>}
        </Card>
        <Card title="Gomdon (thu gom tái chế)">
          <Row label="Cấu hình" value={h.gomdon.configured ? 'Đã cấu hình' : 'Chưa cấu hình'} />
          <Row label="Đăng nhập Gomdon" value={h.gomdon.credentialsRejected ? 'Bị từ chối' : h.gomdon.connection?.lastOkAt ? `OK ${ago(h.gomdon.connection.lastOkAt)}` : 'chưa gọi'} warn={h.gomdon.credentialsRejected} />
          <Row label="Nhận webhook gần nhất" value={ago(h.gomdon.lastWebhookAt)} />
          <Row label="Webhook lỗi 24 giờ" value={h.gomdon.webhookFailed24h} warn={h.gomdon.webhookFailed24h > 0} />
          <Row label="Báo động chưa xử lý" value={h.gomdon.openAlerts} warn={h.gomdon.openAlerts > 0} />
          <Row label="Đơn cần xử lý thu gom" value={h.gomdon.attention} warn={h.gomdon.attention > 0} />
          {h.gomdon.connection?.lastError && <p className="break-words text-xs text-stone-500">Lỗi gần nhất: {h.gomdon.connection.lastError}</p>}
        </Card>
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
                  <span className="text-xs text-stone-500"> · đặt {formatDateTime(o.createdAt)} · {o.pancakePushStatus ?? 'chưa đẩy'} · {o.pancakePushAttempts} lần thử</span>
                  {o.pancakeSyncError && <span className="block break-words text-xs text-danger-fg">{o.pancakeSyncError}</span>}
                </span>
                {onOpenOrder && (
                  <button type="button" onClick={() => onOpenOrder(o.code)} className="min-h-[44px] text-xs font-medium text-forest-700 hover:underline sm:min-h-0">
                    Mở đơn →
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
