import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type RefObject } from 'react';
import type { CanvasDecoder } from './code-scan-zxing';

/**
 * Quét mã vạch/QR trên web (W45): camera trực tiếp và chụp/chọn ảnh, cho mọi trình duyệt.
 * - Có `BarcodeDetector` đọc được định dạng cần (Chrome/Android): dùng nó trước, nhanh và không tải thêm gì.
 * - Không có (Safari và mọi WebView trên iPhone: Zalo, Facebook, TikTok) hoặc nó không thấy gì ở khung hình đó: đọc bằng ZXing
 *   (`code-scan-zxing.ts`), nạp lười bằng `import()` ở lần đầu cần, tức là chỉ sau khi khách mở khung quét hay chọn ảnh.
 * WebView chặn camera (`getUserMedia`) vẫn còn lối chụp/chọn ảnh qua `<input type="file">`, ảnh đọc bằng cùng bộ đọc.
 */

export type ScanFormat = 'qr_code' | 'code_128' | 'code_39' | 'ean_13' | 'ean_8' | 'codabar' | 'itf';

type NativeDetector = { detect(source: ImageBitmapSource): Promise<{ rawValue?: string }[]> };
type NativeCtor = (new (opts?: { formats?: string[] }) => NativeDetector) & { getSupportedFormats?: () => Promise<string[]> };

const FRAME_MS = 250;
/**
 * Máy có BarcodeDetector mà khung hình không thấy gì: chỉ 1 trong 4 nhịp (khoảng 1 lần/giây) đọc thêm bằng ZXing. ZXing chạy trên luồng
 * chính, mỗi nhịp đều chạy thì máy Android yếu giật khung quét.
 */
const NATIVE_FALLBACK_EVERY = 4;
/** Khung hình video đọc ở độ phân giải gốc tới 1280px (mã vạch một chiều cần đủ điểm ảnh mỗi vạch). */
const FRAME_MAX_SIDE = 1280;
/** Ảnh chụp 12MP: thử ở vài cỡ, nhỏ dần (mã to trong ảnh đọc tốt hơn khi thu nhỏ, mã nhỏ cần cỡ lớn). */
const PHOTO_MAX_SIDES = [1600, 1024, 640] as const;

/** Bộ đọc JS không tải được (mất mạng giữa chừng): khung quét không thể đọc gì, phải báo khách. */
export class ScanDecoderUnavailableError extends Error {}

function nativeCtor(): NativeCtor | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as unknown as { BarcodeDetector?: NativeCtor }).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

/**
 * BarcodeDetector chỉ với các định dạng máy đọc được. Một số máy Android có API mà không đọc được định dạng nào (thiếu Google Play
 * Services): coi như không có, để ZXing đọc thay.
 */
async function nativeDetector(formats: readonly ScanFormat[]): Promise<NativeDetector | null> {
  const Ctor = nativeCtor();
  if (!Ctor) return null;
  try {
    const supported = (await Ctor.getSupportedFormats?.()) ?? [];
    const usable = formats.filter((f) => supported.includes(f));
    if (usable.length === 0) return null;
    try {
      return new Ctor({ formats: usable });
    } catch {
      return new Ctor();
    }
  } catch {
    return null;
  }
}

/** Máy có API camera. Không có (trang không an toàn, WebView cũ) thì chỉ còn chụp/chọn ảnh. */
export function cameraAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

const noSubscribe = () => () => undefined;

/** Bản dựng trên máy chủ và lần vẽ đầu coi như có camera (đa số máy); trình duyệt đọc lại sau khi hydrate nên không lệch HTML. */
export function useCameraAvailable(): boolean {
  return useSyncExternalStore(noSubscribe, cameraAvailable, () => true);
}

let zxingModule: Promise<typeof import('./code-scan-zxing')> | null = null;
function loadZxing(): Promise<typeof import('./code-scan-zxing')> {
  // Lỗi tải (mất mạng) không được giữ lại: lần mở khung quét sau tải lại.
  zxingModule ??= import('./code-scan-zxing').catch((e: unknown) => {
    zxingModule = null;
    throw e;
  });
  return zxingModule;
}

const valuesOf = (found: { rawValue?: string }[]): string[] => found.map((f) => f.rawValue ?? '').filter((v) => v !== '');

interface LoadedImage {
  source: CanvasImageSource & ImageBitmapSource;
  width: number;
  height: number;
  release: () => void;
}

async function loadImage(file: Blob): Promise<LoadedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch {
      // Safari cũ không giải được một số ảnh qua createImageBitmap: thử bằng <img>.
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    img.src = url;
    await img.decode();
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
}

export interface CodeReader {
  /** Đọc một khung hình video. Mảng rỗng: chưa thấy mã (thử ở nhịp sau). */
  readFrame(video: HTMLVideoElement): Promise<string[]>;
  /** Đọc một ảnh khách chụp hay chọn. Mảng rỗng: không thấy mã. Ảnh hỏng thì ném lỗi. */
  readImage(file: Blob): Promise<string[]>;
}

