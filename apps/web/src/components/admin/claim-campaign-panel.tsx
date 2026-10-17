'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createCoupon,
  createCouponBatch,
  getConfig,
  getCouponBatchCodes,
  listCouponBatches,
  setCouponBatchActive,
  type CouponBatchSummary,
} from '@/lib/admin-client';
import { downloadCsvFile, generateClaimCodesCsv } from '@/lib/export-csv';
import { formatVnd } from '@/lib/shop-client';
import { formatDate } from '@/lib/format-date';
import { useConfirm } from './confirm-dialog';
import { BTN_PRIMARY, BTN_XS_SECONDARY, FIELD_CLASS, Field, Notice, TOUCH_H, ToneBadge, chipClass } from './ui';

const MINIAPP_BASE_URL_KEY = 'app.miniapp_base_url';
const BATCH_MAX = 2000;
type CouponType = 'PERCENT' | 'AMOUNT' | 'FREESHIP';
type Mode = 'batch' | 'shared';

/** Ngày của `<input type="date">` là ngày giờ VN: ghép giờ địa phương để "đến hết 31/12" không hết hạn lúc 7h sáng. */
function localDayIso(dayKey: string, endOfDay: boolean, fallbackMs: number): string {
  if (!dayKey) return new Date(fallbackMs).toISOString();
  return new Date(`${dayKey}T${endOfDay ? '23:59:59' : '00:00:00'}`).toISOString();
}

export function offerLabel(c: { type: CouponType; value: number; minOrder?: number | null; maxDiscount?: number | null }): string {
  const head =
    c.type === 'FREESHIP'
      ? 'Miễn phí ship'
      : c.type === 'PERCENT'
        ? `Giảm ${c.value}%${c.maxDiscount ? `, tối đa ${formatVnd(c.maxDiscount)}` : ''}`
        : `Giảm ${formatVnd(c.value)}`;
  return c.minOrder ? `${head} · đơn từ ${formatVnd(c.minOrder)}` : head;
}

export function claimLink(base: string, code: string): string {
  return `${base.trim().replace(/\/+$/, '')}/?claim=${encodeURIComponent(code)}`;
}

/**
 * Thẻ QR bỏ hộp hàng giao từ sàn (D2-03): tạo mã ẩn (chỉ vào ví khách quét thẻ), thường kèm "chỉ khách mới".
 * Lô mã riêng: mỗi thẻ một mã, xuất CSV (code, url) cho nhà in. Mã chung: một mã cho cả đợt, giới hạn tổng lượt nhận.
 * Mọi mức tiền do chủ dự án nhập; tạo xong mới có mã chạy.
 */
