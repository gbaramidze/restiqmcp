export interface TenantInfo {
  id: string;
  name: string;
  slug?: string;
  code?: string;
  currency?: string;
  tax_id?: string;
}

export interface TodaySummaryResult {
  date: string;
  tenant: TenantInfo;
  shift_status: {
    is_shift_open: boolean;
    shift_id?: number;
    shift_number?: number;
    opened_at?: string;
    opened_by_name?: string;
  };
  revenue: {
    gross_total: number;
    discounts_total: number;
    net_revenue: number;
    currency: string;
  };
  payments_breakdown: {
    cash: number;
    card: number;
    bank_transfer: number;
    other: number;
  };
  orders_metrics: {
    total_orders_count: number;
    closed_orders_count: number;
    active_open_orders_count: number;
    average_check: number;
    total_guests_count: number;
    average_per_guest: number;
  };
  expenses: {
    total_expenses: number;
    supplier_payments: number;
    cash_payouts: number;
    write_offs: number;
  };
  cash_desk: {
    initial_cash: number;
    cash_in: number;
    cash_out: number;
    expected_cash_in_drawer: number;
  };
  financial_balance: {
    net_sales: number;
    total_expenses: number;
    net_profit_or_loss: number;
  };
}

export interface SalesPeriodSummary {
  period_label: string;
  start_date: string;
  end_date: string;
  total_revenue: number;
  orders_count: number;
  average_check: number;
  total_discounts: number;
  delivery_breakdown: {
    dine_in_revenue: number;
    delivery_revenue: number;
    glovo_revenue: number;
    bolt_revenue: number;
    taxi_revenue: number;
  };
  hourly_sales: Array<{
    hour: number;
    hour_label: string;
    revenue: number;
    orders_count: number;
  }>;
  halls_sales: Array<{
    room_id: number | string;
    room_name: string;
    revenue: number;
    orders_count: number;
  }>;
}

export interface TopItemSummary {
  item_id: number;
  item_name: string;
  category_name?: string;
  type?: string; // 'kitchen' | 'bar'
  quantity_sold: number;
  total_revenue: number;
  average_price: number;
}

export interface InventoryAlert {
  product_id: number;
  name: string;
  code?: string;
  current_stock: number;
  minimum_required: number;
  deficit: number;
  unit?: string;
  status: 'CRITICAL_ZERO' | 'LOW_STOCK';
}

export interface ActiveOrderSummary {
  order_id: number;
  table_number: number | string;
  room_name?: string;
  waiter_name?: string;
  opened_at: string;
  duration_minutes: number;
  guests_count: number;
  total_amount: number;
  items_count: number;
  items: Array<{
    name: string;
    count: number;
    price: number;
  }>;
}

export interface StaffPerformanceSummary {
  user_id: number;
  name: string;
  role: string;
  orders_count: number;
  total_revenue: number;
  average_check: number;
}
