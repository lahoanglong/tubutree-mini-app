import { escapeLike, registrySql, uploadLikePatterns } from './image-registry-query';

describe('registrySql: nguồn ảnh /img được đổi cỡ', () => {
  const text = registrySql(['res.cloudinary.com'], '').text;

  it('có sản phẩm, nhãn, danh mục, đổi rác, banner chiến dịch, ảnh đại diện/bìa gian hàng', () => {
    for (const col of ['"products"', '"brands"', '"categories"', '"waste_items"', '"waste_gifts"', '"campaigns"', '"storefronts"']) expect(text).toContain(col);
    expect(text).toContain('"avatarUrl"');
  });

  it('chiến dịch và gian hàng chỉ nhận host upload tin cậy (tham số LIKE ANY), không nhận mọi https; LIKE chỉ đọc 300 ký tự đầu sau khi left(…, 8) khớp', () => {
    const sql = registrySql(['res.cloudinary.com'], '');
    const likes = ['https://res.cloudinary.com/%'];
    expect(sql.values.filter((v) => Array.isArray(v) && v[0] === likes[0])).toHaveLength(3);
    expect(sql.text.match(/LIKE ANY/g)).toHaveLength(3);
    expect(sql.text.match(/left\((?:s\.)?"(image|avatarUrl|coverUrl)", 8\) = 'https:\/\/' AND left\((?:s\.)?"\1", 300\) LIKE ANY/g)).toHaveLength(3);
  });

  it('gian hàng chỉ tính khi khách thấy được: đã đăng, không bị gỡ, chủ không bị khoá, CTV còn vai trò hưởng hoa hồng và (khi bắt duyệt) đã duyệt; chiến dịch không có điều kiện này', () => {
    const rows = text.split('UNION ALL').filter((r) => r.includes('"storefronts"'));
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r).toContain('s."isPublished" AND s."takenDownAt" IS NULL');
      expect(r).toContain('NOT o."isBlocked"');
      expect(r).toContain('o."role"::text = ANY(');
      expect(r).toContain('s."approvedAt" IS NOT NULL');
    }
    expect(text.split('UNION ALL').find((r) => r.includes('"campaigns"'))).not.toContain('isPublished');
  });

  it('tắt cờ bắt duyệt thì bỏ điều kiện approvedAt; vai trò hưởng hoa hồng lấy từ cấu hình + ADMIN', () => {
    const sql = registrySql(['res.cloudinary.com'], '', { eligibleRoles: ['DEALER'], requireApproval: false });
    expect(sql.text).not.toContain('approvedAt');
    expect(sql.values).toContainEqual(['DEALER', 'ADMIN']);
  });
});

describe('CLOUDINARY_CLOUD_NAME: khoá ảnh upload vào đúng cloud', () => {
  it('không đặt (hoặc chỉ khoảng trắng): chỉ kiểm host', () => {
    expect(uploadLikePatterns(['res.cloudinary.com'], '')).toEqual(['https://res.cloudinary.com/%']);
    expect(uploadLikePatterns(['res.cloudinary.com'], '  ')).toEqual(['https://res.cloudinary.com/%']);
  });

  it('có tên cloud: mẫu là /<cloud>/image/upload/', () => {
    expect(uploadLikePatterns(['res.cloudinary.com'], 'tubutree')).toEqual(['https://res.cloudinary.com/tubutree/image/upload/%']);
    expect(registrySql(['res.cloudinary.com'], 'tubutree').values[0]).toEqual(['https://res.cloudinary.com/tubutree/image/upload/%']);
  });

  it('ký tự đặc biệt của LIKE trong tên cloud được thoát (không thành mẫu so khớp)', () => {
    expect(escapeLike('a_b%c\\d')).toBe('a\\_b\\%c\\\\d');
    expect(uploadLikePatterns(['res.cloudinary.com'], 'a_b%')).toEqual(['https://res.cloudinary.com/a\\_b\\%/image/upload/%']);
  });
});
