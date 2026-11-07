import { useState, type ReactNode } from 'react';
import { Page } from 'zmp-ui';
import { Truck } from 'lucide-react';
import { GALLERY_STORY_PRODUCTS, GALLERY_COMBO_ITEMS, GALLERY_PICKER_ROWS, GALLERY_SLIDES, GALLERY_SORT_OPTIONS, GALLERY_VOUCHERS, galleryCombo, galleryEnd, type GalleryVoucher } from '@tubutree/app-core/commerce/ds-gallery-data';
import { BannerCarousel } from '../components/ui/banner-carousel';
import { ComboCard } from '../components/ui/combo-card';
import { ProductStoryShowcase } from '../components/ui/product-story-showcase';
import { cartComboBlocks } from '@tubutree/app-core/commerce/cart-combo';
import { CartComboBlock } from '../components/cart-combo-block';
import { Countdown } from '../components/ui/countdown';
import { FlashSoldBar } from '../components/ui/flash-sold-bar';
import { Section } from '../components/ui/section';
import { SectionHeader } from '../components/ui/section-header';
import { SortBar } from '../components/ui/sort-bar';
import { Heading, Text } from '../components/ui/text';
import { VoucherPicker } from '../components/ui/voucher-picker';
import { VoucherTicket } from '../components/ui/voucher-ticket';
import { StoryReelStrip } from '../components/ui/story-reel-strip';
import { FreeShippingProgressBar } from '../components/ui/free-shipping-progress-bar';
import { FreeshipAddonRail } from '../components/ui/freeship-addon-rail';

const GALLERY_REEL_ITEMS = [
  { slug: 'rau-muong', name: 'Rau muống', thumbnail: null, seen: false },
  { slug: 'mat-ong', name: 'Mật ong rừng nguyên chất', thumbnail: null, seen: true },
  { slug: 'dau-goi', name: 'Dầu gội bưởi', thumbnail: null, seen: false },
  { slug: 'nuoc-rua-chen', name: 'Nước rửa chén sinh học', thumbnail: null, seen: false },
];
const GALLERY_ADDON_ITEMS = [
  { slug: 'rau-muong', name: 'Rau muống', thumbnail: null, price: 29_000, variationId: 'v1' },
  { slug: 'mat-ong', name: 'Mật ong rừng', thumbnail: null, price: 39_000, compareAt: 49_000, variationId: 'v2' },
  { slug: 'dau-goi', name: 'Dầu gội bưởi', thumbnail: null, price: 45_000, variationId: 'v3' },
];

/**
 * Trang dev `/ds-gallery`: vẽ mọi biến thể và trạng thái của bộ section-kit bằng dữ liệu giả (app-core/commerce/ds-gallery-data),
 * để thiết kế duyệt và để so Mini App với web ở 375px. Chỉ được nạp khi `import.meta.env.DEV` (xem app.tsx); bản build không có.
 */

const noop = () => {};

/** Khối combo ở giỏ: ba trạng thái dựng bằng đúng hàm chia khối của giỏ, dòng bên trong là khung giữ chỗ (dòng thật là CartLineRow). */
const COMBO_LINES = [{ id: 'a' }, { id: 'b' }];
const comboGroupOf = (title: string) => ({ id: 'g', kind: 'STOREFRONT' as const, title, discount: 65250, lineIds: ['a', 'b'], keyLineIds: ['a', 'b'] });
const comboApplied = cartComboBlocks(COMBO_LINES, [comboGroupOf('Bộ giặt sạch')]).blocks[0]!;
const comboBroken = cartComboBlocks(COMBO_LINES, [comboGroupOf('Bộ giặt sạch')], new Set(['b'])).blocks[0]!;
const comboLong = cartComboBlocks(COMBO_LINES, [comboGroupOf('Bộ giặt tẩy sinh học dành cho gia đình đông người Fuwa3eKhongDauCach0123456789')]).blocks[0]!;
const comboRows = COMBO_LINES.map((l) => (
  <div key={l.id} style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-card)', padding: 12, boxShadow: 'var(--elevation-1)' }}>
    <Text variant="body-sm" as="div">Dòng giỏ {l.id.toUpperCase()}</Text>
  </div>
));

