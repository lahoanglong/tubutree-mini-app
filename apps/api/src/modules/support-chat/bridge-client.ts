import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ZaloBridgeHealth } from '@tubutree/shared-types';
import type { Env } from '../../config/env.validation';

const SEND_TIMEOUT_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface BridgeFailure {
  ok: false;
  retry: boolean;
  unknown: boolean;
  code: string;
  message: string;
}
export type BridgeResult<T> = { ok: true; data: T } | BridgeFailure;
export type BridgeSendResult = { ok: true; msgId: string } | BridgeFailure;

export interface BridgeGroup {
  id: string;
  name: string;
  memberCount: number;
}
export interface BridgeQrStatus {
  status: 'IDLE' | 'WAITING_SCAN' | 'SCANNED' | 'SUCCESS' | 'EXPIRED' | 'FAILED';
  image?: string;
  displayName?: string;
}

const NOT_CONFIGURED: BridgeFailure = { ok: false, retry: false, unknown: false, code: 'BRIDGE_NOT_CONFIGURED', message: 'Chưa cấu hình ZALO_BRIDGE_URL' };

/** Gọi cầu nối Zalo. Không bao giờ ghi nội dung tin hay bí mật vào log. */
@Injectable()
export class BridgeClient {
  private readonly logger = new Logger(BridgeClient.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async health(): Promise<ZaloBridgeHealth | null> {
    const r = await this.call<ZaloBridgeHealth>('GET', '/health');
    return r.ok ? r.data : null;
  }

  qrStart() {
    return this.call<{ status: 'WAITING_SCAN'; image: string }>('POST', '/qr/start');
  }
  qrStatus() {
    return this.call<BridgeQrStatus>('GET', '/qr/status');
  }
  logout() {
    return this.call<{ ok: true }>('POST', '/logout');
  }
  reconnect() {
    return this.call<{ ok: true }>('POST', '/reconnect');
  }
  groups() {
    return this.call<{ groups: BridgeGroup[] }>('GET', '/groups');
  }
  setGroup(groupId: string | null) {
    return this.call<{ groupId: string | null }>('PUT', '/config', { groupId });
  }

  /** Cùng `key` thì cầu nối không đăng đôi, nên gửi lại khi không rõ kết quả là an toàn. */
  async send(key: string, text: string): Promise<BridgeSendResult> {
    const r = await this.call<{ msgId?: unknown }>('POST', '/send', { idempotencyKey: key, text }, SEND_TIMEOUT_MS);
    if (!r.ok) return r;
    if (typeof r.data.msgId !== 'string' || r.data.msgId === '') {
      return { ok: false, retry: false, unknown: true, code: 'BAD_RESPONSE', message: 'Cầu nối trả 2xx nhưng không có msgId' };
    }
    return { ok: true, msgId: r.data.msgId };
  }

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<BridgeResult<T>> {
    const base = this.config.get('ZALO_BRIDGE_URL', { infer: true });
    if (!base) return NOT_CONFIGURED;
    const secret = this.config.get('ZALO_BRIDGE_SECRET', { infer: true });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base.replace(/\/+$/, '')}${path}`, {
        method,
        headers: { Authorization: `Bearer ${secret}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok) return { ok: true, data: json as T };
      const code = typeof json.code === 'string' ? json.code : `HTTP_${res.status}`;
      const message = typeof json.message === 'string' ? json.message : `Cầu nối trả ${res.status}`;
      // 409 NO_GROUP và 502 SEND_FAILED thử lại không giúp; mất kết nối tạm và 5xx khác thì có.
      const retry = res.status === 409 ? code === 'NOT_CONNECTED' : res.status >= 500 && res.status !== 502;
      return { ok: false, retry, unknown: false, code, message };
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError' || (e as Error).name === 'TimeoutError';
      this.logger.warn(`Cầu nối ${method} ${path} ${aborted ? 'hết giờ' : 'lỗi mạng'}`);
      return aborted
        ? { ok: false, retry: false, unknown: true, code: 'TIMEOUT', message: `Hết ${timeoutMs / 1000} giây chờ cầu nối` }
        : { ok: false, retry: true, unknown: false, code: 'NETWORK', message: 'Không gọi được cầu nối' };
    } finally {
      clearTimeout(timer);
    }
  }
}
