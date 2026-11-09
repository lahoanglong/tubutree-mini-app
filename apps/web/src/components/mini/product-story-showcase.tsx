'use client';

// Nguồn: apps/miniapp/src/components/ui/product-story-showcase.tsx (cùng props, cùng test-id).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { ProductDetail } from '@tubutree/app-core/api/catalog';
import { ChevronRight } from 'lucide-react';
import type { HudCalloutPoint, IngredientLayerSprite, ProductStoryConfig } from '@tubutree/shared-types';
import { arcSlot, ambientVar, layersUpTo, resolveStoryConfig, storyView } from '@tubutree/app-core/commerce/product-story';
import { preloadImages, STORY_PRELOAD_ROOT_MARGIN, storyPreloadUrls } from '@tubutree/app-core/commerce/story-preload';
import { resolveReelStoryConfig } from '@tubutree/app-core/commerce/story-reel';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { isThenable } from './button';
import { ProductImage } from './product-image';
import { StorySprite } from './story-sprite';

export interface ProductStoryShowcaseProps {
  product: ProductDetail;
  selectedVariationId?: string;
  onSelectVariation?: (id: string) => void;
  /** Trả Promise thì nút khoá chạm lại tới khi xong (như `Button` của Mini); trả void thì không khoá. */
  onAddToCart?: () => void | Promise<unknown>;
  onBuyNow?: () => void | Promise<unknown>;
  /** Hết hàng hoặc chưa mua được: khoá hai nút ở thanh dưới của khung toàn màn. */
  buyDisabled?: boolean;
  /** Ghi đè cấu hình (Live Preview của Admin): có thì vẽ kể cả khi `enabled: false`. */
  previewConfig?: ProductStoryConfig;
  /** Khung 100dvh dạng Reel, có nút đóng và thanh mua ghim đáy. */
  fullscreen?: boolean;
  onClose?: () => void;
  /** Reel của Trang chủ: luôn có kịch bản (không cần cấu hình riêng), bỏ cảnh chọn phân loại, thanh đáy là "Thêm vào giỏ · giá" và "Câu chuyện kế" (không có "Mua ngay"). */
  reel?: boolean;
  /** Giá đã định dạng ghi trên nút thêm giỏ của Reel; thiếu thì nút chỉ ghi "Thêm vào giỏ". */
  addPrice?: string;
  /** Chuyển sang Reel kế; không truyền thì không có nút "Câu chuyện kế". */
  onNext?: () => void;
  /** Vị trí trong dải, vd "2/8", hiện nhỏ cạnh tiêu đề đầu khung toàn màn. */
  position?: string;
}

const STAGE_SIZES = '(min-width: 48rem) 28rem, 100vw';
const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

function reducedMotionQuery(): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(REDUCE_QUERY) : null;
  } catch {
    return null;
  }
}

function prefersReducedMotion(): boolean {
  return reducedMotionQuery()?.matches ?? false;
}

/**
 * Nút của thanh đáy: xử lý trả Promise thì khoá chạm lại tới khi xong (`Button` của Mini làm đúng vậy), trả void thì không khoá. Ref chặn cú chạm thứ hai trong cùng khung hình
 * (state chỉ đúng sau lần vẽ kế); state chỉ để báo aria-busy. Promise bị từ chối thì nhả khoá để nút không chết rồi ném lại đúng lỗi đó (như `Button`), để nó vẫn lên `unhandledrejection` và tới Sentry thay vì bị nuốt.
 */
function usePressLock(handler?: () => void | Promise<unknown>) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const press = () => {
    if (inFlight.current) return;
    const result = handler?.();
    if (!isThenable(result)) return;
    inFlight.current = true;
    setBusy(true);
    const release = () => {
      inFlight.current = false;
      setBusy(false);
    };
    result.then(release, (err: unknown) => {
      release();
      throw err;
    });
  };
  return { press, busy };
}

function Layer({ layer, animated }: { layer: IngredientLayerSprite; animated: boolean }) {
  const style = {
    left: `${layer.xPct}%`,
    top: `${layer.yPct}%`,
    transform: `translate(-50%, -50%) rotate(${layer.rotateDeg}deg) scale(${layer.scale})`,
  } as CSSProperties;
  return (
    <span data-testid="story-layer" aria-hidden="true" data-from={layer.from} data-animated={animated ? 'true' : 'false'} className="tubu-story-layer" style={style}>
      <StorySprite layer={layer} />
    </span>
  );
}

