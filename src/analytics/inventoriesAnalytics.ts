import { supabase, resolveTenant, getPeriodBounds } from '../db.js';

export interface InventoryActSummary {
  id: number;
  date: string;
  created_at: string;
  warehouse_type: string;
  comment: string;
  status: string;
  total_items: number;
  shortage_amount: number;
  surplus_amount: number;
  net_amount: number;
  created_by_name?: string;
}

export interface InventoryActItemDetail {
  id: number;
  product_id: number;
  product_name: string;
  unit_name: string;
  price: number;
  expected_stock: number;
  actual_stock: number;
  difference: number;
  diff_amount: number;
  status: 'EXACT' | 'SHORTAGE' | 'SURPLUS';
}

export interface InventoryActsResult {
  tenant: {
    id: string;
    name: string;
    currency: string;
  };
  period_label?: string;
  summary: {
    total_acts_count: number;
    total_items_checked: number;
    total_shortage_amount: number;
    total_surplus_amount: number;
    total_net_discrepancy: number;
    currency: string;
  };
  acts: InventoryActSummary[];
}

export async function getInventoryActs(
  tenantIdentifier?: string,
  options: {
    period?: string;
    startDate?: string;
    endDate?: string;
    warehouse?: string;
    status?: string;
    limit?: number;
  } = {}
): Promise<InventoryActsResult> {
  const tenant = await resolveTenant(tenantIdentifier);
  const limit = options.limit || 30;

  // 1. Fetch Users Map for created_by resolution
  const { data: usersData } = await supabase.from('users').select('id, name, username');
  const userMap = new Map<number, string>();
  (usersData || []).forEach((u: any) => userMap.set(u.id, u.name || u.username));

  let query = supabase
    .from('inventory_acts')
    .select('id, created_at, created_by, warehouse_type, category_id, comment, status, total_items, shortage_amount, surplus_amount, net_amount, tenant_id')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false });

  let periodLabel: string | undefined;
  if (options.period && options.period !== 'all') {
    const bounds = getPeriodBounds(options.period, options.startDate, options.endDate);
    periodLabel = bounds.label;
    query = query.gte('created_at', bounds.start).lte('created_at', bounds.end);
  } else if (options.startDate && options.endDate) {
    const bounds = getPeriodBounds('custom', options.startDate, options.endDate);
    periodLabel = bounds.label;
    query = query.gte('created_at', bounds.start).lte('created_at', bounds.end);
  }

  if (options.warehouse && options.warehouse !== 'ALL' && options.warehouse !== 'ყველა') {
    query = query.eq('warehouse_type', options.warehouse);
  }

  if (options.status && options.status !== 'all') {
    query = query.eq('status', options.status);
  }

  const { data: actsData, error } = await query.limit(limit);
  if (error) throw error;

  let totalItemsChecked = 0;
  let totalShortage = 0;
  let totalSurplus = 0;
  let totalNet = 0;

  const acts: InventoryActSummary[] = (actsData || []).map(a => {
    const shortage = parseFloat(a.shortage_amount) || 0;
    const surplus = parseFloat(a.surplus_amount) || 0;
    const net = parseFloat(a.net_amount) || 0;
    const itemsCount = parseInt(a.total_items, 10) || 0;

    totalItemsChecked += itemsCount;
    totalShortage += shortage;
    totalSurplus += surplus;
    totalNet += net;

    return {
      id: a.id,
      date: a.created_at,
      created_at: a.created_at,
      warehouse_type: a.warehouse_type || 'ყველა',
      comment: a.comment || '',
      status: a.status || 'completed',
      total_items: itemsCount,
      shortage_amount: Number(shortage.toFixed(2)),
      surplus_amount: Number(surplus.toFixed(2)),
      net_amount: Number(net.toFixed(2)),
      created_by_name: a.created_by ? (userMap.get(a.created_by) || `მომხმარებელი #${a.created_by}`) : undefined
    };
  });

  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      currency: tenant.currency || 'GEL'
    },
    period_label: periodLabel,
    summary: {
      total_acts_count: acts.length,
      total_items_checked: totalItemsChecked,
      total_shortage_amount: Number(totalShortage.toFixed(2)),
      total_surplus_amount: Number(totalSurplus.toFixed(2)),
      total_net_discrepancy: Number(totalNet.toFixed(2)),
      currency: tenant.currency || 'GEL'
    },
    acts
  };
}

