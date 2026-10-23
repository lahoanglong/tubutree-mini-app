import { Body, Controller, Headers, HttpCode, Post, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import type { ZaloBridgeEvent } from '@tubutree/shared-types';
import { Public } from '../../common/decorators/public.decorator';
import type { Env } from '../../config/env.validation';
import { BridgeEventsService } from './bridge-events.service';

/** Cầu nối Zalo gọi vào đây trong mạng nội bộ; Caddy/Apache chặn `/api/internal/*` từ ngoài, Bearer là lớp thứ hai. */
@Public()
@SkipThrottle()
@Controller('internal/zalo-bridge')
export class BridgeEventsController {
  private readonly secret: string;

  constructor(
    private readonly service: BridgeEventsService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('ZALO_BRIDGE_SECRET', { infer: true });
  }

  @Post('events')
  @HttpCode(200)
  async events(@Body() event: ZaloBridgeEvent, @Headers('authorization') auth?: string) {
    if (!this.authorized(auth)) throw new UnauthorizedException();
    const r = await this.service.handle(event);
    if (r.status === 503) throw new ServiceUnavailableException(r.body);
    return r.body;
  }

  /** Bí mật trống luôn bị từ chối, kể cả dev/test: cổng này ghi tin vào hội thoại khách nên không có chế độ "mở". */
  private authorized(header?: string): boolean {
    if (!this.secret) return false;
    const m = /^Bearer (.+)$/.exec(header ?? '');
    if (!m) return false;
    const a = Buffer.from(m[1]!, 'utf8');
    const b = Buffer.from(this.secret, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
