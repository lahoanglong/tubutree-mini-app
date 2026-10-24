import type { SupportChatContext } from '@tubutree/shared-types';
import type { Prisma, SupportForward, SupportMessage } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { BridgeClient } from './bridge-client';
import { formatForward } from './forward-format';

/** Dựng nội dung tin chuyển từ các tin khách của một forward. */
export async function buildForwardText(
  prisma: PrismaService,
  conv: { userId: string; code: string },
  messages: SupportMessage[],
): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: conv.userId }, select: { fullName: true, phone: true, tier: { select: { name: true } } } });
  const context = [...messages].reverse().find((m) => m.context)?.context as SupportChatContext | null | undefined;
  return formatForward({
    code: conv.code,
    name: user?.fullName || 'Khách',
    phone: user?.phone ?? null,
    tier: user?.tier ? `Hạng ${user.tier.name}` : null,
    context: context ?? null,
    items: messages.map((m) => ({ body: m.body, imageUrl: m.imageUrl })),
  });
}

/**
 * Kết quả UNKNOWN/FAILED chỉ chốt khi còn PENDING: kết quả muộn của một lượt gửi chồng nhau không được ghi đè trạng thái đã chốt (SENT, hoặc admin gửi lại).
 */
export function settle(prisma: PrismaService, id: string, data: Prisma.SupportForwardUpdateManyMutationInput) {
  return prisma.supportForward.updateMany({ where: { id, status: 'PENDING' }, data });
}

/** Có msgId thật là sự thật: áp cả khi lần gửi trước đã chốt UNKNOWN/FAILED, nhưng không đè SENT. */
function settleSent(prisma: PrismaService, id: string, data: Prisma.SupportForwardUpdateManyMutationInput) {
  return prisma.supportForward.updateMany({ where: { id, status: { in: ['PENDING', 'UNKNOWN', 'FAILED'] } }, data });
}

/**
 * Một lượt gửi forward qua cầu nối rồi chốt trạng thái. Trả về lý do để nơi gọi ném cho BullMQ thử lại, hoặc null khi lượt này đã chốt.
 * `canRetry` false (đường admin, không có BullMQ) thì mọi lỗi thử-lại-được đều chốt FAILED.
 * Gửi lại cùng idempotencyKey = forward.id là an toàn vì cầu nối chống đăng đôi.
 */
export async function sendAndSettle(
  prisma: PrismaService,
  bridge: BridgeClient,
  forward: Pick<SupportForward, 'id'>,
  text: string,
  canRetry: boolean,
): Promise<string | null> {
  // updateMany: forward có thể đã bị xoá cùng hội thoại (khách xoá tài khoản) giữa lúc nhận tin và lúc gửi; khi đó không gửi gì.
  const bumped = await prisma.supportForward.updateMany({ where: { id: forward.id }, data: { attempts: { increment: 1 } } });
  if (bumped.count === 0) return null;
  const r = await bridge.send(forward.id, text);
  if (r.ok) {
    await settleSent(prisma, forward.id, { status: 'SENT', zaloMsgId: r.msgId, sentAt: new Date(), lastError: null });
    return null;
  }
  const lastError = `${r.code}: ${r.message}`.slice(0, 500);
  if (r.unknown) {
    // Không tự gửi lại để khỏi đăng đôi; admin bấm "Gửi lại" với cùng khoá.
    await settle(prisma, forward.id, { status: 'UNKNOWN', lastError });
    return null;
  }
  if (r.retry && canRetry) {
    await prisma.supportForward.updateMany({ where: { id: forward.id }, data: { lastError } });
    return lastError;
  }
  await settle(prisma, forward.id, { status: 'FAILED', lastError });
  return null;
}
