import 'reflect-metadata';
import { CreateFaqDto } from '../modules/faq/dto/faq.dto';
import { CreateQuickReplyDto } from '../modules/cskh/dto/quick-reply.dto';
import { CreateQuizDto } from '../modules/admin/admin-game-quiz.controller';
import { ProductQuery } from '../modules/catalog/dto/product-query.dto';
import { FeedQuery } from '../modules/feed/feed-query.dto';
import { ListOrdersQuery } from '../modules/admin/admin.controller';
import { ProductQuery as ProductQueryForSlugs } from '../modules/catalog/dto/product-query.dto';
import { DealerRewardDto } from '../modules/brand/dto/brand.dto';
import { createValidationPipe } from './validation-pipe';

/** Nhãn lỗi 400 phải trùng chữ trên ô nhập của màn quản trị để người dùng biết sửa ô nào. */
const pipe = createValidationPipe();
const messages = (metatype: new () => object, value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'body', metatype, data: undefined }).then(() => null, (e: { response: { message: string[] } }) => e.response.message);

describe('nhãn lỗi trùng chữ trên màn quản trị', () => {
  it('category là ô "Nhóm" của form FAQ và Trả lời nhanh', async () => {
    expect(await messages(CreateFaqDto, { question: 'q', answer: 'a', category: 'x'.repeat(101) })).toEqual(['Nhóm không được dài quá 100 ký tự.']);
    expect(await messages(CreateQuickReplyDto, { keywords: [], title: 't', content: 'c', category: 'x'.repeat(61) })).toEqual(['Nhóm không được dài quá 60 ký tự.']);
  });

  it('threshold là ô "Mốc doanh số" của chương trình thưởng đại lý', async () => {
    expect(await messages(DealerRewardDto, { type: 'TOUR', title: 'Tour', threshold: -1 })).toEqual(['Mốc doanh số không được nhỏ hơn 0.']);
  });

  it('category đổi nhãn theo DTO: Chủ đề cho câu đố và bảng tin, Danh mục cho bộ lọc sản phẩm', async () => {
    const quiz = await messages(CreateQuizDto, { question: 'q', options: ['a', 'b'], correct: 0, difficulty: 1, category: 'khong-co' });
    expect(quiz?.[0]).toMatch(/^Chủ đề /);
    expect((await messages(ProductQuery, { category: 5 }))?.[0]).toMatch(/^Danh mục /);
    expect(await messages(FeedQuery, { category: 'x'.repeat(101) })).toEqual(['Chủ đề không được dài quá 100 ký tự.']);
  });

  it('slugs quá 20 mục: câu 400 nêu nhãn trường và số mục tối đa', async () => {
    const slugs = Array.from({ length: 21 }, (_, i) => `s${i}`).join(',');
    expect(await messages(ProductQueryForSlugs, { slugs })).toEqual(['Danh sách sản phẩm chỉ nhận tối đa 20 mục, cách nhau bằng dấu phẩy.']);
  });

  it('storefront là ô "Gian hàng" của bộ lọc đơn', async () => {
    expect(await messages(ListOrdersQuery, { storefront: 'x'.repeat(101) })).toEqual(['Gian hàng không được dài quá 100 ký tự.']);
  });
});
