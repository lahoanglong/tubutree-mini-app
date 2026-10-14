import { Check } from 'lucide-react';
import { TIMELINE_STEPS, orderStatusLabel, timelineIndex } from '@/lib/order-view';

/** Bước đầu là "Đã đặt hàng" chứ không phải "Chờ thanh toán": đơn COD cũng đi qua bước này mà không có gì để chờ trả. */
const stepLabel = (step: (typeof TIMELINE_STEPS)[number]) => (step === 'PENDING_PAYMENT' ? 'Đã đặt hàng' : orderStatusLabel(step));

/**
 * Đường đi của đơn qua 5 bước chuẩn. Đơn đã hủy/hoàn không nằm trên đường này nên không dựng (trạng thái đã có ở huy hiệu
 * đầu trang). Bước hiện tại có aria-current="step"; bước đã qua đánh dấu tích.
 */
export function OrderTimeline({ status }: { status: string }) {
  const current = timelineIndex(status);
  if (current < 0) return null;
  return (
    <section aria-labelledby="order-timeline-title" className="mt-4 rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      <h2 id="order-timeline-title" className="font-display text-lg font-semibold text-stone-900">
        Hành trình đơn hàng
      </h2>
      <ol className="mt-3">
        {TIMELINE_STEPS.map((step, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={step} aria-current={active ? 'step' : undefined} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 ${
                    done || active ? 'border-forest-600 bg-forest-600 text-stone-0' : 'border-stone-300 bg-stone-0'
                  }`}
                >
                  {done && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                {i < TIMELINE_STEPS.length - 1 && (
                  <span aria-hidden="true" className={`my-0.5 w-0.5 flex-1 ${done ? 'bg-forest-600' : 'bg-stone-200'}`} />
                )}
              </div>
              <div className={`text-sm ${i === TIMELINE_STEPS.length - 1 ? '' : 'pb-4'}`}>
                <span className={active ? 'font-semibold text-stone-900' : done ? 'text-stone-800' : 'text-stone-600'}>
                  {stepLabel(step)}
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
