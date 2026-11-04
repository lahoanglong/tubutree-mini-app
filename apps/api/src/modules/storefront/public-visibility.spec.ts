import { PUBLIC_VISIBILITY_CONFIG_KEYS, loadPublicVisibility } from './public-visibility';

describe('loadPublicVisibility', () => {
  // Khoá mà hàm đọc phải khớp PUBLIC_VISIBILITY_CONFIG_KEYS: SystemConfigService.set chỉ đánh dấu danh sách ảnh /img cũ theo danh sách này,
  // nên thêm một khoá đọc mới mà quên khai báo ở đây thì ảnh gian hàng đổi theo khoá đó vẫn trễ tới 5 phút.
  it('đọc đúng tập khoá trong PUBLIC_VISIBILITY_CONFIG_KEYS, không hơn không kém', async () => {
    const get = jest.fn().mockResolvedValue(undefined);
    await loadPublicVisibility({ get } as never);
    const read = new Set(get.mock.calls.map((c) => c[0] as string));
    expect(read).toEqual(new Set(PUBLIC_VISIBILITY_CONFIG_KEYS));
    expect(PUBLIC_VISIBILITY_CONFIG_KEYS).toHaveLength(read.size);
  });
});