function Group({ name, children }: { name: string; children: ReactNode }) {
  return (
    <Section id={`ds-${name}`} spacing="section" label={name}>
      <Text variant="label" tone="brand" as="div" style={{ marginBottom: 4 }}>
        {name}
      </Text>
      {children}
    </Section>
  );
}

function Variant({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div data-variant={label} style={{ marginTop: 12 }}>
      <Text variant="caption" tone="tertiary" as="div" style={{ marginBottom: 6 }}>
        {label}
      </Text>
      {children}
    </div>
  );
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: '12px 16px',
        border: '1px dashed var(--color-border-strong)',
        borderRadius: 'var(--radius-media)',
        background: 'var(--color-bg-surface)',
        color: 'var(--color-text-secondary)',
        fontSize: 'var(--type-body-sm-size)',
      }}
    >
      {children}
    </div>
  );
}

function SortDemo({ filterCount, withFilter }: { filterCount?: number; withFilter: boolean }) {
  const [value, setValue] = useState('popular');
  return <SortBar value={value} options={GALLERY_SORT_OPTIONS} onChange={setValue} filterCount={filterCount} onFilter={withFilter ? noop : undefined} />;
}

const primaryOf = (v: GalleryVoucher) =>
  v.view.state === 'collectable' ? { label: 'Lưu mã', onClick: noop } : v.view.state === 'saved' || v.view.state === 'ineligible' ? { label: 'Dùng ngay', onClick: noop } : undefined;

const byId = (...ids: string[]) => ids.map((id) => GALLERY_VOUCHERS.find((v) => v.id === id)!);

