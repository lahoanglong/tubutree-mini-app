'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  addItem,
  applyStorefrontTemplate,
  createStorefront,
  updateCollection,
  updateStorefront,
  type PickerProduct,
  type StorefrontCategory,
  type StorefrontCollectionEdit,
  type StorefrontEdit,
} from '@tubutree/app-core/api/storefront';
import { pickerQuery, storefrontCategoriesQuery } from '@tubutree/app-core/queries/storefront';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { isPartnerStore } from '@/lib/partner-store';
import { ui } from '@/lib/guest-ui';
import { Badge } from '@/components/ui/badge';
import { EmptyStateInline } from './storefront-inline';
import { ErrorState } from '@/components/ui/error-state';
import { Field } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { StorefrontImageUpload } from './storefront-image-upload';
import { comboPctValue, KIND_LABEL, LAYOUT_LABEL } from './storefront-rules';
import { DEFAULT_STOREFRONT_THEME_COLOR, STOREFRONT_THEME_COLORS } from './storefront-theme';

export const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

export type Notify = (text: string, error?: boolean) => void;

type Layout = keyof typeof LAYOUT_LABEL;
type Kind = keyof typeof KIND_LABEL;

function InlineError({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="mt-2 text-sm text-danger-fg">
      {text}
    </p>
  ) : null;
}

