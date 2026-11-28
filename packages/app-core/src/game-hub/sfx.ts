/**
 * Âm thanh nhỏ của Vườn Xanh (tưới, chạm thẻ game, thắng ván, thu hoạch), tổng hợp bằng WebAudio nên không tải tệp âm thanh nào. Chỉ phát sau một
 * thao tác của khách. Khách tắt bằng nút "Âm thanh trò chơi"; lựa chọn lưu trên máy (`SFX_MUTED_KEY`). Lõi không chạm `window`: app truyền cách tạo
 * AudioContext và kho lưu (PlatformBridge của từng nền tảng), lỗi nào cũng nuốt im vì âm thanh không bao giờ được làm hỏng thao tác chính.
 */
export type SfxCue = 'water' | 'pop' | 'win' | 'harvest';

interface Note {
  freq: number;
  /** Giây tính từ lúc phát. */
  at: number;
  dur: number;
  wave: 'sine' | 'triangle';
  gain: number;
  slideTo?: number;
}

const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;
const G4 = 392;

/** Âm lượng thấp (≤ 0,07): đủ nghe khi cầm máy, không giật mình nơi đông người. */
export const SFX_CUES: Record<SfxCue, readonly Note[]> = {
  water: [
    { freq: 880, at: 0, dur: 0.09, wave: 'sine', gain: 0.06, slideTo: 1320 },
    { freq: 1175, at: 0.08, dur: 0.08, wave: 'sine', gain: 0.05, slideTo: 1568 },
    { freq: 988, at: 0.16, dur: 0.1, wave: 'sine', gain: 0.045, slideTo: 1480 },
  ],
  pop: [{ freq: 520, at: 0, dur: 0.07, wave: 'triangle', gain: 0.06, slideTo: 880 }],
  win: [
    { freq: C5, at: 0, dur: 0.16, wave: 'triangle', gain: 0.06 },
    { freq: E5, at: 0.09, dur: 0.16, wave: 'triangle', gain: 0.06 },
    { freq: G5, at: 0.18, dur: 0.16, wave: 'triangle', gain: 0.06 },
    { freq: C6, at: 0.27, dur: 0.3, wave: 'triangle', gain: 0.055 },
  ],
  harvest: [
    { freq: G4, at: 0, dur: 0.14, wave: 'triangle', gain: 0.06 },
    { freq: C5, at: 0.1, dur: 0.14, wave: 'triangle', gain: 0.06 },
    { freq: E5, at: 0.2, dur: 0.14, wave: 'triangle', gain: 0.06 },
    { freq: G5, at: 0.3, dur: 0.14, wave: 'triangle', gain: 0.06 },
    { freq: C6, at: 0.4, dur: 0.45, wave: 'sine', gain: 0.05 },
    { freq: G5, at: 0.4, dur: 0.45, wave: 'sine', gain: 0.03 },
  ],
};

/** Phần của WebAudio mà lõi dùng (khai cấu trúc để lõi không cần thư viện DOM; AudioContext thật khớp kiểu này). */
export interface SfxParam {
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
}
export interface SfxNode {
  connect(dest: never): unknown;
}
export interface SfxOscillator extends SfxNode {
  type: string;
  frequency: SfxParam;
  start(when: number): void;
  stop(when: number): void;
}
export interface SfxGain extends SfxNode {
  gain: SfxParam;
}
export interface SfxAudio {
  readonly currentTime: number;
  readonly destination: unknown;
  readonly state?: string;
  resume?(): Promise<void>;
  createOscillator(): SfxOscillator;
  createGain(): SfxGain;
}

export interface SfxStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SFX_MUTED_KEY = 'tubu.sfx.muted';

export interface Sfx {
  play(cue: SfxCue): boolean;
  isMuted(): boolean;
  setMuted(muted: boolean): void;
  subscribe(listener: () => void): () => void;
  /** Tạo hoặc đánh thức AudioContext ngay trong một cú chạm (xem `unlockSfxOnGesture`); đang tắt tiếng thì không làm gì. */
  unlock(): void;
}

