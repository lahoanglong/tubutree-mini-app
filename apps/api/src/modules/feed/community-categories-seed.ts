export interface CommunityCategorySeed {
  slug: string;
  name: string;
  icon: string;
  order: number;
}

/**
 * Danh mục hỏi đáp theo ngành hàng Tubu đang bán (danh mục sản phẩm: Mỹ phẩm thiên nhiên, Chăm sóc cá nhân,
 * Tẩy rửa sinh học, Cho bé, Cho mẹ bầu, Cà phê & Đồ uống, Nông sản & Thực phẩm) để câu hỏi gắn được sản phẩm.
 * `hoi-mua-gi` và `meo-hay` giữ slug cũ vì tên của chúng không nói về cây — bài đã đăng ở đó vẫn nguyên chỗ.
 */
export const COMMUNITY_CATEGORIES: CommunityCategorySeed[] = [
  { slug: 'my-pham-ca-nhan', name: 'Mỹ phẩm & cá nhân', icon: '🧴', order: 1 },
  { slug: 'tay-rua-nha-cua', name: 'Tẩy rửa & nhà cửa', icon: '🧼', order: 2 },
  { slug: 'me-va-be', name: 'Mẹ & bé', icon: '👶', order: 3 },
  { slug: 'ca-phe-thuc-pham', name: 'Cà phê & thực phẩm', icon: '☕', order: 4 },
  { slug: 'review-trai-nghiem', name: 'Review & trải nghiệm', icon: '🌿', order: 5 },
  { slug: 'hoi-mua-gi', name: 'Hỏi mua gì', icon: '🛒', order: 6 },
  { slug: 'meo-hay', name: 'Mẹo hay', icon: '💡', order: 7 },
];

/**
 * Danh mục cây cảnh của bản đầu (không khớp hàng đang bán). Chỉ ẨN khỏi danh sách chọn/lọc: bài đã đăng giữ
 * nguyên categoryId nên vẫn hiện ở "Tất cả" với đúng nhãn cũ, không xoá và không gán lại sang chủ đề khác.
 */
export const RETIRED_COMMUNITY_CATEGORY_SLUGS = ['cham-soc', 'sau-benh', 'phoi-canh', 'khoe-vuon'];

/** Không ghi isActive: admin đã tắt tay một danh mục thì lần seed sau không được bật lại. */
export function communityCategoryUpsertArgs(c: CommunityCategorySeed) {
  return {
    where: { slug: c.slug },
    update: { name: c.name, icon: c.icon, order: c.order },
    create: c,
  };
}

export function retireCommunityCategoriesArgs() {
  return {
    where: { slug: { in: RETIRED_COMMUNITY_CATEGORY_SLUGS } },
    data: { isActive: false },
  };
}
