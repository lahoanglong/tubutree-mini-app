'use client';

import { useEffect, useRef, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { extractClaimCode } from '@tubutree/app-core/claim-code';
import { MARKETPLACE_CLAIM_COPY, MARKETPLACE_CLAIM_WEB_COPY as WEB } from '@tubutree/app-core/marketplace-claim-copy';
import { Button } from '@/components/mini/button';
import { Sheet } from '@/components/ui/sheet';
import { ui } from '@/lib/guest-ui';

type Detector = { detect(source: HTMLVideoElement): Promise<{ rawValue?: string }[]> };
type DetectorCtor = (new (opts?: { formats?: string[] }) => Detector) & { getSupportedFormats?: () => Promise<string[]> };

/**
 * Định dạng mã trên phiếu giao hàng sàn: mã vạch Code 128 (SPX, GHN, J&T...), Code 39, Codabar, ITF, EAN và mã QR. Máy chỉ đọc được một phần
 * thì quét theo phần đó; không đọc được định dạng nào thì ẩn nút, chỉ còn ô nhập.
 */
export const CLAIM_BARCODE_FORMATS: readonly string[] = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'codabar', 'itf'];
const FRAME_MS = 250;

function detectorCtor(): DetectorCtor | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

/**
 * Định dạng mã vận đơn trình duyệt này đọc được bằng camera (getUserMedia + BarcodeDetector). Safari và Firefox chưa có BarcodeDetector; một số
 * máy Android có API nhưng không đọc được định dạng nào (thiếu Google Play Services), mở camera ra sẽ im lặng, nên phải hỏi định dạng hỗ trợ.
 */
export async function claimScanFormats(): Promise<string[]> {
  const ctor = detectorCtor();
  if (!ctor || typeof navigator === 'undefined' || typeof navigator.mediaDevices?.getUserMedia !== 'function') return [];
  try {
    const supported = (await ctor.getSupportedFormats?.()) ?? [];
    return CLAIM_BARCODE_FORMATS.filter((f) => supported.includes(f));
  } catch {
    return [];
  }
}

/** Định dạng quét được; chỉ biết sau khi trang chạy trên trình duyệt, để bản dựng sẵn trên máy chủ và lần vẽ đầu giống nhau (nút ẩn). */
export function useClaimScanFormats(): string[] {
  const [formats, setFormats] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void claimScanFormats().then((f) => alive && setFormats(f));
    return () => {
      alive = false;
    };
  }, []);
  return formats;
}

function makeDetector(formats: readonly string[]): Detector {
  const Ctor = detectorCtor()!;
  try {
    return new Ctor({ formats: [...formats] });
  } catch {
    return new Ctor();
  }
}

/**
 * Nút "Quét mã trên nhãn" của web `/quet-ma` (W44): mở camera sau trong một Sheet, đọc mã vạch hoặc QR trên phiếu giao hàng, gọi `onCode` với mã
 * vận đơn đầu tiên đọc được (cùng luật `extractClaimCode` với Mini App). Quét phải thẻ Tubu hay mã không phải mã vận đơn thì nhắc trong Sheet và
 * quét tiếp; camera bị chặn thì đóng Sheet và báo qua `onFail`.
 */
export function ClaimScanButton({
  formats,
  onCode,
  onFail,
  primary,
}: {
  formats: readonly string[];
  onCode: (code: string) => void;
  onFail: (text: string) => void;
  /** Một nút chính trên màn: khi mã đã sẵn hay vừa gửi xong thì nút quét lùi về nút phụ. */
  primary: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;
  const formatsRef = useRef(formats);
  formatsRef.current = formats;

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        const video = videoRef.current;
        if (stopped || !video) {
          stop();
          return;
        }
        video.srcObject = stream;
        await Promise.resolve(video.play()).catch(() => undefined);
        const detector = makeDetector(formatsRef.current);
        let busy = false;
        timer = setInterval(() => {
          if (busy || stopped) return;
          busy = true;
          detector
            .detect(video)
            .then((found) => {
              if (stopped) return;
              let cardOnly = false;
              for (const f of found) {
                const parsed = extractClaimCode(f.rawValue ?? '');
                if ((parsed.kind === 'code' || parsed.kind === 'card_link') && parsed.code) {
                  stop();
                  setOpen(false);
                  onCodeRef.current(parsed.code);
                  return;
                }
                if (parsed.kind === 'card_link') cardOnly = true;
              }
              if (found.length > 0) setHint(cardOnly ? MARKETPLACE_CLAIM_COPY.scanCardLink : MARKETPLACE_CLAIM_COPY.scanNoCode);
            })
            // Khung hình chưa sẵn sàng thì ném lỗi; thử lại ở nhịp sau.
            .catch(() => undefined)
            .finally(() => {
              busy = false;
            });
        }, FRAME_MS);
      } catch (e) {
        if (stopped) return;
        stop();
        setOpen(false);
        // Quyền camera bị chặn thì thử lại vẫn lỗi y như cũ: nói khách phải cho phép camera.
        onFailRef.current((e as { name?: string } | null)?.name === 'NotAllowedError' ? WEB.cameraDenied : WEB.scanFailed);
      }
    })();
    return stop;
  }, [open]);

  return (
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
