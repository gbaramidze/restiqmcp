import { supabase, resolveTenant, getPeriodBounds } from '../db.js';

export interface OrderSearchResult {
  order_id: number;
  table_number: string | number;
  room_name?: string;
  status: string;
  date: string;
  total_price: number;
  prepayment: number;
  service_fee: number;
  discount_amount: number;
  payment_method?: string;
  waiter_name?: string;
  delivery_type?: string;
  is_delivery: boolean;
  guests_count: number;
  items_summary?: string;
  items?: Array<{
    name: string;
    count: number;
    price: number;
  }>;
}

export async function searchOrders(
  tenantIdentifier?: string,
  options: {
    query?: string;
    deliveryType?: 'all' | 'glovo' | 'bolt' | 'wolt' | 'taxi' | 'delivery' | 'dine_in';
    status?: 'all' | 'open' | 'closed' | 'completed' | 'canceled';
    period?: string;
    startDate?: string;
    endDate?: string;
    orderId?: number;
    tableNumber?: string | number;
    limit?: number;
  } = {}
): Promise<{
  tenant_name: string;
  total_found: number;
  orders: OrderSearchResult[];
}> {
  const tenant = await resolveTenant(tenantIdentifier);
  const limit = options.limit || 25;

  let query = supabase
    .from('orders')
    .select('id, hash, price, status, count, table, creator, date, prepayment, service_fee, discount_amount, is_delivery, tenant_id')
    .eq('tenant_id', tenant.id);

  if (options.orderId) {
    query = query.eq('id', options.orderId);
  }

  if (options.status && options.status !== 'all') {
    if (options.status === 'closed' || options.status === 'completed') {
      query = query.in('status', ['closed', 'completed', 'paid']);
    } else if (options.status === 'open') {
      query = query.in('status', ['open', 'precheck']);
    } else if (options.status === 'canceled') {
      query = query.in('status', ['canceled', 'cancelled']);
    } else {
      query = query.eq('status', options.status);
    }
  }

  if (options.period || options.startDate || options.endDate) {
    const bounds = getPeriodBounds(options.period || 'custom', options.startDate, options.endDate);
    query = query.gte('date', bounds.start).lte('date', bounds.end);
  }

  // If specific delivery platform requested (like Glovo), find order IDs from salaro first
  let salaroMatchedOrderIds: number[] | null = null;
  if (options.deliveryType && ['glovo', 'bolt', 'wolt', 'taxi'].includes(options.deliveryType)) {
    const { data: pmtRows } = await supabase
      .from('salaro')
      .select('order_id')
      .eq('tenant_id', tenant.id)
      .ilike('payment', `%${options.deliveryType}%`);
    salaroMatchedOrderIds = (pmtRows || []).map(r => r.order_id).filter(Boolean);
  }

  if (salaroMatchedOrderIds && salaroMatchedOrderIds.length > 0) {
    query = query.or(`is_delivery.eq.true,id.in.(${salaroMatchedOrderIds.join(',')})`);
  }

  const { data: rawOrders, error } = await query
    .order('date', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error searching orders:', error);
  }

  const orders = rawOrders || [];
  if (orders.length === 0) {
    return {
      tenant_name: tenant.name,
      total_found: 0,
      orders: []
    };
  }

  const orderIds = orders.map(o => o.id);
  const hashes = orders.map(o => o.hash).filter(Boolean);
  const userIds = [...new Set(orders.map(o => o.creator).filter(Boolean))];
  const tableIds = [...new Set(orders.map(o => o.table).filter(Boolean))];

  const [{ data: usersData }, { data: tablesData }, { data: roomsData }, { data: itemsData }, { data: salaroData }] = await Promise.all([
    userIds.length > 0 ? supabase.from('users').select('id, name, username').in('id', userIds) : Promise.resolve({ data: [] }),
    tableIds.length > 0 ? supabase.from('tables').select('id, number, rid').in('id', tableIds) : Promise.resolve({ data: [] }),
    supabase.from('rooms').select('id, name').eq('tenant_id', tenant.id),
    supabase.from('order_list').select('orderID, item, count, price, items:item(name)').in('orderID', orderIds),
    supabase.from('salaro').select('order_id, hash, payment, price_in').eq('tenant_id', tenant.id).in('order_id', orderIds)
  ]);

  const userMap = new Map<number, string>();
  (usersData || []).forEach((u: any) => userMap.set(u.id, u.name || u.username));

  const roomMap = new Map<number, string>();
  (roomsData || []).forEach((r: any) => roomMap.set(r.id, r.name));

  const tableMap = new Map<any, { number: string; room_name: string }>();
  (tablesData || []).forEach((t: any) => {
    tableMap.set(t.id, {
      number: String(t.number),
      room_name: roomMap.get(t.rid) || `დარბაზი #${t.rid}`
    });
  });

  const paymentMap = new Map<number, string>();
  (salaroData || []).forEach((s: any) => {
    if (s.order_id && s.payment) {
      paymentMap.set(s.order_id, s.payment);
    }
  });

  const orderItemsMap = new Map<number, Array<{ name: string; count: number; price: number }>>();
  (itemsData || []).forEach((it: any) => {
    const list = orderItemsMap.get(it.orderID) || [];
    list.push({
      name: it.items?.name || `პოზიცია #${it.item}`,
      count: parseFloat(it.count) || 1,
      price: parseFloat(it.price) || 0
    });
    orderItemsMap.set(it.orderID, list);
  });

  const filteredOrders: OrderSearchResult[] = [];

  for (const o of orders) {
    const isDel = !!o.is_delivery;
    const pmtMethod = paymentMap.get(o.id) || '';
    const tInfo = tableMap.get(o.table) || {
      number: isDel ? 'მიტანა' : String(o.table || '—'),
      room_name: isDel ? 'მიტანის სერვისი' : 'დარბაზი'
    };
    const items = orderItemsMap.get(o.id) || [];
    const itemsSummary = items.map(i => `${i.name} (${i.count}x)`).join(', ');

    // Determine delivery type
    let delType: string | undefined = undefined;
    const pmtLower = pmtMethod.toLowerCase();
    if (pmtLower.includes('glovo')) delType = 'GLOVO';
    else if (pmtLower.includes('bolt')) delType = 'BOLT';
    else if (pmtLower.includes('wolt')) delType = 'WOLT';
    else if (pmtLower.includes('taxi')) delType = 'TAXI';
    else if (isDel) delType = 'DELIVERY';

    if (tInfo.number && ['glovo', 'bolt', 'wolt', 'taxi'].includes(tInfo.number.toLowerCase())) {
      delType = tInfo.number.toUpperCase();
    }

    // Filter by deliveryType if requested
    if (options.deliveryType && options.deliveryType !== 'all') {
      if (options.deliveryType === 'dine_in' && (isDel || delType)) continue;
      if (options.deliveryType !== 'dine_in') {
        const req = options.deliveryType.toLowerCase();
        const matches = (delType && delType.toLowerCase().includes(req)) || (pmtLower.includes(req));
        if (!matches) continue;
      }
    }

    // Filter by general search query if given
    if (options.query) {
      const q = options.query.toLowerCase();
      const match =
        String(o.id).includes(q) ||
        tInfo.number.toLowerCase().includes(q) ||
        tInfo.room_name.toLowerCase().includes(q) ||
        pmtMethod.toLowerCase().includes(q) ||
        (userMap.get(o.creator) || '').toLowerCase().includes(q) ||
        (delType || '').toLowerCase().includes(q) ||
        itemsSummary.toLowerCase().includes(q);

      if (!match) continue;
    }

    filteredOrders.push({
      order_id: o.id,
      table_number: tInfo.number,
      room_name: tInfo.room_name,
      status: o.status,
      date: o.date,
      total_price: Number((parseFloat(o.price) || 0).toFixed(2)),
      prepayment: Number((parseFloat(o.prepayment) || 0).toFixed(2)),
      service_fee: Number((parseFloat(o.service_fee) || 0).toFixed(2)),
      discount_amount: Number((parseFloat(o.discount_amount) || 0).toFixed(2)),
      payment_method: pmtMethod || (isDel ? 'DELIVERY' : '—'),
      waiter_name: userMap.get(o.creator) || `თანამშრომელი #${o.creator}`,
      delivery_type: delType,
      is_delivery: isDel || !!delType,
      guests_count: parseInt(o.count, 10) || 0,
      items_summary: itemsSummary,
      items
    });
  }

  return {
    tenant_name: tenant.name,
    total_found: filteredOrders.length,
    orders: filteredOrders
  };
}

