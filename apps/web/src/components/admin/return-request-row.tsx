'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  markReturnReceived,
  previewReturnRequest,
  reviewReturnRequest,
  type AdminReturnPreview,
  type AdminReturnRequest,
} from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';
import { formatDateTime } from '@/lib/format-date';
import { PAYMENT_METHOD_LABELS } from '@/lib/export-csv';
import { useConfirm } from './confirm-dialog';
import { EvidenceImages } from './evidence-images';
import { BTN_DANGER_OUTLINE, BTN_PRIMARY, BTN_SECONDARY, FIELD_CLASS, TOUCH_H, Field } from './ui';

const REJECT_NOTE_MIN = 3;

function bankText(b: {
  bankName?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
}) {
  return `${b.bankName || 'Ngân hàng'} ${b.accountNumber ?? ''}${b.accountName ? ` (${b.accountName})` : ''}`;
}

function destinationText(d: AdminReturnPreview['destination']) {
  if (d.method === 'END_CUSTOMER')
    return 'Khách cuối của đơn CTV lên hộ — theo hàng chờ "Hoàn tiền khách"';
  if (d.method === 'BANK')
    return `Chuyển khoản về ${bankText(d)} — vào tab "Hoàn tiền khách" sau khi duyệt`;
  return 'Về Ví Tubu của khách (cộng ngay khi duyệt)';
}

