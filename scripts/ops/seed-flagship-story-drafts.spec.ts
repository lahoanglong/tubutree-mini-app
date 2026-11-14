// Chạy: cd apps/api && npx tsx --test ../../scripts/ops/seed-flagship-story-drafts.spec.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  parseStoryConfig,
  type ProductStoryConfig,
} from '../../packages/shared-types/src/product-story';
import { storyDraftProblems } from '../../packages/app-core/src/commerce/story-presets-launch';
import {
  CUTOUT_MAX_BYTES,
  CUTOUT_MAX_EDGE,
  FLAGSHIP,
  loadFromApi,
  parseArgs,
  pickSource,
  placeCutout,
  PUBLIC_IMAGE_MAX_SLOT,
  renderCutout,
  seedDrafts,
  type Args,
  type Deps,
  type ProductRow,
  type WriteInput,
} from './seed-flagship-story-drafts';

type Sharp = typeof import('sharp');
const sharp = loadFromApi('sharp') as Sharp;

/** Poster giống ảnh PROD: khung xanh rêu chạm mép, nền trắng bên trong, sản phẩm tối nằm giữa. */
async function poster(
  opts: {
    size?: number;
    bg?: [number, number, number];
    productNoise?: boolean;
    touchEdge?: boolean;
  } = {},
): Promise<Buffer> {
  const size = opts.size ?? 1000;
  const bg = opts.bg ?? [255, 255, 255];
  const data = Buffer.alloc(size * size * 3);
  const frame = Math.round(size * 0.02);
  const px0 = Math.round(size * 0.35);
  const px1 = Math.round(size * 0.65);
  const py0 = Math.round(size * 0.2);
  const py1 = Math.round(size * 0.8);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      let rgb: [number, number, number] = bg;
      if (x < frame || y < frame || x >= size - frame || y >= size - frame) rgb = [120, 140, 10];
      const inProduct =
        x >= px0 && x < (opts.touchEdge ? Math.round(size * 0.99) : px1) && y >= py0 && y < py1;
      if (inProduct)
        rgb = opts.productNoise
          ? [
              Math.floor(Math.random() * 256),
              Math.floor(Math.random() * 256),
              Math.floor(Math.random() * 256),
            ]
          : [60, 40, 30];
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
    }
  }
  return sharp(data, { raw: { width: size, height: size, channels: 3 } })
    .png()
    .toBuffer();
}

const ROI = { x: 0.06, y: 0.06, width: 0.88, height: 0.88 };
const decode = async (dataUrl: string) => {
  const buf = Buffer.from(dataUrl.split(',')[1]!, 'base64');
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, ...info, bytes: buf.length, format: (await sharp(buf).metadata()).format };
};
const alphaAt = (img: { data: Buffer; width: number }, x: number, y: number) =>
  img.data[(y * img.width + x) * 4 + 3]!;

