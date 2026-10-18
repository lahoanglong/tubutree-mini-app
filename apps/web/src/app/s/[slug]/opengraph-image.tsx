import { OG_SIZE, renderStorefrontOgImage } from './og-render';

export const alt = 'Gian hàng trên Tubu Tree';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const revalidate = 300;

export default function Image({ params }: { params: { slug: string } | Promise<{ slug: string }> }) {
  return renderStorefrontOgImage(params);
}
