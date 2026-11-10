import { useRef, useState, type CSSProperties } from 'react';
import { Camera, Loader2, RefreshCw, Video, X } from 'lucide-react';
import {
  readVideoDuration,
  uploadCloudinaryVideo,
  videoUploadCopy,
  VideoUploadError,
  REVIEW_VIDEO_MAX_SECONDS,
} from '@tubutree/app-core/cloudinary-video';
import { haptic } from '../utils/haptic';
import { Text } from './ui/text';

const CLOUD = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined;
const PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined;
const CONFIGURED = Boolean(CLOUD && PRESET);

/** Có dịch vụ lưu ảnh (Cloudinary) trong bản build này không. Ảnh đại diện chỉ lưu được dạng URL nên cần có nó. */
export const isCloudinaryConfigured = (): boolean => CONFIGURED;

/** Chặn ảnh gốc quá lớn TRƯỚC khi đưa vào canvas nén — ảnh vài chục MB (panorama, RAW export...)
 * có thể treo/crash webview khi drawImage/toDataURL. VideoUpload có guard tương tự (50MB, 60 giây). */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** Nút văn bản có vùng chạm 44px (chữ nhỏ vẫn phải bấm dễ). */
const LINK_BUTTON: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  minHeight: 44,
  padding: 0,
  border: 'none',
  background: 'none',
  font: 'inherit',
  cursor: 'pointer',
};

interface DecodedImage {
  src: string;
  img: HTMLImageElement;
}

