import { canonicalUserId } from './external-claim-audit';

const db = (links: Record<string, string | null>) => ({ user: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({ mergedIntoId: links[where.id] ?? null })) } }) as never;

describe('canonicalUserId', () => {
  it('đi theo chuỗi gộp tới user gốc; user không gộp trả chính nó', async () => {
    const d = db({ a: 'b', b: 'c' });
    expect(await canonicalUserId(d, 'a')).toBe('c');
    expect(await canonicalUserId(d, 'c')).toBe('c');
  });
  it('vòng gộp trả giá trị ổn định (id nhỏ nhất trong vòng) từ mọi điểm vào', async () => {
    const d = db({ a: 'b', b: 'c', c: 'a', z: 'c' });
    const got = await Promise.all(['a', 'b', 'c', 'z'].map((id) => canonicalUserId(d, id)));
    expect(new Set(got)).toEqual(new Set(['a']));
  });
});
