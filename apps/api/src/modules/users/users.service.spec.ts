import { UsersService } from './users.service';
import type { PrismaService } from '../../prisma/prisma.service';

function prismaWithUpdate(updateSpy: jest.Mock) {
  return { user: { update: updateSpy } } as unknown as PrismaService;
}
const fakeUser = { id: 'u1', zaloId: null, phone: null, email: null, fullName: 'A', dob: null, avatarUrl: null, role: 'CUSTOMER', tierId: null, referralCode: 'R', pointsBalance: 0, walletBalance: 0, cashbackPending: 0, metadata: null, tier: null };

describe('UsersService.updateMe', () => {
  it('ép dob "YYYY-MM-DD" về Date trước khi ghi Prisma', async () => {
    const update = jest.fn().mockResolvedValue(fakeUser);
    const svc = new UsersService(prismaWithUpdate(update));
    await svc.updateMe('u1', { dob: '1995-03-20', fullName: 'Tester' });

    const data = update.mock.calls[0][0].data;
    expect(data.dob).toBeInstanceOf(Date);
    expect((data.dob as Date).toISOString().slice(0, 10)).toBe('1995-03-20');
    expect(data.fullName).toBe('Tester');
  });

  it('không gắn dob khi không gửi', async () => {
    const update = jest.fn().mockResolvedValue(fakeUser);
    const svc = new UsersService(prismaWithUpdate(update));
    await svc.updateMe('u1', { fullName: 'Chỉ tên' });
    expect('dob' in update.mock.calls[0][0].data).toBe(false);
  });

  it('serialize trả dob dạng YYYY-MM-DD', async () => {
    const update = jest.fn().mockResolvedValue({ ...fakeUser, dob: new Date('1995-03-20T00:00:00Z') });
    const svc = new UsersService(prismaWithUpdate(update));
    const res = await svc.updateMe('u1', { dob: '1995-03-20' });
    expect(res.dob).toBe('1995-03-20');
  });
});
