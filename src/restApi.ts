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
import { getPurchasesAnalytics, searchPurchases, getPurchaseDetails } from './analytics/purchasesAnalytics.js';
import { getInventoryActs, getInventoryActDetails, getInventoryDiscrepancySummary } from './analytics/inventoriesAnalytics.js';
import { getRecipeCalculations, getDishRecipeDetails, getSemiFinishedAnalytics } from './analytics/calculationsAnalytics.js';

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
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 15;
    const sortBy = (req.query.sortBy as any) || 'revenue';
    const top = await getTopSellingItems(tenant, period, limit, sortBy);
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
    const alerts = await getInventoryAlerts(tenant);
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
    const tenant = (req.query.tenant as string) || undefined;
    const query = (req.query.query as string) || undefined;
    const deliveryType = (req.query.deliveryType as any) || 'all';
    const status = (req.query.status as any) || 'all';
    const period = (req.query.period as any) || undefined;
    const startDate = (req.query.startDate as string) || undefined;
    const endDate = (req.query.endDate as string) || undefined;
    const orderId = req.query.orderId ? parseInt(req.query.orderId as string, 10) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

    const results = await searchOrders(tenant, {
      query,
      deliveryType,
      status,
      period,
      startDate,
      endDate,
      orderId,
      limit
    });
    res.json(results);
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
    const platform = (req.query.platform as any) || 'all';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const deliveries = await getDeliveryOrders(tenant, { platform, limit });
    res.json(deliveries);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 13. Purchases Analytics
