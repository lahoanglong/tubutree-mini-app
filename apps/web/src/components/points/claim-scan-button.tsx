'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Flashlight, FlashlightOff, Keyboard, ScanLine } from 'lucide-react';
import { extractClaimCode } from '@tubutree/app-core/claim-code';
import { MARKETPLACE_CLAIM_COPY, MARKETPLACE_CLAIM_WEB_COPY as WEB } from '@tubutree/app-core/marketplace-claim-copy';
import { Button } from '@/components/mini/button';
import { useCameraAvailable, useCameraScan, usePhotoScan, type ScanFormat } from '@/lib/code-scan';

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

type CameraState = 'idle' | 'starting' | 'live' | 'denied' | 'failed';

/** Máy cho bật đèn pin của camera sau (Chrome Android); Safari iPhone không có `torch` nên nút đèn không hiện. */
function torchCapable(track: MediaStreamTrack): boolean {
  try {
    return (track.getCapabilities?.() as { torch?: boolean } | undefined)?.torch === true;
  } catch {
    return false;
  }
}

/**
 * Trình duyệt đã cho quyền camera từ trước (Permissions API): mở camera ngay khi vào màn, không cần chạm. Chưa hỏi, bị chặn hay máy không có API
 * (WebView Zalo trên iPhone) thì chờ khách chạm "Bật camera quét ngay": hộp xin quyền chỉ hiện sau cú chạm, không bật lên giữa lúc khách đang đọc.
 */
async function cameraGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: 'camera' as PermissionName });
    return status?.state === 'granted';
  } catch {
    return false;
  }
}

/**
 * Khung quét camera của web `/quet-ma` (W46, camera trước): khung tối 4:3 có góc ngắm ngay đầu thẻ gửi mã, đọc mã vạch hoặc QR trên phiếu giao
 * hàng và gọi `onCode` ngay khi đọc được (thẻ gửi mã tự gửi, không cần bấm thêm). Quyền camera đã có thì tự mở; chưa có thì nút "Bật camera quét
 * ngay" giữa khung. Máy cho bật đèn pin thì có nút đèn ở góc khung. Dưới khung là hai lối phụ: chụp/chọn ảnh (WebView chặn camera) và nhập mã
 * thủ công. Quét phải thẻ Tubu hay mã không phải mã vận đơn thì nhắc trong khung và quét tiếp; camera bị chặn hay hỏng thì nói trong khung.
 * `paused` tắt camera (đang gửi, đang hỏi 4 số cuối); `restartKey` đổi thì mở lại camera ("Quét đơn khác").
 */
