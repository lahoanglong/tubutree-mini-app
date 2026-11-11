'use client';

import { useRef, useState } from 'react';
import { STOREFRONT_TEMPLATE_BUSY, STOREFRONT_TEMPLATE_HINT } from '@tubutree/app-core/client-copy';
import { useIsMutating, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, Plus } from 'lucide-react';
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
import { errorStatus } from '@tubutree/app-core/api/error-status';
import { BUILDER_COPY } from '@tubutree/app-core/commerce/storefront-builder';
import { myStorefrontQuery, pickerQuery, storefrontCategoriesQuery, storefrontQuestsQuery } from '@tubutree/app-core/queries/storefront';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { isPartnerStore } from '@/lib/partner-store';
import { serverRejectedState } from '@/lib/server-rejected-state';
import { settleWithin } from '@/lib/settle-within';
import { ui } from '@/lib/guest-ui';
import { IMAGES_UPLOADING } from '@/lib/image-compress';
import { useUploadBusy } from '@/lib/use-upload-busy';
import { Badge } from '@/components/ui/badge';
import { EmptyStateInline } from './storefront-inline';
import { ErrorState } from '@/components/ui/error-state';
import { Field } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { StorefrontImageUpload } from './storefront-image-upload';
import { DEFAULT_STOREFRONT_THEME_COLOR, STOREFRONT_THEME_COLORS } from './storefront-theme';
import { actionErrorText, loadErrorText } from '@/lib/error-text';

/** Trần của DTO `UpdateStorefrontDto` (apps/api storefront.controller.ts): tên 120, thông tin kho 200; subdomain 3-30 ký tự theo SUBDOMAIN_RE của identifier-validation.ts. */
const STOREFRONT_TITLE_MAX = 120;
const STOREFRONT_SUBDOMAIN_MAX = 30;
const STOREFRONT_WAREHOUSE_MAX = 200;
const COLLECTION_TITLE_MAX = 80;

type ConfigDto = Parameters<typeof updateStorefront>[1];

export const errText = loadErrorText;
export const actErrText = actionErrorText;

export type Notify = (text: string, error?: boolean) => void;
/** Lời báo đã lưu của màn cha. Trả Promise (vd tải lại gian hàng) thì nút giữ khoá tới khi Promise xong, tối đa 4 giây. */
export type Saved = (text: string) => unknown;

const PROFILE_SAVE_KEY = ['storefront-profile-save'] as const;
const CONFIG_KEY = ['storefront-config'] as const;
const CONFIG_SAVE_KEY = [...CONFIG_KEY, 'save'] as const;
const CONFIG_CLEAR_BANK_KEY = [...CONFIG_KEY, 'clear-bank'] as const;
const RENAME_KEY = ['storefront-collection-rename'] as const;
const PICKER_ADD_KEY = ['storefront-picker-add'] as const;
const TEMPLATE_KEY = ['storefront-template-create'] as const;
const TEMPLATE_PICK_KEY = [...TEMPLATE_KEY, 'template'] as const;
const TEMPLATE_BLANK_KEY = [...TEMPLATE_KEY, 'blank'] as const;

/**
 * Máy chủ từ chối lệnh vì trạng thái đã khác thứ đang hiện (400/404/409/422): tải lại gian hàng, Hành trình và các khoá riêng của tấm rồi mới nhả khoá nút, tối đa 4 giây;
 * bấm lại trên dữ liệu cũ nhận đúng lỗi đó. Mất mạng, quá hạn, 401, 403, 5xx không nói gì về dữ liệu thật: trả undefined để nhả ngay, không tải lại.
 * Tải lại không ghi đè chữ khách đang gõ: các form chỉ lấy giá trị đầu từ gian hàng lúc mở.
 */
function useReloadOnReject() {
  const qc = useQueryClient();
  return (error: unknown, ...extra: readonly (readonly unknown[])[]): Promise<void> | undefined => {
    if (!serverRejectedState(error)) return undefined;
    const keys = [myStorefrontQuery(coreHttp).queryKey, storefrontQuestsQuery(coreHttp).queryKey, ...extra];
    return settleWithin(Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey }))));
  };
}

function InlineError({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="mt-2 text-sm text-danger-fg">
      {text}
    </p>
  ) : null;
}

