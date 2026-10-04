import { resolveTenant } from './src/db.js';
import { getTodaySummary } from './src/analytics/todaySummary.js';
import { getSalesAnalytics } from './src/analytics/salesAnalytics.js';
import { getExpensesAnalytics } from './src/analytics/expensesAnalytics.js';
import { getTopSellingItems } from './src/analytics/topItems.js';
import { getActiveOrders } from './src/analytics/activeOrders.js';
import { getInventoryAlerts } from './src/analytics/inventoryAlerts.js';

async function runTest() {
  console.log('--- Testing POS MCP Analytics Tools ---');

  console.log('\n1. Resolving Default Tenant:');
  const tenant = await resolveTenant();
  console.log('Tenant:', tenant);

  console.log('\n2. Testing getTodaySummary:');
  const { data: sampleOrders } = await (await import('./src/db.js')).supabase
    .from('orders')
    .select('id, status, price, date')
    .limit(10);
  console.log('Sample orders statuses:', sampleOrders?.map(o => ({ id: o.id, status: o.status, price: o.price, date: o.date })));

  const todaySummary = await getTodaySummary();
  console.log('Today Summary:', {
    tenant: todaySummary.tenant.name,
    date: todaySummary.date,
    revenue: todaySummary.revenue,
    orders: todaySummary.orders_metrics,
    expenses: todaySummary.expenses,
    shift: todaySummary.shift_status
  });

  console.log('\n3. Testing getSalesAnalytics (this_month):');
  const sales = await getSalesAnalytics(undefined, 'this_month');
  console.log('Sales (this_month):', {
    period: sales.period_label,
    total_revenue: sales.total_revenue,
    orders_count: sales.orders_count,
    average_check: sales.average_check,
    halls_count: sales.halls_sales.length
  });

  console.log('\n4. Testing getExpensesAnalytics:');
  const expenses = await getExpensesAnalytics(undefined, 'this_month');
  console.log('Expenses:', {
    total: expenses.total_expenses,
    breakdown: expenses.breakdown,
    suppliers_count: expenses.suppliers_summary.length
  });

  console.log('\n5. Testing getTopSellingItems (this_month):');
  const topItems = await getTopSellingItems(undefined, 'this_month', 5);
  console.log('Top items count:', topItems.items.length);
  console.log('Category breakdown:', topItems.category_breakdown);
  topItems.items.forEach((it, i) => console.log(`  ${i + 1}. ${it.item_name} (${it.type}) - ${it.quantity_sold} sold (${it.total_revenue} GEL)`));

  console.log('\n5b. Testing getSalesAnalytics (last_month = September):');
  const septSales = await getSalesAnalytics(undefined, 'last_month');
  console.log('September Sales:', {
    period: septSales.period_label,
    total_revenue: septSales.total_revenue,
    orders_count: septSales.orders_count,
    average_check: septSales.average_check,
    total_discounts: septSales.total_discounts
  });

  console.log('\n6. Testing getActiveOrders:');
  const activeOrders = await getActiveOrders();
  console.log('Active tables:', activeOrders.active_tables_count, 'Total open amount:', activeOrders.total_open_amount, 'Stale unclosed:', activeOrders.stale_unclosed_orders_count);

  console.log('\n7. Testing getInventoryAlerts:');
  const inventory = await getInventoryAlerts();
  console.log('Inventory alerts total:', inventory.total_alerts, 'Critical zero stock:', inventory.critical_zero_stock_count);

  console.log('\n8. Testing Multi-Tenant Resolution (Ajara Palace):');
  const ajaraTenant = await resolveTenant('ajarapalace');
  console.log('Resolved Tenant:', ajaraTenant);
  const ajaraSales = await getSalesAnalytics('ajarapalace', 'this_month');
  console.log('Ajara Palace Sales (this_month):', {
    total_revenue: ajaraSales.total_revenue,
    orders_count: ajaraSales.orders_count,
    average_check: ajaraSales.average_check
  });

  console.log('\n9. Testing searchOrders & getOrderDetails:');
  const { searchOrders, getOrderDetails, getDeliveryOrders } = await import('./src/analytics/orderSearch.js');
  const foundOrders = await searchOrders('teatro', { limit: 3 });
  console.log('Search orders found:', foundOrders.total_found);
  if (foundOrders.orders.length > 0) {
    const firstOrder = foundOrders.orders[0];
    console.log('Sample order preview:', {
      id: firstOrder.order_id,
      table: firstOrder.table_number,
      total: firstOrder.total_price,
      status: firstOrder.status,
      items: firstOrder.items_summary
    });
    const details = await getOrderDetails(firstOrder.order_id, 'teatro');
    console.log(`Order #${firstOrder.order_id} Items Count:`, details.items.length, 'Payments Count:', details.payments.length);
  }

  console.log('\n10. Testing getDeliveryOrders:');
  const deliveryData = await getDeliveryOrders('ajarapalace', { limit: 5 });
  console.log('Web deliveries count:', deliveryData.web_orders_count, 'POS deliveries count:', deliveryData.pos_delivery_orders_count);

  console.log('\n✅ All analytics tests completed successfully!');
}

runTest().catch(console.error);
