import { resolveTenant } from './src/db.js';
import { getTodaySummary } from './src/analytics/todaySummary.js';
import { getSalesAnalytics } from './src/analytics/salesAnalytics.js';
import { getExpensesAnalytics } from './src/analytics/expensesAnalytics.js';
import { getTopSellingItems } from './src/analytics/topItems.js';
import { getActiveOrders } from './src/analytics/activeOrders.js';
import { getInventoryAlerts } from './src/analytics/inventoryAlerts.js';
import { getPurchasesAnalytics, searchPurchases, getPurchaseDetails } from './src/analytics/purchasesAnalytics.js';
import { getInventoryActs, getInventoryActDetails, getInventoryDiscrepancySummary } from './src/analytics/inventoriesAnalytics.js';
import { getRecipeCalculations, getDishRecipeDetails, getSemiFinishedAnalytics } from './src/analytics/calculationsAnalytics.js';

async function runTest() {
  console.log('--- Testing POS MCP Analytics Tools ---');

  console.log('\n1. Resolving Default Tenant:');
  const tenant = await resolveTenant();
  console.log('Tenant:', tenant);

  console.log('\n2. Testing getTodaySummary:');
  const todaySummary = await getTodaySummary();
  console.log('Today Summary:', {
    tenant: todaySummary.tenant.name,
    date: todaySummary.date,
    revenue: todaySummary.revenue,
    orders: todaySummary.orders_metrics,
    expenses: todaySummary.expenses,
    shift: todaySummary.shift_status
  });

  console.log('\n3. Testing Purchases Analytics (this_month):');
  const purchases = await getPurchasesAnalytics(undefined, 'this_month');
  console.log('Purchases Summary:', {
    tenant: purchases.tenant.name,
    period: purchases.period_label,
    total_amount: purchases.summary.total_purchase_amount,
    invoices_count: purchases.summary.total_invoices_count,
    items_count: purchases.summary.total_items_count,
    suppliers_count: purchases.suppliers_summary.length,
    top_products_count: purchases.top_purchased_products.length
  });
  if (purchases.suppliers_summary.length > 0) {
    console.log('Top Supplier:', purchases.suppliers_summary[0]);
  }
  if (purchases.recent_invoices.length > 0) {
    const sampleInv = purchases.recent_invoices[0];
    console.log('Sample Invoice Details for code:', sampleInv.invoice_code);
    const invDetails = await getPurchaseDetails(sampleInv.invoice_code);
    console.log(`Invoice #${invDetails.invoice_code} items count: ${invDetails.items.length}, Grand Total: ${invDetails.grand_total} GEL`);
  }

  console.log('\n4. Testing Search Purchases:');
  const searchPurchRes = await searchPurchases(undefined, { limit: 5 });
  console.log('Search purchases found:', searchPurchRes.total_found);

  console.log('\n5. Testing Inventory Acts:');
  const invActs = await getInventoryActs(undefined, { limit: 5 });
  console.log('Inventory Acts Summary:', {
    total_acts: invActs.summary.total_acts_count,
    items_checked: invActs.summary.total_items_checked,
    shortage_amount: invActs.summary.total_shortage_amount,
    surplus_amount: invActs.summary.total_surplus_amount,
    net_discrepancy: invActs.summary.total_net_discrepancy
  });
  if (invActs.acts.length > 0) {
    const firstAct = invActs.acts[0];
    const actDetails = await getInventoryActDetails(firstAct.id);
    console.log(`Act #${firstAct.id} Details:`, {
      warehouse: actDetails.act.warehouse_type,
      total_items: actDetails.statistics.total_items_count,
      shortages: actDetails.statistics.shortages_count,
      surpluses: actDetails.statistics.surpluses_count
    });
  }

  console.log('\n6. Testing Inventory Discrepancy Summary:');
  const discrepancies = await getInventoryDiscrepancySummary(undefined, 'this_month');
  console.log('Discrepancies:', {
    audits_count: discrepancies.total_audits_count,
    total_shortages: discrepancies.total_shortages_sum,
    total_surpluses: discrepancies.total_surpluses_sum,
    problematic_products_count: discrepancies.problematic_products.length
  });

  console.log('\n7. Testing Recipe Calculations (Food Cost & Margins):');
  const recipes = await getRecipeCalculations(undefined, { limit: 10 });
  console.log('Menu Recipes Summary:', {
    total_dishes: recipes.summary.total_dishes_count,
    dishes_with_recipe: recipes.summary.dishes_with_recipe,
    dishes_without_recipe: recipes.summary.dishes_without_recipe,
    avg_food_cost_pct: recipes.summary.average_food_cost_pct,
    avg_selling_price: recipes.summary.average_selling_price,
    avg_cost_price: recipes.summary.average_cost_price,
    avg_margin: recipes.summary.average_margin,
    high_food_cost_count: recipes.summary.high_food_cost_count
  });
  if (recipes.dishes.length > 0) {
    const sampleDish = recipes.dishes.find(d => d.has_recipe) || recipes.dishes[0];
    console.log('Sample Dish Recipe Breakdown for:', sampleDish.name);
    const dishRecipe = await getDishRecipeDetails(sampleDish.hash);
    console.log(`Dish "${dishRecipe.item.name}" Selling: ${dishRecipe.item.selling_price} GEL | Cost: ${dishRecipe.item.prime_cost} GEL | FC: ${dishRecipe.item.food_cost_pct}%`);
    console.log(`Ingredients count: ${dishRecipe.ingredients.length}`);
  }

  console.log('\n8. Testing Semi-Finished Products:');
  const semiProds = await getSemiFinishedAnalytics();
  console.log('Semi-Finished items count:', semiProds.total_semi_finished_count);
  if (semiProds.items.length > 0) {
    const firstSemi = semiProds.items[0];
    console.log(`Sample Semi-finished "${firstSemi.name}": Yield: ${firstSemi.yield_target_weight} ${firstSemi.unit_name}, Unit Cost: ${firstSemi.calculated_cost_per_unit} GEL`);
  }

  console.log('\n✅ All Purchases, Inventories, and Calculations tools tested successfully!');
}

runTest().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