/** Chọn mẫu dựng sẵn theo danh mục khi tạo gian hàng mới (mỗi mẫu = 1 bộ sưu tập + tối đa 8 sản phẩm nổi bật); luôn có lối "Bỏ qua". */
export function TemplateSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => unknown }) {
  const [error, setError] = useState<string | null>(null);
  const catQ = useQuery({ ...storefrontCategoriesQuery(coreHttp), enabled: open });
  const reloadOnReject = useReloadOnReject();
  // Mẫu đang tạo và cờ bận đọc từ bộ nhớ đệm dùng chung: tấm dựng lại lúc lệnh còn chạy hay còn chờ dữ liệu mới thì vẫn biết.
  const pickingIds = useMutationState({ filters: { mutationKey: TEMPLATE_PICK_KEY, status: 'pending' }, select: (m) => m.state.variables as string });
  const blankBusy = useIsMutating({ mutationKey: TEMPLATE_BLANK_KEY }) > 0;
  const busy = pickingIds.length > 0 || blankBusy;
  // Hai cách tạo cùng tạo gian hàng nên loại trừ nhau; ref vì `busy` chỉ đúng sau lần vẽ kế.
  const creating = useRef(false);
  const releaseCreating = () => {
    creating.current = false;
  };
  const exclusiveCreate = (run: () => void) => {
    if (creating.current || busy) return;
    creating.current = true;
    setError(null);
    try {
      run();
    } catch (e) {
      creating.current = false;
      throw e;
    }
  };
  // Tạo gian hàng RỒI áp mẫu, tách hai bước: lỗi ở bước áp mẫu (vd hết sản phẩm gợi ý) không chặn gian hàng đã tạo.
  const withTemplate = useLockedMutation({
    mutationKey: TEMPLATE_PICK_KEY,
    mutationFn: async (categoryId: string) => {
      await createStorefront(coreHttp);
      return applyStorefrontTemplate(coreHttp, categoryId);
    },
    onSuccess: () => settleWithin(onCreated()),
    onError: (e) => {
      setError(actErrText(e));
      return reloadOnReject(e, storefrontCategoriesQuery(coreHttp).queryKey);
    },
    onSettled: releaseCreating,
  });
  const blank = useLockedMutation({
    mutationKey: TEMPLATE_BLANK_KEY,
    mutationFn: () => createStorefront(coreHttp),
    onSuccess: () => settleWithin(onCreated()),
    onError: (e) => {
      setError(actErrText(e));
      return reloadOnReject(e);
    },
    onSettled: releaseCreating,
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Bắt đầu nhanh với 1 mẫu có sẵn"
      description={STOREFRONT_TEMPLATE_HINT}
      dismissible={!busy}
    >
      {catQ.isLoading && <Skeleton height={120} />}
      {catQ.isError && !catQ.data && <ErrorState message={errText(catQ.error)} onRetry={() => catQ.refetch()} />}
      {catQ.data && (
        <div className="grid grid-cols-2 gap-2">
          {catQ.data.map((c: StorefrontCategory) => (
            <button
              key={c.id}
              type="button"
              aria-label={`Dùng mẫu ${c.name}`}
              aria-busy={pickingIds.includes(c.id) || undefined}
              aria-disabled={busy || undefined}
              onClick={() => exclusiveCreate(() => withTemplate.mutate(c.id))}
              className={`min-h-11 rounded-card border border-stone-200 bg-stone-0 p-3 text-center text-sm ${busy && !pickingIds.includes(c.id) ? 'opacity-50' : ''}`}
            >
              {c.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.image} alt="" className="mx-auto mb-1.5 block h-9 w-9 rounded-control object-cover" />
              ) : (
                <div className="mx-auto mb-1.5 h-9 w-9 rounded-control bg-stone-100" />
              )}
              {pickingIds.includes(c.id) ? STOREFRONT_TEMPLATE_BUSY : c.name}
            </button>
          ))}
        </div>
      )}
      <InlineError text={error} />
      <button
        type="button"
        className={`${ui.btnSecondary} mt-4 w-full`}
        aria-busy={blankBusy || undefined}
        aria-disabled={busy || undefined}
        onClick={() => exclusiveCreate(() => blank.mutate())}
      >
        {blankBusy ? 'Đang tạo…' : 'Bỏ qua, tự tạo gian hàng trống'}
      </button>
    </Sheet>
  );
}

