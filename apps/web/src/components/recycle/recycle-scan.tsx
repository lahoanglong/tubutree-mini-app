'use client';

import { useRef, useState } from 'react';
import { Camera, ScanLine } from 'lucide-react';
import { extractWasteLookupCode } from '@tubutree/app-core/waste-code-input';
import { Sheet } from '@/components/ui/sheet';
import { useCameraAvailable, useCameraScan, usePhotoScan, type ScanFormat } from '@/lib/code-scan';
import { ui } from '@/lib/guest-ui';

const NOT_WASTE_CODE = 'Mã QR này không phải mã Đổi rác. Hãy quét lại hoặc gõ mã bên dưới.';
const SCAN_FAILED = 'Chưa quét được. Hãy thử lại, chụp ảnh mã hoặc gõ mã bên dưới.';
const CAMERA_DENIED = 'Chưa mở được camera. Hãy cho phép camera, chụp ảnh mã hoặc gõ mã bên dưới.';
const PHOTO_CTA = 'Chụp/chọn ảnh mã QR';
const PHOTO_READING = 'Đang đọc ảnh…';
const PHOTO_UNREADABLE = 'Chưa đọc được mã QR trong ảnh. Hãy chụp gần, rõ nét hơn hoặc gõ mã bên dưới.';
const QR_ONLY: readonly ScanFormat[] = ['qr_code'];

/** Mã TR-/QG- đầu tiên trong các chuỗi đọc được, hoặc null. */
function wasteCodeOf(values: readonly string[]): string | null {
  for (const value of values) {
    const code = extractWasteLookupCode(value);
    if (code) return code;
  }
  return null;
}

/**
 * Quét mã QR của khách ở quầy Đổi rác (W45: mọi máy, kể cả iPhone). Máy có camera: nút "Quét mã của khách" mở camera trong Sheet, kèm lối phụ
 * "Chụp/chọn ảnh mã QR" cho WebView chặn camera; máy không có API camera thì chỉ còn lối ảnh (nút "Tra mã" của quầy là nút chính). Gọi `onCode`
 * với mã TR-/QG- đầu tiên đọc được.
 */
export function ScanCodeButton({
  onCode,
  onFail,
  disabled,
  busy,
}: {
  onCode: (code: string) => void;
  onFail: (text: string) => void;
  disabled?: boolean;
  /** Quầy đang bận việc khác: nút báo aria-disabled và không mở camera, nhưng KHÔNG `disabled` thật để giữ focus bàn phím. */
  busy?: boolean;
}) {
  const camera = useCameraAvailable();
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useCameraScan({
    open,
    videoRef,
    formats: QR_ONLY,
    onValues: (values) => {
      const code = wasteCodeOf(values);
      if (!code) {
        setHint(NOT_WASTE_CODE);
        return false;
      }
      setOpen(false);
      onCode(code);
      return true;
    },
    onError: (kind) => {
      setOpen(false);
      onFail(kind === 'denied' ? CAMERA_DENIED : SCAN_FAILED);
    },
  });

  const photo = usePhotoScan({
    formats: QR_ONLY,
    onValues: (values) => {
      const code = wasteCodeOf(values);
      if (code) onCode(code);
      else onFail(NOT_WASTE_CODE);
    },
    onError: (kind) => onFail(kind === 'failed' ? SCAN_FAILED : PHOTO_UNREADABLE),
  });

  return (
    <>
      {camera && (
        <button
          type="button"
          className={`${ui.btnPrimary} w-full gap-2`}
          disabled={disabled}
          aria-disabled={busy || undefined}
          onClick={() => {
            if (busy) return;
            setHint(null);
            setOpen(true);
          }}
        >
          <ScanLine className="h-5 w-5" aria-hidden="true" />
          Quét mã của khách
        </button>
      )}
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-center gap-1.5 text-sm font-medium text-forest-700 underline underline-offset-2 disabled:opacity-50"
        disabled={disabled}
        aria-disabled={busy || undefined}
        aria-busy={photo.reading || undefined}
        onClick={() => {
          if (!busy) photo.pick();
        }}
      >
        <Camera className="h-4 w-4" aria-hidden="true" />
        {photo.reading ? PHOTO_READING : PHOTO_CTA}
      </button>
      <input {...photo.inputProps} />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Quét mã của khách"
        footer={
          <button type="button" className={`${ui.btnSecondary} w-full`} onClick={() => setOpen(false)}>
            Đóng
          </button>
        }
      >
        <div className="flex flex-col gap-3">
          <video ref={videoRef} playsInline muted aria-label="Camera quét mã" className="aspect-square w-full rounded-card bg-stone-900 object-cover" />
          <p className="text-sm text-stone-600">Đưa mã QR của khách vào khung hình</p>
          {hint && (
            <p role="alert" className={ui.error}>
              {hint}
            </p>
          )}
        </div>
      </Sheet>
    </>
  );
}