function errorText(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * Một yêu cầu đổi/trả trong tab Đổi / Trả (D3): khách xin trả dòng nào, bao nhiêu; admin xem số tiền BE tính sẵn
 * (phân bổ giảm giá/điểm, phí ship khi trả cả đơn hoặc lỗi do Tubu) rồi xác nhận; kho chỉ cộng khi hàng về.
 */
export function ReturnRow({
  item: r,
  canReview = true,
  canReceive = true,
}: {
  item: AdminReturnRequest;
  canReview?: boolean;
  canReceive?: boolean;
}) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [note, setNote] = useState(r.adminNote ?? '');
  const [confirming, setConfirming] = useState(false);
  const [shopFault, setShopFault] = useState<boolean | undefined>(undefined);
  const [noteError, setNoteError] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: ['admin-return-preview', r.id, shopFault],
    queryFn: () => previewReturnRequest(r.id, shopFault),
    enabled: confirming,
    staleTime: 0,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-returns'] });
    void qc.invalidateQueries({ queryKey: ['admin-orders'] });
    void qc.invalidateQueries({ queryKey: ['admin-customer-refunds'] });
  };
  const approve = useMutation({
    mutationFn: (p: AdminReturnPreview) =>
      reviewReturnRequest(r.id, true, note.trim() || undefined, {
        shopFault: p.shopFault,
        expectedRefund: p.refund,
      }),
    onSuccess: () => {
      setConfirming(false);
      refresh();
    },
    onError: () => void preview.refetch(),
  });
  const reject = useMutation({
    mutationFn: () => reviewReturnRequest(r.id, false, note.trim()),
    onSuccess: refresh,
  });
  const received = useMutation({ mutationFn: () => markReturnReceived(r.id), onSuccess: refresh });

  const orderCode = r.order?.code ?? r.orderId;
  const askReject = async () => {
    if (note.trim().length < REJECT_NOTE_MIN) {
      setNoteError('Ghi lý do từ chối để báo cho khách (tối thiểu 3 ký tự).');
      return;
    }
    // Ô ghi chú dùng chung cho duyệt và từ chối nên có thể còn chữ gõ cho yêu cầu khác: đọc lại đúng lý do khách sẽ nhận.
    const ok = await confirm({
      title: 'Từ chối yêu cầu đổi/trả',
      message: `Từ chối yêu cầu đổi/trả của đơn ${orderCode}? Khách sẽ nhận thông báo từ chối kèm lý do:\n"${note.trim()}"`,
      confirmLabel: 'Từ chối',
      cancelLabel: 'Không từ chối',
      tone: 'danger',
    });
    if (ok) reject.mutate();
  };
  const askReceived = async () => {
    const ok = await confirm({
      title: 'Đã nhận hàng trả về?',
      message: `Xác nhận kho đã nhận hàng trả của đơn ${orderCode}? Hàng sẽ được cộng lại vào kho ngay.`,
      confirmLabel: 'Đã nhận hàng về',
    });
    if (ok) received.mutate();
  };

  const statusBadge =
    r.status === 'APPROVED' ? (
      <span className="rounded bg-success-bg px-2 py-0.5 text-xs font-semibold text-success-fg">
        Đã duyệt (Hoàn tiền)
      </span>
    ) : r.status === 'REJECTED' ? (
      <span className="rounded bg-danger-bg px-2 py-0.5 text-xs font-semibold text-danger-fg">
        Đã từ chối
      </span>
    ) : (
      <span className="rounded bg-warning-bg px-2 py-0.5 text-xs font-semibold text-warning-fg">
        Chờ duyệt
      </span>
    );

  const p = preview.data;
  const busy = approve.isPending || reject.isPending;
  const merchantStore = r.order?.fulfiller === 'MERCHANT' ? (r.order.fulfillerStorefront?.title ?? 'Gian hàng đối tác') : null;
  const paidMoney = (r.refundAmount ?? 0) + (r.shippingRefund ?? 0);

  return (
    <div className="rounded-card border border-stone-200 bg-stone-0 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-stone-900">Đơn: {r.order?.code ?? r.orderId}</span>
            {statusBadge}
            {r.fullReturn && (
              <span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">
                Trả cả đơn
              </span>
            )}
            {merchantStore && (
              <span className="rounded bg-info-bg px-2 py-0.5 text-xs font-medium text-info-fg">
                {merchantStore} tự giao
              </span>
            )}
          </div>
          <div className="mt-0.5 text-sm text-stone-600">
            Khách:{' '}
            <span className="font-medium text-stone-800">{r.user?.fullName ?? 'Khách hàng'}</span>
            {r.user?.phone ? ` · SĐT: ${r.user.phone}` : ''}
            {r.order ? ` · Tổng đơn: ${formatVnd(r.order.total)} (${PAYMENT_METHOD_LABELS[r.order.paymentMethod] ?? r.order.paymentMethod})` : ''}
          </div>
        </div>
        <span className="text-xs text-stone-500">{formatDateTime(r.createdAt)}</span>
      </div>

      {!!r.items?.length && (
        <ul
          aria-label="Sản phẩm khách trả"
          className="mt-2.5 divide-y divide-stone-200 rounded-control border border-stone-200 text-sm"
        >
          {r.items.map((it) => (
            <li
              key={it.orderItemId}
              className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5"
            >
              <span className="min-w-0 break-words text-stone-800">
                {it.productName ?? 'Sản phẩm'}
                {it.variationName ? ` · ${it.variationName}` : ''}
              </span>
              <span className="text-xs font-medium text-stone-700">
                Trả {it.quantity}
                {it.orderedQuantity ? `/${it.orderedQuantity}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2.5 break-words rounded-control bg-stone-50 p-2.5 text-sm text-stone-700">
        <span className="font-medium text-stone-800">Lý do:</span>{' '}
        {r.reasonLabel ? `${r.reasonLabel}. ` : ''}
        {r.reason && r.reason !== r.reasonLabel ? r.reason : ''}
        {r.refundMethod === 'BANK' && r.bankAccountNo && (
          <div className="mt-1 text-xs text-stone-600">
            Khách muốn nhận: chuyển khoản{' '}
            {bankText({
              bankName: r.bankName,
              accountNumber: r.bankAccountNo,
              accountName: r.bankAccountName,
            })}
          </div>
        )}
      </div>

      <EvidenceImages images={r.images} />

      {r.status === 'REQUESTED' && !canReview && (
        <p className="mt-3 border-t border-stone-200 pt-3 text-xs text-stone-500">Chờ CSKH hoặc admin duyệt.</p>
      )}
      {r.status === 'REQUESTED' && canReview && (
        <div className="mt-3 border-t border-stone-200 pt-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Ghi chú duyệt / lý do từ chối (bắt buộc khi từ chối)" className="grow basis-full sm:basis-60">
              <input
                aria-label="Ghi chú duyệt / lý do từ chối"
                placeholder="Ghi chú duyệt hoặc lý do từ chối"
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setNoteError(null);
                }}
                className={`${FIELD_CLASS} ${TOUCH_H} w-full`}
              />
            </Field>
            {!confirming && (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={busy}
                className={BTN_PRIMARY}
              >
                Duyệt hoàn tiền
              </button>
            )}
            <button
              type="button"
              onClick={() => void askReject()}
              disabled={busy}
              className={BTN_DANGER_OUTLINE}
            >
              {reject.isPending ? 'Đang từ chối…' : 'Từ chối'}
            </button>
          </div>
          {noteError && (
            <p role="alert" className="mt-1 text-xs text-danger-fg">
              {noteError}
            </p>
          )}
          {reject.isError && (
            <p role="alert" className="mt-1 text-xs text-danger-fg">
              {errorText(reject.error, 'Không từ chối được yêu cầu.')}
            </p>
          )}

          {confirming && (
            <div
              role="group"
              aria-label="Xác nhận duyệt đổi/trả"
              className="mt-3 rounded-control border border-warning-fg bg-warning-bg p-3"
            >
              {preview.isLoading && (
                <p className="text-sm text-stone-700">Đang tính số tiền hoàn…</p>
              )}
              {preview.isError && (
                <>
                  <p role="alert" className="text-sm text-danger-fg">
                    {errorText(preview.error, 'Không tính được số tiền hoàn.')}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setConfirming(false)} className={BTN_SECONDARY}>
                      Quay lại
                    </button>
                    <button
                      type="button"
                      onClick={() => void preview.refetch()}
                      disabled={preview.isFetching}
                      className={BTN_PRIMARY}
                    >
                      Thử lại
                    </button>
                  </div>
                </>
              )}
              {p && (
                <>
                  <p className="text-sm font-semibold text-stone-900">
                    {p.isFull ? 'Trả cả đơn' : 'Trả một phần'} — kiểm tra trước khi duyệt
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-stone-800">
                    {p.lines.map((l) => (
                      <li key={l.orderItemId} className="flex flex-wrap justify-between gap-2">
                        <span className="min-w-0 break-words">
                          {l.productName}
                          {l.variationName ? ` · ${l.variationName}` : ''} ×{l.quantity}
                        </span>
                        <span className="font-medium tabular-nums">
                          {formatVnd(l.refundAmount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border-t border-stone-200 pt-2 text-sm">
                    <dt className="text-stone-600">Phí ship hoàn</dt>
                    <dd className="text-right tabular-nums">{formatVnd(p.shipping)}</dd>
                    <dt className="font-semibold text-stone-900">Tổng hoàn</dt>
                    <dd className="text-right font-semibold tabular-nums text-stone-900">
                      {formatVnd(p.refund)}
                    </dd>
                  </dl>
                  {p.moneyRefundable ? (
                    <p className="mt-1 text-xs text-stone-700">{destinationText(p.destination)}</p>
                  ) : (
                    <p className="mt-1 text-xs text-stone-700">
                      Đơn chưa thu tiền nên không hoàn tiền, chỉ đảo điểm và hoa hồng.
                    </p>
                  )}
                  {(p.pointsUsedBack > 0 || p.pointsEarnedBack > 0) && (
                    <p className="mt-1 text-xs text-stone-700">
                      {[
                        p.pointsUsedBack > 0
                          ? `Trả lại ${p.pointsUsedBack} Điểm Xanh khách đã dùng`
                          : '',
                        p.pointsEarnedBack > 0
                          ? `Thu hồi ${p.pointsEarnedBack} Điểm Xanh đã tích`
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                  <label className="mt-2 flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-stone-800 sm:min-h-[36px]">
                    <input
                      type="checkbox"
                      checked={p.shopFault}
                      onChange={(e) => setShopFault(e.target.checked)}
                      className="h-4 w-4 accent-forest-600"
                    />
                    {p.returnTo?.kind === 'MERCHANT' ? `Lỗi do gian hàng ${p.returnTo.name}` : 'Lỗi do Tubu'} (hoàn cả phí ship dù chỉ trả một phần)
                  </label>
                  {p.pancakeTask && (
                    <p className="mt-1 text-xs font-medium text-warning-fg">
                      Đơn giao qua Pancake: sau khi duyệt, tạo phiếu trả/nhận hàng về trên Pancake.
                    </p>
                  )}
                  <p className="mt-1 text-xs text-stone-600">
                    {p.returnTo?.kind === 'MERCHANT'
                      ? `Hàng trả về ${p.returnTo.name}, không về kho Tubu — gian hàng xác nhận nhận hàng và tự cộng kho; khoản đã quyết toán cho gian hàng được trừ lại ở kỳ sau.`
                      : 'Kho chỉ cộng lại khi bấm "Đã nhận hàng về".'}
                  </p>
                  {approve.isError && (
                    <p role="alert" className="mt-2 text-sm text-danger-fg">
                      {errorText(approve.error, 'Không duyệt được yêu cầu.')}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      disabled={busy}
                      className={BTN_SECONDARY}
                    >
                      Quay lại
                    </button>
                    <button
                      type="button"
                      onClick={() => approve.mutate(p)}
                      disabled={busy || preview.isFetching}
                      className={BTN_PRIMARY}
                    >
                      {approve.isPending ? 'Đang duyệt…' : `Xác nhận hoàn ${formatVnd(p.refund)}`}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {r.status !== 'REQUESTED' && (
        <div className="mt-3 space-y-1 border-t border-stone-200 pt-2 text-xs text-stone-500">
          {r.status === 'APPROVED' && r.refundAmount != null && (
            <div className="text-stone-700">
              {paidMoney > 0
                ? approvedRefundText(r, paidMoney)
                : 'Không có khoản tiền cần hoàn.'}
            </div>
          )}
          {r.adminNote && (
            <div>
              Ghi chú admin: <span className="font-medium text-stone-700">{r.adminNote}</span>
            </div>
          )}
          {r.reviewedAt && <div>Xử lý lúc: {formatDateTime(r.reviewedAt)}</div>}
          {r.status === 'APPROVED' &&
            !!r.items?.length &&
            (r.receivedAt ? (
              <div>
                {merchantStore ? `${merchantStore} đã nhận hàng trả` : 'Đã nhận hàng về'} lúc {formatDateTime(r.receivedAt)} (đã cộng kho).
              </div>
            ) : merchantStore ? (
              <div className="pt-1 text-warning-fg">Hàng trả về gian hàng {merchantStore} — chờ gian hàng xác nhận đã nhận.</div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-warning-fg">Chưa nhận hàng trả về — kho chưa cộng.</span>
                {canReceive && (
                  <button
                    type="button"
                    onClick={() => void askReceived()}
                    disabled={received.isPending}
                    className={BTN_SECONDARY}
                  >
                    {received.isPending ? 'Đang ghi nhận…' : 'Đã nhận hàng về'}
                  </button>
                )}
              </div>
            ))}
          {received.isError && (
            <p role="alert" className="text-danger-fg">
              {errorText(received.error, 'Không ghi nhận được.')}
            </p>
          )}
        </div>
      )}
      {dialog}
    </div>
  );
}

/**
 * Câu tiền hoàn của yêu cầu đã duyệt theo khoản hoàn thật (R2-LIFECYCLE-6): chuyển khoản chưa xong thì "Chờ chuyển
 * khoản", không nói "Đã hoàn"; khách đã đổi sang Ví thì nói Ví.
 */
export function approvedRefundText(r: AdminReturnRequest, paidMoney: number): string {
  const breakdown = `(tiền hàng ${formatVnd(r.refundAmount ?? 0)} + phí ship ${formatVnd(r.shippingRefund ?? 0)})`;
  const viaBank = r.refund ? r.refund.method === 'MANUAL_TRANSFER' : r.refundMethod === 'BANK';
  if (!viaBank) return `Đã hoàn ${formatVnd(paidMoney)} ${breakdown} về Ví Tubu`;
  if (r.refund?.status === 'COMPLETED') return `Đã chuyển khoản ${formatVnd(paidMoney)} ${breakdown} cho khách`;
  const stage = r.refund?.status === 'PROCESSING' ? 'Đang chuyển khoản' : 'Chờ chuyển khoản';
  return `${stage} ${formatVnd(paidMoney)} ${breakdown} — xử lý ở tab "Hoàn tiền khách"`;
}
