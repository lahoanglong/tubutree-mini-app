import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { BridgeEventsController } from './bridge-events.controller';

function make(secret: string, result: any = { status: 200, body: { ok: true } }) {
  const service: any = { handle: jest.fn().mockResolvedValue(result) };
  const config: any = { get: jest.fn().mockReturnValue(secret) };
  return { ctl: new BridgeEventsController(service, config), service };
}
const ev: any = { type: 'undo', groupId: 'g', msgId: 'm' };

describe('BridgeEventsController', () => {
  it.each([[undefined], [''], ['Bearer sai'], ['Bearer s3cret-x'], ['s3cret']])('Bearer sai (%p) thì 401', async (h) => {
    const { ctl, service } = make('s3cret');
    await expect(ctl.events(ev, h)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(service.handle).not.toHaveBeenCalled();
  });

  it('secret trống: 401 kể cả khi gửi Bearer rỗng, ở mọi môi trường', async () => {
    const { ctl } = make('');
    for (const h of [undefined, 'Bearer ', 'Bearer']) await expect(ctl.events(ev, h)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('Bearer đúng thì chuyển cho service', async () => {
    const { ctl, service } = make('s3cret');
    expect(await ctl.events(ev, 'Bearer s3cret')).toEqual({ ok: true });
    expect(service.handle).toHaveBeenCalledWith(ev);
  });

  it('503 của service thành ServiceUnavailableException({retry:true})', async () => {
    const { ctl } = make('s3cret', { status: 503, body: { retry: true } });
    const err = await ctl.events(ev, 'Bearer s3cret').catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.getResponse()).toMatchObject({ retry: true });
  });
});
