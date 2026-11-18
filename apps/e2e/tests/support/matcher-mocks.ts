import type { MockApi } from './mock-api';

/**
 * Dữ liệu mock của Chọn Chuẩn Xanh dùng chung cho spec web và Mini App: 5 câu nhu cầu theo nhánh, 3 câu đố có nguồn, bộ 4 món còn hàng; `mockMatcherOn`
 * bật cờ `game.matcher_enabled`, trả câu hỏi và bộ gợi ý như máy chủ thật.
 */

const opt = (value: string, label: string, tags: string[]) => ({ value, label, tags });
export const MATCHER_CONTENT = {
  questions: [
    {
      code: 'need',
      step: 1,
      prompt: 'Bạn đang cần đồ cho việc gì nhất?',
      options: [opt('laundry', 'Giặt quần áo', ['laundry']), opt('kitchen', 'Rửa chén, bếp', ['kitchen']), opt('floor', 'Lau nhà, nhà tắm', ['floor'])],
      when: null,
    },
    {
      code: 'kitchen_how',
      step: 2,
      prompt: 'Nhà bạn rửa chén thế nào?',
      options: [opt('hand', 'Rửa tay', ['hand']), opt('machine', 'Máy rửa chén', ['machine'])],
      when: ['kitchen'],
    },
    { code: 'laundry_who', step: 2, prompt: 'Giặt cho ai là chính?', options: [opt('family', 'Cả nhà', ['adult']), opt('kids', 'Bé nhỏ', ['kids'])], when: ['laundry'] },
    { code: 'floor_where', step: 2, prompt: 'Lau chỗ nào nhiều nhất?', options: [opt('floor', 'Sàn nhà', ['floor_main']), opt('bath', 'Nhà tắm', ['bath'])], when: ['floor'] },
    {
      code: 'size_home',
      step: 3,
      prompt: 'Bạn muốn mua cỡ nào?',
      options: [opt('small', 'Chai nhỏ dùng thử', ['small']), opt('large', 'Chai lớn dùng lâu', ['large']), opt('refill', 'Can refill', ['refill'])],
      when: ['laundry', 'kitchen', 'floor'],
    },
  ],
  trivia: [
    { id: 'gm-matcher-t-a', prompt: 'Enzyme protease trong nước giặt xử lý vết gì?', options: ['Vết đạm như máu, sữa', 'Vết dầu mỡ', 'Vết mực'], answer: 0, explanation: 'Protease cắt chuỗi đạm nên hợp vết máu, sữa, trứng.', sourceUrl: 'https://www.example.org/protease' },
    { id: 'gm-matcher-t-b', prompt: 'Baking soda có tính gì?', options: ['Axit nhẹ', 'Kiềm nhẹ', 'Trung tính'], answer: 1, explanation: 'Baking soda là muối kiềm nhẹ, pH khoảng 8–9.', sourceUrl: 'https://www.example.org/baking-soda' },
    { id: 'gm-matcher-t-c', prompt: 'Axit citric giúp gì khi rửa ấm?', options: ['Tạo bọt', 'Tan cặn vôi', 'Tạo mùi'], answer: 1, explanation: 'Axit citric hoà tan cặn canxi cacbonat.', sourceUrl: 'https://www.example.org/citric' },
  ],
};
export const matcherItem = (n: number, over: Record<string, unknown> = {}) => ({
  slug: `mon-xanh-${n}`,
  productId: `p-${n}`,
  variationId: `v-${n}`,
  name: ['Bột rửa chén cho máy Fuwa3e', 'Muối rửa chén cho máy', 'Nước làm bóng chén', 'Nước rửa chén sinh học'][n - 1]!,
  variationName: n === 1 ? '1kg' : null,
  imageUrl: null,
  price: [189_000, 99_000, 129_000, 79_000][n - 1]!,
  compareAtPrice: n === 2 ? 120_000 : null,
  flash: false,
  why: ['Hợp máy rửa chén, cỡ lớn dùng lâu.', 'Làm mềm nước cho máy.', 'Chén khô ráo, không vệt nước.', 'Dùng thêm khi rửa tay nồi chảo.'][n - 1]!,
  ...over,
});
export const MATCHER_RESULT = { outcomeId: 'gm-matcher-o-kitchen-machine', code: 'kitchen_machine', title: 'Bộ máy rửa chén', fallback: false, items: [1, 2, 3, 4].map((n) => matcherItem(n)), total: 496_000, water: 0 };

export function mockMatcherOn(api: MockApi, result: unknown = MATCHER_RESULT) {
  api.get('/game/matcher/status', { enabled: true });
  api.get('/game/matcher', MATCHER_CONTENT);
  api.post('/game/matcher/result', () => result);
  api.allowUnmocked('POST /events');
}
