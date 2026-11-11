'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Info, X } from 'lucide-react';
import {
  checkPancakeVariation,
  createMerchantProduct,
  updateMerchantProduct,
  type CreateMerchantProductInput,
  type LinkablePancakeVariation,
  type MerchantProduct,
  type UpdateMerchantProductInput,
} from '@/lib/merchant-client';
import { merchantPriceError, parseMerchantPrice } from '@/lib/merchant-price';
import { safeAreaPadX } from '@/lib/safe-area';
import { formatVnd } from '@/lib/shop-client';
import { useModalA11y } from '@/lib/use-modal-a11y';
import { BTN_XS_SECONDARY, INPUT_CLASS, Notice, TOUCH_H } from '@/components/admin/ui';
import { actionErrorText } from '@/lib/error-text';
import { errorStatus } from '@tubutree/app-core/api/error-status';
import { NetworkError } from '@/lib/client-api';
import { settleWithin } from '@/lib/settle-within';

const BUSY_CLASS = 'aria-disabled:opacity-60';

/**
 * Khoá chung của lệnh tạo sản phẩm. API không khử trùng (mỗi POST tạo một sản phẩm mới, slug và sku có hậu tố ngẫu nhiên) nên chỉ phía khách chặn được đăng trùng,
 * và khoá theo hộp (ref) mất khi hộp bị gỡ lúc đóng: khách đóng hộp lúc lệnh còn bay rồi mở lại bấm Đăng sẽ gửi lần hai. Cờ bận đọc từ bộ nhớ đệm dùng chung.
 */
const CREATE_PRODUCT_KEY = ['merchant-create-product'] as const;
/** Lỗi không có phản hồi (mất mạng giữa chừng, quá hạn): máy chủ có thể đã tạo sản phẩm, bấm Thử lại là đăng trùng. */
export const CREATE_OUTCOME_UNKNOWN_TEXT = 'Có thể sản phẩm đã được đăng nhưng chưa nhận được phản hồi. Kiểm tra danh sách sản phẩm rồi hẵng đăng lại, kẻo bị trùng.';
export const createSentText = (name: string) => `Sản phẩm «${name}» của lần gửi trước đã được gửi lên chờ duyệt. Xem danh sách trước khi gửi thêm.`;

/** Lời báo về lệnh của lần mở hộp trước, xong khi hộp đó đã đóng: nằm trong hộp đang mở (lớp phủ che trang) hoặc ở trang nếu không có hộp nào mở. */
export type CreateNotice = { kind: 'sent' | 'unknown'; text: string };

/** Cổng 502/504 do lớp phía trước API trả khi chờ quá lâu: API có thể đã tạo xong sản phẩm, giống mất mạng giữa chừng. */
const GATEWAY_STATUSES = [502, 504];
const isOutcomeUnknown = (e: unknown) => e instanceof NetworkError || GATEWAY_STATUSES.includes(errorStatus(e) ?? 0);

const INPUT = `mt-1 ${INPUT_CLASS} ${TOUCH_H}`;
const MAX_STOCK = 100_000;

/**
 * Giá khách thực trả của sản phẩm trong danh sách đối tác: giá khuyến mãi nếu có, không thì giá gốc (cùng quy tắc với trang bán).
 * Có khuyến mãi thấp hơn giá gốc thì ghi thêm giá gốc gạch ngang.
 */
