import { notifyAdmins } from './notify-admins';

function setup(opts: { admins?: { id: string }[]; wired?: boolean; notify?: jest.Mock } = {}) {
  const findMany = jest.fn().mockResolvedValue(opts.admins ?? [{ id: 'a1' }]);
  const notify = opts.notify ?? jest.fn().mockResolvedValue(undefined);
  const warn = jest.fn();
  const ctx = {
    prisma: { user: { findMany } } as never,
    notifications: opts.wired === false ? undefined : { notify },
    logger: { warn },
  };
  return { ctx, findMany, notify, warn };
}

describe('notifyAdmins', () => {
  it('báo từng admin chưa khoá (tối đa 20) với template và dữ liệu của sự việc', async () => {
    const { ctx, findMany, notify } = setup({ admins: [{ id: 'a1' }, { id: 'a2' }] });
    await notifyAdmins(ctx, { template: 'T', subject: 's', data: () => ({ k: 'v' }) });
    expect(findMany).toHaveBeenCalledWith({ where: { role: 'ADMIN', isBlocked: false }, select: { id: true }, take: 20 });
    expect(notify).toHaveBeenCalledWith('a1', 'T', { k: 'v' });
    expect(notify).toHaveBeenCalledWith('a2', 'T', { k: 'v' });
  });

  it('data bất đồng bộ chạy song song với truy vấn admin', async () => {
    const order: string[] = [];
    const { ctx, findMany } = setup();
    findMany.mockImplementation(async () => {
      order.push('admins:start');
      await Promise.resolve();
      order.push('admins:end');
      return [{ id: 'a1' }];
    });
    await notifyAdmins(ctx, {
      template: 'T',
      subject: 's',
      data: async () => {
        order.push('data:start');
        return { k: 'v' };
      },
    });
    expect(order.slice(0, 2)).toEqual(['admins:start', 'data:start']);
  });

  it('chưa wiring -> không truy vấn, cảnh báo nêu sự việc', async () => {
    const { ctx, findMany, warn } = setup({ wired: false });
    await notifyAdmins(ctx, { template: 'T', subject: 'yêu cầu X', data: () => ({}) });
    expect(findMany).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('NotificationsService chưa wiring — không báo được admin yêu cầu X.');
  });

  it('không có admin -> không notify, cảnh báo', async () => {
    const { ctx, notify, warn } = setup({ admins: [] });
    await notifyAdmins(ctx, { template: 'T', subject: 'yêu cầu X', data: () => ({}) });
    expect(notify).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('Không có tài khoản ADMIN nào để báo yêu cầu X.');
  });

  it('một admin lỗi -> admin còn lại vẫn nhận, cảnh báo đếm lỗi, không throw', async () => {
    const notify = jest.fn(async (id: string) => {
      if (id === 'a1') throw new Error('zns down');
    });
    const { ctx, warn } = setup({ admins: [{ id: 'a1' }, { id: 'a2' }], notify });
    await expect(notifyAdmins(ctx, { template: 'T', subject: 'yêu cầu X', data: () => ({}) })).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledWith('a2', 'T', {});
    expect(warn).toHaveBeenCalledWith('Báo admin yêu cầu X: lỗi 1/2.');
  });

  it('truy vấn admin lỗi -> ném ra để nơi gọi bắt', async () => {
    const { ctx, findMany } = setup();
    findMany.mockRejectedValue(new Error('db down'));
    await expect(notifyAdmins(ctx, { template: 'T', subject: 's', data: () => ({}) })).rejects.toThrow('db down');
  });

  it('data lỗi -> ném ra để nơi gọi bắt, không notify', async () => {
    const { ctx, notify } = setup();
    await expect(
      notifyAdmins(ctx, {
        template: 'T',
        subject: 's',
        data: async () => {
          throw new Error('no dealer');
        },
      }),
    ).rejects.toThrow('no dealer');
    expect(notify).not.toHaveBeenCalled();
  });
});
