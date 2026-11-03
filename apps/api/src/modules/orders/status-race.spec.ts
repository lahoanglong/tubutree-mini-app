import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { assertManualStatusChange, manualOutcome } from './status-race';

const prismaWith = (now: { status: string; pancakeAttention?: string | null }) => {
  const findUniqueOrThrow = jest.fn().mockResolvedValue({ pancakeAttention: null, ...now });
  return { prisma: { order: { findUniqueOrThrow } } as unknown as Pick<PrismaService, 'order'>, findUniqueOrThrow };
};
const lost = () => ({ ...manualOutcome(), flipped: false });
const before = { id: 'o1', status: 'CONFIRMED', pancakeAttention: null };

describe('assertManualStatusChange', () => {
  it('thắng lần lật (hoặc setStatus thoát sớm vì đã ở đích) thì êm, không đọc lại', async () => {
    const { prisma, findUniqueOrThrow } = prismaWith({ status: 'DELIVERED' });
    await expect(assertManualStatusChange(prisma, before, 'SHIPPING', manualOutcome())).resolves.toBeUndefined();
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('thua nhưng người khác đã đưa đơn tới đúng đích → êm', async () => {
    await expect(assertManualStatusChange(prismaWith({ status: 'CANCELLED' }).prisma, before, 'CANCELLED', lost())).resolves.toBeUndefined();
  });

  it('thua race → 409 kèm nhãn trạng thái mới; trạng thái lạ in nguyên mã', async () => {
    const run = assertManualStatusChange(prismaWith({ status: 'PACKED' }).prisma, before, 'DELIVERED', lost());
    await expect(run).rejects.toBeInstanceOf(ConflictException);
    await expect(assertManualStatusChange(prismaWith({ status: 'PACKED' }).prisma, before, 'DELIVERED', lost())).rejects.toThrow(
      'Đơn vừa chuyển sang «Đang đóng gói» trong lúc bạn thao tác nên chưa đổi được. Tải lại đơn rồi thử lại.',
    );
    await expect(assertManualStatusChange(prismaWith({ status: 'WEIRD' }).prisma, before, 'CANCELLED', lost())).rejects.toThrow('«WEIRD»');
  });

  it('câu Pancake chỉ khi đích là huỷ và cờ mới xuất hiện sau lần bấm', async () => {
    await expect(assertManualStatusChange(prismaWith({ status: 'PACKED', pancakeAttention: 'x' }).prisma, before, 'CANCELLED', lost())).rejects.toThrow(
      /Đơn đã vào Cần xử lý Pancake\.$/,
    );
    await expect(assertManualStatusChange(prismaWith({ status: 'CANCELLED', pancakeAttention: 'x' }).prisma, before, 'PACKED', lost())).rejects.toThrow(/thử lại\.$/);
    await expect(
      assertManualStatusChange(prismaWith({ status: 'PACKED', pancakeAttention: 'x' }).prisma, { ...before, pancakeAttention: 'x' }, 'CANCELLED', lost()),
    ).rejects.toThrow(/thử lại\.$/);
  });
});
