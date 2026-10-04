import { supabase, resolveTenant, fetchAllRows } from '../db.js';
import { ActiveOrderSummary } from '../types.js';

export async function getActiveOrders(tenantIdentifier?: string): Promise<{
  tenant_name: string;
  active_tables_count: number;
  total_open_amount: number;
  total_guests: number;
  stale_unclosed_orders_count: number;
  orders: ActiveOrderSummary[];
}> {
  const tenant = await resolveTenant(tenantIdentifier);

  // 1. Fetch Active Open Shift
  const { data: openShiftData } = await supabase
    .from('shifts')
    .select('id, opened_at')
    .eq('tenant_id', tenant.id)
    .in('status', ['open', 'OPEN'])
    .order('id', { ascending: false })
    .limit(1);

  const activeShift = openShiftData && openShiftData.length > 0 ? openShiftData[0] : null;

  // 2. Fetch all open orders
  const allOpenOrders = await fetchAllRows(async (from, to) => {
    return supabase
      .from('orders')
      .select('id, price, status, count, guests, creator, table, date, is_delivery, prepayment, shift_id')
      .eq('tenant_id', tenant.id)
      .in('status', ['open', 'precheck', 'OPEN', 'PRECHECK'])
      .order('date', { ascending: false })
      .range(from, to);
  });

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Live active orders are those from current shift OR created within last 24 hours
  const liveOrders = allOpenOrders.filter(o => {
    if (activeShift) {
      return (o.shift_id && o.shift_id === activeShift.id) || new Date(o.date) >= new Date(activeShift.opened_at);
    }
    return new Date(o.date) >= oneDayAgo;
  });

  const staleOrdersCount = allOpenOrders.length - liveOrders.length;

  if (liveOrders.length === 0) {
    return {
      tenant_name: tenant.name,
      active_tables_count: 0,
      total_open_amount: 0,
      total_guests: 0,
      stale_unclosed_orders_count: staleOrdersCount,
      orders: []
    };
  }

  const orderIds = liveOrders.map(o => o.id);
  const userIds = [...new Set(liveOrders.map(o => o.creator).filter(Boolean))];
  const tableIds = [...new Set(liveOrders.map(o => o.table).filter(Boolean))];

  // Fetch users, tables, rooms, and order items
  const [{ data: usersData }, { data: tablesData }, { data: roomsData }, { data: itemsCountData }] = await Promise.all([
    userIds.length > 0 ? supabase.from('users').select('id, name, username').in('id', userIds) : Promise.resolve({ data: [] }),
    tableIds.length > 0 ? supabase.from('tables').select('id, number, rid').in('id', tableIds) : Promise.resolve({ data: [] }),
    supabase.from('rooms').select('id, name').eq('tenant_id', tenant.id),
    supabase.from('order_list').select('orderID, id').in('orderID', orderIds)
  ]);

  const userMap = new Map<number, string>();
  (usersData || []).forEach(u => userMap.set(u.id, u.name || u.username));

  const roomMap = new Map<number, string>();
  (roomsData || []).forEach(r => roomMap.set(r.id, r.name));

  const tableMap = new Map<any, { number: string; room_name: string }>();
  (tablesData || []).forEach(t => {
    tableMap.set(t.id, {
      number: String(t.number),
      room_name: roomMap.get(t.rid) || `დარბაზი #${t.rid}`
    });
  });

  const itemsCountMap = new Map<number, number>();
  (itemsCountData || []).forEach(it => {
    itemsCountMap.set(it.orderID, (itemsCountMap.get(it.orderID) || 0) + 1);
  });

  let totalOpenAmount = 0;
  let totalGuests = 0;

  const ordersSummary: ActiveOrderSummary[] = liveOrders.map(o => {
    const price = parseFloat(o.price) || 0;
    const guests = parseInt((o as any).guests, 10) || parseInt(o.count, 10) || 1;
    totalOpenAmount += price;
    totalGuests += guests;

    const tInfo = tableMap.get(o.table) || {
      number: o.is_delivery ? 'მიტანა' : String(o.table || '—'),
      room_name: o.is_delivery ? 'მიტანის სერვისი' : 'დარბაზი'
    };

    const orderDate = new Date(o.date);
    const durationMinutes = Math.floor((now.getTime() - orderDate.getTime()) / (1000 * 60));

    return {
      order_id: o.id,
      table_number: tInfo.number,
      room_name: tInfo.room_name,
      total_amount: Number(price.toFixed(2)),
      guests_count: guests,
      waiter_name: userMap.get(o.creator) || `მიმტანი #${o.creator}`,
      opened_at: o.date,
      duration_minutes: durationMinutes > 0 ? durationMinutes : 0,
      items_count: itemsCountMap.get(o.id) || 0
    };
  });

  return {
    tenant_name: tenant.name,
    active_tables_count: liveOrders.length,
    total_open_amount: Number(totalOpenAmount.toFixed(2)),
    total_guests: totalGuests,
    stale_unclosed_orders_count: staleOrdersCount,
    orders: ordersSummary
  };
}