export async function getOrderDetails(orderId: number, tenantIdentifier?: string) {
  const tenant = await resolveTenant(tenantIdentifier);

  const { data: order, error } = await supabase
    .from('orders')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('id', orderId)
    .maybeSingle();

  if (error || !order) {
    throw new Error(`შეკვეთა #${orderId} ვერ მოიძებნა ობიექტზე ${tenant.name}`);
  }

  const [{ data: itemsData }, { data: salaroData }, { data: userData }, { data: tableData }] = await Promise.all([
    supabase
      .from('order_list')
      .select('id, item, count, price, message, type, date, items:item(name, type, price)')
      .eq('orderID', orderId),
    supabase
      .from('salaro')
      .select('*')
      .eq('tenant_id', tenant.id)
      .or(`order_id.eq.${orderId}${order.hash ? `,hash.eq.${order.hash}` : ''}`),
    order.creator ? supabase.from('users').select('name, username, phone').eq('id', order.creator).maybeSingle() : Promise.resolve({ data: null }),
    order.table ? supabase.from('tables').select('number, rid, rooms:rid(name)').eq('id', order.table).maybeSingle() : Promise.resolve({ data: null })
  ]);

  const items = (itemsData || []).map((it: any) => ({
    id: it.id,
    name: it.items?.name || `პოზიცია #${it.item}`,
    count: parseFloat(it.count) || 1,
    unit_price: parseFloat(it.price) || 0,
    total_price: Number(((parseFloat(it.count) || 1) * (parseFloat(it.price) || 0)).toFixed(2)),
    category_type: it.items?.type || it.type || 'restourant',
    comment: it.message || ''
  }));

  const payments = (salaroData || []).map((s: any) => ({
    id: s.id,
    amount: parseFloat(s.price_in) || 0,
    change_back: parseFloat(s.back) || 0,
    discount: parseFloat(s.discount) || 0,
    payment_method: s.payment || s.payment_type || 'cash',
    date: s.date,
    comment: s.comment || ''
  }));

  return {
    order_id: order.id,
    tenant_name: tenant.name,
    status: order.status,
    date: order.date,
    total_price: Number((parseFloat(order.price) || 0).toFixed(2)),
    prepayment: Number((parseFloat(order.prepayment) || 0).toFixed(2)),
    service_fee: Number((parseFloat(order.service_fee) || 0).toFixed(2)),
    discount_amount: Number((parseFloat(order.discount_amount) || 0).toFixed(2)),
    guests_count: parseInt(order.count, 10) || 0,
    table_number: (tableData as any)?.number || (order.is_delivery ? 'მიტანა' : String(order.table || '—')),
    room_name: (tableData as any)?.rooms?.name || (order.is_delivery ? 'მიტანის სერვისი' : 'დარბაზი'),
    waiter_name: (userData as any)?.name || (userData as any)?.username || `თანამშრომელი #${order.creator}`,
    is_delivery: !!order.is_delivery,
    delivery_type: payments.map(p => p.payment_method).find(pm => ['glovo', 'bolt', 'wolt', 'taxi'].some(x => pm.toLowerCase().includes(x))) || (order.is_delivery ? 'DELIVERY' : undefined),
    items,
    payments
  };
}

