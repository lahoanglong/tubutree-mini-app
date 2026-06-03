import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Public } from '../../../common/decorators/public.decorator';
import { PrismaService } from '../../../prisma/prisma.service';
import type { Env } from '../../../config/env.validation';
import { QUEUE_PANCAKE_EVENTS } from '../../../jobs/queues';

interface PancakeWebhookBody {
  event: string;
  data: Record<string, unknown>;
}

/**
 * Nhận webhook Pancake (Build Spec §8.4). URL cấu hình trong Pancake:
 *   https://api.tubutree.com/api/webhooks/pancake
 * Quy trình: verify HMAC → lưu raw (RECEIVED) → enqueue → trả 200 ngay (xử lý async).
 */
@Controller('webhooks/pancake')
export class PancakeWebhookController {
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @InjectQueue(QUEUE_PANCAKE_EVENTS) private readonly queue: Queue,
  ) {
    this.secret = config.get('PANCAKE_WEBHOOK_SECRET', { infer: true });
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Body() body: PancakeWebhookBody,
    @Headers('x-pancake-signature') signature?: string,
  ) {
    if (this.secret) {
      this.verifySignature(JSON.stringify(body), signature);
    }
    const event = await this.prisma.pancakeWebhookEvent.create({
      data: { eventType: body.event, rawPayload: body as object, status: 'RECEIVED' },
    });
    await this.queue.add('process', { eventId: event.id }, { jobId: event.id });
    return { received: true };
  }

  private verifySignature(payload: string, signature?: string): void {
    if (!signature) throw new UnauthorizedException('Thiếu chữ ký webhook.');
    const expected = createHmac('sha256', this.secret).update(payload).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Chữ ký webhook không hợp lệ.');
    }
  }
}
