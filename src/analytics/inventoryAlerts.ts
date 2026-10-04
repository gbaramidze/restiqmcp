import { supabase, resolveTenant } from '../db.js';
import { InventoryAlert } from '../types.js';

export async function getInventoryAlerts(tenantIdentifier?: string): Promise<{
  tenant_name: string;
  total_alerts: number;
  critical_zero_stock_count: number;
  low_stock_count: number;
  alerts: InventoryAlert[];
}> {
  const tenant = await resolveTenant(tenantIdentifier);

  const { data: productsData, error } = await supabase
    .from('products')
    .select('id, name, count, need, ert, code')
    .eq('tenant_id', tenant.id);

  if (error) {
    console.error('Error fetching inventory products:', error);
  }

  const products = productsData || [];
  const alerts: InventoryAlert[] = [];
  let criticalCount = 0;
  let lowCount = 0;

  products.forEach(p => {
    const stock = parseFloat(p.count) || 0;
    const need = parseFloat(p.need) || 0;

    if (stock <= 0 || (need > 0 && stock <= need)) {
      const isCritical = stock <= 0;
      if (isCritical) criticalCount++;
      else lowCount++;

      alerts.push({
        product_id: p.id,
        name: p.name,
        code: p.code,
        current_stock: Number(stock.toFixed(3)),
        minimum_required: Number(need.toFixed(3)),
        deficit: Number(Math.max(0, need - stock).toFixed(3)),
        unit: p.ert ? `Unit #${p.ert}` : 'ცალი/კგ',
        status: isCritical ? 'CRITICAL_ZERO' : 'LOW_STOCK'
      });
    }
  });

  alerts.sort((a, b) => {
    if (a.status === 'CRITICAL_ZERO' && b.status !== 'CRITICAL_ZERO') return -1;
    if (a.status !== 'CRITICAL_ZERO' && b.status === 'CRITICAL_ZERO') return 1;
    return b.deficit - a.deficit;
  });

  return {
    tenant_name: tenant.name,
    total_alerts: alerts.length,
    critical_zero_stock_count: criticalCount,
    low_stock_count: lowCount,
    alerts: alerts.slice(0, 50)
  };
}
