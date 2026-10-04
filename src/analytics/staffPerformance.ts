import { supabase, resolveTenant, getPeriodBounds, fetchAllRows } from '../db.js';
import { StaffPerformanceSummary } from '../types.js';

export async function getStaffPerformance(
  tenantIdentifier?: string,
  period: string = 'today',
  customStart?: string,
  customEnd?: string
): Promise<{
  period_label: string;
  total_staff_count: number;
  total_orders_count: number;
  total_revenue: number;
  ranking: StaffPerformanceSummary[];
}> {
  const tenant = await resolveTenant(tenantIdentifier);
  const bounds = getPeriodBounds(period, customStart, customEnd);

  const [orders, usersData] = await Promise.all([
    fetchAllRows(async (from, to) => {
      return supabase
        .from('orders')
        .select('id, price, creator, status, date')
        .eq('tenant_id', tenant.id)
        .in('status', ['closed', 'completed', 'paid'])
        .gte('date', bounds.start)
        .lte('date', bounds.end)
        .range(from, to);
    }),
    supabase
      .from('users')
      .select('id, name, username, category')
      .eq('tenant_id', tenant.id)
  ]);

  const users = usersData.data || [];

  const userMap = new Map<number, { name: string; role: string }>();
  users.forEach(u => {
    userMap.set(u.id, {
      name: u.name || u.username,
      role: u.category === 1 ? 'მოლარე / Cashier' : 'მიმტანი / Waiter'
    });
  });

  let totalRev = 0;
  const staffStats = new Map<number, { count: number; revenue: number }>();
  orders.forEach(o => {
    const creatorId = o.creator || 0;
    const price = parseFloat(o.price) || 0;
    totalRev += price;
    const existing = staffStats.get(creatorId) || { count: 0, revenue: 0 };
    existing.count += 1;
    existing.revenue += price;
    staffStats.set(creatorId, existing);
  });

  const ranking: StaffPerformanceSummary[] = Array.from(staffStats.entries()).map(([userId, stats]) => {
    const uInfo = userMap.get(userId) || { name: `თანამშრომელი #${userId}`, role: 'პერსონალი' };
    return {
      user_id: userId,
      name: uInfo.name,
      role: uInfo.role,
      orders_count: stats.count,
      total_revenue: Number(stats.revenue.toFixed(2)),
      average_check: stats.count > 0 ? Number((stats.revenue / stats.count).toFixed(2)) : 0
    };
  }).sort((a, b) => b.total_revenue - a.total_revenue);

  return {
    period_label: bounds.label,
    total_staff_count: ranking.length,
    total_orders_count: orders.length,
    total_revenue: Number(totalRev.toFixed(2)),
    ranking
  };
}
