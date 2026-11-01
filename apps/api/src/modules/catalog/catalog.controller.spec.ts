import { CatalogController } from './catalog.controller';
import type { CatalogService } from './catalog.service';

describe('CatalogController.categories', () => {
  const build = () => {
    const catalog = {
      categories: jest.fn().mockResolvedValue([{ id: 'cha', children: [{ id: 'con' }] }]),
      categoriesFlat: jest.fn().mockResolvedValue([{ id: 'cha' }, { id: 'con' }]),
    };
    return { catalog, controller: new CatalogController(catalog as unknown as CatalogService) };
  };

  it('mặc định trả cây', async () => {
    const { catalog, controller } = build();
    await expect(controller.categories()).resolves.toEqual([{ id: 'cha', children: [{ id: 'con' }] }]);
    expect(catalog.categoriesFlat).not.toHaveBeenCalled();
  });

  it.each(['1', 'true'])('?flat=%s trả danh sách phẳng có cả danh mục con (cho bộ chọn của admin và gian hàng CTV)', async (flat) => {
    const { catalog, controller } = build();
    await expect(controller.categories(flat)).resolves.toEqual([{ id: 'cha' }, { id: 'con' }]);
    expect(catalog.categories).not.toHaveBeenCalled();
  });

  it.each(['0', 'false', ''])('?flat=%s vẫn là cây', async (flat) => {
    const { catalog, controller } = build();
    await controller.categories(flat);
    expect(catalog.categories).toHaveBeenCalledTimes(1);
  });
});

describe('CatalogController.forYou — seed ngày', () => {
  const build = () => {
    const catalog = { getForYou: jest.fn().mockResolvedValue([]) };
    return { catalog, controller: new CatalogController(catalog as unknown as CatalogService) };
  };

  it('chuyển seed xuống service; không seed thì gọi như cũ (không khoá seed)', async () => {
    const { catalog, controller } = build();
    await controller.forYou('u1', { seed: '20261101' });
    expect(catalog.getForYou).toHaveBeenLastCalledWith('u1', { seed: '20261101' });
    await controller.forYou('u1', {});
    expect(catalog.getForYou).toHaveBeenLastCalledWith('u1', {});
  });
});