const SILENT = 0.0001;

/**
 * `audio` chỉ được gọi một lần, ở cú chạm đầu tiên (`unlockSfxOnGesture`) hoặc lần phát đầu: trình duyệt treo AudioContext tạo ngoài thao tác của khách. Khách chưa chọn lần nào thì
 * mặc định có âm, trừ máy bật giảm chuyển động (`reducedMotion`): khi đó mặc định im, cùng luật với chùm lấp lánh; khách bật lại thì lựa chọn được nhớ.
 */
export function createSfx(deps: { audio: () => SfxAudio | null; storage: () => SfxStorage | null; reducedMotion?: () => boolean }): Sfx {
  let ctx: SfxAudio | null = null;
  let muted: boolean | null = null;
  const listeners = new Set<() => void>();

  const prefersQuiet = () => {
    try {
      return deps.reducedMotion?.() === true;
    } catch {
      return false;
    }
  };

  const isMuted = () => {
    if (muted === null) {
      let saved: string | null = null;
      try {
        saved = deps.storage()?.getItem(SFX_MUTED_KEY) ?? null;
      } catch {
        saved = null;
      }
      muted = saved === '1' || (saved !== '0' && prefersQuiet());
    }
    return muted;
  };

  const wake = () => {
    ctx ??= deps.audio();
    if (ctx?.state === 'suspended') ctx.resume?.().catch(() => undefined);
    return ctx;
  };

  const tone = (audio: SfxAudio, n: Note, t0: number) => {
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    const start = t0 + n.at;
    const end = start + n.dur;
    osc.type = n.wave;
    osc.frequency.setValueAtTime(n.freq, start);
    if (n.slideTo) osc.frequency.exponentialRampToValueAtTime(n.slideTo, end);
    amp.gain.setValueAtTime(SILENT, start);
    amp.gain.linearRampToValueAtTime(n.gain, start + 0.012);
    amp.gain.exponentialRampToValueAtTime(SILENT, end);
    osc.connect(amp as never);
    amp.connect(audio.destination as never);
    osc.start(start);
    osc.stop(end + 0.02);
  };

  return {
    isMuted,
    setMuted(next) {
      muted = next;
      try {
        deps.storage()?.setItem(SFX_MUTED_KEY, next ? '1' : '0');
      } catch {
        /* không lưu được (chế độ riêng tư): giữ trong bộ nhớ của phiên */
      }
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    unlock() {
      if (isMuted()) return;
      try {
        wake();
      } catch {
        /* máy không có WebAudio: im lặng */
      }
    },
    play(cue) {
      if (isMuted()) return false;
      try {
        const audio = wake();
        if (!audio) return false;
        const t0 = audio.currentTime + 0.01;
        for (const n of SFX_CUES[cue]) tone(audio, n, t0);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Sự kiện trình duyệt tính là thao tác của khách: iOS chỉ nhận `touchend`, Chrome nhận `pointerup` khi chạm, bàn phím là `keydown`. */
export const SFX_GESTURE_EVENTS = ['pointerup', 'touchend', 'keydown'] as const;

export interface SfxGestureTarget {
  addEventListener(type: string, listener: () => void, options: { capture: boolean; passive: boolean }): void;
}

/**
 * Tiếng tưới, thắng ván, thu hoạch phát sau khi API trả về, tức là ngoài cú chạm: iOS giữ AudioContext tạo lúc đó ở trạng thái treo và từ chối
 * `resume()` không kèm thao tác. Đánh thức nó ở mọi cú chạm (bắt ở pha capture) để các tiếng đến sau vẫn nghe được.
 */
export function unlockSfxOnGesture(target: SfxGestureTarget, sfx: Pick<Sfx, 'unlock'>): void {
  const unlock = () => sfx.unlock();
  for (const type of SFX_GESTURE_EVENTS) target.addEventListener(type, unlock, { capture: true, passive: true });
}
