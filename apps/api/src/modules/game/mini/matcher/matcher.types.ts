/** Hợp đồng `/game/matcher*` (app-core `game-mini/matcher.ts` có bản cùng hình dạng, contract spec hai bên giữ khớp). */

export interface MatcherOptionView {
  value: string;
  label: string;
  /** Nhãn của lựa chọn: máy khách dùng để biết câu nào của bước sau hiện (`when`). */
  tags: string[];
}

export interface MatcherQuestionView {
  code: string;
  step: number;
  prompt: string;
  options: MatcherOptionView[];
  when: string[] | null;
}

export interface MatcherTriviaView {
  id: string;
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
  sourceUrl: string;
}

export interface MatcherContentResponse {
  /** Đã sắp theo bước rồi theo mã: mỗi bước lấy câu đầu tiên khớp. */
  questions: MatcherQuestionView[];
  trivia: MatcherTriviaView[];
}

export interface MatcherItemView {
  slug: string;
  productId: string;
  /** Phân loại để thêm vào giỏ (`POST /cart/items/batch`). */
  variationId: string;
  name: string;
  /** Tên phân loại khi sản phẩm có nhiều phân loại; null khi chỉ có một. */
  variationName: string | null;
  imageUrl: string | null;
  /** Giá thẻ (đã gồm Giờ vàng khi rẻ hơn). */
  price: number;
  /** Giá niêm yết của phân loại khi cao hơn giá thẻ (để gạch); null khi không giảm. */
  compareAtPrice: number | null;
  flash: boolean;
  /** "Vì sao hợp với bạn"; rỗng ở bộ dự phòng. */
  why: string;
}

export interface MatcherResultResponse {
  outcomeId: string;
  code: string;
  title: string;
  /** true = bộ chính còn dưới 2 món còn hàng, đây là "Bán chạy còn hàng" của danh mục tương ứng. */
  fallback: boolean;
  items: MatcherItemView[];
  total: number;
  /** 💧 vừa cộng (lượt đầu trong ngày khi game mini bật); 0 khi không có thưởng. */
  water: number;
}

export interface MatcherStatusResponse {
  enabled: boolean;
}
