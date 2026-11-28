/**
 * Âm thanh ngắn của hai game thao tác, tổng hợp bằng WebAudio (không tải tệp âm thanh). Tắt được bằng một chạm, nhớ lựa chọn trên máy.
 * Mọi lỗi (trình duyệt không có WebAudio, WebView chặn, chưa có cử chỉ chạm) đều im lặng bỏ qua: âm thanh không bao giờ làm vỡ ván chơi.
 */
export type ArcadeSfx = 'merge' | 'combo' | 'win' | 'right' | 'wrong' | 'golden' | 'over';

type Wave = 'sine' | 'square' | 'triangle';
/** Mỗi tiếng là vài nốt: [tần số Hz, bắt đầu ms, dài ms, dạng sóng]. */
type Note = readonly [number, number, number, Wave];

/** Phần WebAudio cần dùng (app-core không nạp thư viện kiểu DOM). */
interface AudioParamLike {
  value: number;
  setValueAtTime(v: number, t: number): unknown;
  exponentialRampToValueAtTime(v: number, t: number): unknown;
}
interface AudioNodeLike {
  connect(dest: unknown): unknown;
}
interface OscillatorLike extends AudioNodeLike {
  type: string;
  frequency: AudioParamLike;
  start(t: number): void;
  stop(t: number): void;
}
interface GainLike extends AudioNodeLike {
  gain: AudioParamLike;
}
interface AudioContextLike {
  state: string;
  currentTime: number;
  destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
}

export const ARCADE_SFX_NOTES: Record<ArcadeSfx, readonly Note[]> = {
  merge: [[660, 0, 70, 'triangle']],
  combo: [
    [660, 0, 70, 'triangle'],
    [880, 60, 90, 'triangle'],
  ],
  right: [[740, 0, 60, 'sine']],
  golden: [
    [880, 0, 70, 'sine'],
    [1175, 60, 70, 'sine'],
    [1568, 120, 110, 'sine'],
  ],
  wrong: [[180, 0, 140, 'square']],
  win: [
    [523, 0, 110, 'triangle'],
    [659, 100, 110, 'triangle'],
    [784, 200, 110, 'triangle'],
    [1047, 300, 220, 'triangle'],
  ],
  over: [
    [392, 0, 140, 'triangle'],
    [294, 130, 220, 'triangle'],
  ],
};

export const ARCADE_SOUND_KEY = 'tubu.game.sound';
const GAIN = 0.06;

export interface ArcadeSoundStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Mặc định bật; khách đã tắt (`'off'`) thì giữ tắt. Kho bị chặn thì bật. */
export function readSoundOn(storage: ArcadeSoundStorage | null): boolean {
  try {
    return storage?.getItem(ARCADE_SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveSoundOn(storage: ArcadeSoundStorage | null, on: boolean): void {
  try {
    storage?.setItem(ARCADE_SOUND_KEY, on ? 'on' : 'off');
  } catch {
    /* kho bị chặn: chỉ giữ trong phiên */
  }
}

export interface ArcadeSynth {
  play(kind: ArcadeSfx): void;
  close(): void;
}

type AudioCtor = new () => AudioContextLike;

/** Bộ phát lười: chỉ tạo `AudioContext` ở lần phát đầu (lần chạm đầu của ván), không tạo khi đang tắt tiếng. */
export function createArcadeSynth(isOn: () => boolean): ArcadeSynth {
  let ctx: AudioContextLike | null = null;
  let broken = false;
  const context = (): AudioContextLike | null => {
    if (ctx || broken) return ctx;
    try {
      const g = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
      const Ctor = g.AudioContext ?? g.webkitAudioContext;
      if (!Ctor) {
        broken = true;
        return null;
      }
      ctx = new Ctor();
    } catch {
      broken = true;
    }
    return ctx;
  };
  return {
    play(kind) {
      if (!isOn()) return;
      const c = context();
      if (!c) return;
      try {
        if (c.state === 'suspended') void c.resume().catch(() => undefined);
        const t0 = c.currentTime;
        for (const [freq, at, dur, type] of ARCADE_SFX_NOTES[kind]) {
          const osc = c.createOscillator();
          const gain = c.createGain();
          osc.type = type;
          osc.frequency.value = freq;
          const start = t0 + at / 1000;
          const end = start + dur / 1000;
          gain.gain.setValueAtTime(GAIN, start);
          gain.gain.exponentialRampToValueAtTime(0.0001, end);
          osc.connect(gain);
          gain.connect(c.destination);
          osc.start(start);
          osc.stop(end + 0.02);
        }
      } catch {
        /* thiết bị từ chối phát: bỏ qua */
      }
    },
    close() {
      const c = ctx;
      ctx = null;
      if (c) void c.close().catch(() => undefined);
    },
  };
}
