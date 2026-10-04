import { supabase, resolveTenant, getDayBounds, fetchAllRows } from '../db.js';
import { TodaySummaryResult } from '../types.js';

export async function getTodaySummary(tenantIdentifier?: string, customDate?: string): Promise<TodaySummaryResult & {
  active_shift_summary?: {
    is_shift_open: boolean;
    shift_id: number;
    shift_number?: number;
    opened_at: string;
    cashier_name: string;
    initial_cash: number;
    cash_sales: number;
    card_sales: number;
    transfer_sales: number;
    total_sales: number;
    discounts: number;
    open_orders_sum: number;
    open_orders_count: number;
    deposit_sum: number;
    expected_cash_drawer: number;
  };
}> {
  const tenant = await resolveTenant(tenantIdentifier);
  const bounds = getDayBounds(customDate);

  // 1. Fetch Active Open Shift
  const { data: openShiftData } = await supabase
    .from('shifts')
    .select('id, shift_number, status, opened_at, initial_cash, final_cash, opened_by')
    .eq('tenant_id', tenant.id)
    .in('status', ['open', 'OPEN'])
    .order('id', { ascending: false })
    .limit(1);

  const activeShift = openShiftData && openShiftData.length > 0 ? openShiftData[0] : null;
  const isShiftOpen = !!activeShift;

  let cashierName = 'Unknown';
  if (activeShift?.opened_by) {
    const { data: u } = await supabase.from('users').select('name, username').eq('id', activeShift.opened_by).maybeSingle();
    if (u) cashierName = u.name || u.username;
  }

  // 2. Fetch Salaro for Active Shift using pagination
  let shiftCashSales = 0;
  let shiftCardSales = 0;
  let shiftTransferSales = 0;
  let shiftOtherSales = 0;
  let shiftDiscounts = 0;

  if (activeShift) {
    const shiftSalaro = await fetchAllRows(async (from, to) => {
      return supabase
        .from('salaro')
        .select('id, price_in, back, discount, payment, payment_type')
        .eq('tenant_id', tenant.id)
        .or(`shift_id.eq.${activeShift.id},date.gte.${activeShift.opened_at}`)
        .range(from, to);
    });

    shiftSalaro.forEach(s => {
      const pIn = parseFloat(s.price_in) || 0;
      const back = parseFloat(s.back) || 0;
      const disc = parseFloat(s.discount) || 0;
      const net = Math.max(0, pIn - back);
      const p = (s.payment_type || s.payment || '').toLowerCase();

      shiftDiscounts += disc;

      if (p.includes('cash') || p.includes('ნაღდი')) {
        shiftCashSales += net;
      } else if (p.includes('card') || p.includes('ბარათ') || p.includes('terminal')) {
        shiftCardSales += net;
      } else if (p.includes('transfer') || p.includes('გადარიცხვ')) {
        shiftTransferSales += net;
      } else {
        shiftOtherSales += net;
      }
    });
  }

  // 3. Active Open Orders (Filter to current shift / recent to avoid stale ancient open orders)
  let openOrdersQuery = supabase
    .from('orders')
    .select('id, price, count, guests, prepayment, status, date, shift_id')
    .eq('tenant_id', tenant.id)
    .in('status', ['open', 'precheck', 'OPEN', 'PRECHECK']);

  if (activeShift) {
    openOrdersQuery = openOrdersQuery.or(`shift_id.eq.${activeShift.id},date.gte.${activeShift.opened_at}`);
  } else {
    // If no shift open, look at today/yesterday orders
    openOrdersQuery = openOrdersQuery.gte('date', bounds.start);
  }

  const { data: openOrdersData } = await openOrdersQuery;
  const activeOpenOrders = openOrdersData || [];
  const openSum = activeOpenOrders.reduce((s, o) => s + (parseFloat(o.price) || 0), 0);
  const openPrepayments = activeOpenOrders.reduce((s, o) => s + (parseFloat(o.prepayment) || 0), 0);

  // 4. Determine Effective Range for period reporting
  const queryStart = (!customDate && activeShift) ? activeShift.opened_at : bounds.start;
  const queryEnd = (!customDate && activeShift) ? new Date().toISOString() : bounds.end;

  // 5. Fetch Orders in Period with pagination
  const orders = await fetchAllRows(async (from, to) => {
    return supabase
      .from('orders')
      .select('id, price, status, count, guests, discount, discount_amount, date, shift_id')
      .eq('tenant_id', tenant.id)
      .gte('date', queryStart)
      .lte('date', queryEnd)
      .range(from, to);
  });

  const isClosedStatus = (st: string) => {
    const s = (st || '').toLowerCase();
    return s === 'completed' || s === 'closed' || s === 'paid';
  };

  const closedOrders = orders.filter(o => isClosedStatus(o.status));
  const grossTotal = closedOrders.reduce((acc, o) => acc + (parseFloat(o.price) || 0), 0);
  
  // Use o.guests first, fallback to o.count
  const totalGuests = closedOrders.reduce((acc, o) => {
    const g = parseInt((o as any).guests, 10) || parseInt(o.count, 10) || 0;
    return acc + g;
  }, 0);

  const orderDiscountsTotal = closedOrders.reduce((acc, o) => {
    const d = parseFloat((o as any).discount_amount) || parseFloat(o.discount) || 0;
    return acc + d;
  }, 0);

  // 6. Fetch Salaro in Period with pagination
  const salaro = await fetchAllRows(async (from, to) => {
    return supabase
      .from('salaro')
      .select('id, price_in, price_out, back, discount, payment, payment_type, date, shift_id')
      .eq('tenant_id', tenant.id)
      .gte('date', queryStart)
      .lte('date', queryEnd)
      .range(from, to);
  });

  let salaroDiscounts = 0;
  let cashSalesTotal = 0;
  let cardSalesTotal = 0;
  let transferSalesTotal = 0;
  let otherPaymentsTotal = 0;
  let cashInPhysical = 0;
  let cashOutPhysical = 0;

  salaro.forEach(s => {
    const pIn = parseFloat(s.price_in) || 0;
    const pOut = parseFloat(s.price_out) || 0;
    const backAmt = parseFloat(s.back) || 0;
    const discAmt = parseFloat(s.discount) || 0;
    const pType = (s.payment_type || s.payment || 'cash').toLowerCase();

    salaroDiscounts += discAmt;
    cashOutPhysical += pOut;

    const netAmount = Math.max(0, pIn - backAmt);

    if (pType.includes('cash') || pType.includes('ნაღდი')) {
      cashSalesTotal += netAmount;
      cashInPhysical += netAmount;
    } else if (pType.includes('card') || pType.includes('ბარათ') || pType.includes('terminal')) {
      cardSalesTotal += netAmount;
    } else if (pType.includes('transfer') || pType.includes('გადარიცხვ') || pType.includes('bank')) {
      transferSalesTotal += netAmount;
    } else {
      otherPaymentsTotal += netAmount;
    }
  });

  const totalDiscounts = Math.max(orderDiscountsTotal, salaroDiscounts);

  // 7. Supplier Payments & Write-offs
  const momwData = await fetchAllRows(async (from, to) => {
    return supabase
      .from('momw_gadaxdebi')
      .select('id, price, date')
      .eq('tenant_id', tenant.id)
      .gte('date', queryStart)
      .lte('date', queryEnd)
      .range(from, to);
  });

  const supplierPaymentsTotal = momwData.reduce((acc, m) => acc + (parseFloat(m.price) || 0), 0);

  let writeOffsTotal = 0;
  try {
    const { data: writeOffsData } = await supabase
      .from('writeoff_items')
      .select('price, count')
      .eq('tenant_id', tenant.id)
      .gte('created_at', queryStart)
      .lte('created_at', queryEnd);

    if (writeOffsData) {
      writeOffsTotal = writeOffsData.reduce((acc, w) => acc + ((parseFloat(w.price) || 0) * (parseFloat(w.count) || 1)), 0);
    }
  } catch {}

  const initialCash = activeShift ? parseFloat(activeShift.initial_cash) || 0 : 0;
  const totalExpenses = supplierPaymentsTotal + cashOutPhysical + writeOffsTotal;
  const paymentsSum = cashSalesTotal + cardSalesTotal + transferSalesTotal + otherPaymentsTotal;
  const netRevenue = paymentsSum > 0 ? paymentsSum : grossTotal;
  const effectiveChecksCount = closedOrders.length > 0 ? closedOrders.length : salaro.filter(s => (parseFloat(s.price_in) || 0) > 0).length;
  const avgCheck = effectiveChecksCount > 0 ? Number((netRevenue / effectiveChecksCount).toFixed(2)) : 0;
  const avgPerGuest = totalGuests > 0 ? Number((netRevenue / totalGuests).toFixed(2)) : 0;

  const expectedCashInDrawer = initialCash + cashSalesTotal - cashOutPhysical;

  return {
    date: bounds.dateStr,
    tenant,
    shift_status: {
      is_shift_open: isShiftOpen,
      shift_id: activeShift?.id,
      shift_number: activeShift?.shift_number || 1,
      opened_at: activeShift?.opened_at,
      opened_by_name: cashierName
    },
    revenue: {
      gross_total: Number(grossTotal.toFixed(2)),
      discounts_total: Number(totalDiscounts.toFixed(2)),
      net_revenue: Number(netRevenue.toFixed(2)),
      currency: tenant.currency || 'GEL'
    },
    payments_breakdown: {
      cash: Number(cashSalesTotal.toFixed(2)),
      card: Number(cardSalesTotal.toFixed(2)),
      bank_transfer: Number(transferSalesTotal.toFixed(2)),
      other: Number(otherPaymentsTotal.toFixed(2))
    },
    orders_metrics: {
      total_orders_count: orders.length,
      closed_orders_count: closedOrders.length,
      active_open_orders_count: activeOpenOrders.length,
      average_check: avgCheck,
      total_guests_count: totalGuests,
      average_per_guest: avgPerGuest
    },
    expenses: {
      total_expenses: Number(totalExpenses.toFixed(2)),
      supplier_payments: Number(supplierPaymentsTotal.toFixed(2)),
      cash_payouts: Number(cashOutPhysical.toFixed(2)),
      write_offs: Number(writeOffsTotal.toFixed(2))
    },
    cash_desk: {
      initial_cash: Number(initialCash.toFixed(2)),
      cash_in: Number(cashInPhysical.toFixed(2)),
      cash_out: Number(cashOutPhysical.toFixed(2)),
      expected_cash_in_drawer: Number(expectedCashInDrawer.toFixed(2))
    },
    financial_balance: {
      net_sales: Number(netRevenue.toFixed(2)),
      total_expenses: Number(totalExpenses.toFixed(2)),
      net_profit_or_loss: Number((netRevenue - totalExpenses).toFixed(2))
    },
    active_shift_summary: activeShift ? {
      is_shift_open: true,
      shift_id: activeShift.id,
      shift_number: activeShift.shift_number || 1,
      opened_at: activeShift.opened_at,
      cashier_name: cashierName,
      initial_cash: initialCash,
      cash_sales: Number(shiftCashSales.toFixed(2)),
      card_sales: Number(shiftCardSales.toFixed(2)),
      transfer_sales: Number(shiftTransferSales.toFixed(2)),
      total_sales: Number((shiftCashSales + shiftCardSales + shiftTransferSales + shiftOtherSales).toFixed(2)),
      discounts: Number(shiftDiscounts.toFixed(2)),
      open_orders_sum: Number(openSum.toFixed(2)),
      open_orders_count: activeOpenOrders.length,
      deposit_sum: Number(openPrepayments.toFixed(2)),
      expected_cash_drawer: Number((initialCash + shiftCashSales).toFixed(2))
    } : undefined
  };
}
