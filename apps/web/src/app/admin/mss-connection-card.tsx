'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToneBadge } from '@/components/admin/ui';
import { getOpsHealth, type OpsHealth } from '@/lib/admin-client';
import { formatDateTime } from '@/lib/format-date';
import type { Tone } from '@/lib/recycling';

type EnvState = 'ok' | 'missing' | 'invalid';
type MssFlag = 'catalogEnrichment' | 'orderEvents' | 'customerSync' | 'orderPush' | 'orderStatus' | 'invoice' | 'catalogShadow' | 'stockSync' | 'orderRecipient' | 'cartAbandonedZalo';

/** Khoá `mss` của GET /admin/ops/health (MssOpsCard ở apps/api/src/modules/integrations/mss/mss-health.service.ts). */
export interface MssOpsCard {
  configured: boolean;
  env: Record<'MSS_BASE_URL' | 'MSS_KEY_ID' | 'MSS_OUTBOUND_SECRET' | 'MSS_INBOUND_SECRET' | 'MSS_INBOUND_SECRET_PREV', EnvState>;
  flags: { flag: MssFlag; key: string; enabled: boolean; capability: string; capabilityPublished: boolean | null; effective: boolean }[];
  orderEventsRolloutPct: number;
  orderConsentPrechecked: boolean;
  catalogSource: 'pancake' | 'mss';
  polling: boolean;
  health: { checkedAt: string; ok: boolean; capabilities: string[]; contract: string | Record<string, string> | null; error: string | null } | null;
  circuit: { state: 'closed' | 'open' | 'half_open'; consecutiveFailures: number; openUntil: string | null; lastFailureAt: string | null; lastFailureKind: string | null; sharedStore: 'ok' | 'unavailable' | 'none' };
}

const FLAG_LABEL: Record<MssFlag, string> = {
  catalogEnrichment: 'Làm giàu danh mục',
  orderEvents: 'Sự kiện đơn (tin Zalo)',
  customerSync: 'Đồng bộ khách',
  orderPush: 'Đẩy đơn qua MSS',
  orderStatus: 'Trạng thái đơn từ MSS',
  invoice: 'Hoá đơn qua MSS',
  catalogShadow: 'Đọc thử danh mục MSS',
  stockSync: 'Tồn kho MSS đẩy sang',
  orderRecipient: 'Tin giao hàng cho người nhận',
  cartAbandonedZalo: 'Nhắc giỏ bỏ quên qua Zalo',
};

const ENV_ORDER = ['MSS_BASE_URL', 'MSS_KEY_ID', 'MSS_OUTBOUND_SECRET', 'MSS_INBOUND_SECRET', 'MSS_INBOUND_SECRET_PREV'] as const;

function envBadge(name: (typeof ENV_ORDER)[number], state: EnvState): { tone: Tone; label: string } {
  if (state === 'ok') return { tone: 'success', label: 'Có' };
  if (state === 'invalid') return { tone: 'danger', label: 'Sai dạng' };
  // Khoá trước chỉ đặt trong lúc xoay khoá: thiếu là bình thường.
  return name === 'MSS_INBOUND_SECRET_PREV' ? { tone: 'neutral', label: 'Không đặt' } : { tone: 'warning', label: 'Thiếu' };
}

function contractText(c: string | Record<string, string> | null): string {
  if (!c) return 'không rõ';
  if (typeof c === 'string') return c;
  const parts = Object.entries(c).map(([k, v]) => `${k} ${v}`);
  return parts.length ? parts.join(', ') : 'không rõ';
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
      <dt className="min-w-0 break-words text-stone-700">{label}</dt>
      <dd className="m-0 flex flex-wrap items-center gap-1">{children}</dd>
    </div>
  );
}

/**
 * Thẻ "Kết nối MSS" ở tab Sức khoẻ hệ thống: biến môi trường có hay thiếu (không bao giờ có giá trị), lần dò `/health` gần nhất,
 * năng lực MSS công bố, cầu dao và cờ `mss.*`. Chỉ đọc; bật cờ ở tab Cấu hình, nhóm mss. Dùng chung truy vấn với tab nên không gọi
 * thêm API; tab đã hiện trạng thái chờ và lỗi của truy vấn đó.
 */
export function MssConnectionCard() {
  const q = useQuery({ queryKey: ['admin-ops-health'], queryFn: getOpsHealth });
  const mss = (q.data as (OpsHealth & { mss?: MssOpsCard | null }) | undefined)?.mss;
  if (mss === undefined) return null;

  return (
    <section aria-labelledby="mss-connection-title" className="mt-4 rounded-card border border-stone-200 bg-stone-0 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="mss-connection-title" className="m-0 font-display text-lg font-semibold text-stone-900">
          Kết nối MSS
        </h2>
        {mss && (
          <ToneBadge tone={mss.configured ? 'success' : 'neutral'}>{mss.configured ? 'Đã cấu hình' : 'Chưa cấu hình'}</ToneBadge>
        )}
      </div>
      {mss === null ? (
        <p role="status" className="mt-2 max-w-2xl text-sm text-stone-600">
          Không đọc được trạng thái kết nối MSS. Các phần khác của màn này không bị ảnh hưởng.
        </p>
      ) : (
        <MssCardBody mss={mss} />
      )}
    </section>
  );
}

