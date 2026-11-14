'use client';

import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { BTN_SECONDARY } from '@/components/admin/ui';
import { MAX_IMAGE_BYTES, isUsableImageFile } from '@/lib/image-compress';

const MSG = {
  notImage: 'Tệp này không phải ảnh. Chọn ảnh JPEG, PNG hoặc WebP.',
  tooBig: 'Ảnh quá lớn (tối đa 20MB). Chọn ảnh nhỏ hơn.',
  noClipboardImage: 'Bộ nhớ tạm chưa có ảnh. Chụp hoặc sao chép ảnh rồi thử lại.',
  noClipboardApi: 'Trình duyệt không cho đọc ảnh từ bộ nhớ tạm. Bấm vào ô này rồi nhấn Ctrl+V (⌘V trên Mac).',
} as const;

const BUSY_BTN = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

interface Props {
  /** Tên đọc cho trình đọc màn hình, thường nêu sản phẩm ("Ảnh cho Mật cô đặc"). */
  label: string;
  /** Gọi đúng một lần cho ảnh đầu tiên hợp lệ (chọn tệp, thả, dán). Việc nén và tải lên là của nơi dùng. */
  onFile: (file: File) => void;
  /** Đang tải lượt trước: không nhận ảnh mới (nơi dùng giữ khoá, ô chỉ phản ánh). */
  busy?: boolean;
  disabled?: boolean;
  pickLabel?: string;
  hint?: string;
}

/** Ảnh trong bộ nhớ tạm trình duyệt hay đưa về dạng `File` có tên (Safari/Chrome trả Blob không tên). */
const toFile = (blob: Blob, type: string): File => new File([blob], `anh-dan.${type === 'image/jpeg' ? 'jpg' : (type.split('/')[1] ?? 'png')}`, { type });

/**
 * Ô nhận MỘT ảnh cho dòng sản phẩm: chọn tệp, kéo-thả, hoặc dán (bấm vào ô rồi Ctrl+V / ⌘V, hay nút "Dán ảnh" đọc bộ nhớ tạm). Chỉ kiểm sơ bộ
 * (là ảnh, ≤ 20MB); chữ ký tệp và dung lượng sau nén do máy chủ kiểm lại. Dán chữ thuần thì bỏ qua để không nuốt thao tác dán của ô nhập bên trong.
 */
export function ImageDropZone({ label, onFile, busy = false, disabled = false, pickLabel = 'Chọn ảnh', hint = 'Kéo ảnh vào đây, hoặc bấm vào ô này rồi nhấn Ctrl+V (⌘V trên Mac) để dán.' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = busy || disabled;

  const take = (files: ArrayLike<File> | null | undefined): void => {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    const file = list.find((f) => isUsableImageFile(f));
    if (!file) {
      setError(MSG.notImage);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(MSG.tooBig);
      return;
    }
    setError(null);
    onFile(file);
  };

  const onPick = () => {
    if (!locked) inputRef.current?.click();
  };

  const onPickChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!locked) take(files);
    e.target.value = '';
  };

  const hasFiles = (e: DragEvent<HTMLElement>) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

  const onDragOver = (e: DragEvent<HTMLElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (!locked) setDragging(true);
  };

  const onDragLeave = (e: DragEvent<HTMLElement>) => {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setDragging(false);
  };

  // preventDefault cả khi khoá: nếu không trình duyệt sẽ mở tệp ảnh thay cho trang quản trị.
  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragging(false);
    if (!locked) take(e.dataTransfer?.files);
  };

  const onPaste = (e: ClipboardEvent<HTMLElement>) => {
    if (locked) return;
    const fromItems = Array.from(e.clipboardData?.items ?? []).flatMap((i) => (i.kind === 'file' ? (i.getAsFile() ?? []) : []));
    const files = e.clipboardData?.files?.length ? Array.from(e.clipboardData.files) : fromItems;
    if (!files.some((f) => isUsableImageFile(f))) return;
    e.preventDefault();
    take(files);
  };

  const pasteFromClipboard = async () => {
    if (locked) return;
    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.read !== 'function') {
      setError(MSG.noClipboardApi);
      return;
    }
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) {
          take([toFile(await item.getType(type), type)]);
          return;
        }
      }
      setError(MSG.noClipboardImage);
    } catch {
      setError(MSG.noClipboardApi);
    }
  };

  const lockProps = { 'aria-disabled': locked || undefined };

  return (
    <div
      data-testid="image-drop-zone"
      data-dragging={dragging || undefined}
      role="group"
      aria-label={label}
      aria-busy={busy || undefined}
      tabIndex={0}
      onPaste={onPaste}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="space-y-2 rounded-control border border-dashed border-stone-450 bg-stone-50 p-2.5 data-[dragging=true]:border-forest-600 data-[dragging=true]:bg-stone-100"
    >
      <p className="text-xs text-stone-600">{hint}</p>
      <div className="flex flex-wrap gap-2">
        <input ref={inputRef} type="file" accept="image/*" hidden aria-label={`Chọn tệp ảnh: ${label}`} onChange={onPickChange} />
        <button type="button" onClick={onPick} {...lockProps} className={`${BTN_SECONDARY} ${BUSY_BTN} min-w-[44px]`}>
          {pickLabel}
        </button>
        <button type="button" onClick={() => void pasteFromClipboard()} {...lockProps} className={`${BTN_SECONDARY} ${BUSY_BTN} min-w-[44px]`}>
          Dán ảnh
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}
