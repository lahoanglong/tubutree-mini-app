import { PreviewPage, previewMetadata } from '../preview-page';

export const dynamic = 'force-dynamic';
export const metadata = previewMetadata;

/** Đường của wave (`/san-pham/_preview/<slug>?token=…`): dựng y hệt đường hợp đồng, slug chỉ để người đọc URL biết sản phẩm nào. */
export default PreviewPage;
