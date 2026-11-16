import { applyDecorators, Inject, Injectable, Logger, Optional, UnauthorizedException, UseGuards, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { readMssEnv } from './mss-config';
import { MSS_ENV_READER, type MssEnvReader } from './mss-flags';
import { MSS_KEY_ID_HEADER, MSS_SIGNATURE_HEADER, MSS_TIMESTAMP_HEADER, verifyMssSignature } from './mss-signer';

/** Thân lỗi theo hợp đồng commerce mục 5; không nói sai ở đâu (thiếu header, sai chữ ký hay lệch giờ đều như nhau). */
export const MSS_UNAUTHORIZED_BODY = { error: 'unauthorized', message: 'unauthorized' } as const;

const KEY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

interface MssInboundRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  /** Byte gốc do parser tầng webhook giữ (common/body-limits.ts, nhóm `/api/integrations/mss/*`). */
  rawBody?: Buffer;
}

function header(req: MssInboundRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? undefined : v;
}

function declaresBody(req: MssInboundRequest): boolean {
  const len = Number(header(req, 'content-length') ?? 0);
  return (Number.isFinite(len) && len > 0) || header(req, 'transfer-encoding') !== undefined;
}

/**
 * Cổng cho mọi route MSS gọi vào Tubu (`/api/integrations/mss/*`): HMAC-SHA256 trên thân thô, header `X-Mss-Key-Id`,
 * `X-Mss-Timestamp`, `X-Mss-Signature: v1=<hex>`, cửa sổ ±300 giây, nhận bí mật hiện tại và bí mật trước (xoay khoá).
 * Thiếu `MSS_INBOUND_SECRET` thì từ chối mọi yêu cầu. Chống phát lại trong cửa sổ là việc của handler (khoá idempotency theo
 * `event_id`/`sequence` của từng hợp đồng), cổng này chỉ xác thực.
 */
@Injectable()
export class MssInboundGuard implements CanActivate {
  private readonly logger = new Logger(MssInboundGuard.name);
  private readonly readEnv: MssEnvReader;

  constructor(@Optional() @Inject(MSS_ENV_READER) readEnv?: MssEnvReader) {
    this.readEnv = readEnv ?? (() => readMssEnv());
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<MssInboundRequest>();
    const env = this.readEnv();
    const rawKeyId = header(req, MSS_KEY_ID_HEADER);
    const keyId = rawKeyId && KEY_ID_RE.test(rawKeyId) ? rawKeyId : null;
    if (req.rawBody === undefined && declaresBody(req)) {
      this.logger.error('Yêu cầu MSS có thân nhưng không mang thân thô (req.rawBody): kiểm nhóm route MSS ở common/body-limits.ts.');
      throw new UnauthorizedException(MSS_UNAUTHORIZED_BODY);
    }
    const result = keyId
      ? verifyMssSignature({
          timestamp: header(req, MSS_TIMESTAMP_HEADER),
          signature: header(req, MSS_SIGNATURE_HEADER),
          rawBody: req.rawBody,
          // Khoá trước chỉ là phần phụ trong lúc xoay: thiếu khoá hiện tại là chưa cấu hình, không nhận riêng khoá cũ.
          secrets: env.inboundSecret ? [env.inboundSecret, env.inboundSecretPrev] : [],
        })
      : ({ ok: false, reason: env.inboundSecret ? 'missing_header' : 'not_configured' } as const);
    if (!result.ok) {
      this.logger.warn(`Từ chối yêu cầu MSS ${req.method ?? ''}: ${result.reason}${keyId ? ` (key ${keyId})` : ''}.`);
      throw new UnauthorizedException(MSS_UNAUTHORIZED_BODY);
    }
    if (result.usedPreviousSecret) this.logger.warn(`Yêu cầu MSS ký bằng bí mật trước (MSS_INBOUND_SECRET_PREV, key ${keyId}): hoàn tất xoay khoá rồi gỡ biến này.`);
    return true;
  }
}

/**
 * Gắn cho route MSS gọi vào: bỏ JWT (MSS không có phiên người dùng) và bắt buộc chữ ký. Route phải nằm dưới
 * `/api/integrations/mss/` để parser giữ thân thô.
 */
export function MssSignedRoute(): MethodDecorator & ClassDecorator {
  return applyDecorators(Public(), UseGuards(MssInboundGuard));
}
