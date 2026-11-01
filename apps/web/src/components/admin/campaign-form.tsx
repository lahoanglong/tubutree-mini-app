'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CampaignAudience, CampaignLinkType, CampaignPlacement } from '@tubutree/app-core/api/campaign';
import { CAMPAIGN_INTERNAL_TARGETS } from '@tubutree/app-core/commerce/campaign';
import {
  createAdminCampaign,
  setAdminCampaignCoupons,
  setAdminCampaignProducts,
  updateAdminCampaign,
  type AdminCampaignDetail,
  type AdminCampaignInput,
} from '@/lib/admin-campaigns-client';
import { isoToVnLocal, parseCouponCodes, vnLocalToIso } from '@/lib/admin-campaign-form';
import { ImageUrlField } from './image-url-field';
import { ProductPicker } from './product-picker';
import { BTN_LINK_DANGER, BTN_PRIMARY, BTN_SECONDARY, Field, FIELD_CLASS, INPUT_CLASS, TOUCH_H } from './ui';
import { VnDateTimeInput } from './vn-date-input';

export const PLACEMENT_LABELS: Record<CampaignPlacement, string> = { HOME_TOP: 'Đầu Trang chủ', OFFERS_TOP: 'Đầu Ưu đãi' };
export const AUDIENCE_LABELS: Record<CampaignAudience, string> = { ALL: 'Mọi khách', NEW: 'Khách mới', RETURNING: 'Khách cũ' };
const LINK_LABELS: Record<CampaignLinkType, string> = {
  CAMPAIGN_PAGE: 'Trang chiến dịch',
  PRODUCT: 'Một sản phẩm',
  CATEGORY: 'Một danh mục',
  URL_INTERNAL: 'Trang trong app',
};
const MAX_PRODUCTS = 200;
const MAX_COUPONS = 10;
const IMAGE_LABEL = 'Ảnh banner (tỉ lệ 5:2, ví dụ 1500×600)';
// Từ lg banner Ưu đãi trên web đổi sang khung 4:1 (ảnh phủ kín khung, cắt đều trên dưới): ảnh 5:2 mất khoảng 37% chiều cao, nên chữ và logo phải nằm ở dải giữa.
const OFFERS_BANNER_SAFE_ZONE = 'Màn hình máy tính hiển thị banner Đầu Ưu đãi thấp hơn (khung 4:1) và cắt phần trên, dưới của ảnh. Đặt chữ và logo trong dải giữa, cao khoảng 60% ảnh.';

interface PickedProduct {
  id: string;
  name: string;
}

const needsValue = (t: CampaignLinkType) => t !== 'CAMPAIGN_PAGE';
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * Form tạo/sửa một chiến dịch. Mốc giờ nhập theo giờ Việt Nam (đổi sang ISO +07:00 bất kể múi giờ máy admin). Đích "Trang trong app" chỉ chọn trong danh sách
 * đóng của app-core: giá trị tự gõ không dẫn tới đường dẫn nào ngoài app. Tạo xong mới đặt sản phẩm và mã (hai lời gọi riêng của API): một bước sau lỗi thì chiến dịch
 * đã có, form chuyển sang chế độ sửa chính chiến dịch đó để bấm Lưu lại không tạo trùng.
 */
