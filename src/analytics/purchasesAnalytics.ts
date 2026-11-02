import { supabase, resolveTenant, getPeriodBounds, fetchAllRows } from '../db.js';

export interface PurchaseItemDetail {
  id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  unit_name: string;
  invoice_code: string;
  supplier_id: string | number;
  supplier_name: string;
  warehouse_type: string;
  date: string;
}

export interface SupplierPurchaseSummary {
  supplier_id: string | number;
  supplier_name: string;
  supplier_code?: string;
  total_amount: number;
  invoices_count: number;
  items_count: number;
}

export interface PurchasesAnalyticsResult {
  tenant: {
    id: string;
    name: string;
    currency: string;
  };
  period_label: string;
  start_date: string;
  end_date: string;
  summary: {
    total_purchase_amount: number;
    total_invoices_count: number;
    total_items_count: number;
    total_quantity: number;
    average_invoice_amount: number;
    currency: string;
  };
  warehouse_breakdown: Array<{
    warehouse_type: string;
    warehouse_name: string;
    total_amount: number;
    items_count: number;
  }>;
  suppliers_summary: SupplierPurchaseSummary[];
  top_purchased_products: Array<{
    product_name: string;
    total_amount: number;
    total_quantity: number;
    unit_name: string;
    average_unit_price: number;
    purchases_count: number;
  }>;
  recent_invoices: Array<{
    invoice_code: string;
    supplier_name: string;
    date: string;
    warehouse_type: string;
    items_count: number;
    total_amount: number;
  }>;
}