export default function DsGalleryPage() {
  const [now] = useState(() => Date.now());
  const end = (ms: number) => galleryEnd(ms, now);
  const three = galleryCombo(GALLERY_COMBO_ITEMS.slice(0, 3), 10);
  const five = galleryCombo(GALLERY_COMBO_ITEMS, 15);
  const two = galleryCombo(GALLERY_COMBO_ITEMS.slice(0, 2), 0);

  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <div style={{ padding: '16px 16px 96px' }}>
        <Heading variant="title-lg" as="h1">
          Thư viện thành phần
        </Heading>
        <Text variant="caption" tone="tertiary" as="p" style={{ marginTop: 4 }}>
          Chỉ có ở bản dev. Dữ liệu giả, không gọi mạng.
        </Text>

        <Group name="section-header">
          <Variant label="mặc định, có Xem tất cả">
            <SectionHeader title="Bán chạy nhất" action={{ to: '/ds-gallery' }} />
          </Variant>
          <Variant label="promo, icon tia chớp, đồng hồ">
            <SectionHeader title="Giờ vàng" icon="zap" tone="promo" trailing={<Countdown endAt={end(7_533_000)} mode="clock" />} action={{ to: '/ds-gallery' }} />
          </Variant>
          <Variant label="tiêu đề dài, icon tuỳ chọn, phụ đề">
            <SectionHeader title="Sản phẩm chăm sóc da mặt thuần chay cho da nhạy cảm" icon={Truck} subtitle="Cập nhật mỗi ngày" action={{ to: '/ds-gallery' }} />
          </Variant>
          <Variant label="không hành động, h3">
            <SectionHeader title="Gợi ý cho bạn" as="h3" />
          </Variant>
        </Group>

        <Group name="section">
          <Variant label="block 16px rồi section 24px">
            <div style={{ padding: 8, background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-media)' }}>
              <Placeholder>Khối A</Placeholder>
              <Section id="ds-section-demo-block" spacing="block">
                <Placeholder>Khối B: cách trên 16px (block)</Placeholder>
              </Section>
              <Section id="ds-section-demo-section" spacing="section" label="Khối C">
                <Placeholder>Khối C: cách trên 24px (section), có tên vùng</Placeholder>
              </Section>
            </div>
          </Variant>
          <Variant label="mặc định là block">
            <div style={{ padding: 8, background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-media)' }}>
              <Placeholder>Khối A</Placeholder>
              <Section id="ds-section-demo-default">
                <Placeholder>Khối B: cách trên 16px</Placeholder>
              </Section>
            </div>
          </Variant>
        </Group>

        <Group name="countdown">
          <Variant label="clock, còn hơn 2 giờ">
            <div style={{ display: 'flex' }}>
              <Countdown endAt={end(7_533_000)} mode="clock" />
            </div>
          </Variant>
          <Variant label="clock, dưới 1 phút">
            <div style={{ display: 'flex' }}>
              <Countdown endAt={end(45_000)} mode="clock" />
            </div>
          </Variant>
          <Variant label="text, kết thúc sau">
            <div style={{ display: 'flex' }}>
              <Countdown endAt={end(11_520_000)} mode="text" />
            </div>
          </Variant>
          <Variant label="text, bắt đầu sau">
            <div style={{ display: 'flex' }}>
              <Countdown endAt={end(5_400_000)} mode="text" kind="starts" />
            </div>
          </Variant>
          <Variant label="đã hết giờ: không vẽ gì trong khung">
            <div style={{ display: 'flex', minHeight: 24, border: '1px dashed var(--color-border-strong)', borderRadius: 'var(--radius-tag)' }}>
              <Countdown endAt={end(-1000)} mode="clock" onEnd={noop} />
            </div>
          </Variant>
        </Group>

        <Group name="flash-sold-bar">
          {[
            ['chưa bán', 0, false],
            ['35%', 35, false],
            ['80%', 80, false],
            ['100% chưa đánh dấu hết', 100, false],
            ['hết suất', 100, true],
          ].map(([label, pct, soldOut]) => (
            <Variant key={String(label)} label={String(label)}>
              <div style={{ width: 160 }}>
                <FlashSoldBar soldPct={pct as number} soldOut={soldOut as boolean} />
              </div>
            </Variant>
          ))}
        </Group>

        <Group name="sort-bar">
          <Variant label="có nút Lọc, 3 bộ lọc đang bật">
            <SortDemo withFilter filterCount={3} />
          </Variant>
          <Variant label="có nút Lọc, chưa bật bộ lọc">
            <SortDemo withFilter filterCount={0} />
          </Variant>
          <Variant label="không nút Lọc">
            <SortDemo withFilter={false} />
          </Variant>
        </Group>

        <Group name="voucher-ticket">
          {GALLERY_VOUCHERS.map((v) => (
            <Variant key={`t-${v.id}`} label={`ticket · ${v.view.kind} · ${v.view.state}`}>
              <VoucherTicket voucher={v.view} variant="ticket" primary={primaryOf(v)} reason={v.reason} expiring={v.expiring} onDetail={noop} />
            </Variant>
          ))}
          <Variant label="ticket · đang lưu (busy)">
            <VoucherTicket voucher={GALLERY_VOUCHERS[0]!.view} variant="ticket" primary={{ label: 'Lưu mã', onClick: noop, busy: true }} />
          </Variant>
          <Variant label="chip · collectable, saved, expired, ineligible">
            <div className="scroll-x" style={{ gap: 8 }}>
              {byId('TUBU10', 'FREESHIP', 'HETHAN', 'CHUADU').map((v) => (
                <VoucherTicket key={v.id} voucher={v.view} variant="chip" primary={primaryOf(v)} reason={v.reason} expiring={v.expiring} />
              ))}
            </div>
          </Variant>
          {byId('SHOP10', 'TUBU10', 'CHUADU').map((v) => (
            <Variant key={`r-${v.id}`} label={`row · ${v.view.kind} · ${v.view.state}`}>
              <VoucherTicket voucher={v.view} variant="row" primary={primaryOf(v)} reason={v.reason} expiring={v.expiring} />
            </Variant>
          ))}
        </Group>

        <Group name="voucher-picker">
          <Variant label="đang dùng, chưa đủ (có lý do), không áp dụng; hạn có năm khi khác năm">
            <VoucherPicker rows={GALLERY_PICKER_ROWS} onUse={noop} onRemove={noop} />
          </Variant>
          <Variant label="đang đổi mã (busy)">
            <VoucherPicker rows={GALLERY_PICKER_ROWS} onUse={noop} onRemove={noop} busy />
          </Variant>
        </Group>

        <Group name="combo-card">
          <Variant label="3 món, giảm 10%">
            <ComboCard title="Combo giặt sạch" items={GALLERY_COMBO_ITEMS.slice(0, 3)} pct={10} total={three.total} comboTotal={three.comboTotal} onAddAll={noop} />
          </Variant>
          <Variant label="5 món (còn +2), có món hết hàng nên nút thành Combo tạm hết, có Xem từng món">
            <ComboCard title="Combo cả nhà" items={GALLERY_COMBO_ITEMS} pct={15} total={five.total} comboTotal={five.comboTotal} onAddAll={noop} onSeeItems={noop} />
          </Variant>
          <Variant label="2 món, không giảm (không có dòng Tiết kiệm)">
            <ComboCard title="Combo đôi" items={GALLERY_COMBO_ITEMS.slice(0, 2)} pct={0} total={two.total} comboTotal={two.comboTotal} onAddAll={noop} />
          </Variant>
          <Variant label="đang thêm vào giỏ (busy)">
            <ComboCard title="Combo giặt sạch" items={GALLERY_COMBO_ITEMS.slice(0, 3)} pct={10} total={three.total} comboTotal={three.comboTotal} onAddAll={noop} busy />
          </Variant>
        </Group>

        <Group name="cart-combo-block">
          <Variant label="bộ đang áp: đầu nhóm ghi Tiết kiệm">
            <CartComboBlock block={comboApplied}>{comboRows}</CartComboBlock>
          </Variant>
          <Variant label="bỏ chọn một món của bộ: không ghi Tiết kiệm, nhắc chọn đủ món">
            <CartComboBlock block={comboBroken}>{comboRows}</CartComboBlock>
          </Variant>
          <Variant label="tên combo dài không dấu cách: xuống dòng, không tràn">
            <CartComboBlock block={comboLong}>{comboRows}</CartComboBlock>
          </Variant>
        </Group>

        <Group name="banner-carousel">
          <Variant label="3 slide: tự chuyển, nút Dừng, chấm">
            <BannerCarousel slides={GALLERY_SLIDES} />
          </Variant>
          <Variant label="1 slide: không chấm, không nút Dừng">
            <BannerCarousel slides={GALLERY_SLIDES.slice(0, 1)} />
          </Variant>
        </Group>

        <Group name="product-story-showcase">
          {GALLERY_STORY_PRODUCTS.map((g) => (
            <Variant key={g.product.id} label={g.label}>
              <ProductStoryShowcase product={g.product} />
            </Variant>
          ))}
        </Group>

        <Group name="story-reel-strip">
          <Variant label="đang tải">
            <StoryReelStrip items={[]} loading onOpen={() => undefined} />
          </Variant>
          <Variant label="chưa xem (viền xanh) và đã xem (viền xám)">
            <StoryReelStrip items={GALLERY_REEL_ITEMS} onOpen={() => undefined} />
          </Variant>
        </Group>

        <Group name="free-shipping-progress-bar">
          <Variant label="còn thiếu 35.000đ">
            <FreeShippingProgressBar base={164_000} threshold={199_000} />
          </Variant>
          <Variant label="vừa bắt đầu">
            <FreeShippingProgressBar base={0} threshold={199_000} />
          </Variant>
          <Variant label="chỉ phần Tubu giao">
            <FreeShippingProgressBar base={120_000} threshold={199_000} tubuOnly />
          </Variant>
          <Variant label="đã đạt">
            <FreeShippingProgressBar base={210_000} threshold={199_000} />
          </Variant>
        </Group>

        <Group name="freeship-addon-rail">
          <Variant label="3 món bù đơn, có giá gạch">
            <FreeshipAddonRail items={GALLERY_ADDON_ITEMS} onAdd={() => undefined} />
          </Variant>
          <Variant label="đang thêm món đầu">
            <FreeshipAddonRail items={GALLERY_ADDON_ITEMS} busySlug="rau-muong" onAdd={() => undefined} />
          </Variant>
        </Group>
      </div>
    </Page>
  );
}
