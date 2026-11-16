import { HomeQuizCard } from '../game/home-quiz-card';

/** Thẻ chen Chẩn đoán tổ ấm trong lưới Gợi ý của Trang chủ: thẻ mời tĩnh, không gọi API tới khi khách mở sheet (lưới đã lo đệm ngang; Vườn Xanh dùng cùng thẻ, đệm do cột của trang lo). */
export function HomeQuiz() {
  return <HomeQuizCard />;
}
