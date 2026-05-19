/**
 * Test Pancake discount handling.
 *
 * Tạo 1 đơn test rẻ (50k) với discount 10k, in response để verify Pancake
 * có honor field `discount` / `total_price` không.
 *
 * Usage:
 *   cd tubutree-api && npx ts-node scripts/test-pancake-discount.ts
 *
 * CHÚ Ý: Đây là đơn THẬT trên Pancake POS. Sau khi verify, huỷ đơn này
 * trên Pancake Dashboard để không lẫn vào dữ liệu thật.
 */
import 'dotenv/config';
import { createPancakeOrder, getPancakeOrder, getDefaultWarehouseId } from '../src/services/pancake.service';

const TEST_PHONE = '0900000000';
const TEST_NAME = 'TEST - DISCOUNT VERIFY';
const TEST_ADDRESS = '123 Test Street, Test Ward, Test District, Test Province';

async function main() {
  console.log('=== Pancake Discount Verify ===');
  console.log('Shop ID:', process.env.PANCAKE_SHOP_ID);
  console.log('');

  // Bước 1: Lấy 1 product có sẵn để dùng làm test item
  console.log('Step 1: Lấy 1 product có sẵn từ shop…');
  const { getPancakeProducts } = await import('../src/services/pancake.service');
  const products = await getPancakeProducts(1, 1);
  const product = products?.data?.[0];
  if (!product) {
    console.error('Không có product nào trong shop. Aborted.');
    process.exit(1);
  }
  const variation = product.variations?.[0];
  console.log(`Picked: ${product.name} (id=${product.id}, variant=${variation?.id}, retail=${variation?.retail_price})`);
  console.log('');

  // Bước 2: Tạo order với discount
  const retailPrice = Number(variation.retail_price);
  const discount = Math.floor(retailPrice * 0.2); // giảm 20%
  const finalTotal = retailPrice - discount;

  console.log(`Step 2: Tạo đơn với retail=${retailPrice}, discount=${discount}, final=${finalTotal}`);
  const orderPayload = {
    warehouse_id: getDefaultWarehouseId(),
    customer: { name: TEST_NAME, phone: TEST_PHONE, address: TEST_ADDRESS },
    items: [{ product_id: product.id, variant_id: variation.id, quantity: 1 }],
    notes: '[AUTO TEST] Kiểm tra Pancake có honor discount không. Huỷ sau khi verify.',
    payment_method: 'COD',
    discount,
    total_discount_amount: discount,
    total_price: finalTotal,
  };

  console.log('Payload gửi đi:');
  console.log(JSON.stringify(orderPayload, null, 2));
  console.log('');

  let orderResponse;
  try {
    orderResponse = await createPancakeOrder(orderPayload);
  } catch (e: any) {
    console.error('createPancakeOrder LỖI:', e.response?.data || e.message);
    process.exit(1);
  }

  console.log('Response Pancake:');
  console.log(JSON.stringify(orderResponse, null, 2));
  console.log('');

  const orderId = orderResponse?.id || orderResponse?.data?.id;
  if (!orderId) {
    console.error('Không lấy được order_id từ response. Aborted verification.');
    process.exit(1);
  }

  // Bước 3: Fetch lại để xem field tổng tiền
  console.log(`Step 3: Fetch đơn ${orderId} để kiểm tra invoice`);
  const fetched = await getPancakeOrder(orderId);
  const data = fetched?.data || fetched;

  console.log('Đơn vừa fetch:');
  console.log(JSON.stringify(data, null, 2));
  console.log('');

  // Bước 4: Verdict
  console.log('=== VERDICT ===');
  const fields = ['total_price', 'total_discount', 'total_discount_amount', 'discount', 'final_amount', 'cod'];
  for (const f of fields) {
    const v = data[f];
    if (v !== undefined) console.log(`  ${f} = ${v}`);
  }
  console.log('');
  console.log(`Expected final total: ${finalTotal}`);
  console.log(`Nếu Pancake KHÔNG có field nào hiển thị ${finalTotal} → Pancake không honor discount.`);
  console.log(`Hành động fix: encode discount thành line item âm trong order.controller.ts.`);
  console.log('');
  console.log(`⚠ Đơn test ${orderId} đã được tạo THẬT. Vào Pancake Dashboard huỷ đơn này.`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