export function createCodeReader(formats: readonly ScanFormat[]): CodeReader {
  const native = nativeDetector(formats);
  let decoder: Promise<CanvasDecoder> | null = null;
  let tick = 0;
  let nativeMisses = 0;
  const fallback = (): Promise<CanvasDecoder> => {
    decoder ??= loadZxing().then(
      (m) => m.createDecoder(formats),
      () => {
        decoder = null;
        throw new ScanDecoderUnavailableError('zxing');
      },
    );
    return decoder;
  };
  return {
    async readFrame(video) {
      const n = await native;
      if (n) {
        // Khung hình chưa sẵn sàng thì BarcodeDetector ném lỗi: coi như chưa thấy.
        const found = valuesOf(await n.detect(video).catch(() => []));
        if (found.length > 0) return found;
        if (nativeMisses++ % NATIVE_FALLBACK_EVERY !== 0) return [];
      }
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return [];
      let d: CanvasDecoder;
      try {
        d = await fallback();
      } catch (e) {
        // Máy có BarcodeDetector thì vẫn quét tiếp bằng nó; không có thì khung quét vô dụng, báo khách.
        if (n) return [];
        throw e;
      }
      // Nhịp chẵn đọc thẳng, nhịp lẻ xoay 90°: nhãn cầm dọc hay ngang đều đọc được mà mỗi nhịp chỉ tốn một lần giải mã.
      return d.decodeSource(video, w, h, { rotate: tick++ % 2 === 1, tryHarder: false, maxSide: FRAME_MAX_SIDE });
    },
    async readImage(file) {
      const img = await loadImage(file);
      try {
        const n = await native;
        if (n) {
          const found = valuesOf(await n.detect(img.source).catch(() => []));
          if (found.length > 0) return found;
        }
        const d = await fallback();
        for (const maxSide of PHOTO_MAX_SIDES) {
          for (const rotate of [false, true]) {
            const found = d.decodeSource(img.source, img.width, img.height, { rotate, tryHarder: true, maxSide });
            if (found.length > 0) return found;
          }
        }
        return [];
      } finally {
        img.release();
      }
    },
  };
}

export type CameraScanError = 'denied' | 'failed';

/**
 * Vòng quét camera khi `open`: mở camera sau, cứ 250ms đọc một khung hình, gọi `onValues` với các chuỗi đọc được (trả true = đã dùng,
 * dừng camera). Đóng (`open` false) hay rời màn thì tắt camera. Quyền camera bị chặn: `onError('denied')`; lỗi khác hoặc bộ đọc không tải
 * được: `onError('failed')`. `onTrack` nhận track video khi hình đã lên (để bật đèn pin) và null khi camera tắt.
 */
export function useCameraScan(opts: {
  open: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  formats: readonly ScanFormat[];
  onValues: (values: string[]) => boolean;
  onError: (kind: CameraScanError) => void;
  onTrack?: (track: MediaStreamTrack | null) => void;
}): void {
  const { open, videoRef } = opts;
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let trackShown = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      if (trackShown) latest.current.onTrack?.(null);
    };
    const fail = (kind: CameraScanError) => {
      if (stopped) return;
      stop();
      latest.current.onError(kind);
    };
    void (async () => {
      try {
        if (!cameraAvailable()) throw new Error('no camera api');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        const video = videoRef.current;
        if (stopped || !video) {
          stop();
          return;
        }
        video.srcObject = stream;
        // WebView chặn phát video (NotAllowedError) thì khung quét chỉ là màn đen: báo khách dùng ảnh hay gõ mã. AbortError (đóng khung
        // giữa chừng) thì bỏ qua.
        const blocked = await Promise.resolve(video.play()).then(
          () => false,
          (e: unknown) => (e as { name?: string } | null)?.name === 'NotAllowedError',
        );
        if (blocked) {
          fail('failed');
          return;
        }
        if (stopped) return;
        const track = latest.current.onTrack ? stream.getVideoTracks()[0] : undefined;
        if (track && latest.current.onTrack) {
          trackShown = true;
          latest.current.onTrack(track);
        }
        const reader = createCodeReader(latest.current.formats);
        let busy = false;
        timer = setInterval(() => {
          if (busy || stopped) return;
          busy = true;
          reader
            .readFrame(video)
            .then((values) => {
              if (!stopped && values.length > 0 && latest.current.onValues(values)) stop();
            })
            .catch((e: unknown) => {
              if (e instanceof ScanDecoderUnavailableError) fail('failed');
            })
            .finally(() => {
              busy = false;
            });
        }, FRAME_MS);
      } catch (e) {
        // Quyền camera bị chặn thì thử lại vẫn lỗi y như cũ: nói khách phải cho phép camera.
        fail((e as { name?: string } | null)?.name === 'NotAllowedError' ? 'denied' : 'failed');
      }
    })();
    return stop;
  }, [open, videoRef]);
}

export type PhotoScanError = 'unreadable' | 'failed';

/**
 * Chụp/chọn ảnh mã: `pick()` mở bộ chọn ảnh của máy (camera sau nếu có), đọc ảnh bằng cùng bộ đọc với camera. `onValues` nhận các chuỗi
 * đọc được; không thấy mã hay ảnh hỏng: `onError('unreadable')`; bộ đọc không tải được: `onError('failed')`.
 */
export function usePhotoScan(opts: { formats: readonly ScanFormat[]; onValues: (values: string[]) => void; onError: (kind: PhotoScanError) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const busy = useRef(false);
  const latest = useRef(opts);
  latest.current = opts;

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Xoá giá trị để chọn lại đúng ảnh đó vẫn bắn change.
    e.target.value = '';
    if (!file || busy.current) return;
    busy.current = true;
    setReading(true);
    createCodeReader(latest.current.formats)
      .readImage(file)
      .then((values) => (values.length > 0 ? latest.current.onValues(values) : latest.current.onError('unreadable')))
      .catch((err: unknown) => latest.current.onError(err instanceof ScanDecoderUnavailableError ? 'failed' : 'unreadable'))
      .finally(() => {
        busy.current = false;
        setReading(false);
      });
  };

  return {
    reading,
    pick: () => {
      if (!busy.current) inputRef.current?.click();
    },
    inputProps: {
      ref: inputRef,
      type: 'file' as const,
      accept: 'image/*',
      capture: 'environment' as const,
      onChange,
      className: 'sr-only',
      tabIndex: -1,
      'aria-hidden': true as const,
    },
  };
}