describe('renderCutout — cắt khung rồi tách nền', () => {
  it('poster nền trắng có khung: ra WebP trong suốt, sản phẩm đặc, bốn góc trong suốt, cắt sát sản phẩm', async () => {
    const r = await renderCutout(await poster(), { roi: ROI, tolerance: 20 });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.match(r.dataUrl, /^data:image\/webp;base64,/);
    const img = await decode(r.dataUrl);
    assert.equal(img.format, 'webp');
    assert.equal(img.channels, 4);
    for (const [x, y] of [
      [0, 0],
      [img.width - 1, 0],
      [0, img.height - 1],
      [img.width - 1, img.height - 1],
    ] as const)
      assert.equal(alphaAt(img, x, y), 0);
    assert.equal(alphaAt(img, Math.floor(img.width / 2), Math.floor(img.height / 2)), 255);
    assert.ok(img.width < 400 && img.height < 700, `chưa cắt sát: ${img.width}x${img.height}`);
    assert.ok(r.removedPct > 50);
  });

  it('ảnh lớn: cạnh dài không quá 1200px và tệp không quá 150KB', async () => {
    const r = await renderCutout(await poster({ size: 3000 }), { roi: ROI, tolerance: 20 });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const img = await decode(r.dataUrl);
    assert.ok(Math.max(img.width, img.height) <= CUTOUT_MAX_EDGE);
    assert.ok(img.bytes <= CUTOUT_MAX_BYTES);
  });

  it('thân sản phẩm nhiễu nặng: hạ chất lượng và kích thước tới khi vừa 150KB', async () => {
    const r = await renderCutout(await poster({ size: 1200, productNoise: true }), {
      roi: ROI,
      tolerance: 20,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const img = await decode(r.dataUrl);
    assert.ok(img.bytes <= CUTOUT_MAX_BYTES, `${img.bytes} byte`);
    assert.ok(Math.max(img.width, img.height) <= CUTOUT_MAX_EDGE);
  });

  it('nền xám 220: tolerance 20 không tách, tolerance 40 tách (thanh độ lệch có tác dụng thật)', async () => {
    const grey = await poster({ bg: [220, 220, 220] });
    const tight = await renderCutout(grey, { roi: ROI, tolerance: 20 });
    assert.equal(tight.ok, false);
    const loose = await renderCutout(grey, { roi: ROI, tolerance: 40 });
    assert.equal(loose.ok, true);
  });

  it('sản phẩm chạm mép khung cắt (khung quá chặt) bị từ chối thay vì ra ảnh cụt', async () => {
    const r = await renderCutout(await poster({ touchEdge: true }), { roi: ROI, tolerance: 20 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /mép|chạm/);
  });

  it('nền màu (không trắng) không tách được: từ chối với lý do nói rõ', async () => {
    const r = await renderCutout(await poster({ bg: [250, 170, 40] }), { roi: ROI, tolerance: 20 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /nền/);
  });

  it('không sửa buffer đầu vào và ảnh hỏng cho lý do thay vì ném lỗi', async () => {
    const src = await poster();
    const copy = Buffer.from(src);
    await renderCutout(src, { roi: ROI, tolerance: 20 });
    assert.ok(src.equals(copy));
    const bad = await renderCutout(Buffer.from('không phải ảnh'), { roi: ROI, tolerance: 20 });
    assert.equal(bad.ok, false);
  });
});

describe('placeCutout — chọn ô ảnh trong products.images', () => {
  const imgs = (n: number) =>
    Array.from({ length: n }, (_, i) => `https://cdn.example.com/${i}.png`);
  const DATA = 'data:image/webp;base64,AAAA';

  it('còn chỗ (≤20 ảnh): nối vào cuối, không đổi ảnh cũ', () => {
    const r = placeCutout(imgs(3), DATA)!;
    assert.equal(r.slot, 3);
    assert.deepEqual(r.images.slice(0, 3), imgs(3));
    assert.equal(r.images[3], DATA);
    assert.equal(placeCutout(imgs(PUBLIC_IMAGE_MAX_SLOT), DATA)!.slot, PUBLIC_IMAGE_MAX_SLOT);
  });

  it('quá 20 ảnh: thay ảnh TRÙNG ở ô cao nhất ≤20, không mất ảnh nào khác', () => {
    const list = [...imgs(12), ...imgs(12), ...imgs(12)];
    const r = placeCutout(list, DATA)!;
    assert.equal(r.slot, 20);
    assert.equal(r.images.length, 36);
    assert.equal(r.images[20], DATA);
    const before = new Set(list);
    const after = new Set(r.images.filter((x) => x !== DATA));
    assert.deepEqual([...after].sort(), [...before].sort());
  });

  it('quá 20 ảnh và không ảnh nào trùng: không có chỗ an toàn, trả null', () => {
    assert.equal(placeCutout(imgs(30), DATA), null);
  });

  it('chạy lại với ô cũ của chính ảnh tách nền: thay đúng ô đó, không nối thêm', () => {
    const list = [...imgs(3), 'data:image/webp;base64,OLD'];
    const r = placeCutout(list, DATA, 3)!;
    assert.equal(r.slot, 3);
    assert.equal(r.images.length, 4);
    assert.equal(r.images[3], DATA);
  });

  it('ô cũ không còn là ảnh data (Pancake đã ghi đè): nối như mới', () => {
    const r = placeCutout(imgs(3), DATA, 3)!;
    assert.equal(r.slot, 3);
    assert.equal(r.images.length, 4);
  });
});

describe('pickSource', () => {
  it('tìm ảnh nguồn đã duyệt theo mã tệp trong URL, không theo vị trí', () => {
    const list = [
      'https://content.pancake.vn/a/zzz.png',
      'https://content.pancake.vn/a/abc123.png',
    ];
    assert.equal(pickSource(list, 'abc123'), list[1]);
    assert.equal(pickSource(list, 'khong-co'), null);
  });
});

describe('parseArgs', () => {
  const base = { apply: false, forceDraft: false, allowHideLive: false, writeCutout: false };

  it('mặc định là dry-run, không ẩn câu chuyện đang công khai, không ghi ảnh tách nền; mỗi cờ bật riêng', () => {
    assert.deepEqual(parseArgs([]), base);
    assert.deepEqual(parseArgs(['--dry-run']), base);
    assert.deepEqual(parseArgs(['--apply']), { ...base, apply: true });
    assert.deepEqual(parseArgs(['--apply', '--force-draft']), {
      ...base,
      apply: true,
      forceDraft: true,
    });
    assert.deepEqual(parseArgs(['--allow-hide-live']), { ...base, allowHideLive: true });
    assert.deepEqual(parseArgs(['--write-cutout']), { ...base, writeCutout: true });
  });

  it('--dry-run cùng --apply mâu thuẫn và cờ lạ đều bị từ chối', () => {
    assert.throws(() => parseArgs(['--dry-run', '--apply']), /mâu thuẫn/);
    assert.throws(() => parseArgs(['--aply']), /cờ lạ/);
  });
});

describe('FLAGSHIP', () => {
  it('đúng bốn slug trong docs/product-story-Rollout-Plan.md', () => {
    const doc = readFileSync(
      new URL('../../docs/product-story-Rollout-Plan.md', import.meta.url),
      'utf8',
    );
    assert.deepEqual(
      FLAGSHIP.map((f) => f.slug),
      [
        'duong-hoa-dua-sokfarm-d6c685',
        'banh-mam-hat-yen-mach-bh-nong-ec5325',
        'dau-rua-mat-po-lang-100ml-55ml-8478ee',
        'nuoc-rua-chen-fuwa3e-3-8l-ef3979',
      ],
    );
    for (const f of FLAGSHIP) assert.ok(doc.includes(f.slug), f.slug);
  });
});

function row(over: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 'p1',
    slug: 'duong-hoa-dua-sokfarm-d6c685',
    name: 'Đường hoa dừa SOKFARM',
    brand: 'Sokfarm',
    shortDesc: null,
    certifications: [],
    ingredients: null,
    images: [
      'https://content.pancake.vn/2-25/2025/5/30/f7e5b05bf2e2a3a74162f6520557208aa66df676.png',
    ],
    storyConfig: null,
    variations: [
      { id: 'v1', name: '300g', attributes: [] },
      { id: 'v2', name: '1KG', attributes: [] },
      { id: 'v3', name: '5KG', attributes: [] },
    ],
    ...over,
  };
}

interface Fake {
  deps: Deps;
  writes: WriteInput[];
  lines: string[];
  fetched: string[];
}
async function fake(
  rows: ProductRow[],
  opts: { writeOk?: boolean; image?: Buffer } = {},
): Promise<Fake> {
  const writes: WriteInput[] = [];
  const lines: string[] = [];
  const fetched: string[] = [];
  const img = opts.image ?? (await poster());
  const deps: Deps = {
    find: async (slug) => rows.find((r) => r.slug === slug) ?? null,
    loadImage: async (ref) => {
      fetched.push(ref);
      return img;
    },
    write: async (w) => {
      writes.push(w);
      return opts.writeOk ?? true;
    },
    log: (l) => lines.push(l),
  };
  return { deps, writes, lines, fetched };
}

/** Hai quyết định của chủ (ẩn câu chuyện đang công khai, ghi ảnh tách nền vào products.images): các test cũ coi như chủ đã chốt cả hai. */
const a = (over: Partial<Args>): Args => ({
  apply: false,
  forceDraft: false,
  allowHideLive: true,
  writeCutout: true,
  ...over,
});

describe('seedDrafts', () => {
  it('dry-run (mặc định): không ghi gì, vẫn tính ảnh tách nền và nói sẽ làm gì', async () => {
    const f = await fake([row()]);
    const out = await seedDrafts(f.deps, a({ apply: false, forceDraft: false }));
    assert.equal(f.writes.length, 0);
    const sok = out.find((o) => o.slug === 'duong-hoa-dua-sokfarm-d6c685')!;
    assert.equal(sok.status, 'DRY_RUN');
    assert.equal(sok.cutout, 'OK');
    assert.ok(f.fetched.length >= 1);
  });

  it('apply: bản nháp enabled=false, qua parseStoryConfig và bộ kiểm chữ, cutoutUrl trỏ ô ảnh vừa nối, ảnh cũ nguyên vẹn', async () => {
    const r = row();
    const f = await fake([r]);
    const out = await seedDrafts(f.deps, a({ apply: true, forceDraft: false }));
    assert.equal(out.find((o) => o.slug === r.slug)!.status, 'APPLIED');
    assert.equal(f.writes.length, 1);
    const w = f.writes[0]!;
    assert.equal(w.id, 'p1');
    const cfg = w.storyConfig as ProductStoryConfig;
    assert.equal(cfg.enabled, false);
    assert.equal(parseStoryConfig(cfg).ok, true);
    assert.deepEqual(storyDraftProblems(cfg), []);
    assert.equal(cfg.cutoutUrl, '/public-image/product/p1/1');
    assert.deepEqual(w.images.slice(0, 1), r.images);
    assert.match(w.images[1]!, /^data:image\/webp;base64,/);
    assert.deepEqual(w.expectImages, r.images);
    assert.ok(
      cfg.scenes.some((s) => s.kind === 'variant_arc'),
      'giữ vòng cung từ phân loại thật',
    );
    assert.ok(cfg.scenes.some((s) => s.kind === 'ingredient_assembly'));
    assert.equal(w.overwrite, false);
  });

  it('đã có storyConfig do người dùng lưu: không ghi đè, không tải ảnh', async () => {
    const mine = { version: 1, enabled: true, scenes: [] };
    const r = row({ storyConfig: mine });
    const f = await fake([r]);
    const out = await seedDrafts(f.deps, a({ apply: true, forceDraft: false }));
    const o = out.find((x) => x.slug === r.slug)!;
    assert.equal(o.status, 'SKIPPED');
    assert.match(o.reason ?? '', /đã có/);
    assert.equal(f.writes.length, 0);
    assert.equal(f.fetched.length, 0);
  });

  it('--force-draft ghi đè storyConfig cũ và tái dùng ô ảnh tách nền cũ, không nối thêm', async () => {
    const old = 'data:image/webp;base64,OLD';
    const r = row({
      images: [...row().images, old],
      storyConfig: {
        version: 1,
        enabled: true,
        scenes: [],
        cutoutUrl: '/public-image/product/p1/1',
      },
    });
    const f = await fake([r]);
    const out = await seedDrafts(f.deps, a({ apply: true, forceDraft: true }));
    assert.equal(out.find((x) => x.slug === r.slug)!.status, 'APPLIED');
    const w = f.writes[0]!;
    assert.equal(w.images.length, 2);
    assert.notEqual(w.images[1], old);
    assert.equal((w.storyConfig as ProductStoryConfig).enabled, false);
    assert.equal(w.overwrite, true);
  });

  it('chạy hai lần: lần hai bỏ qua vì lần một đã ghi storyConfig (idempotent)', async () => {
    const r = row();
    const f = await fake([r]);
    await seedDrafts(f.deps, a({ apply: true, forceDraft: false }));
    const w = f.writes[0]!;
    r.images = w.images;
    r.storyConfig = w.storyConfig;
    const second = await seedDrafts(f.deps, a({ apply: true, forceDraft: false }));
    assert.equal(second.find((x) => x.slug === r.slug)!.status, 'SKIPPED');
    assert.equal(f.writes.length, 1);
  });

  it('ảnh nguồn đã duyệt không còn trong sản phẩm: vẫn dựng bản nháp nhưng không có ảnh tách nền, ghi rõ lý do', async () => {
    const r = row({ images: ['https://content.pancake.vn/2-25/other.png'] });
    const f = await fake([r]);
    const out = await seedDrafts(f.deps, a({ apply: true, forceDraft: false }));
    const o = out.find((x) => x.slug === r.slug)!;
    assert.equal(o.status, 'APPLIED');
    assert.equal(o.cutout, 'NO_CUTOUT');
    assert.match(o.cutoutReason ?? '', /nguồn/);
    const w = f.writes[0]!;
    assert.equal((w.storyConfig as ProductStoryConfig).cutoutUrl, undefined);
    assert.deepEqual(w.images, r.images);
  });

  it('sản phẩm chưa có công thức ảnh (BH.NONG, Fuwa3e nền không trắng): vẫn có bản nháp enabled=false, không ảnh tách nền', async () => {
    const r = row({
      id: 'p4',
      slug: 'nuoc-rua-chen-fuwa3e-3-8l-ef3979',
      name: 'Nước rửa chén Fuwa3e 3,8L',
      variations: [{ id: 'v1', name: '3,8L', attributes: [] }],
    });
    const f = await fake([r]);
    const out = await seedDrafts(f.deps, a({ apply: true, forceDraft: false }));
    const o = out.find((x) => x.slug === r.slug)!;
    assert.equal(o.status, 'APPLIED');
    assert.equal(o.cutout, 'NO_CUTOUT');
    const cfg = f.writes.find((w) => w.id === 'p4')!.storyConfig as ProductStoryConfig;
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.cutoutUrl, undefined);
    assert.equal(
      cfg.scenes.some((s) => s.kind === 'variant_arc'),
      false,
    );
  });

  it('ảnh nguồn nền màu làm ảnh tách nền hỏng: bản nháp vẫn ghi, ảnh tách nền bị bỏ với lý do', async () => {
    const r = row();
    const f = await fake([r], { image: await poster({ bg: [250, 170, 40] }) });
    const out = await seedDrafts(f.deps, a({ apply: true, forceDraft: false }));
    const o = out.find((x) => x.slug === r.slug)!;
    assert.equal(o.status, 'APPLIED');
    assert.equal(o.cutout, 'NO_CUTOUT');
    assert.equal(f.writes[0]!.images.length, r.images.length);
  });

  it('không có sản phẩm trong DB: NOT_FOUND, không ném lỗi, các sản phẩm khác vẫn chạy', async () => {
    const f = await fake([row()]);
    const out = await seedDrafts(f.deps, a({ apply: false, forceDraft: false }));
    assert.equal(out.length, 4);
    assert.equal(out.filter((o) => o.status === 'NOT_FOUND').length, 3);
  });

  it('ghi có điều kiện thất bại (ảnh hay storyConfig đổi giữa chừng, ví dụ Pancake đồng bộ): FAILED, không báo APPLIED', async () => {
    const r = row();
    const f = await fake([r], { writeOk: false });
    const out = await seedDrafts(f.deps, a({ apply: true, forceDraft: false }));
    const o = out.find((x) => x.slug === r.slug)!;
    assert.equal(o.status, 'FAILED');
    assert.match(o.reason ?? '', /đổi giữa chừng/);
  });

  it('mọi bản nháp ghi ra đều enabled=false, kể cả khi mẫu gốc bật sẵn', async () => {
    const rows = FLAGSHIP.map((fl, i) =>
      row({
        id: `p${i}`,
        slug: fl.slug,
        variations: [
          { id: `v${i}a`, name: 'A', attributes: [] },
          { id: `v${i}b`, name: 'B', attributes: [] },
        ],
      }),
    );
    const f = await fake(rows);
    await seedDrafts(f.deps, a({ apply: true, forceDraft: false }));
    assert.equal(f.writes.length, 4);
    for (const w of f.writes) assert.equal((w.storyConfig as ProductStoryConfig).enabled, false);
  });
});

describe('seedDrafts — mặc định an toàn với khách', () => {
  const four = () =>
    FLAGSHIP.map((fl, i) =>
      row({
        id: `p${i}`,
        slug: fl.slug,
        variations: [
          { id: `v${i}a`, name: 'A', attributes: [] },
          { id: `v${i}b`, name: 'B', attributes: [] },
        ],
      }),
    );

  it('cả bốn sản phẩm chủ lực đang hiện kịch bản mẫu công khai: --apply mặc định không ghi gì và nói rõ vì sao (ghi nháp enabled=false sẽ ẩn câu chuyện khách đang thấy)', async () => {
    const f = await fake(four());
    const out = await seedDrafts(f.deps, parseArgs(['--apply']));
    assert.equal(f.writes.length, 0);
    assert.equal(f.fetched.length, 0);
    assert.deepEqual(
      out.map((o) => o.status),
      ['SKIPPED', 'SKIPPED', 'SKIPPED', 'SKIPPED'],
    );
    for (const o of out) assert.match(o.reason ?? '', /khách đang thấy.*ẩn|ẩn.*khách đang thấy/);
  });

  it('dry-run mặc định báo đúng điều --apply sẽ làm (bỏ qua vì đang công khai), không tải ảnh', async () => {
    const f = await fake(four());
    const out = await seedDrafts(f.deps, parseArgs([]));
    assert.equal(out.filter((o) => o.status === 'SKIPPED').length, 4);
    assert.equal(f.fetched.length, 0);
  });

  it('--allow-hide-live: ghi bản nháp enabled=false nhưng KHÔNG đụng products.images và không có cutoutUrl (ảnh tách nền cần cờ riêng)', async () => {
    const r = row();
    const f = await fake([r]);
    const out = await seedDrafts(f.deps, parseArgs(['--apply', '--allow-hide-live']));
    const o = out.find((x) => x.slug === r.slug)!;
    assert.equal(o.status, 'APPLIED');
    assert.equal(o.cutout, 'NO_CUTOUT');
    assert.match(o.cutoutReason ?? '', /--write-cutout/);
    assert.equal(f.fetched.length, 0);
    const w = f.writes[0]!;
    assert.deepEqual(w.images, r.images);
    assert.deepEqual(w.expectImages, r.images);
    assert.equal((w.storyConfig as ProductStoryConfig).enabled, false);
    assert.equal((w.storyConfig as ProductStoryConfig).cutoutUrl, undefined);
  });

  it('--allow-hide-live --write-cutout: mới nối ảnh tách nền vào products.images', async () => {
    const r = row();
    const f = await fake([r]);
    await seedDrafts(f.deps, parseArgs(['--apply', '--allow-hide-live', '--write-cutout']));
    const w = f.writes[0]!;
    assert.equal(w.images.length, r.images.length + 1);
    assert.equal((w.storyConfig as ProductStoryConfig).cutoutUrl, '/public-image/product/p1/1');
  });

  it('--force-draft lên storyConfig đã lưu và đang bật vẫn bị chặn nếu chưa có --allow-hide-live', async () => {
    const r = row({ storyConfig: { version: 1, enabled: true, scenes: [] } });
    const f = await fake([r]);
    const out = await seedDrafts(f.deps, parseArgs(['--apply', '--force-draft']));
    const o = out.find((x) => x.slug === r.slug)!;
    assert.equal(o.status, 'SKIPPED');
    assert.match(o.reason ?? '', /khách đang thấy/);
    assert.equal(f.writes.length, 0);
  });

  it('storyConfig đã lưu mà đang tắt (khách không thấy gì): ghi lại bản nháp bằng --force-draft không cần --allow-hide-live', async () => {
    const r = row({ storyConfig: { version: 1, enabled: false, scenes: [] } });
    const f = await fake([r]);
    const out = await seedDrafts(f.deps, parseArgs(['--apply', '--force-draft']));
    assert.equal(out.find((x) => x.slug === r.slug)!.status, 'APPLIED');
    assert.equal(f.writes.length, 1);
  });
});
