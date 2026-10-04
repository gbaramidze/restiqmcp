import { supabase, resolveTenant, getPeriodBounds, fetchAllRows } from '../db.js';
import { SalesPeriodSummary } from '../types.js';

export async function getSalesAnalytics(
  tenantIdentifier?: string,
  period: string = 'today',
  customStart?: string,
  customEnd?: string
): Promise<SalesPeriodSummary> {
  const tenant = await resolveTenant(tenantIdentifier);
  const bounds = getPeriodBounds(period, customStart, customEnd);

  // Fetch closed orders and rooms for the period using full pagination
  const [orders, roomsData, tablesData] = await Promise.all([
    fetchAllRows(async (from, to) => {
      return supabase
        .from('orders')
        .select('id, hash, price, status, date, table, is_delivery, discount, discount_amount, guests, count')
        .eq('tenant_id', tenant.id)
        .in('status', ['closed', 'completed', 'paid'])
        .gte('date', bounds.start)
        .lte('date', bounds.end)
        .range(from, to);
    }),
    supabase.from('rooms').select('id, name').eq('tenant_id', tenant.id),
    supabase.from('tables').select('id, number, rid').eq('tenant_id', tenant.id)
  ]);

  const rooms = roomsData.data || [];
  const tables = tablesData.data || [];

  const roomMap = new Map<number, string>();
  rooms.forEach(r => roomMap.set(r.id, r.name));

  const tableToRoomMap = new Map<any, { room_id: number; room_name: string }>();
  tables.forEach(t => {
    const rName = roomMap.get(t.rid) || `დარბაზი #${t.rid}`;
    tableToRoomMap.set(t.id, { room_id: t.rid, room_name: rName });
    tableToRoomMap.set(t.number, { room_id: t.rid, room_name: rName });
  });

  // Fetch salaro payment records for delivery platforms specifically
  const { data: deliverySalaro } = await supabase
    .from('salaro')
    .select('order_id, payment, discount')
    .eq('tenant_id', tenant.id)
    .gte('date', bounds.start)
    .lte('date', bounds.end)
    .or('payment.ilike.%glovo%,payment.ilike.%bolt%,payment.ilike.%wolt%,payment.ilike.%taxi%,payment.ilike.%delivery%');

  const orderPaymentMap = new Map<number, string>();
  let salaroDiscounts = 0;

  (deliverySalaro || []).forEach(s => {
    if (s.order_id && s.payment) {
      orderPaymentMap.set(s.order_id, s.payment);
    }
    salaroDiscounts += parseFloat(s.discount) || 0;
  });

  let totalRevenue = 0;
  let totalOrderDiscounts = 0;
  let totalGuests = 0;

  const hourlyBuckets = new Map<number, { revenue: number; count: number }>();
  for (let h = 0; h < 24; h++) {
    hourlyBuckets.set(h, { revenue: 0, count: 0 });
  }

  const roomSalesMap = new Map<string, { room_id: any; room_name: string; revenue: number; count: number }>();
  let deliveryRevenue = 0;
  let glovoRevenue = 0;
  let boltRevenue = 0;
  let woltRevenue = 0;
  let taxiRevenue = 0;
  let dineInRevenue = 0;

  orders.forEach(o => {
    const price = parseFloat(o.price) || 0;
    const disc = parseFloat((o as any).discount_amount) || parseFloat(o.discount) || 0;
    const guests = parseInt((o as any).guests, 10) || parseInt(o.count, 10) || 0;

    totalRevenue += price;
    totalOrderDiscounts += disc;
    totalGuests += guests;

    const orderDate = new Date(o.date);
    const hour = orderDate.getHours();
    const hData = hourlyBuckets.get(hour) || { revenue: 0, count: 0 };
    hData.revenue += price;
    hData.count += 1;
    hourlyBuckets.set(hour, hData);

    // Delivery vs Dine-in classification
    const isDel = !!o.is_delivery;
    const pmt = (orderPaymentMap.get(o.id) || '').toLowerCase();
    const isGlovo = pmt.includes('glovo');
    const isBolt = pmt.includes('bolt');
    const isWolt = pmt.includes('wolt');
    const isTaxi = pmt.includes('taxi');

    if (isDel || isGlovo || isBolt || isWolt || isTaxi) {
      deliveryRevenue += price;
      if (isGlovo) glovoRevenue += price;
      else if (isBolt) boltRevenue += price;
      else if (isWolt) woltRevenue += price;
      else if (isTaxi) taxiRevenue += price;
    } else {
      dineInRevenue += price;
    }

    // Room mapping
    const tInfo = tableToRoomMap.get(o.table) || { room_id: 0, room_name: isDel ? 'მიტანა / Delivery' : 'სხვა / დარბაზი' };
    const rKey = String(tInfo.room_id);
    const rData = roomSalesMap.get(rKey) || {
      room_id: tInfo.room_id,
      room_name: tInfo.room_name,
      revenue: 0,
      count: 0
    };
    rData.revenue += price;
    rData.count += 1;
    roomSalesMap.set(rKey, rData);
  });

  const ordersCount = orders.length;
  const averageCheck = ordersCount > 0 ? Number((totalRevenue / ordersCount).toFixed(2)) : 0;
  const totalDiscounts = Math.max(totalOrderDiscounts, salaroDiscounts);

  const hourlySales = Array.from(hourlyBuckets.entries()).map(([hour, val]) => ({
    hour,
    hour_label: `${String(hour).padStart(2, '0')}:00 - ${String(hour).padStart(2, '0')}:59`,
    revenue: Number(val.revenue.toFixed(2)),
    orders_count: val.count
  }));

  const hallsSales = Array.from(roomSalesMap.values()).map(r => ({
    room_id: r.room_id,
    room_name: r.room_name,
    revenue: Number(r.revenue.toFixed(2)),
    orders_count: r.count
  })).sort((a, b) => b.revenue - a.revenue);

  return {
    period_label: bounds.label,
    start_date: bounds.start,
    end_date: bounds.end,
    total_revenue: Number(totalRevenue.toFixed(2)),
    orders_count: ordersCount,
    average_check: averageCheck,
    total_discounts: Number(totalDiscounts.toFixed(2)),
    delivery_breakdown: {
      dine_in_revenue: Number(dineInRevenue.toFixed(2)),
      delivery_revenue: Number(deliveryRevenue.toFixed(2)),
      glovo_revenue: Number(glovoRevenue.toFixed(2)),
      bolt_revenue: Number(boltRevenue.toFixed(2)),
      taxi_revenue: Number(taxiRevenue.toFixed(2))
    },
    hourly_sales: hourlySales,
    halls_sales: hallsSales
  };
}
