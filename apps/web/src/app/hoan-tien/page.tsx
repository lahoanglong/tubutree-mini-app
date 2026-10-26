'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { createCashbackClick, type CashbackMerchant } from '@tubutree/app-core/api/cashback';
import { isHttpUrl } from '@tubutree/app-core/bridge';
import { cashbackMerchantsQuery, cashbackTxnQuery } from '@tubutree/app-core/queries/cashback';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { walletQuery } from '@tubutree/app-core/queries/wallet';
import { useAuthPhase } from '@/lib/auth-phase';
import { CASHBACK_TXN_META, formatRatePct } from '@/lib/cashback-copy';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { loginHref } from '@/lib/return-to';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { miniCard } from '@/components/loyalty/mini-surface';
import { PAGE_WIDE } from '@/lib/page-frame';

const DEFAULT_HOLD_DAYS = 30;

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

function MerchantLogo({ merchant, size }: { merchant: CashbackMerchant; size: number }) {
  const box = { width: size, height: size };
  if (!merchant.logoUrl) {
    return (
      <span aria-hidden="true" style={box} className="mx-auto block flex-none rounded-full bg-gradient-to-tr from-forest-500 to-forest-200" />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- logo sàn từ API, miền không cố định nên next/image không cấu hình trước được
  return <img src={merchant.logoUrl} alt="" style={box} className="mx-auto flex-none rounded-full object-cover" />;
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="space-y-2">
      {items.map((s, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className="grid h-[18px] w-[18px] flex-none place-items-center rounded-full bg-promo-solid text-xs font-bold text-stone-0">{i + 1}</span>
          <span className="text-xs text-stone-700">{s}</span>
        </li>
      ))}
    </ol>
  );
}

export default function CashbackPage() {
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  // /cashback/transactions và /me/wallet cần đăng nhập: gọi trước khi khôi phục phiên xong sẽ 401 và kẹt lỗi dù đăng nhập thành công ngay sau đó.
  // /cashback/merchants và /config/public công khai nên không chờ.
  const merchantsQ = useQuery(cashbackMerchantsQuery(coreHttp));
  const txnQ = useQuery({ ...cashbackTxnQuery(coreHttp), enabled: authed });
  const walletQ = useQuery({ ...walletQuery(coreHttp), enabled: authed });
  const configQ = useQuery(publicConfigQuery(coreHttp));
  const holdDays = configQ.data?.cashbackHoldDays ?? DEFAULT_HOLD_DAYS;
  const [selected, setSelected] = useState<CashbackMerchant | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clickError, setClickError] = useState<string | null>(null);
  // `disabled={isPending}` chỉ có hiệu lực sau lần render kế: hai cú bấm trong cùng khung hình vẫn gọi mutate hai lần.
  const clickBusy = useRef(false);
  // Tab đối tác phải mở ngay trong cú bấm: đợi phản hồi POST xong mới window.open thì hết "kích hoạt người dùng" và trình duyệt chặn.
  const partnerTab = useRef<Window | null>(null);
  const [blockedLink, setBlockedLink] = useState<string | null>(null);

  const clickMut = useMutation({
    mutationFn: (merchantId: string) => createCashbackClick(coreHttp, merchantId),
    onSuccess: (r) => {
      const win = partnerTab.current;
      partnerTab.current = null;
      if (!isHttpUrl(r.deeplink)) {
        win?.close();
        setClickError('Không mở được liên kết sàn — Vui lòng thử lại sau');
        return;
      }
      if (!win || win.closed) {
        // Bị chặn cửa sổ mới hoặc khách đã đóng tab trống: giữ khung để khách tự bấm liên kết, vì click đã được ghi nhận.
        setBlockedLink(r.deeplink);
        return;
      }
      // Tab trống mở không noopener nên phải tự ngắt opener trước khi đưa tới trang đối tác.
      win.opener = null;
      win.location.replace(r.deeplink);
      setSelected(null);
      setNotice('Đã ghi nhận hoàn tiền! Đang chuyển hướng sang sàn...');
    },
    onError: (e) => {
      partnerTab.current?.close();
      partnerTab.current = null;
      setClickError(errText(e));
    },
    onSettled: () => {
      clickBusy.current = false;
    },
  });
  const startClick = (merchantId: string) => {
    if (clickBusy.current) return;
    clickBusy.current = true;
    setClickError(null);
    setBlockedLink(null);
    partnerTab.current = window.open('about:blank', '_blank');
    clickMut.mutate(merchantId);
  };
  const closeSheet = () => {
    setSelected(null);
    setClickError(null);
    setBlockedLink(null);
  };

  const balance = (() => {
    if (phase === 'loading') return <AuthLoading />;
    if (phase === 'unavailable') return <SessionUnavailable />;
    if (phase === 'guest') return <LoginRequired message="Đăng nhập để xem khoản hoàn tiền của bạn." returnTo="/hoan-tien" />;
    // Không thay bằng 0đ khi tải ví lỗi: khách sẽ tưởng tiền hoàn đã biến mất.
    if (walletQ.isError) return <ErrorState message={errText(walletQ.error)} onRetry={() => void walletQ.refetch()} />;
    if (!walletQ.data) return <Skeleton height={120} />;
    return (
      <section aria-label="Hoàn tiền đã duyệt" className="rounded-card bg-gradient-to-br from-forest-600 to-forest-700 p-5 text-stone-0 shadow-raised max-md:from-[var(--clay-500)] max-md:to-[var(--clay-700)]">
        {/* `cashbackPending` chỉ cộng khi sàn đã CONFIRMED (cashback.service.ts): tiền đã chắc chắn, đang chờ về Ví. Gọi là "đang chờ"
            sẽ bị hiểu cùng nghĩa với nhãn "Chờ duyệt" của các giao dịch bên dưới, mà hai con số không bao giờ khớp. */}
        <div className="text-sm">Đã duyệt, chờ về Ví</div>
        <div className="mt-1 text-3xl font-bold tabular-nums">{formatVnd(walletQ.data.cashbackPending ?? 0)}</div>
        <p className="mt-1.5 text-xs">Sàn đã xác nhận đơn — khoản này sẽ vào Ví Tubu. Đơn sàn chưa duyệt xem ở danh sách bên dưới.</p>
      </section>
    );
  })();

  return (
    <main className={`${PAGE_WIDE} py-6 max-md:pt-0`}>
      <PageHeader title="Hoàn tiền" backHref="/tai-khoan/vi-tubu" backLabel="Quay lại Ví Tubu" />
      <div role="status" aria-live="polite">
        {notice && <p className="mt-3 text-sm font-medium text-success-fg">{notice}</p>}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_3fr] lg:items-start">
        <div className="space-y-4">{balance}</div>

        <div className="space-y-4">
          <section aria-labelledby="cashback-merchants">
            <h2 id="cashback-merchants" className="mb-2.5 text-base font-semibold text-stone-900">
              Chọn sàn để mua sắm
            </h2>
            {merchantsQ.isLoading ? (
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} height={92} />
                ))}
              </div>
            ) : merchantsQ.isError ? (
              // Phân biệt "lỗi tải sàn" với "chưa có sàn" để khách không tưởng tính năng trống.
              <ErrorState message={errText(merchantsQ.error)} onRetry={() => void merchantsQ.refetch()} />
            ) : merchantsQ.data && merchantsQ.data.length > 0 ? (
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
                {merchantsQ.data.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    data-merchant
                    onClick={() => {
                      setNotice(null);
                      setClickError(null);
                      setSelected(m);
                    }}
                    className={`min-h-11 p-3 text-center transition hover:bg-stone-50 active:scale-95 ${miniCard}`}
                  >
                    <MerchantLogo merchant={m} size={40} />
                    <span className="mt-1.5 block text-sm font-medium text-stone-900 max-md:text-[length:var(--type-label-size)] max-md:font-semibold max-md:leading-[var(--type-label-lh)]">
                      {m.name}
                    </span>
                    <span className="flex items-center justify-center gap-0.5 text-xs font-medium text-forest-700">
                      <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {formatRatePct(m.baseRate)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-stone-600">Chưa có sàn đối tác nào.</p>
            )}
          </section>

          <section aria-labelledby="cashback-txns" className={`p-4 ${miniCard}`}>
            <h2 id="cashback-txns" className="mb-2.5 text-base font-semibold text-stone-900">
              Giao dịch hoàn tiền
            </h2>
            {!authed ? null : txnQ.isLoading ? (
              <Skeleton height={60} />
            ) : txnQ.isError ? (
              // Tránh "Chưa có giao dịch" khi thực ra API lỗi: dễ bị hiểu là mất tiền.
              <ErrorState message={errText(txnQ.error)} onRetry={() => void txnQ.refetch()} />
            ) : txnQ.data && txnQ.data.length > 0 ? (
              <ul>
                {txnQ.data.map((t) => {
                  const m = CASHBACK_TXN_META[t.status];
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-2 border-b border-stone-200 py-2 last:border-b-0 max-md:last:border-b">
                      <div>
                        <div className="text-sm font-semibold tabular-nums text-success-fg">+{formatVnd(t.userReward)}</div>
                        <div className="text-xs text-stone-600">
                          Đơn {formatVnd(t.orderAmount)}
                          {t.merchantOrderId ? ` · #${t.merchantOrderId.slice(0, 10)}` : ''}
                        </div>
                      </div>
                      <Badge tone={m.tone}>{m.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-stone-600">Chưa có giao dịch hoàn tiền. Bắt đầu mua sắm qua các sàn ở trên.</p>
            )}
          </section>
        </div>
      </div>

      <Sheet
        open={selected != null}
        onClose={closeSheet}
        title={selected?.name}
        footer={
          selected &&
          (authed ? (
            <button type="button" disabled={clickMut.isPending} onClick={() => startClick(selected.id)} className={`${ui.btnPrimary} w-full`}>
              Mua sắm & nhận hoàn tiền
            </button>
          ) : (
            <Link href={loginHref('/hoan-tien')} className={`${ui.btnPrimary} w-full`}>
              Đăng nhập để nhận hoàn tiền
            </Link>
          ))
        }
      >
        {selected && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <MerchantLogo merchant={selected} size={48} />
              <p className="text-sm font-medium text-forest-700">Hoàn đến {formatRatePct(selected.baseRate)} giá trị đơn</p>
            </div>
            <div className="rounded-control bg-stone-100 p-3">
              <div className="mb-1.5 text-sm font-semibold text-stone-900">Cách nhận hoàn tiền</div>
              <Steps
                items={[
                  'Bấm "Mua sắm" để mở sàn qua liên kết Tubu',
                  'Mua hàng & thanh toán như bình thường trên sàn',
                  // Số ngày giữ lấy từ cấu hình máy chủ: admin đổi cashback.hold_days mà chép cứng "30 ngày" thì tới ngày thứ 31 khách không thấy tiền và đi khiếu nại.
                  `Sàn xác nhận đơn → hoàn tiền vào Ví Tubu (sau ${holdDays} ngày)`,
                ]}
              />
            </div>
            {selected.terms && <p className="text-xs text-stone-600">{selected.terms}</p>}
            <p className="text-xs text-promo-fg">Lưu ý: phải bấm từ đây mỗi lần mua để được ghi nhận hoàn tiền.</p>
            {clickError && (
              <p role="alert" className={ui.error}>
                {clickError}
              </p>
            )}
            {blockedLink && (
              <p className="text-sm text-stone-900">
                Trình duyệt đã chặn cửa sổ mới.{' '}
                <a href={blockedLink} target="_blank" rel="noopener noreferrer" className="font-semibold text-forest-700 underline">
                  Mở sàn
                </a>
              </p>
            )}
          </div>
        )}
      </Sheet>
    </main>
  );
}