export function MerchantProductPrice({ product }: { product: Pick<MerchantProduct, 'basePrice' | 'salePrice'> }) {
  const onSale = product.salePrice != null && product.salePrice < product.basePrice;
  return (
    <>
      {formatVnd(product.salePrice ?? product.basePrice)}
      {onSale && (
        <span className="block text-[11px] font-normal text-stone-500">
          <span className="sr-only">Giá gốc </span>
          <del>{formatVnd(product.basePrice)}</del>
        </span>
      )}
    </>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const panelRef = useModalA11y<HTMLDivElement>(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4" style={safeAreaPadX('1rem')}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-sheet bg-stone-0 p-5 shadow-raised outline-none sm:p-6"
      >
        <div className="flex items-center justify-between gap-2 border-b border-stone-200 pb-3">
          <h2 className="font-display font-semibold text-stone-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-stone-500 hover:bg-stone-100 hover:text-stone-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FormFooter({ onClose, busy, submitLabel }: { onClose: () => void; busy: boolean; submitLabel: string }) {
  return (
    <div className="flex justify-end gap-2 border-t border-stone-200 pt-3">
      <button
        type="button"
        onClick={onClose}
        className={`${TOUCH_H} rounded-control border border-stone-450 bg-stone-0 px-4 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50`}
      >
        Hủy
      </button>
      <button
        type="submit"
        aria-busy={busy || undefined}
        aria-disabled={busy || undefined}
        className={`${TOUCH_H} rounded-control bg-forest-600 px-4 py-1.5 text-xs font-semibold text-stone-0 hover:bg-forest-700 ${BUSY_CLASS}`}
      >
        {busy ? 'Đang gửi…' : submitLabel}
      </button>
    </div>
  );
}

/**
 * Hộp đăng/sửa đóng được lúc lệnh còn bay (X, Hủy, Esc) và mỗi lần mở là một form mới. Lệnh của lần mở trước xong muộn phải báo cho trang là hộp
 * đã gửi không còn mở, để trang không đóng hộp vừa mở lại (xoá chữ khách đang gõ) mà vẫn tải lại danh sách vì sản phẩm đã được lưu thật.
 */
function useStillMounted() {
  const ref = useRef(true);
  useEffect(() => {
    ref.current = true;
    return () => {
      ref.current = false;
    };
  }, []);
  return ref;
}

/**
 * Đăng sản phẩm riêng. Hai cách giao (D4): gian hàng tự giao (tự đặt giá và tồn kho), hoặc "Tubu giao hộ" khi hàng đã nằm
 * trong kho Tubu, nhận diện bằng mã biến thể Pancake; giá và tồn khi đó theo kho Tubu.
 */
export function CreateProductModal({
  onClose,
  onSuccess,
  onOutcomeUnknown,
  onSend,
  notice,
}: {
  onClose: () => void;
  /** `stillOpen` false = hộp gửi lệnh này đã đóng (lệnh của lần mở trước), `name` là tên sản phẩm của lần gửi đó. */
  onSuccess: (stillOpen: boolean, name: string) => void;
  /** Lệnh tạo không có phản hồi nên chưa rõ sản phẩm đã được tạo chưa; `stillOpen` false = hộp đã đóng nên lời báo phải nằm ở trang. Danh sách đã được tải lại ở đây. */
  onOutcomeUnknown?: (stillOpen: boolean) => void;
  /** Khách bấm gửi thật: lời báo về lần gửi trước hết hiệu lực. */
  onSend?: () => void;
  notice?: CreateNotice | null;
}) {
  const qc = useQueryClient();
  const creatingAnywhere = useIsMutating({ mutationKey: CREATE_PRODUCT_KEY }) > 0;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [shortDesc, setShortDesc] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [stock, setStock] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [certifications, setCertifications] = useState('');
  const [tubuFulfils, setTubuFulfils] = useState(false);
  const [pancakeCode, setPancakeCode] = useState('');
  const [linked, setLinked] = useState<LinkablePancakeVariation | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const checkMut = useMutation({
    mutationFn: (code: string) => checkPancakeVariation(code),
    meta: { skipAdminInvalidate: true },
    onSuccess: (v) => {
      setLinked(v);
      setCheckError(null);
    },
    onError: (e: Error) => {
      setLinked(null);
      setCheckError(actionErrorText(e));
    },
  });

  const submitting = useRef(false);
  const stillOpen = useStillMounted();
  const mut = useMutation({
    mutationKey: CREATE_PRODUCT_KEY,
    mutationFn: (dto: CreateMerchantProductInput) => createMerchantProduct(dto),
    onSuccess: (_data, dto) => onSuccess(stillOpen.current, dto.name),
    onError: (e: unknown) => {
      if (!isOutcomeUnknown(e)) {
        setMsg(actionErrorText(e));
        return undefined;
      }
      setMsg(CREATE_OUTCOME_UNKNOWN_TEXT);
      onOutcomeUnknown?.(stillOpen.current);
      // Khoá giữ tới khi danh sách mới về (có hạn 4 giây): khách thấy sản phẩm đã có hay chưa trước khi đăng lại.
      return settleWithin(qc.invalidateQueries({ queryKey: ['merchant-products'] }));
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const send = (dto: CreateMerchantProductInput) => {
    submitting.current = true;
    onSend?.();
    mut.mutate(dto);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current || creatingAnywhere) return;
    setMsg(null);
    if (tubuFulfils && linked?.pancakeId !== pancakeCode.trim()) {
      setMsg('Bấm "Kiểm tra mã" để xác nhận mã biến thể Pancake trước khi gửi.');
      return;
    }
    const common = {
      name: name.trim(),
      description: description.trim(),
      shortDesc: shortDesc.trim() || undefined,
      images: imageUrl.trim() ? [imageUrl.trim()] : [],
      certifications: certifications
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    };
    if (tubuFulfils && linked) {
      send({ ...common, basePrice: linked.retailPrice, tubuFulfils: true, pancakeCode: linked.pancakeId });
      return;
    }
    const price = parseMerchantPrice(basePrice);
    const priceError = merchantPriceError(price);
    if (priceError) {
      setMsg(priceError);
      return;
    }
    send({ ...common, basePrice: price!, stock: Number(stock) });
  };

  return (
    <ModalShell title="Đăng sản phẩm mới lên gian hàng" onClose={onClose}>
      <div className="mt-3 flex items-start gap-2 rounded-control bg-info-bg p-3 text-xs text-info-fg">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Sản phẩm được Tubu Tree kiểm duyệt trước khi hiển thị với khách. Bạn nhận thông báo khi có kết quả.</span>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <div>
          <label htmlFor="merchant-product-name" className="block text-xs font-medium text-stone-700">Tên sản phẩm *</label>
          <input id="merchant-product-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} placeholder="Nước rửa chén bồ hòn sinh học 500ml…" className={INPUT} />
        </div>

        <fieldset className="space-y-2 rounded-control border border-stone-200 p-3">
          <legend className="px-1 text-xs font-medium text-stone-700">Ai giao hàng cho khách?</legend>
          <label className="flex items-start gap-2 text-xs text-stone-700">
            <input type="radio" name="merchant-product-fulfil" checked={!tubuFulfils} onChange={() => setTubuFulfils(false)} className="mt-0.5 h-4 w-4 accent-forest-600" />
            <span>
              <span className="block font-semibold text-stone-900">Gian hàng tự giao</span>
              Bạn tự đóng gói, gửi hàng và nhập mã vận đơn ở tab Đơn cần giao; tiền hàng được đối soát sau khi giao.
            </span>
          </label>
          <label className="flex items-start gap-2 text-xs text-stone-700">
            <input type="radio" name="merchant-product-fulfil" checked={tubuFulfils} onChange={() => setTubuFulfils(true)} className="mt-0.5 h-4 w-4 accent-forest-600" />
            <span>
              <span className="block font-semibold text-stone-900">Tubu giao hộ</span>
              Hàng đã gửi vào kho Tubu Tree và có mã biến thể trên Pancake. Giá và tồn kho theo kho Tubu. Mỗi món bán được vào tab Đối soát sau khi giao: số khách thực trả cho món trừ phí sàn và phí Tubu giao hộ (nếu có); phí giao do Tubu Tree giữ.
            </span>
          </label>
          {tubuFulfils && (
            <div className="space-y-2">
              <label htmlFor="merchant-product-pancake-code" className="block text-xs font-medium text-stone-700">Mã biến thể Pancake *</label>
              <div className="flex gap-2">
                <input
                  id="merchant-product-pancake-code"
                  value={pancakeCode}
                  onChange={(e) => {
                    setPancakeCode(e.target.value);
                    setLinked(null);
                  }}
                  required
                  maxLength={64}
                  className={`${INPUT_CLASS} ${TOUCH_H} flex-1`}
                />
                <button
                  type="button"
                  onClick={() => checkMut.mutate(pancakeCode)}
                  disabled={!pancakeCode.trim() || checkMut.isPending}
                  className={BTN_XS_SECONDARY}
                >
                  {checkMut.isPending ? 'Đang kiểm tra…' : 'Kiểm tra mã'}
                </button>
              </div>
              {linked && (
                <p role="status" className="flex items-start gap-1 text-xs text-success-fg">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {linked.productName} ({linked.variationName}) · {formatVnd(linked.salePrice ?? linked.retailPrice)}
                    {linked.requiresAdminConfirm
                      ? ' · mã này đang thuộc một sản phẩm Tubu Tree đang bán, chỉ được liên kết khi Tubu Tree xác nhận lúc duyệt.'
                      : linked.stock != null
                        ? ` · còn ${linked.stock} trong kho Tubu`
                        : ''}
                  </span>
                </p>
              )}
              {checkError && (
                <p role="alert" className="text-xs text-danger-fg">
                  {checkError}
                </p>
              )}
            </div>
          )}
        </fieldset>

        {!tubuFulfils && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="merchant-product-price" className="block text-xs font-medium text-stone-700">Giá bán (đồng) *</label>
              <input
                id="merchant-product-price"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="120.000"
                aria-describedby="merchant-product-price-hint"
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                required
                className={`${INPUT} font-semibold`}
              />
            </div>
            <div>
              <label htmlFor="merchant-product-stock" className="block text-xs font-medium text-stone-700">Tồn kho bạn đang có *</label>
              <input id="merchant-product-stock" type="number" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} required min={0} max={MAX_STOCK} className={INPUT} />
            </div>
            <p id="merchant-product-price-hint" className="col-span-2 text-xs text-stone-600">
              Giá ghi bằng đồng, ví dụ 120000 (dán 120.000 cũng được). Tối thiểu 1.000đ.
            </p>
          </div>
        )}

        <div>
          <label htmlFor="merchant-product-short-desc" className="block text-xs font-medium text-stone-700">Mô tả ngắn</label>
          <input id="merchant-product-short-desc" value={shortDesc} onChange={(e) => setShortDesc(e.target.value)} maxLength={300} placeholder="Chiết xuất bồ hòn tự nhiên, an toàn cho da nhạy cảm…" className={INPUT} />
        </div>

        <div>
          <label htmlFor="merchant-product-description" className="block text-xs font-medium text-stone-700">Nội dung mô tả chi tiết *</label>
          <textarea id="merchant-product-description" value={description} onChange={(e) => setDescription(e.target.value)} required rows={3} placeholder="Công dụng, thành phần, hướng dẫn sử dụng, hạn sử dụng…" className={INPUT} />
        </div>

        <div>
          <label htmlFor="merchant-product-certifications" className="block text-xs font-medium text-stone-700">Tiêu chuẩn / chứng nhận xanh (phân cách bằng dấu phẩy)</label>
          <input id="merchant-product-certifications" value={certifications} onChange={(e) => setCertifications(e.target.value)} placeholder="Thuần chay, Hữu cơ" className={INPUT} />
        </div>

        <div>
          <label htmlFor="merchant-product-image-url" className="block text-xs font-medium text-stone-700">URL hình ảnh sản phẩm</label>
          <input id="merchant-product-image-url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" className={INPUT} />
        </div>

        {msg && (
          <p role="alert" className="text-xs text-danger-fg">
            {msg}
          </p>
        )}

        {notice?.kind === 'sent' && (
          <p role="status" className="flex items-start gap-1 text-xs text-success-fg">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{notice.text}</span>
          </p>
        )}
        {notice?.kind === 'unknown' && (
          <p role="alert" className="text-xs text-danger-fg">
            {notice.text}
          </p>
        )}

        <FormFooter
          onClose={onClose}
          busy={mut.isPending || creatingAnywhere}
          submitLabel={notice?.kind === 'sent' ? 'Gửi thêm sản phẩm' : 'Gửi kiểm duyệt'}
        />
      </form>
    </ModalShell>
  );
}

/**
 * Sửa sản phẩm tự đăng. Giá, tồn kho có hiệu lực ngay; đổi tên, mô tả, ảnh của sản phẩm đang bán thành bản sửa chờ duyệt, sản
 * phẩm vẫn bán nội dung cũ. Có bản sửa đang chờ thì form mở từ bản đó (sửa tiếp, không bắt đầu lại từ nội dung đang bán).
 */
export function EditProductModal({ product, onClose, onSuccess }: { product: MerchantProduct; onClose: () => void; onSuccess: (stillOpen: boolean) => void }) {
  const tubu = product.fulfilment === 'TUBU';
  const unlinkedCode = !tubu ? (product.pancakeLinkCode ?? null) : null;
  const live = product.approvalStatus === 'APPROVED';
  const base = product.pendingEdit ?? product;
  const [codeMode, setCodeMode] = useState<'keep' | 'change' | 'selfShip'>('keep');
  const [newCode, setNewCode] = useState('');
  const [linked, setLinked] = useState<LinkablePancakeVariation | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const awaitingLink = !!unlinkedCode && codeMode !== 'selfShip';
  const priceStockHidden = tubu || awaitingLink;
  const [name, setName] = useState(base.name);
  const [shortDesc, setShortDesc] = useState(base.shortDesc ?? '');
  const [description, setDescription] = useState(base.description);
  const [imageUrl, setImageUrl] = useState(base.images[0] ?? '');
  const [basePrice, setBasePrice] = useState(String(product.basePrice));
  const [stock, setStock] = useState(String(product.variations?.[0]?.stock ?? 0));
  const [msg, setMsg] = useState<string | null>(null);

  const qc = useQueryClient();
  const submitting = useRef(false);
  const stillOpen = useStillMounted();
  const mut = useMutation({
    mutationFn: (dto: UpdateMerchantProductInput) => updateMerchantProduct(product.id, dto),
    onSuccess: () => onSuccess(stillOpen.current),
    onError: (e: unknown) => {
      setMsg(actionErrorText(e));
      // 404/409: sản phẩm đã đổi hoặc không còn nên danh sách phía sau đang cũ. 400 là luật nhập liệu (giá, mã Pancake), không tải lại.
      const status = errorStatus(e);
      return status === 404 || status === 409 ? settleWithin(qc.invalidateQueries({ queryKey: ['merchant-products'] })) : undefined;
    },
    onSettled: () => {
      submitting.current = false;
    },
  });

  const checkMut = useMutation({
    mutationFn: (code: string) => checkPancakeVariation(code),
    meta: { skipAdminInvalidate: true },
    onSuccess: (v) => {
      setLinked(v);
      setCheckError(null);
    },
    onError: (e: Error) => {
      setLinked(null);
      setCheckError(actionErrorText(e));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    setMsg(null);
    if (codeMode === 'change' && linked?.pancakeId !== newCode.trim()) {
      setMsg('Bấm "Kiểm tra mã" để xác nhận mã biến thể Pancake mới trước khi lưu.');
      return;
    }
    const price = parseMerchantPrice(basePrice);
    if (!priceStockHidden) {
      const priceError = merchantPriceError(price);
      if (priceError) {
        setMsg(priceError);
        return;
      }
    }
    const dto: UpdateMerchantProductInput = {};
    if (name.trim() !== base.name) dto.name = name.trim();
    if (shortDesc.trim() !== (base.shortDesc ?? '')) dto.shortDesc = shortDesc.trim();
    if (description.trim() !== base.description) dto.description = description.trim();
    if (imageUrl.trim() !== (base.images[0] ?? '')) dto.images = imageUrl.trim() ? [imageUrl.trim()] : [];
    if (codeMode === 'change') dto.pancakeCode = linked!.pancakeId;
    if (codeMode === 'selfShip') {
      // Giá và khuyến mãi của mã Pancake cũ còn nằm trên sản phẩm: gửi giá đối tác đang thấy kèm salePrice null để khách trả
      // đúng số đó, không phụ thuộc việc server có tự bỏ giá khuyến mãi cũ hay không.
      dto.pancakeCode = null;
      dto.basePrice = price!;
      dto.salePrice = null;
    }
    if (!priceStockHidden) {
      if (codeMode !== 'selfShip' && price !== product.basePrice) dto.basePrice = price!;
      if (Number(stock) !== (product.variations?.[0]?.stock ?? 0)) dto.stock = Number(stock);
    }
    if (Object.keys(dto).length === 0) {
      onClose();
      return;
    }
    submitting.current = true;
    mut.mutate(dto);
  };

  return (
    <ModalShell title={`Sửa sản phẩm: ${product.name}`} onClose={onClose}>
      <div className="mt-3">
        <Notice>
          {priceStockHidden ? 'Sản phẩm Tubu giao hộ lấy giá và tồn kho theo kho Tubu. ' : 'Giá và tồn kho có hiệu lực ngay. '}
          {live
            ? 'Đổi tên, mô tả hoặc ảnh thì Tubu Tree duyệt lại nội dung mới; trong lúc chờ, sản phẩm vẫn bán với nội dung cũ.'
            : 'Sản phẩm chưa hiển thị với khách; sửa xong Tubu Tree duyệt rồi mới bán.'}
        </Notice>
        {live && product.pendingEdit && (
          <div className="mt-2">
            <Notice tone="warning">
              Bản sửa đang chờ Tubu Tree duyệt, form dưới là nội dung bản sửa. Khách vẫn thấy nội dung đang bán cho tới khi được duyệt.
            </Notice>
          </div>
        )}
      </div>
      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <div>
          <label htmlFor="merchant-edit-name" className="block text-xs font-medium text-stone-700">Tên sản phẩm</label>
          <input id="merchant-edit-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} className={INPUT} />
        </div>
        {unlinkedCode && (
          <fieldset className="space-y-2 rounded-control border border-stone-200 p-3">
            <legend className="px-1 text-xs font-medium text-stone-700">Mã biến thể Pancake: {unlinkedCode}</legend>
            <p className="text-xs text-stone-600">
              Sản phẩm chưa được liên kết với kho Tubu (đã gỡ liên kết hoặc đang chờ Tubu Tree duyệt). Chọn cách tiếp tục bán:
            </p>
            <label className="flex items-start gap-2 text-xs text-stone-700">
              <input type="radio" name="merchant-edit-code" checked={codeMode === 'keep'} onChange={() => setCodeMode('keep')} className="mt-0.5 h-4 w-4 accent-forest-600" />
              <span>
                <span className="block font-semibold text-stone-900">Giữ mã hiện tại</span>
                {product.isActive === false
                  ? 'Bấm "Mở bán lại" ở danh sách để Tubu Tree duyệt liên kết lại mã này.'
                  : 'Tubu Tree sẽ duyệt liên kết mã này.'}
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs text-stone-700">
              <input type="radio" name="merchant-edit-code" checked={codeMode === 'change'} onChange={() => setCodeMode('change')} className="mt-0.5 h-4 w-4 accent-forest-600" />
              <span>
                <span className="block font-semibold text-stone-900">Đổi sang mã Pancake khác</span>
                Mã mới được Tubu Tree duyệt lại trước khi liên kết; sản phẩm tự mở bán lại ngay khi duyệt xong.
              </span>
            </label>
            {codeMode === 'change' && (
              <div className="space-y-2">
                <label htmlFor="merchant-edit-new-code" className="block text-xs font-medium text-stone-700">Mã biến thể Pancake mới *</label>
                <div className="flex gap-2">
                  <input
                    id="merchant-edit-new-code"
                    value={newCode}
                    onChange={(e) => {
                      setNewCode(e.target.value);
                      setLinked(null);
                      setCheckError(null);
                    }}
                    maxLength={64}
                    className={`${INPUT_CLASS} ${TOUCH_H} flex-1`}
                  />
                  <button type="button" onClick={() => checkMut.mutate(newCode)} disabled={!newCode.trim() || checkMut.isPending} className={BTN_XS_SECONDARY}>
                    {checkMut.isPending ? 'Đang kiểm tra…' : 'Kiểm tra mã'}
                  </button>
                </div>
                {linked && (
                  <p role="status" className="flex items-start gap-1 text-xs text-success-fg">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      {linked.productName} ({linked.variationName}) · {formatVnd(linked.salePrice ?? linked.retailPrice)}
                      {linked.requiresAdminConfirm ? ' · mã này đang thuộc một sản phẩm Tubu Tree đang bán, chỉ được liên kết khi Tubu Tree xác nhận lúc duyệt.' : ''}
                    </span>
                  </p>
                )}
                {checkError && (
                  <p role="alert" className="text-xs text-danger-fg">
                    {checkError}
                  </p>
                )}
              </div>
            )}
            <label className="flex items-start gap-2 text-xs text-stone-700">
              <input type="radio" name="merchant-edit-code" checked={codeMode === 'selfShip'} onChange={() => setCodeMode('selfShip')} className="mt-0.5 h-4 w-4 accent-forest-600" />
              <span>
                <span className="block font-semibold text-stone-900">Chuyển sang gian hàng tự giao</span>
                Bỏ mã Pancake. Bạn tự đóng gói, gửi hàng và tự đặt giá, tồn kho bên dưới.
              </span>
            </label>
          </fieldset>
        )}
        {!priceStockHidden && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="merchant-edit-price" className="block text-xs font-medium text-stone-700">Giá bán (đồng)</label>
              <input
                id="merchant-edit-price"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="120.000"
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                required
                aria-describedby={codeMode === 'selfShip' ? 'merchant-edit-price-hint' : undefined}
                className={INPUT}
              />
            </div>
            <div>
              <label htmlFor="merchant-edit-stock" className="block text-xs font-medium text-stone-700">
                Số còn bán được
                {(product.heldQty ?? 0) > 0 && <span className="block font-normal text-stone-500">đã trừ {product.heldQty} sp khách đặt chưa gửi</span>}
              </label>
              <input id="merchant-edit-stock" type="number" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} required min={0} max={MAX_STOCK} className={INPUT} />
            </div>
            {codeMode === 'selfShip' && (
              <p id="merchant-edit-price-hint" className="col-span-2 text-xs text-stone-600">
                Sau khi chuyển sang tự giao, khách trả đúng giá này.
                {product.salePrice != null && ` Giá khuyến mãi lấy từ Pancake (${formatVnd(product.salePrice)}) sẽ được bỏ.`}
              </p>
            )}
          </div>
        )}
        <div>
          <label htmlFor="merchant-edit-short-desc" className="block text-xs font-medium text-stone-700">Mô tả ngắn</label>
          <input id="merchant-edit-short-desc" value={shortDesc} onChange={(e) => setShortDesc(e.target.value)} maxLength={300} className={INPUT} />
        </div>
        <div>
          <label htmlFor="merchant-edit-description" className="block text-xs font-medium text-stone-700">Nội dung mô tả chi tiết</label>
          <textarea id="merchant-edit-description" value={description} onChange={(e) => setDescription(e.target.value)} required rows={3} className={INPUT} />
        </div>
        <div>
          <label htmlFor="merchant-edit-image-url" className="block text-xs font-medium text-stone-700">URL hình ảnh sản phẩm</label>
          <input id="merchant-edit-image-url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" className={INPUT} />
        </div>
        {msg && (
          <p role="alert" className="text-xs text-danger-fg">
            {msg}
          </p>
        )}
        <FormFooter onClose={onClose} busy={mut.isPending} submitLabel="Lưu thay đổi" />
      </form>
    </ModalShell>
  );
}
