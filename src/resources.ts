import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTodaySummary } from './analytics/todaySummary.js';
import { getShiftAnalytics } from './analytics/shiftAnalytics.js';
import { getInventoryAlerts } from './analytics/inventoryAlerts.js';
import { getPurchasesAnalytics } from './analytics/purchasesAnalytics.js';
import { getInventoryActs } from './analytics/inventoriesAnalytics.js';
import { getRecipeCalculations } from './analytics/calculationsAnalytics.js';

export function registerResources(server: McpServer) {
  // 1. Dynamic Resource: Today summary
  server.resource(
    'today-summary',
    new ResourceTemplate('pos://summary/today{?tenant}', { list: undefined }),
    async (uri, { tenant }) => {
      const tenantStr = typeof tenant === 'string' ? tenant : undefined;
      const data = await getTodaySummary(tenantStr);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    }
  );

  // 2. Dynamic Resource: Active shift
  server.resource(
    'active-shift',
    new ResourceTemplate('pos://shifts/active{?tenant}', { list: undefined }),
    async (uri, { tenant }) => {
      const tenantStr = typeof tenant === 'string' ? tenant : undefined;
      const data = await getShiftAnalytics(tenantStr);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    }
  );

  // 3. Dynamic Resource: Inventory Alerts
  server.resource(
    'inventory-alerts',
    new ResourceTemplate('pos://inventory/alerts{?tenant}', { list: undefined }),
    async (uri, { tenant }) => {
      const tenantStr = typeof tenant === 'string' ? tenant : undefined;
      const data = await getInventoryAlerts(tenantStr);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    }
  );

  // 4. Dynamic Resource: Purchases Summary
  server.resource(
    'purchases-summary',
    new ResourceTemplate('pos://purchases/summary{?tenant,period}', { list: undefined }),
    async (uri, { tenant, period }) => {
      const tenantStr = typeof tenant === 'string' ? tenant : undefined;
      const periodStr = typeof period === 'string' ? period : 'this_month';
      const data = await getPurchasesAnalytics(tenantStr, periodStr);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    }
  );

  // 5. Dynamic Resource: Inventory Acts
  server.resource(
    'inventory-acts',
    new ResourceTemplate('pos://inventory/acts{?tenant}', { list: undefined }),
    async (uri, { tenant }) => {
      const tenantStr = typeof tenant === 'string' ? tenant : undefined;
      const data = await getInventoryActs(tenantStr);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    }
  );

  // 6. Dynamic Resource: Recipe Calculations
  server.resource(
    'recipes-calculations',
    new ResourceTemplate('pos://recipes/calculations{?tenant}', { list: undefined }),
    async (uri, { tenant }) => {
      const tenantStr = typeof tenant === 'string' ? tenant : undefined;
      const data = await getRecipeCalculations(tenantStr);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    }
  );
}