export async function getDeliveryOrders(
  tenantIdentifier?: string,
  options: {
    platform?: 'all' | 'glovo' | 'bolt' | 'wolt' | 'taxi' | 'web';
    status?: string;
    limit?: number;
  } = {}
) {
  const tenant = await resolveTenant(tenantIdentifier);
  const limit = options.limit || 20;

  // 1. Fetch from web_orders
  let webOrders: any[] = [];
  if (!options.platform || options.platform === 'all' || options.platform === 'web') {
    const { data } = await supabase
      .from('web_orders')
      .select('*')
      .eq('tenant_id', tenant.id)
      .order('date', { ascending: false })
      .limit(limit);
    webOrders = data || [];
  }

  // 2. Fetch platform delivery orders from salaro + orders
  let platformDeliveries: any[] = [];
  const targetPlatform = options.platform && options.platform !== 'all' && options.platform !== 'web' ? options.platform : '';

  let salaroQuery = supabase
    .from('salaro')
    .select('id, order_id, hash, payment, price_in, date, comment')
    .eq('tenant_id', tenant.id);

  if (targetPlatform) {
    salaroQuery = salaroQuery.ilike('payment', `%${targetPlatform}%`);
  } else {
    salaroQuery = salaroQuery.or('payment.ilike.%glovo%,payment.ilike.%bolt%,payment.ilike.%wolt%,payment.ilike.%taxi%,payment.ilike.%delivery%');
  }

  const { data: salaroRows } = await salaroQuery.order('date', { ascending: false }).limit(limit);

  if (salaroRows && salaroRows.length > 0) {
    const orderIds = salaroRows.map(s => s.order_id).filter(Boolean);
    const { data: ords } = orderIds.length > 0
      ? await supabase.from('orders').select('id, status, price, date, is_delivery, table, creator').in('id', orderIds)
      : { data: [] };

    const { data: items } = orderIds.length > 0
      ? await supabase.from('order_list').select('orderID, item, count, price, items:item(name)').in('orderID', orderIds)
      : { data: [] };

    const ordMap = new Map<number, any>();
    (ords || []).forEach(o => ordMap.set(o.id, o));

    const itemMap = new Map<number, string[]>();
    (items || []).forEach((it: any) => {
      const arr = itemMap.get(it.orderID) || [];
      arr.push(`${it.items?.name || `პოზიცია #${it.item}`} (${it.count}x)`);
      itemMap.set(it.orderID, arr);
    });

    platformDeliveries = salaroRows.map(s => {
      const linkedOrder = s.order_id ? ordMap.get(s.order_id) : null;
      const itSummary = s.order_id ? (itemMap.get(s.order_id) || []).join(', ') : '';
      return {
        order_id: s.order_id || null,
        salaro_id: s.id,
        platform: s.payment?.toUpperCase() || 'DELIVERY',
        amount: parseFloat(s.price_in) || 0,
        date: s.date,
        status: linkedOrder?.status || 'completed',
        items_summary: itSummary,
        comment: s.comment || ''
      };
    });
  }

  // 3. Also fetch general POS deliveries where is_delivery is true
  const posDeliveries = await searchOrders(tenant.id, {
    deliveryType: (options.platform && options.platform !== 'all' && options.platform !== 'web') ? options.platform : 'all',
    limit
  });

  return {
    tenant_name: tenant.name,
    web_orders_count: webOrders.length,
    platform_deliveries_count: platformDeliveries.length,
    pos_delivery_orders_count: posDeliveries.orders.filter(o => o.is_delivery).length,
    platform_deliveries: platformDeliveries,
    web_orders: webOrders.map(w => ({
      id: w.id,
      date: w.date,
      price: w.price,
      phone: w.phone,
      address: `${w.address || ''} ${w.entrance ? `სად. ${w.entrance}` : ''} ${w.floor ? `სართ. ${w.floor}` : ''} ${w.flat ? `ბინა ${w.flat}` : ''}`.trim(),
      comment: w.comment,
      status: w.status === 0 ? 'ახალი / NEW' : w.status === 1 ? 'მიღებული / ACCEPTED' : 'დასრულებული / COMPLETED'
    })),
    pos_delivery_orders: posDeliveries.orders
  };
}