restRouter.get('/purchases', async (req: Request, res: Response) => {
  try {
    const tenant = (req.query.tenant as string) || undefined;
    const period = (req.query.period as string) || 'this_month';
    const startDate = (req.query.startDate as string) || undefined;
    const endDate = (req.query.endDate as string) || undefined;
    const supplierId = (req.query.supplierId as string) || undefined;
    const warehouse = (req.query.warehouse as string) || undefined;
    const purchases = await getPurchasesAnalytics(tenant, period, startDate, endDate, supplierId, warehouse);
    res.json(purchases);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 14. Search Purchases
restRouter.get('/purchases/search', async (req: Request, res: Response) => {
  try {
    const tenant = (req.query.tenant as string) || undefined;
    const query = (req.query.query as string) || undefined;
    const supplierId = (req.query.supplierId as string) || undefined;
    const warehouse = (req.query.warehouse as string) || undefined;
    const period = (req.query.period as string) || undefined;
    const startDate = (req.query.startDate as string) || undefined;
    const endDate = (req.query.endDate as string) || undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 25;

    const items = await searchPurchases(tenant, {
      query,
      supplierId,
      warehouse,
      period,
      startDate,
      endDate,
      limit
    });
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 15. Purchase Details
restRouter.get('/purchases/details', async (req: Request, res: Response) => {
  try {
    const invoiceCode = (req.query.invoiceCode as string) || (req.query.code as string) || (req.query.id as string);
    const tenant = (req.query.tenant as string) || undefined;
    if (!invoiceCode) return res.status(400).json({ error: 'invoiceCode or code is required' });
    const details = await getPurchaseDetails(invoiceCode, tenant);
    res.json(details);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 16. Inventory Acts
restRouter.get('/inventory/acts', async (req: Request, res: Response) => {
  try {
    const tenant = (req.query.tenant as string) || undefined;
    const period = (req.query.period as string) || 'all';
    const startDate = (req.query.startDate as string) || undefined;
    const endDate = (req.query.endDate as string) || undefined;
    const warehouse = (req.query.warehouse as string) || undefined;
    const status = (req.query.status as string) || 'all';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 25;

    const acts = await getInventoryActs(tenant, {
      period,
      startDate,
      endDate,
      warehouse,
      status,
      limit
    });
    res.json(acts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 17. Inventory Act Details
restRouter.get('/inventory/act-details', async (req: Request, res: Response) => {
  try {
    const actId = req.query.actId ? parseInt(req.query.actId as string, 10) : (req.query.id ? parseInt(req.query.id as string, 10) : 0);
    const tenant = (req.query.tenant as string) || undefined;
    if (!actId) return res.status(400).json({ error: 'actId is required' });
    const details = await getInventoryActDetails(actId, tenant);
    res.json(details);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 18. Inventory Discrepancy Summary
restRouter.get('/inventory/discrepancies', async (req: Request, res: Response) => {
  try {
    const tenant = (req.query.tenant as string) || undefined;
    const period = (req.query.period as string) || 'this_month';
    const startDate = (req.query.startDate as string) || undefined;
    const endDate = (req.query.endDate as string) || undefined;
    const discrepancies = await getInventoryDiscrepancySummary(tenant, period, startDate, endDate);
    res.json(discrepancies);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 19. Recipe Calculations
restRouter.get('/recipes/calculations', async (req: Request, res: Response) => {
  try {
    const tenant = (req.query.tenant as string) || undefined;
    const category = (req.query.category as string) || undefined;
    const type = (req.query.type as any) || 'all';
    const search = (req.query.search as string) || undefined;
    const minFoodCost = req.query.minFoodCost ? parseFloat(req.query.minFoodCost as string) : undefined;
    const maxFoodCost = req.query.maxFoodCost ? parseFloat(req.query.maxFoodCost as string) : undefined;
    const missingRecipesOnly = req.query.missingRecipesOnly === 'true' || req.query.missingRecipesOnly === '1';
    const includeDisabled = req.query.includeDisabled === 'true' || req.query.includeDisabled === '1';
    const sortBy = (req.query.sortBy as any) || 'food_cost_pct';
    const sortDirection = (req.query.sortDirection as any) || 'desc';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

    const data = await getRecipeCalculations(tenant, {
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
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 20. Dish Recipe Details
restRouter.get('/recipes/dish-details', async (req: Request, res: Response) => {
  try {
    const dish = (req.query.dish as string) || (req.query.itemId as string) || (req.query.name as string);
    const tenant = (req.query.tenant as string) || undefined;
    if (!dish) return res.status(400).json({ error: 'dish parameter is required (name, ID or hash)' });
    const details = await getDishRecipeDetails(dish, tenant);
    res.json(details);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 21. Semi-Finished Products
restRouter.get('/recipes/semi-finished', async (req: Request, res: Response) => {
  try {
    const tenant = (req.query.tenant as string) || undefined;
    const search = (req.query.search as string) || undefined;
    const semi = await getSemiFinishedAnalytics(tenant, search);
    res.json(semi);
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
      description: 'API for real-time restaurant revenue, shift X/Z reports, sales, top menu items, expenses, purchases, inventories, and recipe costings.',
      version: '1.1.0'
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
            { name: 'tenant', in: 'query', required: false, schema: { type: 'string' }, description: 'Tenant name or slug' },
            { name: 'date', in: 'query', required: false, schema: { type: 'string' }, description: 'Date YYYY-MM-DD (defaults to today)' }
          ],
          responses: { '200': { description: 'Successful response' } }
        }
      },
      '/api/purchases': {
        get: {
          operationId: 'getPurchasesAnalytics',
          summary: 'Get procurement and purchases analytics aggregated by period, suppliers and warehouses',
          parameters: [
            { name: 'tenant', in: 'query', required: false, schema: { type: 'string' } },
            { name: 'period', in: 'query', required: false, schema: { type: 'string', enum: ['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'custom'] } }
          ],
          responses: { '200': { description: 'Successful response' } }
        }
      },
      '/api/inventory/acts': {
        get: {
          operationId: 'getInventoryActs',
          summary: 'List inventory acts with shortage, surplus and net discrepancies',
          parameters: [
            { name: 'tenant', in: 'query', required: false, schema: { type: 'string' } }
          ],
          responses: { '200': { description: 'Successful response' } }
        }
      },
      '/api/recipes/calculations': {
        get: {
          operationId: 'getRecipeCalculations',
          summary: 'Get dish prime costs, food cost %, and gross margin',
          parameters: [
            { name: 'tenant', in: 'query', required: false, schema: { type: 'string' } },
            { name: 'minFoodCost', in: 'query', required: false, schema: { type: 'number' } }
          ],
          responses: { '200': { description: 'Successful response' } }
        }
      }
    }
  };
}
