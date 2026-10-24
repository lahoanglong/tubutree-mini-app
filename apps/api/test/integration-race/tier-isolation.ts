/**
 * Bảng hạng là dữ liệu chung của cả DB race: recalcTier gán cho khách hạng cuối cùng họ đủ điều kiện, nên hạng minPoints 0
 * có giảm % mà một spec để lại sẽ giảm giá đơn của spec chạy sau trong cùng luồng (vd. rớt dưới mức tối thiểu của thưởng
 * giới thiệu), và thứ tự file trong luồng đổi theo lần chạy nên lỗi chập chờn. Mỗi file spec trả bảng hạng về như lúc bắt
 * đầu: gỡ khách khỏi các hạng file tạo thêm rồi xoá các hạng đó.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let existing: string[] = [];

beforeAll(async () => {
  existing = (await prisma.membershipTier.findMany({ select: { id: true } })).map((t) => t.id);
});

afterAll(async () => {
  const created = (await prisma.membershipTier.findMany({ where: { id: { notIn: existing } }, select: { id: true } })).map((t) => t.id);
  if (created.length) {
    await prisma.user.updateMany({ where: { tierId: { in: created } }, data: { tierId: null } });
    await prisma.membershipTier.deleteMany({ where: { id: { in: created } } });
  }
  await prisma.$disconnect();
});
