/** Nhãn mẫu đủ nội dung (bìa, câu chuyện, ảnh câu chuyện, xuất xứ, chứng nhận) để chụp ảnh so Mini App với web. */
const svg = (from: string, to: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="480" height="320" fill="url(#g)"/></svg>`)}`;

export const DEMO_BRAND_CONTENT = {
  tagline: 'Mỹ phẩm thiên nhiên từ rau má',
  story: 'Visante khởi nguồn từ vùng đất Tây Nguyên, nơi rau má mọc quanh năm bên những con suối trong.\n\nMỗi lô nguyên liệu được thu hái thủ công, ép lạnh trong ngày và kiểm nghiệm trước khi đóng chai.',
  origin: 'Lâm Đồng, Việt Nam',
  isVerified: true,
  isPublished: true,
  followerCount: 12,
  coverUrl: null,
  storyImages: [svg('#c9a66b', '#f1e2c4'), svg('#7aa874', '#d9ecd2'), svg('#b87a4b', '#f0d3b8')],
  certifications: [
    { code: 'VEGAN', label: 'Vegan', proofUrl: null, verified: true },
    { code: 'ORGANIC', label: 'USDA Organic', proofUrl: null, verified: true },
  ],
};