export function ClaimScanner({
  onCode,
  onFail,
  onManual,
  manualOpen,
  primary,
  paused,
  busy,
  autoStart,
  restartKey,
}: {
  onCode: (code: string) => void;
  onFail: (text: string) => void;
  onManual: () => void;
  manualOpen: boolean;
  /** Một nút chính trên màn: khi mã đã sẵn hay vừa gửi xong thì nút bật camera lùi về nút phụ. */
  primary: boolean;
  paused: boolean;
  busy: boolean;
  /** Chỉ đọc ở lần dựng đầu: false khi màn mở với mã điền sẵn (`?code=`), để camera không giành chỗ của nút "Tích điểm". */
  autoStart: boolean;
  restartKey: number;
}) {
  const camera = useCameraAvailable();
  const [want, setWant] = useState(false);
  const [state, setState] = useState<CameraState>('idle');
  const [hint, setHint] = useState<string | null>(null);
  const [track, setTrack] = useState<MediaStreamTrack | null>(null);
  const [torch, setTorch] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const autoStartAtMount = useRef(autoStart);
  const wantRef = useRef(want);
  wantRef.current = want;

  const start = () => {
    setHint(null);
    setState('starting');
    setWant(true);
  };

  useEffect(() => {
    if (!autoStartAtMount.current || !camera) return;
    let alive = true;
    void cameraGranted().then((granted) => {
      if (!alive || !granted) return;
      setState('starting');
      setWant(true);
    });
    return () => {
      alive = false;
    };
  }, [camera]);

  const firstRestart = useRef(restartKey);
  useEffect(() => {
    if (restartKey === firstRestart.current || !camera) return;
    setHint(null);
    setState('starting');
    setWant(true);
  }, [restartKey, camera]);

  useCameraScan({
    open: want && !paused,
    videoRef,
    formats: CLAIM_BARCODE_FORMATS,
    onTrack: (t) => {
      setTrack(t);
      setTorch(false);
      // Camera tắt vì đang gửi hay đang hỏi 4 số (khách vẫn muốn quét): giữ trạng thái đang mở để khung không chớp nút bật camera.
      if (t) setState('live');
      else setState((s) => (s === 'live' ? (wantRef.current ? 'starting' : 'idle') : s));
    },
    onValues: (values) => {
      const r = claimCodeOf(values);
      if ('hint' in r) {
        setHint(r.hint);
        return false;
      }
      setHint(null);
      wantRef.current = false;
      setWant(false);
      onCode(r.code);
      return true;
    },
    onError: (kind) => {
      setWant(false);
      setState(kind === 'denied' ? 'denied' : 'failed');
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

  const pickPhoto = () => {
    // Bộ chọn ảnh của iPhone mở camera riêng: nhả camera của trang trước.
    setWant(false);
    setState('idle');
    photo.pick();
  };

  const toggleTorch = () => {
    if (!track) return;
    const next = !torch;
    track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] }).then(
      () => setTorch(next),
      () => undefined,
    );
  };

  const live = state === 'live' && !paused;
  const message = !camera ? WEB.cameraUnavailable : state === 'denied' ? WEB.cameraDenied : state === 'failed' ? WEB.cameraUnavailable : null;
  const showStart = !busy && !live && state !== 'starting';

  return (
    <div className="tubu-scanner" data-testid="claim-scanner">
      <div className="tubu-scanner__frame" data-live={live || undefined}>
        <video ref={videoRef} playsInline muted aria-label={WEB.cameraLabel} className="tubu-scanner__video" />
        <span aria-hidden="true" className="tubu-scanner__corner tubu-scanner__corner--tl" />
        <span aria-hidden="true" className="tubu-scanner__corner tubu-scanner__corner--tr" />
        <span aria-hidden="true" className="tubu-scanner__corner tubu-scanner__corner--bl" />
        <span aria-hidden="true" className="tubu-scanner__corner tubu-scanner__corner--br" />
        {live && !busy && <p className="tubu-scanner__hint">{WEB.viewfinderHint}</p>}
        {busy && (
          <div className="tubu-scanner__center" role="status" data-testid="claim-scanner-sending">
            <p className="tubu-scanner__text">{WEB.sending}</p>
          </div>
        )}
        {showStart && (
          <div className="tubu-scanner__center">
            {message ? (
              <p role={camera ? 'alert' : undefined} className="tubu-scanner__text" data-testid="claim-scanner-message">
                {message}
              </p>
            ) : (
              <p className="tubu-scanner__text">{WEB.viewfinderHint}</p>
            )}
            {camera ? (
              <Button size="lg" variant={primary ? 'primary' : 'secondary'} icon={ScanLine} onPress={start}>
                {WEB.cameraStart}
              </Button>
            ) : (
              <div data-testid="claim-photo-scan">
                <Button size="lg" variant={primary ? 'primary' : 'secondary'} icon={Camera} loading={photo.reading} onPress={pickPhoto}>
                  {WEB.photoCta}
                </Button>
              </div>
            )}
          </div>
        )}
        {live && track && torchCapable(track) && (
          <button
            type="button"
            className="tubu-scanner__torch"
            aria-pressed={torch}
            aria-label={torch ? WEB.torchOff : WEB.torchOn}
            data-testid="claim-scanner-torch"
            onClick={toggleTorch}
          >
            {torch ? <FlashlightOff aria-hidden="true" /> : <Flashlight aria-hidden="true" />}
          </button>
        )}
        {hint && live && (
          <p role="alert" className="tubu-scanner__alert">
            {hint}
          </p>
        )}
      </div>
      <div className="tubu-scanner__pills">
        {camera && (
          <button type="button" data-testid="claim-photo-scan" className="tubu-scanner__pill" aria-busy={photo.reading || undefined} onClick={pickPhoto}>
            <Camera aria-hidden="true" />
            {photo.reading ? WEB.photoReading : WEB.photoCta}
          </button>
        )}
        <button type="button" data-testid="claim-manual-toggle" className="tubu-scanner__pill" aria-expanded={manualOpen} onClick={onManual}>
          <Keyboard aria-hidden="true" />
          {WEB.manualCta}
        </button>
      </div>
      <input {...photo.inputProps} data-testid="claim-photo-input" />
    </div>
  );
}
