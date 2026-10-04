import { supabase, resolveTenant, fetchAllRows } from '../db.js';

export async function getShiftAnalytics(tenantIdentifier?: string, shiftId?: number): Promise<{
  tenant_name: string;
  shift_id: number;
  shift_number: number;
  status: 'open' | 'closed';
  opened_at: string;
  closed_at?: string;
  opened_by_name: string;
  closed_by_name?: string;
  initial_cash: number;
  final_cash?: number;
  financials: {
    total_sales: number;
    cash_sales: number;
    card_sales: number;
    transfer_sales: number;
    discounts: number;
    cash_drawer_in: number;
    cash_drawer_out: number;
    expected_cash_drawer: number;
    actual_cash_drawer?: number;
    discrepancy?: number;
    open_orders_sum: number;
    open_orders_count: number;
    deposit_sum: number;
  };
  orders_count: number;
}> {
  const tenant = await resolveTenant(tenantIdentifier);

  let shift: any = null;

  if (shiftId) {
    const { data } = await supabase
      .from('shifts')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('id', shiftId)
      .maybeSingle();
    shift = data;
  } else {
    // 1. Try to find currently OPEN shift (case-insensitive)
    const { data: openShift } = await supabase
      .from('shifts')
      .select('*')
      .eq('tenant_id', tenant.id)
      .in('status', ['open', 'OPEN'])
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (openShift) {
      shift = openShift;
    } else {
      // 2. Fallback to latest shift
      const { data: latestShift } = await supabase
        .from('shifts')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      shift = latestShift;
    }
  }

  if (!shift) {
    throw new Error(`ცვლა ვერ მოიძებნა (Shift not found) for tenant ${tenant.name}`);
  }

  const targetShiftId = shift.id;

  // Resolve Cashier Names
  let openedByName = 'მოლარე / Cashier';
  if (shift.opened_by) {
    const { data: u } = await supabase.from('users').select('name, username').eq('id', shift.opened_by).maybeSingle();
    if (u) openedByName = u.name || u.username;
  }

  let closedByName: string | undefined = undefined;
  if (shift.closed_by) {
    const { data: u } = await supabase.from('users').select('name, username').eq('id', shift.closed_by).maybeSingle();
    if (u) closedByName = u.name || u.username;
  }

  // Fetch salaro records attached to this shift with pagination
  const salaroData = await fetchAllRows(async (from, to) => {
    return supabase
      .from('salaro')
      .select('id, price_in, price_out, back, discount, payment, payment_type, date')
      .eq('tenant_id', tenant.id)
      .or(`shift_id.eq.${targetShiftId},date.gte.${shift.opened_at}${shift.closed_at ? `,date.lte.${shift.closed_at}` : ''}`)
      .range(from, to);
  });

  // Fetch orders attached to this shift with pagination
  const allOrders = await fetchAllRows(async (from, to) => {
    return supabase
      .from('orders')
      .select('id, price, count, guests, status, prepayment, discount, discount_amount')
      .eq('tenant_id', tenant.id)
      .or(`shift_id.eq.${targetShiftId},date.gte.${shift.opened_at}${shift.closed_at ? `,date.lte.${shift.closed_at}` : ''}`)
      .range(from, to);
  });

  const closedOrders = allOrders.filter(o => o.status === 'completed' || o.status === 'closed' || o.status === 'paid');
  const openOrders = allOrders.filter(o => o.status === 'open' || o.status === 'precheck');

  const openSum = openOrders.reduce((s, o) => s + (parseFloat(o.price) || 0), 0);
  const depositSum = openOrders.reduce((s, o) => s + (parseFloat(o.prepayment) || 0), 0);

  let cashSales = 0;
  let cardSales = 0;
  let transferSales = 0;
  let salaroDiscounts = 0;
  let cashDrawerIn = 0;
  let cashDrawerOut = 0;

  salaroData.forEach(s => {
    const pIn = parseFloat(s.price_in) || 0;
    const pOut = parseFloat(s.price_out) || 0;
    const backAmt = parseFloat(s.back) || 0;
    const discAmt = parseFloat(s.discount) || 0;
    const pType = (s.payment_type || s.payment || 'cash').toLowerCase();

    salaroDiscounts += discAmt;
    cashDrawerOut += pOut;

    const netAmt = Math.max(0, pIn - backAmt);

    if (pType.includes('cash') || pType.includes('ნაღდი')) {
      cashSales += netAmt;
      cashDrawerIn += netAmt;
    } else if (pType.includes('card') || pType.includes('ბარათ') || pType.includes('terminal')) {
      cardSales += netAmt;
    } else if (pType.includes('transfer') || pType.includes('გადარიცხვ')) {
      transferSales += netAmt;
    }
  });

  const orderDiscounts = closedOrders.reduce((acc, o) => acc + (parseFloat((o as any).discount_amount) || parseFloat(o.discount) || 0), 0);
  const totalDiscounts = Math.max(salaroDiscounts, orderDiscounts);

  const initialCash = parseFloat(shift.initial_cash) || 0;
  const finalCash = shift.final_cash !== null && shift.final_cash !== undefined ? parseFloat(shift.final_cash) : undefined;
  const totalSales = cashSales + cardSales + transferSales;
  const expectedCashDrawer = initialCash + cashSales - cashDrawerOut;
  const discrepancy = finalCash !== undefined && shift.status === 'closed' ? finalCash - expectedCashDrawer : undefined;

  return {
    tenant_name: tenant.name,
    shift_id: shift.id,
    shift_number: shift.shift_number || 1,
    status: (shift.status || 'open').toLowerCase() === 'open' ? 'open' : 'closed',
    opened_at: shift.opened_at,
    closed_at: shift.closed_at,
    opened_by_name: openedByName,
    closed_by_name: closedByName,
    initial_cash: Number(initialCash.toFixed(2)),
    final_cash: finalCash !== undefined ? Number(finalCash.toFixed(2)) : undefined,
    financials: {
      total_sales: Number(totalSales.toFixed(2)),
      cash_sales: Number(cashSales.toFixed(2)),
      card_sales: Number(cardSales.toFixed(2)),
      transfer_sales: Number(transferSales.toFixed(2)),
      discounts: Number(totalDiscounts.toFixed(2)),
      cash_drawer_in: Number(cashDrawerIn.toFixed(2)),
      cash_drawer_out: Number(cashDrawerOut.toFixed(2)),
      expected_cash_drawer: Number(expectedCashDrawer.toFixed(2)),
      actual_cash_drawer: finalCash !== undefined ? Number(finalCash.toFixed(2)) : undefined,
      discrepancy: discrepancy !== undefined ? Number(discrepancy.toFixed(2)) : undefined,
      open_orders_sum: Number(openSum.toFixed(2)),
      open_orders_count: openOrders.length,
      deposit_sum: Number(depositSum.toFixed(2))
    },
    orders_count: closedOrders.length > 0 ? closedOrders.length : (salaroData.length || 0)
  };
}
