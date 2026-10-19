import { Check } from 'lucide-react';
import { TIMELINE_STEPS, orderStatusLabel } from '@/lib/order-view';
import { mini } from '@/components/order-mobile/mobile-ui';

/** Như timelineStepsFor của Mini App: COD và Ví Tubu không bao giờ chờ thanh toán nên bỏ bước đầu. */
const NO_PAYMENT_WAIT = new Set(['COD', 'WALLET']);
const stepsFor = (paymentMethod?: string | null) =>
  paymentMethod && NO_PAYMENT_WAIT.has(paymentMethod) ? TIMELINE_STEPS.filter((s) => s !== 'PENDING_PAYMENT') : [...TIMELINE_STEPS];

/**
 * Đường đi của đơn qua 5 bước chuẩn. Đơn đã hủy/hoàn không nằm trên đường này nên không dựng (trạng thái đã có ở huy hiệu
 * đầu trang). Bước hiện tại có aria-current="step"; bước đã qua đánh dấu tích.
 */
export function OrderTimeline({ status, paymentMethod }: { status: string; paymentMethod?: string | null }) {
  const steps = stepsFor(paymentMethod);
  const current = (steps as readonly string[]).indexOf(status);
  if (current < 0) return null;
  return (
    <section aria-labelledby="order-timeline-title" className={`mt-4 rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card max-md:mt-2 ${mini.band}`}>
      <h2 id="order-timeline-title" className={`font-display text-lg font-semibold text-stone-900 ${mini.sectionLabel}`}>
        Hành trình đơn hàng
      </h2>
      <ol className="mt-3">
        {steps.map((step, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={step} aria-current={active ? 'step' : undefined} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 max-md:h-[18px] max-md:w-[18px] flex-none items-center justify-center rounded-full border-2 ${
                    done || active ? 'border-forest-600 bg-forest-600 text-stone-0' : 'border-stone-300 bg-stone-0'
                  }`}
                >
                  {done && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                {i < steps.length - 1 && (
                  <span aria-hidden="true" className={`my-0.5 w-0.5 flex-1 ${done ? 'bg-forest-600' : 'bg-stone-200'}`} />
                )}
              </div>
              <div className={`text-sm ${i === steps.length - 1 ? '' : 'pb-4'}`}>
                <span
                  className={
                    active
                      ? 'font-semibold text-stone-900 max-md:text-[color:var(--color-text-brand)]'
                      : done
                        ? 'text-stone-800 max-md:text-[color:var(--color-text-primary)]'
                        : 'text-stone-600 max-md:text-[color:var(--color-text-tertiary)]'
                  }
                >
                  {orderStatusLabel(step)}
                </span>
                {done && <span className="sr-only"> — đã qua</span>}
                {active && <span className="sr-only"> — hiện tại</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
