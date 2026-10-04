import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTodaySummary } from './analytics/todaySummary.js';
import { getShiftAnalytics } from './analytics/shiftAnalytics.js';
import { getInventoryAlerts } from './analytics/inventoryAlerts.js';

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
}
