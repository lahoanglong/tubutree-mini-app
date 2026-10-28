'use client';

import { useEffect, useRef, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { extractWasteLookupCode } from '@tubutree/app-core/waste-code-input';
import { Sheet } from '@/components/ui/sheet';
import { ui } from '@/lib/guest-ui';

type Detector = { detect(source: HTMLVideoElement): Promise<{ rawValue?: string }[]> };
type DetectorCtor = new (opts?: { formats?: string[] }) => Detector;

const NOT_WASTE_CODE = 'Mã QR này không phải mã Đổi rác. Hãy quét lại hoặc gõ mã bên dưới.';
const SCAN_FAILED = 'Chưa quét được. Hãy thử lại hoặc gõ mã bên dưới.';
const FRAME_MS = 250;

function detectorCtor(): DetectorCtor | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

/** Trình duyệt có đủ BarcodeDetector và camera; Safari và Firefox chưa có BarcodeDetector nên nút quét bị ẩn, chỉ còn ô gõ. */
export function barcodeScanSupported(): boolean {
  return detectorCtor() !== null && typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

/** Chỉ biết sau khi trang chạy trên trình duyệt, để bản dựng sẵn trên máy chủ và lần vẽ đầu giống nhau. */
export function useBarcodeScan(): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported(barcodeScanSupported()), []);
  return supported;
}

function makeDetector(): Detector {
  const Ctor = detectorCtor()!;
  try {
    return new Ctor({ formats: ['qr_code'] });
  } catch {
    return new Ctor();
  }
}

/** Quét mã QR của khách bằng camera trình duyệt, không thêm thư viện. Gọi `onCode` với mã TR-/QG- đầu tiên đọc được. */
export function ScanCodeButton({
  onCode,
  onFail,
  disabled,
}: {
  onCode: (code: string) => void;
  onFail: (text: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;

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
        const detector = makeDetector();
        let busy = false;
        timer = setInterval(() => {
          if (busy || stopped) return;
          busy = true;
          detector
            .detect(video)
            .then((found) => {
              if (stopped) return;
              for (const f of found) {
                const code = f.rawValue ? extractWasteLookupCode(f.rawValue) : null;
                if (code) {
                  stop();
                  setOpen(false);
                  onCodeRef.current(code);
                  return;
                }
              }
              if (found.length > 0) setHint(NOT_WASTE_CODE);
            })
            // Khung hình chưa sẵn sàng thì ném lỗi; thử lại ở nhịp sau.
            .catch(() => undefined)
            .finally(() => {
              busy = false;
            });
        }, FRAME_MS);
      } catch {
        if (stopped) return;
        stop();
        setOpen(false);
        onFailRef.current(SCAN_FAILED);
      }
    })();
    return stop;
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={`${ui.btnPrimary} w-full gap-2`}
        disabled={disabled}
        onClick={() => {
          setHint(null);
          setOpen(true);
        }}
      >
        <ScanLine className="h-5 w-5" aria-hidden="true" />
        Quét mã của khách
      </button>
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
