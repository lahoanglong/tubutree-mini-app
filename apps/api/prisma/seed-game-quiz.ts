import { PrismaClient } from '@prisma/client';

interface SeedQuiz {
  id: string;
  question: string;
  options: string[];
  correct: number;
  category: string;
  difficulty: number;
  explanation: string;
  waterReward: number;
}

const QUIZZES: SeedQuiz[] = [
  // === CAY (cây cối) — 6 câu ===
  {
    id: 'nq_cay_1', category: 'cay', difficulty: 1, waterReward: 8,
    question: 'Một cây xanh trưởng thành hấp thụ khoảng bao nhiêu CO₂ mỗi năm?',
    options: ['~2 kg', '~21 kg', '~200 kg', '~2 tấn'],
    correct: 1,
    explanation: 'Trung bình ~21 kg CO₂/cây/năm — vì vậy trồng rừng là giải pháp giảm khí nhà kính hiệu quả.',
  },
  {
    id: 'nq_cay_2', category: 'cay', difficulty: 1, waterReward: 8,
    question: 'Quang hợp là quá trình cây xanh làm gì?',
    options: [
      'Hút nước từ đất',
      'Chuyển CO₂ và ánh sáng thành đường và O₂',
      'Phân hủy lá khô',
      'Hút khoáng từ đất',
    ],
    correct: 1,
    explanation: 'Quang hợp chuyển hóa CO₂ + H₂O + ánh sáng → glucose + O₂, cung cấp oxy cho sự sống.',
  },
  {
    id: 'nq_cay_3', category: 'cay', difficulty: 2, waterReward: 10,
    question: 'Rừng ngập mặn (đước, mắm) lưu trữ carbon so với rừng nhiệt đới thường như thế nào?',
    options: ['Ít hơn', 'Tương đương', 'Gấp khoảng 4 lần', 'Không lưu trữ'],
    correct: 2,
    explanation: 'Rừng ngập mặn lưu carbon trong bùn gấp ~4 lần rừng nhiệt đới thường nhờ tích lũy vật chất hữu cơ dưới đáy ngập.',
  },
  {
    id: 'nq_cay_4', category: 'cay', difficulty: 2, waterReward: 10,
    question: 'Loài cây nào ở Việt Nam được gọi là "cây di sản" do sống hàng trăm năm?',
    options: ['Cây bạch đàn', 'Cây xà cừ', 'Cây đa', 'Cây keo'],
    correct: 2,
    explanation: 'Cây đa (Ficus benghalensis) thường sống hàng trăm năm, nhiều cây cổ thụ được công nhận là cây di sản Việt Nam.',
  },
  {
    id: 'nq_cay_5', category: 'cay', difficulty: 3, waterReward: 12,
    question: 'Hiện tượng "mưa rừng" xảy ra khi nào?',
    options: [
      'Cây tiết nước ra không khí qua thoát hơi nước, hình thành mây cục bộ',
      'Nước mưa thấm vào đất rừng',
      'Lá cây hứng sương đêm',
      'Rễ cây hút nước ngầm lên',
    ],
    correct: 0,
    explanation: 'Cây thoát hơi nước (transpiration) tạo độ ẩm không khí, góp phần hình thành mây và mưa cục bộ trong rừng nhiệt đới.',
  },
  {
    id: 'nq_cay_6', category: 'cay', difficulty: 3, waterReward: 12,
    question: 'Vì sao phá rừng đầu nguồn gây lũ lụt nghiêm trọng hơn?',
    options: [
      'Cây hút nước nên khi mất cây sẽ có nhiều nước hơn',
      'Rễ cây giữ đất, tán cây hấp thụ mưa — mất cây khiến nước chảy thẳng và cuốn đất',
      'Rừng đầu nguồn tạo ra mưa nhiều hơn',
      'Đất rừng cứng hơn, không thấm nước',
    ],
    correct: 1,
    explanation: 'Rễ cây giữ đất và tán cây làm chậm dòng chảy; khi rừng mất, nước mưa chảy nhanh hơn, gây lũ quét và xói lở.',
  },

  // === NUOC (nước) — 6 câu ===
  {
    id: 'nq_nuoc_1', category: 'nuoc', difficulty: 1, waterReward: 8,
    question: 'Chỉ bao nhiêu phần trăm nước trên Trái Đất là nước ngọt có thể dùng được?',
    options: ['1%', '3%', '10%', '30%'],
    correct: 0,
    explanation: 'Chỉ khoảng 1% nước Trái Đất là nước ngọt dễ tiếp cận (sông, hồ, nước ngầm nông) — phần còn lại là biển mặn hoặc băng.',
  },
  {
    id: 'nq_nuoc_2', category: 'nuoc', difficulty: 1, waterReward: 8,
    question: 'Đồng bằng sông Cửu Long đang đối mặt với nguy cơ gì liên quan đến nước?',
    options: [
      'Dư thừa nước ngọt',
      'Xâm nhập mặn và sụt lún đất do khai thác nước ngầm quá mức',
      'Băng tan từ Himalayas',
      'Ô nhiễm phóng xạ',
    ],
    correct: 1,
    explanation: 'ĐBSCL đang sụt lún và bị xâm nhập mặn nghiêm trọng do khai thác nước ngầm quá mức kết hợp nước biển dâng.',
  },
  {
    id: 'nq_nuoc_3', category: 'nuoc', difficulty: 2, waterReward: 10,
    question: 'Sản xuất 1 kg thịt bò cần khoảng bao nhiêu lít nước?',
    options: ['~50 lít', '~500 lít', '~15.000 lít', '~150.000 lít'],
    correct: 2,
    explanation: 'Sản xuất 1 kg thịt bò cần ~15.000 lít nước (uống + tưới thức ăn gia súc) — gấp 15 lần so với 1 kg rau củ.',
  },
  {
    id: 'nq_nuoc_4', category: 'nuoc', difficulty: 2, waterReward: 10,
    question: 'Hệ thống lọc nước tự nhiên hiệu quả nhất là gì?',
    options: ['Sa mạc', 'Vùng đất ngập nước (wetlands)', 'Cao nguyên đá', 'Đồng cỏ'],
    correct: 1,
    explanation: 'Vùng đất ngập nước (đầm lầy, hồ nước, bãi sậy) lọc chất ô nhiễm tự nhiên và được ví như "thận" của Trái Đất.',
  },
  {
    id: 'nq_nuoc_5', category: 'nuoc', difficulty: 3, waterReward: 12,
    question: 'Tại sao nước biển không dùng uống trực tiếp được?',
    options: [
      'Nước biển có chứa vi khuẩn',
      'Nồng độ muối cao làm tế bào mất nước qua thẩm thấu, gây mất nước nặng hơn',
      'Nước biển quá nặng',
      'Nước biển có độ pH quá thấp',
    ],
    correct: 1,
    explanation: 'Uống nước biển khiến thận phải bài tiết muối nhiều hơn lượng nước đưa vào, dẫn đến mất nước và tử vong nếu không bổ sung nước ngọt.',
  },
  {
    id: 'nq_nuoc_6', category: 'nuoc', difficulty: 3, waterReward: 12,
    question: 'Công nghệ nào giúp tái sử dụng nước thải đô thị thành nước tưới cây an toàn?',
    options: [
      'Chỉ cần lọc qua cát',
      'Xử lý sinh học + lọc màng + khử trùng UV',
      'Đun sôi rồi để nguội',
      'Thêm phèn chua',
    ],
    correct: 1,
    explanation: 'Xử lý sinh học kết hợp lọc màng MBR và khử trùng UV cho phép tái sử dụng nước thải đô thị an toàn cho tưới tiêu nông nghiệp.',
  },

  // === DAT (đất) — 6 câu ===
  {
    id: 'nq_dat_1', category: 'dat', difficulty: 1, waterReward: 8,
    question: 'Đất tốt (đất mùn) có màu gì và vì sao?',
    options: [
      'Màu đỏ do nhiều sắt',
      'Màu đen/nâu sẫm do chất hữu cơ phân hủy (mùn)',
      'Màu trắng do nhiều canxi',
      'Màu vàng do nhiều lưu huỳnh',
    ],
    correct: 1,
    explanation: 'Chất hữu cơ (mùn) tạo màu đen/nâu sẫm cho đất, giúp đất tơi xốp, giữ nước và cung cấp dinh dưỡng cho cây.',
  },
  {
    id: 'nq_dat_2', category: 'dat', difficulty: 1, waterReward: 8,
    question: 'Để tạo ra 1 cm đất màu tự nhiên cần bao lâu?',
    options: ['1 năm', '10 năm', '100-1.000 năm', '1 triệu năm'],
    correct: 2,
    explanation: 'Tự nhiên cần 100 đến 1.000 năm để tạo ra 1 cm đất màu — đây là lý do bảo vệ đất khỏi xói mòn rất quan trọng.',
  },
  {
    id: 'nq_dat_3', category: 'dat', difficulty: 2, waterReward: 10,
    question: 'Phân compost (phân hữu cơ tự ủ) giúp đất như thế nào?',
    options: [
      'Làm đất cứng và ổn định hơn',
      'Bổ sung vi sinh vật có lợi, cải thiện cấu trúc và dinh dưỡng đất',
      'Làm đất khô ráo hơn',
      'Diệt sâu hại trong đất',
    ],
    correct: 1,
    explanation: 'Compost bổ sung vi sinh vật có lợi, cải thiện cấu trúc đất, tăng khả năng giữ nước và cung cấp dưỡng chất từ từ cho cây.',
  },
  {
    id: 'nq_dat_4', category: 'dat', difficulty: 2, waterReward: 10,
    question: 'Sa mạc hóa là gì?',
    options: [
      'Biến rừng thành sa mạc tự nhiên',
      'Đất màu mỡ bị thoái hóa thành đất khô cằn do canh tác sai và mất thảm thực vật',
      'Cát biển tràn vào đất liền',
      'Khí hậu biến đổi làm tăng nhiệt độ',
    ],
    correct: 1,
    explanation: 'Sa mạc hóa xảy ra khi đất màu mỡ bị thoái hóa do chặt phá rừng, chăn thả quá mức và canh tác không bền vững.',
  },
  {
    id: 'nq_dat_5', category: 'dat', difficulty: 3, waterReward: 12,
    question: 'Giun đất đóng vai trò gì trong hệ sinh thái đất?',
    options: [
      'Cạnh tranh dinh dưỡng với cây trồng',
      'Xới đất, phân hủy hữu cơ và thải phân giàu dinh dưỡng, tăng thông khí đất',
      'Tiêu diệt vi khuẩn có hại trong đất',
      'Hút kim loại nặng độc hại ra khỏi đất',
    ],
    correct: 1,
    explanation: 'Giun đất xới tơi đất, phân hủy chất hữu cơ thành mùn và thải phân (vermicompost) giàu dinh dưỡng — "kỹ sư sinh thái" của đất.',
  },
  {
    id: 'nq_dat_6', category: 'dat', difficulty: 3, waterReward: 12,
    question: 'Vì sao canh tác "không cày xới" (no-till farming) được khuyến khích?',
    options: [
      'Giúp tiết kiệm nhiên liệu máy cày',
      'Giữ cấu trúc đất, bảo tồn vi sinh vật và giảm phát thải CO₂ từ đất',
      'Làm đất cứng hơn để chống xói mòn',
      'Tăng nhanh sản lượng vụ mùa',
    ],
    correct: 1,
    explanation: 'Không cày xới giữ nguyên cấu trúc đất, bảo tồn vi sinh vật có lợi và ngăn CO₂ lưu trong đất thoát ra khí quyển.',
  },

  // === KHONG_KHI (không khí/khí hậu) — 6 câu ===
  {
    id: 'nq_khong_khi_1', category: 'khong_khi', difficulty: 1, waterReward: 8,
    question: 'Khí nhà kính chủ yếu gây biến đổi khí hậu là gì?',
    options: ['O₂ (oxy)', 'CO₂ (carbon dioxide)', 'N₂ (nitơ)', 'H₂ (hydro)'],
    correct: 1,
    explanation: 'CO₂ từ đốt nhiên liệu hóa thạch là khí nhà kính chủ yếu, giữ nhiệt trong khí quyển và gây nóng lên toàn cầu.',
  },
  {
    id: 'nq_khong_khi_2', category: 'khong_khi', difficulty: 1, waterReward: 8,
    question: 'Chỉ số AQI đo lường điều gì?',
    options: [
      'Nhiệt độ không khí',
      'Chất lượng không khí — lượng bụi và chất ô nhiễm',
      'Độ ẩm không khí',
      'Tốc độ gió',
    ],
    correct: 1,
    explanation: 'AQI (Air Quality Index) phản ánh nồng độ bụi PM2.5, PM10, NO₂, O₃ — AQI > 150 là không khí có hại cho sức khỏe.',
  },
  {
    id: 'nq_khong_khi_3', category: 'khong_khi', difficulty: 2, waterReward: 10,
    question: 'Hiệu ứng nhà kính tự nhiên quan trọng vì lý do gì?',
    options: [
      'Nó làm Trái Đất đủ ấm để duy trì sự sống (~15°C trung bình)',
      'Nó tạo ra oxy cho sinh vật hô hấp',
      'Nó bảo vệ Trái Đất khỏi thiên thạch',
      'Nó làm cho mưa rơi đều đặn',
    ],
    correct: 0,
    explanation: 'Hiệu ứng nhà kính tự nhiên giữ nhiệt độ Trái Đất ở ~15°C; không có nó nhiệt độ sẽ là -18°C và sự sống không thể tồn tại.',
  },
  {
    id: 'nq_khong_khi_4', category: 'khong_khi', difficulty: 2, waterReward: 10,
    question: 'Loại phương tiện di chuyển nào phát thải CO₂ ít nhất trên mỗi km?',
    options: ['Ô tô xăng', 'Xe máy xăng', 'Xe đạp điện hoặc xe đạp thường', 'Máy bay'],
    correct: 2,
    explanation: 'Xe đạp điện phát thải ~10-20g CO₂/km (tính cả sản xuất điện); ô tô xăng ~120-200g/km — chênh nhau 10-20 lần.',
  },
  {
    id: 'nq_khong_khi_5', category: 'khong_khi', difficulty: 3, waterReward: 12,
    question: 'Bụi mịn PM2.5 nguy hiểm hơn PM10 vì lý do gì?',
    options: [
      'PM2.5 nặng hơn nên lắng xuống nhanh',
      'PM2.5 nhỏ hơn 2.5 micromet, xâm nhập sâu vào phế nang và vào máu',
      'PM2.5 chứa nhiều kim loại nặng hơn',
      'PM2.5 gây dị ứng da nặng hơn',
    ],
    correct: 1,
    explanation: 'Hạt PM2.5 (< 2.5 µm) đủ nhỏ để qua lớp lông mũi, vào phế nang và thẩm thấu vào máu, gây bệnh tim mạch và ung thư phổi.',
  },
  {
    id: 'nq_khong_khi_6', category: 'khong_khi', difficulty: 3, waterReward: 12,
    question: 'Tầng ozone bảo vệ Trái Đất khỏi điều gì?',
    options: [
      'Bức xạ hồng ngoại (nhiệt)',
      'Tia cực tím UV-B và UV-C từ Mặt Trời',
      'Gió mặt trời',
      'Vi thiên thạch',
    ],
    correct: 1,
    explanation: 'Tầng ozone (O₃) hấp thụ 97-99% tia UV-B và UV-C có hại từ Mặt Trời, bảo vệ sinh vật khỏi ung thư da và đột biến ADN.',
  },

  // === DONG_VAT (động vật) — 6 câu ===
  {
    id: 'nq_dong_vat_1', category: 'dong_vat', difficulty: 1, waterReward: 8,
    question: 'Loài nào là "kỹ sư sinh thái" quan trọng nhất ở đại dương?',
    options: ['Cá mập', 'San hô', 'Cá voi', 'Bạch tuộc'],
    correct: 2,
    explanation: 'Cá voi tuần hoàn dinh dưỡng từ đáy biển lên mặt nước qua phân, kích thích phytoplankton phát triển — tạo ~50% oxy Trái Đất.',
  },
  {
    id: 'nq_dong_vat_2', category: 'dong_vat', difficulty: 1, waterReward: 8,
    question: 'Vì sao ong mật quan trọng với nông nghiệp?',
    options: [
      'Ong tạo ra mật ngọt để con người ăn',
      'Ong thụ phấn cho ~70% cây lương thực và cây ăn quả',
      'Ong diệt sâu hại cây trồng',
      'Ong tạo ra sáp dùng trong công nghiệp',
    ],
    correct: 1,
    explanation: 'Khoảng 70% cây lương thực thế giới phụ thuộc vào ong thụ phấn — mất ong mật đe dọa an ninh lương thực toàn cầu.',
  },
  {
    id: 'nq_dong_vat_3', category: 'dong_vat', difficulty: 2, waterReward: 10,
    question: 'Sao la (Pseudoryx nghetinhensis) là loài đặc hữu ở đâu?',
    options: [
      'Rừng Amazon',
      'Dãy Trường Sơn, biên giới Việt Nam – Lào',
      'Tây Nguyên Việt Nam',
      'Rừng Borneo, Malaysia',
    ],
    correct: 1,
    explanation: 'Sao la — "kỳ lân châu Á" — chỉ sống ở rừng Trường Sơn Việt Nam và Lào, là một trong những loài thú hiếm nhất thế giới.',
  },
  {
    id: 'nq_dong_vat_4', category: 'dong_vat', difficulty: 2, waterReward: 10,
    question: 'Voi châu Á đóng vai trò sinh thái quan trọng nào trong rừng?',
    options: [
      'Kiểm soát dân số hổ',
      'Phát tán hạt giống cây lớn qua phân, giúp tái sinh rừng',
      'Làm sạch nguồn nước sông',
      'Ngăn lũ lụt bằng cách uống nhiều nước',
    ],
    correct: 1,
    explanation: 'Voi châu Á ăn quả rừng, hạt giống đi qua ruột voi nguyên vẹn và nảy mầm tốt hơn — voi là "người trồng rừng" tự nhiên.',
  },
  {
    id: 'nq_dong_vat_5', category: 'dong_vat', difficulty: 3, waterReward: 12,
    question: 'Đa dạng sinh học cao giúp hệ sinh thái như thế nào?',
    options: [
      'Chỉ làm tăng số lượng loài, không ảnh hưởng chức năng',
      'Tăng khả năng phục hồi sau sự cố (hạn hán, dịch bệnh) vì nhiều loài cùng thực hiện các chức năng',
      'Làm giảm cạnh tranh thức ăn, các loài sống dễ hơn',
      'Ngăn ngừa các loài xâm lấn',
    ],
    correct: 1,
    explanation: 'Hệ sinh thái đa dạng có "dự phòng chức năng" — nếu một loài mất đi, loài khác thực hiện vai trò tương tự, hệ sinh thái vẫn ổn định.',
  },
  {
    id: 'nq_dong_vat_6', category: 'dong_vat', difficulty: 3, waterReward: 12,
    question: 'Vì sao cá mập đầu búa sống ở vùng nước nông đặc biệt dễ bị đánh bắt?',
    options: [
      'Chúng bơi chậm hơn các loài khác',
      'Chúng có thói quen tụ tập theo đàn lớn ở vùng nước cạn ven bờ để săn mồi',
      'Chúng không có bong bóng hơi nên không thoát khỏi lưới',
      'Chúng có vây rất dễ nhìn thấy',
    ],
    correct: 1,
    explanation: 'Cá mập đầu búa thường tụ tập thành đàn hàng trăm con ở vùng nước cạn — tập tính này khiến chúng cực kỳ dễ bị đánh bắt đại trà.',
  },

  // === TAI_CHE (tái chế) — 6 câu ===
  {
    id: 'nq_tai_che_1', category: 'tai_che', difficulty: 1, waterReward: 8,
    question: 'Nhựa ký hiệu số 1 (PET) thường được tái chế thành sản phẩm gì?',
    options: ['Xăng dầu', 'Sợi vải polyester và chai nhựa mới', 'Phân bón', 'Giấy'],
    correct: 1,
    explanation: 'Nhựa PET (số 1) được tái chế thành sợi polyester dệt vải (áo, túi) và chai nhựa mới — một chiếc áo fleece dùng khoảng 25 chai PET.',
  },
  {
    id: 'nq_tai_che_2', category: 'tai_che', difficulty: 1, waterReward: 8,
    question: 'Lon nhôm tái chế tiết kiệm năng lượng so với sản xuất nhôm từ quặng là bao nhiêu?',
    options: ['~5%', '~25%', '~95%', '~50%'],
    correct: 2,
    explanation: 'Tái chế nhôm tiết kiệm ~95% năng lượng so với khai thác quặng bauxite — đây là lý do lon nhôm có giá trị tái chế rất cao.',
  },
  {
    id: 'nq_tai_che_3', category: 'tai_che', difficulty: 2, waterReward: 10,
    question: 'Quy tắc "3R" trong quản lý rác thải là gì?',
    options: [
      'Reduce (giảm), Reuse (dùng lại), Recycle (tái chế)',
      'Remove (loại bỏ), Repair (sửa), Replace (thay thế)',
      'Reduce (giảm), Reject (từ chối), Recover (phục hồi)',
      'Rethink (suy nghĩ lại), Redesign (thiết kế lại), Rebuild (xây dựng lại)',
    ],
    correct: 0,
    explanation: '3R: Reduce (giảm phát sinh rác) → Reuse (tái sử dụng) → Recycle (tái chế) — thứ tự ưu tiên này giảm tác động môi trường hiệu quả nhất.',
  },
  {
    id: 'nq_tai_che_4', category: 'tai_che', difficulty: 2, waterReward: 10,
    question: 'Túi nilon mất bao lâu để phân hủy trong tự nhiên?',
    options: ['1-5 năm', '10-20 năm', '400-1.000 năm', '10.000 năm'],
    correct: 2,
    explanation: 'Túi nilon mất 400-1.000 năm để phân hủy hoàn toàn; trong quá trình đó chúng vỡ thành vi nhựa, xâm nhập chuỗi thức ăn.',
  },
  {
    id: 'nq_tai_che_5', category: 'tai_che', difficulty: 3, waterReward: 12,
    question: 'Vi nhựa (microplastic) gây hại như thế nào cho sinh vật biển?',
    options: [
      'Gây ô nhiễm nhiệt nước biển',
      'Sinh vật nhầm vi nhựa là thức ăn, vi nhựa mang chất độc tích tụ trong chuỗi thức ăn',
      'Vi nhựa làm tăng độ mặn nước biển',
      'Vi nhựa ngăn ánh sáng chiếu xuống, ảnh hưởng san hô',
    ],
    correct: 1,
    explanation: 'Cá và động vật biển nuốt vi nhựa vì nhầm là thức ăn; vi nhựa hấp thụ chất độc POPs và tích lũy sinh học lên cao trong chuỗi thực phẩm.',
  },
  {
    id: 'nq_tai_che_6', category: 'tai_che', difficulty: 3, waterReward: 12,
    question: 'Tại sao dầu ăn đã qua sử dụng không nên đổ xuống cống?',
    options: [
      'Dầu gây mùi hôi trong hệ thống thoát nước',
      'Dầu tạo màng trên mặt nước, ngăn O₂ hòa tan, giết chết vi sinh vật xử lý nước thải',
      'Dầu làm tắc nghẽn đường ống',
      'Dầu làm tăng nhiệt độ nước thải',
    ],
    correct: 1,
    explanation: 'Một lít dầu ăn tạo màng trên 1.000 m² mặt nước, ngăn O₂ hòa tan và giết chết vi sinh vật thiếu khí — nên thu gom để làm biodiesel.',
  },

  // === NANG_LUONG (năng lượng) — 7 câu ===
  {
    id: 'nq_nang_luong_1', category: 'nang_luong', difficulty: 1, waterReward: 8,
    question: 'Năng lượng mặt trời thuộc loại năng lượng nào?',
    options: ['Hóa thạch', 'Tái tạo', 'Hạt nhân', 'Địa nhiệt'],
    correct: 1,
    explanation: 'Năng lượng mặt trời là năng lượng tái tạo — Mặt Trời sẽ cung cấp năng lượng ổn định thêm ~5 tỷ năm nữa.',
  },
  {
    id: 'nq_nang_luong_2', category: 'nang_luong', difficulty: 1, waterReward: 8,
    question: 'Việt Nam đứng thứ mấy thế giới về công suất điện mặt trời lắp đặt (tính đến 2023)?',
    options: ['Thứ 50', 'Thứ 30', 'Thứ 10', 'Thứ 5'],
    correct: 2,
    explanation: 'Việt Nam nằm trong top 10 thế giới về công suất điện mặt trời lắp đặt nhờ bùng nổ điện mặt trời mái nhà 2019-2021.',
  },
  {
    id: 'nq_nang_luong_3', category: 'nang_luong', difficulty: 2, waterReward: 10,
    question: 'Bóng đèn LED tiết kiệm điện hơn bóng sợi đốt khoảng bao nhiêu?',
    options: ['~20%', '~50%', '~75-80%', '~99%'],
    correct: 2,
    explanation: 'Bóng LED tiêu thụ ít hơn ~75-80% điện so với bóng sợi đốt để cho cùng độ sáng, đồng thời tuổi thọ gấp 25 lần.',
  },
  {
    id: 'nq_nang_luong_4', category: 'nang_luong', difficulty: 2, waterReward: 10,
    question: 'Điện gió ngoài khơi (offshore wind) có ưu điểm gì so với điện gió trên đất liền?',
    options: [
      'Rẻ hơn do không cần móng cọc',
      'Gió ngoài khơi mạnh và ổn định hơn, không tranh chấp đất đai',
      'Dễ lắp đặt và bảo trì hơn',
      'Không ảnh hưởng đến chim di trú',
    ],
    correct: 1,
    explanation: 'Gió ngoài khơi mạnh hơn ~40% và ổn định hơn trên bờ, đồng thời không chiếm đất canh tác — Việt Nam có tiềm năng offshore wind rất lớn.',
  },
  {
    id: 'nq_nang_luong_5', category: 'nang_luong', difficulty: 2, waterReward: 10,
    question: 'Pin lithium-ion trong điện thoại dùng nguyên tố nào là chính?',
    options: ['Đồng (Cu)', 'Lithium (Li) và Cobalt (Co)', 'Vàng (Au)', 'Silicon (Si)'],
    correct: 1,
    explanation: 'Pin Li-ion dùng lithium ở cực âm và cobalt oxit (thường) ở cực dương — khai thác cobalt gây lo ngại môi trường và nhân quyền.',
  },
  {
    id: 'nq_nang_luong_6', category: 'nang_luong', difficulty: 3, waterReward: 12,
    question: 'Hydro xanh (green hydrogen) được sản xuất như thế nào?',
    options: [
      'Khí hóa than đá với lọc CO₂',
      'Điện phân nước bằng điện tái tạo (gió/mặt trời)',
      'Chưng cất khí tự nhiên (LNG)',
      'Phân hủy sinh học rác hữu cơ',
    ],
    correct: 1,
    explanation: 'Hydro xanh dùng điện tái tạo để điện phân nước (H₂O → H₂ + O₂) — không phát thải CO₂, là nhiên liệu sạch tương lai.',
  },
  {
    id: 'nq_nang_luong_7', category: 'nang_luong', difficulty: 3, waterReward: 12,
    question: 'Vì sao lưới điện thông minh (smart grid) quan trọng với điện tái tạo?',
    options: [
      'Smart grid làm cho điện rẻ hơn',
      'Điện mặt trời/gió không ổn định — smart grid cân bằng cung cầu theo thời gian thực, tích hợp pin lưu trữ',
      'Smart grid loại bỏ nhu cầu đường dây điện',
      'Smart grid ngăn mất điện do bão',
    ],
    correct: 1,
    explanation: 'Điện tái tạo không liên tục (nắng/gió thay đổi); smart grid điều phối sản xuất, lưu trữ và tiêu thụ theo thời gian thực để ổn định hệ thống.',
  },
];

export async function seedGameQuiz(prisma: PrismaClient): Promise<void> {
  for (const q of QUIZZES) {
    await prisma.gameQuiz.upsert({
      where: { id: q.id },
      update: {
        question: q.question,
        options: q.options,
        correct: q.correct,
        category: q.category,
        difficulty: q.difficulty,
        explanation: q.explanation,
        waterReward: q.waterReward,
        rewardPts: 0,
      },
      create: {
        id: q.id,
        question: q.question,
        options: q.options,
        correct: q.correct,
        category: q.category,
        difficulty: q.difficulty,
        explanation: q.explanation,
        waterReward: q.waterReward,
        rewardPts: 0,
      },
    });
  }
  console.log(`[seed] ${QUIZZES.length} câu quiz thiên nhiên`);
}
