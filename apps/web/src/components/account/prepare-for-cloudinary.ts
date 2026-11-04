/** Cạnh dài khi nén ảnh trước khi tải lên Cloudinary: ảnh chụp điện thoại vài MB không cần gửi nguyên bản qua mạng di động. */
const UPLOAD_MAX_DIM = 1600;
const UPLOAD_QUALITY = 0.82;
/** JPEG nhỏ hơn mức này và cạnh dài vừa thì gửi nguyên, nén lại chỉ làm xấu thêm. */
const UPLOAD_KEEP_BYTES = 500 * 1024;

function decodeImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không đọc được tệp ảnh'));
    reader.onload = (e) => {
      const src = e.target?.result as string;
      if (!src) return reject(new Error('Tệp rỗng'));
      const img = new Image();
      img.onerror = () => reject(new Error('Không tải được ảnh'));
      img.onload = () => resolve(img);
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

/** Nền trắng vì JPEG không có độ trong suốt; null khi không có canvas 2D. */
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

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'image/jpeg';
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Bản gửi lên Cloudinary, cùng hành vi `prepareForCloudinary` của Mini App. Chỉ JPEG lớn mới nén: PNG/WebP/GIF giữ nguyên
 * (nền trong suốt, QR, logo), và mọi lỗi giải mã (HEIC, ảnh quá lớn, không có canvas) cũng gửi nguyên file để Cloudinary
 * tự xử lý thay vì báo lỗi cho khách.
 */
export async function prepareForCloudinary(file: File): Promise<Blob> {
  if (file.type !== 'image/jpeg') return file;
  try {
    const img = await decodeImage(file);
    if (file.size <= UPLOAD_KEEP_BYTES && Math.max(img.width, img.height) <= UPLOAD_MAX_DIM) return file;
    const dataUrl = renderJpeg(img, UPLOAD_MAX_DIM, UPLOAD_QUALITY);
    return dataUrl ? dataUrlToBlob(dataUrl) : file;
  } catch {
    return file;
  }
}
