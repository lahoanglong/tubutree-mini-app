import { Test, type TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PublicImageService } from '../../src/modules/catalog/public-image.service';
import { publicImageVersion } from '../../src/common/public-image';
import { randCode, warmPool } from './helpers';

const PNG_A = 'data:image/png;base64,iVBORw0KGgo=';
const PNG_B = 'data:image/png;base64,iVBORw0KGgoAAAA=';

/** Endpoint ảnh trên Postgres thật: truy vấn `images[n]` tham số hoá và quyền phát theo trạng thái duyệt. */
describe('PublicImageService (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: PublicImageService;
  const ids: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [PublicImageService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    svc = moduleRef.get(PublicImageService);
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
    await moduleRef?.close();
  });

  const product = async (data: Record<string, unknown>) => {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: { pancakeId: `itimg-${tag}`, brand: 'IT', slug: `itimg-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 1000, images: [PNG_A, PNG_B], ...data },
    });
    ids.push(p.id);
    return p;
  };

  it('đọc đúng phần tử theo ô, thumb rơi về ảnh đầu khi thumbnail không phải base64', async () => {
    const p = await product({ thumbnail: `/public-image/product/x/0?v=1` });
    expect((await svc.get('product', p.id, '1', publicImageVersion('product', p.id, 1, PNG_B))).versionOk).toBe(true);
    expect((await svc.get('product', p.id, '0', publicImageVersion('product', p.id, 0, PNG_A))).versionOk).toBe(true);
    expect((await svc.get('product', p.id, 'thumb', publicImageVersion('product', p.id, 'thumb', PNG_A))).versionOk).toBe(true);
    await expect(svc.get('product', p.id, '2', undefined)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('chưa từng được duyệt (chờ duyệt lần đầu, bị từ chối) thì không phát; từng được duyệt rồi chờ duyệt lại thì vẫn phát', async () => {
    const pending = await product({ approvalStatus: 'PENDING_REVIEW' });
    const rejected = await product({ approvalStatus: 'REJECTED' });
    const again = await product({ approvalStatus: 'PENDING_REVIEW', approvedAt: new Date() });
    for (const slot of ['0', 'thumb']) {
      await expect(svc.get('product', pending.id, slot, undefined)).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.get('product', rejected.id, slot, undefined)).rejects.toBeInstanceOf(NotFoundException);
      expect((await svc.get('product', again.id, slot, undefined)).mime).toBe('image/png');
    }
  });
});