export async function getInventoryActDetails(
  actId: number,
  tenantIdentifier?: string
) {
  const tenant = await resolveTenant(tenantIdentifier);

  // 1. Fetch Act Header
  const { data: act, error: actErr } = await supabase
    .from('inventory_acts')
    .select('*')
    .eq('id', actId)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (actErr) throw actErr;
  if (!act) {
    throw new Error(`ინვენტარიზაციის აქტი #${actId} ვერ მოიძებნა.`);
  }

  // 2. Fetch Creator Name
  let creatorName = 'უცნობი';
  if (act.created_by) {
    const { data: user } = await supabase.from('users').select('name, username').eq('id', act.created_by).maybeSingle();
    if (user) creatorName = user.name || user.username;
  }

  // 3. Fetch Act Items
  const { data: itemsData, error: itemsErr } = await supabase
    .from('inventory_act_items')
    .select('*')
    .eq('act_id', actId)
    .order('id', { ascending: true });

  if (itemsErr) throw itemsErr;

  const items: InventoryActItemDetail[] = (itemsData || []).map(it => {
    const diff = parseFloat(it.difference) || 0;
    const diffAmt = parseFloat(it.diff_amount) || 0;
    const price = parseFloat(it.price) || 0;
    const exp = parseFloat(it.expected_stock) || 0;
    const actStock = parseFloat(it.actual_stock) || 0;

    let status: 'EXACT' | 'SHORTAGE' | 'SURPLUS' = 'EXACT';
    if (diff < -0.0001 || diffAmt < -0.01) {
      status = 'SHORTAGE';
    } else if (diff > 0.0001 || diffAmt > 0.01) {
      status = 'SURPLUS';
    }

    return {
      id: it.id,
      product_id: it.product_id,
      product_name: it.product_name || `პროდუქტი #${it.product_id}`,
      unit_name: it.unit_name || 'ც',
      price: Number(price.toFixed(3)),
      expected_stock: Number(exp.toFixed(3)),
      actual_stock: Number(actStock.toFixed(3)),
      difference: Number(diff.toFixed(3)),
      diff_amount: Number(diffAmt.toFixed(2)),
      status
    };
  });

  const shortages = items.filter(i => i.status === 'SHORTAGE').sort((a, b) => a.diff_amount - b.diff_amount);
  const surpluses = items.filter(i => i.status === 'SURPLUS').sort((a, b) => b.diff_amount - a.diff_amount);
  const exacts = items.filter(i => i.status === 'EXACT');

  return {
    tenant_name: tenant.name,
    act: {
      id: act.id,
      created_at: act.created_at,
      warehouse_type: act.warehouse_type || 'ყველა',
      created_by_name: creatorName,
      comment: act.comment || '',
      status: act.status || 'completed',
      total_items_checked: items.length,
      shortage_amount: Number((parseFloat(act.shortage_amount) || 0).toFixed(2)),
      surplus_amount: Number((parseFloat(act.surplus_amount) || 0).toFixed(2)),
      net_amount: Number((parseFloat(act.net_amount) || 0).toFixed(2)),
      currency: tenant.currency || 'GEL'
    },
    statistics: {
      total_items_count: items.length,
      shortages_count: shortages.length,
      surpluses_count: surpluses.length,
      exact_count: exacts.length
    },
    top_shortages: shortages.slice(0, 15),
    top_surpluses: surpluses.slice(0, 15),
    all_items: items
  };
}

