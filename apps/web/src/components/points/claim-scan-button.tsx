'use client';

import { useRef, useState } from 'react';
import { Camera, ScanLine } from 'lucide-react';
import { extractClaimCode } from '@tubutree/app-core/claim-code';
import { MARKETPLACE_CLAIM_COPY, MARKETPLACE_CLAIM_WEB_COPY as WEB } from '@tubutree/app-core/marketplace-claim-copy';
import { Button } from '@/components/mini/button';
import { Sheet } from '@/components/ui/sheet';
import { useCameraAvailable, useCameraScan, usePhotoScan, type ScanFormat } from '@/lib/code-scan';
import { ui } from '@/lib/guest-ui';

/**
 * Định dạng mã trên phiếu giao hàng sàn: mã vạch Code 128 (SPX, GHN, J&T...), Code 39, Codabar, ITF, EAN và mã QR. Máy có BarcodeDetector
 * thì đọc bằng nó những định dạng nó hỗ trợ; còn lại (mọi iPhone) đọc bằng bộ đọc JS nạp lười (`lib/code-scan.ts`).
 */
export const CLAIM_BARCODE_FORMATS: readonly ScanFormat[] = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'codabar', 'itf'];

/** Mã vận đơn đầu tiên trong các chuỗi đọc được (cùng luật `extractClaimCode` với Mini App), hoặc câu nhắc khi không có. */
function claimCodeOf(values: readonly string[]): { code: string } | { hint: string } {
  let cardOnly = false;
  for (const value of values) {
    const parsed = extractClaimCode(value);
    if ((parsed.kind === 'code' || parsed.kind === 'card_link') && parsed.code) return { code: parsed.code };
    if (parsed.kind === 'card_link') cardOnly = true;
  }
  return { hint: cardOnly ? MARKETPLACE_CLAIM_COPY.scanCardLink : MARKETPLACE_CLAIM_COPY.scanNoCode };
}

/**
 * Lối quét của web `/quet-ma` (W44, W45 cho iPhone): nút "Quét mã trên nhãn" mở camera sau trong một Sheet, đọc mã vạch hoặc QR trên phiếu giao
 * hàng, gọi `onCode` với mã vận đơn đầu tiên đọc được. Ngay dưới là lối "Chụp/chọn ảnh mã vận đơn" cho WebView chặn camera (Zalo, Facebook trên
 * iPhone); máy không có API camera thì lối ảnh thành nút chính. Quét phải thẻ Tubu hay mã không phải mã vận đơn thì nhắc (trong Sheet khi quét,
 * qua `onFail` khi chọn ảnh); camera bị chặn thì đóng Sheet và báo qua `onFail`.
 */
export function ClaimScanButton({
  onCode,
  onFail,
  primary,
}: {
  onCode: (code: string) => void;
  onFail: (text: string) => void;
  /** Một nút chính trên màn: khi mã đã sẵn hay vừa gửi xong thì nút quét lùi về nút phụ. */
  primary: boolean;
}) {
  const camera = useCameraAvailable();
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useCameraScan({
    open,
    videoRef,
    formats: CLAIM_BARCODE_FORMATS,
    onValues: (values) => {
      const r = claimCodeOf(values);
      if ('hint' in r) {
        setHint(r.hint);
        return false;
      }
      setOpen(false);
      onCode(r.code);
      return true;
    },
    onError: (kind) => {
      setOpen(false);
      onFail(kind === 'denied' ? WEB.cameraDenied : WEB.scanFailed);
    },
  });

  const photo = usePhotoScan({
    formats: CLAIM_BARCODE_FORMATS,
    onValues: (values) => {
      const r = claimCodeOf(values);
      if ('code' in r) onCode(r.code);
      else onFail(r.hint);
    },
    onError: (kind) => onFail(kind === 'failed' ? WEB.scanFailed : WEB.photoUnreadable),
  });

  return (
    <>
      {camera ? (
        <>
          <Button
            fullWidth
            size="lg"
            variant={primary ? 'primary' : 'secondary'}
            icon={ScanLine}
            onPress={() => {
              setHint(null);
              setOpen(true);
            }}
          >
            {WEB.scanCta}
          </Button>
          <button
            type="button"
            data-testid="claim-photo-scan"
            className="mt-1 flex min-h-11 w-full items-center justify-center gap-1.5 text-sm font-medium text-forest-700 underline underline-offset-2"
            aria-busy={photo.reading || undefined}
            onClick={photo.pick}
          >
            <Camera className="h-4 w-4" aria-hidden="true" />
            {photo.reading ? WEB.photoReading : WEB.photoCta}
          </button>
        </>
      ) : (
        <div data-testid="claim-photo-scan">
          <Button fullWidth size="lg" variant={primary ? 'primary' : 'secondary'} icon={Camera} loading={photo.reading} onPress={photo.pick}>
            {WEB.photoCta}
          </Button>
        </div>
      )}
      <input {...photo.inputProps} data-testid="claim-photo-input" />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={WEB.scanSheetTitle}
        footer={
          <button type="button" className={`${ui.btnSecondary} w-full`} onClick={() => setOpen(false)}>
            {WEB.scanClose}
          </button>
        }
      >
        <div className="flex flex-col gap-3">
          <video ref={videoRef} playsInline muted aria-label={WEB.cameraLabel} className="aspect-[4/3] w-full rounded-card bg-stone-900 object-cover" />
          <p className="text-sm text-stone-600">{WEB.scanSheetHint}</p>
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
