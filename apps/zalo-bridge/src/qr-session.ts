export type QrStatus = 'IDLE' | 'WAITING_SCAN' | 'SCANNED' | 'SUCCESS' | 'EXPIRED' | 'FAILED';

export interface QrState {
  status: QrStatus;
  image?: string;
  displayName?: string;
}

export interface QrEventLike {
  type: number;
  data?: { image?: string; display_name?: string } | null;
}

export const idleQr = (): QrState => ({ status: 'IDLE' });

// Số kiểu khớp LoginQRCallbackEventType trong node_modules/zca-js/dist/apis/loginQR.d.ts:3-9.
export function applyQrEvent(s: QrState, e: QrEventLike): QrState {
  switch (e.type) {
    case 0: {
      const raw = e.data?.image ?? '';
      const image = raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`;
      return { status: 'WAITING_SCAN', image };
    }
    case 1:
      return { status: 'EXPIRED' };
    case 2:
      return { ...s, status: 'SCANNED', displayName: e.data?.display_name };
    case 3:
      return { status: 'FAILED' };
    case 4:
      return { ...s, status: 'SUCCESS' };
    default:
      return s;
  }
}