export function ClaimCampaignPanel() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [mode, setMode] = useState<Mode>('batch');
  const [f, setF] = useState({
    prefix: '',
    quantity: '',
    code: '',
    claimLimit: '',
    type: 'AMOUNT' as CouponType,
    value: '',
    minOrder: '',
    maxDiscount: '',
    startAt: '',
    endAt: '',
    newCustomerOnly: true,
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

  const configQ = useQuery({ queryKey: ['admin-config', 'app'], queryFn: () => getConfig('app') });
  const baseRow = configQ.data?.find((r) => r.key === MINIAPP_BASE_URL_KEY);
  const base = typeof baseRow?.value === 'string' ? baseRow.value.trim() : '';
  const batchesQ = useQuery({ queryKey: ['admin-coupon-batches'], queryFn: listCouponBatches });

  const money = () => ({
    type: f.type,
    value: f.type === 'FREESHIP' ? 0 : Number(f.value),
    minOrder: num(f.minOrder),
    maxDiscount: num(f.maxDiscount),
    startAt: localDayIso(f.startAt, false, Date.now()),
    endAt: localDayIso(f.endAt, true, Date.now() + 30 * 864e5),
    newCustomerOnly: f.newCustomerOnly,
  });

  const createBatch = useMutation({
    mutationFn: () => createCouponBatch({ prefix: f.prefix, quantity: Number(f.quantity), ...money() }),
    onSuccess: (res) => {
      downloadCsvFile(generateClaimCodesCsv(res.codes), `the-hop-hang-${res.batch}.csv`);
      setMsg({ ok: true, text: `Đã tạo ${res.created} mã lô ${res.batch} và tải file CSV để in QR.` });
      void qc.invalidateQueries({ queryKey: ['admin-coupon-batches'] });
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không tạo được lô mã.' }),
  });

  const createShared = useMutation({
    mutationFn: () =>
      createCoupon({ code: f.code, ...money(), usageLimit: num(f.claimLimit), perUserLimit: 1, scope: 'CLAIM' }),
    onSuccess: () => {
      setMsg({
        ok: true,
        text: base ? `Đã tạo mã ${f.code}. Link in QR: ${claimLink(base, f.code)}` : `Đã tạo mã ${f.code}. Đặt link Mini App để có link in QR.`,
      });
      void qc.invalidateQueries({ queryKey: ['admin-coupons'] });
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không tạo được mã.' }),
  });

  const exportBatch = useMutation({
    mutationFn: (batch: string) => getCouponBatchCodes(batch),
    onSuccess: (res) => downloadCsvFile(generateClaimCodesCsv(res.codes), `the-hop-hang-${res.batch}.csv`),
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không tải được file mã.' }),
  });

  const toggleBatch = useMutation({
    mutationFn: (v: { batch: string; isActive: boolean }) => setCouponBatchActive(v.batch, v.isActive),
    onSuccess: (res, v) => {
      setMsg({ ok: true, text: v.isActive ? `Đã bật lại ${res.updated} mã lô ${res.batch}.` : `Đã tắt ${res.updated} mã lô ${res.batch}.` });
      void qc.invalidateQueries({ queryKey: ['admin-coupon-batches'] });
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không đổi được trạng thái lô.' }),
  });

  const askToggle = async (b: CouponBatchSummary) => {
    setMsg(null);
    const turnOff = b.active > 0;
    const ok = await confirm(
      turnOff
        ? {
            title: `Tắt lô ${b.batch}`,
            message: 'Mọi thẻ của lô không nhận và không áp được nữa (đơn đã đặt bằng mã vẫn giữ nguyên). Dùng khi thẻ bị lộ. Bật lại được.',
            confirmLabel: 'Tắt lô',
            tone: 'danger',
          }
        : {
            title: `Bật lại lô ${b.batch}`,
            message:
              'Mọi mã của lô bật lại, kể cả mã đã tắt riêng ở danh sách "Mã đã tạo". Mã nào cần giữ tắt thì tìm theo mã và tắt lại sau khi bật lô.',
            confirmLabel: 'Bật lại lô',
          },
    );
    if (!ok) return;
    toggleBatch.mutate({ batch: b.batch, isActive: !turnOff });
  };

  const valueMissing = f.type !== 'FREESHIP' && !(Number(f.value) > 0);
  const quantity = Number(f.quantity);
  const batchReady = /^[A-Z0-9]{2,16}$/.test(f.prefix) && Number.isInteger(quantity) && quantity >= 1 && quantity <= BATCH_MAX && !valueMissing;
  const claimLimit = Number(f.claimLimit);
  const sharedReady = /^[A-Z0-9_-]{3,40}$/.test(f.code) && Number.isInteger(claimLimit) && claimLimit >= 1 && !valueMissing;
  const field = `${FIELD_CLASS} ${TOUCH_H} w-full`;

  return (
    <section aria-label="Thẻ hộp hàng sàn" className="space-y-3 rounded-card border border-stone-200 bg-stone-0 p-4" data-testid="claim-campaign-panel">
      <div>
        <h2 className="font-display text-sm font-semibold text-stone-900">Thẻ hộp hàng sàn (mã ẩn)</h2>
        <p className="mt-0.5 text-xs text-stone-600">
          Mã chỉ vào ví khách quét QR trên thẻ (hoặc gõ mã ở giỏ). Không hiện cho khách khác. Chưa tạo đợt nào thì không có mã nào chạy.
        </p>
      </div>
      {configQ.isSuccess && !base && (
        <Notice tone="warning" role="status">
          Chưa đặt link Mini App (khoá {MINIAPP_BASE_URL_KEY} ở tab Cấu hình, vd https://zalo.me/s/&lt;appId&gt;). Link trong file CSV
          sẽ là đường dẫn tương đối, chưa in QR được.
        </Notice>
      )}

      <div className="flex flex-wrap gap-1" role="group" aria-label="Kiểu đợt thẻ">
        <button type="button" aria-pressed={mode === 'batch'} className={chipClass(mode === 'batch')} onClick={() => setMode('batch')}>
          Lô mã riêng (mỗi thẻ một mã)
        </button>
        <button type="button" aria-pressed={mode === 'shared'} className={chipClass(mode === 'shared')} onClick={() => setMode('shared')}>
          Một mã chung cho cả đợt
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {mode === 'batch' ? (
          <>
            <Field label="Tiền tố lô" hint="2–16 chữ in hoa/số, vd SHOPEE11. Mã in ra: SHOPEE11-XXXXXXXX.">
              <input
                aria-label="Tiền tố lô"
                value={f.prefix}
                onChange={(e) => setF({ ...f, prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                className={field}
              />
            </Field>
            <Field label="Số thẻ" hint={`1–${BATCH_MAX} mã mỗi lô, mỗi mã một khách nhận, dùng một lần.`}>
              <input type="number" aria-label="Số thẻ" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} className={field} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Mã chung" hint="In cùng một mã lên mọi thẻ của đợt, vd SHOPEETHANG11.">
              <input
                aria-label="Mã chung"
                value={f.code}
                onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/\s+/g, '') })}
                className={field}
              />
            </Field>
            <Field label="Tổng lượt nhận" hint="Bắt buộc, từ 1 trở lên: mã chung lộ ra ngoài thì hết lượt là dừng. Mỗi khách nhận và dùng một lần.">
              <input type="number" aria-label="Tổng lượt nhận" value={f.claimLimit} onChange={(e) => setF({ ...f, claimLimit: e.target.value })} className={field} />
            </Field>
          </>
        )}
        <Field label="Loại ưu đãi">
          <select aria-label="Loại ưu đãi" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as CouponType })} className={field}>
            <option value="AMOUNT">Giảm tiền</option>
            <option value="PERCENT">% giảm</option>
            <option value="FREESHIP">Freeship</option>
          </select>
        </Field>
        {f.type !== 'FREESHIP' && (
          <Field label={f.type === 'PERCENT' ? 'Mức giảm (%)' : 'Mức giảm (đ)'}>
            <input type="number" aria-label="Mức giảm" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} className={field} />
          </Field>
        )}
        <Field label="Đơn tối thiểu (đ)" hint="Bỏ trống = không yêu cầu.">
          <input type="number" aria-label="Đơn tối thiểu" value={f.minOrder} onChange={(e) => setF({ ...f, minOrder: e.target.value })} className={field} />
        </Field>
        {f.type === 'PERCENT' && (
          <Field label="Giảm tối đa (đ)" hint="Bắt buộc với mã từ 50%.">
            <input type="number" aria-label="Giảm tối đa" value={f.maxDiscount} onChange={(e) => setF({ ...f, maxDiscount: e.target.value })} className={field} />
          </Field>
        )}
        <Field label="Bắt đầu từ ngày" hint="Bỏ trống = từ hôm nay.">
          <input type="date" aria-label="Thẻ bắt đầu từ ngày" value={f.startAt} onChange={(e) => setF({ ...f, startAt: e.target.value })} className={field} />
        </Field>
        <Field label="Hết hạn ngày" hint="Bỏ trống = 30 ngày. Nên tính cả thời gian thẻ nằm trong kho.">
          <input type="date" aria-label="Thẻ hết hạn ngày" value={f.endAt} onChange={(e) => setF({ ...f, endAt: e.target.value })} className={field} />
        </Field>
      </div>
      <label className={`flex items-center gap-2 text-sm text-stone-800 ${TOUCH_H}`}>
        <input type="checkbox" checked={f.newCustomerOnly} onChange={(e) => setF({ ...f, newCustomerOnly: e.target.checked })} className="h-5 w-5" />
        Chỉ khách mới (chưa có đơn nào tại Tubu Tree, trừ đơn huỷ)
      </label>

      {mode === 'batch' ? (
        <button type="button" className={`${BTN_PRIMARY} w-full`} disabled={!batchReady || createBatch.isPending} onClick={() => createBatch.mutate()}>
          {createBatch.isPending ? 'Đang tạo lô...' : 'Tạo lô và tải CSV'}
        </button>
      ) : (
        <button type="button" className={`${BTN_PRIMARY} w-full`} disabled={!sharedReady || createShared.isPending} onClick={() => createShared.mutate()}>
          {createShared.isPending ? 'Đang tạo mã...' : 'Tạo mã chung'}
        </button>
      )}
      {msg && (
        <p role="status" className={`break-words text-sm ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
          {msg.text}
        </p>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-stone-900">Các lô đã tạo</h3>
        {batchesQ.isLoading && <p className="text-sm text-stone-500">Đang tải các lô...</p>}
        {batchesQ.isError && <p className="text-sm text-danger-fg">Không tải được các lô mã.</p>}
        {batchesQ.data?.length === 0 && <p className="text-sm text-stone-500">Chưa có lô nào.</p>}
        <ul className="space-y-2">
          {batchesQ.data?.map((b) => (
            <li key={b.batch} className="rounded-control border border-stone-200 p-3 text-sm" data-testid={`claim-batch-${b.batch}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono font-semibold text-stone-900">{b.batch}</span>
                <div className="flex flex-wrap gap-1">
                  {b.newCustomerOnly && <ToneBadge tone="info">Chỉ khách mới</ToneBadge>}
                  {b.active === 0 ? <ToneBadge tone="danger">Đã tắt</ToneBadge> : <ToneBadge tone="success">Đang bật</ToneBadge>}
                </div>
              </div>
              <p className="mt-1 text-stone-700">{offerLabel(b)}</p>
              <p className="mt-0.5 text-xs text-stone-500">
                {formatDate(b.startAt)} – {formatDate(b.endAt)} · {b.total} thẻ · Đã nhận {b.claimed} · Đã dùng {b.used}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={BTN_XS_SECONDARY} disabled={exportBatch.isPending} onClick={() => exportBatch.mutate(b.batch)}>
                  Tải lại CSV
                </button>
                <button type="button" className={BTN_XS_SECONDARY} disabled={toggleBatch.isPending} onClick={() => void askToggle(b)}>
                  {b.active > 0 ? 'Tắt lô' : 'Bật lại lô'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
      {dialog}
    </section>
  );
}
