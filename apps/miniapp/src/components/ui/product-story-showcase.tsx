import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, X } from 'lucide-react';
import type { ProductDetail } from '@tubutree/app-core/api/catalog';
import { ambientVar, arcSlot, layersUpTo, resolveStoryConfig, storyView, type StoryViewModel } from '@tubutree/app-core/commerce/product-story';
import { preloadImages, STORY_PRELOAD_ROOT_MARGIN, storyPreloadUrls } from '@tubutree/app-core/commerce/story-preload';
import { resolveReelStoryConfig } from '@tubutree/app-core/commerce/story-reel';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import type { IngredientLayerSprite, ProductStoryConfig, StoryFrom } from '@tubutree/shared-types';
import { Button } from './button';
import { Icon } from './icon';
import { ProductImage } from './product-image';
import { SectionTitle } from './section-title';
import { StorySprite } from './story-sprite';
import '../../css/story.css';
import '../../css/story-reel.css';

export interface ProductStoryShowcaseProps {
  product: ProductDetail;
  selectedVariationId?: string;
  onSelectVariation?: (id: string) => void;
  onAddToCart?: () => void;
  onBuyNow?: () => void;
  /** Hết hàng hoặc chưa mua được: khoá hai nút ở thanh dưới của khung toàn màn. */
  buyDisabled?: boolean;
  /** Ghi đè cấu hình (Admin Live Preview): vẽ cả khi `enabled: false`. */
  previewConfig?: ProductStoryConfig;
  /** true: khung 100dvh dạng Reel, có thanh mua ghim đáy. */
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

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

function useReducedMotion(): boolean {
  const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCE_QUERY).matches;
  const [reduced, setReduced] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(REDUCE_QUERY);
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

// Hướng rơi tính theo kích thước chính lớp đó nên đúng ở mọi khổ khung.
const FROM_OFFSET: Record<StoryFrom, { x: string; y: string }> = {
  top: { x: '0%', y: '-160%' },
  bottom: { x: '0%', y: '160%' },
  left: { x: '-160%', y: '0%' },
  right: { x: '160%', y: '0%' },
};

type CssVars = CSSProperties & Record<`--${string}`, string | number>;

function Layer({ layer, isStatic }: { layer: IngredientLayerSprite; isStatic: boolean }) {
  const from = FROM_OFFSET[layer.from] ?? FROM_OFFSET.top;
  const style: CssVars = {
    '--lx': `${layer.xPct}%`,
    '--ly': `${layer.yPct}%`,
    '--rot': `${layer.rotateDeg}deg`,
    '--sc': layer.scale,
    '--fx': from.x,
    '--fy': from.y,
  };
  return (
    <span data-testid="story-layer" data-static={isStatic ? 'true' : undefined} aria-hidden className="tubu-story-layer" style={style}>
      <StorySprite spriteId={layer.spriteId} imageUrl={layer.imageUrl} />
    </span>
  );
}

function Stage({ product, imageUrl, frame, ambient, layers, isStatic }: { product: ProductDetail; imageUrl: string | null; frame: StoryViewModel['frame']; ambient: string; layers: IngredientLayerSprite[]; isStatic: boolean }) {
  return (
    <div
      data-testid="story-stage"
      role="img"
      aria-label={fillCopy('story.stageAlt', { name: product.name })}
      data-frame={frame}
      className="tubu-story-frame tubu-story-stage"
      style={{ background: ambient }}
    >
      <div className="tubu-story-product">
        <ProductImage src={imageUrl} brand={product.brand} width={480} fit="contain" />
      </div>
      {layers.map((l) => (
        <Layer key={l.id} layer={l} isStatic={isStatic} />
      ))}
    </div>
  );
}

const clampPct = (n: number) => Math.min(100, Math.max(0, n));

function Hud({ product, imageUrl, frame, hud }: { product: ProductDetail; imageUrl: string | null; frame: StoryViewModel['frame']; hud: NonNullable<StoryViewModel['hud']> }) {
  return (
    <div data-testid="story-hud" className="tubu-story-hud">
      <div role="group" aria-label={fillCopy('story.hudLabel')} data-frame={frame} className="tubu-story-frame" style={{ background: ambientVar('sand') }}>
        <div className="tubu-story-product" aria-hidden>
          <ProductImage src={imageUrl} brand={product.brand} width={480} fit="contain" />
        </div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden focusable="false" className="tubu-story-hud-lines">
          {hud.points.map((p) => (
            <line
              key={p.id}
              x1={clampPct(p.xPct)}
              y1={clampPct(p.yPct)}
              x2={p.side === 'left' ? 37 : 63}
              y2={clampPct(p.yPct)}
              stroke="var(--color-border-strong)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {hud.points.map((p) => (
          <span key={`dot-${p.id}`} aria-hidden className="tubu-story-dot" style={{ left: `${clampPct(p.xPct)}%`, top: `${clampPct(p.yPct)}%` }} />
        ))}
        {hud.points.map((p) => (
          <div key={p.id} data-testid="story-callout" data-side={p.side} className="tubu-story-callout" style={{ top: `${clampPct(p.yPct)}%` }}>
            <div className="tubu-story-callout-label">{p.label}</div>
            {p.value && <div className="tubu-story-callout-value">{p.value}</div>}
            {p.barPct !== undefined && (
              <div aria-hidden className="tubu-story-callout-track">
                <div className="tubu-story-callout-fill" style={{ width: `${clampPct(p.barPct)}%` }} />
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="tubu-story-closing">{hud.closing}</p>
    </div>
  );
}

function StepChips({ steps, active, onPick }: { steps: { num: string; title: string }[]; active: number; onPick: (i: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  // Chỉ cuộn do khách vuốt mới đổi bước: lần gọi đầu của observer báo cả chip đang nằm giữa, không được tính.
  const touched = useRef(false);
  useEffect(() => {
    const root = track.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const mark = () => {
      touched.current = true;
    };
    root.addEventListener('scroll', mark, { passive: true });
    const io = new IntersectionObserver(
      (entries) => {
        if (!touched.current) return;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = Number((e.target as HTMLElement).dataset.index);
          if (Number.isInteger(i)) onPick(i);
        }
      },
      { root, rootMargin: '0px -40% 0px -40%', threshold: 0.5 },
    );
    root.querySelectorAll('[data-index]').forEach((el) => io.observe(el));
    return () => {
      root.removeEventListener('scroll', mark);
      io.disconnect();
    };
  }, [steps.length, onPick]);
  return (
    <nav aria-label={fillCopy('story.stepsLabel')}>
      <div ref={track} className="tubu-story-chips">
        {steps.map((s, i) => (
          <button
            key={s.num}
            type="button"
            data-testid="story-step-chip"
            data-index={i}
            aria-current={i === active ? 'step' : undefined}
            aria-label={fillCopy('story.stepChip', { num: s.num, title: s.title })}
            className="tubu-story-chip tubu-press tubu-hit-44-square"
            onClick={() => onPick(i)}
          >
            {s.num}
          </button>
        ))}
      </div>
    </nav>
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

function Scenes({ props, view, seen }: { props: ProductStoryShowcaseProps; view: StoryViewModel; seen: boolean }) {
  const { product, selectedVariationId, onSelectVariation } = props;
  const [activeStep, setActiveStep] = useState(0);
  const [arcPick, setArcPick] = useState<number | null>(null);
  useEffect(() => setArcPick(null), [selectedVariationId]);
  const pickStep = useCallback((i: number) => setActiveStep(i), []);

  const arc = view.arc;
  const matched = arc && selectedVariationId ? arc.findIndex((a) => a.variationId === selectedVariationId) : -1;
  const arcActive = arc ? Math.min(arc.length - 1, arcPick ?? (matched >= 0 ? matched : 0)) : 0;
  const ambient = arc && arc[arcActive] ? ambientVar(arc[arcActive]!.ambient) : ambientVar('sand');
  const imageUrl = view.cutoutUrl ?? product.images[0] ?? product.thumbnail ?? null;
  const step = Math.min(activeStep, Math.max(0, view.steps.length - 1));
  const layers = view.animated ? layersUpTo(view.steps, step) : view.staticLayers;
  const showStage = view.steps.length > 0 || arc !== null;

  // Bản tĩnh (giảm chuyển động) đã vẽ mọi lớp ngay nên không còn gì để tải trước; bản động tải ảnh nguyên liệu của chương kế để vuốt sang không chớp trắng.
  // Chỉ tải khi mục Story đã gần khung nhìn: khách không cuộn tới thì không tốn dữ liệu.
  useEffect(() => {
    if (view.animated && seen) preloadImages(storyPreloadUrls(view.steps, step));
  }, [view.animated, view.steps, step, seen]);

  return (
    <>
      {showStage && <Stage product={product} imageUrl={imageUrl} frame={view.frame} ambient={ambient} layers={layers} isStatic={!view.animated} />}

      {arc && (
        <div role="radiogroup" aria-label={fillCopy('story.arcLabel')} className="tubu-story-arc">
          {arc.map((item, i) => {
            const slot = arcSlot(i, arcActive, arc.length);
            const style: CssVars = {
              '--arc-offset': slot.offset,
              '--arc-lift': slot.lift,
              '--arc-rot': `${slot.rotateDeg}deg`,
              '--arc-scale': slot.scale,
              ...(i === arcActive ? { background: ambientVar(item.ambient) } : null),
            };
            return (
              <button
                key={`${item.variationId ?? 'x'}-${i}`}
                type="button"
                role="radio"
                aria-checked={i === arcActive}
                data-testid="story-arc-item"
                className="tubu-story-arc-item tubu-press tubu-hit-44-square"
                onClick={() => {
                  setArcPick(i);
                  if (item.variationId) onSelectVariation?.(item.variationId);
                }}
                style={style}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}

      {view.steps.length > 0 &&
        (view.animated ? (
          <div className="tubu-story-steps">
            <StepChips steps={view.steps} active={step} onPick={pickStep} />
            <div data-testid="story-step-panel" aria-live="polite" className="tubu-story-panel">
              <div key={step} className="tubu-story-panel-in">
                <h3 className="tubu-story-step-title">{view.steps[step]!.title}</h3>
                <p className="tubu-story-step-body">{view.steps[step]!.body}</p>
              </div>
            </div>
          </div>
        ) : (
          <ol data-testid="story-static-steps" className="tubu-story-static">
            {view.steps.map((s) => (
              <li key={s.num}>
                <div className="tubu-story-static-num">{s.num}</div>
                <h3 className="tubu-story-step-title">{s.title}</h3>
                <p className="tubu-story-step-body">{s.body}</p>
              </li>
            ))}
          </ol>
        ))}

      {view.hud && <Hud product={product} imageUrl={imageUrl} frame={view.frame} hud={view.hud} />}
    </>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function Fullscreen({ props, body }: { props: ProductStoryShowcaseProps; body: JSX.Element }) {
  const { onClose, onAddToCart, onBuyNow, buyDisabled = false, reel = false, addPrice, onNext, position } = props;
  const root = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !root.current) return;
      const items = Array.from(root.current.querySelectorAll<HTMLElement>(FOCUSABLE));
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
      prevFocus?.focus();
    };
  }, []);

  const title = fillCopy('story.title');
  const heading = <SectionTitle block>{title}</SectionTitle>;
  const addLabel = reel && addPrice ? fillCopy('reel.addPrice', { price: addPrice }) : fillCopy('story.addToCart');
  return createPortal(
    <div ref={root} role="dialog" aria-modal="true" aria-label={title} className="tubu-story-dialog">
      <div className="tubu-story-dialog-head">
        {position ? (
          <div className="tubu-reel-heading">
            {heading}
            <span data-testid="story-position" className="tubu-story-position">
              {position}
            </span>
          </div>
        ) : (
          heading
        )}
        <button ref={closeBtn} type="button" data-testid="story-close" aria-label={fillCopy('story.close')} className="tubu-story-close tubu-press tubu-hit-44-square" onClick={onClose}>
          <Icon icon={X} size="md" />
        </button>
      </div>
      <div data-testid="story-scroll" tabIndex={0} className="tubu-story-scroll">
        {body}
      </div>
      {reel ? (
        <div className="tubu-story-bar" data-reel="true">
          {onNext && (
            <Button variant="secondary" size="lg" className="tubu-reel-next-btn" data-testid="story-next" aria-label={fillCopy('reel.nextAria')} onPress={onNext}>
              <span className="tubu-reel-next">
                <span className="tubu-reel-next-label">{fillCopy('reel.next')}</span>
                <Icon icon={ChevronRight} size="sm" tone="current" />
              </span>
            </Button>
          )}
          <Button variant="primary" size="lg" className="tubu-reel-add-btn" data-testid="story-add-to-cart" disabled={buyDisabled} onPress={() => onAddToCart?.()}>
            {buyDisabled ? fillCopy('story.soldOut') : addLabel}
          </Button>
        </div>
      ) : (
        <div className="tubu-story-bar">
          <Button variant="secondary" size="lg" data-testid="story-add-to-cart" disabled={buyDisabled} onPress={() => onAddToCart?.()}>
            {fillCopy('story.addToCart')}
          </Button>
          <Button variant="primary" size="lg" data-testid="story-buy-now" disabled={buyDisabled} onPress={() => onBuyNow?.()}>
            {fillCopy(buyDisabled ? 'story.soldOut' : 'story.buyNow')}
          </Button>
        </div>
      )}
    </div>,
    document.body,
  );
}

export function ProductStoryShowcase(props: ProductStoryShowcaseProps): JSX.Element | null {
  const { product, previewConfig, fullscreen, reel = false } = props;
  const reduced = useReducedMotion();
  const config = useMemo(() => previewConfig ?? (reel ? resolveReelStoryConfig(product) : resolveStoryConfig(product)), [previewConfig, product, reel]);
  const view = useMemo(() => (config ? storyView(config, { reducedMotion: reduced }) : null), [config, reduced]);
  const sectionRef = useRef<HTMLElement>(null);
  const seen = useSeen(sectionRef, config !== null && view !== null);
  if (!config || !view) return null;

  const title = fillCopy('story.title');
  const section = (
    <section ref={sectionRef} data-testid="product-story" aria-label={title} data-animated={view.animated ? 'true' : 'false'} data-inline={fullscreen ? undefined : 'true'} className="tubu-story">
      {!fullscreen && (
        <SectionTitle block style={{ marginBottom: 'var(--space-stack-sm)' }}>
          {title}
        </SectionTitle>
      )}
      <Scenes props={props} view={view} seen={seen} />
    </section>
  );
  return fullscreen ? <Fullscreen props={props} body={section} /> : section;
}
