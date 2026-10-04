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
}

