'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrderDTO } from '@tubutree/shared-types';
import { requestDealerInvoices, saveDealerInvoiceProfile, type DealerInvoiceProfile } from '@tubutree/app-core/api/dealer';
import { dealerInvoiceProfileQuery, dealerOrdersQuery } from '@tubutree/app-core/queries/dealer';
import { validateInvoiceFields, type InvoiceField } from '@tubutree/app-core/commerce/checkout-form';
import { normalizeTaxCode } from '@tubutree/app-core/commerce/tax-code';
import { InvoiceFields } from '@/app/thanh-toan/invoice-section';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { CheckMark, miniCheckbox, miniCheckboxWrap } from '@/components/order-mobile/mobile-ui';
import { skin } from '@/components/pro-shared/mini-skin';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { coreHttp } from '@/lib/core-http';
import { formatDate } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { settleWithin } from '@/lib/settle-within';
import type { InvoiceInfo } from '@/lib/checkout-rules';
import { errText } from './dealer-shell';
import { invoiceResultNotice } from './dealer-tier-tools';

export type DealerNotice = { text: string; error: boolean };

const EMPTY: InvoiceInfo = { taxCode: '', companyName: '', address: '', email: '' };
const pick = (p: InvoiceInfo): InvoiceInfo => ({ taxCode: p.taxCode, companyName: p.companyName, address: p.address, email: p.email });
const clean = (v: InvoiceInfo): InvoiceInfo => ({
  taxCode: normalizeTaxCode(v.taxCode),
  companyName: v.companyName.trim(),
  address: v.address.trim(),
  email: v.email.trim(),
});

/**
 * Thông tin xuất hoá đơn VAT của đại lý, điền sẵn từ thông tin đã lưu (chưa lưu thì từ hồ sơ đăng ký đại lý).
 * Có `orders`: gửi yêu cầu hoá đơn cho các đơn được chọn (mặc định chọn hết), kèm ô "Lưu làm mặc định". Không có: chỉ lưu thông tin
 * để lần đặt đơn sau bật "Xuất hoá đơn VAT" một chạm. Mỗi sheet có đúng một nút chính ở chân.
 */
