import { HomeQuizCard } from '../game/home-quiz-card';

/** Khối `quiz` của Trang chủ: thẻ mời tĩnh của Chẩn đoán tổ ấm với đệm ngang của khối (Vườn Xanh dùng cùng thẻ, đệm do cột của trang lo). */
export function HomeQuiz() {
  return (
    <div className="tubu-hqz-gutter">
      <HomeQuizCard />
    </div>
  );
}
