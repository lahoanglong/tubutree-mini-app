'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMerchantSettlement, type MerchantPayout, type MerchantSettlement } from '@/lib/merchant-client';
import { payoutStatus, payoutToTubu } from '@/lib/merchant-payout';
import { formatVnd } from '@/lib/shop-client';
import { formatDate } from '@/lib/format-date';
import { Notice, ToneBadge } from '@/components/admin/ui';
import { ConsignmentExcludedList, SettlementTable, consignmentFeesText, signedVnd } from '@/components/settlement-table';

export { isPartialReturnLine, signedVnd } from '@/components/settlement-table';

/**
 * "Đối soát" của gian hàng: khoản đã đủ hạn chờ lập phiếu, khoản sắp đủ hạn và các phiếu Tubu đã lập — gồm cả đơn gian hàng
 * tự giao và hàng "Tubu giao hộ" (mỗi món một khoản).
 */
export function SettlementTab() {
  const q = useQuery({ queryKey: ['merchant-settlement'], queryFn: getMerchantSettlement });
  if (q.isLoading) return <p className="text-sm text-stone-500">Đang tải bảng kê đối soát…</p>;
  if (q.isError || !q.data) return <p className="text-sm text-danger-fg">Không tải được bảng kê đối soát.</p>;
  const s = q.data;
  const terms = s.consignmentTerms ?? null;

  return (
    <div className="space-y-5">
      <Notice>
        Mỗi đơn bạn tự giao: thực nhận = tiền khách thực trả cho hàng + phí giao − phí sàn Tubu − tiền COD bạn đã tự thu của
        khách. Hàng của bạn bán theo giá lẻ niêm yết (hoặc giá giờ vàng khi Tubu Tree đưa món vào giờ vàng). Phần mã giảm giá
        của khách và giảm giá hạng thành viên áp cho món của bạn được trừ vào số tiền của bạn (mã chỉ áp cho món khác không trừ
        vào món của bạn). Khách không trả hàng của bạn bằng Điểm Xanh; hàng của bạn không bán giá đại lý, không đặt định kỳ,
        không vào combo hay mua chung. Khách trả bằng Ví Tubu vẫn tính đủ giá trị món; phí sàn theo mức chốt lúc khách đặt
        đơn. Đơn được đưa vào
        bảng kê sau {s.holdDays} ngày kể từ khi giao (hết hạn đổi/trả). Phiếu dương: Tubu Tree chuyển khoản vào tài khoản nhận
        đối soát của gian hàng. Phiếu âm (hay gặp với đơn COD vì bạn đã giữ tiền mặt của khách): bạn nộp phần phí sàn cho Tubu
        trong {s.negativeDueDays ?? 7} ngày kể từ khi lập phiếu. Đơn bị trả: Tubu Tree hoàn tiền cho khách, bạn nhận hàng về và nộp
        lại phần đã nhận cho đơn đó; đơn COD là đúng số tiền mặt bạn đã thu. Khách trả một phần đơn đã đối soát: kỳ sau có
        dòng &quot;trả một phần&quot; trừ lại đúng phần hàng trả.
      </Notice>
      {terms && (
        <Notice>
          Hàng Tubu giao hộ: kho Tubu Tree giao và thu tiền của khách, mỗi món là một khoản trên cùng phiếu đối soát. Thực nhận =
          số tiền khách thực trả cho món (giá bán của món, kể cả giá giờ vàng, đã trừ phần mã giảm giá của khách và giảm giá
          hạng thành viên áp cho chính món đó; mã chỉ áp cho món khác không trừ vào món của bạn; Điểm Xanh không dùng cho hàng
          của bạn) − {consignmentFeesText(terms)} (mức hiện tại; mỗi đơn tính theo mức áp dụng lúc khách đặt). Khách trả bằng Ví
          Tubu vẫn tính đủ giá trị món. Phí giao hàng do Tubu Tree thu và chịu, không tính
          vào khoản của bạn. Món được đưa vào bảng kê sau {s.holdDays} ngày kể từ khi giao, chỉ đơn Tubu Tree đã thu được tiền (trả
          trước đã thanh toán hoặc COD); khách trả món đã đối soát thì kỳ sau có khoản trừ lại, hàng trả về kho Tubu Tree.
        </Notice>
      )}

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display font-semibold text-stone-900">Chờ lập phiếu ({s.lines.length} khoản)</h2>
          <p className="text-sm text-stone-700">
            Tổng: <span className={`font-semibold ${s.total < 0 ? 'text-danger-fg' : 'text-forest-700'}`}>{signedVnd(s.total)}</span>
          </p>
        </div>
        {s.lines.length === 0 ? (
          <p className="rounded-card border border-stone-200 bg-stone-0 p-4 text-center text-xs text-stone-500">Chưa có khoản nào đủ hạn đối soát.</p>
        ) : (
          <SettlementTable lines={s.lines} label="Khoản chờ lập phiếu đối soát" dateHeader="Ngày giao" dateOf={(l) => l.deliveredAt} />
        )}
      </section>

      {s.upcoming.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display font-semibold text-stone-900">Sắp đủ hạn ({s.upcoming.length} khoản)</h2>
          <SettlementTable
            lines={s.upcoming}
            label="Khoản sắp đủ hạn đối soát"
            dateHeader="Đối soát từ"
            dateOf={(l) => l.availableAt}
          />
        </section>
      )}

      <ConsignmentExcludedList data={s.consignmentExcluded} />

      <section className="space-y-2">
        <h2 className="font-display font-semibold text-stone-900">Phiếu đối soát</h2>
        {s.payouts.length === 0 ? (
          <p className="rounded-card border border-stone-200 bg-stone-0 p-4 text-center text-xs text-stone-500">Tubu Tree chưa lập phiếu nào cho gian hàng.</p>
        ) : (
          <ul className="space-y-2">
            {s.payouts.map((p) => (
              <PayoutItem key={p.id} payout={p} tubuAccount={s.tubuAccount ?? null} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PayoutItem({ payout: p, tubuAccount }: { payout: MerchantPayout; tubuAccount: MerchantSettlement['tubuAccount'] }) {
  const toTubu = payoutToTubu(p);
  const status = payoutStatus(p);
  const owe = toTubu && p.status === 'PENDING';
  const cancelled = p.status === 'CANCELLED';
  const amount = toTubu
    ? `${p.status === 'PAID' ? 'Đã nộp' : cancelled ? 'Phiếu nộp' : 'Bạn cần nộp'} ${formatVnd(-p.amount)}`
    : `${p.status === 'PAID' ? 'Tubu đã chuyển' : cancelled ? 'Phiếu chuyển' : 'Tubu sẽ chuyển'} ${formatVnd(p.amount)}`;
  return (
    <li
      aria-label={`Phiếu ${p.transferMemo ?? p.id}`}
      className={`space-y-2 rounded-card border bg-stone-0 p-3 text-sm shadow-card ${owe ? 'border-warning-fg' : 'border-stone-200'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`font-semibold ${cancelled ? 'text-stone-500 line-through' : toTubu ? 'text-danger-fg' : 'text-stone-900'}`}>{amount}</span>
        <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
        <span className="text-xs text-stone-500">
          lập {formatDate(p.createdAt)}
          {p.paidAt ? ` · ${toTubu ? 'thu' : 'chuyển'} ${formatDate(p.paidAt)}` : ''}
          {p.bankRef ? ` · mã GD ${p.bankRef}` : ''}
        </span>
      </div>
      {cancelled && (
        <div className="space-y-0.5 rounded-control bg-stone-100 px-3 py-2 text-xs text-stone-700">
          <p>
            Tubu Tree đã huỷ phiếu này{p.cancelledAt ? ` ngày ${formatDate(p.cancelledAt)}` : ''}
            {p.cancelReason ? `: ${p.cancelReason}` : ''}.
          </p>
          <p>
            {toTubu
              ? 'Bạn chưa cần nộp khoản này; nếu đã chuyển khoản, liên hệ Tubu Tree để đối chiếu. '
              : ''}
            Các khoản của phiếu đã quay lại bảng kê và sẽ vào phiếu mới.
          </p>
        </div>
      )}
      {owe && (
        <div className="space-y-0.5 rounded-control bg-warning-bg px-3 py-2 text-xs text-warning-fg">
          <p>
            Chuyển vào tài khoản Tubu Tree:{' '}
            <span className="font-semibold">
              {tubuAccount ? `${tubuAccount.bankName} · ${tubuAccount.accountNo} · ${tubuAccount.accountName}` : 'liên hệ Tubu Tree để nhận số tài khoản'}
            </span>
          </p>
          {p.transferMemo && (
            <p>
              Nội dung chuyển khoản: <span className="font-semibold">{p.transferMemo}</span>
            </p>
          )}
          {p.dueAt && <p>Hạn nộp {formatDate(p.dueAt)}</p>}
        </div>
      )}
      {p.lines.length > 0 && (
        <details className="text-xs">
          <summary className="flex min-h-[44px] cursor-pointer items-center font-medium text-forest-700 sm:min-h-6">
            {cancelled ? `Xem ${p.lines.length} khoản lúc huỷ` : `Xem ${p.lines.length} khoản`}
          </summary>
          <div className="mt-2">
            <SettlementTable lines={p.lines} label={`Các khoản của phiếu lập ${formatDate(p.createdAt)}`} dateHeader="Vào phiếu" dateOf={(l) => l.createdAt ?? l.deliveredAt} />
          </div>
        </details>
      )}
    </li>
  );
}
