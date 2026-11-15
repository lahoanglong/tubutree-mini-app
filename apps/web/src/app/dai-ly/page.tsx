'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Award, ClipboardList, ShieldCheck, Store } from 'lucide-react';
import { dealerReviewLine } from '@tubutree/app-core/dealer-apply-copy';
import { dealerMeQuery } from '@tubutree/app-core/queries/dealer';
import { coreHttp } from '@/lib/core-http';
import { useAuthPhase } from '@/lib/auth-phase';
import { applyPitch } from '@/lib/dealer-view';
import { ui } from '@/lib/guest-ui';
import { loginHref } from '@/lib/return-to';
import { usePublicConfig } from '@/lib/use-public-config';
import { AuthLoading, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { DealerApply, DealerPending } from '@/components/dealer/dealer-apply';
import { DealerHub } from '@/components/dealer/dealer-hub';
import { DealerShell, errText } from '@/components/dealer/dealer-shell';

const TITLE = 'Kênh đại lý';

const DEALER_PILLARS = [
  {
    Icon: Award,
    title: 'Chiết khấu sỉ theo bậc rõ ràng',
    body: 'Bảng giá sỉ minh bạch theo bậc Đồng · Bạc · Vàng · Kim Cương, tự động khấu trừ ngay khi lên đơn số lượng lớn.',
  },
  {
    Icon: ShieldCheck,
    title: 'Hạn mức công nợ & thưởng doanh số quý',
    body: 'Hỗ trợ công nợ theo hạn mức được duyệt, đối soát công khai kèm thưởng tích luỹ doanh số quý và vật phẩm trưng bày.',
  },
  {
    Icon: ClipboardList,
    title: 'Lưu mẫu đơn & đặt sỉ siêu tốc',
    body: 'Tạo mẫu đơn nhập hàng định kỳ cho từng chi nhánh, đặt lại hàng chục mã hàng sinh học chỉ trong vài chạm.',
  },
] as const;

const DEALER_STEPS = [
  {
    step: '01',
    title: 'Đăng nhập tài khoản Tubu Tree',
    body: 'Dùng tài khoản Tubu Tree để quản lý tập trung bảng giá sỉ, đơn nhập và công nợ trên cả web lẫn Zalo.',
  },
  {
    step: '02',
    title: 'Gửi thông tin đơn vị kinh doanh',
    body: 'Điền tên Gian hàng hoặc doanh nghiệp, địa chỉ nhận hàng và ảnh CCCD hai mặt của người đại diện.',
  },
  {
    step: '03',
    title: 'Duyệt nhanh & mở bảng giá sỉ',
    body: 'Đội ngũ Tubu xét duyệt hồ sơ, liên hệ qua Zalo xác nhận và kích hoạt ngay hạn mức cùng bảng giá sỉ.',
  },
] as const;

const DEALER_FAQS = [
  {
    q: 'Ai phù hợp đăng ký Kênh đại lý Tubu Tree?',
    a: 'Các Gian hàng thực phẩm hữu cơ, siêu thị mini, hiệu thuốc, mẹ & bé hoặc doanh nghiệp phân phối hàng tiêu dùng xanh chính hãng.',
  },
  {
    q: 'Chưa có vốn nhập sỉ có hợp tác được không?',
    a: 'Bạn có thể bắt đầu ngay với chương trình Cộng tác viên (0đ vốn, không ôm hàng, nhận hoa hồng trên từng đơn giới thiệu).',
  },
] as const;

function DealerGuestLanding() {
  const config = usePublicConfig();
  const maxDiscountPct = config.isLoaded ? config.dealer?.maxDiscountPct : null;
  const reviewHours = config.isLoaded ? config.dealer?.reviewHours : null;

  return (
    <div className="space-y-6" data-testid="dealer-guest-landing">
      <section className="rounded-card border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 [box-shadow:var(--elevation-1)]">
        <div className="inline-flex items-center gap-2 rounded-pill bg-[var(--color-bg-subtle)] px-3 py-1 text-xs font-semibold tracking-wider text-[var(--color-text-brand)]">
          <Store className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ĐỐI TÁC B2B · PHÂN PHỐI CHÍNH HÃNG
        </div>
        <h2 className="mt-3 font-display text-2xl font-semibold leading-snug text-[var(--color-text-primary)]">
          Nhập sỉ hệ sinh thái tiêu dùng xanh Việt Nam với đặc quyền Đại lý Tubu Tree
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--color-text-secondary)]">
          {applyPitch(maxDiscountPct)} {dealerReviewLine(reviewHours)}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link href={loginHref('/dai-ly')} className={ui.btnPrimary}>
            Đăng nhập để đăng ký Đại lý
          </Link>
          <Link href="/ctv" className={ui.btnSecondary}>
            Xem kênh Cộng tác viên (0đ vốn)
          </Link>
        </div>
      </section>

      <section aria-label="Đặc quyền Đại lý">
        <h2 className={`${ui.sectionTitle} mb-3`}>Đặc quyền dành riêng cho Đại lý sỉ</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {DEALER_PILLARS.map(({ Icon, title, body }) => (
            <div
              key={title}
              className="rounded-card border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 [box-shadow:var(--elevation-1)]"
            >
              <span className="inline-grid h-10 w-10 place-items-center rounded-control bg-[var(--color-bg-subtle)] text-[var(--color-text-brand)]">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-3 font-display text-base font-semibold text-[var(--color-text-primary)]">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-text-secondary)]">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Quy trình mở tài khoản đại lý">
        <h2 className={`${ui.sectionTitle} mb-3`}>Quy trình 3 bước mở tài khoản Đại lý</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {DEALER_STEPS.map((s) => (
            <div
              key={s.step}
              className="rounded-card border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 [box-shadow:var(--elevation-1)]"
            >
              <span className="font-display text-xs font-semibold tracking-widest text-[var(--color-text-brand)]">
                BƯỚC {s.step}
              </span>
              <h3 className="mt-1.5 text-sm font-semibold text-[var(--color-text-primary)]">{s.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section
        aria-label="Câu hỏi thường gặp"
        className="rounded-card border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 [box-shadow:var(--elevation-1)]"
      >
        <h2 className="font-display text-base font-semibold text-[var(--color-text-primary)]">Câu hỏi thường gặp</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {DEALER_FAQS.map((item) => (
            <div key={item.q}>
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{item.q}</h3>
              <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">{item.a}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * `/dai-ly` theo `dealer.tsx` của Mini App: đã là đại lý (APPROVED) → hub; PENDING → màn chờ; còn lại → form đăng ký
 * (REJECTED kèm lý do). Mọi nhánh có đúng một h1.
 */
export default function DealerPage() {
  const phase = useAuthPhase();
  const meQ = useQuery({ ...dealerMeQuery(coreHttp), enabled: phase === 'authenticated' });

  if (phase === 'loading') {
    return (
      <DealerShell title={TITLE}>
        <AuthLoading />
      </DealerShell>
    );
  }
  if (phase === 'unavailable') {
    return (
      <DealerShell title={TITLE}>
        <SessionUnavailable />
      </DealerShell>
    );
  }
  if (phase === 'guest') {
    return (
      <DealerShell title={TITLE} guest>
        <DealerGuestLanding />
      </DealerShell>
    );
  }
  if (meQ.isLoading) {
    return (
      <DealerShell title={TITLE}>
        <div className="space-y-3">
          <Skeleton height={100} />
          <Skeleton height={60} />
        </div>
      </DealerShell>
    );
  }
  if (meQ.isError && !meQ.data) {
    return (
      <DealerShell title={TITLE}>
        <ErrorState message={errText(meQ.error)} onRetry={() => meQ.refetch()} />
      </DealerShell>
    );
  }

  const me = meQ.data!;
  if (me.isDealer || me.status === 'APPROVED') return <DealerHub />;
  if (me.status === 'PENDING') return <DealerPending />;
  return <DealerApply rejected={me.status === 'REJECTED'} rejectionReason={me.rejectionReason ?? null} />;
}
