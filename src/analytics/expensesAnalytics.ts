import { supabase, resolveTenant, getPeriodBounds, fetchAllRows } from '../db.js';

export interface ExpenseItem {
  id: number;
  type: 'SUPPLIER_PAYMENT' | 'CASH_OUT' | 'WRITEOFF';
  title: string;
  category: string;
  amount: number;
  date: string;
  creator?: string;
}

export interface ExpensesAnalyticsResult {
  period_label: string;
  start_date: string;
  end_date: string;
  total_expenses: number;
  currency: string;
  breakdown: {
    supplier_payments: number;
    cash_out_payouts: number;
    write_offs: number;
  };
  suppliers_summary: Array<{
    supplier_id: number | string;
    supplier_name: string;
    total_paid: number;
    payments_count: number;
  }>;
  recent_expenses: ExpenseItem[];
}

export async function getExpensesAnalytics(
  tenantIdentifier?: string,
  period: string = 'today',
  customStart?: string,
  customEnd?: string
): Promise<ExpensesAnalyticsResult> {
  const tenant = await resolveTenant(tenantIdentifier);
  const bounds = getPeriodBounds(period, customStart, customEnd);

  // 1. Fetch Supplier Payments with Supplier details using pagination
  const momwData = await fetchAllRows(async (from, to) => {
    return supabase
      .from('momw_gadaxdebi')
      .select('id, dealer, date, price, creator')
      .eq('tenant_id', tenant.id)
      .gte('date', bounds.start)
      .lte('date', bounds.end)
      .order('date', { ascending: false })
      .range(from, to);
  });

  const dealerIds = [...new Set(momwData.map(m => m.dealer).filter(Boolean))];
  const { data: dealersData } = dealerIds.length > 0
    ? await supabase.from('momwodeblebi').select('id, name').in('id', dealerIds)
    : { data: [] };

  const dealerNameMap = new Map<any, string>();
  (dealersData || []).forEach((d: any) => dealerNameMap.set(d.id, d.name));

  // 2. Fetch Cash desk out using pagination
  const salaroData = await fetchAllRows(async (from, to) => {
    return supabase
      .from('salaro')
      .select('id, comment, price_out, date, creator')
      .eq('tenant_id', tenant.id)
      .gt('price_out', 0)
      .gte('date', bounds.start)
      .lte('date', bounds.end)
      .order('date', { ascending: false })
      .range(from, to);
  });

  const creatorIds = [...new Set(salaroData.map(s => s.creator).filter(Boolean))];
  const { data: creatorsData } = creatorIds.length > 0
    ? await supabase.from('users').select('id, name, username').in('id', creatorIds)
    : { data: [] };

  const userNameMap = new Map<any, string>();
  (creatorsData || []).forEach((u: any) => userNameMap.set(u.id, u.name || u.username));

  // 3. Fetch Write-offs
  let totalWriteOffs = 0;
  const writeoffItems: ExpenseItem[] = [];
  try {
    const { data: woData } = await supabase
      .from('writeoff_items')
      .select('id, name, price, count, created_at')
      .eq('tenant_id', tenant.id)
      .gte('created_at', bounds.start)
      .lte('created_at', bounds.end);

    (woData || []).forEach(w => {
      const amt = (parseFloat(w.price) || 0) * (parseFloat(w.count) || 1);
      totalWriteOffs += amt;
      writeoffItems.push({
        id: w.id,
        type: 'WRITEOFF',
        title: w.name || 'ჩამოწერა / Write-off',
        category: 'სასაქონლო ჩამოწერა',
        amount: Number(amt.toFixed(2)),
        date: w.created_at
      });
    });
  } catch {}

  const supplierMap = new Map<string, { id: any; name: string; total: number; count: number }>();
  let totalSupplierPayments = 0;
  const expenseItems: ExpenseItem[] = [];

  (momwData || []).forEach(m => {
    const amt = parseFloat(m.price) || 0;
    totalSupplierPayments += amt;
    const supName = dealerNameMap.get(m.dealer) || `მომწოდებელი #${m.dealer}`;
    const supKey = String(m.dealer);

    const s = supplierMap.get(supKey) || { id: m.dealer, name: supName, total: 0, count: 0 };
    s.total += amt;
    s.count += 1;
    supplierMap.set(supKey, s);

    expenseItems.push({
      id: m.id,
      type: 'SUPPLIER_PAYMENT',
      title: supName,
      category: 'მომწოდებლის გადახდა / Поставщик',
      amount: Number(amt.toFixed(2)),
      date: m.date,
      creator: userNameMap.get(m.creator) || String(m.creator || '')
    });
  });

  let totalCashOut = 0;
  (salaroData || []).forEach(s => {
    const amt = parseFloat(s.price_out) || 0;
    totalCashOut += amt;
    expenseItems.push({
      id: s.id,
      type: 'CASH_OUT',
      title: s.comment || 'სალაროდან გაცემა / Изъятие',
      category: 'სალაროს ხარჯი / Касса',
      amount: Number(amt.toFixed(2)),
      date: s.date,
      creator: userNameMap.get(s.creator) || String(s.creator || '')
    });
  });

  expenseItems.push(...writeoffItems);

  const totalExpenses = totalSupplierPayments + totalCashOut + totalWriteOffs;

  const suppliersSummary = Array.from(supplierMap.values()).map(s => ({
    supplier_id: s.id,
    supplier_name: s.name,
    total_paid: Number(s.total.toFixed(2)),
    payments_count: s.count
  })).sort((a, b) => b.total_paid - a.total_paid);

  // Sort recent expenses by date desc
  expenseItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return {
    period_label: bounds.label,
    start_date: bounds.start,
    end_date: bounds.end,
    total_expenses: Number(totalExpenses.toFixed(2)),
    currency: tenant.currency || 'GEL',
    breakdown: {
      supplier_payments: Number(totalSupplierPayments.toFixed(2)),
      cash_out_payouts: Number(totalCashOut.toFixed(2)),
      write_offs: Number(totalWriteOffs.toFixed(2))
    },
    suppliers_summary: suppliersSummary,
    recent_expenses: expenseItems.slice(0, 30)
  };
}

