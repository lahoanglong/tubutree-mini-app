'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getAdminProduct, patchAdminProduct, type CategoryOption, type ProductDetail, type ProductPatch } from '@/lib/product-categories';
import { formatVnd } from '@/lib/format-vnd';
import { ImageUrlField } from './image-url-field';
import { SideDrawer } from './side-drawer';
import { BTN_PRIMARY, BTN_SECONDARY, INPUT_CLASS, Notice, chipClass } from './ui';

const MAX_IMAGES = 8;
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * Sửa một sản phẩm. Tên và giá không sửa ở đây vì đồng bộ Pancake ghi đè hai chỗ này mỗi lần chạy; ảnh, mô tả, ẩn/hiện,
 * nổi bật, danh mục là phần của Tubu Tree. Hàng của đối tác thì đối tác tự sửa ảnh và mô tả qua bản nháp để chờ duyệt.
 */
export function ProductEditDrawer({
  id,
  categories,
  onClose,
  onSaved,
}: {
  id: string;
  categories: CategoryOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const q = useQuery({ queryKey: ['admin-product', id], queryFn: () => getAdminProduct(id) });
  return (
    <SideDrawer title={q.data?.name ?? 'Sản phẩm'} onClose={onClose}>
      {q.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {q.isError && <Notice tone="danger" role="alert">{errText(q.error, 'Không tải được sản phẩm.')}</Notice>}
      {q.data && <Form product={q.data} categories={categories} onClose={onClose} onSaved={onSaved} />}
    </SideDrawer>
  );
}

function Form({ product, categories, onClose, onSaved }: { product: ProductDetail; categories: CategoryOption[]; onClose: () => void; onSaved: () => void }) {
  const [images, setImages] = useState<string[]>(product.images);
  const [description, setDescription] = useState(product.description);
  const [shortDesc, setShortDesc] = useState(product.shortDesc ?? '');
  const [isActive, setIsActive] = useState(product.isActive);
  const [isFeatured, setIsFeatured] = useState(product.isFeatured);
  const [categoryIds, setCategoryIds] = useState<string[]>(product.categoryIds);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setMsg(null), [images, description, shortDesc, isActive, isFeatured, categoryIds]);

  const locked = product.partnerOwned;
  const cleanImages = images.map((s) => s.trim()).filter(Boolean);
  const showBlocked = !product.isActive && product.cannotShowReason !== null;

  // Chỉ gửi phần khách sửa: gửi cả trường không đổi thì ghi đè chữ mà đồng bộ Pancake vừa cập nhật sau lúc mở màn này.
  const patch: ProductPatch = {};
  if (!locked) {
    if (JSON.stringify(cleanImages) !== JSON.stringify(product.images)) patch.images = cleanImages;
    if (description !== product.description) patch.description = description;
    if ((shortDesc.trim() || null) !== (product.shortDesc?.trim() || null)) patch.shortDesc = shortDesc.trim() || null;
  }
  if (isActive !== product.isActive) patch.isActive = isActive;
  if (isFeatured !== product.isFeatured) patch.isFeatured = isFeatured;
  if (JSON.stringify([...categoryIds].sort()) !== JSON.stringify([...product.categoryIds].sort())) patch.categoryIds = categoryIds;
  const changed = Object.keys(patch).length > 0;

  const save = useMutation({
    mutationFn: () => patchAdminProduct(product.id, patch),
    onSuccess: () => {
      setMsg({ ok: true, text: 'Đã lưu.' });
      onSaved();
    },
    onError: (e) => setMsg({ ok: false, text: errText(e, 'Không lưu được sản phẩm.') }),
  });

  const setImage = (i: number, v: string) => setImages((prev) => prev.map((x, j) => (j === i ? v : x)));
  const toggleCat = (cid: string) => setCategoryIds((prev) => (prev.includes(cid) ? prev.filter((x) => x !== cid) : [...prev, cid]));

  return (
    <form
      className="space-y-4 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!save.isPending && changed) save.mutate();
      }}
    >
      <div className="rounded-card border border-stone-200 bg-stone-0 p-3 text-sm text-stone-700">
        <div>
          <span className="text-stone-500">Tên: </span>
          {product.name}
        </div>
        <div>
          <span className="text-stone-500">Giá: </span>
          {formatVnd(product.salePrice ?? product.basePrice)}
        </div>
        <p className="mt-1 text-xs text-stone-600">
          {product.partnerOwned
            ? 'Hàng của đối tác: đối tác tự sửa tên, giá, ảnh và mô tả. Ở đây chỉ ẩn/hiện, nổi bật và danh mục.'
            : product.managedByPancake
              ? 'Tên và giá lấy từ Pancake, sửa bên Pancake. Ở đây sửa ảnh, mô tả và cách hiển thị.'
              : 'Tên và giá chưa sửa được ở đây.'}
        </p>
      </div>

      {!locked && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-stone-900">Ảnh sản phẩm (ảnh đầu là ảnh đại diện)</legend>
          {images.map((img, i) => (
            <ImageUrlField key={i} label={`Ảnh ${i + 1}`} value={img} onChange={(v) => setImage(i, v)} />
          ))}
          {images.length < MAX_IMAGES && (
            <button type="button" onClick={() => setImages((p) => [...p, ''])} className={BTN_SECONDARY}>
              Thêm ảnh
            </button>
          )}
          <label className="block text-sm text-stone-700">
            Mô tả ngắn
            <input value={shortDesc} maxLength={300} onChange={(e) => setShortDesc(e.target.value)} className={`${INPUT_CLASS} mt-1`} />
          </label>
          <label className="block text-sm text-stone-700">
            Mô tả
            <textarea value={description} maxLength={5000} rows={6} onChange={(e) => setDescription(e.target.value)} className={`${INPUT_CLASS} mt-1`} />
          </label>
          {product.managedByPancake && (
            <p className="text-xs text-stone-500">
              Lưu ý: mỗi lần đồng bộ, Pancake có ảnh thì ảnh ở đây bị thay bằng ảnh của Pancake, Pancake có mô tả thì mô tả ở đây bị thay. Pancake để
              trống thì giữ nguyên bản của bạn. Danh mục đã chọn ở đây thì đồng bộ không đổi; sản phẩm chưa có danh mục sẽ được điền theo bản đồ nhóm hàng Pancake.
            </p>
          )}
        </fieldset>
      )}

      <div className="space-y-2">
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-stone-800 sm:min-h-0">
          <input type="checkbox" checked={isActive} disabled={locked} onChange={(e) => setIsActive(e.target.checked)} />
          Đang bán (hiện trên Mini App và web)
        </label>
        {locked && <p className="text-xs text-stone-500">Hàng của đối tác bật hoặc tắt qua gian hàng và luồng duyệt.</p>}
        {showBlocked && !isActive && <p className="text-xs text-warning-fg">Chưa bật bán được: {product.cannotShowReason}</p>}
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-stone-800 sm:min-h-0">
          <input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} />
          Sản phẩm nổi bật
        </label>
      </div>

      <div>
        <div className="mb-1 text-sm font-medium text-stone-900">Danh mục</div>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button key={c.id} type="button" aria-pressed={categoryIds.includes(c.id)} onClick={() => toggleCat(c.id)} className={chipClass(categoryIds.includes(c.id))}>
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {msg && <Notice tone={msg.ok ? 'success' : 'danger'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</Notice>}
      <div className="flex gap-2">
        <button type="submit" disabled={save.isPending || !changed} className={BTN_PRIMARY}>
          {save.isPending ? 'Đang lưu…' : 'Lưu'}
        </button>
        <button type="button" onClick={onClose} className={BTN_SECONDARY}>
          Đóng
        </button>
      </div>
    </form>
  );
}
