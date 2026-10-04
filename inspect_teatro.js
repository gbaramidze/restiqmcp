import { supabase, resolveTenant } from './src/db.js';

async function testActiveShift() {
  const tenant = await resolveTenant('teatro');
  
  // 1. Get Open Shift
  const { data: openShift } = await supabase
    .from('shifts')
    .select('id, shift_number, status, opened_at, closed_at, initial_cash, final_cash, opened_by')
    .eq('tenant_id', tenant.id)
    .in('status', ['open', 'OPEN'])
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  console.log('Open Shift:', openShift);

  let cashierName = 'Unknown';
  if (openShift?.opened_by) {
    const { data: user } = await supabase
      .from('users')
      .select('name, username')
      .eq('id', openShift.opened_by)
      .maybeSingle();
    cashierName = user?.name || user?.username || `მოლარე #${openShift.opened_by}`;
  }
  console.log('Cashier:', cashierName);

  // 2. Fetch Salaro records for active shift
  const shiftId = openShift?.id;
  let salaroQuery = supabase
    .from('salaro')
    .select('id, price_in, price_out, back, discount, payment, payment_id, payment_type, date, shift_id, order_id, comment')
    .eq('tenant_id', tenant.id);

  if (shiftId) {
    salaroQuery = salaroQuery.eq('shift_id', shiftId);
  } else if (openShift?.opened_at) {
    salaroQuery = salaroQuery.gte('date', openShift.opened_at);
  }

  const { data: salaroList } = await salaroQuery;
  console.log('Salaro count for shift:', salaroList?.length);

  let cashSales = 0;
  let cardSales = 0;
  let transferSales = 0;
  let otherSales = 0;
  let totalDiscounts = 0;
  let cashIn = 0;
  let cashOut = 0;

  (salaroList || []).forEach(s => {
    const pIn = parseFloat(s.price_in) || 0;
    const pOut = parseFloat(s.price_out) || 0;
    const back = parseFloat(s.back) || 0;
    const disc = parseFloat(s.discount) || 0;
    const pType = (s.payment_type || s.payment || '').toLowerCase();

    totalDiscounts += disc;
    cashIn += pIn;
    cashOut += pOut;

    const net = Math.max(0, pIn - back);

    if (pType === 'cash' || pType.includes('ნაღდი')) {
      cashSales += net;
    } else if (pType === 'card' || pType.includes('ბარათ') || pType === 'terminal') {
      cardSales += net;
    } else if (pType === 'transfer' || pType.includes('გადარიცხვ')) {
      transferSales += net;
    } else {
      otherSales += net;
    }
  });

  const totalShiftRevenue = cashSales + cardSales + transferSales + otherSales;

  // 3. Active open orders in this shift
  const { data: activeOrders } = await supabase
    .from('orders')
    .select('id, price, count, prepayment, service_fee, discount_amount, date')
    .eq('tenant_id', tenant.id)
    .in('status', ['open', 'precheck', 'OPEN', 'PRECHECK'])
    .eq('shift_id', shiftId);

  const openSum = (activeOrders || []).reduce((s, o) => s + (parseFloat(o.price) || 0), 0);
  const openGuests = (activeOrders || []).reduce((s, o) => s + (parseInt(o.count, 10) || 0), 0);
  const prepayments = (activeOrders || []).reduce((s, o) => s + (parseFloat(o.prepayment) || 0), 0);

  console.log('\n--- MATCH WITH SCREENSHOT ---');
  console.log('1. საწყისი თანხა (Initial Cash):', openShift?.initial_cash || 0, '₾');
  console.log('2. ს. ნაღდი ფული (Cash Sales):', cashSales, '₾');
  console.log('3. ს. საბანკო ბარათი (Bank Card):', cardSales, '₾');
  console.log('4. სულ გაყიდვები (Total Revenue):', totalShiftRevenue, '₾');
  console.log('5. დეპოზიტი (Deposit / Prepayment):', prepayments, '₾');
  console.log('6. ღია (Open Orders Sum):', openSum, '₾');
  console.log('7. სტუმრები (Guests):', openGuests);
}

testActiveShift().catch(console.error);