export async function getInventoryDiscrepancySummary(
  tenantIdentifier?: string,
  period: string = 'this_month',
  customStart?: string,
  customEnd?: string
) {
  const tenant = await resolveTenant(tenantIdentifier);
  const bounds = getPeriodBounds(period, customStart, customEnd);

  // Fetch acts in period
  const { data: acts, error } = await supabase
    .from('inventory_acts')
    .select('id, created_at, warehouse_type, shortage_amount, surplus_amount, net_amount')
    .eq('tenant_id', tenant.id)
    .gte('created_at', bounds.start)
    .lte('created_at', bounds.end);

  if (error) throw error;

  const actIds = (acts || []).map(a => a.id);
  if (actIds.length === 0) {
    return {
      tenant_name: tenant.name,
      period_label: bounds.label,
      total_audits_count: 0,
      total_shortages_sum: 0,
      total_surpluses_sum: 0,
      net_balance: 0,
      problematic_products: []
    };
  }

  // Fetch all items from these acts
  const { data: actItems } = await supabase
    .from('inventory_act_items')
    .select('product_id, product_name, unit_name, price, difference, diff_amount')
    .in('act_id', actIds);

  const productAggMap = new Map<string, {
    product_id: number;
    product_name: string;
    unit_name: string;
    total_shortage_qty: number;
    total_shortage_amount: number;
    total_surplus_qty: number;
    total_surplus_amount: number;
    net_diff_amount: number;
    discrepancy_occurrences: number;
  }>();

  let totalShortage = 0;
  let totalSurplus = 0;

  (actItems || []).forEach(it => {
    const diff = parseFloat(it.difference) || 0;
    const diffAmt = parseFloat(it.diff_amount) || 0;
    if (Math.abs(diff) < 0.0001 && Math.abs(diffAmt) < 0.01) return;

    const key = String(it.product_id || it.product_name);
    const existing = productAggMap.get(key) || {
      product_id: it.product_id,
      product_name: it.product_name || `პროდუქტი #${it.product_id}`,
      unit_name: it.unit_name || 'ც',
      total_shortage_qty: 0,
      total_shortage_amount: 0,
      total_surplus_qty: 0,
      total_surplus_amount: 0,
      net_diff_amount: 0,
      discrepancy_occurrences: 0
    };

    existing.discrepancy_occurrences += 1;
    existing.net_diff_amount += diffAmt;

    if (diffAmt < 0) {
      existing.total_shortage_qty += Math.abs(diff);
      existing.total_shortage_amount += Math.abs(diffAmt);
      totalShortage += Math.abs(diffAmt);
    } else {
      existing.total_surplus_qty += diff;
      existing.total_surplus_amount += diffAmt;
      totalSurplus += diffAmt;
    }

    productAggMap.set(key, existing);
  });

  const problematicProducts = Array.from(productAggMap.values())
    .map(p => ({
      ...p,
      total_shortage_qty: Number(p.total_shortage_qty.toFixed(3)),
      total_shortage_amount: Number(p.total_shortage_amount.toFixed(2)),
      total_surplus_qty: Number(p.total_surplus_qty.toFixed(3)),
      total_surplus_amount: Number(p.total_surplus_amount.toFixed(2)),
      net_diff_amount: Number(p.net_diff_amount.toFixed(2))
    }))
    .sort((a, b) => b.total_shortage_amount - a.total_shortage_amount)
    .slice(0, 25);

  return {
    tenant_name: tenant.name,
    period_label: bounds.label,
    total_audits_count: acts.length,
    total_shortages_sum: Number(totalShortage.toFixed(2)),
    total_surpluses_sum: Number(totalSurplus.toFixed(2)),
    net_balance: Number((totalSurplus - totalShortage).toFixed(2)),
    currency: tenant.currency || 'GEL',
    problematic_products: problematicProducts
  };
}
