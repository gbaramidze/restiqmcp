import { supabase, resolveTenant } from './src/db.js';

async function checkDelivery() {
  console.log('--- Checking Delivery & Glovo across database ---');

  // 1. Check orders table columns
  const { data: sampleOrder } = await supabase.from('orders').select('*').limit(1);
  console.log('Sample Order Keys:', Object.keys(sampleOrder?.[0] || {}));

  // 2. Check for any orders where is_delivery is truthy
  const { data: isDeliveryOrders, count: dCount } = await supabase
    .from('orders')
    .select('id, price, status, is_delivery, table, date, tenant_id', { count: 'exact' })
    .not('is_delivery', 'is', null)
    .limit(10);
  console.log('Orders with is_delivery != null (count):', dCount, isDeliveryOrders);

  // 3. Check for any orders with "glovo", "bolt", "taxi", "delivery" in table or creator or status
  const { data: searchOrders } = await supabase
    .from('orders')
    .select('id, price, status, is_delivery, table, date, tenant_id')
    .or('status.ilike.%delivery%,status.ilike.%glovo%')
    .limit(10);
  console.log('Orders with status containing delivery/glovo:', searchOrders);

  // 4. Check salaro table
  const { data: salaroDelivery } = await supabase
    .from('salaro')
    .select('id, price_in, payment, payment_type, comment, date, tenant_id')
    .or('payment.ilike.%glovo%,payment.ilike.%bolt%,payment.ilike.%taxi%,payment.ilike.%delivery%,comment.ilike.%glovo%,comment.ilike.%bolt%,comment.ilike.%taxi%')
    .limit(10);
  console.log('Salaro delivery records:', salaroDelivery);

  // 5. Check payment_types
  const { data: pts } = await supabase.from('payment_types').select('*');
  console.log('Payment Types:', pts);

  // 6. Check web_orders table
  const { data: webOrders, count: wCount } = await supabase.from('web_orders').select('*', { count: 'exact' }).limit(5);
  console.log('web_orders count:', wCount, webOrders);

  // 7. Check Ajara Palace vs Teatro
  const teatro = await resolveTenant('teatro');
  const ajara = await resolveTenant('ajarapalace');

  const { count: teatroOrdersCount } = await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', teatro.id);
  const { count: ajaraOrdersCount } = await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', ajara.id);
  console.log(`Teatro total orders: ${teatroOrdersCount}, Ajara Palace total orders: ${ajaraOrdersCount}`);
}

checkDelivery().catch(console.error);