export function CampaignForm({ initial, onDone, onCancel }: { initial?: AdminCampaignDetail; onDone: () => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const [savedId, setSavedId] = useState<string | null>(initial?.id ?? null);
  const baseline = useState(() => ({ products: (initial?.products ?? []).map((p) => p.id), codes: initial?.couponCodes ?? [] }))[0];
  const [title, setTitle] = useState(initial?.title ?? '');
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? '');
  const [slug, setSlug] = useState('');
  const [placement, setPlacement] = useState<CampaignPlacement>(initial?.placement ?? 'HOME_TOP');
  const [audience, setAudience] = useState<CampaignAudience>(initial?.audience ?? 'ALL');
  const [image, setImage] = useState(initial?.image ?? '');
  const [linkType, setLinkType] = useState<CampaignLinkType>(initial?.linkType ?? 'CAMPAIGN_PAGE');
  const [linkValue, setLinkValue] = useState(initial?.linkValue ?? '');
  const [startAt, setStartAt] = useState(initial ? isoToVnLocal(initial.startAt) : '');
  const [endAt, setEndAt] = useState(initial ? isoToVnLocal(initial.endAt) : '');
  const [startPending, setStartPending] = useState(false);
  const [endPending, setEndPending] = useState(false);
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [products, setProducts] = useState<PickedProduct[]>(() => (initial?.products ?? []).map((p) => ({ id: p.id, name: p.name })));
  const [codesText, setCodesText] = useState((initial?.couponCodes ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const field = `${FIELD_CLASS} ${TOUCH_H}`;
  const valueReady = !needsValue(linkType) || linkValue.trim() !== '';
  const canSave = title.trim() !== '' && image.trim() !== '' && startAt !== '' && endAt !== '' && !startPending && !endPending && valueReady && !busy;

  const addProduct = (p: { id: string; label: string } | null) => {
    if (!p) return;
    setProducts((cur) => (cur.some((x) => x.id === p.id) || cur.length >= MAX_PRODUCTS ? cur : [...cur, { id: p.id, name: p.label }]));
  };

  const save = async () => {
    setError(null);
    const startIso = vnLocalToIso(startAt);
    const endIso = vnLocalToIso(endAt);
    if (!startIso || !endIso) return setError('Chọn đủ ngày và giờ bắt đầu, kết thúc.');
    if (Date.parse(endIso) <= Date.parse(startIso)) return setError('Giờ kết thúc phải sau giờ bắt đầu.');
    const order = Number(sortOrder);
    if (!Number.isInteger(order) || order < 0 || order > 9999) return setError('Thứ tự là số nguyên từ 0 đến 9999.');
    const codes = parseCouponCodes(codesText);
    if (codes.length > MAX_COUPONS) return setError(`Mỗi chiến dịch gắn tối đa ${MAX_COUPONS} mã.`);
    const value = needsValue(linkType) ? linkValue.trim() : '';
    setBusy(true);
    let id = savedId;
    try {
      if (id) {
        await updateAdminCampaign(id, {
          title: title.trim(),
          subtitle: subtitle.trim() || null,
          placement,
          image: image.trim(),
          linkType,
          linkValue: value || null,
          audience,
          startAt: startIso,
          endAt: endIso,
          sortOrder: order,
          isActive,
        });
      } else {
        const body: AdminCampaignInput = {
          title: title.trim(),
          placement,
          image: image.trim(),
          linkType,
          audience,
          startAt: startIso,
          endAt: endIso,
          sortOrder: order,
          isActive,
          ...(subtitle.trim() ? { subtitle: subtitle.trim() } : {}),
          ...(slug.trim() ? { slug: slug.trim() } : {}),
          ...(value ? { linkValue: value } : {}),
        };
        id = (await createAdminCampaign(body)).id;
        setSavedId(id);
      }
    } catch (e) {
      setBusy(false);
      return setError(errText(e, 'Không lưu được chiến dịch.'));
    }
    void qc.invalidateQueries({ queryKey: ['admin-campaigns'] });
    const productIds = products.map((p) => p.id);
    if (productIds.join('\n') !== baseline.products.join('\n')) {
      try {
        await setAdminCampaignProducts(id, productIds);
        baseline.products = productIds;
      } catch (e) {
        setBusy(false);
        return setError(`Đã lưu chiến dịch nhưng chưa gắn được sản phẩm: ${errText(e, 'lỗi không rõ')}`);
      }
    }
    if (codes.join('\n') !== baseline.codes.join('\n')) {
      try {
        await setAdminCampaignCoupons(id, codes);
        baseline.codes = codes;
      } catch (e) {
        setBusy(false);
        return setError(`Đã lưu chiến dịch nhưng chưa gắn được mã: ${errText(e, 'lỗi không rõ')}`);
      }
    }
    void qc.invalidateQueries({ queryKey: ['admin-campaign'] });
    setBusy(false);
    onDone();
  };

  return (
    <form
      aria-label={initial ? 'Sửa chiến dịch' : 'Tạo chiến dịch mới'}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) void save();
      }}
      className="space-y-3 rounded-card border border-stone-200 bg-stone-0 p-4"
    >
      <h2 className="font-display text-sm font-semibold text-stone-900">{initial ? 'Sửa chiến dịch' : 'Tạo chiến dịch mới'}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tên chiến dịch" className="sm:col-span-2">
          <input aria-label="Tên chiến dịch" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT_CLASS} />
        </Field>
        <Field label="Phụ đề (không bắt buộc)" className="sm:col-span-2">
          <input aria-label="Phụ đề" maxLength={200} value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className={INPUT_CLASS} />
        </Field>
        {!initial && (
          <Field label="Slug (đường dẫn trang)" hint="Bỏ trống để tự tạo từ tên. Không đổi được sau khi tạo vì link đã chia sẻ sẽ gãy." className="sm:col-span-2">
            <input aria-label="Slug (đường dẫn trang)" maxLength={80} placeholder="vd giua-thu-2026" value={slug} onChange={(e) => setSlug(e.target.value)} className={INPUT_CLASS} />
          </Field>
        )}
        <Field label="Vị trí">
          <select aria-label="Vị trí" value={placement} onChange={(e) => setPlacement(e.target.value as CampaignPlacement)} className={`${field} w-full`}>
            {(Object.keys(PLACEMENT_LABELS) as CampaignPlacement[]).map((k) => (
              <option key={k} value={k}>{PLACEMENT_LABELS[k]}</option>
            ))}
          </select>
        </Field>
        <Field label="Đối tượng" hint="Khách chưa rõ loại chỉ thấy chiến dịch cho mọi khách.">
          <select aria-label="Đối tượng" value={audience} onChange={(e) => setAudience(e.target.value as CampaignAudience)} className={`${field} w-full`}>
            {(Object.keys(AUDIENCE_LABELS) as CampaignAudience[]).map((k) => (
              <option key={k} value={k}>{AUDIENCE_LABELS[k]}</option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <ImageUrlField label={IMAGE_LABEL} value={image} onChange={setImage} />
          {placement === 'OFFERS_TOP' && (
            <p data-testid="offers-banner-safe-zone" className="mt-1 text-xs text-stone-600">
              {OFFERS_BANNER_SAFE_ZONE}
            </p>
          )}
        </div>
        <Field label="Đích khi bấm">
          <select
            aria-label="Đích khi bấm"
            value={linkType}
            onChange={(e) => {
              setLinkType(e.target.value as CampaignLinkType);
              setLinkValue('');
            }}
            className={`${field} w-full`}
          >
            {(Object.keys(LINK_LABELS) as CampaignLinkType[]).map((k) => (
              <option key={k} value={k}>{LINK_LABELS[k]}</option>
            ))}
          </select>
        </Field>
        {linkType === 'PRODUCT' && (
          <Field label="Slug sản phẩm" hint="Phần cuối đường dẫn trang sản phẩm.">
            <input aria-label="Slug sản phẩm" maxLength={120} value={linkValue} onChange={(e) => setLinkValue(e.target.value)} className={INPUT_CLASS} />
          </Field>
        )}
        {linkType === 'CATEGORY' && (
          <Field label="Slug danh mục" hint="Phần cuối đường dẫn của danh mục.">
            <input aria-label="Slug danh mục" maxLength={120} value={linkValue} onChange={(e) => setLinkValue(e.target.value)} className={INPUT_CLASS} />
          </Field>
        )}
        {linkType === 'URL_INTERNAL' && (
          <Field label="Trang trong app">
            <select aria-label="Trang trong app" value={linkValue} onChange={(e) => setLinkValue(e.target.value)} className={`${field} w-full`}>
              <option value="">Chọn trang…</option>
              {CAMPAIGN_INTERNAL_TARGETS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Bắt đầu lúc (giờ Việt Nam)">
          <VnDateTimeInput ariaLabel="Bắt đầu" value={startAt} onChange={setStartAt} onPendingChange={setStartPending} className={field} />
        </Field>
        <Field label="Kết thúc lúc (giờ Việt Nam)">
          <VnDateTimeInput ariaLabel="Kết thúc" value={endAt} onChange={setEndAt} onPendingChange={setEndPending} className={field} />
        </Field>
        <Field label="Thứ tự hiển thị" hint="Số nhỏ đứng trước.">
          <input aria-label="Thứ tự hiển thị" type="number" min={0} max={9999} step={1} inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className={`${field} w-28`} />
        </Field>
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-stone-800 sm:min-h-0 sm:self-end sm:pb-2">
          <input type="checkbox" aria-label="Đang bật" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4" />
          Đang bật
        </label>
      </div>

      <section aria-label="Sản phẩm trong chiến dịch" className="space-y-2">
        <h3 className="text-xs font-medium text-stone-700">Sản phẩm trong chiến dịch ({products.length}/{MAX_PRODUCTS})</h3>
        {products.length === 0 ? (
          <p className="text-xs text-stone-500">Chưa có sản phẩm. Trang chiến dịch chỉ hiện mã giảm giá (nếu có).</p>
        ) : (
          <ul className="space-y-1">
            {products.map((p) => (
              <li key={p.id} data-testid="campaign-product" className="flex items-center justify-between gap-2 rounded-control bg-stone-50 px-2.5 py-1 text-sm">
                <span className="min-w-0 break-words">{p.name}</span>
                <button type="button" aria-label={`Bỏ ${p.name} khỏi chiến dịch`} onClick={() => setProducts((cur) => cur.filter((x) => x.id !== p.id))} className={BTN_LINK_DANGER}>
                  Bỏ
                </button>
              </li>
            ))}
          </ul>
        )}
        <ProductPicker mode="product" label="Thêm sản phẩm" value={null} onChange={addProduct} />
      </section>

      <Field label="Mã giảm giá gắn kèm" hint={`Cách nhau bởi dấu phẩy hoặc xuống dòng, tối đa ${MAX_COUPONS} mã. Chỉ mã công khai hoặc mã nhận được, không thuộc lô mã.`}>
        <textarea aria-label="Mã giảm giá gắn kèm" rows={2} value={codesText} onChange={(e) => setCodesText(e.target.value)} className={INPUT_CLASS} />
      </Field>

      {error && (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!canSave} className={BTN_PRIMARY}>
          {busy ? 'Đang lưu…' : 'Lưu chiến dịch'}
        </button>
        <button type="button" onClick={onCancel} className={BTN_SECONDARY}>
          Đóng
        </button>
      </div>
    </form>
  );
}
