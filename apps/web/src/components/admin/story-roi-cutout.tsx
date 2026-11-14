'use client';

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { BTN_PRIMARY, BTN_SECONDARY, Notice } from './ui';
import {
  applyRoiCutout,
  centerPortraitRoi,
  downscaleRgba,
  dragRoi,
  formatPct,
  FULL_ROI,
  insetRoi,
  PREVIEW_EDGE,
  posterFrameRoi,
  ROI_DATA_URL_MAX,
  type Rgba,
  type Roi,
  type RoiHandle,
  TOLERANCE_DEFAULT,
  TOLERANCE_MAX,
} from './story-cutout-roi';

const KEY_STEP = 0.01;
/** Tỉ lệ 0..1 sang CSS %, làm tròn 2 chữ số để không ghi `19.999999999999996%` vào style. */
const pctCss = (n: number) => `${Math.round(n * 10000) / 100}%`;
const HANDLES: {
  handle: Exclude<RoiHandle, 'move'>;
  label: string;
  style: (r: Roi) => { left: string; top: string };
  cursor: string;
}[] = [
  {
    handle: 'nw',
    label: 'góc trên trái',
    style: (r) => ({ left: pctCss(r.x), top: pctCss(r.y) }),
    cursor: 'cursor-nwse-resize',
  },
  {
    handle: 'ne',
    label: 'góc trên phải',
    style: (r) => ({ left: pctCss(r.x + r.width), top: pctCss(r.y) }),
    cursor: 'cursor-nesw-resize',
  },
  {
    handle: 'sw',
    label: 'góc dưới trái',
    style: (r) => ({ left: pctCss(r.x), top: pctCss(r.y + r.height) }),
    cursor: 'cursor-nesw-resize',
  },
  {
    handle: 'se',
    label: 'góc dưới phải',
    style: (r) => ({ left: pctCss(r.x + r.width), top: pctCss(r.y + r.height) }),
    cursor: 'cursor-nwse-resize',
  },
];
/** Nền ô vuông xám trắng để thấy phần trong suốt. */
const CHECKER = {
  backgroundColor: 'rgb(255 255 255)',
  backgroundImage:
    'conic-gradient(rgb(214 211 209) 25%, transparent 0 50%, rgb(214 211 209) 0 75%, transparent 0)',
  backgroundSize: '16px 16px',
} as const;

function drawRgba(ctx: CanvasRenderingContext2D, img: Rgba) {
  const out = ctx.createImageData(img.width, img.height);
  out.data.set(img.data);
  ctx.putImageData(out, 0, 0);
}

type Encoded = { ok: true; url: string } | { ok: false; reason: 'canvas' | 'size' };

/**
 * Mã hoá ảnh đã tách nền thành WebP 85%. Safari không mã hoá WebP từ canvas mà trả PNG, nặng hơn nhiều và dễ vượt trần của máy chủ khi Lưu sản phẩm:
 * vượt `ROI_DATA_URL_MAX` thì thu nhỏ dần (x0,75, tối đa 6 lần) tới khi vừa.
 */
function encodeWithinLimit(img: Rgba): Encoded {
  let current = img;
  for (let attempt = 0; attempt < 7; attempt++) {
    const canvas = document.createElement('canvas');
    canvas.width = current.width;
    canvas.height = current.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, reason: 'canvas' };
    drawRgba(ctx, current);
    const url = canvas.toDataURL('image/webp', 0.85);
    if (url.length <= ROI_DATA_URL_MAX) return { ok: true, url };
    current = downscaleRgba(current, Math.floor(Math.max(current.width, current.height) * 0.75));
  }
  return { ok: false, reason: 'size' };
}

/** Đọc điểm ảnh của một data URL cùng nguồn (không bị khoá canvas). Lỗi hoặc môi trường không có canvas thì trả null. */
function readPixels(src: string): Promise<Rgba | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx || width === 0 || height === 0) return resolve(null);
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, width, height);
        resolve({ data, width, height });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Khoanh phần bên trong khung poster (chai, túi) bằng khung kéo được, rồi tách nền sáng loang từ mép khung vừa cắt.
 * Ảnh poster có khung màu chạm mép nên tách nền nguyên ảnh được 0%; cắt vào trong thì nền trắng quanh sản phẩm nối ra mép và bị tách sạch.
 * `src` phải là data URL (ảnh ngoài chưa đăng ký bị khoá đọc điểm ảnh).
 */
