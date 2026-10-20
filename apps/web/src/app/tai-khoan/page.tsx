'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Copy, Leaf, Pencil, User } from 'lucide-react';
import { notificationsQuery } from '@tubutree/app-core/queries/account';
import { dealerMeQuery } from '@tubutree/app-core/queries/dealer';
import { couponsQuery, loyaltyQuery } from '@tubutree/app-core/queries/loyalty';
import { ownedBrandProfileQuery } from '@tubutree/app-core/queries/brand-owner';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { CASHBACK_ENABLED } from '@tubutree/app-core/features';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { isWebRouteReady } from '@/lib/route-map';
import { formatVnd, getMe } from '@/lib/shop-client';
import { ui } from '@/lib/guest-ui';
import { pointsSummary } from '@/lib/checkout-points';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { MiniAppOnlyNotice } from '@/components/mini-app-only-notice';
import { buildAccountMenu, type AccountMenuItem } from '@/components/account/account-menu';
import { OrdersSection } from './orders-section';
import BackLink from '@/components/back-link';
import { mini } from '@/components/order-mobile/mobile-ui';

const TILE =
  'block min-h-11 rounded-control p-2 -m-2 transition hover:bg-forest-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-stone-0 max-md:m-0 max-md:rounded-card max-md:bg-[var(--color-bg-surface)] max-md:p-3 max-md:text-center max-md:shadow-[var(--elevation-1)] max-md:hover:bg-[var(--color-bg-surface)] max-md:focus-visible:outline-forest-600';
const TILE_VALUE = 'text-xl font-bold max-md:text-[length:var(--type-price-md-size)] max-md:font-semibold max-md:leading-[var(--type-price-md-lh)] max-md:tabular-nums max-md:text-[color:var(--color-text-brand)]';
const TILE_LABEL = 'text-xs text-forest-100 max-md:text-[length:var(--type-caption-size)] max-md:text-[color:var(--color-text-tertiary)]';
const TILE_MORE = 'mt-1 inline-flex items-center gap-0.5 text-xs font-semibold text-stone-0 underline max-md:hidden';
const ROW = 'flex min-h-11 w-full items-center gap-3 px-3 py-3 text-left max-md:py-3.5 transition hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-600';

function MenuIcon({ item }: { item: AccountMenuItem }) {
  const Icon = item.icon;
  return (
    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-control bg-stone-50 text-forest-600 max-md:h-[34px] max-md:w-[34px] max-md:bg-[var(--color-bg-subtle)]">
      <Icon className="h-5 w-5" aria-hidden="true" />
    </span>
  );
}

function RowBody({ item, unread = 0 }: { item: AccountMenuItem; unread?: number }) {
  return (
    <>
      <MenuIcon item={item} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-stone-900">{item.label}</span>
        {item.hint && <span className="block text-xs text-stone-600">{item.hint}</span>}
      </span>
      {unread > 0 && (
        <span aria-hidden="true" className="flex h-[18px] min-w-[18px] flex-none items-center justify-center rounded-full bg-forest-600 px-1.5 text-xs font-bold text-stone-0">
          {unread}
        </span>
      )}
      <ChevronRight className="h-4 w-4 flex-none text-stone-600" aria-hidden="true" />
    </>
  );
}

