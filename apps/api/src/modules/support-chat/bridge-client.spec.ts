import { BridgeClient } from './bridge-client';

function client(url = 'http://bridge:3110', secret = 's3cret') {
  const config: any = { get: (k: string) => (k === 'ZALO_BRIDGE_URL' ? url : secret) };
  return new BridgeClient(config);
}
const json = (status: number, body: unknown) => Promise.resolve({ status, ok: status < 300, json: () => Promise.resolve(body) } as Response);

describe('BridgeClient', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  it('gửi header Bearer và thân JSON', async () => {
    const fetchMock = jest.fn().mockReturnValue(json(200, { msgId: 'z1' }));
    global.fetch = fetchMock as any;
    const r = await client().send('k1', 'xin chào');
    expect(r).toEqual({ ok: true, msgId: 'z1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://bridge:3110/send');
    expect(init.headers.Authorization).toBe('Bearer s3cret');
    expect(JSON.parse(init.body)).toEqual({ idempotencyKey: 'k1', text: 'xin chào' });
  });

  it('hết 15 giây thì unknown:true', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockImplementation((_u: string, init: any) =>
      new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    ) as any;
    let settled = false;
    const p = client().send('k1', 'x').then((v) => {
      settled = true;
      return v;
    });
    await jest.advanceTimersByTimeAsync(10_000);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(5_000);
    const r = await p;
    expect(r).toMatchObject({ ok: false, unknown: true, retry: false });
  });

  it('qrStart chờ tới 25 giây (cầu nối đợi ảnh QR đầu tới 20 giây), các lời gọi khác vẫn 10 giây', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockImplementation((_u: string, init: any) =>
      new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    ) as any;
    let qrDone = false;
    let groupsDone = false;
    const qr = client().qrStart().then((v) => ((qrDone = true), v));
    const groups = client().groups().then((v) => ((groupsDone = true), v));
    await jest.advanceTimersByTimeAsync(10_000);
    expect(groupsDone).toBe(true);
    expect(qrDone).toBe(false);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(await qr).toMatchObject({ ok: false, code: 'TIMEOUT' });
    await groups;
  });

  it('409 NOT_CONNECTED thì retry:true, NO_GROUP và 502 thì retry:false', async () => {
    global.fetch = jest.fn().mockReturnValueOnce(json(409, { code: 'NOT_CONNECTED' })).mockReturnValueOnce(json(409, { code: 'NO_GROUP' }))
      .mockReturnValueOnce(json(502, { code: 'SEND_FAILED', message: 'boom' })).mockReturnValueOnce(json(500, {})).mockReturnValueOnce(Promise.resolve({ status: 502, ok: false, json: () => Promise.reject(new Error('no body')) } as Response)) as any;
    const c = client();
    expect(await c.send('k', 'x')).toMatchObject({ ok: false, retry: true, unknown: false, code: 'NOT_CONNECTED' });
    expect(await c.send('k', 'x')).toMatchObject({ ok: false, retry: false, code: 'NO_GROUP' });
    expect(await c.send('k', 'x')).toMatchObject({ ok: false, retry: false, code: 'SEND_FAILED', message: 'boom' });
    expect(await c.send('k', 'x')).toMatchObject({ ok: false, retry: true });
    expect(await c.send('k', 'x')).toMatchObject({ ok: false, retry: true, code: 'HTTP_502' });
  });

  it('lỗi mạng thì retry:true', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed')) as any;
    expect(await client().send('k', 'x')).toMatchObject({ ok: false, retry: true, unknown: false });
  });

  it('URL trống thì mọi lệnh trả BRIDGE_NOT_CONFIGURED, không gọi mạng', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;
    const c = client('');
    expect(await c.send('k', 'x')).toMatchObject({ ok: false, retry: false, code: 'BRIDGE_NOT_CONFIGURED' });
    expect(await c.groups()).toMatchObject({ ok: false, code: 'BRIDGE_NOT_CONFIGURED' });
    expect(await c.health()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('health trả null khi không gọi được', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('down')) as any;
    expect(await client().health()).toBeNull();
  });

  it('setGroup gọi PUT /config', async () => {
    const fetchMock = jest.fn().mockReturnValue(json(200, { groupId: 'g1' }));
    global.fetch = fetchMock as any;
    const r = await client().setGroup('g1');
    expect(r).toEqual({ ok: true, data: { groupId: 'g1' } });
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT');
    expect(fetchMock.mock.calls[0][0]).toBe('http://bridge:3110/config');
  });
});