export function StoryRoiCutout({
  src,
  onUse,
  onClose,
  disabled = false,
}: {
  src: string;
  onUse: (dataUrl: string) => void;
  onClose: () => void;
  disabled?: boolean;
}) {
  const [pixels, setPixels] = useState<Rgba | null>(null);
  const [failed, setFailed] = useState(false);
  const [roi, setRoi] = useState<Roi>(FULL_ROI);
  const [tolerance, setTolerance] = useState(TOLERANCE_DEFAULT);
  const boxRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ handle: RoiHandle; x: number; y: number; start: Roi; id: number } | null>(
    null,
  );

  useEffect(() => {
    let live = true;
    setPixels(null);
    setFailed(false);
    setRoi(FULL_ROI);
    setTolerance(TOLERANCE_DEFAULT);
    void readPixels(src).then((p) => {
      if (!live) return;
      if (p) setPixels(p);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [src]);

  // Khung kéo cập nhật ngay; phần xem trước và số % tính trên bản thu nhỏ (ảnh đầy đủ chỉ tính lúc bấm Dùng) theo giá trị trễ để kéo không giật.
  const settled = useDeferredValue(roi);
  const settledTolerance = useDeferredValue(tolerance);
  const preview = useMemo(() => (pixels ? downscaleRgba(pixels, PREVIEW_EDGE) : null), [pixels]);
  const result = useMemo(
    () => (preview ? applyRoiCutout(preview, settled, settledTolerance) : null),
    [preview, settled, settledTolerance],
  );
  const [tooBig, setTooBig] = useState(false);
  useEffect(() => setTooBig(false), [roi, tolerance]);

  useEffect(() => {
    const canvas = resultRef.current;
    if (!canvas || !result) return;
    canvas.width = result.image.width;
    canvas.height = result.image.height;
    const ctx = canvas.getContext('2d');
    if (ctx) drawRgba(ctx, result.image);
  }, [result]);

  const begin = (handle: RoiHandle) => (e: PointerEvent<HTMLElement>) => {
    if (disabled || e.button !== 0) return;
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Môi trường không bắt được pointer: kéo vẫn chạy theo onPointerMove của chính phần tử.
    }
    drag.current = { handle, x: e.clientX, y: e.clientY, start: roi, id: e.pointerId };
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const box = boxRef.current?.getBoundingClientRect();
    if (disabled || !d || d.id !== e.pointerId || !box || box.width === 0 || box.height === 0)
      return;
    setRoi(
      dragRoi(d.start, d.handle, (e.clientX - d.x) / box.width, (e.clientY - d.y) / box.height),
    );
  };
  const end = (e: PointerEvent<HTMLElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };
  const nudge = (handle: RoiHandle) => (e: KeyboardEvent<HTMLElement>) => {
    const step =
      e.key === 'ArrowLeft'
        ? [-KEY_STEP, 0]
        : e.key === 'ArrowRight'
          ? [KEY_STEP, 0]
          : e.key === 'ArrowUp'
            ? [0, -KEY_STEP]
            : e.key === 'ArrowDown'
              ? [0, KEY_STEP]
              : null;
    if (!step || disabled) return;
    e.preventDefault();
    setRoi((cur) => dragRoi(cur, handle, step[0] ?? 0, step[1] ?? 0));
  };

  const finish = () => {
    if (!pixels || disabled) return;
    const encoded = encodeWithinLimit(applyRoiCutout(pixels, roi, tolerance).image);
    if (encoded.ok) onUse(encoded.url);
    else if (encoded.reason === 'size') setTooBig(true);
    else setFailed(true);
  };

  const pct = result?.removedPct ?? 0;
  const pending = settled !== roi || settledTolerance !== tolerance;

  return (
    <div
      className="space-y-3 rounded-card border border-stone-200 bg-stone-50 p-3"
      data-testid="story-roi-cutout"
    >
      <div className="text-sm font-medium text-stone-900">
        Khoanh phần sản phẩm trước khi tách nền
      </div>
      <p className="text-xs text-stone-600" id="story-roi-hint">
        Kéo bốn góc hoặc kéo cả khung để khoanh chai, túi bên trong khung màu của poster. Dùng phím
        mũi tên khi đang chọn một góc để dịch 1%.
      </p>
      {failed && (
        <Notice tone="danger" role="alert">
          Không đọc được ảnh này để cắt. Thử ảnh khác.
        </Notice>
      )}
      {tooBig && (
        <Notice tone="danger" role="alert">
          Ảnh sau khi cắt vẫn quá nặng để lưu. Thu khung nhỏ lại hoặc dùng ảnh gốc nhẹ hơn.
        </Notice>
      )}
      {!failed && !pixels && <p className="text-xs text-stone-600">Đang đọc ảnh…</p>}
      {pixels && (
        <>
          <div className="relative mx-auto w-full max-w-[460px] touch-none select-none p-[22px]">
            <div
              ref={boxRef}
              className="relative w-full"
              style={{ aspectRatio: `${pixels.width} / ${pixels.height}` }}
              data-testid="story-roi-stage"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- xem trước data URL do máy chủ trả, không qua trình tối ưu ảnh */}
              <img
                src={src}
                alt="Ảnh gốc để khoanh"
                className="absolute inset-0 h-full w-full select-none object-fill"
                draggable={false}
              />
              <div className="absolute inset-0 overflow-hidden">
                <div
                  data-testid="story-roi-rect"
                  role="presentation"
                  className="absolute cursor-move border-2 border-forest-600 shadow-[0_0_0_9999px_rgb(0_0_0/0.5)] ring-1 ring-stone-0"
                  style={{
                    left: pctCss(roi.x),
                    top: pctCss(roi.y),
                    width: pctCss(roi.width),
                    height: pctCss(roi.height),
                  }}
                  onPointerDown={begin('move')}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                />
              </div>
              {HANDLES.map((h) => (
                <button
                  key={h.handle}
                  type="button"
                  data-testid={`story-roi-handle-${h.handle}`}
                  aria-label={`Kéo ${h.label} của khung cắt`}
                  aria-describedby="story-roi-hint"
                  disabled={disabled}
                  className={`absolute grid h-[44px] w-[44px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full disabled:opacity-50 ${h.cursor}`}
                  style={h.style(roi)}
                  onPointerDown={begin(h.handle)}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                  onKeyDown={nudge(h.handle)}
                >
                  <span className="h-4 w-4 rounded-full border-2 border-forest-600 bg-stone-0" />
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={BTN_SECONDARY}
              disabled={disabled}
              onClick={() => setRoi(insetRoi(10))}
            >
              Cắt viền 10%
            </button>
            <button
              type="button"
              className={BTN_SECONDARY}
              disabled={disabled}
              onClick={() => setRoi(insetRoi(18))}
            >
              Cắt viền 18%
            </button>
            <button
              type="button"
              className={BTN_SECONDARY}
              disabled={disabled}
              onClick={() => setRoi(posterFrameRoi())}
            >
              Bỏ viền khung poster (co 12%)
            </button>
            <button
              type="button"
              className={BTN_SECONDARY}
              disabled={disabled}
              onClick={() => setRoi(centerPortraitRoi())}
            >
              Khung dọc trung tâm (60%×82%)
            </button>
            <button
              type="button"
              className={BTN_SECONDARY}
              disabled={disabled}
              onClick={() => {
                setRoi(FULL_ROI);
                setTolerance(TOLERANCE_DEFAULT);
              }}
            >
              Đặt lại
            </button>
          </div>

          <div className="flex min-h-[44px] items-center gap-3">
            <label htmlFor="story-roi-tolerance" className="shrink-0 text-xs text-stone-700">
              Độ lệch màu nền
            </label>
            <input
              id="story-roi-tolerance"
              data-testid="story-roi-tolerance"
              type="range"
              aria-label="Độ lệch màu nền"
              aria-describedby="story-roi-tolerance-hint"
              min={0}
              max={TOLERANCE_MAX}
              step={1}
              value={tolerance}
              disabled={disabled}
              className="h-[44px] min-w-0 flex-1 accent-forest-600 disabled:opacity-50"
              onChange={(e) => setTolerance(Number(e.target.value))}
            />
            <span
              className="w-8 shrink-0 text-right text-xs font-medium tabular-nums text-stone-900"
              data-testid="story-roi-tolerance-value"
            >
              {tolerance}
            </span>
          </div>
          <p className="text-xs text-stone-600" id="story-roi-tolerance-hint">
            Nền ảnh hơi xám thì kéo sang phải để tách thêm; kéo về 0 chỉ tách nền trắng tinh.
          </p>

          <div className="space-y-1">
            <p className="text-sm text-stone-900" role="status" aria-live="polite">
              <span className="tabular-nums font-medium" data-testid="story-roi-pct">
                {formatPct(pct)}%
              </span>{' '}
              nền đã tách
            </p>
            {pct === 0 && !pending && (
              <p className="text-xs text-stone-600">
                Chưa tách được nền: khung màu hoặc nền không trắng đang chạm mép. Kéo khung vào bên
                trong sản phẩm hoặc bấm Cắt viền.
              </p>
            )}
            <div
              className="mx-auto w-full max-w-[460px] overflow-hidden rounded-card border border-stone-200"
              style={CHECKER}
              data-testid="story-roi-result"
            >
              <canvas
                ref={resultRef}
                className="block h-auto w-full"
                aria-label="Xem trước ảnh sau khi tách nền"
                role="img"
              />
            </div>
          </div>
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={disabled || !pixels || pending}
          onClick={finish}
        >
          Dùng ảnh đã cắt làm ảnh sân khấu
        </button>
        <button type="button" className={BTN_SECONDARY} onClick={onClose}>
          Đóng
        </button>
      </div>
    </div>
  );
}
