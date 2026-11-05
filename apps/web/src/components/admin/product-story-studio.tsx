'use client';

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { parseStoryConfig, STORY_LIMITS, type AssemblyStep, type HudCalloutPoint, type ProductStoryConfig, type StoryScene } from '@tubutree/shared-types';
import type { ProductDetail as PublicProduct } from '@tubutree/app-core/api/catalog';
import { resolveStoryConfig } from '@tubutree/app-core/commerce/product-story';
import { STORY_SPRITES } from '@tubutree/app-core/commerce/story-sprites';
import { ProductStoryShowcase } from '@/components/mini/product-story-showcase';
import { extractStoryAssets, type ProductDetail, type StoryAssetsResult } from '@/lib/product-categories';
import { actionErrorText } from '@/lib/admin-error-text';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, FIELD_CLASS, INPUT_CLASS, Notice, chipClass } from './ui';

const EMPTY: ProductStoryConfig = { version: 1, enabled: true, scenes: [] };
const IMAGE_URL = /\.(png|jpe?g|webp|gif)(\?.*)?$/i;
const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

type Assembly = Extract<StoryScene, { kind: 'ingredient_assembly' }>;
type Hud = Extract<StoryScene, { kind: 'hud_callouts' }>;
const asm = (c: ProductStoryConfig) => c.scenes.find((s): s is Assembly => s.kind === 'ingredient_assembly');
const hud = (c: ProductStoryConfig) => c.scenes.find((s): s is Hud => s.kind === 'hud_callouts');

/** Sản phẩm dạng khách thấy, dựng từ dữ liệu admin, để Live Preview vẽ đúng thành phần của khách. */
function previewProduct(p: ProductDetail): PublicProduct {
  const variations = p.variations ?? [];
  return {
    id: p.id,
    slug: p.slug ?? '',
    brand: p.brand,
    name: p.name,
    shortDesc: p.shortDesc,
    description: p.description,
    images: p.images,
    thumbnail: p.images[0] ?? null,
    basePrice: p.basePrice,
    salePrice: p.salePrice,
    certifications: p.certifications ?? [],
    ingredients: Array.isArray(p.ingredients) ? (p.ingredients as PublicProduct['ingredients']) : null,
    variations: variations.map((v) => ({ id: v.id, sku: '', name: v.name, attributes: {}, retailPrice: p.basePrice, salePrice: null, stock: 1 })),
  };
}

/**
 * Story Studio: sửa cấu hình câu chuyện sản phẩm và xem trước ngay. Thành phần có kiểm soát: `value` null là "đang dùng kịch bản mẫu hoặc tự sinh",
 * lần sửa đầu tiên chốt kịch bản đó thành cấu hình riêng rồi mới đổi.
 */
