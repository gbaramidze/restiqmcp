import { supabase, fetchAllRows, resolveTenant } from './src/db.js';

async function analyzeDetails() {
  const tenant = await resolveTenant('teatro');
  console.log('--- Analyzing September Day by Day for Teatro ---');
  const septOrders = await fetchAllRows(
    async (from, to) => supabase.from('orders')
      .select('id, price, discount_amount, date, status')
      .eq('tenant_id', tenant.id)
      .eq('status', 'completed')
      .gte('date', '2026-09-01T00:00:00')
      .lte('date', '2026-09-30T23:59:59')
      .order('date', { ascending: true })
      .range(from, to)
  );
  
  const days = {};
  septOrders.forEach(o => {
    const day = o.date.slice(0, 10);
    if (!days[day]) days[day] = { count: 0, sum: 0, discount: 0 };
    days[day].count++;
    days[day].sum += (Number(o.price) || 0);
    days[day].discount += (Number(o.discount_amount) || 0);
  });
  console.log('September Total Days Active:', Object.keys(days).length);
  console.log('September Total Orders:', septOrders.length);
  
  let totalRev = 0;
  let totalDisc = 0;
  const tableData = Object.entries(days).map(([day, d]) => {
    totalRev += d.sum;
    totalDisc += d.discount;
    return {
      'თარიღი': day,
      'ჩეკები': d.count,
      'შემოსავალი (₾)': d.sum.toFixed(2),
      'ფასდაკლება (₾)': d.discount.toFixed(2),
      'საშ. ჩეკი (₾)': (d.sum / d.count).toFixed(2)
    };
  });
  console.table(tableData);
  console.log(`TOTAL: Revenue = ${totalRev.toFixed(2)} GEL, Discounts = ${totalDisc.toFixed(2)} GEL, Orders = ${septOrders.length}`);

  console.log('\n--- Analyzing Open / Active Orders ---');
  const openOrders = await fetchAllRows(
    async (from, to) => supabase.from('orders')
      .select('id, table, price, date, status, creator')
      .eq('tenant_id', tenant.id)
      .eq('status', 'open')
      .order('date', { ascending: false })
      .range(from, to)
  );
  console.log('Total Open Orders in DB:', openOrders.length);
  const now = new Date();
  const recentOpen = openOrders.filter(o => (now - new Date(o.date)) < 24 * 3600 * 1000);
  const oldOpen = openOrders.filter(o => (now - new Date(o.date)) >= 24 * 3600 * 1000);
  console.log('Active (Last 24h / Current Shift):', recentOpen.length, 'Orders, Total Sum:', recentOpen.reduce((s,o)=>s+(Number(o.price)||0),0).toFixed(2), '₾');
  console.log('Stale / Old Ghost Orders (>24h):', oldOpen.length, 'Orders, Total Sum:', oldOpen.reduce((s,o)=>s+(Number(o.price)||0),0).toFixed(2), '₾');
  console.log('Oldest open order date:', oldOpen[oldOpen.length-1]?.date);
  process.exit(0);
}

analyzeDetails().catch(e => { console.error(e); process.exit(1); });
