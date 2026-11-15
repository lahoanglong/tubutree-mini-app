import Link from 'next/link';
import { Droplets, Gift, Sprout, TreePine } from 'lucide-react';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';
import { Skeleton } from '@/components/ui/skeleton';
import { ui } from '@/lib/guest-ui';
import { loginHref } from '@/lib/return-to';

export function GameSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton height={160} rounded="rounded-card" />
      <Skeleton height={44} />
      <Skeleton height={56} rounded="rounded-card" />
      <Skeleton height={140} rounded="rounded-card" />
    </div>
  );
}

const GARDEN_STAGES = [
  { stage: '01', name: 'Hạt mầm', note: 'Gieo hạt giống bản địa đầu tiên' },
  { stage: '02', name: 'Cây non', note: 'Điểm danh & hứng sương mỗi sáng' },
  { stage: '03', name: 'Đơm hoa', note: 'Giải đố sống xanh & tưới Giọt nước' },
  { stage: '04', name: 'Thu hoạch', note: 'Nhận Điểm Xanh, quà 0đ & góp cây thật' },
] as const;

const GARDEN_PERKS = [
  {
    Icon: Droplets,
    title: 'Tưới cây mỗi ngày dễ dàng',
    body: 'Nhận Giọt nước miễn phí từ điểm danh chuỗi 7 ngày, câu đố xanh, trò chơi và đơn hàng.',
  },
  {
    Icon: Gift,
    title: 'Đổi Điểm Xanh lấy quà thật 0đ',
    body: 'Thu hoạch Điểm Xanh và Mã giảm giá để đổi sản phẩm sinh học giao kèm đơn tiếp theo.',
  },
  {
    Icon: TreePine,
    title: 'Góp cây thật cho rừng Việt Nam',
    body: 'Mỗi mùa thu hoạch cùng cộng đồng đóng góp trực tiếp vào quỹ trồng rừng bản địa Tubu Tree.',
  },
] as const;

export function GameLoginGate({ returnTo }: { returnTo: string }) {
  return (
    <section
      data-testid="garden-guest-preview"
      className="rounded-card border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 sm:p-6 [box-shadow:var(--elevation-1)]"
    >
      <div className="inline-flex items-center gap-1.5 rounded-pill bg-[var(--color-bg-subtle)] px-3 py-1 text-xs font-semibold tracking-wider text-[var(--color-text-brand)]">
        <Sprout className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        TRỒNG CÂY ẢO · ĐỔI QUÀ THẬT · GÓP RỪNG XANH
      </div>
      <h2 className="mt-3 font-display text-xl font-semibold leading-snug text-[var(--color-text-primary)] sm:text-2xl">
        {gameNewbieCopy.loginToView}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-text-secondary)]">
        Chăm cây lớn mỗi ngày từ những thói quen sống xanh nhỏ bé — tích luỹ Điểm Xanh đổi sản phẩm sinh học 0đ tại Kho quà và chung tay ươm mầm rừng thật.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4" aria-label="Bốn chặng trưởng thành của cây">
        {GARDEN_STAGES.map((s) => (
          <div
            key={s.stage}
            className="rounded-control border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] p-3"
          >
            <span className="font-display text-xs font-semibold tracking-widest text-[var(--color-text-brand)]">
              CHẶNG {s.stage}
            </span>
            <h3 className="mt-1 text-sm font-semibold text-[var(--color-text-primary)]">{s.name}</h3>
            <p className="mt-0.5 text-xs leading-snug text-[var(--color-text-secondary)]">{s.note}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
        {GARDEN_PERKS.map(({ Icon, title, body }) => (
          <div
            key={title}
            className="flex items-start gap-2.5 rounded-control border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] p-3"
          >
            <span className="inline-grid h-8 w-8 shrink-0 place-items-center rounded-control bg-[var(--color-bg-subtle)] text-[var(--color-text-brand)]">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="text-xs font-semibold text-[var(--color-text-primary)]">{title}</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-text-secondary)]">{body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link href={loginHref(returnTo)} className={`${ui.btnPrimary} w-full sm:w-auto`}>
          Đăng nhập để bắt đầu trồng cây
        </Link>
        <Link href="/kho-qua" className={`${ui.btnSecondary} w-full sm:w-auto`}>
          Xem Kho quà Điểm Xanh
        </Link>
      </div>
    </section>
  );
}