export async function getPurchasesAnalytics(
  tenantIdentifier?: string,
  period: string = 'this_month',
  customStart?: string,
  customEnd?: string,
  filterSupplierId?: string | number,
  filterWarehouse?: string
): Promise<PurchasesAnalyticsResult> {
  const tenant = await resolveTenant(tenantIdentifier);
  const bounds = getPeriodBounds(period, customStart, customEnd);

  // 1. Fetch Suppliers Map for this tenant
  const { data: suppliersData } = await supabase
    .from('momwodeblebi')
    .select('id, name, code, contact, person')
    .eq('tenant_id', tenant.id);

  const supplierMap = new Map<string, any>();
  (suppliersData || []).forEach((s: any) => supplierMap.set(String(s.id), s));

  // 2. Fetch Units Map
  const { data: unitsData } = await supabase
    .from('units')
    .select('id, name, short_name');

  const unitMap = new Map<number, string>();
  (unitsData || []).forEach((u: any) => unitMap.set(u.id, u.short_name || u.name));

  // 3. Fetch Purchases (migeba) in period using pagination
  const migebaRows = await fetchAllRows(async (from, to) => {
    let q = supabase
      .from('migeba')
      .select('id, name, price, count, code, ert, need, dealer, date, type')
      .eq('tenant_id', tenant.id)
      .gte('date', bounds.start)
      .lte('date', bounds.end)
      .order('date', { ascending: false });

    if (filterSupplierId !== undefined && filterSupplierId !== null && filterSupplierId !== '') {
      q = q.eq('dealer', String(filterSupplierId));
    }
    if (filterWarehouse && filterWarehouse !== 'ALL' && filterWarehouse !== 'ყველა') {
      q = q.eq('type', filterWarehouse);
    }

    return q.range(from, to);
  });

  // Calculate Aggregates
  let totalPurchaseAmount = 0;
  let totalQuantity = 0;
  const invoiceSet = new Set<string>();
  const invoiceMap = new Map<string, {
    invoice_code: string;
    supplier_name: string;
    date: string;
    warehouse_type: string;
    items_count: number;
    total_amount: number;
  }>();

  const supSummaryMap = new Map<string, {
    supplier_id: string;
    supplier_name: string;
    supplier_code?: string;
    total_amount: number;
    invoices: Set<string>;
    items_count: number;
  }>();

  const whSummaryMap = new Map<string, {
    warehouse_type: string;
    warehouse_name: string;
    total_amount: number;
    items_count: number;
  }>();

  const productSummaryMap = new Map<string, {
    product_name: string;
    total_amount: number;
    total_quantity: number;
    unit_name: string;
    purchases_count: number;
  }>();

  for (const row of migebaRows) {
    const price = parseFloat(row.price) || 0;
    const count = parseFloat(row.count) || 0;
    const lineTotal = price * count;
    const invCode = row.code || `NO-CODE-${row.id}`;
    const supplierObj = supplierMap.get(String(row.dealer));
    const supplierName = supplierObj ? supplierObj.name : (row.dealer ? `მომწოდებელი #${row.dealer}` : 'უცნობი / მიუთითებელი');
    const unitName = unitMap.get(row.ert) || 'ც';
    const whType = row.type || 'main';

    totalPurchaseAmount += lineTotal;
    totalQuantity += count;
    invoiceSet.add(invCode);

    // Group by Invoice
    const existingInv = invoiceMap.get(invCode);
    if (!existingInv) {
      invoiceMap.set(invCode, {
        invoice_code: row.code || '—',
        supplier_name: supplierName,
        date: row.date,
        warehouse_type: whType,
        items_count: 1,
        total_amount: lineTotal
      });
    } else {
      existingInv.items_count += 1;
      existingInv.total_amount += lineTotal;
    }

    // Group by Supplier
    const supKey = String(row.dealer || 'unknown');
    const existingSup = supSummaryMap.get(supKey);
    if (!existingSup) {
      const s = new Set<string>();
      if (row.code) s.add(row.code);
      supSummaryMap.set(supKey, {
        supplier_id: supKey,
        supplier_name: supplierName,
        supplier_code: supplierObj?.code,
        total_amount: lineTotal,
        invoices: s,
        items_count: 1
      });
    } else {
      existingSup.total_amount += lineTotal;
      existingSup.items_count += 1;
      if (row.code) existingSup.invoices.add(row.code);
    }

    // Group by Warehouse
    const whName = whType === 'bar' ? 'ბარი' : whType === 'restourant' || whType === 'kitchen' ? 'სამზარეულო' : 'მთავარი საწყობი';
    const existingWh = whSummaryMap.get(whType);
    if (!existingWh) {
      whSummaryMap.set(whType, {
        warehouse_type: whType,
        warehouse_name: whName,
        total_amount: lineTotal,
        items_count: 1
      });
    } else {
      existingWh.total_amount += lineTotal;
      existingWh.items_count += 1;
    }

    // Group by Product
    const prodKey = (row.name || 'უსახელო').trim();
    const existingProd = productSummaryMap.get(prodKey);
    if (!existingProd) {
      productSummaryMap.set(prodKey, {
        product_name: prodKey,
        total_amount: lineTotal,
        total_quantity: count,
        unit_name: unitName,
        purchases_count: 1
      });
    } else {
      existingProd.total_amount += lineTotal;
      existingProd.total_quantity += count;
      existingProd.purchases_count += 1;
    }
  }

  const suppliersSummary: SupplierPurchaseSummary[] = Array.from(supSummaryMap.values()).map(s => ({
    supplier_id: s.supplier_id,
    supplier_name: s.supplier_name,
    supplier_code: s.supplier_code,
    total_amount: Number(s.total_amount.toFixed(2)),
    invoices_count: s.invoices.size || s.items_count,
    items_count: s.items_count
  })).sort((a, b) => b.total_amount - a.total_amount);

  const warehouseBreakdown = Array.from(whSummaryMap.values()).map(w => ({
    warehouse_type: w.warehouse_type,
    warehouse_name: w.warehouse_name,
    total_amount: Number(w.total_amount.toFixed(2)),
    items_count: w.items_count
  })).sort((a, b) => b.total_amount - a.total_amount);

  const topPurchasedProducts = Array.from(productSummaryMap.values()).map(p => ({
    product_name: p.product_name,
    total_amount: Number(p.total_amount.toFixed(2)),
    total_quantity: Number(p.total_quantity.toFixed(3)),
    unit_name: p.unit_name,
    average_unit_price: p.total_quantity > 0 ? Number((p.total_amount / p.total_quantity).toFixed(2)) : 0,
    purchases_count: p.purchases_count
  })).sort((a, b) => b.total_amount - a.total_amount).slice(0, 25);

  const recentInvoices = Array.from(invoiceMap.values())
    .map(inv => ({
      ...inv,
      total_amount: Number(inv.total_amount.toFixed(2))
    }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 20);

  const totalInvoicesCount = invoiceSet.size;
  const avgInvoiceAmount = totalInvoicesCount > 0 ? totalPurchaseAmount / totalInvoicesCount : 0;

  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      currency: tenant.currency || 'GEL'
    },
    period_label: bounds.label,
    start_date: bounds.start,
    end_date: bounds.end,
    summary: {
      total_purchase_amount: Number(totalPurchaseAmount.toFixed(2)),
      total_invoices_count: totalInvoicesCount,
      total_items_count: migebaRows.length,
      total_quantity: Number(totalQuantity.toFixed(2)),
      average_invoice_amount: Number(avgInvoiceAmount.toFixed(2)),
      currency: tenant.currency || 'GEL'
    },
    warehouse_breakdown: warehouseBreakdown,
    suppliers_summary: suppliersSummary,
    top_purchased_products: topPurchasedProducts,
    recent_invoices: recentInvoices
  };
}

