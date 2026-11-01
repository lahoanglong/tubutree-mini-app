import { expect, type Locator } from '@playwright/test';

/**
 * Chip md nhìn cao 36px, vùng chạm 44px do `.tubu-hit-44::after` giãn dọc quanh tâm. Đo bằng `elementFromPoint` cách tâm ±21px:
 * hàng cuộn ngang (`overflow`) cắt mất phần giãn thì điểm đó rơi ra ngoài chip. `control`: điểm cách tâm ±30px phải KHÔNG trúng
 * (đối chứng, phép đo không vô nghĩa); chỉ bật khi quanh chip không có chip khác theo chiều dọc. `minHeight`: chiều cao nhìn thấy tối thiểu (nút chữ nhỏ như "Luật" thấp hơn chip, 24px).
 * Cuộn chip về giữa khung trước khi đo: mép trên có thể bị ô tìm dính che, mép dưới bị thanh đáy cố định che.
 */
export async function expectChipHitArea44(chip: Locator, { control = false, minHeight = 36 }: { control?: boolean; minHeight?: number } = {}): Promise<void> {
  await chip.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = (await chip.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(minHeight);
  const hit = await chip.evaluate(
    (el, b) => {
      const x = b.x + b.width / 2;
      const mid = b.y + b.height / 2;
      const at = (y: number) => document.elementFromPoint(x, y)?.closest('button') === el;
      return { top44: at(mid - 21), bottom44: at(mid + 21), inside: at(mid), above30: at(mid - 30), below30: at(mid + 30) };
    },
    { x: box.x, y: box.y, width: box.width, height: box.height },
  );
  const { above30, below30, ...hit44 } = hit;
  expect(hit44).toEqual({ top44: true, bottom44: true, inside: true });
  if (control) expect({ above30, below30 }).toEqual({ above30: false, below30: false });
}