function MssCardBody({ mss }: { mss: MssOpsCard }) {
  const anyEnabled = mss.flags.some((f) => f.enabled);
  const { circuit, health } = mss;
  const circuitBadge: { tone: Tone; label: string } =
    circuit.state === 'closed'
      ? { tone: 'success', label: 'Đóng' }
      : circuit.state === 'open'
        ? { tone: 'danger', label: circuit.openUntil ? `Ngắt đến ${formatDateTime(circuit.openUntil)}` : 'Ngắt' }
        : { tone: 'warning', label: 'Đang dò lại' };

  return (
    <div className="mt-2 space-y-3 text-sm">
      <p className="max-w-2xl text-stone-600">
        {!mss.configured
          ? 'Thiếu biến môi trường nên mọi cờ MSS coi như tắt và Tubu đi đường Pancake như cũ.'
          : anyEnabled || mss.catalogSource === 'mss'
            ? 'Có cờ MSS đang bật: Tubu dò sức khoẻ MSS 5 phút một lần. Cờ chỉ có hiệu lực khi MSS đã công bố năng lực tương ứng.'
            : 'Mọi cờ MSS đang tắt: Tubu không gọi MSS và đi đường Pancake như cũ.'}
      </p>

      <dl aria-label="Biến môi trường MSS" className="m-0 divide-y divide-stone-200 rounded-control border border-stone-200">
        {ENV_ORDER.map((name) => {
          const b = envBadge(name, mss.env[name]);
          return (
            <Row key={name} label={name}>
              <ToneBadge tone={b.tone}>{b.label}</ToneBadge>
            </Row>
          );
        })}
      </dl>

      <dl aria-label="Sức khoẻ MSS" className="m-0 divide-y divide-stone-200 rounded-control border border-stone-200">
        <Row label="Lần dò /health gần nhất">
          {health ? (
            <>
              <ToneBadge tone={health.ok ? 'success' : 'danger'}>{health.ok ? 'Tốt' : `Hỏng (${health.error ?? 'không rõ'})`}</ToneBadge>
              <span className="tabular-nums text-xs text-stone-600">{formatDateTime(health.checkedAt)}</span>
            </>
          ) : (
            <span className="text-stone-600">{mss.polling ? 'Chưa có kết quả trong 15 phút gần nhất' : 'Không dò (không cờ nào bật)'}</span>
          )}
        </Row>
        {health?.ok && (
          <>
            <Row label="Phiên bản hợp đồng">
              <span className="break-all text-stone-800">{contractText(health.contract)}</span>
            </Row>
            <Row label="Năng lực MSS công bố">
              {health.capabilities.length ? (
                health.capabilities.map((c) => (
                  <ToneBadge key={c} tone="info">
                    {c}
                  </ToneBadge>
                ))
              ) : (
                <span className="text-stone-600">Chưa có năng lực nào</span>
              )}
            </Row>
          </>
        )}
        <Row label="Cầu dao">
          <ToneBadge tone={circuitBadge.tone}>{circuitBadge.label}</ToneBadge>
          {circuit.consecutiveFailures > 0 && (
            <span className="text-xs text-stone-600">
              <span className="tabular-nums">{circuit.consecutiveFailures}</span> lỗi liên tiếp{circuit.lastFailureKind ? ` (gần nhất: ${circuit.lastFailureKind})` : ''}
            </span>
          )}
          {circuit.sharedStore === 'unavailable' && <span className="text-xs text-warning-fg">Redis không trả lời, cầu dao chỉ chạy trong tiến trình này</span>}
        </Row>
      </dl>

      <ul aria-label="Cờ MSS" className="m-0 list-none divide-y divide-stone-200 rounded-control border border-stone-200 p-0">
        {mss.flags.map((f) => (
          <li key={f.flag} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="min-w-0">
              <div className="break-words font-medium text-stone-800">{FLAG_LABEL[f.flag] ?? f.flag}</div>
              <div className="break-all text-xs text-stone-500">{f.key}</div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              <ToneBadge tone={f.enabled ? 'info' : 'neutral'}>{f.enabled ? 'Admin bật' : 'Tắt'}</ToneBadge>
              {f.enabled && (
                <ToneBadge tone={f.effective ? (circuit.state === 'closed' ? 'success' : 'danger') : 'warning'}>
                  {f.effective
                    ? circuit.state === 'closed'
                      ? 'Có hiệu lực'
                      : 'Có hiệu lực, cầu dao ngắt'
                    : f.capabilityPublished === false
                      ? `MSS chưa có "${f.capability}"`
                      : 'Chưa có hiệu lực'}
                </ToneBadge>
              )}
            </div>
          </li>
        ))}
      </ul>

      <dl aria-label="Thiết lập khác của MSS" className="m-0 space-y-1 text-xs text-stone-600">
        <div>
          <dt className="inline">Tỉ lệ đơn gửi sự kiện tin Zalo: </dt>
          <dd className="m-0 inline tabular-nums">{mss.orderEventsRolloutPct}%</dd>
        </div>
        <div>
          <dt className="inline">Ô đồng ý nhận tin Zalo tick sẵn: </dt>
          <dd className="m-0 inline">{mss.orderConsentPrechecked ? 'Có' : 'Không'}</dd>
        </div>
        <div>
          <dt className="inline">Nguồn SKU, giá, tồn kho: </dt>
          <dd className="m-0 inline">{mss.catalogSource === 'mss' ? 'MSS' : 'Pancake'}</dd>
        </div>
      </dl>
      <p className="max-w-2xl text-xs text-stone-500">Biến MSS_* đặt trong file .env trên máy chủ (không nhập ở admin). Cờ đổi ở tab Cấu hình, nhóm mss.</p>
    </div>
  );
}
