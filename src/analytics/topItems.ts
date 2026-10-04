import { supabase, resolveTenant, getPeriodBounds, fetchAllRows } from '../db.js';
import { TopItemSummary } from '../types.js';

export async function getTopSellingItems(
  tenantIdentifier?: string,
  period: string = 'today',
  limit: number = 20,
  sortBy: 'revenue' | 'quantity' = 'revenue',
  customStart?: string,
  customEnd?: string
): Promise<{
  period_label: string;
  total_items_sold: number;
  total_sales_amount: number;
  items: TopItemSummary[];
  category_breakdown: {
    kitchen: { revenue: number; count: number };
    bar: { revenue: number; count: number };
    hookah: { revenue: number; count: number };
    other: { revenue: number; count: number };
  };
}> {
  const tenant = await resolveTenant(tenantIdentifier);
  const bounds = getPeriodBounds(period, customStart, customEnd);

  // 1. Fetch order_list records within period using full pagination
  const orderListData = await fetchAllRows(async (from, to) => {
    return supabase
      .from('order_list')
      .select('id, item, count, price, type, date, deleted')
      .eq('tenant_id', tenant.id)
      .eq('deleted', false)
      .gte('date', bounds.start)
      .lte('date', bounds.end)
      .range(from, to);
  });

  // 2. Fetch categories and menu items
  const [{ data: categoriesData }, itemsData] = await Promise.all([
    supabase.from('categories').select('id, name, type'),
    fetchAllRows(async (from, to) => {
      return supabase
        .from('items')
        .select('id, name, type, category')
        .eq('tenant_id', tenant.id)
        .range(from, to);
    })
  ]);

  const catMap = new Map<number, { name: string; type: string }>();
  (categoriesData || []).forEach(c => {
    catMap.set(c.id, { name: c.name.trim(), type: c.type || 'restourant' });
  });

  const itemsMap = new Map<number, { name: string; type: string; categoryName: string }>();
  itemsData.forEach(it => {
    // Determine category IDs from comma-separated string e.g. "241," or "66,"
    const catIds = (it.category || '')
      .split(',')
      .map((s: string) => parseInt(s.trim(), 10))
      .filter((n: number) => !isNaN(n));

    let detectedType = it.type || 'restourant';
    let catName = '';

    for (const cId of catIds) {
      const c = catMap.get(cId);
      if (c) {
        catName = c.name;
        if (c.type === 'hookah' || c.name.toLowerCase().includes('hookah') || c.name.includes('ჰუკა')) {
          detectedType = 'hookah';
          break;
        }
        if (c.type === 'bar' || c.name.toLowerCase().includes('bar') || c.name.includes('ბარი') || c.name.includes('კოქტეილ') || c.name.includes('კონიაკ')) {
          detectedType = 'bar';
        }
      }
    }

    const nameLower = (it.name || '').toLowerCase();
    if (nameLower.includes('hookah') || nameLower.includes('ჰუკა') || nameLower.includes('კალიან')) {
      detectedType = 'hookah';
    } else if (
      nameLower.includes('gin') ||
      nameLower.includes('tonic') ||
      nameLower.includes('vodka') ||
      nameLower.includes('whiskey') ||
      nameLower.includes('cocktail') ||
      nameLower.includes('wine') ||
      nameLower.includes('beer') ||
      nameLower.includes('corona') ||
      nameLower.includes('red bull') ||
      nameLower.includes('juice') ||
      nameLower.includes('cola') ||
      nameLower.includes('water')
    ) {
      detectedType = 'bar';
    }

    itemsMap.set(it.id, {
      name: it.name,
      type: detectedType,
      categoryName: catName
    });
  });

  const aggregateMap = new Map<number, {
    item_id: number;
    item_name: string;
    type: string;
    quantity: number;
    revenue: number;
  }>();

  let kitchenRevenue = 0;
  let kitchenCount = 0;
  let barRevenue = 0;
  let barCount = 0;
  let hookahRevenue = 0;
  let hookahCount = 0;
  let otherRevenue = 0;
  let otherCount = 0;

  let totalItemsSold = 0;
  let totalSalesAmount = 0;

  orderListData.forEach(row => {
    const itId = row.item;
    const count = parseFloat(row.count) || 0;
    const price = parseFloat(row.price) || 0;
    const revenue = count * price;

    totalItemsSold += count;
    totalSalesAmount += revenue;

    const meta = itemsMap.get(itId) || {
      name: `პოზიცია #${itId}`,
      type: row.type || 'restourant',
      categoryName: ''
    };

    const finalType = meta.type.toLowerCase();

    if (finalType.includes('hookah')) {
      hookahRevenue += revenue;
      hookahCount += count;
    } else if (finalType.includes('bar')) {
      barRevenue += revenue;
      barCount += count;
    } else if (finalType.includes('restourant') || finalType.includes('kitchen')) {
      kitchenRevenue += revenue;
      kitchenCount += count;
    } else {
      otherRevenue += revenue;
      otherCount += count;
    }

    const existing = aggregateMap.get(itId) || {
      item_id: itId,
      item_name: meta.name,
      type: meta.type,
      quantity: 0,
      revenue: 0
    };

    existing.quantity += count;
    existing.revenue += revenue;
    aggregateMap.set(itId, existing);
  });

  const itemsList: TopItemSummary[] = Array.from(aggregateMap.values()).map(it => ({
    item_id: it.item_id,
    item_name: it.item_name,
    type: it.type,
    quantity_sold: Number(it.quantity.toFixed(2)),
    total_revenue: Number(it.revenue.toFixed(2)),
    average_price: it.quantity > 0 ? Number((it.revenue / it.quantity).toFixed(2)) : 0
  }));

  if (sortBy === 'quantity') {
    itemsList.sort((a, b) => b.quantity_sold - a.quantity_sold);
  } else {
    itemsList.sort((a, b) => b.total_revenue - a.total_revenue);
  }

  return {
    period_label: bounds.label,
    total_items_sold: Number(totalItemsSold.toFixed(2)),
    total_sales_amount: Number(totalSalesAmount.toFixed(2)),
    items: itemsList.slice(0, limit),
    category_breakdown: {
      kitchen: { revenue: Number(kitchenRevenue.toFixed(2)), count: Number(kitchenCount.toFixed(2)) },
      bar: { revenue: Number(barRevenue.toFixed(2)), count: Number(barCount.toFixed(2)) },
      hookah: { revenue: Number(hookahRevenue.toFixed(2)), count: Number(hookahCount.toFixed(2)) },
      other: { revenue: Number(otherRevenue.toFixed(2)), count: Number(otherCount.toFixed(2)) }
    }
  };
}
