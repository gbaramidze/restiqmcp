import { Router, Request, Response } from 'express';
import { supabase } from './db.js';
import { getTodaySummary } from './analytics/todaySummary.js';
import { getSalesAnalytics } from './analytics/salesAnalytics.js';
import { getExpensesAnalytics } from './analytics/expensesAnalytics.js';
import { getTopSellingItems } from './analytics/topItems.js';
import { getShiftAnalytics } from './analytics/shiftAnalytics.js';
import { getInventoryAlerts } from './analytics/inventoryAlerts.js';
import { getActiveOrders } from './analytics/activeOrders.js';
import { getStaffPerformance } from './analytics/staffPerformance.js';
import { searchOrders, getOrderDetails, getDeliveryOrders } from './analytics/orderSearch.js';

export const restRouter = Router();

// 1. List Tenants
restRouter.get('/tenants', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('tenants')
      .select('id, name, slug, code, currency, tax_id, license_plan, is_active')
      .order('name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ tenants: data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Today Summary
restRouter.get('/today-summary', async (req: Request, res: Response) => {
  try {
    const tenant = (req.query.tenant as string) || undefined;
    const date = (req.query.date as string) || undefined;
    const summary = await getTodaySummary(tenant, date);
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Shift Report
restRouter.get('/shift-report', async (req: Request, res: Response) => {
  try {
    const tenant = (req.query.tenant as string) || undefined;
    const shiftId = req.query.shiftId ? parseInt(req.query.shiftId as string, 10) : undefined;
    const report = await getShiftAnalytics(tenant, shiftId);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Sales Analytics
restRouter.get('/sales', async (req: Request, res: Response) => {
  try {
    const tenant = (req.query.tenant as string) || undefined;
    const period = (req.query.period as string) || 'today';
    const startDate = (req.query.startDate as string) || undefined;
    const endDate = (req.query.endDate as string) || undefined;
    const sales = await getSalesAnalytics(tenant, period, startDate, endDate);
    res.json(sales);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Top Selling Items
restRouter.get('/top-items', async (req: Request, res: Response) => {
  try {
    const tenant = (req.query.tenant as string) || undefined;
    const period = (req.query.period as string) || 'today';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    const startDate = (req.query.startDate as string) || undefined;
    const endDate = (req.query.endDate as string) || undefined;
    const top = await getTopSellingItems(tenant, period, limit, startDate, endDate);
    res.json(top);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Expenses Analytics
restRouter.get('/expenses', async (req: Request, res: Response) => {
  try {
    const tenant = (req.query.tenant as string) || undefined;
    const period = (req.query.period as string) || 'this_month';
    const startDate = (req.query.startDate as string) || undefined;
    const endDate = (req.query.endDate as string) || undefined;
    const expenses = await getExpensesAnalytics(tenant, period, startDate, endDate);
    res.json(expenses);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Inventory Alerts
restRouter.get('/inventory-alerts', async (req: Request, res: Response) => {
  try {
    const tenant = (req.query.tenant as string) || undefined;
    const threshold = req.query.threshold ? parseFloat(req.query.threshold as string) : 0;
    const alerts = await getInventoryAlerts(tenant, threshold);
    res.json(alerts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Active Orders / Tables
restRouter.get('/active-orders', async (req: Request, res: Response) => {
  try {
    const tenant = (req.query.tenant as string) || undefined;
    const active = await getActiveOrders(tenant);
    res.json(active);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Staff Performance
restRouter.get('/staff-performance', async (req: Request, res: Response) => {
  try {
    const tenant = (req.query.tenant as string) || undefined;
    const period = (req.query.period as string) || 'today';
    const startDate = (req.query.startDate as string) || undefined;
    const endDate = (req.query.endDate as string) || undefined;
    const staff = await getStaffPerformance(tenant, period, startDate, endDate);
    res.json(staff);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Search Orders
restRouter.get('/search-orders', async (req: Request, res: Response) => {
  try {
    const query = (req.query.query as string) || '';
    const tenant = (req.query.tenant as string) || undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    const results = await searchOrders(query, tenant, limit);
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Order Details
restRouter.get('/order-details', async (req: Request, res: Response) => {
  try {
    const orderId = parseInt(req.query.orderId as string, 10);
    const tenant = (req.query.tenant as string) || undefined;
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });
    const order = await getOrderDetails(orderId, tenant);
    res.json(order);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 12. Delivery Orders
restRouter.get('/delivery-orders', async (req: Request, res: Response) => {
  try {
    const tenant = (req.query.tenant as string) || undefined;
    const period = (req.query.period as string) || 'today';
    const platform = (req.query.platform as string) || 'all';
    const deliveries = await getDeliveryOrders(tenant, period, platform);
    res.json(deliveries);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// OpenAPI 3.0 Schema for ChatGPT Custom GPT Actions
export function getOpenApiSchema(baseUrl = 'https://mcp.restiq.ge') {
  return {
    openapi: '3.0.0',
    info: {
      title: 'RestIQ POS & Restaurant Analytics API',
      description: 'API for real-time restaurant revenue, shift X/Z reports, sales, top menu items, expenses, delivery and inventory analytics.',
      version: '1.0.0'
    },
    servers: [
      {
        url: baseUrl
      }
    ],
    paths: {
      '/api/today-summary': {
        get: {
          operationId: 'getTodaySummary',
          summary: 'Get today financial summary (Revenue, Cash In Drawer, Average Check, Discounts)',
          parameters: [
            { name: 'tenant', in: 'query', required: false, schema: { type: 'string' }, description: 'Tenant name or slug (e.g., teatro, ajarapalace)' },
            { name: 'date', in: 'query', required: false, schema: { type: 'string' }, description: 'Date YYYY-MM-DD (defaults to today)' }
          ],
          responses: { '200': { description: 'Successful response' } }
        }
      },
      '/api/shift-report': {
        get: {
          operationId: 'getShiftReport',
          summary: 'Get current active cash shift X/Z report with cashier name, cash vs card sales and discrepancy',
          parameters: [
            { name: 'tenant', in: 'query', required: false, schema: { type: 'string' }, description: 'Tenant name or slug' },
            { name: 'shiftId', in: 'query', required: false, schema: { type: 'integer' }, description: 'Shift ID (optional, defaults to active shift)' }
          ],
          responses: { '200': { description: 'Successful response' } }
        }
      },
      '/api/sales': {
        get: {
          operationId: 'getSalesAnalytics',
          summary: 'Get detailed sales analytics aggregated by period, halls and hourly distribution',
          parameters: [
            { name: 'tenant', in: 'query', required: false, schema: { type: 'string' }, description: 'Tenant name or slug' },
            { name: 'period', in: 'query', required: false, schema: { type: 'string', enum: ['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'custom'] } },
            { name: 'startDate', in: 'query', required: false, schema: { type: 'string' }, description: 'YYYY-MM-DD for custom period' },
            { name: 'endDate', in: 'query', required: false, schema: { type: 'string' }, description: 'YYYY-MM-DD for custom period' }
          ],
          responses: { '200': { description: 'Successful response' } }
        }
      },
      '/api/top-items': {
        get: {
          operationId: 'getTopSellingItems',
          summary: 'Get top selling dishes, drinks and hookah items classified into Kitchen, Bar and Hookah',
          parameters: [
            { name: 'tenant', in: 'query', required: false, schema: { type: 'string' }, description: 'Tenant name or slug' },
            { name: 'period', in: 'query', required: false, schema: { type: 'string', enum: ['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'custom'] } },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer' }, description: 'Number of items to return (default 10)' }
          ],
          responses: { '200': { description: 'Successful response' } }
        }
      },
      '/api/expenses': {
        get: {
          operationId: 'getExpensesAnalytics',
          summary: 'Get expenses breakdown (supplier payments, cash drawer payouts, write-offs)',
          parameters: [
            { name: 'tenant', in: 'query', required: false, schema: { type: 'string' }, description: 'Tenant name or slug' },
            { name: 'period', in: 'query', required: false, schema: { type: 'string', enum: ['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'custom'] } }
          ],
          responses: { '200': { description: 'Successful response' } }
        }
      },
      '/api/inventory-alerts': {
        get: {
          operationId: 'getInventoryAlerts',
          summary: 'Get inventory stock alerts and out-of-stock / zero-stock items',
          parameters: [
            { name: 'tenant', in: 'query', required: false, schema: { type: 'string' }, description: 'Tenant name or slug' },
            { name: 'threshold', in: 'query', required: false, schema: { type: 'number' }, description: 'Min stock threshold (default 0)' }
          ],
          responses: { '200': { description: 'Successful response' } }
        }
      },
      '/api/active-orders': {
        get: {
          operationId: 'getActiveOrders',
          summary: 'Get real-time currently occupied tables and active open orders in the restaurant',
          parameters: [
            { name: 'tenant', in: 'query', required: false, schema: { type: 'string' }, description: 'Tenant name or slug' }
          ],
          responses: { '200': { description: 'Successful response' } }
        }
      },
      '/api/staff-performance': {
        get: {
          operationId: 'getStaffPerformance',
          summary: 'Get waiter/cashier sales leaderboard and order counts',
          parameters: [
            { name: 'tenant', in: 'query', required: false, schema: { type: 'string' }, description: 'Tenant name or slug' },
            { name: 'period', in: 'query', required: false, schema: { type: 'string', enum: ['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'custom'] } }
          ],
          responses: { '200': { description: 'Successful response' } }
        }
      },
      '/api/delivery-orders': {
        get: {
          operationId: 'getDeliveryOrders',
          summary: 'Get delivery platform orders (Glovo, Wolt, Bolt Food, Web QR Delivery)',
          parameters: [
            { name: 'tenant', in: 'query', required: false, schema: { type: 'string' }, description: 'Tenant name or slug' },
            { name: 'period', in: 'query', required: false, schema: { type: 'string', enum: ['today', 'yesterday', 'this_week', 'this_month'] } },
            { name: 'platform', in: 'query', required: false, schema: { type: 'string', enum: ['all', 'glovo', 'wolt', 'bolt', 'web'] } }
          ],
          responses: { '200': { description: 'Successful response' } }
        }
      },
      '/api/tenants': {
        get: {
          operationId: 'listTenants',
          summary: 'List available restaurants and venue branches in the system',
          responses: { '200': { description: 'Successful response' } }
        }
      }
    }
  };
}