function Callout({ point }: { point: HudCalloutPoint }) {
  const left = point.side === 'left';
  return (
    <div
      data-testid="story-callout"
      data-side={point.side}
      className="tubu-story-callout"
      style={{ top: `${point.yPct}%`, ...(left ? { left: '3%' } : { right: '3%' }) }}
    >
      <span className="tubu-story-callout-label">{point.label}</span>
      {point.value ? <span className="tubu-story-callout-value">{point.value}</span> : null}
      {typeof point.barPct === 'number' ? (
        <span aria-hidden="true" className="tubu-story-callout-bar">
          <span style={{ width: `${Math.min(100, Math.max(0, point.barPct))}%` }} />
        </span>
      ) : null}
    </div>
  );
}

/** Mục Story đã vào (hoặc sắp vào) khung nhìn. Môi trường không có IntersectionObserver coi như đã thấy, để vẫn tải trước. */
function useSeen(ref: RefObject<Element | null>, active: boolean): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (seen || !active || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setSeen(true);
        io.disconnect();
      },
      { rootMargin: STORY_PRELOAD_ROOT_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen, active]);
  return seen;
}

export function ProductStoryShowcase({ product, selectedVariationId, onSelectVariation, onAddToCart, onBuyNow, buyDisabled = false, previewConfig, fullscreen = false, onClose, reel = false, addPrice, onNext, position }: ProductStoryShowcaseProps) {
  const config = useMemo(() => previewConfig ?? (reel ? resolveReelStoryConfig(product) : resolveStoryConfig(product)), [previewConfig, product, reel]);
  // Mặc định bản có chuyển động: HTML dựng sẵn và lần hydrate đầu phải khớp nhau; thiết lập giảm chuyển động chỉ biết ở trình duyệt.
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = reducedMotionQuery();
    if (!mq) return;
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  const addPress = usePressLock(onAddToCart);
  const buyPress = usePressLock(onBuyNow);
  const view = useMemo(() => (config ? storyView(config, { reducedMotion: reduced }) : null), [config, reduced]);

  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => setPicked(null), [selectedVariationId]);
  const arcItems = view?.arc ?? null;
  const fromProp = arcItems ? arcItems.findIndex((a) => a.variationId !== undefined && a.variationId === selectedVariationId) : -1;
  const arcActive = arcItems ? Math.min(arcItems.length - 1, picked ?? Math.max(0, fromProp)) : 0;

  const rootRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const sentinels = useRef<(HTMLElement | null)[]>([]);
  const stepCount = view?.steps.length ?? 0;
  const animated = view?.animated ?? true;

  // Cuộn tới đâu bước nhảy tới đó; môi trường không có IntersectionObserver vẫn dùng được bằng chip.
  useEffect(() => {
    if (!animated || stepCount === 0 || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = sentinels.current.indexOf(e.target as HTMLElement);
          if (i >= 0) setStep(i);
        }
      },
      { rootMargin: '-40% 0px -40% 0px' },
    );
    sentinels.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [animated, stepCount]);

  // Bản tĩnh (giảm chuyển động) đã vẽ mọi lớp ngay nên không còn gì để tải trước; bản động tải ảnh nguyên liệu của chương kế để chuyển chương không chớp trắng.
  // `reduced` mặc định false ở lần render đầu (để hydrate khớp HTML dựng sẵn) nên đọc thiết lập thật trực tiếp ở đây, không tin `animated` của lần đó.
  // Chỉ tải khi mục Story đã gần khung nhìn: khách không cuộn tới thì không tốn dữ liệu.
  const storySteps = view?.steps;
  const seen = useSeen(rootRef, view !== null);
  useEffect(() => {
    if (animated && seen && storySteps && !prefersReducedMotion()) preloadImages(storyPreloadUrls(storySteps, step));
  }, [animated, seen, storySteps, step]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const hasConfig = config !== null;
  useEffect(() => {
    if (!fullscreen || !hasConfig) return;
    const before = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !rootRef.current) return;
      const items = Array.from(rootRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (before && typeof before.focus === 'function') before.focus();
    };
  }, [fullscreen, hasConfig]);

  const pickArc = useCallback(
    (i: number) => {
      setPicked(i);
      const id = arcItems?.[i]?.variationId;
      if (id && onSelectVariation) onSelectVariation(id);
    },
    [arcItems, onSelectVariation],
  );

  if (!config || !view) return null;

  const activeStep = Math.min(Math.max(step, 0), Math.max(stepCount - 1, 0));
  const layers = view.animated ? layersUpTo(view.steps, activeStep) : view.staticLayers;
  const ambient = arcItems ? ambientVar(arcItems[arcActive]!.ambient) : 'var(--color-bg-media)';
  const image = config.cutoutUrl ?? product.images[0] ?? product.thumbnail;
  const panel = view.steps[activeStep];
  const title = fillCopy('story.title');

  const stage = (
    <div className="tubu-story-sticky min-w-0 md:order-2 md:self-start">
      <div data-testid="story-stage" data-frame={view.frame} className="tubu-story-stage" style={{ background: ambient }}>
        <ProductImage src={image} brand={product.brand} alt={fillCopy('story.stageAlt', { name: product.name })} width={448} sizes={STAGE_SIZES} fit="contain" className="tubu-story-product" />
        {layers.map((l) => (
          <Layer key={l.id} layer={l} animated={view.animated} />
        ))}
        {view.hud ? (
          <div data-testid="story-hud" role="group" aria-label={fillCopy('story.hudLabel')} className="tubu-story-hud">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false" className="tubu-story-hud-lines">
              {view.hud.points.map((p) => (
                <line key={p.id} x1={p.xPct} y1={p.yPct} x2={p.side === 'left' ? 37 : 63} y2={p.yPct} vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
            {view.hud.points.map((p) => (
              <span key={`dot-${p.id}`} aria-hidden="true" className="tubu-story-dot" style={{ left: `${p.xPct}%`, top: `${p.yPct}%` }} />
            ))}
            {view.hud.points.map((p) => (
              <Callout key={p.id} point={p} />
            ))}
          </div>
        ) : null}
      </div>
      {arcItems ? (
        <div role="radiogroup" aria-label={fillCopy('story.arcLabel')} className="tubu-story-arc">
          {arcItems.map((item, i) => {
            const slot = arcSlot(i, arcActive, arcItems.length);
            const on = i === arcActive;
            return (
              <button
                key={`${item.variationId ?? 'x'}-${i}`}
                type="button"
                role="radio"
                aria-checked={on}
                data-testid="story-arc-item"
                className="tubu-story-arc-item tubu-hit-44-square"
                style={
                  {
                    '--arc-offset': slot.offset,
                    '--arc-lift': slot.lift,
                    '--arc-rot': `${slot.rotateDeg}deg`,
                    '--arc-scale': slot.scale,
                    ...(on ? { background: ambientVar(item.ambient) } : null),
                  } as CSSProperties
                }
                onClick={() => pickArc(i)}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {view.hud ? <p data-testid="story-closing" className="tubu-story-closing">{view.hud.closing}</p> : null}
    </div>
  );

  // Mốc cuộn của chế độ ghép lớp theo cuộn. Nội tuyến nằm cuối cột bước (md+ ghim sân khấu suốt đường cuộn); toàn màn nằm ngoài khối ghim
  // để sân khấu và chip luôn ở trên cùng khi cuộn qua mốc, kể cả khổ điện thoại một cột.
  const sentinelEls = view.steps.map((s, i) => <div key={s.num} aria-hidden="true" ref={(el) => void (sentinels.current[i] = el)} className="tubu-story-sentinel" />);

  const steps =
    stepCount === 0 ? null : view.animated ? (
      <div className="min-w-0 md:order-1">
        <div className="tubu-story-sticky">
        <nav aria-label={fillCopy('story.stepsLabel')} className="tubu-story-chips">
          {view.steps.map((s, i) => (
            <button
              key={s.num}
              type="button"
              data-testid="story-step-chip"
              aria-current={i === activeStep ? 'step' : undefined}
              aria-label={fillCopy('story.stepChip', { num: s.num, title: s.title })}
              className="tubu-story-chip tubu-hit-44-square"
              onClick={() => setStep(i)}
            >
              {s.num}
            </button>
          ))}
        </nav>
        <div aria-hidden="true" className="tubu-story-progress">
          <span style={{ width: `${((activeStep + 1) / stepCount) * 100}%` }} />
        </div>
        <div data-testid="story-step-panel" aria-live="polite" className="tubu-story-panel">
          <div key={activeStep} className="tubu-story-panel-in">
            <p className="tubu-story-num">{panel?.num}</p>
            <h3 className="tubu-story-step-title">{panel?.title}</h3>
            <p className="tubu-story-step-body">{panel?.body}</p>
          </div>
        </div>
        </div>
        {fullscreen ? null : sentinelEls}
      </div>
    ) : (
      <ol data-testid="story-static-steps" className="tubu-story-static md:order-1">
        {view.steps.map((s) => (
          <li key={s.num}>
            <p className="tubu-story-num">{s.num}</p>
            <h3 className="tubu-story-step-title">{s.title}</h3>
            <p className="tubu-story-step-body">{s.body}</p>
          </li>
        ))}
      </ol>
    );

  const body = (
    <div className={stepCount > 0 ? 'grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 md:items-start md:gap-8' : 'grid min-w-0 grid-cols-1 gap-4 md:mx-auto md:max-w-lg'}>
      {stage}
      {steps}
    </div>
  );

  if (!fullscreen) {
    return (
      <section ref={rootRef} data-testid="product-story" aria-label={title} data-animated={view.animated ? 'true' : 'false'} className="tubu-story">
        {body}
      </section>
    );
  }

  return (
    <section
      ref={rootRef}
      data-testid="product-story"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-animated={view.animated ? 'true' : 'false'}
      data-fullscreen="true"
      className="tubu-story tubu-story-full"
    >
      <header className="tubu-story-header">
        {position ? (
          <div className="tubu-story-headline">
            <h2 className="tubu-story-heading">{title}</h2>
            <span data-testid="story-position" className="tubu-story-position">{position}</span>
          </div>
        ) : (
          <h2 className="tubu-story-heading">{title}</h2>
        )}
        <button ref={closeRef} type="button" data-testid="story-close" aria-label={fillCopy('story.close')} className="tubu-story-close" onClick={() => onClose?.()}>
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className="tubu-story-scroll">
        {view.animated && stepCount > 0 ? (
          <>
            <div className="tubu-story-pin">{body}</div>
            {sentinelEls}
          </>
        ) : (
          body
        )}
      </div>
      {reel ? (
        <div className="tubu-story-bar tubu-story-bar-reel" data-reel="true">
          {onNext && (
            <button type="button" data-testid="story-next" aria-label={fillCopy('reel.nextAria')} className="tubu-story-btn tubu-story-btn-secondary tubu-story-btn-next" onClick={onNext}>
              {fillCopy('reel.next')}
              <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
          <button type="button" data-testid="story-add-to-cart" disabled={buyDisabled} aria-busy={addPress.busy || undefined} aria-disabled={addPress.busy || undefined} className="tubu-story-btn tubu-story-btn-primary" onClick={addPress.press}>
            {buyDisabled ? fillCopy('story.soldOut') : addPrice ? fillCopy('reel.addPrice', { price: addPrice }) : fillCopy('story.addToCart')}
          </button>
        </div>
      ) : (
        <div className="tubu-story-bar">
          <button type="button" data-testid="story-add-to-cart" disabled={buyDisabled} aria-busy={addPress.busy || undefined} aria-disabled={addPress.busy || undefined} className="tubu-story-btn tubu-story-btn-secondary" onClick={addPress.press}>
            {fillCopy('story.addToCart')}
          </button>
          <button type="button" data-testid="story-buy-now" disabled={buyDisabled} aria-busy={buyPress.busy || undefined} aria-disabled={buyPress.busy || undefined} className="tubu-story-btn tubu-story-btn-primary" onClick={buyPress.press}>
            {fillCopy(buyDisabled ? 'story.soldOut' : 'story.buyNow')}
          </button>
        </div>
      )}
    </section>
  );
}
