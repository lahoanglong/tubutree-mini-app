import { TtlMemo } from './ttl-memo';

describe('TtlMemo', () => {
  it('hai lượt gọi liên tiếp cùng khoá chỉ nạp một lần', async () => {
    const memo = new TtlMemo<number>(60_000);
    const load = jest.fn().mockResolvedValue(7);
    expect(await memo.get('a', load)).toBe(7);
    expect(await memo.get('a', load)).toBe(7);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('khoá khác nạp riêng', async () => {
    const memo = new TtlMemo<string>(60_000);
    const load = jest.fn(async () => 'x');
    await memo.get('a', load);
    await memo.get('b', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('hết hạn thì nạp lại', async () => {
    let t = 1_000;
    const memo = new TtlMemo<number>(60_000, 10, () => t);
    const load = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    expect(await memo.get('a', load)).toBe(1);
    t += 59_999;
    expect(await memo.get('a', load)).toBe(1);
    t += 2;
    expect(await memo.get('a', load)).toBe(2);
  });

  it('các lượt gọi đồng thời dùng chung một lần nạp đang chạy', async () => {
    const memo = new TtlMemo<number>(60_000);
    let release!: (n: number) => void;
    const load = jest.fn(() => new Promise<number>((r) => (release = r)));
    const all = Promise.all([memo.get('a', load), memo.get('a', load), memo.get('a', load)]);
    release(5);
    expect(await all).toEqual([5, 5, 5]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('nạp lỗi thì không nhớ lỗi: lượt sau nạp lại', async () => {
    const memo = new TtlMemo<number>(60_000);
    const load = jest.fn().mockRejectedValueOnce(new Error('db')).mockResolvedValueOnce(3);
    await expect(memo.get('a', load)).rejects.toThrow('db');
    expect(await memo.get('a', load)).toBe(3);
  });

  it('giữ tối đa max khoá: khoá cũ nhất bị bỏ', async () => {
    const memo = new TtlMemo<number>(60_000, 2);
    const load = jest.fn(async () => 1);
    await memo.get('a', load);
    await memo.get('b', load);
    await memo.get('c', load);
    await memo.get('a', load);
    expect(load).toHaveBeenCalledTimes(4);
  });
});
