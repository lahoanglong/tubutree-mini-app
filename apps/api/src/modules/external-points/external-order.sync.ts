import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { OrderSourceMap } from './external-order.config';
import { ingestExternalOrder, type IngestOutcome } from './external-order.ingest';
import { applyStatusToClaim, type ClaimNotifier } from './external-claim-status';
import { ensureChatClaim } from './external-chat.claim';

export interface IngestDeps {
  notifier?: ClaimNotifier;
  config?: Pick<SystemConfigService, 'get'>;
  /** Tính lại hạng sau khi điểm đơn chat được đảo (đơn chat tính vào xét hạng). Thiếu thì chỉ cron đêm tính lại. */
  recalcTier?: (userId: string) => Promise<void>;
}

/**
 * Nạp đơn ngoài rồi nối trạng thái mới vào claim của nó. Mọi đường nạp (webhook, tra theo mã, kéo dự phòng) đi qua đây để claim
 * luôn thấy đổi trạng thái; applyStatusToClaim tự idempotent nên gọi lặp hay gặp bản STALE đều an toàn.
 */
export async function ingestAndApply(
  prisma: PrismaService,
  deps: IngestDeps,
  data: Record<string, unknown>,
  map: OrderSourceMap,
  now: Date = new Date(),
): Promise<IngestOutcome> {
  const outcome = await ingestExternalOrder(prisma, data, map, now);
  if (outcome.result === 'STORED') {
    const id = data['id'] ?? data['order_id'];
    if (id !== null && id !== undefined && id !== '') {
      await applyStatusToClaim(prisma, deps.notifier, deps.config, String(id), { recalcTier: deps.recalcTier });
      // Đơn chat/điện thoại có SĐT: tự lên claim PHONE (cờ tắt thì hàm này không làm gì). Sau applyStatusToClaim để đơn vừa bị huỷ không tạo claim.
      if (outcome.kind === 'CHAT') await ensureChatClaim(prisma, { notifier: deps.notifier, config: deps.config }, String(id), now, data);
    }
  }
  return outcome;
}