export function ProductStoryStudio({
  product,
  value,
  onChange,
  onAddImage,
  disabled = false,
}: {
  product: ProductDetail;
  value: ProductStoryConfig | null;
  onChange: (next: ProductStoryConfig | null) => void;
  /** Thêm ảnh tách nền (data URL WebP) vào danh sách ảnh sản phẩm; không truyền thì không hiện nút. */
  onAddImage?: (dataUrl: string) => void;
  disabled?: boolean;
}) {
  const [pick, setPick] = useState(0);
  const [mode, setMode] = useState<'phone' | 'desktop'>('phone');
  const [note, setNote] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [found, setFound] = useState<StoryAssetsResult | null>(null);

  const generated = useMemo(
    () =>
      resolveStoryConfig({
        slug: product.slug ?? '',
        name: product.name,
        brand: product.brand,
        shortDesc: product.shortDesc,
        certifications: product.certifications ?? [],
        ingredients: product.ingredients,
        variations: product.variations ?? [],
        storyConfig: null,
      }),
    [product],
  );
  const current = value ?? generated ?? EMPTY;
  const check = value ? parseStoryConfig(value) : null;
  const preview = useMemo(() => previewProduct(product), [product]);

  const edit = (fn: (c: ProductStoryConfig) => void) => {
    const next = structuredClone(current);
    fn(next);
    setNote(null);
    onChange(next);
  };

  const extract = useMutation({
    mutationFn: () => {
      const v = link.trim();
      return extractStoryAssets(product.id, IMAGE_URL.test(v) ? { imageUrls: [v] } : { pageUrl: v });
    },
    onSuccess: (r) => setFound(r),
  });

  const steps = asm(current)?.steps ?? [];
  const points = hud(current)?.points ?? [];
  const stage = current.cutoutUrl ?? product.images[0] ?? null;
  const sel = Math.min(pick, Math.max(points.length - 1, 0));

  const setStep = (i: number, fn: (s: AssemblyStep) => void) =>
    edit((c) => {
      const s = asm(c)?.steps[i];
      if (s) fn(s);
    });
  const setPoint = (i: number, fn: (p: HudCalloutPoint) => void) =>
    edit((c) => {
      const p = hud(c)?.points[i];
      if (p) fn(p);
    });

  return (
    <fieldset className="space-y-4" disabled={disabled}>
      <legend className="text-sm font-medium text-stone-900">Câu chuyện sản phẩm</legend>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-stone-800 sm:min-h-0">
          <input
            type="checkbox"
            data-testid="story-enabled"
            checked={current.enabled}
            disabled={disabled}
            onChange={(e) =>
              edit((c) => {
                c.enabled = e.target.checked;
              })
            }
          />
          Bật câu chuyện sản phẩm
        </label>
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={disabled}
          onClick={() => {
            if (!generated) return setNote('Chưa đủ dữ liệu: cần thành phần hoặc từ 2 biến thể để tự sinh kịch bản.');
            setNote(null);
            onChange(generated);
          }}
        >
          ⚡ Tự sinh Story từ Thành phần &amp; Mô tả
        </button>
        {value && (
          <button
            type="button"
            className={BTN_SECONDARY}
            disabled={disabled}
            onClick={() => {
              setNote(null);
              onChange(null);
            }}
          >
            Dùng kịch bản mẫu
          </button>
        )}
      </div>
      {!value && <p className="text-xs text-stone-600">Đang dùng kịch bản mẫu hoặc tự sinh, chưa lưu cấu hình riêng. Sửa bất kỳ mục nào bên dưới để tạo cấu hình riêng.</p>}
      {note && (
        <Notice tone="warning" role="status">
          {note}
        </Notice>
      )}
      {check && !check.ok && (
        <Notice tone="danger" role="alert">
          Cấu hình không hợp lệ: {check.error}.
        </Notice>
      )}

      <div className="space-y-2">
        <div className="text-sm font-medium text-stone-900">Lấy ảnh từ link</div>
        <div className="flex flex-wrap gap-2">
          <input aria-label="Link trang sản phẩm hoặc ảnh" className={`${INPUT_CLASS} min-w-0 flex-1`} placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
          <button type="button" className={BTN_SECONDARY} disabled={disabled || extract.isPending || link.trim() === ''} onClick={() => extract.mutate()}>
            {extract.isPending ? 'Đang lấy…' : 'Lấy ảnh'}
          </button>
        </div>
        {extract.isError && (
          <Notice tone="danger" role="alert">
            {extract.error instanceof Error ? actionErrorText(extract.error) : 'Không lấy được ảnh.'}
          </Notice>
        )}
        {found && found.images.length === 0 && <p className="text-xs text-stone-600">Không tìm thấy ảnh dùng được ở link này.</p>}
        <ul className="grid grid-cols-2 gap-2">
          {found?.images.map((im) => {
            const cut = found.cutouts.find((c) => c.sourceUrl === im.url);
            return (
              <li key={im.url} className="space-y-1 rounded-card border border-stone-200 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- xem trước ảnh ngoài chưa đăng ký, không qua trình tối ưu ảnh */}
                <img src={cut?.dataUrl ?? im.url} alt="" className="h-24 w-full object-contain" />
                <div className="text-[11px] text-stone-500">
                  {im.width}×{im.height}
                </div>
                <button
                  type="button"
                  className={BTN_SMALL}
                  disabled={disabled}
                  onClick={() =>
                    edit((c) => {
                      c.cutoutUrl = im.url;
                    })
                  }
                >
                  Dùng làm ảnh sân khấu
                </button>
                {cut && onAddImage && (
                  <button type="button" className={BTN_SMALL} disabled={disabled} onClick={() => onAddImage(cut.dataUrl)}>
                    Thêm bản tách nền vào ảnh sản phẩm
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="space-y-3">
        <div className="text-sm font-medium text-stone-900">Các bước nguyên liệu (tối đa {STORY_LIMITS.maxSteps})</div>
        {steps.length === 0 && <p className="text-xs text-stone-600">Chưa có bước nào. Dùng nút tự sinh để tạo kịch bản.</p>}
        {steps.map((s, i) => (
          <div key={i} className="space-y-2 rounded-card border border-stone-200 p-3">
            <input
              aria-label={`Tiêu đề bước ${i + 1}`}
              className={INPUT_CLASS}
              maxLength={STORY_LIMITS.maxLabel}
              value={s.title}
              onChange={(e) =>
                setStep(i, (st) => {
                  st.title = e.target.value;
                })
              }
            />
            <input
              aria-label={`Nội dung bước ${i + 1}`}
              className={INPUT_CLASS}
              maxLength={STORY_LIMITS.maxBody}
              value={s.body}
              onChange={(e) =>
                setStep(i, (st) => {
                  st.body = e.target.value;
                })
              }
            />
            <ul className="flex flex-wrap gap-2">
              {s.layers.map((l, j) => (
                <li key={l.id} className="flex items-center gap-1 rounded-control bg-stone-100 px-2 py-1 text-xs text-stone-800">
                  {l.label}
                  <button
                    type="button"
                    aria-label={`Xoá ${l.label} khỏi bước ${i + 1}`}
                    className="min-h-[44px] px-2 sm:min-h-0"
                    onClick={() =>
                      setStep(i, (st) => {
                        st.layers.splice(j, 1);
                      })
                    }
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            {s.layers.length < STORY_LIMITS.maxLayersPerStep && (
              <select
                aria-label={`Thêm nguyên liệu vào bước ${i + 1}`}
                className={FIELD_CLASS}
                value=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) return;
                  setStep(i, (st) => {
                    st.layers.push({
                      id: `${id}-${st.layers.length + 1}-${Math.random().toString(36).slice(2, 6)}`,
                      spriteId: id,
                      label: STORY_SPRITES[id]?.label ?? id,
                      from: 'top',
                      xPct: clamp(30 + st.layers.length * 12),
                      yPct: clamp(30 + st.layers.length * 10),
                      scale: 1,
                      rotateDeg: 0,
                    });
                  });
                }}
              >
                <option value="">Thêm nguyên liệu…</option>
                {Object.entries(STORY_SPRITES).map(([id, sp]) => (
                  <option key={id} value={id}>
                    {sp.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium text-stone-900">Điểm chỉ thành phần (bấm lên ảnh để đặt vị trí, tối đa {STORY_LIMITS.maxHudPoints})</div>
        <div className="flex flex-wrap gap-2">
          {points.map((p, i) => (
            <button key={p.id} type="button" aria-pressed={i === sel} className={chipClass(i === sel)} onClick={() => setPick(i)}>
              {p.label}
            </button>
          ))}
          {points.length < STORY_LIMITS.maxHudPoints && (
            <button
              type="button"
              className={BTN_SMALL}
              onClick={() => {
                edit((c) => {
                  let h = hud(c);
                  if (!h) {
                    h = { kind: 'hud_callouts', points: [], closing: '' };
                    c.scenes.push(h);
                  }
                  h.points.push({ id: `p${Date.now().toString(36)}`, xPct: 50, yPct: 50, label: 'Thành phần', side: h.points.length % 2 === 0 ? 'left' : 'right' });
                });
                setPick(points.length);
              }}
            >
              Thêm điểm
            </button>
          )}
        </div>
        <div
          data-testid="story-hud-canvas"
          role="presentation"
          className="relative mx-auto aspect-[3/4] w-full max-w-[320px] cursor-crosshair overflow-hidden rounded-card border border-stone-200 bg-stone-100"
          onClick={(e) => {
            if (points.length === 0 || disabled) return;
            const r = e.currentTarget.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return;
            const x = clamp(((e.clientX - r.left) / r.width) * 100);
            const y = clamp(((e.clientY - r.top) / r.height) * 100);
            setPoint(sel, (p) => {
              p.xPct = x;
              p.yPct = y;
            });
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- ảnh tuỳ chọn của admin, cần khung cố định để quy đổi toạ độ */}
          {stage && <img src={stage} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-contain" />}
          {points.map((p, i) => (
            <span
              key={p.id}
              aria-hidden
              className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-stone-0 ${i === sel ? 'size-4 bg-forest-600' : 'size-3 bg-stone-600'}`}
              style={{ left: `${p.xPct}%`, top: `${p.yPct}%` }}
            />
          ))}
        </div>
        {points[sel] && (
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              aria-label="Tên điểm chỉ"
              className={INPUT_CLASS}
              maxLength={STORY_LIMITS.maxLabel}
              value={points[sel].label}
              onChange={(e) =>
                setPoint(sel, (p) => {
                  p.label = e.target.value;
                })
              }
            />
            <input
              aria-label="Giá trị điểm chỉ"
              className={INPUT_CLASS}
              maxLength={STORY_LIMITS.maxLabel}
              placeholder="Ví dụ 2%"
              value={points[sel].value ?? ''}
              onChange={(e) =>
                setPoint(sel, (p) => {
                  if (e.target.value) p.value = e.target.value;
                  else delete p.value;
                })
              }
            />
            <button
              type="button"
              className={BTN_SECONDARY}
              onClick={() => {
                edit((c) => {
                  hud(c)?.points.splice(sel, 1);
                });
                setPick(0);
              }}
            >
              Xoá điểm
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-stone-900">Xem trước</div>
          <button type="button" aria-pressed={mode === 'phone'} className={chipClass(mode === 'phone')} onClick={() => setMode('phone')}>
            Điện thoại
          </button>
          <button type="button" aria-pressed={mode === 'desktop'} className={chipClass(mode === 'desktop')} onClick={() => setMode('desktop')}>
            Máy tính
          </button>
        </div>
        <div
          data-testid="story-preview-frame"
          data-mode={mode}
          className={`mx-auto overflow-hidden rounded-card border border-stone-300 bg-stone-0 ${mode === 'phone' ? 'w-[375px] max-w-full' : 'w-full'}`}
        >
          <ProductStoryShowcase product={preview} previewConfig={current} />
        </div>
      </div>
    </fieldset>
  );
}