/** Chọn sản phẩm (có tìm kiếm) để thêm vào một bộ sưu tập. */
export function PickerSheet({ open, collectionId, onClose, onAdded }: { open: boolean; collectionId: string | null; onClose: () => void; onAdded: () => unknown }) {
  // Đóng lúc đang thêm thì lời báo lỗi mất theo, mở lại ra khoá mới nên thêm trùng được.
  const adding = useIsMutating({ mutationKey: PICKER_ADD_KEY }) > 0;
  return (
    <Sheet open={open} onClose={onClose} dismissible={!adding} title="Thêm sản phẩm">
      {open && collectionId && <PickerBody collectionId={collectionId} onClose={onClose} onAdded={onAdded} />}
    </Sheet>
  );
}

function PickerBody({ collectionId, onClose, onAdded }: { collectionId: string; onClose: () => void; onAdded: () => unknown }) {
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listQ = useQuery(pickerQuery(coreHttp, search));
  const reloadOnReject = useReloadOnReject();
  // Món đang thêm đọc từ bộ nhớ đệm dùng chung nên tấm dựng lại lúc lệnh còn chạy hay còn chờ dữ liệu mới vẫn biết nút nào bận.
  const addingIds = useMutationState({ filters: { mutationKey: PICKER_ADD_KEY, status: 'pending' }, select: (m) => (m.state.variables as PickerProduct).id });
  const adding = addingIds.length > 0;
  // Một sản phẩm mỗi lúc (chung một khoá cho mọi nút Thêm: hai lệnh thêm song song vào cùng khối chạy Serializable và có thể thua nhau). `onAdded` trả lời hứa tải lại gian hàng nên khoá còn giữ tới khi danh sách mới về.
  const addMut = useLockedMutation({
    mutationKey: PICKER_ADD_KEY,
    mutationFn: (p: PickerProduct) => addItem(coreHttp, collectionId, { productId: p.id }),
    onMutate: () => setError(null),
    onSuccess: () => settleWithin(onAdded()),
    // Món không còn bán hay khối đã đầy: danh sách sản phẩm cũng phải tải lại, không thì món đó còn nằm đó và thêm lại nhận đúng lỗi cũ.
    onError: (e) => {
      setError(actErrText(e));
      return reloadOnReject(e, ['picker']);
    },
  });
  const products = listQ.data ?? [];

  return (
    <div>
      <input className={ui.field} aria-label="Tìm sản phẩm" placeholder="Tìm sản phẩm…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <InlineError text={error} />
      <div className="mt-3 max-h-[360px] overflow-y-auto">
        {listQ.isError && !listQ.data ? (
          <ErrorState message={errText(listQ.error)} onRetry={() => listQ.refetch()} />
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
              <button
                type="button"
                aria-label={`Thêm ${p.name}`}
                className={ui.btnSecondary}
                aria-busy={addingIds.includes(p.id) || undefined}
                aria-disabled={adding || undefined}
                onClick={() => {
                  if (adding) return;
                  addMut.mutate(p);
                }}
              >
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                Thêm
              </button>
            </div>
          ))
        )}
      </div>
      <button type="button" className={`${ui.btnSecondary} mt-3 w-full`} aria-disabled={adding || undefined} onClick={() => !adding && onClose()}>
        Xong
      </button>
    </div>
  );
}