function LayoutSelect({ value, onChange }: { value: Layout; onChange: (v: Layout) => void }) {
  return (
    <Field label="Bố cục">
      <select className={ui.field} value={value} onChange={(e) => onChange(e.target.value as Layout)}>
        {(Object.keys(LAYOUT_LABEL) as Layout[]).map((k) => (
          <option key={k} value={k}>
            {LAYOUT_LABEL[k]}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ComboPctField({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid: boolean }) {
  return (
    <Field label="Giảm giá combo (%)" error={invalid ? 'Nhập số nguyên từ 0 đến 100.' : undefined}>
      <input className={invalid ? ui.fieldError : ui.field} inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/** Chọn mẫu dựng sẵn theo danh mục khi tạo gian hàng mới (mỗi mẫu = 1 bộ sưu tập + tối đa 8 sản phẩm nổi bật); luôn có lối "Bỏ qua". */
export function TemplateSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const catQ = useQuery({ ...storefrontCategoriesQuery(coreHttp), enabled: open });
  // Tạo gian hàng RỒI áp mẫu, tách hai bước: lỗi ở bước áp mẫu (vd hết sản phẩm gợi ý) không chặn gian hàng đã tạo.
  const withTemplate = useMutation({
    mutationFn: async (categoryId: string) => {
      await createStorefront(coreHttp);
      return applyStorefrontTemplate(coreHttp, categoryId);
    },
    onSuccess: onCreated,
    onError: (e) => setError(errText(e)),
  });
  const blank = useMutation({
    mutationFn: () => createStorefront(coreHttp),
    onSuccess: onCreated,
    onError: (e) => setError(errText(e)),
  });
  const busy = withTemplate.isPending || blank.isPending;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Bắt đầu nhanh với 1 mẫu có sẵn"
      description="Chọn danh mục gần với sản phẩm bạn muốn giới thiệu — chúng tôi tự thêm sẵn 8 sản phẩm nổi bật, bạn chỉnh sửa sau cũng được."
    >
      {catQ.isLoading && <Skeleton height={120} />}
      {catQ.isError && <ErrorState message={errText(catQ.error)} onRetry={() => void catQ.refetch()} />}
      {catQ.data && (
        <div className="grid grid-cols-2 gap-2">
          {catQ.data.map((c: StorefrontCategory) => (
            <button
              key={c.id}
              type="button"
              aria-label={`Dùng mẫu ${c.name}`}
              aria-disabled={busy || undefined}
              onClick={() => {
                if (busy) return;
                setError(null);
                withTemplate.mutate(c.id);
              }}
              className={`min-h-11 rounded-card border border-stone-200 bg-stone-0 p-3 text-center text-sm ${busy && withTemplate.variables !== c.id ? 'opacity-50' : ''}`}
            >
              {c.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.image} alt="" className="mx-auto mb-1.5 block h-9 w-9 rounded-control object-cover" />
              ) : (
                <div className="mx-auto mb-1.5 h-9 w-9 rounded-control bg-stone-100" />
              )}
              {withTemplate.isPending && withTemplate.variables === c.id ? 'Đang dựng...' : c.name}
            </button>
          ))}
        </div>
      )}
      <InlineError text={error} />
      <button
        type="button"
        className={`${ui.btnSecondary} mt-4 w-full`}
        disabled={busy}
        onClick={() => {
          if (busy) return;
          setError(null);
          blank.mutate();
        }}
      >
        {blank.isPending ? 'Đang tạo…' : 'Bỏ qua, tự tạo gian hàng trống'}
      </button>
    </Sheet>
  );
}

/** Chọn sản phẩm (có tìm kiếm) để thêm vào một bộ sưu tập. */
export function PickerSheet({ open, collectionId, onClose, onAdded }: { open: boolean; collectionId: string | null; onClose: () => void; onAdded: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Thêm sản phẩm">
      {open && collectionId && <PickerBody collectionId={collectionId} onClose={onClose} onAdded={onAdded} />}
    </Sheet>
  );
}

function PickerBody({ collectionId, onClose, onAdded }: { collectionId: string; onClose: () => void; onAdded: () => void }) {
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listQ = useQuery(pickerQuery(coreHttp, search));
  const addMut = useMutation({
    mutationFn: (p: PickerProduct) => addItem(coreHttp, collectionId, { productId: p.id }),
    onSuccess: () => {
      setError(null);
      onAdded();
    },
    onError: (e) => setError(errText(e)),
  });
  const products = listQ.data ?? [];

  return (
    <div>
      <input className={ui.field} aria-label="Tìm sản phẩm" placeholder="Tìm sản phẩm…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <InlineError text={error} />
      <div className="mt-3 max-h-[360px] overflow-y-auto">
        {listQ.isError ? (
          <ErrorState message={errText(listQ.error)} onRetry={() => void listQ.refetch()} />
        ) : listQ.isLoading ? (
          <div className="space-y-2">
            <Skeleton height={44} />
            <Skeleton height={44} />
            <Skeleton height={44} />
          </div>
        ) : products.length === 0 ? (
          <EmptyStateInline text="Không tìm thấy sản phẩm phù hợp" />
        ) : (
          products.map((p) => (
            <div key={p.id} className="flex items-center gap-2 border-b border-stone-200 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-stone-900">{p.name}</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold tabular-nums text-stone-900">{formatVnd(p.salePrice ?? p.basePrice)}</span>
                  {p.maxAffiliateRate > 0 && (
                    <Badge tone="success" size="sm">
                      +{p.maxAffiliateRate}% hoa hồng
                    </Badge>
                  )}
                </div>
              </div>
              <button type="button" aria-label={`Thêm ${p.name}`} className={ui.btnSecondary} disabled={addMut.isPending} onClick={() => addMut.mutate(p)}>
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                Thêm
              </button>
            </div>
          ))
        )}
      </div>
      <button type="button" className={`${ui.btnSecondary} mt-3 w-full`} onClick={onClose}>
        Xong
      </button>
    </div>
  );
}

/** Hồ sơ gian hàng: ảnh đại diện, ảnh bìa, lời nhắn. Đủ cả ba là điều kiện của nhiệm vụ "Hoàn thiện hồ sơ gian hàng". */
export function ProfileSheet({ open, sf, onClose, onSaved }: { open: boolean; sf: StorefrontEdit; onClose: () => void; onSaved: Notify }) {
  return (
    <Sheet open={open} onClose={onClose} title="Hồ sơ gian hàng" description="Ảnh đại diện, ảnh bìa và lời nhắn là thứ khách nhìn thấy đầu tiên.">
      {open && <ProfileForm sf={sf} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function ProfileForm({ sf, onClose, onSaved }: { sf: StorefrontEdit; onClose: () => void; onSaved: Notify }) {
  const [avatarUrl, setAvatarUrl] = useState(sf.avatarUrl ?? '');
  const [coverUrl, setCoverUrl] = useState(sf.coverUrl ?? '');
  const [headerNote, setHeaderNote] = useState(sf.headerNote ?? '');
  const [error, setError] = useState<string | null>(null);
  const saveMut = useMutation({
    // Gửi chuỗi RỖNG (không phải undefined) khi CTV chủ động xoá: undefined bị PATCH bỏ qua, nên xoá ảnh bìa rồi Lưu
    // sẽ báo thành công mà ảnh cũ vẫn còn trên gian hàng công khai.
    mutationFn: () => updateStorefront(coreHttp, { avatarUrl: avatarUrl.trim(), coverUrl: coverUrl.trim(), headerNote: headerNote.trim() }),
    onSuccess: () => {
      onSaved('Đã cập nhật hồ sơ gian hàng');
      onClose();
    },
    onError: (e) => setError(errText(e)),
  });
  const complete = !!(avatarUrl.trim() && coverUrl.trim() && headerNote.trim());

  return (
    <div>
      <StorefrontImageUpload label="Ảnh đại diện" value={avatarUrl} onChange={setAvatarUrl} maxDim={400} quality={0.8} />
      <StorefrontImageUpload label="Ảnh bìa" value={coverUrl} onChange={setCoverUrl} maxDim={1000} quality={0.75} />
      <Field label="Lời nhắn của bạn">
        <textarea
          className={`${ui.field} py-2`}
          rows={3}
          maxLength={200}
          value={headerNote}
          placeholder="VD: Mình dùng thật, review thật — hỏi mình bất cứ lúc nào nhé!"
          onChange={(e) => setHeaderNote(e.target.value)}
        />
      </Field>
      <div className="mt-1 text-xs text-stone-600">{headerNote.length}/200</div>
      {!complete && <p className="mt-2 text-xs text-stone-700">Đủ cả ba mục sẽ hoàn thành nhiệm vụ “hồ sơ gian hàng”.</p>}
      <InlineError text={error} />
      <button type="button" className={`${ui.btnPrimary} mt-4 w-full`} disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
        {saveMut.isPending ? 'Đang lưu…' : 'Lưu hồ sơ'}
      </button>
      <button type="button" className={`${ui.btnSecondary} mt-2 w-full`} onClick={onClose}>
        Đóng
      </button>
    </div>
  );
}

/** Cấu hình gian hàng: tên, subdomain (khi cờ bật), màu chủ đề, và với gian hàng tự giao thì kho + hotline (SĐT kho). */
export function ConfigSheet({ open, sf, onClose, onSaved }: { open: boolean; sf: StorefrontEdit; onClose: () => void; onSaved: Notify }) {
  return (
    <Sheet open={open} onClose={onClose} title="Cấu hình gian hàng">
      {open && <ConfigForm sf={sf} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function ConfigForm({ sf, onClose, onSaved }: { sf: StorefrontEdit; onClose: () => void; onSaved: Notify }) {
  const [form, setForm] = useState({
    title: sf.title ?? '',
    subdomain: sf.subdomain ?? '',
    themeColor: sf.themeColor ?? DEFAULT_STOREFRONT_THEME_COLOR,
    warehouseAddress: sf.warehouseAddress ?? '',
    warehouseCity: sf.warehouseCity ?? '',
    warehousePhone: sf.warehousePhone ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  // Kho/hotline chỉ có nghĩa với gian hàng tự giao; chuỗi rỗng = xoá (API đổi '' thành null).
  const selfFulfils = isPartnerStore(sf);
  // Chỉ gửi subdomain khi người dùng đã đổi: API kiểm từ khoá và trùng tên mỗi khi nhận subdomain.
  const typedSubdomain = form.subdomain.trim().toLowerCase();
  const subdomainChanged = typedSubdomain !== '' && typedSubdomain !== (sf.subdomain ?? '');
  const saveMut = useMutation({
    mutationFn: () =>
      updateStorefront(coreHttp, {
        title: form.title.trim() || undefined,
        subdomain: sf.subdomainEnabled && subdomainChanged ? typedSubdomain : undefined,
        themeColor: form.themeColor,
        ...(selfFulfils && {
          warehouseAddress: form.warehouseAddress.trim(),
          warehouseCity: form.warehouseCity.trim(),
          warehousePhone: form.warehousePhone.trim(),
        }),
      }),
    onSuccess: () => {
      onSaved('Đã lưu cấu hình gian hàng!');
      onClose();
    },
    onError: (e) => setError(errText(e)),
  });
  // Tài khoản ngân hàng nhập trước đây không được dùng để thu tiền (khách luôn trả cho Tubu Tree) — chỉ cho gỡ đi.
  const clearBankMut = useMutation({
    mutationFn: () => updateStorefront(coreHttp, { bankName: '', bankBin: '', bankAccountNo: '', bankAccountName: '' }),
    onSuccess: () => onSaved('Đã gỡ tài khoản ngân hàng khỏi gian hàng'),
    onError: (e) => setError(errText(e)),
  });

  return (
    <div className="flex flex-col gap-3">
      <Field label="Tên gian hàng">
        <input className={ui.field} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>

      {sf.subdomainEnabled && (
        <div>
          <Field label="Subdomain riêng">
            <input className={ui.field} placeholder="vd: brand1" value={form.subdomain} onChange={(e) => setForm({ ...form, subdomain: e.target.value })} />
          </Field>
          <div className="mt-0.5 text-xs text-stone-600">URL: {form.subdomain ? `${form.subdomain}.tubutree.com` : 'ten-ban.tubutree.com'}</div>
        </div>
      )}

      <div>
        <div className="mb-0.5 text-xs text-stone-600">Màu sắc thương hiệu</div>
        <div className="flex flex-wrap gap-1">
          {STOREFRONT_THEME_COLORS.map((c) => {
            const selected = form.themeColor === c.code;
            return (
              <button
                key={c.code}
                type="button"
                aria-label={c.label}
                aria-pressed={selected}
                onClick={() => setForm({ ...form, themeColor: c.code })}
                className="flex min-h-11 min-w-11 items-center justify-center"
              >
                <span
                  className={`h-8 w-8 rounded-full shadow-card ${selected ? 'border-[3px] border-stone-900' : 'border-2 border-stone-0'}`}
                  style={{ backgroundColor: c.code }}
                />
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-stone-200 pt-3">
        <h3 className="mb-1 text-sm font-semibold text-stone-900">Thanh toán</h3>
        <p className="text-xs text-stone-700">
          Khách luôn thanh toán cho Tubu Tree.{' '}
          {selfFulfils ? 'Tiền hàng của bạn được đối soát và chuyển theo kỳ trên cổng người bán.' : 'Hoa hồng của bạn được trả qua mục Rút tiền trong Cộng tác viên.'}
        </p>
        {sf.bankAccountNo && (
          <div className="mt-2">
            <p className="mb-1.5 text-xs text-stone-700">
              Gian hàng đang lưu tài khoản {sf.bankName ?? 'ngân hàng'} ****{sf.bankAccountNo.slice(-4)} nhưng tài khoản này không được dùng để thu tiền.
            </p>
            <button type="button" className={ui.btnSecondary} disabled={clearBankMut.isPending} onClick={() => clearBankMut.mutate()}>
              Gỡ tài khoản đã lưu
            </button>
          </div>
        )}
      </div>

      {selfFulfils && (
        <div className="border-t border-stone-200 pt-3">
          <h3 className="mb-1 text-sm font-semibold text-stone-900">Kho gửi hàng &amp; hotline</h3>
          <p className="mb-2 text-xs text-stone-700">Dùng cho đơn gian hàng tự giao: khách thấy hotline này trong chi tiết đơn để liên hệ.</p>
          <div className="flex flex-col gap-2">
            <input className={ui.field} aria-label="Địa chỉ kho xuất hàng" placeholder="Địa chỉ kho xuất hàng" value={form.warehouseAddress} onChange={(e) => setForm({ ...form, warehouseAddress: e.target.value })} />
            <input className={ui.field} aria-label="Tỉnh / Thành phố" placeholder="Tỉnh / Thành phố" value={form.warehouseCity} onChange={(e) => setForm({ ...form, warehouseCity: e.target.value })} />
            <input className={ui.field} aria-label="Hotline kho liên hệ" placeholder="Hotline kho liên hệ" inputMode="tel" value={form.warehousePhone} onChange={(e) => setForm({ ...form, warehousePhone: e.target.value })} />
          </div>
        </div>
      )}

      <InlineError text={error} />
      <button type="button" className={`${ui.btnPrimary} mt-2 w-full`} disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
        {saveMut.isPending ? 'Đang lưu…' : 'Lưu cấu hình gian hàng'}
      </button>
    </div>
  );
}

/** Sửa bộ sưu tập: tên, bố cục và (với combo) % giảm. Loại NORMAL/COMBO không đổi được sau khi tạo (API không nhận). */
export function CollectionSheet({
  collection,
  onClose,
  onSaved,
}: {
  collection: StorefrontCollectionEdit | null;
  onClose: () => void;
  onSaved: Notify;
}) {
  return (
    <Sheet open={!!collection} onClose={onClose} title="Sửa bộ sưu tập">
      {collection && <CollectionForm key={collection.id} collection={collection} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function CollectionForm({ collection, onClose, onSaved }: { collection: StorefrontCollectionEdit; onClose: () => void; onSaved: Notify }) {
  const [title, setTitle] = useState(collection.title);
  const [layout, setLayout] = useState<Layout>(collection.layout);
  const [pct, setPct] = useState(String(collection.comboDiscountPct ?? 0));
  const [error, setError] = useState<string | null>(null);
  const combo = collection.kind === 'COMBO';
  const pctValue = comboPctValue(pct);
  const pctInvalid = combo && pctValue === null;
  const saveMut = useMutation({
    mutationFn: () =>
      updateCollection(coreHttp, collection.id, {
        title: title.trim(),
        layout,
        ...(combo && pctValue !== null && { comboDiscountPct: pctValue }),
      }),
    onSuccess: () => {
      onSaved('Đã lưu bộ sưu tập');
      onClose();
    },
    onError: (e) => setError(errText(e)),
  });

  return (
    <div className="flex flex-col gap-3">
      <Field label="Tên bộ sưu tập">
        <input className={ui.field} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <LayoutSelect value={layout} onChange={setLayout} />
      {combo && <ComboPctField value={pct} onChange={setPct} invalid={pctInvalid} />}
      <InlineError text={error} />
      <button type="button" className={`${ui.btnPrimary} w-full`} disabled={!title.trim() || pctInvalid || saveMut.isPending} onClick={() => saveMut.mutate()}>
        {saveMut.isPending ? 'Đang lưu…' : 'Lưu'}
      </button>
    </div>
  );
}

/** Form tạo bộ sưu tập: phải có TÊN do CTV đặt; chọn loại (thường/combo), bố cục và % giảm combo. */
export function NewCollectionForm({ onCreate, pending }: { onCreate: (dto: { title: string; kind?: Kind; layout?: Layout; comboDiscountPct?: number }) => void; pending: boolean }) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<Kind>('NORMAL');
  const [layout, setLayout] = useState<Layout>('GRID');
  const [pct, setPct] = useState('10');
  const combo = kind === 'COMBO';
  const pctValue = comboPctValue(pct);
  const pctInvalid = combo && pctValue === null;

  const submit = () => {
    if (!title.trim() || pctInvalid) return;
    onCreate({
      title: title.trim(),
      ...(combo && { kind, comboDiscountPct: pctValue! }),
      ...(layout !== 'GRID' && { layout }),
    });
    setTitle('');
  };

  return (
    <div className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      <div className="flex items-start gap-2">
        <input
          className={`${ui.field} flex-1`}
          aria-label="Tên bộ sưu tập (khách sẽ thấy)"
          placeholder="Tên bộ sưu tập (khách sẽ thấy)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button type="button" className={ui.btnSecondary} disabled={!title.trim() || pctInvalid || pending} onClick={submit}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          Tạo bộ sưu tập
        </button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Loại bộ sưu tập">
          <select className={ui.field} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <LayoutSelect value={layout} onChange={setLayout} />
        {combo && <ComboPctField value={pct} onChange={setPct} invalid={pctInvalid} />}
      </div>
    </div>
  );
}