export default function AccountPage() {
  const { user, logout } = useAuth();
  const phase = useAuthPhase();
  const noticeId = useId();
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const authed = phase === 'authenticated';
  // Hồ sơ trong phiên đăng nhập là ảnh chụp lúc đăng nhập: sau khi đặt đơn dùng điểm, huỷ đơn có tiền về ví hay
  // trả hàng thì số trên thẻ phải đổi ngay. Lấy lại mỗi lần vào trang và mỗi lần quay lại tab thay vì chờ F5;
  // chưa lấy được (mất mạng) thì giữ số cũ.
  const meQ = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    enabled: authed,
    refetchOnWindowFocus: true,
  });
  // Cùng queryKey với các trang Điểm Xanh/Ví/Thông báo nên mở hub không tốn thêm request khi đã có cache.
  const loyaltyQ = useQuery({ ...loyaltyQuery(coreHttp), enabled: authed });
  const couponsQ = useQuery({ ...couponsQuery(coreHttp), enabled: authed });
  const notifQ = useQuery({ ...notificationsQuery(coreHttp), enabled: authed });
  const cfgQ = useQuery({ ...publicConfigQuery(coreHttp), enabled: authed });
  // 404 nghĩa là không sở hữu nhãn / chưa có hồ sơ đại lý (bình thường), nên không thử lại.
  const ownedBrandQ = useQuery({ ...ownedBrandProfileQuery(coreHttp), enabled: authed, retry: false });
  const dealerQ = useQuery({ ...dealerMeQuery(coreHttp), enabled: authed, retry: false });

  if (phase === 'loading') {
    return (
      <main className="mx-auto max-w-5xl px-4 py-20 text-center">
        <h1 className="sr-only">Tài khoản</h1>
        <AuthLoading />
      </main>
    );
  }

  if (phase === 'unavailable') {
    return (
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className={ui.pageTitle}>Tài khoản</h1>
        <SessionUnavailable />
      </main>
    );
  }

  if (phase === 'guest' || !user) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className={ui.pageTitle}>Tài khoản</h1>
        <LoginRequired message="Đăng nhập để xem tài khoản và đơn hàng của bạn." returnTo="/tai-khoan" />
      </main>
    );
  }

  // Điểm Xanh = lô thường + lô quy đổi (tiền trả trước, không hết hạn): cùng một con số với Mini App.
  const balances = meQ.data ?? user;
  const points = pointsSummary(balances);
  const walletBalance = balances.walletBalance;
  // Tên/SĐT lấy từ /me khi đã có (khách có thể vừa đổi tên ở Mini App); API cũ chưa trả thì dùng ảnh chụp lúc đăng nhập.
  const fullName = meQ.data?.fullName !== undefined ? meQ.data.fullName : user.fullName;
  const tierName = loyaltyQ.data?.tier?.name ?? 'Mầm Xanh';
  const unread = notifQ.data?.filter((n) => n.status !== 'READ').length ?? 0;

  const menu = buildAccountMenu({
    role: user.role,
    aiEnabled: cfgQ.data?.aiAdvisorEnabled === true,
    claimEnabled: cfgQ.data?.loyalty?.marketplaceClaimEnabled === true,
    cashbackEnabled: CASHBACK_ENABLED,
    dealer: dealerQ.data,
    ownedBrandName: ownedBrandQ.data?.name,
    isReady: isWebRouteReady,
  });

  const copyReferral = async () => {
    try {
      await navigator.clipboard.writeText(user.referralCode);
      setCopyMsg('Đã sao chép mã giới thiệu');
    } catch {
      setCopyMsg(`Không sao chép được — mã của bạn: ${user.referralCode}`);
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 max-md:max-w-none max-md:px-0 max-md:py-0 max-md:pb-4">
      <div className="max-md:hidden">
        <BackLink href="/">
          ← Trang chủ
        </BackLink>
      </div>
      <h1 className={`mt-1 ${ui.pageTitle} max-md:sr-only`}>Tài khoản</h1>

      <section aria-label="Thông tin tài khoản" className="mt-3 rounded-sheet bg-forest-800 p-5 text-stone-0 shadow-raised max-md:mt-0 max-md:rounded-none max-md:bg-transparent max-md:p-0 max-md:shadow-none">
        {/* Điện thoại: dải xanh tràn ngang chỉ ôm hồ sơ + mã giới thiệu, ba ô số liệu nổi đè lên mép dưới như Mini App (marginTop -20). */}
        <div className="max-md:bg-[linear-gradient(135deg,var(--color-action-primary-bg),var(--color-action-primary-bg-pressed))] max-md:p-4 max-md:pb-9">
        <Link href="/tai-khoan/ho-so" className="flex min-h-11 items-center gap-3 rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-stone-0">
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL Cloudinary, domain không cố định
            <img src={user.avatarUrl} alt="" className="h-14 w-14 flex-none rounded-full bg-forest-700 object-cover" />
          ) : (
            <span className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-forest-700 text-forest-100">
              <User className="h-7 w-7" aria-hidden="true" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-lg font-bold max-md:font-display">{fullName ?? 'Khách Tubu'}</span>
            <span className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-forest-50 px-2 py-0.5 text-xs font-semibold text-forest-800">
                <Leaf className="h-3.5 w-3.5" aria-hidden="true" />
                {tierName}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-stone-0 px-2 py-0.5 text-xs font-semibold">
                <Pencil className="h-3 w-3" aria-hidden="true" />
                Sửa hồ sơ
                <ChevronRight className="h-3 w-3" aria-hidden="true" />
              </span>
            </span>
          </span>
        </Link>

        {user.referralCode && (
          <button
            type="button"
            onClick={() => void copyReferral()}
            className="mt-3 flex min-h-11 w-full items-center justify-between gap-2 rounded-control bg-forest-50 px-3 py-2 text-left text-xs text-forest-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-stone-0 max-md:bg-[var(--color-action-secondary-bg)] max-md:text-[color:var(--color-action-secondary-fg)]"
          >
            <span>
              Mã giới thiệu: <strong>{user.referralCode}</strong>
            </span>
            <span className="inline-flex flex-none items-center gap-1 font-semibold">
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              Sao chép
            </span>
          </button>
        )}
        <p role="status" className={copyMsg ? 'mt-1 text-xs text-forest-100' : 'sr-only'}>
          {copyMsg ?? ''}
        </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-6 max-md:relative max-md:-mt-5 max-md:gap-2.5 max-md:p-3 max-md:pb-0 md:grid-cols-3">
          <Link href="/tai-khoan/diem-xanh" className={TILE}>
            <div className={TILE_VALUE}>{points.total.toLocaleString('vi-VN')} điểm</div>
            <div className={TILE_LABEL}>Điểm Xanh</div>
            {points.convertedNote && <div className={`${TILE_LABEL} max-md:hidden`}>{points.convertedNote}</div>}
            <div className={TILE_MORE}>
              Xem lịch sử
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            </div>
          </Link>
          <Link href="/tai-khoan/vi-tubu" className={TILE}>
            <div className={TILE_VALUE}>{formatVnd(walletBalance)}</div>
            <div className={TILE_LABEL}>Ví Tubu</div>
            <div className={TILE_MORE}>
              Xem lịch sử
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            </div>
          </Link>
          <Link href="/tai-khoan/diem-xanh" className={`${TILE} col-span-2 md:col-span-1`}>
            <div className={TILE_VALUE}>{couponsQ.data ? `${couponsQ.data.length} mã` : '—'}</div>
            <div className={TILE_LABEL}>Mã giảm giá</div>
          </Link>
        </div>
      </section>

      <div className="mt-4 grid gap-4 max-md:mt-0 max-md:gap-3 max-md:px-4 md:grid-cols-2">
        {menu.map((section, gi) => (
          <section key={section.group} aria-labelledby={`${noticeId}-g${gi}`} className="min-w-0">
            <h2 id={`${noticeId}-g${gi}`} className="mb-1.5 ml-1 text-xs font-semibold uppercase tracking-wide text-stone-600 max-md:text-[color:var(--color-text-tertiary)]">
              {section.group}
            </h2>
            <ul className={`${ui.card} divide-y divide-stone-200 overflow-hidden ${mini.card}`}>
              {section.items.map((item) => {
                const isNotif = item.to === '/tai-khoan/thong-bao';
                if (item.miniAppOnly) {
                  return (
                    <li key={item.to}>
                      <button type="button" aria-expanded={noticeOpen} aria-controls={`${noticeId}-notice`} onClick={() => setNoticeOpen((o) => !o)} className={ROW}>
                        <RowBody item={item} />
                      </button>
                      {noticeOpen && (
                        <div id={`${noticeId}-notice`}>
                          <MiniAppOnlyNotice miniappPath={item.to} />
                        </div>
                      )}
                    </li>
                  );
                }
                return (
                  <li key={item.to}>
                    <Link href={item.to} aria-label={isNotif && unread > 0 ? `${item.label}, ${unread} chưa đọc` : undefined} className={ROW}>
                      <RowBody item={item} unread={isNotif ? unread : 0} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {/* Mini App không có khối này: đơn hàng là tab riêng ở thanh đáy. */}
      <div className="max-md:hidden">
        <OrdersSection />
      </div>

      <button type="button" onClick={() => void logout()} className={`${ui.btnSecondary} mt-6 w-full ${mini.secondary} max-md:mx-4 max-md:mt-2 max-md:w-[calc(100%-2rem)]`}>
        Đăng xuất
      </button>
    </main>
  );
}