/** Hồ sơ gian hàng: ảnh đại diện, ảnh bìa, lời nhắn. Đủ cả ba là điều kiện của nhiệm vụ "Hoàn thiện hồ sơ gian hàng". */
export function ProfileSheet({ open, sf, onClose, onSaved }: { open: boolean; sf: StorefrontEdit; onClose: () => void; onSaved: Saved }) {
  // Đóng sheet lúc đang lưu thì form gỡ khỏi cây và lời báo lỗi của lần lưu mất theo: khách tưởng đã lưu.
  const saving = useIsMutating({ mutationKey: PROFILE_SAVE_KEY }) > 0;
  return (
    <Sheet open={open} onClose={onClose} dismissible={!saving} title="Hồ sơ gian hàng" description="Ảnh đại diện, ảnh bìa và lời nhắn là thứ khách nhìn thấy đầu tiên.">
      {open && <ProfileForm sf={sf} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function ProfileForm({ sf, onClose, onSaved }: { sf: StorefrontEdit; onClose: () => void; onSaved: Saved }) {
  const [avatarUrl, setAvatarUrl] = useState(sf.avatarUrl ?? '');
  const [coverUrl, setCoverUrl] = useState(sf.coverUrl ?? '');
  const [headerNote, setHeaderNote] = useState(sf.headerNote ?? '');
  const [error, setError] = useState<string | null>(null);
  // Lưu lúc ảnh còn đang lên sẽ gửi ảnh cũ (hoặc rỗng) rồi đóng form, ảnh mới về sau bị bỏ.
  const { busy: imagesBusy, onBusyChange } = useUploadBusy();
  // Đọc từ bộ nhớ đệm dùng chung: đóng tấm lúc lệnh còn chờ dữ liệu mới rồi mở lại thì form mới vẫn biết lệnh cũ chưa xong.
  const saving = useIsMutating({ mutationKey: PROFILE_SAVE_KEY }) > 0;
  const reloadOnReject = useReloadOnReject();
  const saveMut = useLockedMutation({
    mutationKey: PROFILE_SAVE_KEY,
    // Gửi chuỗi RỖNG (không phải undefined) khi CTV chủ động xoá: undefined bị PATCH bỏ qua, nên xoá ảnh bìa rồi Lưu
    // sẽ báo thành công mà ảnh cũ vẫn còn trên gian hàng công khai.
    mutationFn: () => updateStorefront(coreHttp, { avatarUrl: avatarUrl.trim(), coverUrl: coverUrl.trim(), headerNote: headerNote.trim() }),
    onMutate: () => setError(null),
    onSuccess: () => {
      const fresh = onSaved('Đã cập nhật hồ sơ gian hàng');
      onClose();
      return settleWithin(fresh);
    },
    onError: (e) => {
      setError(actErrText(e));
      return reloadOnReject(e);
    },
  });
  const complete = !!(avatarUrl.trim() && coverUrl.trim() && headerNote.trim());

  return (
    <div>
      <StorefrontImageUpload label="Ảnh đại diện" value={avatarUrl} onChange={setAvatarUrl} onBusyChange={onBusyChange} disabled={saving} maxDim={400} quality={0.8} />
      <StorefrontImageUpload label="Ảnh bìa" value={coverUrl} onChange={setCoverUrl} onBusyChange={onBusyChange} disabled={saving} maxDim={1000} quality={0.75} />
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
      <button
        type="button"
        className={`${ui.btnPrimary} mt-4 w-full`}
        aria-busy={saving || imagesBusy || undefined}
        aria-disabled={saving || imagesBusy || undefined}
        onClick={() => {
          if (imagesBusy || saving) return;
          saveMut.mutate();
        }}
      >
        {saving ? 'Đang lưu…' : imagesBusy ? IMAGES_UPLOADING : 'Lưu hồ sơ'}
      </button>
      <button type="button" className={`${ui.btnSecondary} mt-2 w-full`} aria-disabled={saving || undefined} onClick={() => !saving && onClose()}>
        Đóng
      </button>
    </div>
  );
}

/** Cấu hình gian hàng: tên, subdomain (khi cờ bật), màu chủ đề, và với gian hàng tự giao thì kho + hotline (SĐT kho). */
export function ConfigSheet({
  open,
  sf,
  onClose,
  onSaved,
  unpublishLabel,
  onUnpublish,
}: {
  open: boolean;
  sf: StorefrontEdit;
  onClose: () => void;
  onSaved: Saved;
  /** Có chữ thì gian hàng đang đăng/chờ duyệt: hiện nút gỡ đăng ở cuối cấu hình. */
  unpublishLabel: string | null;
  onUnpublish: () => void;
}) {
  const saving = useIsMutating({ mutationKey: CONFIG_KEY }) > 0;
  return (
    <Sheet open={open} onClose={onClose} dismissible={!saving} title={BUILDER_COPY.configTitle}>
      {open && <ConfigForm sf={sf} onClose={onClose} onSaved={onSaved} unpublishLabel={unpublishLabel} onUnpublish={onUnpublish} />}
    </Sheet>
  );
}

function ConfigForm({
  sf,
  onClose,
  onSaved,
  unpublishLabel,
  onUnpublish,
}: {
  sf: StorefrontEdit;
  onClose: () => void;
  onSaved: Saved;
  unpublishLabel: string | null;
  onUnpublish: () => void;
}) {
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
  // Đọc từ bộ nhớ đệm dùng chung: đóng tấm lúc lệnh còn chờ dữ liệu mới rồi mở lại thì form mới vẫn biết lệnh cũ chưa xong.
  const saving = useIsMutating({ mutationKey: CONFIG_SAVE_KEY }) > 0;
  const clearingBank = useIsMutating({ mutationKey: CONFIG_CLEAR_BANK_KEY }) > 0;
  const reloadOnReject = useReloadOnReject();
  const saveMut = useLockedMutation({
    mutationKey: CONFIG_SAVE_KEY,
    mutationFn: (dto: ConfigDto) => updateStorefront(coreHttp, dto),
    onMutate: () => setError(null),
    onSuccess: () => {
      const fresh = onSaved('Đã lưu cấu hình gian hàng!');
      onClose();
      return settleWithin(fresh);
    },
    onError: (e, dto) => {
      setError(actErrText(e));
      // Lệnh mang subdomain thì mọi 400 là lỗi chính ô đó (sai định dạng, từ khoá hệ thống, đã có người dùng, vừa bị ngừng dùng): tải lại gian hàng không đổi được gì
      // và khách đang sửa ô đó. Tên và kho đã bị maxLength chặn nên các 400 còn lại (không kèm subdomain) chỉ còn là trạng thái cũ.
      if (dto.subdomain !== undefined && errorStatus(e) === 400) return undefined;
      return reloadOnReject(e);
    },
  });
  // Tài khoản ngân hàng nhập trước đây không được dùng để thu tiền (khách luôn trả cho Tubu Tree) — chỉ cho gỡ đi.
  const clearBankMut = useLockedMutation({
    mutationKey: CONFIG_CLEAR_BANK_KEY,
    mutationFn: () => updateStorefront(coreHttp, { bankName: '', bankBin: '', bankAccountNo: '', bankAccountName: '' }),
    onMutate: () => setError(null),
    onSuccess: () => settleWithin(onSaved('Đã gỡ tài khoản ngân hàng khỏi gian hàng')),
    onError: (e) => {
      setError(actErrText(e));
      return reloadOnReject(e);
    },
  });
  const configBusy = saving || clearingBank;
  const save = () => {
    if (saving) return;
    saveMut.mutate({
      title: form.title.trim() || undefined,
      subdomain: sf.subdomainEnabled && subdomainChanged ? typedSubdomain : undefined,
      themeColor: form.themeColor,
      ...(selfFulfils && {
        warehouseAddress: form.warehouseAddress.trim(),
        warehouseCity: form.warehouseCity.trim(),
        warehousePhone: form.warehousePhone.trim(),
      }),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <Field label="Tên gian hàng">
        <input className={ui.field} maxLength={STOREFRONT_TITLE_MAX} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>

      {sf.subdomainEnabled && (
        <div>
          <Field label="Subdomain riêng">
            <input className={ui.field} placeholder="vd: brand1" maxLength={STOREFRONT_SUBDOMAIN_MAX} value={form.subdomain} onChange={(e) => setForm({ ...form, subdomain: e.target.value })} />
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
          {selfFulfils ? 'Tiền hàng của bạn được đối soát và chuyển theo kỳ trên cổng người bán.' : 'Hoa hồng của bạn chuyển vào Ví Tubu ngay trong mục Cộng tác viên.'}
        </p>
        {sf.bankAccountNo && (
          <div className="mt-2">
            <p className="mb-1.5 text-xs text-stone-700">
              Gian hàng đang lưu tài khoản {sf.bankName ?? 'ngân hàng'} ****{sf.bankAccountNo.slice(-4)} nhưng tài khoản này không được dùng để thu tiền.
            </p>
            <button
              type="button"
              className={ui.btnSecondary}
              aria-busy={clearingBank || undefined}
              aria-disabled={clearingBank || undefined}
              onClick={() => {
                if (clearingBank) return;
                clearBankMut.mutate();
              }}
            >
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
            <input className={ui.field} aria-label="Địa chỉ kho xuất hàng" placeholder="Địa chỉ kho xuất hàng" maxLength={STOREFRONT_WAREHOUSE_MAX} value={form.warehouseAddress} onChange={(e) => setForm({ ...form, warehouseAddress: e.target.value })} />
            <input className={ui.field} aria-label="Tỉnh / Thành phố" placeholder="Tỉnh / Thành phố" maxLength={STOREFRONT_WAREHOUSE_MAX} value={form.warehouseCity} onChange={(e) => setForm({ ...form, warehouseCity: e.target.value })} />
            <input className={ui.field} aria-label="Hotline kho liên hệ" placeholder="Hotline kho liên hệ" inputMode="tel" maxLength={STOREFRONT_WAREHOUSE_MAX} value={form.warehousePhone} onChange={(e) => setForm({ ...form, warehousePhone: e.target.value })} />
          </div>
        </div>
      )}

      <InlineError text={error} />
      <button type="button" className={`${ui.btnPrimary} mt-2 w-full`} aria-busy={saving || undefined} aria-disabled={saving || undefined} onClick={save}>
        {saving ? 'Đang lưu…' : 'Lưu cấu hình gian hàng'}
      </button>
      {unpublishLabel && (
        <div className="border-t border-stone-200 pt-3">
          <p className="mb-2 text-xs text-stone-600">Khách mở link gian hàng sẽ không thấy gì cho tới khi bạn đăng lại.</p>
          {/* Gỡ đăng đóng cả sheet: lúc đang lưu/gỡ ngân hàng thì lời báo lỗi của lệnh đó sẽ mất theo. */}
          <button type="button" className={`${ui.btnSecondary} w-full`} aria-disabled={configBusy || undefined} onClick={() => !configBusy && onUnpublish()}>
            <EyeOff className="mr-1 h-4 w-4" aria-hidden="true" />
            {unpublishLabel}
          </button>
        </div>
      )}
    </div>
  );
}

/** Đổi tên khối: chỉ đổi tên, giống Mini App (loại, bố cục, % giảm combo không có giao diện). */
export function CollectionSheet({
  collection,
  onClose,
  onSaved,
}: {
  collection: StorefrontCollectionEdit | null;
  onClose: () => void;
  onSaved: Saved;
}) {
  const saving = useIsMutating({ mutationKey: RENAME_KEY }) > 0;
  return (
    <Sheet open={!!collection} onClose={onClose} dismissible={!saving} title={BUILDER_COPY.renameSection}>
      {collection && <CollectionForm key={collection.id} collection={collection} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function CollectionForm({ collection, onClose, onSaved }: { collection: StorefrontCollectionEdit; onClose: () => void; onSaved: Saved }) {
  const [title, setTitle] = useState(collection.title);
  const [error, setError] = useState<string | null>(null);
  // Khoá theo khối, đọc từ bộ nhớ đệm dùng chung: đóng tấm lúc lệnh còn chờ dữ liệu mới rồi mở lại thì form mới vẫn biết lệnh cũ chưa xong; khối khác đổi tên song song được.
  const renameKey = [...RENAME_KEY, collection.id] as const;
  const saving = useIsMutating({ mutationKey: renameKey }) > 0;
  const reloadOnReject = useReloadOnReject();
  const saveMut = useLockedMutation({
    mutationKey: renameKey,
    mutationFn: () => updateCollection(coreHttp, collection.id, { title: title.trim() }),
    onMutate: () => setError(null),
    onSuccess: () => {
      const fresh = onSaved(BUILDER_COPY.sectionRenamed);
      onClose();
      return settleWithin(fresh);
    },
    onError: (e) => {
      setError(actErrText(e));
      return reloadOnReject(e);
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <Field label={BUILDER_COPY.sectionName}>
        <input className={ui.field} maxLength={COLLECTION_TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <InlineError text={error} />
      <button
        type="button"
        className={`${ui.btnPrimary} w-full`}
        disabled={!title.trim()}
        aria-busy={saving || undefined}
        aria-disabled={saving || undefined}
        onClick={() => {
          if (saving) return;
          saveMut.mutate();
        }}
      >
        {saving ? 'Đang lưu…' : 'Lưu'}
      </button>
    </div>
  );
}