export async function searchPurchases(
  tenantIdentifier?: string,
  options: {
    query?: string;
    supplierId?: string | number;
    warehouse?: string;
    period?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  } = {}
) {
  const tenant = await resolveTenant(tenantIdentifier);
  const limit = options.limit || 30;

  // Suppliers & Units Map
  const { data: suppliersData } = await supabase
    .from('momwodeblebi')
    .select('id, name, code')
    .eq('tenant_id', tenant.id);
  const supplierMap = new Map<string, any>((suppliersData || []).map((s: any) => [String(s.id), s]));

  const { data: unitsData } = await supabase.from('units').select('id, name, short_name');
  const unitMap = new Map<number, string>((unitsData || []).map((u: any) => [u.id, u.short_name || u.name]));

  let queryBuilder = supabase
    .from('migeba')
    .select('id, name, price, count, code, ert, need, dealer, date, type')
    .eq('tenant_id', tenant.id)
    .order('date', { ascending: false });

  if (options.period || (options.startDate && options.endDate)) {
    const bounds = getPeriodBounds(options.period || 'custom', options.startDate, options.endDate);
    queryBuilder = queryBuilder.gte('date', bounds.start).lte('date', bounds.end);
  }

  if (options.supplierId) {
    queryBuilder = queryBuilder.eq('dealer', String(options.supplierId));
  }

  if (options.warehouse && options.warehouse !== 'ALL') {
    queryBuilder = queryBuilder.eq('type', options.warehouse);
  }

  if (options.query) {
    const q = options.query.trim();
    queryBuilder = queryBuilder.or(`code.ilike.%${q}%,name.ilike.%${q}%`);
  }

  const { data: rows, error } = await queryBuilder.limit(limit);
  if (error) throw error;

  const items: PurchaseItemDetail[] = (rows || []).map(r => {
    const price = parseFloat(r.price) || 0;
    const count = parseFloat(r.count) || 0;
    const supObj = supplierMap.get(String(r.dealer));
    return {
      id: r.id,
      product_name: r.name,
      quantity: count,
      unit_price: price,
      total_price: Number((price * count).toFixed(2)),
      unit_name: unitMap.get(r.ert) || 'ც',
      invoice_code: r.code || '—',
      supplier_id: r.dealer,
      supplier_name: supObj ? supObj.name : (r.dealer ? `მომწოდებელი #${r.dealer}` : 'უცნობი'),
      warehouse_type: r.type || 'main',
      date: r.date
    };
  });

  return {
    tenant_name: tenant.name,
    total_found: items.length,
    items
  };
}

export async function getPurchaseDetails(
  invoiceCodeOrId: string | number,
  tenantIdentifier?: string
) {
  const tenant = await resolveTenant(tenantIdentifier);

  const { data: suppliersData } = await supabase
    .from('momwodeblebi')
    .select('id, name, code, contact, person')
    .eq('tenant_id', tenant.id);
  const supplierMap = new Map<string, any>((suppliersData || []).map((s: any) => [String(s.id), s]));

  const { data: unitsData } = await supabase.from('units').select('id, name, short_name');
  const unitMap = new Map<number, string>((unitsData || []).map((u: any) => [u.id, u.short_name || u.name]));

  const codeStr = String(invoiceCodeOrId).trim();
  let query = supabase
    .from('migeba')
    .select('id, name, price, count, code, ert, need, dealer, date, type')
    .eq('tenant_id', tenant.id);

  if (/^\d+$/.test(codeStr) && codeStr.length < 7) {
    // Might be an id or a short code, query by or
    query = query.or(`code.eq.${codeStr},id.eq.${codeStr}`);
  } else {
    query = query.eq('code', codeStr);
  }

  const { data: rows, error } = await query.order('id', { ascending: true });
  if (error) throw error;

  if (!rows || rows.length === 0) {
    throw new Error(`შესყიდვა/ზედნადები კოდით ან ID-ით "${invoiceCodeOrId}" ვერ მოიძებნა.`);
  }

  let totalInvoiceSum = 0;
  let totalItemsCount = 0;
  const sample = rows[0];
  const supObj = supplierMap.get(String(sample.dealer));

  const items = rows.map(r => {
    const price = parseFloat(r.price) || 0;
    const count = parseFloat(r.count) || 0;
    const lineTotal = price * count;
    totalInvoiceSum += lineTotal;
    totalItemsCount += 1;

    return {
      id: r.id,
      product_name: r.name,
      quantity: count,
      unit_price: price,
      total_price: Number(lineTotal.toFixed(2)),
      unit_name: unitMap.get(r.ert) || 'ც',
      warehouse_type: r.type || 'main'
    };
  });

  return {
    tenant_name: tenant.name,
    invoice_code: sample.code || String(sample.id),
    date: sample.date,
    supplier: {
      id: sample.dealer,
      name: supObj ? supObj.name : (sample.dealer ? `მომწოდებელი #${sample.dealer}` : 'უცნობი'),
      code: supObj?.code,
      contact: supObj?.contact,
      person: supObj?.person
    },
    warehouse_type: sample.type || 'main',
    total_items_count: totalItemsCount,
    grand_total: Number(totalInvoiceSum.toFixed(2)),
    currency: tenant.currency || 'GEL',
    items
  };
}
