import { assertVariationsSellable, NOT_TUBU_FULFILLED, PRODUCT_DISCONTINUED, SELLABLE_PANCAKE_VARIATION_WHERE } from './sellable';

function tx(pancakeOk: string[], sellableOk: string[]) {
  return {
    variation: {
      findMany: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(('pancakeId' in where ? pancakeOk : sellableOk).map((id) => ({ id }))),
      ),
    },
  };
}

const codeOf = (e: unknown) => ((e as { getResponse(): { code: string } }).getResponse()).code;

describe('assertVariationsSellable — kênh chỉ đẩy Pancake (D4)', () => {
  const lines = [
    { variationId: 'v-tubu', productName: 'Nước rửa chén' },
    { variationId: 'v-shop', productName: 'Mật ong' },
  ];

  it('điều kiện Pancake: có mã thật, không phải MCH_, sản phẩm kho Tubu giao', () => {
    expect(SELLABLE_PANCAKE_VARIATION_WHERE).toEqual({
      isActive: true,
      pancakeId: { not: null },
      NOT: { pancakeId: { startsWith: 'MCH_' } },
      product: { isActive: true, approvalStatus: 'APPROVED', fulfilment: 'TUBU' },
    });
  });

  it('dòng đối tác tự giao (bán được nhưng không qua Pancake) → NOT_TUBU_FULFILLED nêu tên', async () => {
    const err = await assertVariationsSellable(tx(['v-tubu'], ['v-tubu', 'v-shop']) as never, lines, { pancakeOnly: true }).catch(
      (e: unknown) => e,
    );
    expect(codeOf(err)).toBe(NOT_TUBU_FULFILLED);
    expect((err as Error).message).toContain('Mật ong');
  });

  it('dòng ngừng bán → vẫn PRODUCT_DISCONTINUED như cũ', async () => {
    const err = await assertVariationsSellable(tx(['v-tubu'], ['v-tubu']) as never, lines, { pancakeOnly: true }).catch(
      (e: unknown) => e,
    );
    expect(codeOf(err)).toBe(PRODUCT_DISCONTINUED);
  });

  it('giỏ/checkout (không pancakeOnly) không đổi: hàng đối tác bán được là qua', async () => {
    await expect(assertVariationsSellable(tx([], ['v-tubu', 'v-shop']) as never, lines)).resolves.toBeUndefined();
  });
});
