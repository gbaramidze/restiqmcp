import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supabase } from './db.js';
import { getTodaySummary } from './analytics/todaySummary.js';
import { getSalesAnalytics } from './analytics/salesAnalytics.js';
import { getExpensesAnalytics } from './analytics/expensesAnalytics.js';
import { getTopSellingItems } from './analytics/topItems.js';
import { getShiftAnalytics } from './analytics/shiftAnalytics.js';
import { getInventoryAlerts } from './analytics/inventoryAlerts.js';
import { getActiveOrders } from './analytics/activeOrders.js';
import { getStaffPerformance } from './analytics/staffPerformance.js';
import { getPurchasesAnalytics, searchPurchases, getPurchaseDetails } from './analytics/purchasesAnalytics.js';
import { getInventoryActs, getInventoryActDetails, getInventoryDiscrepancySummary } from './analytics/inventoriesAnalytics.js';
import { getRecipeCalculations, getDishRecipeDetails, getSemiFinishedAnalytics } from './analytics/calculationsAnalytics.js';

export function registerTools(server: McpServer) {
  // 1. Tool: list_tenants
  server.tool(
    'list_tenants',
    'ობიექტების/რესტორნების სია (List available store venues/tenants in the system)',
    {},
    async () => {
      const { data, error } = await supabase
        .from('tenants')
        .select('id, name, slug, code, currency, tax_id, license_plan, is_active')
        .order('name', { ascending: true });

      if (error) {
        return {
          content: [{ type: 'text', text: `შეცდომა ობიექტების ჩატვირთვისას: ${error.message}` }],
          isError: true
        };
      }

      const tenants = data || [];
      const textSummary = tenants.map(t => 
        `• ${t.name} (ID: ${t.id}${t.slug ? `, slug: ${t.slug}` : ''}) — ვალუტა: ${t.currency || 'GEL'}`
      ).join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `🏢 ხელმისაწვდომი ობიექტები (${tenants.length}):\n${textSummary}\n\nJSON:\n` + JSON.stringify(tenants, null, 2)
          }
        ]
      };
    }
  );

  // 2. Tool: get_today_summary
  server.tool(
    'get_today_summary',
    'დღევანდელი ჯამური ფინანსური მაჩვენებლები: შემოსავალი, ხარჯი, საშუალო ჩეკი, სალაროს ბალანსი, გადახდების ტიპები (Today revenue, expenses, average check, cash balance, payment types)',
    {
      tenant: z.string().optional().describe('Tenant ID, Slug ან დასახელება (Optional: tenant ID/slug. If omitted, uses default venue)'),
      date: z.string().optional().describe('თარიღი YYYY-MM-DD ფორმატში (Optional custom date, defaults to today)')
    },
    async ({ tenant, date }) => {
      try {
        const summary = await getTodaySummary(tenant, date);
        const cur = summary.revenue.currency;

        const formatted = `
📊 **${summary.tenant.name} — ${summary.active_shift_summary ? 'მიმდინარე ცვლა და დღის ანგარიში' : 'დღის ანგარიში'} (${summary.date})**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${summary.active_shift_summary ? `
⚡ **აქტიური ცვლა (Active Shift Dashboard — Live):**
  • 🟢 სტატუსი: ღიაა (ცვლა #${summary.active_shift_summary.shift_number || summary.active_shift_summary.shift_id})
  • 👤 მოლარე: ${summary.active_shift_summary.cashier_name}
  • ⏰ გახსნის დრო: ${new Date(summary.active_shift_summary.opened_at).toLocaleString('ka-GE')}
  • 💵 **საწყისი თანხა:** ${summary.active_shift_summary.initial_cash} ${cur}
  • 💵 **ს. ნაღდი ფული:** ${summary.active_shift_summary.cash_sales} ${cur}
  • 💳 **ს. საბანკო ბარათი:** ${summary.active_shift_summary.card_sales} ${cur}
  • 💰 **სულ ცვლის გაყიდვები:** ${summary.active_shift_summary.total_sales} ${cur}
  • 💳 **დეპოზიტი:** ${summary.active_shift_summary.deposit_sum} ${cur}
  • 🍽️ **ღია შეკვეთები:** ${summary.active_shift_summary.open_orders_sum} ${cur} (${summary.active_shift_summary.open_orders_count} შეკვეთა)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` : ''}

💰 **ჯამური შემოსავალი (Revenue):** ${summary.revenue.net_revenue} ${cur} (სალაროს შემოსავალი: ${summary.revenue.gross_total} ${cur}, ფასდაკლება: ${summary.revenue.discounts_total} ${cur})
💳 **გადახდები (Payment Breakdown):**
  • 💵 ნაღდი (Cash): ${summary.payments_breakdown.cash} ${cur}
  • 💳 ბარათი (Card / Terminal): ${summary.payments_breakdown.card} ${cur}
  • 🏦 გადარიცხვა (Bank Transfer): ${summary.payments_breakdown.bank_transfer} ${cur}
  • 🔹 სხვა (Other): ${summary.payments_breakdown.other} ${cur}

📉 **ხარჯები (Expenses):** ${summary.expenses.total_expenses} ${cur}
  • მომწოდებლებზე გაცემული: ${summary.expenses.supplier_payments} ${cur}
  • სალაროდან გაცემა: ${summary.expenses.cash_payouts} ${cur}
  • ჩამოწერები: ${summary.expenses.write_offs} ${cur}

⚖️ **წმინდა სალდო / მოგება (Net Profit):** ${summary.financial_balance.net_profit_or_loss} ${cur}

🧾 **შეკვეთები და საშუალო ჩეკი (Orders & Avg Check):**
  • სულ შეკვეთები: ${summary.orders_metrics.total_orders_count} (დახურული: ${summary.orders_metrics.closed_orders_count}, ღია: ${summary.orders_metrics.active_open_orders_count})
  • 🎯 **საშუალო ჩეკი:** ${summary.orders_metrics.average_check} ${cur}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

        return {
          content: [
            { type: 'text', text: formatted.trim() + '\n\n' + JSON.stringify(summary, null, 2) }
          ]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `შეცდომა ანგარიშის მიღებისას: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // 3. Tool: get_sales_analytics
  server.tool(
    'get_sales_analytics',
    'გაყიდვების დეტალური ანალიტიკა პერიოდის მიხედვით: საათობრივი განაწილება, დარბაზები, მიტანა (Glovo/Bolt/Taxi) (Detailed sales analytics by period, hourly distribution, halls, delivery)',
    {
      tenant: z.string().optional().describe('Tenant ID ან Slug'),
      period: z.enum(['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'custom']).default('today').describe('საანგარიშო პერიოდი'),
      startDate: z.string().optional().describe('საწყისი თარიღი YYYY-MM-DD (თუ period=custom)'),
      endDate: z.string().optional().describe('საბოლოო თარიღი YYYY-MM-DD (თუ period=custom)')
    },
    async ({ tenant, period, startDate, endDate }) => {
      try {
        const res = await getSalesAnalytics(tenant, period, startDate, endDate);
        const topHalls = res.halls_sales.map(h => `  • ${h.room_name}: ${h.revenue} GEL (${h.orders_count} ჩეკი)`).join('\n');
        
        const summaryText = `
📈 **გაყიდვების ანალიტიკა — ${res.period_label}**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 **ჯამური შემოსავალი:** ${res.total_revenue} GEL
🧾 **შეკვეთების რაოდენობა:** ${res.orders_count}
🎯 **საშუალო ჩეკი:** ${res.average_check} GEL

🛵 **მიტანა vs დარბაზი:**
  • ადგილზე (Dine-in): ${res.delivery_breakdown.dine_in_revenue} GEL
  • მიტანა ჯამში (Delivery): ${res.delivery_breakdown.delivery_revenue} GEL (Glovo: ${res.delivery_breakdown.glovo_revenue} GEL, Bolt: ${res.delivery_breakdown.bolt_revenue} GEL, Taxi: ${res.delivery_breakdown.taxi_revenue} GEL)

🏛️ **შემოსავალი დარბაზების მიხედვით:**
${topHalls || '  • ინფორმაცია არ არის'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        return {
          content: [{ type: 'text', text: summaryText.trim() + '\n\n' + JSON.stringify(res, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `შეცდომა გაყიდვების ანალიზისას: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // 4. Tool: get_expenses_summary
  server.tool(
    'get_expenses_summary',
    'ხარჯების ანალიზი პერიოდის მიხედვით: მომწოდებლებზე გადახდები, სალაროდან გაცემები, ჩამოწერები (Expenses analytics by period: supplier payouts, cash desk out, write-offs)',
    {
      tenant: z.string().optional().describe('Tenant ID ან Slug'),
      period: z.enum(['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'custom']).default('today'),
      startDate: z.string().optional().describe('YYYY-MM-DD'),
      endDate: z.string().optional().describe('YYYY-MM-DD')
    },
    async ({ tenant, period, startDate, endDate }) => {
      try {
        const res = await getExpensesAnalytics(tenant, period, startDate, endDate);
        const supText = res.suppliers_summary.slice(0, 5).map(s => `  • ${s.supplier_name}: ${s.total_paid} GEL (${s.payments_count} გადახდა)`).join('\n');

        const summaryText = `
📉 **ხარჯების ანალიზი — ${res.period_label}**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💸 **სულ ხარჯები:** ${res.total_expenses} ${res.currency}
  • 🚚 მომწოდებლებზე გადახდილი: ${res.breakdown.supplier_payments} ${res.currency}
  • 💵 სალაროდან გაცემა (Cash Out): ${res.breakdown.cash_out_payouts} ${res.currency}
  • 📦 ჩამოწერები (Write-offs): ${res.breakdown.write_offs} ${res.currency}

🔝 **მთავარი მომწოდებლები:**
${supText || '  • ჩანაწერები არ მოიძებნა'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        return {
          content: [{ type: 'text', text: summaryText.trim() + '\n\n' + JSON.stringify(res, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `შეცდომა ხარჯების ანალიზისას: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // 5. Tool: get_top_selling_items
  server.tool(
    'get_top_selling_items',
    'ტოპ გაყიდვადი კერძები და სასმელები (თანხით ან რაოდენობით), სამზარეულოს და ბარის შეფარდება (Top selling menu items by revenue or volume, bar vs kitchen ratio)',
    {
      tenant: z.string().optional().describe('Tenant ID ან Slug'),
      period: z.enum(['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'custom']).default('today'),
      limit: z.number().default(15).describe('პოზიციების რაოდენობა (Number of items to return)'),
      sortBy: z.enum(['revenue', 'quantity']).default('revenue').describe('დალაგება თანხით (revenue) ან რაოდენობით (quantity)')
    },
    async ({ tenant, period, limit, sortBy }) => {
      try {
        const res = await getTopSellingItems(tenant, period, limit, sortBy);
        const itemsText = res.items.map((it, idx) => {
          const typeIcon = it.type === 'bar' ? '🍸 ბარი' : it.type === 'hookah' ? '💨 ჰუკა' : it.type === 'other' ? '📦 სხვა' : '🍳 სამზარეულო';
          return `  ${idx + 1}. ${it.item_name} (${typeIcon}) — ${it.quantity_sold} ცალი | ${it.total_revenue} GEL`;
        }).join('\n');

        const cb = res.category_breakdown;
        const summaryText = `
🏆 **ტოპ გაყიდვადი კერძები და სასმელები — ${res.period_label}**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🍽️ სულ გაყიდული პოზიციები: ${res.total_items_sold} ცალი (${res.total_sales_amount} GEL)
🍳 სამზარეულო: ${cb.kitchen.revenue} GEL (${cb.kitchen.count} ცალი)
🍸 ბარი: ${cb.bar.revenue} GEL (${cb.bar.count} ცალი)
💨 ჰუკა: ${cb.hookah.revenue} GEL (${cb.hookah.count} ცალი)
${cb.other.revenue > 0 ? `📦 სხვა/უფასო: ${cb.other.revenue} GEL (${cb.other.count} ცალი)\n` : ''}
📋 **რეიტინგი (დალაგებული ${sortBy === 'quantity' ? 'რაოდენობით' : 'თანხით'}):**
${itemsText || '  • გაყიდვები არ ფიქსირდება'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        return {
          content: [{ type: 'text', text: summaryText.trim() + '\n\n' + JSON.stringify(res, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `შეცდომა ტოპ გაყიდვების მიღებისას: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // 6. Tool: get_shift_report
  server.tool(
    'get_shift_report',
    'სალაროს ცვლის სრული ანგარიში (X/Z Report): გახსნის/დახურვის დრო, მოლარე, ნაღდი, უნაღდო, სალაროს სალდო (Cash shift report: cashier, open/close, card/cash, discrepancy)',
    {
      tenant: z.string().optional().describe('Tenant ID ან Slug'),
      shiftId: z.number().optional().describe('კონკრეტული ცვლის ID (Optional shift ID, defaults to last/active shift)')
    },
    async ({ tenant, shiftId }) => {
      try {
        const res = await getShiftAnalytics(tenant, shiftId);
        const f = res.financials;

        const summaryText = `
💼 **სალაროს ცვლის ანგარიში #${res.shift_number} (${res.tenant_name})**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 სტატუსი: ${res.status === 'open' ? '🟢 ღიაა' : '🔴 დახურულია'}
👤 მოლარე: ${res.opened_by_name} ${res.closed_by_name ? `(დახურა: ${res.closed_by_name})` : ''}
⏰ გახსნა: ${new Date(res.opened_at).toLocaleString('ka-GE')} ${res.closed_at ? `| დახურვა: ${new Date(res.closed_at).toLocaleString('ka-GE')}` : ''}

💰 **გაყიდვები (Sales Breakdown):**
  • სულ გაყიდვა: ${f.total_sales} GEL (${res.orders_count} ჩეკი)
  • 💵 ნაღდი: ${f.cash_sales} GEL
  • 💳 ბარათი / ტერმინალი: ${f.card_sales} GEL
  • 🏦 გადარიცხვა: ${f.transfer_sales} GEL
  • 🎁 ფასდაკლებები: ${f.discounts} GEL

💵 **ნაღდი სალაროს მოძრაობა (Physical Cash Drawer):**
  • საწყისი ნაღდი: ${res.initial_cash} GEL
  • ნაღდის შემოსვლა (Cash In): ${f.cash_drawer_in} GEL
  • სალაროდან გაცემა (Cash Out): ${f.cash_drawer_out} GEL
  • მოსალოდნელი ნაღდი სალაროში: ${f.expected_cash_drawer} GEL
  ${f.actual_cash_drawer !== undefined ? `• ფაქტიური ნაღდი დახურვისას: ${f.actual_cash_drawer} GEL` : ''}
  ${f.discrepancy !== undefined ? `• სხვაობა / გადახრა: ${f.discrepancy} GEL` : ''}

🍽️ **ღია შეკვეთები და დეპოზიტი:**
  • ღია შეკვეთების თანხა: ${f.open_orders_sum} GEL (${f.open_orders_count} შეკვეთა)
  • დეპოზიტი / ავანსი: ${f.deposit_sum} GEL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        return {
          content: [{ type: 'text', text: summaryText.trim() + '\n\n' + JSON.stringify(res, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `შეცდომა ცვლის ანგარიშისას: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // 7. Tool: get_inventory_alerts
  server.tool(
    'get_inventory_alerts',
    'მარაგების კონტროლი: კრიტიკული ნაშთები და დეფიციტში მყოფი პროდუქტები/ინგრედიენტები (Inventory alerts: zero stock and low stock ingredients)',
    {
      tenant: z.string().optional().describe('Tenant ID ან Slug')
    },
    async ({ tenant }) => {
      try {
        const res = await getInventoryAlerts(tenant);
        const alertsText = res.alerts.slice(0, 15).map(a => 
          `  • ${a.status === 'CRITICAL_ZERO' ? '🚨 [ამოიწურა]' : '⚠️ [მცირე ნაშთი]'} ${a.name} — ნაშთი: ${a.current_stock} (მინიმუმი: ${a.minimum_required}, დეფიციტი: ${a.deficit})`
        ).join('\n');

        const summaryText = `
📦 **მარაგების კონტროლი — ${res.tenant_name}**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ სულ გაფრთხილება: ${res.total_alerts}
🚨 ნულოვანი ნაშთი: ${res.critical_zero_stock_count}
⚠️ მინიმუმზე ნაკლები: ${res.low_stock_count}

📋 **დეფიციტური ინგრედიენტები:**
${alertsText || '  • ყველა პროდუქტის მარაგი ნორმაშია ✅'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        return {
          content: [{ type: 'text', text: summaryText.trim() + '\n\n' + JSON.stringify(res, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `შეცდომა მარაგების შემოწმებისას: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // 8. Tool: get_active_orders
  server.tool(
    'get_active_orders',
    'მიმდინარე ღია შეკვეთები და დაკავებული მაგიდები რეალურ დროში (Real-time active open orders and occupied tables)',
    {
      tenant: z.string().optional().describe('Tenant ID ან Slug')
    },
    async ({ tenant }) => {
      try {
        const res = await getActiveOrders(tenant);
        const ordersText = res.orders.map(o => 
          `  • მაგიდა #${o.table_number} (${o.room_name}) — ${o.total_amount} GEL | ${o.guests_count} სტუმარი | მიმტანი: ${o.waiter_name} | გაღებულია: ${o.duration_minutes} წუთის წინ (${o.items_count} პოზიცია)`
        ).join('\n');

        const summaryText = `
🍽️ **მიმდინარე ღია შეკვეთები — ${res.tenant_name}**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🟢 აქტიური მაგიდები (Live Tables): ${res.active_tables_count}
💰 ღია შეკვეთების თანხა ჯამში: ${res.total_open_amount} GEL
👥 სტუმრების რაოდენობა: ${res.total_guests}
${res.stale_unclosed_orders_count > 0 ? `⚠️ ძველი დაუხურავი შეკვეთები (>24 სთ): ${res.stale_unclosed_orders_count}\n` : ''}
📋 **მაგიდების სია:**
${ordersText || '  • ამ მომენტში ყველა მაგიდა თავისუფალია'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        return {
          content: [{ type: 'text', text: summaryText.trim() + '\n\n' + JSON.stringify(res, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `შეცდომა ღია შეკვეთების მიღებისას: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // 9. Tool: get_staff_performance
  server.tool(
    'get_staff_performance',
    'პერსონალის შედეგები და რეიტინგი: ოფიციანტების გაყიდვები, ჩეკების რაოდენობა და საშუალო ჩეკი (Staff performance: sales ranking, order counts, average check per waiter)',
    {
      tenant: z.string().optional().describe('Tenant ID ან Slug'),
      period: z.enum(['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'custom']).default('today'),
      startDate: z.string().optional().describe('YYYY-MM-DD'),
      endDate: z.string().optional().describe('YYYY-MM-DD')
    },
    async ({ tenant, period, startDate, endDate }) => {
      try {
        const res = await getStaffPerformance(tenant, period, startDate, endDate);
        const rankText = res.ranking.map((s, idx) => 
          `  ${idx + 1}. ${s.name} (${s.role}) — ${s.total_revenue} GEL (${s.orders_count} ჩეკი, საშუალო: ${s.average_check} GEL)`
        ).join('\n');

        const summaryText = `
👥 **პერსონალის შედეგები — ${res.period_label}**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 **რეიტინგი გაყიდვების მიხედვით:**
${rankText || '  • ჩანაწერები არ მოიძებნა'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        return {
          content: [{ type: 'text', text: summaryText.trim() + '\n\n' + JSON.stringify(res, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `შეცდომა პერსონალის ანალიზისას: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // 10. Tool: search_orders
  server.tool(
    'search_orders',
    'შეკვეთების ძებნა და ფილტრაცია: ნომრით, მაგიდით, მიტანის ტიპით (Glovo/Bolt/Wolt/Taxi), მიმტანით ან სტატუსით (Search and filter orders by ID, table, delivery service, waiter, status, date)',
    {
      tenant: z.string().optional().describe('Tenant ID ან Slug'),
      query: z.string().optional().describe('საძიებო სიტყვა (ID, მაგიდის ნომერი, კერძის სახელი, მიმტანი)'),
      deliveryType: z.enum(['all', 'glovo', 'bolt', 'wolt', 'taxi', 'delivery', 'dine_in']).default('all').describe('მიტანის ტიპი (Glovo, Bolt, Wolt, Taxi, ადგილზე)'),
      status: z.enum(['all', 'open', 'closed', 'completed', 'canceled']).default('all').describe('შეკვეთის სტატუსი'),
      period: z.enum(['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'custom']).optional(),
      startDate: z.string().optional().describe('YYYY-MM-DD'),
      endDate: z.string().optional().describe('YYYY-MM-DD'),
      orderId: z.number().optional().describe('კონკრეტული შეკვეთის ID'),
      limit: z.number().default(20).describe('მაქსიმალური რაოდენობა')
    },
    async ({ tenant, query, deliveryType, status, period, startDate, endDate, orderId, limit }) => {
      try {
        const { searchOrders } = await import('./analytics/orderSearch.js');
        const res = await searchOrders(tenant, {
          query,
          deliveryType,
          status,
          period,
          startDate,
          endDate,
          orderId,
          limit
        });

        const listText = res.orders.map(o => 
          `• [ID: #${o.order_id}] ${o.delivery_type ? `🛵 [${o.delivery_type.toUpperCase()}]` : `🍽️ მაგიდა #${o.table_number}`} | ${o.total_price} GEL | სტატუსი: ${o.status} | თარიღი: ${new Date(o.date).toLocaleString('ka-GE')} | მიმტანი: ${o.waiter_name}\n  კერძები: ${o.items_summary || '—'}`
        ).join('\n\n');

        const summaryText = `
🔍 **შეკვეთების ძებნის შედეგები — ${res.tenant_name}**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
სულ მოიძებნა: ${res.total_found} შეკვეთა

${listText || 'შეკვეთები მოცემული პარამეტრებით ვერ მოიძებნა.'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        return {
          content: [{ type: 'text', text: summaryText.trim() + '\n\n' + JSON.stringify(res, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `შეცდომა შეკვეთების ძებნისას: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // 11. Tool: get_order_details
  server.tool(
    'get_order_details',
    'კონკრეტული ჩეკის/შეკვეთის სრული დეტალები: კერძების სია, რაოდენობები, ფასები, ფასდაკლებები, გადახდის ჩანაწერები (Detailed receipt/order breakdown: dishes, prices, quantities, payments, comments)',
    {
      orderId: z.number().describe('შეკვეთის ID (Order ID)'),
      tenant: z.string().optional().describe('Tenant ID ან Slug')
    },
    async ({ orderId, tenant }) => {
      try {
        const { getOrderDetails } = await import('./analytics/orderSearch.js');
        const res = await getOrderDetails(orderId, tenant);

        const itemsText = res.items.map((it: any, idx: number) => 
          `  ${idx + 1}. ${it.name} — ${it.count} x ${it.unit_price} GEL = ${it.total_price} GEL ${it.comment ? `(${it.comment})` : ''}`
        ).join('\n');

        const paymentsText = res.payments.map((p: any) => 
          `  • ${p.payment_method.toUpperCase()}: ${p.amount} GEL (ხურდა: ${p.change_back} GEL)`
        ).join('\n');

        const summaryText = `
🧾 **ჩეკის დეტალები: შეკვეთა #${res.order_id} (${res.tenant_name})**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 სტატუსი: ${res.status} | თარიღი: ${new Date(res.date).toLocaleString('ka-GE')}
📍 მაგიდა: #${res.table_number} (${res.room_name})
👤 მიმტანი: ${res.waiter_name}
${res.delivery_type ? `🛵 მიტანის ტიპი: ${res.delivery_type}` : ''}

🍽️ **შეკვეთილი პოზიციები:**
${itemsText || '  • პოზიციები არ არის'}

💰 **ჯამი:**
  • სულ თანხა: ${res.total_price} GEL
  • მომსახურება: ${res.service_fee} GEL
  • ფასდაკლება: ${res.discount_amount} GEL
  • ავანსი / დეპოზიტი: ${res.prepayment} GEL

💳 **გადახდები:**
${paymentsText || '  • გადახდა ჯერ არ დაფიქსირებულა'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        return {
          content: [{ type: 'text', text: summaryText.trim() + '\n\n' + JSON.stringify(res, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `შეცდომა ჩეკის დეტალების მიღებისას: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // 12. Tool: get_delivery_orders
  server.tool(
    'get_delivery_orders',
    'მიტანისა და ონლაინ შეკვეთების სია (Glovo, Bolt Food, Wolt, Taxi, Web Orders) ტელეფონით, მისამართით და სტატუსით (Delivery and online orders registry with phone, address, platform, and items)',
    {
      tenant: z.string().optional().describe('Tenant ID ან Slug'),
      platform: z.enum(['all', 'glovo', 'bolt', 'wolt', 'taxi', 'web']).default('all').describe('პლატფორმა (Glovo, Bolt, Wolt, Taxi, Web)'),
      limit: z.number().default(20).describe('რაოდენობა')
    },
    async ({ tenant, platform, limit }) => {
      try {
        const { getDeliveryOrders } = await import('./analytics/orderSearch.js');
        const res = await getDeliveryOrders(tenant, { platform, limit });

        const webText = res.web_orders.map((w: any) => 
          `• [Web #${w.id}] ${w.price} GEL | ${w.phone} | მისამართი: ${w.address} | სტატუსი: ${w.status} (${new Date(w.date).toLocaleString('ka-GE')})`
        ).join('\n');

        const posText = res.pos_delivery_orders.map((p: any) => 
          `• [POS #${p.order_id}] ${p.delivery_type ? `[${p.delivery_type.toUpperCase()}]` : '[DELIVERY]'} ${p.total_price} GEL | მაგიდა: ${p.table_number} | სტატუსი: ${p.status} (${new Date(p.date).toLocaleString('ka-GE')})\n  კერძები: ${p.items_summary || '—'}`
        ).join('\n');

        const summaryText = `
🛵 **მიტანის და ონლაინ შეკვეთები — ${res.tenant_name}**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 ვებ-შეკვეთები (Web Orders): ${res.web_orders_count}
🛵 POS მიტანის შეკვეთები: ${res.pos_delivery_orders_count}

🌐 **ვებ შეკვეთები:**
${webText || '  • ვებ შეკვეთები არ არის'}

🏪 **POS მიტანის შეკვეთები:**
${posText || '  • POS მიტანის შეკვეთები არ არის'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        return {
          content: [{ type: 'text', text: summaryText.trim() + '\n\n' + JSON.stringify(res, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `შეცდომა მიტანის შეკვეთების მიღებისას: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // ============================================================
  // PURCHASES (შესყიდვები / Закупки)
  // ============================================================

  // 13. Tool: get_purchases_analytics
  server.tool(
    'get_purchases_analytics',
    'შესყიდვებისა და მიღებების სრული ანალიტიკა: ჯამური შესყიდვები, მომწოდებლები, საწყობები და ტოპ შესყიდული პროდუქტები (Purchases and procurement analytics by period, suppliers, warehouses, top products)',
    {
      tenant: z.string().optional().describe('Tenant ID ან Slug'),
      period: z.enum(['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'custom']).default('this_month').describe('საანგარიშო პერიოდი'),
      startDate: z.string().optional().describe('საწყისი თარიღი YYYY-MM-DD (თუ period=custom)'),
      endDate: z.string().optional().describe('საბოლოო თარიღი YYYY-MM-DD (თუ period=custom)'),
      supplierId: z.union([z.string(), z.number()]).optional().describe('ფილტრი კონკრეტულ მომწოდებელზე'),
      warehouse: z.string().optional().describe('საწყობი (bar, kitchen, main, ALL)')
    },
    async ({ tenant, period, startDate, endDate, supplierId, warehouse }) => {
      try {
        const res = await getPurchasesAnalytics(tenant, period, startDate, endDate, supplierId, warehouse);
        const cur = res.tenant.currency;

        const supText = res.suppliers_summary.slice(0, 8).map((s, idx) => 
          `  ${idx + 1}. ${s.supplier_name} — ${s.total_amount} ${cur} (${s.invoices_count} ზედნადები, ${s.items_count} პოზიცია)`
        ).join('\n');

        const whText = res.warehouse_breakdown.map(w => 
          `  • ${w.warehouse_name}: ${w.total_amount} ${cur} (${w.items_count} პოზიცია)`
        ).join('\n');

        const topProdsText = res.top_purchased_products.slice(0, 10).map((p, idx) => 
          `  ${idx + 1}. ${p.product_name} — ${p.total_amount} ${cur} (${p.total_quantity} ${p.unit_name}, საშ. ფასი: ${p.average_unit_price} ${cur})`
        ).join('\n');

        const summaryText = `
🚚 **შესყიდვების ანალიტიკა — ${res.tenant.name} (${res.period_label})**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 **ჯამური შესყიდვები:** ${res.summary.total_purchase_amount} ${cur}
📑 **ზედნადებების რაოდენობა:** ${res.summary.total_invoices_count} (საშუალო ზედნადები: ${res.summary.average_invoice_amount} ${cur})
📦 **შესყიდული პოზიციები:** ${res.summary.total_items_count} ჩანაწერი

🏛️ **განაწილება საწყობების მიხედვით:**
${whText || '  • მონაცემები არ არის'}

🚚 **ტოპ მომწოდებლები:**
${supText || '  • მომწოდებლები არ ფიქსირდება'}

🔝 **ტოპ შესყიდული პროდუქტები:**
${topProdsText || '  • პროდუქტები არ ფიქსირდება'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        return {
          content: [{ type: 'text', text: summaryText.trim() + '\n\n' + JSON.stringify(res, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `შეცდომა შესყიდვების ანალიზისას: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // 14. Tool: search_purchases
  server.tool(
    'search_purchases',
    'შესყიდვების/ზედნადებების ძებნა და ფილტრაცია: ზედნადების ნომრით, პროდუქტის სახელით ან მომწოდებლით (Search purchases and invoices by waybill code, product name, supplier)',
    {
      tenant: z.string().optional().describe('Tenant ID ან Slug'),
      query: z.string().optional().describe('საძიებო ტექსტი (ზედნადების ნომერი ან პროდუქტის სახელი)'),
      supplierId: z.union([z.string(), z.number()]).optional().describe('მომწოდებლის ID'),
      warehouse: z.string().optional().describe('საწყობი (bar, kitchen, main, ALL)'),
      period: z.enum(['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'custom']).optional(),
      startDate: z.string().optional().describe('YYYY-MM-DD'),
      endDate: z.string().optional().describe('YYYY-MM-DD'),
      limit: z.number().default(25).describe('მაქსიმალური რაოდენობა')
    },
    async ({ tenant, query, supplierId, warehouse, period, startDate, endDate, limit }) => {
      try {
        const res = await searchPurchases(tenant, {
          query,
          supplierId,
          warehouse,
          period,
          startDate,
          endDate,
          limit
        });

        const listText = res.items.map(it => 
          `• [ზედნადები: ${it.invoice_code}] ${it.product_name} — ${it.quantity} ${it.unit_name} x ${it.unit_price} GEL = ${it.total_price} GEL | მომწოდებელი: ${it.supplier_name} | თარიღი: ${new Date(it.date).toLocaleDateString('ka-GE')}`
        ).join('\n');

        const summaryText = `
🔍 **შესყიდვების ძებნის შედეგები — ${res.tenant_name}**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
სულ მოიძებნა: ${res.total_found} ჩანაწერი

${listText || 'ჩანაწერები მოცემული პარამეტრებით ვერ მოიძებნა.'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        return {
          content: [{ type: 'text', text: summaryText.trim() + '\n\n' + JSON.stringify(res, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `შეცდომა შესყიდვების ძებნისას: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // 15. Tool: get_purchase_details
  server.tool(
    'get_purchase_details',
    'კონკრეტული ზედნადების/შესყიდვის სრული შემადგენლობა: პროდუქტები, რაოდენობები, შესასყიდი ფასები და მომწოდებელი (Detailed invoice line items breakdown, quantities, purchase prices, supplier info)',
    {
      invoiceCode: z.union([z.string(), z.number()]).describe('ზედნადების ნომერი (Code) ან შესყიდვის ID'),
      tenant: z.string().optional().describe('Tenant ID ან Slug')
    },
    async ({ invoiceCode, tenant }) => {
      try {
        const res = await getPurchaseDetails(invoiceCode, tenant);

        const itemsText = res.items.map((it, idx) => 
          `  ${idx + 1}. ${it.product_name} — ${it.quantity} ${it.unit_name} x ${it.unit_price} GEL = ${it.total_price} GEL`
        ).join('\n');

        const summaryText = `
📑 **ზედნადების დეტალები: #${res.invoice_code} (${res.tenant_name})**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 თარიღი: ${new Date(res.date).toLocaleString('ka-GE')}
🏢 საწყობი: ${res.warehouse_type}
🚚 მომწოდებელი: ${res.supplier.name} ${res.supplier.code ? `(ს/კ: ${res.supplier.code})` : ''} ${res.supplier.contact ? `| ტელ: ${res.supplier.contact}` : ''}

📦 **პოზიციების სია (${res.total_items_count}):**
${itemsText || '  • პოზიციები არ არის'}

💰 **სულ ზედნადების ჯამი:** ${res.grand_total} ${res.currency}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        return {
          content: [{ type: 'text', text: summaryText.trim() + '\n\n' + JSON.stringify(res, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `შეცდომა ზედნადების დეტალების მიღებისას: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // ============================================================
  // INVENTORIES (ინვენტარიზაციები / Инвентаризации)
  // ============================================================

  // 16. Tool: get_inventory_acts
  server.tool(
    'get_inventory_acts',
    'ინვენტარიზაციის აქტების სია, დანაკლისები და ზედმეტობები (Inventory audit acts history: shortages, surpluses, net balance, date, warehouse)',
    {
      tenant: z.string().optional().describe('Tenant ID ან Slug'),
      period: z.enum(['all', 'today', 'yesterday', 'this_week', 'this_month', 'last_month', 'custom']).default('all').describe('პერიოდი'),
      startDate: z.string().optional().describe('YYYY-MM-DD'),
      endDate: z.string().optional().describe('YYYY-MM-DD'),
      warehouse: z.string().optional().describe('საწყობი (bar, kitchen, restourant, storage, ყველა)'),
      status: z.enum(['all', 'completed', 'draft']).default('all').describe('სტატუსი'),
      limit: z.number().default(25).describe('მაქსიმალური რაოდენობა')
    },
    async ({ tenant, period, startDate, endDate, warehouse, status, limit }) => {
      try {
        const res = await getInventoryActs(tenant, {
          period,
          startDate,
          endDate,
          warehouse,
          status,
          limit
        });
        const cur = res.tenant.currency;

        const actsText = res.acts.map(a => 
          `• [აქტი #${a.id}] ${new Date(a.date).toLocaleDateString('ka-GE')} | საწყობი: ${a.warehouse_type} | შემოწმდა: ${a.total_items} პროდუქტი\n  🔻 დანაკლისი: -${a.shortage_amount} ${cur} | 🔺 ზედმეტობა: +${a.surplus_amount} ${cur} | ⚖️ სალდო: ${a.net_amount} ${cur} ${a.comment ? `(${a.comment})` : ''}`
        ).join('\n\n');

        const summaryText = `
📋 **ინვენტარიზაციის აქტების რეესტრი — ${res.tenant.name} ${res.period_label ? `(${res.period_label})` : ''}**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 სულ ჩატარებული ინვენტარიზაცია: ${res.summary.total_acts_count}
📦 შემოწმებული პოზიციები ჯამში: ${res.summary.total_items_checked}
🔻 ჯამური დანაკლისი: -${res.summary.total_shortage_amount} ${cur}
🔺 ჯამური ზედმეტობა: +${res.summary.total_surplus_amount} ${cur}
⚖️ წმინდა ფინანსური სხვაობა: ${res.summary.total_net_discrepancy} ${cur}

📋 **აქტების სია:**
${actsText || 'ინვენტარიზაციის აქტები არ მოიძებნა.'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        return {
          content: [{ type: 'text', text: summaryText.trim() + '\n\n' + JSON.stringify(res, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `შეცდომა ინვენტარიზაციების მიღებისას: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // 17. Tool: get_inventory_act_details
  server.tool(
    'get_inventory_act_details',
    'კონკრეტული ინვენტარიზაციის აქტის სრული დეტალები: აღრიცხული vs ფაქტიური ნაშთები, სხვაობები და დანაკლისები/ზედმეტობები (Detailed inventory audit breakdown: expected vs actual stock, discrepancies, top shortages and surpluses)',
    {
      actId: z.number().describe('ინვენტარიზაციის აქტის ID'),
      tenant: z.string().optional().describe('Tenant ID ან Slug')
    },
    async ({ actId, tenant }) => {
      try {
        const res = await getInventoryActDetails(actId, tenant);
        const a = res.act;
        const cur = a.currency;

        const shortagesText = res.top_shortages.map((s, idx) => 
          `  ${idx + 1}. 🔻 ${s.product_name} — სხვაობა: ${s.difference} ${s.unit_name} (აღრიცხული: ${s.expected_stock}, ფაქტიური: ${s.actual_stock}) = ${s.diff_amount} ${cur}`
        ).join('\n');

        const surplusesText = res.top_surpluses.map((s, idx) => 
          `  ${idx + 1}. 🔺 ${s.product_name} — სხვაობა: +${s.difference} ${s.unit_name} (აღრიცხული: ${s.expected_stock}, ფაქტიური: ${s.actual_stock}) = +${s.diff_amount} ${cur}`
        ).join('\n');

        const summaryText = `
📑 **ინვენტარიზაციის აქტი #${a.id} — ${res.tenant_name}**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 თარიღი: ${new Date(a.created_at).toLocaleString('ka-GE')}
🏛️ საწყობი: ${a.warehouse_type} | სტატუსი: ${a.status} ${a.comment ? `| კომენტარი: ${a.comment}` : ''}
👤 შემსრულებელი: ${a.created_by_name}

📊 **ფინანსური შედეგი:**
  • შემოწმებული პოზიციები: ${res.statistics.total_items_count} (ზუსტი: ${res.statistics.exact_count}, დანაკლისი: ${res.statistics.shortages_count}, ზედმეტობა: ${res.statistics.surpluses_count})
  • 🔻 დანაკლისი ჯამში: -${a.shortage_amount} ${cur}
  • 🔺 ზედმეტობა ჯამში: +${a.surplus_amount} ${cur}
  • ⚖️ **წმინდა სალდო:** ${a.net_amount} ${cur}

🔻 **უდიდესი დანაკლისები (Top Shortages):**
${shortagesText || '  • დანაკლისი არ არის ✅'}

🔺 **უდიდესი ზედმეტობები (Top Surpluses):**
${surplusesText || '  • ზედმეტობა არ არის'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        return {
          content: [{ type: 'text', text: summaryText.trim() + '\n\n' + JSON.stringify(res, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `შეცდომა აქტის დეტალების მიღებისას: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // 18. Tool: get_inventory_discrepancy_summary
  server.tool(
    'get_inventory_discrepancy_summary',
    'ინვენტარიზაციების ჯამური ანალიტიკა: ყველაზე პრობლემური პროდუქტები ხშირი დანაკლისებითა და ზედმეტობებით (Discrepancy summary across audits: most problematic products by shortage amounts)',
    {
      tenant: z.string().optional().describe('Tenant ID ან Slug'),
      period: z.enum(['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'custom']).default('this_month').describe('პერიოდი'),
      startDate: z.string().optional().describe('YYYY-MM-DD'),
      endDate: z.string().optional().describe('YYYY-MM-DD')
    },
    async ({ tenant, period, startDate, endDate }) => {
      try {
        const res = await getInventoryDiscrepancySummary(tenant, period, startDate, endDate);
        const cur = res.currency;

        const probText = res.problematic_products.slice(0, 15).map((p, idx) => 
          `  ${idx + 1}. ⚠️ ${p.product_name} — დანაკლისი: -${p.total_shortage_amount} ${cur} (${p.total_shortage_qty} ${p.unit_name}) | ზედმეტობა: +${p.total_surplus_amount} ${cur} | წმინდა: ${p.net_diff_amount} ${cur} (${p.discrepancy_occurrences} აქტში)`
        ).join('\n');

        const summaryText = `
⚠️ **ინვენტარიზაციის გადახრების ანალიზი — ${res.tenant_name} (${res.period_label})**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 გაანალიზებული აქტები: ${res.total_audits_count}
🔻 სულ დანაკლისი: -${res.total_shortages_sum} ${cur}
🔺 სულ ზედმეტობა: +${res.total_surpluses_sum} ${cur}
⚖️ წმინდა ბალანსი: ${res.net_balance} ${cur}

🚨 **ყველაზე პრობლემური პროდუქტები (დანაკლისის მიხედვით):**
${probText || '  • პრობლემური გადახრები არ დაფიქსირებულა ✅'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        return {
          content: [{ type: 'text', text: summaryText.trim() + '\n\n' + JSON.stringify(res, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `შეცდომა ინვენტარიზაციის ანალიზისას: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // ============================================================
  // CALCULATIONS & RECIPES (კალკულაციები / Калькуляции и техкарты)
  // ============================================================

  // 19. Tool: get_recipe_calculations
  server.tool(
    'get_recipe_calculations',
    'მენიუს კალკულაციები, თვითღირებულება (Food Cost) და მარჟა (Menu dish cost calculations, prime cost, gross profit margin, Food Cost %, markup %)',
    {
      tenant: z.string().optional().describe('Tenant ID ან Slug'),
      category: z.string().optional().describe('კატეგორიის სახელი ან ID ფილტრაციისთვის'),
      type: z.enum(['all', 'kitchen', 'bar', 'restourant', 'hookah']).default('all').describe('ტიპი (სამზარეულო, ბარი, ჰუკა)'),
      search: z.string().optional().describe('კერძის საძიებო სიტყვა'),
      minFoodCost: z.number().optional().describe('მინიმალური Food Cost % (მაგ. 35-ზე მაღალი Food Cost-ის საპოვნელად)'),
      maxFoodCost: z.number().optional().describe('მაქსიმალური Food Cost %'),
      missingRecipesOnly: z.boolean().optional().describe('მხოლოდ ის კერძები, რომლებსაც არ აქვთ კალკულაცია/რეცეპტი'),
      includeDisabled: z.boolean().default(false).describe('გათიშული კერძების ჩვენება'),
      sortBy: z.enum(['food_cost_pct', 'cost_price', 'margin', 'selling_price', 'name']).default('food_cost_pct').describe('დალაგების ველი'),
      sortDirection: z.enum(['asc', 'desc']).default('desc').describe('ზრდადობით ან კლებადობით'),
      limit: z.number().default(50).describe('მაქსიმალური რაოდენობა')
    },
    async ({ tenant, category, type, search, minFoodCost, maxFoodCost, missingRecipesOnly, includeDisabled, sortBy, sortDirection, limit }) => {
      try {
        const res = await getRecipeCalculations(tenant, {
          category,
          type,
          search,
          minFoodCost,
          maxFoodCost,
          missingRecipesOnly,
          includeDisabled,
          sortBy,
          sortDirection,
          limit
        });
        const cur = res.tenant.currency;

        const dishesText = res.dishes.slice(0, 30).map((d, idx) => {
          const fcBadge = !d.has_recipe ? '⚠️ [რეცეპტის გარეშე]' : d.food_cost_pct > 35 ? `🚨 [FC: ${d.food_cost_pct}%]` : `✅ [FC: ${d.food_cost_pct}%]`;
          return `  ${idx + 1}. ${d.name} (${d.category_name}) — გასაყიდი: ${d.selling_price} ${cur} | თვითღირებულება: ${d.cost_price} ${cur} | მარჟა: ${d.gross_margin} ${cur} ${fcBadge} (${d.ingredients_count} ინგრედიენტი)`;
        }).join('\n');

        const summaryText = `
🍽️ **მენიუს კალკულაციები და თვითღირებულება — ${res.tenant.name}**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 სულ კერძები: ${res.summary.total_dishes_count} (რეცეპტით: ${res.summary.dishes_with_recipe}, რეცეპტის გარეშე: ${res.summary.dishes_without_recipe})
🎯 **საშუალო Food Cost:** ${res.summary.average_food_cost_pct}%
💰 **საშუალო გასაყიდი ფასი:** ${res.summary.average_selling_price} ${cur}
📉 **საშუალო თვითღირებულება:** ${res.summary.average_cost_price} ${cur}
⚖️ **საშუალო მარჟა/მოგება:** ${res.summary.average_margin} ${cur}
🚨 მაღალი Food Cost (>35%): ${res.summary.high_food_cost_count} კერძი

📋 **კერძების რეესტრი (დალაგებული ${sortBy}-ით):**
${dishesText || 'კერძები მოცემული ფილტრებით არ მოიძებნა.'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        return {
          content: [{ type: 'text', text: summaryText.trim() + '\n\n' + JSON.stringify(res, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `შეცდომა კალკულაციების მიღებისას: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // 20. Tool: get_dish_recipe_details
  server.tool(
    'get_dish_recipe_details',
    'კონკრეტული კერძის ტექნოლოგიური ბარათი / კალკულაციის დეტალები: ინგრედიენტების სია, წონები/რაოდენობები, ფასები და თვითღირებულებაში წილი (Detailed dish recipe breakdown: ingredients, portions, unit costs, cost share %)',
    {
      dish: z.union([z.string(), z.number()]).describe('კერძის სახელი, ID ან Hash კოდი'),
      tenant: z.string().optional().describe('Tenant ID ან Slug')
    },
    async ({ dish, tenant }) => {
      try {
        const res = await getDishRecipeDetails(dish, tenant);
        const it = res.item;
        const cur = it.currency;

        const ingText = res.ingredients.map((ing, idx) => 
          `  ${idx + 1}. ${ing.is_semi_finished ? '🥣 [ნ/ფ] ' : '🌿 '}${ing.product_name} — ${ing.quantity} ${ing.unit_name} x ${ing.unit_cost_price} GEL = ${ing.line_total_cost} ${cur} (წილი: ${ing.cost_share_pct}%)`
        ).join('\n');

        const summaryText = `
🍲 **ტექნოლოგიური ბარათი: ${it.name} (${res.tenant_name})**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏛️ კატეგორია: ${it.category_name} | ტიპი: ${it.type}
💰 **გასაყიდი ფასი:** ${it.selling_price} ${cur}
📉 **თვითღირებულება (Prime Cost):** ${it.prime_cost} ${cur}
⚖️ **მარჟა / მოგება პორციაზე:** ${it.gross_margin} ${cur}
🎯 **Food Cost:** ${it.food_cost_pct}% | **ფასნამატი:** ${it.markup_pct}%

🌿 **კალკულაციის ინგრედიენტები (${it.ingredients_count}):**
${ingText || '  • ინგრედიენტები არ არის მითითებული (რეცეპტი ცარიელია)'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        return {
          content: [{ type: 'text', text: summaryText.trim() + '\n\n' + JSON.stringify(res, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `შეცდომა რეცეპტის დეტალების მიღებისას: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // 21. Tool: get_semi_finished_products
  server.tool(
    'get_semi_finished_products',
    'ნახევარფაბრიკატების სია, გამოსავალი წონა და თვითღირებულების კალკულაცია (Semi-finished products registry: yield weight, batch cost, unit cost per kg/l, nested ingredients)',
    {
      tenant: z.string().optional().describe('Tenant ID ან Slug'),
      search: z.string().optional().describe('საძიებო ტექსტი')
    },
    async ({ tenant, search }) => {
      try {
        const res = await getSemiFinishedAnalytics(tenant, search);

        const listText = res.items.map(s => {
          const ingList = s.ingredients.map(i => `    - ${i.product_name}: ${i.quantity} ${i.unit_name} (${i.total_cost} GEL)`).join('\n');
          return `🥣 **${s.name}**\n  • გამოსავალი: ${s.yield_target_weight} ${s.unit_name} | პარტიის თვითღირებულება: ${s.batch_total_cost} GEL | 1 ${s.unit_name}-ის ფასი: ${s.calculated_cost_per_unit} GEL\n  • ინგრედიენტები (${s.ingredients_count}):\n${ingList || '    - ინგრედიენტები არ არის'}`;
        }).join('\n\n');

        const summaryText = `
🥣 **ნახევარფაბრიკატების რეესტრი — ${res.tenant_name}**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
სულ ნახევარფაბრიკატი: ${res.total_semi_finished_count}

${listText || 'ნახევარფაბრიკატები არ მოიძებნა.'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        return {
          content: [{ type: 'text', text: summaryText.trim() + '\n\n' + JSON.stringify(res, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `შეცდომა ნახევარფაბრიკატების მიღებისას: ${err.message}` }],
          isError: true
        };
      }
    }
  );
}