export function DealerInvoiceSheet({
  open,
  onClose,
  orders,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  orders?: OrderDTO[];
  onDone: (notice: DealerNotice, profile: DealerInvoiceProfile | null) => void;
}) {
  const qc = useQueryClient();
  const profileQ = useQuery({ ...dealerInvoiceProfileQuery(coreHttp), enabled: open });
  const [values, setValues] = useState<InvoiceInfo>(EMPTY);
  const [filled, setFilled] = useState(false);
  const [touched, setTouched] = useState<Set<InvoiceField>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveDefault, setSaveDefault] = useState(true);
  const [failure, setFailure] = useState<{ value: unknown } | null>(null);
  const bulk = !!orders;

  // Mỗi lần mở: điền một lần từ thông tin máy chủ trả (không đè chữ đại lý đang gõ khi hồ sơ tải lại), chọn sẵn mọi đơn.
  useEffect(() => {
    if (!open) {
      setFilled(false);
      return;
    }
    if (!filled && profileQ.data) {
      setValues(pick(profileQ.data));
      setFilled(true);
    }
  }, [open, filled, profileQ.data]);
  useEffect(() => {
    if (!open) return;
    setSelected(new Set((orders ?? []).map((o) => o.code)));
    setTouched(new Set());
    setShowAll(false);
    setFailure(null);
    // Chỉ chọn lại khi mở sheet; danh sách đơn tải lại lúc sheet đang mở không được bỏ chọn đơn đại lý vừa bỏ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const allErrors = validateInvoiceFields(values);
  const errors = Object.fromEntries(Object.entries(allErrors).filter(([k]) => showAll || touched.has(k as InvoiceField)));
  const valid = Object.keys(allErrors).length === 0;
  const codes = (orders ?? []).filter((o) => selected.has(o.code)).map((o) => o.code);

  const save = useLockedMutation({
    mutationFn: (invoice: InvoiceInfo) => saveDealerInvoiceProfile(coreHttp, invoice),
    onMutate: () => setFailure(null),
    onSuccess: (profile) => {
      qc.setQueryData(dealerInvoiceProfileQuery(coreHttp).queryKey, profile);
      onDone({ text: 'Đã lưu thông tin xuất hoá đơn VAT.', error: false }, profile);
    },
    onError: (e) => setFailure({ value: e }),
  });
  const request = useLockedMutation({
    mutationFn: (v: { codes: string[]; invoice: InvoiceInfo; save: boolean }) => requestDealerInvoices(coreHttp, v.codes, v.invoice, v.save),
    onMutate: () => setFailure(null),
    onSuccess: (r) => {
      if (r.profile) qc.setQueryData(dealerInvoiceProfileQuery(coreHttp).queryKey, r.profile);
      onDone(invoiceResultNotice(r), r.profile);
      return settleWithin(qc.invalidateQueries({ queryKey: dealerOrdersQuery(coreHttp).queryKey }));
    },
    onError: (e) => setFailure({ value: e }),
  });
  const pending = save.isPending || request.isPending;

  const submit = () => {
    if (!valid) {
      setShowAll(true);
      return;
    }
    if (bulk) request.mutate({ codes, invoice: clean(values), save: saveDefault });
    else save.mutate(clean(values));
  };

  const label = bulk ? (request.isPending ? 'Đang gửi…' : `Gửi yêu cầu (${codes.length} đơn)`) : save.isPending ? 'Đang lưu…' : 'Lưu thông tin';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Hoá đơn VAT"
      dismissible={!pending}
      footer={
        <button
          type="button"
          disabled={(bulk && codes.length === 0) || !profileQ.data}
          aria-busy={pending || undefined}
          aria-disabled={pending || undefined}
          onClick={submit}
          className={`${ui.btnPrimary} ${skin.dealerInkBtn} w-full`}
        >
          {label}
        </button>
      }
    >
      {profileQ.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      ) : profileQ.isError && !profileQ.data ? (
        <p role="alert" className={ui.error}>
          {errText(profileQ.error)}
        </p>
      ) : (
        <>
          {bulk && (
            <fieldset className="mb-3">
              <legend className="text-xs text-stone-600">Đơn trong 30 ngày chưa có yêu cầu hoá đơn</legend>
              <ul className="mt-1">
                {orders!.map((o) => (
                  <li key={o.code}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-stone-900">
                      <span className={miniCheckboxWrap}>
                        <input
                          type="checkbox"
                          checked={selected.has(o.code)}
                          disabled={pending}
                          onChange={(e) =>
                            setSelected((s) => {
                              const next = new Set(s);
                              if (e.target.checked) next.add(o.code);
                              else next.delete(o.code);
                              return next;
                            })
                          }
                          className={miniCheckbox}
                        />
                        <CheckMark />
                      </span>
                      <span className="min-w-0 flex-1">
                        #{o.code} · {formatDate(o.createdAt)}
                      </span>
                      <span className="tabular-nums">{formatVnd(o.total)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          {!bulk && !profileQ.data?.saved && (
            <p className="mb-2 text-xs text-stone-600">Đã điền sẵn từ hồ sơ đại lý. Bạn kiểm tra rồi lưu để lần sau bật một chạm.</p>
          )}
          <InvoiceFields
            invoice={values}
            onInvoice={setValues}
            errors={errors}
            onTouch={(f) => setTouched((s) => new Set(s).add(f))}
            disabled={pending}
          />
          {bulk && (
            <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm text-stone-900">
              <span className={miniCheckboxWrap}>
                <input type="checkbox" checked={saveDefault} disabled={pending} onChange={(e) => setSaveDefault(e.target.checked)} className={miniCheckbox} />
                <CheckMark />
              </span>
              Lưu làm thông tin mặc định
            </label>
          )}
          {failure && (
            <p role="alert" className={`mt-2 ${ui.error}`}>
              {errText(failure.value)}
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}