function decodeImage(file: File): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không đọc được tệp ảnh'));
    reader.onload = (e) => {
      const src = e.target?.result as string;
      if (!src) return reject(new Error('Tệp rỗng'));
      const img = new Image();
      img.onerror = () => reject(new Error('Không tải được ảnh'));
      img.onload = () => resolve({ src, img });
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

/** Vẽ ảnh vào canvas (cạnh dài tối đa `maxDim`) rồi xuất JPEG; null khi không có canvas 2D. Nền trắng vì JPEG không có độ trong suốt (PNG trong suốt sẽ thành đen). */
function renderJpeg(img: HTMLImageElement, maxDim: number, quality: number): string | null {
  let { width, height } = img;
  if (width > maxDim || height > maxDim) {
    if (width > height) {
      height = Math.round((height * maxDim) / width);
      width = maxDim;
    } else {
      width = Math.round((width * maxDim) / height);
      height = maxDim;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

const KEEP_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/webp']);
/** 400KB nhị phân ≈ 540k ký tự base64, dưới trần nhỏ nhất của API (700k). */
const KEEP_RASTER_BYTES = 400 * 1024;

/**
 * Nén ảnh client-side bằng HTMLCanvasElement + FileReader.
 * Chuyển đổi tệp ảnh bất kỳ sang chuỗi Base64 Data URL JPEG dung lượng nhẹ (~150-250KB).
 */
export async function readAndCompressImage(file: File, maxDim = 1200, quality = 0.82): Promise<string> {
  const { src, img } = await decodeImage(file);
  // PNG/WebP nhỏ và vừa cỡ giữ nguyên: qua JPEG sẽ mất độ trong suốt (logo, QR). API nhận png/webp và tự kiểm chữ ký.
  if (KEEP_TYPES.has(file.type) && file.size <= KEEP_RASTER_BYTES && Math.max(img.width, img.height) <= maxDim) return src;
  return renderJpeg(img, maxDim, quality) ?? src;
}

/** Cạnh dài khi nén ảnh trước khi tải lên Cloudinary: ảnh chụp điện thoại vài MB không cần gửi nguyên bản qua mạng di động. */
const UPLOAD_MAX_DIM = 1600;
const UPLOAD_QUALITY = 0.82;
/** JPEG nhỏ hơn mức này và cạnh dài vừa thì gửi nguyên, nén lại chỉ làm xấu thêm. */
const UPLOAD_KEEP_BYTES = 500 * 1024;
/** Cloudinary im quá lâu thì bỏ lượt tải, rơi về bản nén tại chỗ: ô thêm ảnh và nút Gửi của form cha chờ lượt này nên không được treo mãi. */
const CLOUDINARY_TIMEOUT_MS = 60_000;
/** Video tối đa 50MB: trên đường lên 4G yếu (vài Mbps) cần cả hai ba phút, nên rộng hơn ảnh. Quá hạn thì báo lỗi để khách chọn lại, nút Gửi của form cha không treo mãi. */
const VIDEO_UPLOAD_TIMEOUT_MS = 180_000;

/**
 * Chạy `run` với hạn chót: hết `ms` thì huỷ yêu cầu đang chờ, cả lúc chờ phản hồi lẫn lúc đọc thân.
 * Không dùng AbortSignal.timeout: WebView Zalo đời cũ chưa có.
 */
async function withDeadline<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bản gửi lên Cloudinary. Chỉ JPEG lớn mới nén: PNG/WebP/GIF giữ nguyên (nền trong suốt, QR, logo), và mọi lỗi giải mã
 * (HEIC, ảnh quá lớn, không có canvas) cũng gửi nguyên file để Cloudinary tự xử lý thay vì báo lỗi cho khách.
 */
export async function prepareForCloudinary(file: File): Promise<Blob> {
  if (file.type !== 'image/jpeg') return file;
  try {
    const { img } = await decodeImage(file);
    if (file.size <= UPLOAD_KEEP_BYTES && Math.max(img.width, img.height) <= UPLOAD_MAX_DIM) return file;
    const dataUrl = renderJpeg(img, UPLOAD_MAX_DIM, UPLOAD_QUALITY);
    return dataUrl ? dataUrlToBlob(dataUrl) : file;
  } catch {
    return file;
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'image/jpeg';
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Upload 1 file ảnh lên Cloudinary (unsigned preset) → secure_url, hoặc null nếu
 * chưa cấu hình VITE_CLOUDINARY_* hoặc request lỗi (caller tự fallback, VD base64 local).
 */
export async function uploadToCloudinary(file: File | Blob): Promise<string | null> {
  if (!CONFIGURED) return null;
  try {
    return await withDeadline(CLOUDINARY_TIMEOUT_MS, async (signal) => {
      const form = new FormData();
      form.append('file', file);
      form.append('upload_preset', PRESET!);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, {
        method: 'POST',
        body: form,
        signal,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { secure_url?: string };
      return data.secure_url ?? null;
    });
  } catch {
    return null;
  }
}

/**
 * Upload 1 ảnh lên Cloudinary (unsigned preset) → fallback sang FileReader Data URL nếu lỗi/chưa cấu hình.
 */
export function ImageUpload({
  label,
  value,
  onChange,
  onBusyChange,
  disabled = false,
  maxDim,
  quality,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  /** Báo form cha khi đang tải: bấm Lưu lúc ảnh còn đang lên sẽ lưu bản ghi không có ảnh hoặc còn ảnh cũ. */
  onBusyChange?: (busy: boolean) => void;
  /** Form cha đang lưu: đổi ảnh lúc này không vào bản đang lưu mà vẫn làm đổi nhãn nút Lưu. */
  disabled?: boolean;
  /** Chỉ cho nhánh base64 (chưa cấu hình Cloudinary): cạnh dài tối đa và chất lượng JPEG. Tải lên Cloudinary luôn dùng mức cố định 1600. */
  maxDim?: number;
  quality?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changeUploading = (next: boolean) => {
    setUploading(next);
    onBusyChange?.(next);
  };

  const pick = () => {
    if (uploading || disabled) return;
    haptic('light');
    inputRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (uploading || disabled) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    // Ảnh quá lớn dừng ở đây, trước khi báo bận: không có lượt tải nào để chờ.
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Ảnh quá lớn (tối đa 20MB). Hãy chọn ảnh khác nhé.');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    changeUploading(true);
    try {
      if (CONFIGURED) {
        const secureUrl = await uploadToCloudinary(await prepareForCloudinary(file));
        if (secureUrl) {
          haptic('medium');
          onChange(secureUrl);
          return;
        }
      }
      // Chưa cấu hình Cloudinary hoặc tải lỗi: lưu base64 đã nén.
      const dataUrl = await readAndCompressImage(file, maxDim, quality);
      haptic('medium');
      onChange(dataUrl);
    } catch {
      setError('Tải ảnh thất bại. Hãy chọn lại tệp ảnh khác.');
    } finally {
      changeUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div style={{ marginBottom: 12 }}>
      {label && (
        <Text variant="label" as="div" style={{ marginBottom: 4 }}>
          {label}
        </Text>
      )}
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={onFile} />
      <button
        type="button"
        className="tubu-press"
        onClick={pick}
        disabled={uploading || disabled}
        aria-busy={uploading || undefined}
        style={{
          width: '100%',
          font: 'inherit',
          color: 'inherit',
          border: '1.5px dashed var(--color-border-default)',
          borderRadius: 'var(--radius-control)',
          padding: value ? 0 : 16,
          textAlign: 'center',
          overflow: 'hidden',
          minHeight: 80,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-bg-canvas)',
          cursor: 'pointer',
        }}
      >
        {uploading ? (
          <Text variant="body-sm" tone="tertiary" as="span" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Loader2 size={14} className="animate-spin" />
            Đang tải ảnh…
          </Text>
        ) : value ? (
          <img src={value} alt={label || 'preview'} style={{ width: '100%', maxHeight: 180, objectFit: 'cover', display: 'block' }} />
        ) : (
          <Text variant="body-sm" tone="brand" as="span" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
            <Camera size={15} />
            Chạm để tải ảnh lên
          </Text>
        )}
      </button>
      {value && !uploading && (
        <button type="button" onClick={pick} disabled={disabled} style={{ ...LINK_BUTTON, marginTop: 4, color: 'var(--color-text-brand)' }}>
          <Text variant="caption" tone="brand" as="span" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <RefreshCw size={12} />
            Đổi ảnh khác
          </Text>
        </button>
      )}
      {error && (
        <div role="alert" style={{ marginTop: 4 }}>
          <Text variant="caption" tone="danger" as="div">
            {error}
          </Text>
        </div>
      )}
    </div>
  );
}

/**
 * Upload 1 video review lên Cloudinary. Chưa cấu hình thì ẩn: máy chủ chỉ nhận video đã tải lên Cloudinary (URL dán tay
 * bị từ chối), nên ô dán URL chỉ dẫn khách tới lỗi.
 */
export function VideoUpload({
  value,
  onChange,
  onBusyChange,
  disabled = false,
  maxSeconds = REVIEW_VIDEO_MAX_SECONDS,
}: {
  value: string;
  onChange: (url: string) => void;
  /** Báo form cha khi đang tải: video 50MB trên 4G mất cả phút, form phải chờ thay vì gửi đánh giá không kèm video. */
  onBusyChange?: (busy: boolean) => void;
  /** Form cha đang gửi: đổi hay xoá video lúc này không vào bản đang gửi mà vẫn làm đổi nhãn nút Gửi. */
  disabled?: boolean;
  maxSeconds?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changeUploading = (next: boolean) => {
    setUploading(next);
    onBusyChange?.(next);
  };

  // Một lần tải mỗi lúc: lần hai chạy song song sẽ báo "xong" trước lần đầu và mở lại nút Gửi của form khi video vẫn đang tải.
  const pick = () => {
    if (uploading || disabled) return;
    haptic('light');
    inputRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (uploading || disabled) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    changeUploading(true);
    try {
      // Hạn chót nằm ở fetch truyền xuống: hàm tải dùng chung với web nên không tự có hạn. Huỷ fetch thì nó báo "Tải video thất bại".
      const url = await withDeadline(VIDEO_UPLOAD_TIMEOUT_MS, (signal) =>
        uploadCloudinaryVideo(
          file,
          { cloudName: CLOUD!, uploadPreset: PRESET! },
          { maxSeconds, readDuration: readVideoDuration, fetchImpl: (input, init) => fetch(input, { ...init, signal }) },
        ),
      );
      haptic('medium');
      onChange(url);
    } catch (err) {
      setError(err instanceof VideoUploadError ? err.message : videoUploadCopy.failed);
    } finally {
      changeUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  if (!CONFIGURED) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <input ref={inputRef} type="file" accept="video/*" hidden onChange={onFile} />
      {value ? (
        <div>
          <video src={value} controls style={{ width: '100%', maxHeight: 200, borderRadius: 'var(--radius-control)', background: 'var(--color-bg-inverse)' }} />
          <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
            <button type="button" onClick={pick} disabled={uploading || disabled} style={LINK_BUTTON}>
              <Text variant="caption" tone="brand" as="span">{uploading ? videoUploadCopy.uploading : 'Đổi video'}</Text>
            </button>
            <button type="button" onClick={() => onChange('')} disabled={uploading || disabled} style={LINK_BUTTON}>
              <Text variant="caption" tone="danger" as="span">Xoá video</Text>
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="tubu-press"
          onClick={pick}
          disabled={uploading || disabled}
          style={{
            width: '100%',
            font: 'inherit',
            color: 'inherit',
            border: '1.5px dashed var(--color-border-subtle)',
            borderRadius: 'var(--radius-control)',
            padding: 14,
            textAlign: 'center',
            background: 'none',
            cursor: 'pointer',
          }}
        >
          <Text variant="body-sm" tone="brand" as="span" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Video size={16} aria-hidden />
            {uploading ? videoUploadCopy.uploading : videoUploadCopy.pick(maxSeconds)}
          </Text>
        </button>
      )}
      {error && (
        <div role="alert" style={{ marginTop: 4 }}>
          <Text variant="caption" tone="danger" as="div">
            {error}
          </Text>
        </div>
      )}
    </div>
  );
}

/** Upload nhiều ảnh (cho bài viết cộng đồng / đánh giá sản phẩm). */
export function MultiImageUpload({
  value = [],
  onChange,
  onBusyChange,
  disabled = false,
  max = 6,
  label = 'Ảnh đính kèm',
}: {
  value?: string[];
  onChange: (urls: string[]) => void;
  /** Báo form cha khi đang tải: gửi lúc ảnh còn đang lên sẽ lưu bản ghi không kèm ảnh. */
  onBusyChange?: (busy: boolean) => void;
  /** Form cha đang gửi: thêm hay xoá ảnh lúc này không vào bản đang gửi mà vẫn làm đổi nhãn nút Gửi. */
  disabled?: boolean;
  max?: number;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changeUploading = (next: boolean) => {
    setUploading(next);
    onBusyChange?.(next);
  };

  const pick = () => {
    if (uploading || disabled) return;
    haptic('light');
    inputRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (uploading || disabled) return;
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setError(null);
    changeUploading(true);
    try {
      const newUrls: string[] = [];
      let oversizedCount = 0;
      for (const file of files) {
        if (value.length + newUrls.length >= max) break;
        if (file.size > MAX_IMAGE_BYTES) {
          oversizedCount += 1;
          continue;
        }
        const uploadedUrl = (await uploadToCloudinary(file)) || (await readAndCompressImage(file));
        if (uploadedUrl) newUrls.push(uploadedUrl);
      }
      if (newUrls.length > 0) {
        haptic('medium');
        onChange([...value, ...newUrls]);
      }
      if (oversizedCount > 0) {
        setError(`Đã bỏ qua ${oversizedCount} ảnh quá lớn (tối đa 20MB/ảnh).`);
      }
    } catch {
      setError('Tải ảnh thất bại. Hãy chọn tệp ảnh khác.');
    } finally {
      changeUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div style={{ marginTop: 14, marginBottom: 14 }}>
      {label && (
        <Text variant="label" as="div" tone="secondary" style={{ marginBottom: 6, fontVariantNumeric: 'tabular-nums' }}>
          {label} ({value.length}/{max})
        </Text>
      )}
      <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={onFile} />

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {value.map((url, idx) => (
          <div
            key={idx}
            style={{
              position: 'relative',
              width: 72,
              height: 72,
              borderRadius: 'var(--radius-control)',
              boxShadow: 'var(--elevation-1)',
              border: '1px solid var(--color-border-subtle)',
            }}
          >
            <div style={{ width: '100%', height: '100%', overflow: 'hidden', borderRadius: 'var(--radius-control)' }}>
              <img src={url} alt={`upload-${idx}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            {/* Vùng chạm 44px nằm gọn trong ô 72px (ô kế tiếp cách 10px, lấn ra là chạm nhầm ảnh bên cạnh);
                vòng 20px nhìn thấy vẫn cách góc 3px. */}
            <button
              type="button"
              aria-label="Xoá ảnh"
              disabled={uploading || disabled}
              onClick={() => {
                if (uploading || disabled) return;
                haptic('light');
                onChange(value.filter((_, i) => i !== idx));
              }}
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: 44,
                height: 44,
                padding: 0,
                border: 'none',
                background: 'none',
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 3,
                  right: 3,
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: 'var(--color-bg-scrim)',
                  color: 'var(--color-text-inverse)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={12} aria-hidden />
              </span>
            </button>
          </div>
        ))}

        {value.length < max && (
          <button
            type="button"
            className="tubu-press"
            onClick={pick}
            disabled={uploading || disabled}
            aria-busy={uploading || undefined}
            style={{
              width: 72,
              height: 72,
              borderRadius: 'var(--radius-control)',
              border: '1.5px dashed var(--color-border-selected)',
              background: 'var(--color-bg-subtle)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              gap: 2,
              padding: '0 6px',
              font: 'inherit',
              color: 'inherit',
            }}
          >
            <Camera size={22} color="var(--color-text-brand)" strokeWidth={1.8} />
            <Text variant="label" tone="brand" as="span" style={{ whiteSpace: 'nowrap' }}>
              {uploading ? 'Đang tải…' : 'Thêm ảnh'}
            </Text>
          </button>
        )}
      </div>

      {error && (
        <div role="alert" style={{ marginTop: 4 }}>
          <Text variant="caption" tone="danger" as="div">
            {error}
          </Text>
        </div>
      )}
    </div>
  );
}
