import { catalogLaunchDateProblem, publicCatalogLaunchDate } from './catalog-launch-date';

describe('catalog.launch_date', () => {
  it('nhận rỗng và ngày có thật', () => {
    for (const ok of ['', null, '2026-11-01', '2028-02-29']) expect(catalogLaunchDateProblem(ok)).toBeNull();
  });

  it('từ chối sai dạng, ngày không có thật, sai kiểu', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-11-1', '01/11/2026', '2026-11-01T00:00:00Z', ' 2026-11-01', 'mai', undefined, 20261101, true, {}]) {
      expect(catalogLaunchDateProblem(bad)).not.toBeNull();
    }
  });

  it('công khai: ngày hợp lệ giữ nguyên, rỗng hoặc hỏng thành null', () => {
    expect(publicCatalogLaunchDate('2026-11-01')).toBe('2026-11-01');
    for (const none of ['', '2026-02-30', 'mai', null, undefined, 5]) expect(publicCatalogLaunchDate(none)).toBeNull();
  });
});
