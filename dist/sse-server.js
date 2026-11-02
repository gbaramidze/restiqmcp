var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/db.ts
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import ws from "ws";
async function fetchAllRows(queryBuilder, batchSize = 1e3, maxRows = 1e5) {
  const allRows = [];
  let from = 0;
  while (from < maxRows) {
    const to = from + batchSize - 1;
    const { data, error } = await queryBuilder(from, to);
    if (error) {
      console.error(`Error in fetchAllRows at range [${from}, ${to}]:`, error);
      break;
    }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }
  return allRows;
}
async function resolveTenant(tenantIdentifier) {
  const queryParam = tenantIdentifier || process.env.DEFAULT_TENANT || process.env.DEFAULT_TENANT_SLUG || process.env.DEFAULT_TENANT_NAME || process.env.DEFAULT_TENANT_ID;
  let query = supabase.from("tenants").select("id, name, slug, code, currency, tax_id");
  if (queryParam) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(queryParam);
    if (isUuid) {
      query = query.eq("id", queryParam);
    } else {
      query = query.or(`slug.ilike.%${queryParam}%,name.ilike.%${queryParam}%`);
    }
  }
  const { data, error } = await query.limit(1);
  if (error || !data || data.length === 0) {
    const { data: fallbackData } = await supabase.from("tenants").select("id, name, slug, code, currency, tax_id").order("created_at", { ascending: true }).limit(1);
    if (fallbackData && fallbackData.length > 0) {
      return {
        id: fallbackData[0].id,
        name: fallbackData[0].name || "Main Venue",
        slug: fallbackData[0].slug,
        code: fallbackData[0].code,
        currency: fallbackData[0].currency || "GEL",
        tax_id: fallbackData[0].tax_id
      };
    }
    return {
      id: "default",
      name: "Default Venue",
      currency: "GEL"
    };
  }
  const tenant = data[0];
  return {
    id: tenant.id,
    name: tenant.name || "Venue",
    slug: tenant.slug,
    code: tenant.code,
    currency: tenant.currency || "GEL",
    tax_id: tenant.tax_id
  };
}
function getDayBounds(dateInput) {
  const d = dateInput ? new Date(dateInput) : /* @__PURE__ */ new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const startObj = new Date(yyyy, d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const endObj = new Date(yyyy, d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return {
    start: startObj.toISOString(),
    end: endObj.toISOString(),
    dateStr
  };
}
function getPeriodBounds(period, customStart, customEnd) {
  const now = /* @__PURE__ */ new Date();
  if (period === "custom" && customStart && customEnd) {
    const s = new Date(customStart);
    s.setHours(0, 0, 0, 0);
    const e = new Date(customEnd);
    e.setHours(23, 59, 59, 999);
    return {
      start: s.toISOString(),
      end: e.toISOString(),
      label: `${customStart} \u2013 ${customEnd}`
    };
  }
  if (period === "yesterday") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const b2 = getDayBounds(y);
    return { start: b2.start, end: b2.end, label: `\u10D2\u10E3\u10E8\u10D8\u10DC (${b2.dateStr}) / \u0412\u0447\u0435\u0440\u0430` };
  }
  if (period === "this_week") {
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return {
      start: monday.toISOString(),
      end: (/* @__PURE__ */ new Date()).toISOString(),
      label: "\u10DB\u10D8\u10DB\u10D3\u10D8\u10DC\u10D0\u10E0\u10D4 \u10D9\u10D5\u10D8\u10E0\u10D0 / \u0422\u0435\u043A\u0443\u0449\u0430\u044F \u043D\u0435\u0434\u0435\u043B\u044F"
    };
  }
  if (period === "this_month") {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return {
      start: startOfMonth.toISOString(),
      end: (/* @__PURE__ */ new Date()).toISOString(),
      label: "\u10DB\u10D8\u10DB\u10D3\u10D8\u10DC\u10D0\u10E0\u10D4 \u10D7\u10D5\u10D4 / \u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u043C\u0435\u0441\u044F\u0446"
    };
  }
  if (period === "last_month") {
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return {
      start: startOfLastMonth.toISOString(),
      end: endOfLastMonth.toISOString(),
      label: "\u10D2\u10D0\u10E1\u10E3\u10DA\u10D8 \u10D7\u10D5\u10D4 / \u041F\u0440\u043E\u0448\u043B\u044B\u0439 \u043C\u0435\u0441\u044F\u0446"
    };
  }
  const b = getDayBounds(now);
  return { start: b.start, end: b.end, label: `\u10D3\u10E6\u10D4\u10E1 (${b.dateStr}) / \u0421\u0435\u0433\u043E\u0434\u043D\u044F` };
}
var __filename, __dirname, candidateEnvPaths, supabaseUrl, supabaseAnonKey, supabase;
var init_db = __esm({
  "src/db.ts"() {
    "use strict";
    __filename = fileURLToPath(import.meta.url);
    __dirname = path.dirname(__filename);
    candidateEnvPaths = [
      path.resolve(process.cwd(), ".env"),
      path.resolve(process.cwd(), "apps/mcp-server/.env"),
      path.resolve(process.cwd(), "apps/client/.env"),
      path.resolve(__dirname, "../.env"),
      path.resolve(__dirname, "../../client/.env"),
      path.resolve(__dirname, "../../../.env")
    ];
    for (const envPath of candidateEnvPaths) {
      if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
      }
    }
    supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("\u274C Warning: SUPABASE_URL or SUPABASE_ANON_KEY is missing. Please ensure your .env file is configured.");
    }
    if (typeof globalThis.WebSocket === "undefined") {
      globalThis.WebSocket = ws;
    }
    supabase = createClient(supabaseUrl || "", supabaseAnonKey || "", {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      },
      realtime: {
        transport: ws
      }
    });
  }
});

// src/analytics/orderSearch.ts
var orderSearch_exports = {};
__export(orderSearch_exports, {
  getDeliveryOrders: () => getDeliveryOrders,
  getOrderDetails: () => getOrderDetails,
  searchOrders: () => searchOrders
});
async function searchOrders(tenantIdentifier, options = {}) {
  const tenant = await resolveTenant(tenantIdentifier);
  const limit = options.limit || 25;
  let query = supabase.from("orders").select("id, hash, price, status, count, table, creator, date, prepayment, service_fee, discount_amount, is_delivery, tenant_id").eq("tenant_id", tenant.id);
  if (options.orderId) {
    query = query.eq("id", options.orderId);
  }
  if (options.status && options.status !== "all") {
    if (options.status === "closed" || options.status === "completed") {
      query = query.in("status", ["closed", "completed", "paid"]);
    } else if (options.status === "open") {
      query = query.in("status", ["open", "precheck"]);
    } else if (options.status === "canceled") {
      query = query.in("status", ["canceled", "cancelled"]);
    } else {
      query = query.eq("status", options.status);
    }
  }
  if (options.period || options.startDate || options.endDate) {
    const bounds = getPeriodBounds(options.period || "custom", options.startDate, options.endDate);
    query = query.gte("date", bounds.start).lte("date", bounds.end);
  }
  let salaroMatchedOrderIds = null;
  if (options.deliveryType && ["glovo", "bolt", "wolt", "taxi"].includes(options.deliveryType)) {
    const { data: pmtRows } = await supabase.from("salaro").select("order_id").eq("tenant_id", tenant.id).ilike("payment", `%${options.deliveryType}%`);
    salaroMatchedOrderIds = (pmtRows || []).map((r) => r.order_id).filter(Boolean);
  }
  if (salaroMatchedOrderIds && salaroMatchedOrderIds.length > 0) {
    query = query.or(`is_delivery.eq.true,id.in.(${salaroMatchedOrderIds.join(",")})`);
  }
  const { data: rawOrders, error } = await query.order("date", { ascending: false }).limit(limit);
  if (error) {
    console.error("Error searching orders:", error);
  }
  const orders = rawOrders || [];
  if (orders.length === 0) {
    return {
      tenant_name: tenant.name,
      total_found: 0,
      orders: []
    };
  }
  const orderIds = orders.map((o) => o.id);
  const hashes = orders.map((o) => o.hash).filter(Boolean);
  const userIds = [...new Set(orders.map((o) => o.creator).filter(Boolean))];
  const tableIds = [...new Set(orders.map((o) => o.table).filter(Boolean))];
  const [{ data: usersData }, { data: tablesData }, { data: roomsData }, { data: itemsData }, { data: salaroData }] = await Promise.all([
    userIds.length > 0 ? supabase.from("users").select("id, name, username").in("id", userIds) : Promise.resolve({ data: [] }),
    tableIds.length > 0 ? supabase.from("tables").select("id, number, rid").in("id", tableIds) : Promise.resolve({ data: [] }),
    supabase.from("rooms").select("id, name").eq("tenant_id", tenant.id),
    supabase.from("order_list").select("orderID, item, count, price, items:item(name)").in("orderID", orderIds),
    supabase.from("salaro").select("order_id, hash, payment, price_in").eq("tenant_id", tenant.id).in("order_id", orderIds)
  ]);
  const userMap = /* @__PURE__ */ new Map();
  (usersData || []).forEach((u) => userMap.set(u.id, u.name || u.username));
  const roomMap = /* @__PURE__ */ new Map();
  (roomsData || []).forEach((r) => roomMap.set(r.id, r.name));
  const tableMap = /* @__PURE__ */ new Map();
  (tablesData || []).forEach((t) => {
    tableMap.set(t.id, {
      number: String(t.number),
      room_name: roomMap.get(t.rid) || `\u10D3\u10D0\u10E0\u10D1\u10D0\u10D6\u10D8 #${t.rid}`
    });
  });
  const paymentMap = /* @__PURE__ */ new Map();
  (salaroData || []).forEach((s) => {
    if (s.order_id && s.payment) {
      paymentMap.set(s.order_id, s.payment);
    }
  });
  const orderItemsMap = /* @__PURE__ */ new Map();
  (itemsData || []).forEach((it) => {
    const list = orderItemsMap.get(it.orderID) || [];
    list.push({
      name: it.items?.name || `\u10DE\u10DD\u10D6\u10D8\u10EA\u10D8\u10D0 #${it.item}`,
      count: parseFloat(it.count) || 1,
      price: parseFloat(it.price) || 0
    });
    orderItemsMap.set(it.orderID, list);
  });
  const filteredOrders = [];
  for (const o of orders) {
    const isDel = !!o.is_delivery;
    const pmtMethod = paymentMap.get(o.id) || "";
    const tInfo = tableMap.get(o.table) || {
      number: isDel ? "\u10DB\u10D8\u10E2\u10D0\u10DC\u10D0" : String(o.table || "\u2014"),
      room_name: isDel ? "\u10DB\u10D8\u10E2\u10D0\u10DC\u10D8\u10E1 \u10E1\u10D4\u10E0\u10D5\u10D8\u10E1\u10D8" : "\u10D3\u10D0\u10E0\u10D1\u10D0\u10D6\u10D8"
    };
    const items = orderItemsMap.get(o.id) || [];
    const itemsSummary = items.map((i) => `${i.name} (${i.count}x)`).join(", ");
    let delType = void 0;
    const pmtLower = pmtMethod.toLowerCase();
    if (pmtLower.includes("glovo")) delType = "GLOVO";
    else if (pmtLower.includes("bolt")) delType = "BOLT";
    else if (pmtLower.includes("wolt")) delType = "WOLT";
    else if (pmtLower.includes("taxi")) delType = "TAXI";
    else if (isDel) delType = "DELIVERY";
    if (tInfo.number && ["glovo", "bolt", "wolt", "taxi"].includes(tInfo.number.toLowerCase())) {
      delType = tInfo.number.toUpperCase();
    }
    if (options.deliveryType && options.deliveryType !== "all") {
      if (options.deliveryType === "dine_in" && (isDel || delType)) continue;
      if (options.deliveryType !== "dine_in") {
        const req = options.deliveryType.toLowerCase();
        const matches = delType && delType.toLowerCase().includes(req) || pmtLower.includes(req);
        if (!matches) continue;
      }
    }
    if (options.query) {
      const q = options.query.toLowerCase();
      const match = String(o.id).includes(q) || tInfo.number.toLowerCase().includes(q) || tInfo.room_name.toLowerCase().includes(q) || pmtMethod.toLowerCase().includes(q) || (userMap.get(o.creator) || "").toLowerCase().includes(q) || (delType || "").toLowerCase().includes(q) || itemsSummary.toLowerCase().includes(q);
      if (!match) continue;
    }
    filteredOrders.push({
      order_id: o.id,
      table_number: tInfo.number,
      room_name: tInfo.room_name,
      status: o.status,
      date: o.date,
      total_price: Number((parseFloat(o.price) || 0).toFixed(2)),
      prepayment: Number((parseFloat(o.prepayment) || 0).toFixed(2)),
      service_fee: Number((parseFloat(o.service_fee) || 0).toFixed(2)),
      discount_amount: Number((parseFloat(o.discount_amount) || 0).toFixed(2)),
      payment_method: pmtMethod || (isDel ? "DELIVERY" : "\u2014"),
      waiter_name: userMap.get(o.creator) || `\u10D7\u10D0\u10DC\u10D0\u10DB\u10E8\u10E0\u10DD\u10DB\u10D4\u10DA\u10D8 #${o.creator}`,
      delivery_type: delType,
      is_delivery: isDel || !!delType,
      guests_count: parseInt(o.count, 10) || 0,
      items_summary: itemsSummary,
      items
    });
  }
  return {
    tenant_name: tenant.name,
    total_found: filteredOrders.length,
    orders: filteredOrders
  };
}
async function getOrderDetails(orderId, tenantIdentifier) {
  const tenant = await resolveTenant(tenantIdentifier);
  const { data: order, error } = await supabase.from("orders").select("*").eq("tenant_id", tenant.id).eq("id", orderId).maybeSingle();
  if (error || !order) {
    throw new Error(`\u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D0 #${orderId} \u10D5\u10D4\u10E0 \u10DB\u10DD\u10D8\u10EB\u10D4\u10D1\u10DC\u10D0 \u10DD\u10D1\u10D8\u10D4\u10E5\u10E2\u10D6\u10D4 ${tenant.name}`);
  }
  const [{ data: itemsData }, { data: salaroData }, { data: userData }, { data: tableData }] = await Promise.all([
    supabase.from("order_list").select("id, item, count, price, message, type, date, items:item(name, type, price)").eq("orderID", orderId),
    supabase.from("salaro").select("*").eq("tenant_id", tenant.id).or(`order_id.eq.${orderId}${order.hash ? `,hash.eq.${order.hash}` : ""}`),
    order.creator ? supabase.from("users").select("name, username, phone").eq("id", order.creator).maybeSingle() : Promise.resolve({ data: null }),
    order.table ? supabase.from("tables").select("number, rid, rooms:rid(name)").eq("id", order.table).maybeSingle() : Promise.resolve({ data: null })
  ]);
  const items = (itemsData || []).map((it) => ({
    id: it.id,
    name: it.items?.name || `\u10DE\u10DD\u10D6\u10D8\u10EA\u10D8\u10D0 #${it.item}`,
    count: parseFloat(it.count) || 1,
    unit_price: parseFloat(it.price) || 0,
    total_price: Number(((parseFloat(it.count) || 1) * (parseFloat(it.price) || 0)).toFixed(2)),
    category_type: it.items?.type || it.type || "restourant",
    comment: it.message || ""
  }));
  const payments = (salaroData || []).map((s) => ({
    id: s.id,
    amount: parseFloat(s.price_in) || 0,
    change_back: parseFloat(s.back) || 0,
    discount: parseFloat(s.discount) || 0,
    payment_method: s.payment || s.payment_type || "cash",
    date: s.date,
    comment: s.comment || ""
  }));
  return {
    order_id: order.id,
    tenant_name: tenant.name,
    status: order.status,
    date: order.date,
    total_price: Number((parseFloat(order.price) || 0).toFixed(2)),
    prepayment: Number((parseFloat(order.prepayment) || 0).toFixed(2)),
    service_fee: Number((parseFloat(order.service_fee) || 0).toFixed(2)),
    discount_amount: Number((parseFloat(order.discount_amount) || 0).toFixed(2)),
    guests_count: parseInt(order.count, 10) || 0,
    table_number: tableData?.number || (order.is_delivery ? "\u10DB\u10D8\u10E2\u10D0\u10DC\u10D0" : String(order.table || "\u2014")),
    room_name: tableData?.rooms?.name || (order.is_delivery ? "\u10DB\u10D8\u10E2\u10D0\u10DC\u10D8\u10E1 \u10E1\u10D4\u10E0\u10D5\u10D8\u10E1\u10D8" : "\u10D3\u10D0\u10E0\u10D1\u10D0\u10D6\u10D8"),
    waiter_name: userData?.name || userData?.username || `\u10D7\u10D0\u10DC\u10D0\u10DB\u10E8\u10E0\u10DD\u10DB\u10D4\u10DA\u10D8 #${order.creator}`,
    is_delivery: !!order.is_delivery,
    delivery_type: payments.map((p) => p.payment_method).find((pm) => ["glovo", "bolt", "wolt", "taxi"].some((x) => pm.toLowerCase().includes(x))) || (order.is_delivery ? "DELIVERY" : void 0),
    items,
    payments
  };
}
async function getDeliveryOrders(tenantIdentifier, options = {}) {
  const tenant = await resolveTenant(tenantIdentifier);
  const limit = options.limit || 20;
  let webOrders = [];
  if (!options.platform || options.platform === "all" || options.platform === "web") {
    const { data } = await supabase.from("web_orders").select("*").eq("tenant_id", tenant.id).order("date", { ascending: false }).limit(limit);
    webOrders = data || [];
  }
  let platformDeliveries = [];
  const targetPlatform = options.platform && options.platform !== "all" && options.platform !== "web" ? options.platform : "";
  let salaroQuery = supabase.from("salaro").select("id, order_id, hash, payment, price_in, date, comment").eq("tenant_id", tenant.id);
  if (targetPlatform) {
    salaroQuery = salaroQuery.ilike("payment", `%${targetPlatform}%`);
  } else {
    salaroQuery = salaroQuery.or("payment.ilike.%glovo%,payment.ilike.%bolt%,payment.ilike.%wolt%,payment.ilike.%taxi%,payment.ilike.%delivery%");
  }
  const { data: salaroRows } = await salaroQuery.order("date", { ascending: false }).limit(limit);
  if (salaroRows && salaroRows.length > 0) {
    const orderIds = salaroRows.map((s) => s.order_id).filter(Boolean);
    const { data: ords } = orderIds.length > 0 ? await supabase.from("orders").select("id, status, price, date, is_delivery, table, creator").in("id", orderIds) : { data: [] };
    const { data: items } = orderIds.length > 0 ? await supabase.from("order_list").select("orderID, item, count, price, items:item(name)").in("orderID", orderIds) : { data: [] };
    const ordMap = /* @__PURE__ */ new Map();
    (ords || []).forEach((o) => ordMap.set(o.id, o));
    const itemMap = /* @__PURE__ */ new Map();
    (items || []).forEach((it) => {
      const arr = itemMap.get(it.orderID) || [];
      arr.push(`${it.items?.name || `\u10DE\u10DD\u10D6\u10D8\u10EA\u10D8\u10D0 #${it.item}`} (${it.count}x)`);
      itemMap.set(it.orderID, arr);
    });
    platformDeliveries = salaroRows.map((s) => {
      const linkedOrder = s.order_id ? ordMap.get(s.order_id) : null;
      const itSummary = s.order_id ? (itemMap.get(s.order_id) || []).join(", ") : "";
      return {
        order_id: s.order_id || null,
        salaro_id: s.id,
        platform: s.payment?.toUpperCase() || "DELIVERY",
        amount: parseFloat(s.price_in) || 0,
        date: s.date,
        status: linkedOrder?.status || "completed",
        items_summary: itSummary,
        comment: s.comment || ""
      };
    });
  }
  const posDeliveries = await searchOrders(tenant.id, {
    deliveryType: options.platform && options.platform !== "all" && options.platform !== "web" ? options.platform : "all",
    limit
  });
  return {
    tenant_name: tenant.name,
    web_orders_count: webOrders.length,
    platform_deliveries_count: platformDeliveries.length,
    pos_delivery_orders_count: posDeliveries.orders.filter((o) => o.is_delivery).length,
    platform_deliveries: platformDeliveries,
    web_orders: webOrders.map((w) => ({
      id: w.id,
      date: w.date,
      price: w.price,
      phone: w.phone,
      address: `${w.address || ""} ${w.entrance ? `\u10E1\u10D0\u10D3. ${w.entrance}` : ""} ${w.floor ? `\u10E1\u10D0\u10E0\u10D7. ${w.floor}` : ""} ${w.flat ? `\u10D1\u10D8\u10DC\u10D0 ${w.flat}` : ""}`.trim(),
      comment: w.comment,
      status: w.status === 0 ? "\u10D0\u10EE\u10D0\u10DA\u10D8 / NEW" : w.status === 1 ? "\u10DB\u10D8\u10E6\u10D4\u10D1\u10E3\u10DA\u10D8 / ACCEPTED" : "\u10D3\u10D0\u10E1\u10E0\u10E3\u10DA\u10D4\u10D1\u10E3\u10DA\u10D8 / COMPLETED"
    })),
    pos_delivery_orders: posDeliveries.orders
  };
}
var init_orderSearch = __esm({
  "src/analytics/orderSearch.ts"() {
    "use strict";
    init_db();
  }
});

// src/sse-server.ts
import express from "express";
import cors from "cors";
import { McpServer as McpServer2 } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

// src/tools.ts
init_db();
import { z } from "zod";

// src/analytics/todaySummary.ts
init_db();
async function getTodaySummary(tenantIdentifier, customDate) {
  const tenant = await resolveTenant(tenantIdentifier);
  const bounds = getDayBounds(customDate);
  const { data: openShiftData } = await supabase.from("shifts").select("id, shift_number, status, opened_at, initial_cash, final_cash, opened_by").eq("tenant_id", tenant.id).in("status", ["open", "OPEN"]).order("id", { ascending: false }).limit(1);
  const activeShift = openShiftData && openShiftData.length > 0 ? openShiftData[0] : null;
  const isShiftOpen = !!activeShift;
  let cashierName = "Unknown";
  if (activeShift?.opened_by) {
    const { data: u } = await supabase.from("users").select("name, username").eq("id", activeShift.opened_by).maybeSingle();
    if (u) cashierName = u.name || u.username;
  }
  let shiftCashSales = 0;
  let shiftCardSales = 0;
  let shiftTransferSales = 0;
  let shiftOtherSales = 0;
  let shiftDiscounts = 0;
  if (activeShift) {
    const shiftSalaro = await fetchAllRows(async (from, to) => {
      return supabase.from("salaro").select("id, price_in, back, discount, payment, payment_type").eq("tenant_id", tenant.id).or(`shift_id.eq.${activeShift.id},date.gte.${activeShift.opened_at}`).range(from, to);
    });
    shiftSalaro.forEach((s) => {
      const pIn = parseFloat(s.price_in) || 0;
      const back = parseFloat(s.back) || 0;
      const disc = parseFloat(s.discount) || 0;
      const net = Math.max(0, pIn - back);
      const p = (s.payment_type || s.payment || "").toLowerCase();
      shiftDiscounts += disc;
      if (p.includes("cash") || p.includes("\u10DC\u10D0\u10E6\u10D3\u10D8")) {
        shiftCashSales += net;
      } else if (p.includes("card") || p.includes("\u10D1\u10D0\u10E0\u10D0\u10D7") || p.includes("terminal")) {
        shiftCardSales += net;
      } else if (p.includes("transfer") || p.includes("\u10D2\u10D0\u10D3\u10D0\u10E0\u10D8\u10EA\u10EE\u10D5")) {
        shiftTransferSales += net;
      } else {
        shiftOtherSales += net;
      }
    });
  }
  let openOrdersQuery = supabase.from("orders").select("id, price, count, guests, prepayment, status, date, shift_id").eq("tenant_id", tenant.id).in("status", ["open", "precheck", "OPEN", "PRECHECK"]);
  if (activeShift) {
    openOrdersQuery = openOrdersQuery.or(`shift_id.eq.${activeShift.id},date.gte.${activeShift.opened_at}`);
  } else {
    openOrdersQuery = openOrdersQuery.gte("date", bounds.start);
  }
  const { data: openOrdersData } = await openOrdersQuery;
  const activeOpenOrders = openOrdersData || [];
  const openSum = activeOpenOrders.reduce((s, o) => s + (parseFloat(o.price) || 0), 0);
  const openPrepayments = activeOpenOrders.reduce((s, o) => s + (parseFloat(o.prepayment) || 0), 0);
  const queryStart = !customDate && activeShift ? activeShift.opened_at : bounds.start;
  const queryEnd = !customDate && activeShift ? (/* @__PURE__ */ new Date()).toISOString() : bounds.end;
  const orders = await fetchAllRows(async (from, to) => {
    return supabase.from("orders").select("id, price, status, count, guests, discount, discount_amount, date, shift_id").eq("tenant_id", tenant.id).gte("date", queryStart).lte("date", queryEnd).range(from, to);
  });
  const isClosedStatus = (st) => {
    const s = (st || "").toLowerCase();
    return s === "completed" || s === "closed" || s === "paid";
  };
  const closedOrders = orders.filter((o) => isClosedStatus(o.status));
  const grossTotal = closedOrders.reduce((acc, o) => acc + (parseFloat(o.price) || 0), 0);
  const totalGuests = closedOrders.reduce((acc, o) => {
    const g = parseInt(o.guests, 10) || parseInt(o.count, 10) || 0;
    return acc + g;
  }, 0);
  const orderDiscountsTotal = closedOrders.reduce((acc, o) => {
    const d = parseFloat(o.discount_amount) || parseFloat(o.discount) || 0;
    return acc + d;
  }, 0);
  const salaro = await fetchAllRows(async (from, to) => {
    return supabase.from("salaro").select("id, price_in, price_out, back, discount, payment, payment_type, date, shift_id").eq("tenant_id", tenant.id).gte("date", queryStart).lte("date", queryEnd).range(from, to);
  });
  let salaroDiscounts = 0;
  let cashSalesTotal = 0;
  let cardSalesTotal = 0;
  let transferSalesTotal = 0;
  let otherPaymentsTotal = 0;
  let cashInPhysical = 0;
  let cashOutPhysical = 0;
  salaro.forEach((s) => {
    const pIn = parseFloat(s.price_in) || 0;
    const pOut = parseFloat(s.price_out) || 0;
    const backAmt = parseFloat(s.back) || 0;
    const discAmt = parseFloat(s.discount) || 0;
    const pType = (s.payment_type || s.payment || "cash").toLowerCase();
    salaroDiscounts += discAmt;
    cashOutPhysical += pOut;
    const netAmount = Math.max(0, pIn - backAmt);
    if (pType.includes("cash") || pType.includes("\u10DC\u10D0\u10E6\u10D3\u10D8")) {
      cashSalesTotal += netAmount;
      cashInPhysical += netAmount;
    } else if (pType.includes("card") || pType.includes("\u10D1\u10D0\u10E0\u10D0\u10D7") || pType.includes("terminal")) {
      cardSalesTotal += netAmount;
    } else if (pType.includes("transfer") || pType.includes("\u10D2\u10D0\u10D3\u10D0\u10E0\u10D8\u10EA\u10EE\u10D5") || pType.includes("bank")) {
      transferSalesTotal += netAmount;
    } else {
      otherPaymentsTotal += netAmount;
    }
  });
  const totalDiscounts = Math.max(orderDiscountsTotal, salaroDiscounts);
  const momwData = await fetchAllRows(async (from, to) => {
    return supabase.from("momw_gadaxdebi").select("id, price, date").eq("tenant_id", tenant.id).gte("date", queryStart).lte("date", queryEnd).range(from, to);
  });
  const supplierPaymentsTotal = momwData.reduce((acc, m) => acc + (parseFloat(m.price) || 0), 0);
  let writeOffsTotal = 0;
  try {
    const { data: writeOffsData } = await supabase.from("writeoff_items").select("price, count").eq("tenant_id", tenant.id).gte("created_at", queryStart).lte("created_at", queryEnd);
    if (writeOffsData) {
      writeOffsTotal = writeOffsData.reduce((acc, w) => acc + (parseFloat(w.price) || 0) * (parseFloat(w.count) || 1), 0);
    }
  } catch {
  }
  const initialCash = activeShift ? parseFloat(activeShift.initial_cash) || 0 : 0;
  const totalExpenses = supplierPaymentsTotal + cashOutPhysical + writeOffsTotal;
  const paymentsSum = cashSalesTotal + cardSalesTotal + transferSalesTotal + otherPaymentsTotal;
  const netRevenue = paymentsSum > 0 ? paymentsSum : grossTotal;
  const effectiveChecksCount = closedOrders.length > 0 ? closedOrders.length : salaro.filter((s) => (parseFloat(s.price_in) || 0) > 0).length;
  const avgCheck = effectiveChecksCount > 0 ? Number((netRevenue / effectiveChecksCount).toFixed(2)) : 0;
  const avgPerGuest = totalGuests > 0 ? Number((netRevenue / totalGuests).toFixed(2)) : 0;
  const expectedCashInDrawer = initialCash + cashSalesTotal - cashOutPhysical;
  return {
    date: bounds.dateStr,
    tenant,
    shift_status: {
      is_shift_open: isShiftOpen,
      shift_id: activeShift?.id,
      shift_number: activeShift?.shift_number || 1,
      opened_at: activeShift?.opened_at,
      opened_by_name: cashierName
    },
    revenue: {
      gross_total: Number(grossTotal.toFixed(2)),
      discounts_total: Number(totalDiscounts.toFixed(2)),
      net_revenue: Number(netRevenue.toFixed(2)),
      currency: tenant.currency || "GEL"
    },
    payments_breakdown: {
      cash: Number(cashSalesTotal.toFixed(2)),
      card: Number(cardSalesTotal.toFixed(2)),
      bank_transfer: Number(transferSalesTotal.toFixed(2)),
      other: Number(otherPaymentsTotal.toFixed(2))
    },
    orders_metrics: {
      total_orders_count: orders.length,
      closed_orders_count: closedOrders.length,
      active_open_orders_count: activeOpenOrders.length,
      average_check: avgCheck,
      total_guests_count: totalGuests,
      average_per_guest: avgPerGuest
    },
    expenses: {
      total_expenses: Number(totalExpenses.toFixed(2)),
      supplier_payments: Number(supplierPaymentsTotal.toFixed(2)),
      cash_payouts: Number(cashOutPhysical.toFixed(2)),
      write_offs: Number(writeOffsTotal.toFixed(2))
    },
    cash_desk: {
      initial_cash: Number(initialCash.toFixed(2)),
      cash_in: Number(cashInPhysical.toFixed(2)),
      cash_out: Number(cashOutPhysical.toFixed(2)),
      expected_cash_in_drawer: Number(expectedCashInDrawer.toFixed(2))
    },
    financial_balance: {
      net_sales: Number(netRevenue.toFixed(2)),
      total_expenses: Number(totalExpenses.toFixed(2)),
      net_profit_or_loss: Number((netRevenue - totalExpenses).toFixed(2))
    },
    active_shift_summary: activeShift ? {
      is_shift_open: true,
      shift_id: activeShift.id,
      shift_number: activeShift.shift_number || 1,
      opened_at: activeShift.opened_at,
      cashier_name: cashierName,
      initial_cash: initialCash,
      cash_sales: Number(shiftCashSales.toFixed(2)),
      card_sales: Number(shiftCardSales.toFixed(2)),
      transfer_sales: Number(shiftTransferSales.toFixed(2)),
      total_sales: Number((shiftCashSales + shiftCardSales + shiftTransferSales + shiftOtherSales).toFixed(2)),
      discounts: Number(shiftDiscounts.toFixed(2)),
      open_orders_sum: Number(openSum.toFixed(2)),
      open_orders_count: activeOpenOrders.length,
      deposit_sum: Number(openPrepayments.toFixed(2)),
      expected_cash_drawer: Number((initialCash + shiftCashSales).toFixed(2))
    } : void 0
  };
}

// src/analytics/salesAnalytics.ts
init_db();
async function getSalesAnalytics(tenantIdentifier, period = "today", customStart, customEnd) {
  const tenant = await resolveTenant(tenantIdentifier);
  const bounds = getPeriodBounds(period, customStart, customEnd);
  const [orders, roomsData, tablesData] = await Promise.all([
    fetchAllRows(async (from, to) => {
      return supabase.from("orders").select("id, hash, price, status, date, table, is_delivery, discount, discount_amount, guests, count").eq("tenant_id", tenant.id).in("status", ["closed", "completed", "paid"]).gte("date", bounds.start).lte("date", bounds.end).range(from, to);
    }),
    supabase.from("rooms").select("id, name").eq("tenant_id", tenant.id),
    supabase.from("tables").select("id, number, rid").eq("tenant_id", tenant.id)
  ]);
  const rooms = roomsData.data || [];
  const tables = tablesData.data || [];
  const roomMap = /* @__PURE__ */ new Map();
  rooms.forEach((r) => roomMap.set(r.id, r.name));
  const tableToRoomMap = /* @__PURE__ */ new Map();
  tables.forEach((t) => {
    const rName = roomMap.get(t.rid) || `\u10D3\u10D0\u10E0\u10D1\u10D0\u10D6\u10D8 #${t.rid}`;
    tableToRoomMap.set(t.id, { room_id: t.rid, room_name: rName });
    tableToRoomMap.set(t.number, { room_id: t.rid, room_name: rName });
  });
  const { data: deliverySalaro } = await supabase.from("salaro").select("order_id, payment, discount").eq("tenant_id", tenant.id).gte("date", bounds.start).lte("date", bounds.end).or("payment.ilike.%glovo%,payment.ilike.%bolt%,payment.ilike.%wolt%,payment.ilike.%taxi%,payment.ilike.%delivery%");
  const orderPaymentMap = /* @__PURE__ */ new Map();
  let salaroDiscounts = 0;
  (deliverySalaro || []).forEach((s) => {
    if (s.order_id && s.payment) {
      orderPaymentMap.set(s.order_id, s.payment);
    }
    salaroDiscounts += parseFloat(s.discount) || 0;
  });
  let totalRevenue = 0;
  let totalOrderDiscounts = 0;
  let totalGuests = 0;
  const hourlyBuckets = /* @__PURE__ */ new Map();
  for (let h = 0; h < 24; h++) {
    hourlyBuckets.set(h, { revenue: 0, count: 0 });
  }
  const roomSalesMap = /* @__PURE__ */ new Map();
  let deliveryRevenue = 0;
  let glovoRevenue = 0;
  let boltRevenue = 0;
  let woltRevenue = 0;
  let taxiRevenue = 0;
  let dineInRevenue = 0;
  orders.forEach((o) => {
    const price = parseFloat(o.price) || 0;
    const disc = parseFloat(o.discount_amount) || parseFloat(o.discount) || 0;
    const guests = parseInt(o.guests, 10) || parseInt(o.count, 10) || 0;
    totalRevenue += price;
    totalOrderDiscounts += disc;
    totalGuests += guests;
    const orderDate = new Date(o.date);
    const hour = orderDate.getHours();
    const hData = hourlyBuckets.get(hour) || { revenue: 0, count: 0 };
    hData.revenue += price;
    hData.count += 1;
    hourlyBuckets.set(hour, hData);
    const isDel = !!o.is_delivery;
    const pmt = (orderPaymentMap.get(o.id) || "").toLowerCase();
    const isGlovo = pmt.includes("glovo");
    const isBolt = pmt.includes("bolt");
    const isWolt = pmt.includes("wolt");
    const isTaxi = pmt.includes("taxi");
    if (isDel || isGlovo || isBolt || isWolt || isTaxi) {
      deliveryRevenue += price;
      if (isGlovo) glovoRevenue += price;
      else if (isBolt) boltRevenue += price;
      else if (isWolt) woltRevenue += price;
      else if (isTaxi) taxiRevenue += price;
    } else {
      dineInRevenue += price;
    }
    const tInfo = tableToRoomMap.get(o.table) || { room_id: 0, room_name: isDel ? "\u10DB\u10D8\u10E2\u10D0\u10DC\u10D0 / Delivery" : "\u10E1\u10EE\u10D5\u10D0 / \u10D3\u10D0\u10E0\u10D1\u10D0\u10D6\u10D8" };
    const rKey = String(tInfo.room_id);
    const rData = roomSalesMap.get(rKey) || {
      room_id: tInfo.room_id,
      room_name: tInfo.room_name,
      revenue: 0,
      count: 0
    };
    rData.revenue += price;
    rData.count += 1;
    roomSalesMap.set(rKey, rData);
  });
  const ordersCount = orders.length;
  const averageCheck = ordersCount > 0 ? Number((totalRevenue / ordersCount).toFixed(2)) : 0;
  const totalDiscounts = Math.max(totalOrderDiscounts, salaroDiscounts);
  const hourlySales = Array.from(hourlyBuckets.entries()).map(([hour, val]) => ({
    hour,
    hour_label: `${String(hour).padStart(2, "0")}:00 - ${String(hour).padStart(2, "0")}:59`,
    revenue: Number(val.revenue.toFixed(2)),
    orders_count: val.count
  }));
  const hallsSales = Array.from(roomSalesMap.values()).map((r) => ({
    room_id: r.room_id,
    room_name: r.room_name,
    revenue: Number(r.revenue.toFixed(2)),
    orders_count: r.count
  })).sort((a, b) => b.revenue - a.revenue);
  return {
    period_label: bounds.label,
    start_date: bounds.start,
    end_date: bounds.end,
    total_revenue: Number(totalRevenue.toFixed(2)),
    orders_count: ordersCount,
    average_check: averageCheck,
    total_discounts: Number(totalDiscounts.toFixed(2)),
    delivery_breakdown: {
      dine_in_revenue: Number(dineInRevenue.toFixed(2)),
      delivery_revenue: Number(deliveryRevenue.toFixed(2)),
      glovo_revenue: Number(glovoRevenue.toFixed(2)),
      bolt_revenue: Number(boltRevenue.toFixed(2)),
      taxi_revenue: Number(taxiRevenue.toFixed(2))
    },
    hourly_sales: hourlySales,
    halls_sales: hallsSales
  };
}

// src/analytics/expensesAnalytics.ts
init_db();
async function getExpensesAnalytics(tenantIdentifier, period = "today", customStart, customEnd) {
  const tenant = await resolveTenant(tenantIdentifier);
  const bounds = getPeriodBounds(period, customStart, customEnd);
  const momwData = await fetchAllRows(async (from, to) => {
    return supabase.from("momw_gadaxdebi").select("id, dealer, date, price, creator").eq("tenant_id", tenant.id).gte("date", bounds.start).lte("date", bounds.end).order("date", { ascending: false }).range(from, to);
  });
  const dealerIds = [...new Set(momwData.map((m) => m.dealer).filter(Boolean))];
  const { data: dealersData } = dealerIds.length > 0 ? await supabase.from("momwodeblebi").select("id, name").in("id", dealerIds) : { data: [] };
  const dealerNameMap = /* @__PURE__ */ new Map();
  (dealersData || []).forEach((d) => dealerNameMap.set(d.id, d.name));
  const salaroData = await fetchAllRows(async (from, to) => {
    return supabase.from("salaro").select("id, comment, price_out, date, creator").eq("tenant_id", tenant.id).gt("price_out", 0).gte("date", bounds.start).lte("date", bounds.end).order("date", { ascending: false }).range(from, to);
  });
  const creatorIds = [...new Set(salaroData.map((s) => s.creator).filter(Boolean))];
  const { data: creatorsData } = creatorIds.length > 0 ? await supabase.from("users").select("id, name, username").in("id", creatorIds) : { data: [] };
  const userNameMap = /* @__PURE__ */ new Map();
  (creatorsData || []).forEach((u) => userNameMap.set(u.id, u.name || u.username));
  let totalWriteOffs = 0;
  const writeoffItems = [];
  try {
    const { data: woData } = await supabase.from("writeoff_items").select("id, name, price, count, created_at").eq("tenant_id", tenant.id).gte("created_at", bounds.start).lte("created_at", bounds.end);
    (woData || []).forEach((w) => {
      const amt = (parseFloat(w.price) || 0) * (parseFloat(w.count) || 1);
      totalWriteOffs += amt;
      writeoffItems.push({
        id: w.id,
        type: "WRITEOFF",
        title: w.name || "\u10E9\u10D0\u10DB\u10DD\u10EC\u10D4\u10E0\u10D0 / Write-off",
        category: "\u10E1\u10D0\u10E1\u10D0\u10E5\u10DD\u10DC\u10DA\u10DD \u10E9\u10D0\u10DB\u10DD\u10EC\u10D4\u10E0\u10D0",
        amount: Number(amt.toFixed(2)),
        date: w.created_at
      });
    });
  } catch {
  }
  const supplierMap = /* @__PURE__ */ new Map();
  let totalSupplierPayments = 0;
  const expenseItems = [];
  (momwData || []).forEach((m) => {
    const amt = parseFloat(m.price) || 0;
    totalSupplierPayments += amt;
    const supName = dealerNameMap.get(m.dealer) || `\u10DB\u10DD\u10DB\u10EC\u10DD\u10D3\u10D4\u10D1\u10D4\u10DA\u10D8 #${m.dealer}`;
    const supKey = String(m.dealer);
    const s = supplierMap.get(supKey) || { id: m.dealer, name: supName, total: 0, count: 0 };
    s.total += amt;
    s.count += 1;
    supplierMap.set(supKey, s);
    expenseItems.push({
      id: m.id,
      type: "SUPPLIER_PAYMENT",
      title: supName,
      category: "\u10DB\u10DD\u10DB\u10EC\u10DD\u10D3\u10D4\u10D1\u10DA\u10D8\u10E1 \u10D2\u10D0\u10D3\u10D0\u10EE\u10D3\u10D0 / \u041F\u043E\u0441\u0442\u0430\u0432\u0449\u0438\u043A",
      amount: Number(amt.toFixed(2)),
      date: m.date,
      creator: userNameMap.get(m.creator) || String(m.creator || "")
    });
  });
  let totalCashOut = 0;
  (salaroData || []).forEach((s) => {
    const amt = parseFloat(s.price_out) || 0;
    totalCashOut += amt;
    expenseItems.push({
      id: s.id,
      type: "CASH_OUT",
      title: s.comment || "\u10E1\u10D0\u10DA\u10D0\u10E0\u10DD\u10D3\u10D0\u10DC \u10D2\u10D0\u10EA\u10D4\u10DB\u10D0 / \u0418\u0437\u044A\u044F\u0442\u0438\u0435",
      category: "\u10E1\u10D0\u10DA\u10D0\u10E0\u10DD\u10E1 \u10EE\u10D0\u10E0\u10EF\u10D8 / \u041A\u0430\u0441\u0441\u0430",
      amount: Number(amt.toFixed(2)),
      date: s.date,
      creator: userNameMap.get(s.creator) || String(s.creator || "")
    });
  });
  expenseItems.push(...writeoffItems);
  const totalExpenses = totalSupplierPayments + totalCashOut + totalWriteOffs;
  const suppliersSummary = Array.from(supplierMap.values()).map((s) => ({
    supplier_id: s.id,
    supplier_name: s.name,
    total_paid: Number(s.total.toFixed(2)),
    payments_count: s.count
  })).sort((a, b) => b.total_paid - a.total_paid);
  expenseItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return {
    period_label: bounds.label,
    start_date: bounds.start,
    end_date: bounds.end,
    total_expenses: Number(totalExpenses.toFixed(2)),
    currency: tenant.currency || "GEL",
    breakdown: {
      supplier_payments: Number(totalSupplierPayments.toFixed(2)),
      cash_out_payouts: Number(totalCashOut.toFixed(2)),
      write_offs: Number(totalWriteOffs.toFixed(2))
    },
    suppliers_summary: suppliersSummary,
    recent_expenses: expenseItems.slice(0, 30)
  };
}

// src/analytics/topItems.ts
init_db();
async function getTopSellingItems(tenantIdentifier, period = "today", limit = 20, sortBy = "revenue", customStart, customEnd) {
  const tenant = await resolveTenant(tenantIdentifier);
  const bounds = getPeriodBounds(period, customStart, customEnd);
  const orderListData = await fetchAllRows(async (from, to) => {
    return supabase.from("order_list").select("id, item, count, price, type, date, deleted").eq("tenant_id", tenant.id).eq("deleted", false).gte("date", bounds.start).lte("date", bounds.end).range(from, to);
  });
  const [{ data: categoriesData }, itemsData] = await Promise.all([
    supabase.from("categories").select("id, name, type"),
    fetchAllRows(async (from, to) => {
      return supabase.from("items").select("id, name, type, category").eq("tenant_id", tenant.id).range(from, to);
    })
  ]);
  const catMap = /* @__PURE__ */ new Map();
  (categoriesData || []).forEach((c) => {
    catMap.set(c.id, { name: c.name.trim(), type: c.type || "restourant" });
  });
  const itemsMap = /* @__PURE__ */ new Map();
  itemsData.forEach((it) => {
    const catIds = (it.category || "").split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
    let detectedType = it.type || "restourant";
    let catName = "";
    for (const cId of catIds) {
      const c = catMap.get(cId);
      if (c) {
        catName = c.name;
        if (c.type === "hookah" || c.name.toLowerCase().includes("hookah") || c.name.includes("\u10F0\u10E3\u10D9\u10D0")) {
          detectedType = "hookah";
          break;
        }
        if (c.type === "bar" || c.name.toLowerCase().includes("bar") || c.name.includes("\u10D1\u10D0\u10E0\u10D8") || c.name.includes("\u10D9\u10DD\u10E5\u10E2\u10D4\u10D8\u10DA") || c.name.includes("\u10D9\u10DD\u10DC\u10D8\u10D0\u10D9")) {
          detectedType = "bar";
        }
      }
    }
    const nameLower = (it.name || "").toLowerCase();
    if (nameLower.includes("hookah") || nameLower.includes("\u10F0\u10E3\u10D9\u10D0") || nameLower.includes("\u10D9\u10D0\u10DA\u10D8\u10D0\u10DC")) {
      detectedType = "hookah";
    } else if (nameLower.includes("gin") || nameLower.includes("tonic") || nameLower.includes("vodka") || nameLower.includes("whiskey") || nameLower.includes("cocktail") || nameLower.includes("wine") || nameLower.includes("beer") || nameLower.includes("corona") || nameLower.includes("red bull") || nameLower.includes("juice") || nameLower.includes("cola") || nameLower.includes("water")) {
      detectedType = "bar";
    }
    itemsMap.set(it.id, {
      name: it.name,
      type: detectedType,
      categoryName: catName
    });
  });
  const aggregateMap = /* @__PURE__ */ new Map();
  let kitchenRevenue = 0;
  let kitchenCount = 0;
  let barRevenue = 0;
  let barCount = 0;
  let hookahRevenue = 0;
  let hookahCount = 0;
  let otherRevenue = 0;
  let otherCount = 0;
  let totalItemsSold = 0;
  let totalSalesAmount = 0;
  orderListData.forEach((row) => {
    const itId = row.item;
    const count = parseFloat(row.count) || 0;
    const price = parseFloat(row.price) || 0;
    const revenue = count * price;
    totalItemsSold += count;
    totalSalesAmount += revenue;
    const meta = itemsMap.get(itId) || {
      name: `\u10DE\u10DD\u10D6\u10D8\u10EA\u10D8\u10D0 #${itId}`,
      type: row.type || "restourant",
      categoryName: ""
    };
    const finalType = meta.type.toLowerCase();
    if (finalType.includes("hookah")) {
      hookahRevenue += revenue;
      hookahCount += count;
    } else if (finalType.includes("bar")) {
      barRevenue += revenue;
      barCount += count;
    } else if (finalType.includes("restourant") || finalType.includes("kitchen")) {
      kitchenRevenue += revenue;
      kitchenCount += count;
    } else {
      otherRevenue += revenue;
      otherCount += count;
    }
    const existing = aggregateMap.get(itId) || {
      item_id: itId,
      item_name: meta.name,
      type: meta.type,
      quantity: 0,
      revenue: 0
    };
    existing.quantity += count;
    existing.revenue += revenue;
    aggregateMap.set(itId, existing);
  });
  const itemsList = Array.from(aggregateMap.values()).map((it) => ({
    item_id: it.item_id,
    item_name: it.item_name,
    type: it.type,
    quantity_sold: Number(it.quantity.toFixed(2)),
    total_revenue: Number(it.revenue.toFixed(2)),
    average_price: it.quantity > 0 ? Number((it.revenue / it.quantity).toFixed(2)) : 0
  }));
  if (sortBy === "quantity") {
    itemsList.sort((a, b) => b.quantity_sold - a.quantity_sold);
  } else {
    itemsList.sort((a, b) => b.total_revenue - a.total_revenue);
  }
  return {
    period_label: bounds.label,
    total_items_sold: Number(totalItemsSold.toFixed(2)),
    total_sales_amount: Number(totalSalesAmount.toFixed(2)),
    items: itemsList.slice(0, limit),
    category_breakdown: {
      kitchen: { revenue: Number(kitchenRevenue.toFixed(2)), count: Number(kitchenCount.toFixed(2)) },
      bar: { revenue: Number(barRevenue.toFixed(2)), count: Number(barCount.toFixed(2)) },
      hookah: { revenue: Number(hookahRevenue.toFixed(2)), count: Number(hookahCount.toFixed(2)) },
      other: { revenue: Number(otherRevenue.toFixed(2)), count: Number(otherCount.toFixed(2)) }
    }
  };
}

// src/analytics/shiftAnalytics.ts
init_db();
async function getShiftAnalytics(tenantIdentifier, shiftId) {
  const tenant = await resolveTenant(tenantIdentifier);
  let shift = null;
  if (shiftId) {
    const { data } = await supabase.from("shifts").select("*").eq("tenant_id", tenant.id).eq("id", shiftId).maybeSingle();
    shift = data;
  } else {
    const { data: openShift } = await supabase.from("shifts").select("*").eq("tenant_id", tenant.id).in("status", ["open", "OPEN"]).order("id", { ascending: false }).limit(1).maybeSingle();
    if (openShift) {
      shift = openShift;
    } else {
      const { data: latestShift } = await supabase.from("shifts").select("*").eq("tenant_id", tenant.id).order("id", { ascending: false }).limit(1).maybeSingle();
      shift = latestShift;
    }
  }
  if (!shift) {
    throw new Error(`\u10EA\u10D5\u10DA\u10D0 \u10D5\u10D4\u10E0 \u10DB\u10DD\u10D8\u10EB\u10D4\u10D1\u10DC\u10D0 (Shift not found) for tenant ${tenant.name}`);
  }
  const targetShiftId = shift.id;
  let openedByName = "\u10DB\u10DD\u10DA\u10D0\u10E0\u10D4 / Cashier";
  if (shift.opened_by) {
    const { data: u } = await supabase.from("users").select("name, username").eq("id", shift.opened_by).maybeSingle();
    if (u) openedByName = u.name || u.username;
  }
  let closedByName = void 0;
  if (shift.closed_by) {
    const { data: u } = await supabase.from("users").select("name, username").eq("id", shift.closed_by).maybeSingle();
    if (u) closedByName = u.name || u.username;
  }
  const salaroData = await fetchAllRows(async (from, to) => {
    return supabase.from("salaro").select("id, price_in, price_out, back, discount, payment, payment_type, date").eq("tenant_id", tenant.id).or(`shift_id.eq.${targetShiftId},date.gte.${shift.opened_at}${shift.closed_at ? `,date.lte.${shift.closed_at}` : ""}`).range(from, to);
  });
  const allOrders = await fetchAllRows(async (from, to) => {
    return supabase.from("orders").select("id, price, count, guests, status, prepayment, discount, discount_amount").eq("tenant_id", tenant.id).or(`shift_id.eq.${targetShiftId},date.gte.${shift.opened_at}${shift.closed_at ? `,date.lte.${shift.closed_at}` : ""}`).range(from, to);
  });
  const closedOrders = allOrders.filter((o) => o.status === "completed" || o.status === "closed" || o.status === "paid");
  const openOrders = allOrders.filter((o) => o.status === "open" || o.status === "precheck");
  const openSum = openOrders.reduce((s, o) => s + (parseFloat(o.price) || 0), 0);
  const depositSum = openOrders.reduce((s, o) => s + (parseFloat(o.prepayment) || 0), 0);
  let cashSales = 0;
  let cardSales = 0;
  let transferSales = 0;
  let salaroDiscounts = 0;
  let cashDrawerIn = 0;
  let cashDrawerOut = 0;
  salaroData.forEach((s) => {
    const pIn = parseFloat(s.price_in) || 0;
    const pOut = parseFloat(s.price_out) || 0;
    const backAmt = parseFloat(s.back) || 0;
    const discAmt = parseFloat(s.discount) || 0;
    const pType = (s.payment_type || s.payment || "cash").toLowerCase();
    salaroDiscounts += discAmt;
    cashDrawerOut += pOut;
    const netAmt = Math.max(0, pIn - backAmt);
    if (pType.includes("cash") || pType.includes("\u10DC\u10D0\u10E6\u10D3\u10D8")) {
      cashSales += netAmt;
      cashDrawerIn += netAmt;
    } else if (pType.includes("card") || pType.includes("\u10D1\u10D0\u10E0\u10D0\u10D7") || pType.includes("terminal")) {
      cardSales += netAmt;
    } else if (pType.includes("transfer") || pType.includes("\u10D2\u10D0\u10D3\u10D0\u10E0\u10D8\u10EA\u10EE\u10D5")) {
      transferSales += netAmt;
    }
  });
  const orderDiscounts = closedOrders.reduce((acc, o) => acc + (parseFloat(o.discount_amount) || parseFloat(o.discount) || 0), 0);
  const totalDiscounts = Math.max(salaroDiscounts, orderDiscounts);
  const initialCash = parseFloat(shift.initial_cash) || 0;
  const finalCash = shift.final_cash !== null && shift.final_cash !== void 0 ? parseFloat(shift.final_cash) : void 0;
  const totalSales = cashSales + cardSales + transferSales;
  const expectedCashDrawer = initialCash + cashSales - cashDrawerOut;
  const discrepancy = finalCash !== void 0 && shift.status === "closed" ? finalCash - expectedCashDrawer : void 0;
  return {
    tenant_name: tenant.name,
    shift_id: shift.id,
    shift_number: shift.shift_number || 1,
    status: (shift.status || "open").toLowerCase() === "open" ? "open" : "closed",
    opened_at: shift.opened_at,
    closed_at: shift.closed_at,
    opened_by_name: openedByName,
    closed_by_name: closedByName,
    initial_cash: Number(initialCash.toFixed(2)),
    final_cash: finalCash !== void 0 ? Number(finalCash.toFixed(2)) : void 0,
    financials: {
      total_sales: Number(totalSales.toFixed(2)),
      cash_sales: Number(cashSales.toFixed(2)),
      card_sales: Number(cardSales.toFixed(2)),
      transfer_sales: Number(transferSales.toFixed(2)),
      discounts: Number(totalDiscounts.toFixed(2)),
      cash_drawer_in: Number(cashDrawerIn.toFixed(2)),
      cash_drawer_out: Number(cashDrawerOut.toFixed(2)),
      expected_cash_drawer: Number(expectedCashDrawer.toFixed(2)),
      actual_cash_drawer: finalCash !== void 0 ? Number(finalCash.toFixed(2)) : void 0,
      discrepancy: discrepancy !== void 0 ? Number(discrepancy.toFixed(2)) : void 0,
      open_orders_sum: Number(openSum.toFixed(2)),
      open_orders_count: openOrders.length,
      deposit_sum: Number(depositSum.toFixed(2))
    },
    orders_count: closedOrders.length > 0 ? closedOrders.length : salaroData.length || 0
  };
}

// src/analytics/inventoryAlerts.ts
init_db();
async function getInventoryAlerts(tenantIdentifier) {
  const tenant = await resolveTenant(tenantIdentifier);
  const { data: productsData, error } = await supabase.from("products").select("id, name, count, need, ert, code").eq("tenant_id", tenant.id);
  if (error) {
    console.error("Error fetching inventory products:", error);
  }
  const products = productsData || [];
  const alerts = [];
  let criticalCount = 0;
  let lowCount = 0;
  products.forEach((p) => {
    const stock = parseFloat(p.count) || 0;
    const need = parseFloat(p.need) || 0;
    if (stock <= 0 || need > 0 && stock <= need) {
      const isCritical = stock <= 0;
      if (isCritical) criticalCount++;
      else lowCount++;
      alerts.push({
        product_id: p.id,
        name: p.name,
        code: p.code,
        current_stock: Number(stock.toFixed(3)),
        minimum_required: Number(need.toFixed(3)),
        deficit: Number(Math.max(0, need - stock).toFixed(3)),
        unit: p.ert ? `Unit #${p.ert}` : "\u10EA\u10D0\u10DA\u10D8/\u10D9\u10D2",
        status: isCritical ? "CRITICAL_ZERO" : "LOW_STOCK"
      });
    }
  });
  alerts.sort((a, b) => {
    if (a.status === "CRITICAL_ZERO" && b.status !== "CRITICAL_ZERO") return -1;
    if (a.status !== "CRITICAL_ZERO" && b.status === "CRITICAL_ZERO") return 1;
    return b.deficit - a.deficit;
  });
  return {
    tenant_name: tenant.name,
    total_alerts: alerts.length,
    critical_zero_stock_count: criticalCount,
    low_stock_count: lowCount,
    alerts: alerts.slice(0, 50)
  };
}

// src/analytics/activeOrders.ts
init_db();
async function getActiveOrders(tenantIdentifier) {
  const tenant = await resolveTenant(tenantIdentifier);
  const { data: openShiftData } = await supabase.from("shifts").select("id, opened_at").eq("tenant_id", tenant.id).in("status", ["open", "OPEN"]).order("id", { ascending: false }).limit(1);
  const activeShift = openShiftData && openShiftData.length > 0 ? openShiftData[0] : null;
  const allOpenOrders = await fetchAllRows(async (from, to) => {
    return supabase.from("orders").select("id, price, status, count, guests, creator, table, date, is_delivery, prepayment, shift_id").eq("tenant_id", tenant.id).in("status", ["open", "precheck", "OPEN", "PRECHECK"]).order("date", { ascending: false }).range(from, to);
  });
  const now = /* @__PURE__ */ new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1e3);
  const liveOrders = allOpenOrders.filter((o) => {
    if (activeShift) {
      return o.shift_id && o.shift_id === activeShift.id || new Date(o.date) >= new Date(activeShift.opened_at);
    }
    return new Date(o.date) >= oneDayAgo;
  });
  const staleOrdersCount = allOpenOrders.length - liveOrders.length;
  if (liveOrders.length === 0) {
    return {
      tenant_name: tenant.name,
      active_tables_count: 0,
      total_open_amount: 0,
      total_guests: 0,
      stale_unclosed_orders_count: staleOrdersCount,
      orders: []
    };
  }
  const orderIds = liveOrders.map((o) => o.id);
  const userIds = [...new Set(liveOrders.map((o) => o.creator).filter(Boolean))];
  const tableIds = [...new Set(liveOrders.map((o) => o.table).filter(Boolean))];
  const [{ data: usersData }, { data: tablesData }, { data: roomsData }, { data: itemsCountData }] = await Promise.all([
    userIds.length > 0 ? supabase.from("users").select("id, name, username").in("id", userIds) : Promise.resolve({ data: [] }),
    tableIds.length > 0 ? supabase.from("tables").select("id, number, rid").in("id", tableIds) : Promise.resolve({ data: [] }),
    supabase.from("rooms").select("id, name").eq("tenant_id", tenant.id),
    supabase.from("order_list").select("orderID, id").in("orderID", orderIds)
  ]);
  const userMap = /* @__PURE__ */ new Map();
  (usersData || []).forEach((u) => userMap.set(u.id, u.name || u.username));
  const roomMap = /* @__PURE__ */ new Map();
  (roomsData || []).forEach((r) => roomMap.set(r.id, r.name));
  const tableMap = /* @__PURE__ */ new Map();
  (tablesData || []).forEach((t) => {
    tableMap.set(t.id, {
      number: String(t.number),
      room_name: roomMap.get(t.rid) || `\u10D3\u10D0\u10E0\u10D1\u10D0\u10D6\u10D8 #${t.rid}`
    });
  });
  const itemsCountMap = /* @__PURE__ */ new Map();
  (itemsCountData || []).forEach((it) => {
    itemsCountMap.set(it.orderID, (itemsCountMap.get(it.orderID) || 0) + 1);
  });
  let totalOpenAmount = 0;
  let totalGuests = 0;
  const ordersSummary = liveOrders.map((o) => {
    const price = parseFloat(o.price) || 0;
    const guests = parseInt(o.guests, 10) || parseInt(o.count, 10) || 1;
    totalOpenAmount += price;
    totalGuests += guests;
    const tInfo = tableMap.get(o.table) || {
      number: o.is_delivery ? "\u10DB\u10D8\u10E2\u10D0\u10DC\u10D0" : String(o.table || "\u2014"),
      room_name: o.is_delivery ? "\u10DB\u10D8\u10E2\u10D0\u10DC\u10D8\u10E1 \u10E1\u10D4\u10E0\u10D5\u10D8\u10E1\u10D8" : "\u10D3\u10D0\u10E0\u10D1\u10D0\u10D6\u10D8"
    };
    const orderDate = new Date(o.date);
    const durationMinutes = Math.floor((now.getTime() - orderDate.getTime()) / (1e3 * 60));
    return {
      order_id: o.id,
      table_number: tInfo.number,
      room_name: tInfo.room_name,
      total_amount: Number(price.toFixed(2)),
      guests_count: guests,
      waiter_name: userMap.get(o.creator) || `\u10DB\u10D8\u10DB\u10E2\u10D0\u10DC\u10D8 #${o.creator}`,
      opened_at: o.date,
      duration_minutes: durationMinutes > 0 ? durationMinutes : 0,
      items_count: itemsCountMap.get(o.id) || 0
    };
  });
  return {
    tenant_name: tenant.name,
    active_tables_count: liveOrders.length,
    total_open_amount: Number(totalOpenAmount.toFixed(2)),
    total_guests: totalGuests,
    stale_unclosed_orders_count: staleOrdersCount,
    orders: ordersSummary
  };
}

// src/analytics/staffPerformance.ts
init_db();
async function getStaffPerformance(tenantIdentifier, period = "today", customStart, customEnd) {
  const tenant = await resolveTenant(tenantIdentifier);
  const bounds = getPeriodBounds(period, customStart, customEnd);
  const [orders, usersData] = await Promise.all([
    fetchAllRows(async (from, to) => {
      return supabase.from("orders").select("id, price, creator, status, date").eq("tenant_id", tenant.id).in("status", ["closed", "completed", "paid"]).gte("date", bounds.start).lte("date", bounds.end).range(from, to);
    }),
    supabase.from("users").select("id, name, username, category").eq("tenant_id", tenant.id)
  ]);
  const users = usersData.data || [];
  const userMap = /* @__PURE__ */ new Map();
  users.forEach((u) => {
    userMap.set(u.id, {
      name: u.name || u.username,
      role: u.category === 1 ? "\u10DB\u10DD\u10DA\u10D0\u10E0\u10D4 / Cashier" : "\u10DB\u10D8\u10DB\u10E2\u10D0\u10DC\u10D8 / Waiter"
    });
  });
  let totalRev = 0;
  const staffStats = /* @__PURE__ */ new Map();
  orders.forEach((o) => {
    const creatorId = o.creator || 0;
    const price = parseFloat(o.price) || 0;
    totalRev += price;
    const existing = staffStats.get(creatorId) || { count: 0, revenue: 0 };
    existing.count += 1;
    existing.revenue += price;
    staffStats.set(creatorId, existing);
  });
  const ranking = Array.from(staffStats.entries()).map(([userId, stats]) => {
    const uInfo = userMap.get(userId) || { name: `\u10D7\u10D0\u10DC\u10D0\u10DB\u10E8\u10E0\u10DD\u10DB\u10D4\u10DA\u10D8 #${userId}`, role: "\u10DE\u10D4\u10E0\u10E1\u10DD\u10DC\u10D0\u10DA\u10D8" };
    return {
      user_id: userId,
      name: uInfo.name,
      role: uInfo.role,
      orders_count: stats.count,
      total_revenue: Number(stats.revenue.toFixed(2)),
      average_check: stats.count > 0 ? Number((stats.revenue / stats.count).toFixed(2)) : 0
    };
  }).sort((a, b) => b.total_revenue - a.total_revenue);
  return {
    period_label: bounds.label,
    total_staff_count: ranking.length,
    total_orders_count: orders.length,
    total_revenue: Number(totalRev.toFixed(2)),
    ranking
  };
}

// src/analytics/purchasesAnalytics.ts
init_db();
async function getPurchasesAnalytics(tenantIdentifier, period = "this_month", customStart, customEnd, filterSupplierId, filterWarehouse) {
  const tenant = await resolveTenant(tenantIdentifier);
  const bounds = getPeriodBounds(period, customStart, customEnd);
  const { data: suppliersData } = await supabase.from("momwodeblebi").select("id, name, code, contact, person").eq("tenant_id", tenant.id);
  const supplierMap = /* @__PURE__ */ new Map();
  (suppliersData || []).forEach((s) => supplierMap.set(String(s.id), s));
  const { data: unitsData } = await supabase.from("units").select("id, name, short_name");
  const unitMap = /* @__PURE__ */ new Map();
  (unitsData || []).forEach((u) => unitMap.set(u.id, u.short_name || u.name));
  const migebaRows = await fetchAllRows(async (from, to) => {
    let q = supabase.from("migeba").select("id, name, price, count, code, ert, need, dealer, date, type").eq("tenant_id", tenant.id).gte("date", bounds.start).lte("date", bounds.end).order("date", { ascending: false });
    if (filterSupplierId !== void 0 && filterSupplierId !== null && filterSupplierId !== "") {
      q = q.eq("dealer", String(filterSupplierId));
    }
    if (filterWarehouse && filterWarehouse !== "ALL" && filterWarehouse !== "\u10E7\u10D5\u10D4\u10DA\u10D0") {
      q = q.eq("type", filterWarehouse);
    }
    return q.range(from, to);
  });
  let totalPurchaseAmount = 0;
  let totalQuantity = 0;
  const invoiceSet = /* @__PURE__ */ new Set();
  const invoiceMap = /* @__PURE__ */ new Map();
  const supSummaryMap = /* @__PURE__ */ new Map();
  const whSummaryMap = /* @__PURE__ */ new Map();
  const productSummaryMap = /* @__PURE__ */ new Map();
  for (const row of migebaRows) {
    const price = parseFloat(row.price) || 0;
    const count = parseFloat(row.count) || 0;
    const lineTotal = price * count;
    const invCode = row.code || `NO-CODE-${row.id}`;
    const supplierObj = supplierMap.get(String(row.dealer));
    const supplierName = supplierObj ? supplierObj.name : row.dealer ? `\u10DB\u10DD\u10DB\u10EC\u10DD\u10D3\u10D4\u10D1\u10D4\u10DA\u10D8 #${row.dealer}` : "\u10E3\u10EA\u10DC\u10DD\u10D1\u10D8 / \u10DB\u10D8\u10E3\u10D7\u10D8\u10D7\u10D4\u10D1\u10D4\u10DA\u10D8";
    const unitName = unitMap.get(row.ert) || "\u10EA";
    const whType = row.type || "main";
    totalPurchaseAmount += lineTotal;
    totalQuantity += count;
    invoiceSet.add(invCode);
    const existingInv = invoiceMap.get(invCode);
    if (!existingInv) {
      invoiceMap.set(invCode, {
        invoice_code: row.code || "\u2014",
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
    const supKey = String(row.dealer || "unknown");
    const existingSup = supSummaryMap.get(supKey);
    if (!existingSup) {
      const s = /* @__PURE__ */ new Set();
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
    const whName = whType === "bar" ? "\u10D1\u10D0\u10E0\u10D8" : whType === "restourant" || whType === "kitchen" ? "\u10E1\u10D0\u10DB\u10D6\u10D0\u10E0\u10D4\u10E3\u10DA\u10DD" : "\u10DB\u10D7\u10D0\u10D5\u10D0\u10E0\u10D8 \u10E1\u10D0\u10EC\u10E7\u10DD\u10D1\u10D8";
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
    const prodKey = (row.name || "\u10E3\u10E1\u10D0\u10EE\u10D4\u10DA\u10DD").trim();
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
  const suppliersSummary = Array.from(supSummaryMap.values()).map((s) => ({
    supplier_id: s.supplier_id,
    supplier_name: s.supplier_name,
    supplier_code: s.supplier_code,
    total_amount: Number(s.total_amount.toFixed(2)),
    invoices_count: s.invoices.size || s.items_count,
    items_count: s.items_count
  })).sort((a, b) => b.total_amount - a.total_amount);
  const warehouseBreakdown = Array.from(whSummaryMap.values()).map((w) => ({
    warehouse_type: w.warehouse_type,
    warehouse_name: w.warehouse_name,
    total_amount: Number(w.total_amount.toFixed(2)),
    items_count: w.items_count
  })).sort((a, b) => b.total_amount - a.total_amount);
  const topPurchasedProducts = Array.from(productSummaryMap.values()).map((p) => ({
    product_name: p.product_name,
    total_amount: Number(p.total_amount.toFixed(2)),
    total_quantity: Number(p.total_quantity.toFixed(3)),
    unit_name: p.unit_name,
    average_unit_price: p.total_quantity > 0 ? Number((p.total_amount / p.total_quantity).toFixed(2)) : 0,
    purchases_count: p.purchases_count
  })).sort((a, b) => b.total_amount - a.total_amount).slice(0, 25);
  const recentInvoices = Array.from(invoiceMap.values()).map((inv) => ({
    ...inv,
    total_amount: Number(inv.total_amount.toFixed(2))
  })).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 20);
  const totalInvoicesCount = invoiceSet.size;
  const avgInvoiceAmount = totalInvoicesCount > 0 ? totalPurchaseAmount / totalInvoicesCount : 0;
  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      currency: tenant.currency || "GEL"
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
      currency: tenant.currency || "GEL"
    },
    warehouse_breakdown: warehouseBreakdown,
    suppliers_summary: suppliersSummary,
    top_purchased_products: topPurchasedProducts,
    recent_invoices: recentInvoices
  };
}
async function searchPurchases(tenantIdentifier, options = {}) {
  const tenant = await resolveTenant(tenantIdentifier);
  const limit = options.limit || 30;
  const { data: suppliersData } = await supabase.from("momwodeblebi").select("id, name, code").eq("tenant_id", tenant.id);
  const supplierMap = new Map((suppliersData || []).map((s) => [String(s.id), s]));
  const { data: unitsData } = await supabase.from("units").select("id, name, short_name");
  const unitMap = new Map((unitsData || []).map((u) => [u.id, u.short_name || u.name]));
  let queryBuilder = supabase.from("migeba").select("id, name, price, count, code, ert, need, dealer, date, type").eq("tenant_id", tenant.id).order("date", { ascending: false });
  if (options.period || options.startDate && options.endDate) {
    const bounds = getPeriodBounds(options.period || "custom", options.startDate, options.endDate);
    queryBuilder = queryBuilder.gte("date", bounds.start).lte("date", bounds.end);
  }
  if (options.supplierId) {
    queryBuilder = queryBuilder.eq("dealer", String(options.supplierId));
  }
  if (options.warehouse && options.warehouse !== "ALL") {
    queryBuilder = queryBuilder.eq("type", options.warehouse);
  }
  if (options.query) {
    const q = options.query.trim();
    queryBuilder = queryBuilder.or(`code.ilike.%${q}%,name.ilike.%${q}%`);
  }
  const { data: rows, error } = await queryBuilder.limit(limit);
  if (error) throw error;
  const items = (rows || []).map((r) => {
    const price = parseFloat(r.price) || 0;
    const count = parseFloat(r.count) || 0;
    const supObj = supplierMap.get(String(r.dealer));
    return {
      id: r.id,
      product_name: r.name,
      quantity: count,
      unit_price: price,
      total_price: Number((price * count).toFixed(2)),
      unit_name: unitMap.get(r.ert) || "\u10EA",
      invoice_code: r.code || "\u2014",
      supplier_id: r.dealer,
      supplier_name: supObj ? supObj.name : r.dealer ? `\u10DB\u10DD\u10DB\u10EC\u10DD\u10D3\u10D4\u10D1\u10D4\u10DA\u10D8 #${r.dealer}` : "\u10E3\u10EA\u10DC\u10DD\u10D1\u10D8",
      warehouse_type: r.type || "main",
      date: r.date
    };
  });
  return {
    tenant_name: tenant.name,
    total_found: items.length,
    items
  };
}
async function getPurchaseDetails(invoiceCodeOrId, tenantIdentifier) {
  const tenant = await resolveTenant(tenantIdentifier);
  const { data: suppliersData } = await supabase.from("momwodeblebi").select("id, name, code, contact, person").eq("tenant_id", tenant.id);
  const supplierMap = new Map((suppliersData || []).map((s) => [String(s.id), s]));
  const { data: unitsData } = await supabase.from("units").select("id, name, short_name");
  const unitMap = new Map((unitsData || []).map((u) => [u.id, u.short_name || u.name]));
  const codeStr = String(invoiceCodeOrId).trim();
  let query = supabase.from("migeba").select("id, name, price, count, code, ert, need, dealer, date, type").eq("tenant_id", tenant.id);
  if (/^\d+$/.test(codeStr) && codeStr.length < 7) {
    query = query.or(`code.eq.${codeStr},id.eq.${codeStr}`);
  } else {
    query = query.eq("code", codeStr);
  }
  const { data: rows, error } = await query.order("id", { ascending: true });
  if (error) throw error;
  if (!rows || rows.length === 0) {
    throw new Error(`\u10E8\u10D4\u10E1\u10E7\u10D8\u10D3\u10D5\u10D0/\u10D6\u10D4\u10D3\u10DC\u10D0\u10D3\u10D4\u10D1\u10D8 \u10D9\u10DD\u10D3\u10D8\u10D7 \u10D0\u10DC ID-\u10D8\u10D7 "${invoiceCodeOrId}" \u10D5\u10D4\u10E0 \u10DB\u10DD\u10D8\u10EB\u10D4\u10D1\u10DC\u10D0.`);
  }
  let totalInvoiceSum = 0;
  let totalItemsCount = 0;
  const sample = rows[0];
  const supObj = supplierMap.get(String(sample.dealer));
  const items = rows.map((r) => {
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
      unit_name: unitMap.get(r.ert) || "\u10EA",
      warehouse_type: r.type || "main"
    };
  });
  return {
    tenant_name: tenant.name,
    invoice_code: sample.code || String(sample.id),
    date: sample.date,
    supplier: {
      id: sample.dealer,
      name: supObj ? supObj.name : sample.dealer ? `\u10DB\u10DD\u10DB\u10EC\u10DD\u10D3\u10D4\u10D1\u10D4\u10DA\u10D8 #${sample.dealer}` : "\u10E3\u10EA\u10DC\u10DD\u10D1\u10D8",
      code: supObj?.code,
      contact: supObj?.contact,
      person: supObj?.person
    },
    warehouse_type: sample.type || "main",
    total_items_count: totalItemsCount,
    grand_total: Number(totalInvoiceSum.toFixed(2)),
    currency: tenant.currency || "GEL",
    items
  };
}

// src/analytics/inventoriesAnalytics.ts
init_db();
async function getInventoryActs(tenantIdentifier, options = {}) {
  const tenant = await resolveTenant(tenantIdentifier);
  const limit = options.limit || 30;
  const { data: usersData } = await supabase.from("users").select("id, name, username");
  const userMap = /* @__PURE__ */ new Map();
  (usersData || []).forEach((u) => userMap.set(u.id, u.name || u.username));
  let query = supabase.from("inventory_acts").select("id, created_at, created_by, warehouse_type, category_id, comment, status, total_items, shortage_amount, surplus_amount, net_amount, tenant_id").eq("tenant_id", tenant.id).order("created_at", { ascending: false });
  let periodLabel;
  if (options.period && options.period !== "all") {
    const bounds = getPeriodBounds(options.period, options.startDate, options.endDate);
    periodLabel = bounds.label;
    query = query.gte("created_at", bounds.start).lte("created_at", bounds.end);
  } else if (options.startDate && options.endDate) {
    const bounds = getPeriodBounds("custom", options.startDate, options.endDate);
    periodLabel = bounds.label;
    query = query.gte("created_at", bounds.start).lte("created_at", bounds.end);
  }
  if (options.warehouse && options.warehouse !== "ALL" && options.warehouse !== "\u10E7\u10D5\u10D4\u10DA\u10D0") {
    query = query.eq("warehouse_type", options.warehouse);
  }
  if (options.status && options.status !== "all") {
    query = query.eq("status", options.status);
  }
  const { data: actsData, error } = await query.limit(limit);
  if (error) throw error;
  let totalItemsChecked = 0;
  let totalShortage = 0;
  let totalSurplus = 0;
  let totalNet = 0;
  const acts = (actsData || []).map((a) => {
    const shortage = parseFloat(a.shortage_amount) || 0;
    const surplus = parseFloat(a.surplus_amount) || 0;
    const net = parseFloat(a.net_amount) || 0;
    const itemsCount = parseInt(a.total_items, 10) || 0;
    totalItemsChecked += itemsCount;
    totalShortage += shortage;
    totalSurplus += surplus;
    totalNet += net;
    return {
      id: a.id,
      date: a.created_at,
      created_at: a.created_at,
      warehouse_type: a.warehouse_type || "\u10E7\u10D5\u10D4\u10DA\u10D0",
      comment: a.comment || "",
      status: a.status || "completed",
      total_items: itemsCount,
      shortage_amount: Number(shortage.toFixed(2)),
      surplus_amount: Number(surplus.toFixed(2)),
      net_amount: Number(net.toFixed(2)),
      created_by_name: a.created_by ? userMap.get(a.created_by) || `\u10DB\u10DD\u10DB\u10EE\u10DB\u10D0\u10E0\u10D4\u10D1\u10D4\u10DA\u10D8 #${a.created_by}` : void 0
    };
  });
  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      currency: tenant.currency || "GEL"
    },
    period_label: periodLabel,
    summary: {
      total_acts_count: acts.length,
      total_items_checked: totalItemsChecked,
      total_shortage_amount: Number(totalShortage.toFixed(2)),
      total_surplus_amount: Number(totalSurplus.toFixed(2)),
      total_net_discrepancy: Number(totalNet.toFixed(2)),
      currency: tenant.currency || "GEL"
    },
    acts
  };
}
async function getInventoryActDetails(actId, tenantIdentifier) {
  const tenant = await resolveTenant(tenantIdentifier);
  const { data: act, error: actErr } = await supabase.from("inventory_acts").select("*").eq("id", actId).eq("tenant_id", tenant.id).maybeSingle();
  if (actErr) throw actErr;
  if (!act) {
    throw new Error(`\u10D8\u10DC\u10D5\u10D4\u10DC\u10E2\u10D0\u10E0\u10D8\u10D6\u10D0\u10EA\u10D8\u10D8\u10E1 \u10D0\u10E5\u10E2\u10D8 #${actId} \u10D5\u10D4\u10E0 \u10DB\u10DD\u10D8\u10EB\u10D4\u10D1\u10DC\u10D0.`);
  }
  let creatorName = "\u10E3\u10EA\u10DC\u10DD\u10D1\u10D8";
  if (act.created_by) {
    const { data: user } = await supabase.from("users").select("name, username").eq("id", act.created_by).maybeSingle();
    if (user) creatorName = user.name || user.username;
  }
  const { data: itemsData, error: itemsErr } = await supabase.from("inventory_act_items").select("*").eq("act_id", actId).order("id", { ascending: true });
  if (itemsErr) throw itemsErr;
  const items = (itemsData || []).map((it) => {
    const diff = parseFloat(it.difference) || 0;
    const diffAmt = parseFloat(it.diff_amount) || 0;
    const price = parseFloat(it.price) || 0;
    const exp = parseFloat(it.expected_stock) || 0;
    const actStock = parseFloat(it.actual_stock) || 0;
    let status = "EXACT";
    if (diff < -1e-4 || diffAmt < -0.01) {
      status = "SHORTAGE";
    } else if (diff > 1e-4 || diffAmt > 0.01) {
      status = "SURPLUS";
    }
    return {
      id: it.id,
      product_id: it.product_id,
      product_name: it.product_name || `\u10DE\u10E0\u10DD\u10D3\u10E3\u10E5\u10E2\u10D8 #${it.product_id}`,
      unit_name: it.unit_name || "\u10EA",
      price: Number(price.toFixed(3)),
      expected_stock: Number(exp.toFixed(3)),
      actual_stock: Number(actStock.toFixed(3)),
      difference: Number(diff.toFixed(3)),
      diff_amount: Number(diffAmt.toFixed(2)),
      status
    };
  });
  const shortages = items.filter((i) => i.status === "SHORTAGE").sort((a, b) => a.diff_amount - b.diff_amount);
  const surpluses = items.filter((i) => i.status === "SURPLUS").sort((a, b) => b.diff_amount - a.diff_amount);
  const exacts = items.filter((i) => i.status === "EXACT");
  return {
    tenant_name: tenant.name,
    act: {
      id: act.id,
      created_at: act.created_at,
      warehouse_type: act.warehouse_type || "\u10E7\u10D5\u10D4\u10DA\u10D0",
      created_by_name: creatorName,
      comment: act.comment || "",
      status: act.status || "completed",
      total_items_checked: items.length,
      shortage_amount: Number((parseFloat(act.shortage_amount) || 0).toFixed(2)),
      surplus_amount: Number((parseFloat(act.surplus_amount) || 0).toFixed(2)),
      net_amount: Number((parseFloat(act.net_amount) || 0).toFixed(2)),
      currency: tenant.currency || "GEL"
    },
    statistics: {
      total_items_count: items.length,
      shortages_count: shortages.length,
      surpluses_count: surpluses.length,
      exact_count: exacts.length
    },
    top_shortages: shortages.slice(0, 15),
    top_surpluses: surpluses.slice(0, 15),
    all_items: items
  };
}
async function getInventoryDiscrepancySummary(tenantIdentifier, period = "this_month", customStart, customEnd) {
  const tenant = await resolveTenant(tenantIdentifier);
  const bounds = getPeriodBounds(period, customStart, customEnd);
  const { data: acts, error } = await supabase.from("inventory_acts").select("id, created_at, warehouse_type, shortage_amount, surplus_amount, net_amount").eq("tenant_id", tenant.id).gte("created_at", bounds.start).lte("created_at", bounds.end);
  if (error) throw error;
  const actIds = (acts || []).map((a) => a.id);
  if (actIds.length === 0) {
    return {
      tenant_name: tenant.name,
      period_label: bounds.label,
      total_audits_count: 0,
      total_shortages_sum: 0,
      total_surpluses_sum: 0,
      net_balance: 0,
      problematic_products: []
    };
  }
  const { data: actItems } = await supabase.from("inventory_act_items").select("product_id, product_name, unit_name, price, difference, diff_amount").in("act_id", actIds);
  const productAggMap = /* @__PURE__ */ new Map();
  let totalShortage = 0;
  let totalSurplus = 0;
  (actItems || []).forEach((it) => {
    const diff = parseFloat(it.difference) || 0;
    const diffAmt = parseFloat(it.diff_amount) || 0;
    if (Math.abs(diff) < 1e-4 && Math.abs(diffAmt) < 0.01) return;
    const key = String(it.product_id || it.product_name);
    const existing = productAggMap.get(key) || {
      product_id: it.product_id,
      product_name: it.product_name || `\u10DE\u10E0\u10DD\u10D3\u10E3\u10E5\u10E2\u10D8 #${it.product_id}`,
      unit_name: it.unit_name || "\u10EA",
      total_shortage_qty: 0,
      total_shortage_amount: 0,
      total_surplus_qty: 0,
      total_surplus_amount: 0,
      net_diff_amount: 0,
      discrepancy_occurrences: 0
    };
    existing.discrepancy_occurrences += 1;
    existing.net_diff_amount += diffAmt;
    if (diffAmt < 0) {
      existing.total_shortage_qty += Math.abs(diff);
      existing.total_shortage_amount += Math.abs(diffAmt);
      totalShortage += Math.abs(diffAmt);
    } else {
      existing.total_surplus_qty += diff;
      existing.total_surplus_amount += diffAmt;
      totalSurplus += diffAmt;
    }
    productAggMap.set(key, existing);
  });
  const problematicProducts = Array.from(productAggMap.values()).map((p) => ({
    ...p,
    total_shortage_qty: Number(p.total_shortage_qty.toFixed(3)),
    total_shortage_amount: Number(p.total_shortage_amount.toFixed(2)),
    total_surplus_qty: Number(p.total_surplus_qty.toFixed(3)),
    total_surplus_amount: Number(p.total_surplus_amount.toFixed(2)),
    net_diff_amount: Number(p.net_diff_amount.toFixed(2))
  })).sort((a, b) => b.total_shortage_amount - a.total_shortage_amount).slice(0, 25);
  return {
    tenant_name: tenant.name,
    period_label: bounds.label,
    total_audits_count: acts.length,
    total_shortages_sum: Number(totalShortage.toFixed(2)),
    total_surpluses_sum: Number(totalSurplus.toFixed(2)),
    net_balance: Number((totalSurplus - totalShortage).toFixed(2)),
    currency: tenant.currency || "GEL",
    problematic_products: problematicProducts
  };
}

// src/analytics/calculationsAnalytics.ts
init_db();
async function getRecipeCalculations(tenantIdentifier, options = {}) {
  const tenant = await resolveTenant(tenantIdentifier);
  const limit = options.limit || 100;
  const sortBy = options.sortBy || "food_cost_pct";
  const sortDirection = options.sortDirection || "desc";
  const { data: categoriesData } = await supabase.from("categories").select("id, name, hash, type").eq("tenant_id", tenant.id);
  const categoryMap = /* @__PURE__ */ new Map();
  (categoriesData || []).forEach((c) => {
    if (c.hash) categoryMap.set(c.hash, c.name);
    if (c.id) categoryMap.set(String(c.id), c.name);
  });
  const { data: unitsData } = await supabase.from("units").select("id, name, short_name");
  const unitMap = new Map((unitsData || []).map((u) => [u.id, u.short_name || u.name]));
  let itemsQuery = supabase.from("items").select("id, name, name_en, name_ru, hash, price, category, type, disable, tenant_id").eq("tenant_id", tenant.id);
  if (!options.includeDisabled) {
    itemsQuery = itemsQuery.eq("disable", 0);
  }
  if (options.type && options.type !== "all") {
    if (options.type === "kitchen") {
      itemsQuery = itemsQuery.in("type", ["restourant", "kitchen"]);
    } else {
      itemsQuery = itemsQuery.eq("type", options.type);
    }
  }
  if (options.search) {
    const q = options.search.trim();
    itemsQuery = itemsQuery.or(`name.ilike.%${q}%,name_en.ilike.%${q}%,name_ru.ilike.%${q}%`);
  }
  const { data: itemsData, error: itemsErr } = await itemsQuery;
  if (itemsErr) throw itemsErr;
  const items = itemsData || [];
  if (items.length === 0) {
    return {
      tenant: { id: tenant.id, name: tenant.name, currency: tenant.currency || "GEL" },
      summary: {
        total_dishes_count: 0,
        dishes_with_recipe: 0,
        dishes_without_recipe: 0,
        average_food_cost_pct: 0,
        average_selling_price: 0,
        average_cost_price: 0,
        average_margin: 0,
        high_food_cost_count: 0
      },
      dishes: []
    };
  }
  const needRows = await fetchAllRows(async (from, to) => {
    return supabase.from("need").select("id, hash, item, count, dish_hash, dish_id, item_type").eq("tenant_id", tenant.id).range(from, to);
  });
  const needMap = /* @__PURE__ */ new Map();
  needRows.forEach((n) => {
    if (!n.hash) return;
    const list = needMap.get(n.hash) || [];
    list.push(n);
    needMap.set(n.hash, list);
  });
  const prodIds = [...new Set(needRows.map((n) => n.item).filter(Boolean))];
  const { data: productsData } = prodIds.length > 0 ? await supabase.from("products").select("id, name, price, ert, count, type").in("id", prodIds) : { data: [] };
  const prodMap = /* @__PURE__ */ new Map();
  (productsData || []).forEach((p) => prodMap.set(p.id, p));
  const { data: semiData } = await supabase.from("semi_finished_products").select("id, product_id, target_weight, total_cost").eq("tenant_id", tenant.id);
  const semiMap = /* @__PURE__ */ new Map();
  (semiData || []).forEach((s) => {
    if (s.product_id) semiMap.set(s.product_id, s);
  });
  prodMap.forEach((prod, id) => {
    const sf = semiMap.get(id);
    if (sf) {
      const tw = parseFloat(sf.target_weight) || 1;
      const tc = parseFloat(sf.total_cost) || 0;
      if (tw > 0 && tc > 0) {
        prod.price = tc / tw;
      }
    }
  });
  const calculatedDishes = [];
  let sumFoodCostPct = 0;
  let dishesWithRecipeCount = 0;
  let totalSellingPrice = 0;
  let totalCostPrice = 0;
  let highFoodCostCount = 0;
  for (const item of items) {
    const itemNeeds = needMap.get(item.hash) || [];
    const hasRecipe = itemNeeds.length > 0;
    let costPrice = 0;
    itemNeeds.forEach((n) => {
      const prod = prodMap.get(n.item);
      const qty = parseFloat(n.count) || 0;
      const unitCost = Math.max(0, parseFloat(prod?.price) || 0);
      costPrice += qty * unitCost;
    });
    const sellPrice = parseFloat(item.price) || 0;
    const margin = sellPrice - costPrice;
    const foodCostPct = sellPrice > 0 ? costPrice / sellPrice * 100 : 0;
    const markupPct = costPrice > 0 ? (sellPrice - costPrice) / costPrice * 100 : 0;
    let catName = "\u10D9\u10D0\u10E2\u10D4\u10D2\u10DD\u10E0\u10D8\u10D8\u10E1 \u10D2\u10D0\u10E0\u10D4\u10E8\u10D4";
    if (item.category) {
      const cleaned = item.category.replace(/,/g, "").trim();
      catName = categoryMap.get(cleaned) || categoryMap.get(item.category) || `\u10D9\u10D0\u10E2\u10D4\u10D2\u10DD\u10E0\u10D8\u10D0 #${cleaned}`;
    }
    if (hasRecipe) {
      dishesWithRecipeCount += 1;
      sumFoodCostPct += foodCostPct;
      totalSellingPrice += sellPrice;
      totalCostPrice += costPrice;
      if (foodCostPct > 35) {
        highFoodCostCount += 1;
      }
    }
    calculatedDishes.push({
      item_id: item.id,
      name: item.name,
      name_en: item.name_en,
      name_ru: item.name_ru,
      hash: item.hash,
      category_name: catName,
      type: item.type === "bar" ? "\u10D1\u10D0\u10E0\u10D8" : item.type === "hookah" ? "\u10F0\u10E3\u10D9\u10D0" : "\u10E1\u10D0\u10DB\u10D6\u10D0\u10E0\u10D4\u10E3\u10DA\u10DD",
      selling_price: Number(sellPrice.toFixed(2)),
      cost_price: Number(costPrice.toFixed(2)),
      gross_margin: Number(margin.toFixed(2)),
      food_cost_pct: Number(foodCostPct.toFixed(1)),
      markup_pct: Number(markupPct.toFixed(1)),
      ingredients_count: itemNeeds.length,
      has_recipe: hasRecipe,
      is_disabled: Boolean(item.disable)
    });
  }
  let filtered = calculatedDishes;
  if (options.missingRecipesOnly) {
    filtered = filtered.filter((d) => !d.has_recipe);
  }
  if (options.minFoodCost !== void 0) {
    filtered = filtered.filter((d) => d.food_cost_pct >= options.minFoodCost);
  }
  if (options.maxFoodCost !== void 0) {
    filtered = filtered.filter((d) => d.food_cost_pct <= options.maxFoodCost);
  }
  if (options.category) {
    const cLow = options.category.toLowerCase();
    filtered = filtered.filter((d) => d.category_name.toLowerCase().includes(cLow));
  }
  filtered.sort((a, b) => {
    let valA = a[sortBy];
    let valB = b[sortBy];
    if (typeof valA === "string") {
      return sortDirection === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return sortDirection === "asc" ? valA - valB : valB - valA;
  });
  const avgFoodCost = dishesWithRecipeCount > 0 ? sumFoodCostPct / dishesWithRecipeCount : 0;
  const avgSelling = items.length > 0 ? totalSellingPrice / items.length : 0;
  const avgCost = dishesWithRecipeCount > 0 ? totalCostPrice / dishesWithRecipeCount : 0;
  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      currency: tenant.currency || "GEL"
    },
    summary: {
      total_dishes_count: items.length,
      dishes_with_recipe: dishesWithRecipeCount,
      dishes_without_recipe: items.length - dishesWithRecipeCount,
      average_food_cost_pct: Number(avgFoodCost.toFixed(1)),
      average_selling_price: Number(avgSelling.toFixed(2)),
      average_cost_price: Number(avgCost.toFixed(2)),
      average_margin: Number((avgSelling - avgCost).toFixed(2)),
      high_food_cost_count: highFoodCostCount
    },
    dishes: filtered.slice(0, limit)
  };
}
async function getDishRecipeDetails(itemIdOrNameOrHash, tenantIdentifier) {
  const tenant = await resolveTenant(tenantIdentifier);
  let itemQuery = supabase.from("items").select("id, name, name_en, name_ru, hash, price, category, type, disable, tenant_id").eq("tenant_id", tenant.id);
  const queryStr = String(itemIdOrNameOrHash).trim();
  if (/^\d+$/.test(queryStr) && queryStr.length < 8) {
    itemQuery = itemQuery.or(`id.eq.${queryStr},name.ilike.%${queryStr}%`);
  } else if (/^[a-f0-9]{32}$/i.test(queryStr)) {
    itemQuery = itemQuery.eq("hash", queryStr);
  } else {
    itemQuery = itemQuery.ilike("name", `%${queryStr}%`);
  }
  const { data: itemData, error: itemErr } = await itemQuery.limit(1).maybeSingle();
  if (itemErr) throw itemErr;
  if (!itemData) {
    throw new Error(`\u10D9\u10D4\u10E0\u10EB\u10D8 \u10DE\u10D0\u10E0\u10D0\u10DB\u10D4\u10E2\u10E0\u10D8\u10D7 "${itemIdOrNameOrHash}" \u10D5\u10D4\u10E0 \u10DB\u10DD\u10D8\u10EB\u10D4\u10D1\u10DC\u10D0.`);
  }
  const item = itemData;
  let categoryName = "\u10D9\u10D0\u10E2\u10D4\u10D2\u10DD\u10E0\u10D8\u10D8\u10E1 \u10D2\u10D0\u10E0\u10D4\u10E8\u10D4";
  if (item.category) {
    const cleaned = item.category.replace(/,/g, "").trim();
    const { data: cat } = await supabase.from("categories").select("name").eq("id", cleaned).maybeSingle();
    if (cat?.name) categoryName = cat.name;
  }
  const { data: unitsData } = await supabase.from("units").select("id, name, short_name");
  const unitMap = new Map((unitsData || []).map((u) => [u.id, u.short_name || u.name]));
  const { data: needList, error: needErr } = await supabase.from("need").select("id, hash, item, count, dish_hash, dish_id, item_type").eq("tenant_id", tenant.id).eq("hash", item.hash);
  if (needErr) throw needErr;
  const productIds = (needList || []).map((n) => n.item).filter(Boolean);
  const { data: productsData } = productIds.length > 0 ? await supabase.from("products").select("id, name, price, ert, count, type").in("id", productIds) : { data: [] };
  const prodMap = new Map((productsData || []).map((p) => [p.id, p]));
  const { data: semiData } = await supabase.from("semi_finished_products").select("id, product_id, target_weight, total_cost").eq("tenant_id", tenant.id).in("product_id", productIds);
  const semiMap = new Map((semiData || []).map((s) => [s.product_id, s]));
  let totalPrimeCost = 0;
  const rawIngredients = [];
  for (const need of needList || []) {
    const prod = prodMap.get(need.item);
    const sf = semiMap.get(need.item);
    const qty = parseFloat(need.count) || 0;
    let unitCost = Math.max(0, parseFloat(prod?.price) || 0);
    let isSemi = false;
    if (sf) {
      isSemi = true;
      const tw = parseFloat(sf.target_weight) || 1;
      const tc = parseFloat(sf.total_cost) || 0;
      if (tw > 0 && tc > 0) {
        unitCost = tc / tw;
      }
    }
    const lineCost = qty * unitCost;
    totalPrimeCost += lineCost;
    rawIngredients.push({
      product_id: need.item,
      product_name: prod?.name || `\u10DE\u10E0\u10DD\u10D3\u10E3\u10E5\u10E2\u10D8 #${need.item}`,
      unit_name: prod ? unitMap.get(prod.ert) || "\u10EA" : "\u10EA",
      quantity: Number(qty.toFixed(4)),
      unit_cost_price: Number(unitCost.toFixed(3)),
      line_total_cost: Number(lineCost.toFixed(3)),
      is_semi_finished: isSemi
    });
  }
  const ingredients = rawIngredients.map((ing) => ({
    ...ing,
    cost_share_pct: totalPrimeCost > 0 ? Number((ing.line_total_cost / totalPrimeCost * 100).toFixed(1)) : 0
  })).sort((a, b) => b.line_total_cost - a.line_total_cost);
  const sellPrice = parseFloat(item.price) || 0;
  const margin = sellPrice - totalPrimeCost;
  const foodCostPct = sellPrice > 0 ? totalPrimeCost / sellPrice * 100 : 0;
  const markupPct = totalPrimeCost > 0 ? (sellPrice - totalPrimeCost) / totalPrimeCost * 100 : 0;
  return {
    tenant_name: tenant.name,
    item: {
      id: item.id,
      name: item.name,
      name_en: item.name_en,
      name_ru: item.name_ru,
      hash: item.hash,
      category_name: categoryName,
      type: item.type === "bar" ? "\u10D1\u10D0\u10E0\u10D8" : item.type === "hookah" ? "\u10F0\u10E3\u10D9\u10D0" : "\u10E1\u10D0\u10DB\u10D6\u10D0\u10E0\u10D4\u10E3\u10DA\u10DD",
      selling_price: Number(sellPrice.toFixed(2)),
      prime_cost: Number(totalPrimeCost.toFixed(2)),
      gross_margin: Number(margin.toFixed(2)),
      food_cost_pct: Number(foodCostPct.toFixed(1)),
      markup_pct: Number(markupPct.toFixed(1)),
      ingredients_count: ingredients.length,
      has_recipe: ingredients.length > 0,
      currency: tenant.currency || "GEL"
    },
    ingredients
  };
}
async function getSemiFinishedAnalytics(tenantIdentifier, search) {
  const tenant = await resolveTenant(tenantIdentifier);
  let query = supabase.from("semi_finished_products").select("id, name, unit, target_weight, total_cost, created_at, updated_at, product_id, tenant_id").eq("tenant_id", tenant.id);
  if (search) {
    query = query.ilike("name", `%${search.trim()}%`);
  }
  const { data: semiList, error: semiErr } = await query.order("name", { ascending: true });
  if (semiErr) throw semiErr;
  const semiIds = (semiList || []).map((s) => s.id);
  const { data: unitsData } = await supabase.from("units").select("id, name, short_name");
  const unitMap = new Map((unitsData || []).map((u) => [u.id, u.short_name || u.name]));
  const { data: ingrData } = semiIds.length > 0 ? await supabase.from("semi_finished_ingredients").select("*").in("semi_finished_id", semiIds) : { data: [] };
  const prodIds = [...new Set((ingrData || []).map((i) => i.product_id).filter(Boolean))];
  const { data: prodsData } = prodIds.length > 0 ? await supabase.from("products").select("id, name, ert").in("id", prodIds) : { data: [] };
  const prodMap = new Map((prodsData || []).map((p) => [p.id, p]));
  const ingrMap = /* @__PURE__ */ new Map();
  (ingrData || []).forEach((i) => {
    const list = ingrMap.get(i.semi_finished_id) || [];
    list.push(i);
    ingrMap.set(i.semi_finished_id, list);
  });
  const result = (semiList || []).map((s) => {
    const tw = parseFloat(s.target_weight) || 1;
    const tc = parseFloat(s.total_cost) || 0;
    const unitCost = tw > 0 ? tc / tw : 0;
    const unitName = unitMap.get(s.unit) || "\u10D9\u10D2";
    const ingredients = (ingrMap.get(s.id) || []).map((ing) => {
      const p = prodMap.get(ing.product_id);
      return {
        product_id: ing.product_id,
        product_name: p?.name || `\u10DE\u10E0\u10DD\u10D3\u10E3\u10E5\u10E2\u10D8 #${ing.product_id}`,
        unit_name: p ? unitMap.get(p.ert) || "\u10EA" : "\u10EA",
        quantity: parseFloat(ing.quantity) || 0,
        unit_price: parseFloat(ing.unit_price) || 0,
        total_cost: parseFloat(ing.total_cost) || 0
      };
    });
    return {
      id: s.id,
      name: s.name,
      product_id: s.product_id,
      yield_target_weight: tw,
      unit_name: unitName,
      batch_total_cost: Number(tc.toFixed(2)),
      calculated_cost_per_unit: Number(unitCost.toFixed(2)),
      ingredients_count: ingredients.length,
      ingredients
    };
  });
  return {
    tenant_name: tenant.name,
    total_semi_finished_count: result.length,
    items: result
  };
}

// src/tools.ts
function registerTools(server) {
  server.tool(
    "list_tenants",
    "\u10DD\u10D1\u10D8\u10D4\u10E5\u10E2\u10D4\u10D1\u10D8\u10E1/\u10E0\u10D4\u10E1\u10E2\u10DD\u10E0\u10DC\u10D4\u10D1\u10D8\u10E1 \u10E1\u10D8\u10D0 (List available store venues/tenants in the system)",
    {},
    async () => {
      const { data, error } = await supabase.from("tenants").select("id, name, slug, code, currency, tax_id, license_plan, is_active").order("name", { ascending: true });
      if (error) {
        return {
          content: [{ type: "text", text: `\u10E8\u10D4\u10EA\u10D3\u10DD\u10DB\u10D0 \u10DD\u10D1\u10D8\u10D4\u10E5\u10E2\u10D4\u10D1\u10D8\u10E1 \u10E9\u10D0\u10E2\u10D5\u10D8\u10E0\u10D7\u10D5\u10D8\u10E1\u10D0\u10E1: ${error.message}` }],
          isError: true
        };
      }
      const tenants = data || [];
      const textSummary = tenants.map(
        (t) => `\u2022 ${t.name} (ID: ${t.id}${t.slug ? `, slug: ${t.slug}` : ""}) \u2014 \u10D5\u10D0\u10DA\u10E3\u10E2\u10D0: ${t.currency || "GEL"}`
      ).join("\n");
      return {
        content: [
          {
            type: "text",
            text: `\u{1F3E2} \u10EE\u10D4\u10DA\u10DB\u10D8\u10E1\u10D0\u10EC\u10D5\u10D3\u10DD\u10DB\u10D8 \u10DD\u10D1\u10D8\u10D4\u10E5\u10E2\u10D4\u10D1\u10D8 (${tenants.length}):
${textSummary}

JSON:
` + JSON.stringify(tenants, null, 2)
          }
        ]
      };
    }
  );
  server.tool(
    "get_today_summary",
    "\u10D3\u10E6\u10D4\u10D5\u10D0\u10DC\u10D3\u10D4\u10DA\u10D8 \u10EF\u10D0\u10DB\u10E3\u10E0\u10D8 \u10E4\u10D8\u10DC\u10D0\u10DC\u10E1\u10E3\u10E0\u10D8 \u10DB\u10D0\u10E9\u10D5\u10D4\u10DC\u10D4\u10D1\u10DA\u10D4\u10D1\u10D8: \u10E8\u10D4\u10DB\u10DD\u10E1\u10D0\u10D5\u10D0\u10DA\u10D8, \u10EE\u10D0\u10E0\u10EF\u10D8, \u10E1\u10D0\u10E8\u10E3\u10D0\u10DA\u10DD \u10E9\u10D4\u10D9\u10D8, \u10E1\u10D0\u10DA\u10D0\u10E0\u10DD\u10E1 \u10D1\u10D0\u10DA\u10D0\u10DC\u10E1\u10D8, \u10D2\u10D0\u10D3\u10D0\u10EE\u10D3\u10D4\u10D1\u10D8\u10E1 \u10E2\u10D8\u10DE\u10D4\u10D1\u10D8 (Today revenue, expenses, average check, cash balance, payment types)",
    {
      tenant: z.string().optional().describe("Tenant ID, Slug \u10D0\u10DC \u10D3\u10D0\u10E1\u10D0\u10EE\u10D4\u10DA\u10D4\u10D1\u10D0 (Optional: tenant ID/slug. If omitted, uses default venue)"),
      date: z.string().optional().describe("\u10D7\u10D0\u10E0\u10D8\u10E6\u10D8 YYYY-MM-DD \u10E4\u10DD\u10E0\u10DB\u10D0\u10E2\u10E8\u10D8 (Optional custom date, defaults to today)")
    },
    async ({ tenant, date }) => {
      try {
        const summary = await getTodaySummary(tenant, date);
        const cur = summary.revenue.currency;
        const formatted = `
\u{1F4CA} **${summary.tenant.name} \u2014 ${summary.active_shift_summary ? "\u10DB\u10D8\u10DB\u10D3\u10D8\u10DC\u10D0\u10E0\u10D4 \u10EA\u10D5\u10DA\u10D0 \u10D3\u10D0 \u10D3\u10E6\u10D8\u10E1 \u10D0\u10DC\u10D2\u10D0\u10E0\u10D8\u10E8\u10D8" : "\u10D3\u10E6\u10D8\u10E1 \u10D0\u10DC\u10D2\u10D0\u10E0\u10D8\u10E8\u10D8"} (${summary.date})**
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
${summary.active_shift_summary ? `
\u26A1 **\u10D0\u10E5\u10E2\u10D8\u10E3\u10E0\u10D8 \u10EA\u10D5\u10DA\u10D0 (Active Shift Dashboard \u2014 Live):**
  \u2022 \u{1F7E2} \u10E1\u10E2\u10D0\u10E2\u10E3\u10E1\u10D8: \u10E6\u10D8\u10D0\u10D0 (\u10EA\u10D5\u10DA\u10D0 #${summary.active_shift_summary.shift_number || summary.active_shift_summary.shift_id})
  \u2022 \u{1F464} \u10DB\u10DD\u10DA\u10D0\u10E0\u10D4: ${summary.active_shift_summary.cashier_name}
  \u2022 \u23F0 \u10D2\u10D0\u10EE\u10E1\u10DC\u10D8\u10E1 \u10D3\u10E0\u10DD: ${new Date(summary.active_shift_summary.opened_at).toLocaleString("ka-GE")}
  \u2022 \u{1F4B5} **\u10E1\u10D0\u10EC\u10E7\u10D8\u10E1\u10D8 \u10D7\u10D0\u10DC\u10EE\u10D0:** ${summary.active_shift_summary.initial_cash} ${cur}
  \u2022 \u{1F4B5} **\u10E1. \u10DC\u10D0\u10E6\u10D3\u10D8 \u10E4\u10E3\u10DA\u10D8:** ${summary.active_shift_summary.cash_sales} ${cur}
  \u2022 \u{1F4B3} **\u10E1. \u10E1\u10D0\u10D1\u10D0\u10DC\u10D9\u10DD \u10D1\u10D0\u10E0\u10D0\u10D7\u10D8:** ${summary.active_shift_summary.card_sales} ${cur}
  \u2022 \u{1F4B0} **\u10E1\u10E3\u10DA \u10EA\u10D5\u10DA\u10D8\u10E1 \u10D2\u10D0\u10E7\u10D8\u10D3\u10D5\u10D4\u10D1\u10D8:** ${summary.active_shift_summary.total_sales} ${cur}
  \u2022 \u{1F4B3} **\u10D3\u10D4\u10DE\u10DD\u10D6\u10D8\u10E2\u10D8:** ${summary.active_shift_summary.deposit_sum} ${cur}
  \u2022 \u{1F37D}\uFE0F **\u10E6\u10D8\u10D0 \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8:** ${summary.active_shift_summary.open_orders_sum} ${cur} (${summary.active_shift_summary.open_orders_count} \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D0)
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501` : ""}

\u{1F4B0} **\u10EF\u10D0\u10DB\u10E3\u10E0\u10D8 \u10E8\u10D4\u10DB\u10DD\u10E1\u10D0\u10D5\u10D0\u10DA\u10D8 (Revenue):** ${summary.revenue.net_revenue} ${cur} (\u10E1\u10D0\u10DA\u10D0\u10E0\u10DD\u10E1 \u10E8\u10D4\u10DB\u10DD\u10E1\u10D0\u10D5\u10D0\u10DA\u10D8: ${summary.revenue.gross_total} ${cur}, \u10E4\u10D0\u10E1\u10D3\u10D0\u10D9\u10DA\u10D4\u10D1\u10D0: ${summary.revenue.discounts_total} ${cur})
\u{1F4B3} **\u10D2\u10D0\u10D3\u10D0\u10EE\u10D3\u10D4\u10D1\u10D8 (Payment Breakdown):**
  \u2022 \u{1F4B5} \u10DC\u10D0\u10E6\u10D3\u10D8 (Cash): ${summary.payments_breakdown.cash} ${cur}
  \u2022 \u{1F4B3} \u10D1\u10D0\u10E0\u10D0\u10D7\u10D8 (Card / Terminal): ${summary.payments_breakdown.card} ${cur}
  \u2022 \u{1F3E6} \u10D2\u10D0\u10D3\u10D0\u10E0\u10D8\u10EA\u10EE\u10D5\u10D0 (Bank Transfer): ${summary.payments_breakdown.bank_transfer} ${cur}
  \u2022 \u{1F539} \u10E1\u10EE\u10D5\u10D0 (Other): ${summary.payments_breakdown.other} ${cur}

\u{1F4C9} **\u10EE\u10D0\u10E0\u10EF\u10D4\u10D1\u10D8 (Expenses):** ${summary.expenses.total_expenses} ${cur}
  \u2022 \u10DB\u10DD\u10DB\u10EC\u10DD\u10D3\u10D4\u10D1\u10DA\u10D4\u10D1\u10D6\u10D4 \u10D2\u10D0\u10EA\u10D4\u10DB\u10E3\u10DA\u10D8: ${summary.expenses.supplier_payments} ${cur}
  \u2022 \u10E1\u10D0\u10DA\u10D0\u10E0\u10DD\u10D3\u10D0\u10DC \u10D2\u10D0\u10EA\u10D4\u10DB\u10D0: ${summary.expenses.cash_payouts} ${cur}
  \u2022 \u10E9\u10D0\u10DB\u10DD\u10EC\u10D4\u10E0\u10D4\u10D1\u10D8: ${summary.expenses.write_offs} ${cur}

\u2696\uFE0F **\u10EC\u10DB\u10D8\u10DC\u10D3\u10D0 \u10E1\u10D0\u10DA\u10D3\u10DD / \u10DB\u10DD\u10D2\u10D4\u10D1\u10D0 (Net Profit):** ${summary.financial_balance.net_profit_or_loss} ${cur}

\u{1F9FE} **\u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8 \u10D3\u10D0 \u10E1\u10D0\u10E8\u10E3\u10D0\u10DA\u10DD \u10E9\u10D4\u10D9\u10D8 (Orders & Avg Check):**
  \u2022 \u10E1\u10E3\u10DA \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8: ${summary.orders_metrics.total_orders_count} (\u10D3\u10D0\u10EE\u10E3\u10E0\u10E3\u10DA\u10D8: ${summary.orders_metrics.closed_orders_count}, \u10E6\u10D8\u10D0: ${summary.orders_metrics.active_open_orders_count})
  \u2022 \u{1F3AF} **\u10E1\u10D0\u10E8\u10E3\u10D0\u10DA\u10DD \u10E9\u10D4\u10D9\u10D8:** ${summary.orders_metrics.average_check} ${cur}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
        return {
          content: [
            { type: "text", text: formatted.trim() + "\n\n" + JSON.stringify(summary, null, 2) }
          ]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `\u10E8\u10D4\u10EA\u10D3\u10DD\u10DB\u10D0 \u10D0\u10DC\u10D2\u10D0\u10E0\u10D8\u10E8\u10D8\u10E1 \u10DB\u10D8\u10E6\u10D4\u10D1\u10D8\u10E1\u10D0\u10E1: ${err.message}` }],
          isError: true
        };
      }
    }
  );
  server.tool(
    "get_sales_analytics",
    "\u10D2\u10D0\u10E7\u10D8\u10D3\u10D5\u10D4\u10D1\u10D8\u10E1 \u10D3\u10D4\u10E2\u10D0\u10DA\u10E3\u10E0\u10D8 \u10D0\u10DC\u10D0\u10DA\u10D8\u10E2\u10D8\u10D9\u10D0 \u10DE\u10D4\u10E0\u10D8\u10DD\u10D3\u10D8\u10E1 \u10DB\u10D8\u10EE\u10D4\u10D3\u10D5\u10D8\u10D7: \u10E1\u10D0\u10D0\u10D7\u10DD\u10D1\u10E0\u10D8\u10D5\u10D8 \u10D2\u10D0\u10DC\u10D0\u10EC\u10D8\u10DA\u10D4\u10D1\u10D0, \u10D3\u10D0\u10E0\u10D1\u10D0\u10D6\u10D4\u10D1\u10D8, \u10DB\u10D8\u10E2\u10D0\u10DC\u10D0 (Glovo/Bolt/Taxi) (Detailed sales analytics by period, hourly distribution, halls, delivery)",
    {
      tenant: z.string().optional().describe("Tenant ID \u10D0\u10DC Slug"),
      period: z.enum(["today", "yesterday", "this_week", "this_month", "last_month", "custom"]).default("today").describe("\u10E1\u10D0\u10D0\u10DC\u10D2\u10D0\u10E0\u10D8\u10E8\u10DD \u10DE\u10D4\u10E0\u10D8\u10DD\u10D3\u10D8"),
      startDate: z.string().optional().describe("\u10E1\u10D0\u10EC\u10E7\u10D8\u10E1\u10D8 \u10D7\u10D0\u10E0\u10D8\u10E6\u10D8 YYYY-MM-DD (\u10D7\u10E3 period=custom)"),
      endDate: z.string().optional().describe("\u10E1\u10D0\u10D1\u10DD\u10DA\u10DD\u10DD \u10D7\u10D0\u10E0\u10D8\u10E6\u10D8 YYYY-MM-DD (\u10D7\u10E3 period=custom)")
    },
    async ({ tenant, period, startDate, endDate }) => {
      try {
        const res = await getSalesAnalytics(tenant, period, startDate, endDate);
        const topHalls = res.halls_sales.map((h) => `  \u2022 ${h.room_name}: ${h.revenue} GEL (${h.orders_count} \u10E9\u10D4\u10D9\u10D8)`).join("\n");
        const summaryText = `
\u{1F4C8} **\u10D2\u10D0\u10E7\u10D8\u10D3\u10D5\u10D4\u10D1\u10D8\u10E1 \u10D0\u10DC\u10D0\u10DA\u10D8\u10E2\u10D8\u10D9\u10D0 \u2014 ${res.period_label}**
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4B0} **\u10EF\u10D0\u10DB\u10E3\u10E0\u10D8 \u10E8\u10D4\u10DB\u10DD\u10E1\u10D0\u10D5\u10D0\u10DA\u10D8:** ${res.total_revenue} GEL
\u{1F9FE} **\u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8\u10E1 \u10E0\u10D0\u10DD\u10D3\u10D4\u10DC\u10DD\u10D1\u10D0:** ${res.orders_count}
\u{1F3AF} **\u10E1\u10D0\u10E8\u10E3\u10D0\u10DA\u10DD \u10E9\u10D4\u10D9\u10D8:** ${res.average_check} GEL

\u{1F6F5} **\u10DB\u10D8\u10E2\u10D0\u10DC\u10D0 vs \u10D3\u10D0\u10E0\u10D1\u10D0\u10D6\u10D8:**
  \u2022 \u10D0\u10D3\u10D2\u10D8\u10DA\u10D6\u10D4 (Dine-in): ${res.delivery_breakdown.dine_in_revenue} GEL
  \u2022 \u10DB\u10D8\u10E2\u10D0\u10DC\u10D0 \u10EF\u10D0\u10DB\u10E8\u10D8 (Delivery): ${res.delivery_breakdown.delivery_revenue} GEL (Glovo: ${res.delivery_breakdown.glovo_revenue} GEL, Bolt: ${res.delivery_breakdown.bolt_revenue} GEL, Taxi: ${res.delivery_breakdown.taxi_revenue} GEL)

\u{1F3DB}\uFE0F **\u10E8\u10D4\u10DB\u10DD\u10E1\u10D0\u10D5\u10D0\u10DA\u10D8 \u10D3\u10D0\u10E0\u10D1\u10D0\u10D6\u10D4\u10D1\u10D8\u10E1 \u10DB\u10D8\u10EE\u10D4\u10D3\u10D5\u10D8\u10D7:**
${topHalls || "  \u2022 \u10D8\u10DC\u10E4\u10DD\u10E0\u10DB\u10D0\u10EA\u10D8\u10D0 \u10D0\u10E0 \u10D0\u10E0\u10D8\u10E1"}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
        return {
          content: [{ type: "text", text: summaryText.trim() + "\n\n" + JSON.stringify(res, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `\u10E8\u10D4\u10EA\u10D3\u10DD\u10DB\u10D0 \u10D2\u10D0\u10E7\u10D8\u10D3\u10D5\u10D4\u10D1\u10D8\u10E1 \u10D0\u10DC\u10D0\u10DA\u10D8\u10D6\u10D8\u10E1\u10D0\u10E1: ${err.message}` }],
          isError: true
        };
      }
    }
  );
  server.tool(
    "get_expenses_summary",
    "\u10EE\u10D0\u10E0\u10EF\u10D4\u10D1\u10D8\u10E1 \u10D0\u10DC\u10D0\u10DA\u10D8\u10D6\u10D8 \u10DE\u10D4\u10E0\u10D8\u10DD\u10D3\u10D8\u10E1 \u10DB\u10D8\u10EE\u10D4\u10D3\u10D5\u10D8\u10D7: \u10DB\u10DD\u10DB\u10EC\u10DD\u10D3\u10D4\u10D1\u10DA\u10D4\u10D1\u10D6\u10D4 \u10D2\u10D0\u10D3\u10D0\u10EE\u10D3\u10D4\u10D1\u10D8, \u10E1\u10D0\u10DA\u10D0\u10E0\u10DD\u10D3\u10D0\u10DC \u10D2\u10D0\u10EA\u10D4\u10DB\u10D4\u10D1\u10D8, \u10E9\u10D0\u10DB\u10DD\u10EC\u10D4\u10E0\u10D4\u10D1\u10D8 (Expenses analytics by period: supplier payouts, cash desk out, write-offs)",
    {
      tenant: z.string().optional().describe("Tenant ID \u10D0\u10DC Slug"),
      period: z.enum(["today", "yesterday", "this_week", "this_month", "last_month", "custom"]).default("today"),
      startDate: z.string().optional().describe("YYYY-MM-DD"),
      endDate: z.string().optional().describe("YYYY-MM-DD")
    },
    async ({ tenant, period, startDate, endDate }) => {
      try {
        const res = await getExpensesAnalytics(tenant, period, startDate, endDate);
        const supText = res.suppliers_summary.slice(0, 5).map((s) => `  \u2022 ${s.supplier_name}: ${s.total_paid} GEL (${s.payments_count} \u10D2\u10D0\u10D3\u10D0\u10EE\u10D3\u10D0)`).join("\n");
        const summaryText = `
\u{1F4C9} **\u10EE\u10D0\u10E0\u10EF\u10D4\u10D1\u10D8\u10E1 \u10D0\u10DC\u10D0\u10DA\u10D8\u10D6\u10D8 \u2014 ${res.period_label}**
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4B8} **\u10E1\u10E3\u10DA \u10EE\u10D0\u10E0\u10EF\u10D4\u10D1\u10D8:** ${res.total_expenses} ${res.currency}
  \u2022 \u{1F69A} \u10DB\u10DD\u10DB\u10EC\u10DD\u10D3\u10D4\u10D1\u10DA\u10D4\u10D1\u10D6\u10D4 \u10D2\u10D0\u10D3\u10D0\u10EE\u10D3\u10D8\u10DA\u10D8: ${res.breakdown.supplier_payments} ${res.currency}
  \u2022 \u{1F4B5} \u10E1\u10D0\u10DA\u10D0\u10E0\u10DD\u10D3\u10D0\u10DC \u10D2\u10D0\u10EA\u10D4\u10DB\u10D0 (Cash Out): ${res.breakdown.cash_out_payouts} ${res.currency}
  \u2022 \u{1F4E6} \u10E9\u10D0\u10DB\u10DD\u10EC\u10D4\u10E0\u10D4\u10D1\u10D8 (Write-offs): ${res.breakdown.write_offs} ${res.currency}

\u{1F51D} **\u10DB\u10D7\u10D0\u10D5\u10D0\u10E0\u10D8 \u10DB\u10DD\u10DB\u10EC\u10DD\u10D3\u10D4\u10D1\u10DA\u10D4\u10D1\u10D8:**
${supText || "  \u2022 \u10E9\u10D0\u10DC\u10D0\u10EC\u10D4\u10E0\u10D4\u10D1\u10D8 \u10D0\u10E0 \u10DB\u10DD\u10D8\u10EB\u10D4\u10D1\u10DC\u10D0"}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
        return {
          content: [{ type: "text", text: summaryText.trim() + "\n\n" + JSON.stringify(res, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `\u10E8\u10D4\u10EA\u10D3\u10DD\u10DB\u10D0 \u10EE\u10D0\u10E0\u10EF\u10D4\u10D1\u10D8\u10E1 \u10D0\u10DC\u10D0\u10DA\u10D8\u10D6\u10D8\u10E1\u10D0\u10E1: ${err.message}` }],
          isError: true
        };
      }
    }
  );
  server.tool(
    "get_top_selling_items",
    "\u10E2\u10DD\u10DE \u10D2\u10D0\u10E7\u10D8\u10D3\u10D5\u10D0\u10D3\u10D8 \u10D9\u10D4\u10E0\u10EB\u10D4\u10D1\u10D8 \u10D3\u10D0 \u10E1\u10D0\u10E1\u10DB\u10D4\u10DA\u10D4\u10D1\u10D8 (\u10D7\u10D0\u10DC\u10EE\u10D8\u10D7 \u10D0\u10DC \u10E0\u10D0\u10DD\u10D3\u10D4\u10DC\u10DD\u10D1\u10D8\u10D7), \u10E1\u10D0\u10DB\u10D6\u10D0\u10E0\u10D4\u10E3\u10DA\u10DD\u10E1 \u10D3\u10D0 \u10D1\u10D0\u10E0\u10D8\u10E1 \u10E8\u10D4\u10E4\u10D0\u10E0\u10D3\u10D4\u10D1\u10D0 (Top selling menu items by revenue or volume, bar vs kitchen ratio)",
    {
      tenant: z.string().optional().describe("Tenant ID \u10D0\u10DC Slug"),
      period: z.enum(["today", "yesterday", "this_week", "this_month", "last_month", "custom"]).default("today"),
      limit: z.number().default(15).describe("\u10DE\u10DD\u10D6\u10D8\u10EA\u10D8\u10D4\u10D1\u10D8\u10E1 \u10E0\u10D0\u10DD\u10D3\u10D4\u10DC\u10DD\u10D1\u10D0 (Number of items to return)"),
      sortBy: z.enum(["revenue", "quantity"]).default("revenue").describe("\u10D3\u10D0\u10DA\u10D0\u10D2\u10D4\u10D1\u10D0 \u10D7\u10D0\u10DC\u10EE\u10D8\u10D7 (revenue) \u10D0\u10DC \u10E0\u10D0\u10DD\u10D3\u10D4\u10DC\u10DD\u10D1\u10D8\u10D7 (quantity)")
    },
    async ({ tenant, period, limit, sortBy }) => {
      try {
        const res = await getTopSellingItems(tenant, period, limit, sortBy);
        const itemsText = res.items.map((it, idx) => {
          const typeIcon = it.type === "bar" ? "\u{1F378} \u10D1\u10D0\u10E0\u10D8" : it.type === "hookah" ? "\u{1F4A8} \u10F0\u10E3\u10D9\u10D0" : it.type === "other" ? "\u{1F4E6} \u10E1\u10EE\u10D5\u10D0" : "\u{1F373} \u10E1\u10D0\u10DB\u10D6\u10D0\u10E0\u10D4\u10E3\u10DA\u10DD";
          return `  ${idx + 1}. ${it.item_name} (${typeIcon}) \u2014 ${it.quantity_sold} \u10EA\u10D0\u10DA\u10D8 | ${it.total_revenue} GEL`;
        }).join("\n");
        const cb = res.category_breakdown;
        const summaryText = `
\u{1F3C6} **\u10E2\u10DD\u10DE \u10D2\u10D0\u10E7\u10D8\u10D3\u10D5\u10D0\u10D3\u10D8 \u10D9\u10D4\u10E0\u10EB\u10D4\u10D1\u10D8 \u10D3\u10D0 \u10E1\u10D0\u10E1\u10DB\u10D4\u10DA\u10D4\u10D1\u10D8 \u2014 ${res.period_label}**
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F37D}\uFE0F \u10E1\u10E3\u10DA \u10D2\u10D0\u10E7\u10D8\u10D3\u10E3\u10DA\u10D8 \u10DE\u10DD\u10D6\u10D8\u10EA\u10D8\u10D4\u10D1\u10D8: ${res.total_items_sold} \u10EA\u10D0\u10DA\u10D8 (${res.total_sales_amount} GEL)
\u{1F373} \u10E1\u10D0\u10DB\u10D6\u10D0\u10E0\u10D4\u10E3\u10DA\u10DD: ${cb.kitchen.revenue} GEL (${cb.kitchen.count} \u10EA\u10D0\u10DA\u10D8)
\u{1F378} \u10D1\u10D0\u10E0\u10D8: ${cb.bar.revenue} GEL (${cb.bar.count} \u10EA\u10D0\u10DA\u10D8)
\u{1F4A8} \u10F0\u10E3\u10D9\u10D0: ${cb.hookah.revenue} GEL (${cb.hookah.count} \u10EA\u10D0\u10DA\u10D8)
${cb.other.revenue > 0 ? `\u{1F4E6} \u10E1\u10EE\u10D5\u10D0/\u10E3\u10E4\u10D0\u10E1\u10DD: ${cb.other.revenue} GEL (${cb.other.count} \u10EA\u10D0\u10DA\u10D8)
` : ""}
\u{1F4CB} **\u10E0\u10D4\u10D8\u10E2\u10D8\u10DC\u10D2\u10D8 (\u10D3\u10D0\u10DA\u10D0\u10D2\u10D4\u10D1\u10E3\u10DA\u10D8 ${sortBy === "quantity" ? "\u10E0\u10D0\u10DD\u10D3\u10D4\u10DC\u10DD\u10D1\u10D8\u10D7" : "\u10D7\u10D0\u10DC\u10EE\u10D8\u10D7"}):**
${itemsText || "  \u2022 \u10D2\u10D0\u10E7\u10D8\u10D3\u10D5\u10D4\u10D1\u10D8 \u10D0\u10E0 \u10E4\u10D8\u10E5\u10E1\u10D8\u10E0\u10D3\u10D4\u10D1\u10D0"}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
        return {
          content: [{ type: "text", text: summaryText.trim() + "\n\n" + JSON.stringify(res, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `\u10E8\u10D4\u10EA\u10D3\u10DD\u10DB\u10D0 \u10E2\u10DD\u10DE \u10D2\u10D0\u10E7\u10D8\u10D3\u10D5\u10D4\u10D1\u10D8\u10E1 \u10DB\u10D8\u10E6\u10D4\u10D1\u10D8\u10E1\u10D0\u10E1: ${err.message}` }],
          isError: true
        };
      }
    }
  );
  server.tool(
    "get_shift_report",
    "\u10E1\u10D0\u10DA\u10D0\u10E0\u10DD\u10E1 \u10EA\u10D5\u10DA\u10D8\u10E1 \u10E1\u10E0\u10E3\u10DA\u10D8 \u10D0\u10DC\u10D2\u10D0\u10E0\u10D8\u10E8\u10D8 (X/Z Report): \u10D2\u10D0\u10EE\u10E1\u10DC\u10D8\u10E1/\u10D3\u10D0\u10EE\u10E3\u10E0\u10D5\u10D8\u10E1 \u10D3\u10E0\u10DD, \u10DB\u10DD\u10DA\u10D0\u10E0\u10D4, \u10DC\u10D0\u10E6\u10D3\u10D8, \u10E3\u10DC\u10D0\u10E6\u10D3\u10DD, \u10E1\u10D0\u10DA\u10D0\u10E0\u10DD\u10E1 \u10E1\u10D0\u10DA\u10D3\u10DD (Cash shift report: cashier, open/close, card/cash, discrepancy)",
    {
      tenant: z.string().optional().describe("Tenant ID \u10D0\u10DC Slug"),
      shiftId: z.number().optional().describe("\u10D9\u10DD\u10DC\u10D9\u10E0\u10D4\u10E2\u10E3\u10DA\u10D8 \u10EA\u10D5\u10DA\u10D8\u10E1 ID (Optional shift ID, defaults to last/active shift)")
    },
    async ({ tenant, shiftId }) => {
      try {
        const res = await getShiftAnalytics(tenant, shiftId);
        const f = res.financials;
        const summaryText = `
\u{1F4BC} **\u10E1\u10D0\u10DA\u10D0\u10E0\u10DD\u10E1 \u10EA\u10D5\u10DA\u10D8\u10E1 \u10D0\u10DC\u10D2\u10D0\u10E0\u10D8\u10E8\u10D8 #${res.shift_number} (${res.tenant_name})**
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4CC} \u10E1\u10E2\u10D0\u10E2\u10E3\u10E1\u10D8: ${res.status === "open" ? "\u{1F7E2} \u10E6\u10D8\u10D0\u10D0" : "\u{1F534} \u10D3\u10D0\u10EE\u10E3\u10E0\u10E3\u10DA\u10D8\u10D0"}
\u{1F464} \u10DB\u10DD\u10DA\u10D0\u10E0\u10D4: ${res.opened_by_name} ${res.closed_by_name ? `(\u10D3\u10D0\u10EE\u10E3\u10E0\u10D0: ${res.closed_by_name})` : ""}
\u23F0 \u10D2\u10D0\u10EE\u10E1\u10DC\u10D0: ${new Date(res.opened_at).toLocaleString("ka-GE")} ${res.closed_at ? `| \u10D3\u10D0\u10EE\u10E3\u10E0\u10D5\u10D0: ${new Date(res.closed_at).toLocaleString("ka-GE")}` : ""}

\u{1F4B0} **\u10D2\u10D0\u10E7\u10D8\u10D3\u10D5\u10D4\u10D1\u10D8 (Sales Breakdown):**
  \u2022 \u10E1\u10E3\u10DA \u10D2\u10D0\u10E7\u10D8\u10D3\u10D5\u10D0: ${f.total_sales} GEL (${res.orders_count} \u10E9\u10D4\u10D9\u10D8)
  \u2022 \u{1F4B5} \u10DC\u10D0\u10E6\u10D3\u10D8: ${f.cash_sales} GEL
  \u2022 \u{1F4B3} \u10D1\u10D0\u10E0\u10D0\u10D7\u10D8 / \u10E2\u10D4\u10E0\u10DB\u10D8\u10DC\u10D0\u10DA\u10D8: ${f.card_sales} GEL
  \u2022 \u{1F3E6} \u10D2\u10D0\u10D3\u10D0\u10E0\u10D8\u10EA\u10EE\u10D5\u10D0: ${f.transfer_sales} GEL
  \u2022 \u{1F381} \u10E4\u10D0\u10E1\u10D3\u10D0\u10D9\u10DA\u10D4\u10D1\u10D4\u10D1\u10D8: ${f.discounts} GEL

\u{1F4B5} **\u10DC\u10D0\u10E6\u10D3\u10D8 \u10E1\u10D0\u10DA\u10D0\u10E0\u10DD\u10E1 \u10DB\u10DD\u10EB\u10E0\u10D0\u10DD\u10D1\u10D0 (Physical Cash Drawer):**
  \u2022 \u10E1\u10D0\u10EC\u10E7\u10D8\u10E1\u10D8 \u10DC\u10D0\u10E6\u10D3\u10D8: ${res.initial_cash} GEL
  \u2022 \u10DC\u10D0\u10E6\u10D3\u10D8\u10E1 \u10E8\u10D4\u10DB\u10DD\u10E1\u10D5\u10DA\u10D0 (Cash In): ${f.cash_drawer_in} GEL
  \u2022 \u10E1\u10D0\u10DA\u10D0\u10E0\u10DD\u10D3\u10D0\u10DC \u10D2\u10D0\u10EA\u10D4\u10DB\u10D0 (Cash Out): ${f.cash_drawer_out} GEL
  \u2022 \u10DB\u10DD\u10E1\u10D0\u10DA\u10DD\u10D3\u10DC\u10D4\u10DA\u10D8 \u10DC\u10D0\u10E6\u10D3\u10D8 \u10E1\u10D0\u10DA\u10D0\u10E0\u10DD\u10E8\u10D8: ${f.expected_cash_drawer} GEL
  ${f.actual_cash_drawer !== void 0 ? `\u2022 \u10E4\u10D0\u10E5\u10E2\u10D8\u10E3\u10E0\u10D8 \u10DC\u10D0\u10E6\u10D3\u10D8 \u10D3\u10D0\u10EE\u10E3\u10E0\u10D5\u10D8\u10E1\u10D0\u10E1: ${f.actual_cash_drawer} GEL` : ""}
  ${f.discrepancy !== void 0 ? `\u2022 \u10E1\u10EE\u10D5\u10D0\u10DD\u10D1\u10D0 / \u10D2\u10D0\u10D3\u10D0\u10EE\u10E0\u10D0: ${f.discrepancy} GEL` : ""}

\u{1F37D}\uFE0F **\u10E6\u10D8\u10D0 \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8 \u10D3\u10D0 \u10D3\u10D4\u10DE\u10DD\u10D6\u10D8\u10E2\u10D8:**
  \u2022 \u10E6\u10D8\u10D0 \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8\u10E1 \u10D7\u10D0\u10DC\u10EE\u10D0: ${f.open_orders_sum} GEL (${f.open_orders_count} \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D0)
  \u2022 \u10D3\u10D4\u10DE\u10DD\u10D6\u10D8\u10E2\u10D8 / \u10D0\u10D5\u10D0\u10DC\u10E1\u10D8: ${f.deposit_sum} GEL
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
        return {
          content: [{ type: "text", text: summaryText.trim() + "\n\n" + JSON.stringify(res, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `\u10E8\u10D4\u10EA\u10D3\u10DD\u10DB\u10D0 \u10EA\u10D5\u10DA\u10D8\u10E1 \u10D0\u10DC\u10D2\u10D0\u10E0\u10D8\u10E8\u10D8\u10E1\u10D0\u10E1: ${err.message}` }],
          isError: true
        };
      }
    }
  );
  server.tool(
    "get_inventory_alerts",
    "\u10DB\u10D0\u10E0\u10D0\u10D2\u10D4\u10D1\u10D8\u10E1 \u10D9\u10DD\u10DC\u10E2\u10E0\u10DD\u10DA\u10D8: \u10D9\u10E0\u10D8\u10E2\u10D8\u10D9\u10E3\u10DA\u10D8 \u10DC\u10D0\u10E8\u10D7\u10D4\u10D1\u10D8 \u10D3\u10D0 \u10D3\u10D4\u10E4\u10D8\u10EA\u10D8\u10E2\u10E8\u10D8 \u10DB\u10E7\u10DD\u10E4\u10D8 \u10DE\u10E0\u10DD\u10D3\u10E3\u10E5\u10E2\u10D4\u10D1\u10D8/\u10D8\u10DC\u10D2\u10E0\u10D4\u10D3\u10D8\u10D4\u10DC\u10E2\u10D4\u10D1\u10D8 (Inventory alerts: zero stock and low stock ingredients)",
    {
      tenant: z.string().optional().describe("Tenant ID \u10D0\u10DC Slug")
    },
    async ({ tenant }) => {
      try {
        const res = await getInventoryAlerts(tenant);
        const alertsText = res.alerts.slice(0, 15).map(
          (a) => `  \u2022 ${a.status === "CRITICAL_ZERO" ? "\u{1F6A8} [\u10D0\u10DB\u10DD\u10D8\u10EC\u10E3\u10E0\u10D0]" : "\u26A0\uFE0F [\u10DB\u10EA\u10D8\u10E0\u10D4 \u10DC\u10D0\u10E8\u10D7\u10D8]"} ${a.name} \u2014 \u10DC\u10D0\u10E8\u10D7\u10D8: ${a.current_stock} (\u10DB\u10D8\u10DC\u10D8\u10DB\u10E3\u10DB\u10D8: ${a.minimum_required}, \u10D3\u10D4\u10E4\u10D8\u10EA\u10D8\u10E2\u10D8: ${a.deficit})`
        ).join("\n");
        const summaryText = `
\u{1F4E6} **\u10DB\u10D0\u10E0\u10D0\u10D2\u10D4\u10D1\u10D8\u10E1 \u10D9\u10DD\u10DC\u10E2\u10E0\u10DD\u10DA\u10D8 \u2014 ${res.tenant_name}**
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A0\uFE0F \u10E1\u10E3\u10DA \u10D2\u10D0\u10E4\u10E0\u10D7\u10EE\u10D8\u10DA\u10D4\u10D1\u10D0: ${res.total_alerts}
\u{1F6A8} \u10DC\u10E3\u10DA\u10DD\u10D5\u10D0\u10DC\u10D8 \u10DC\u10D0\u10E8\u10D7\u10D8: ${res.critical_zero_stock_count}
\u26A0\uFE0F \u10DB\u10D8\u10DC\u10D8\u10DB\u10E3\u10DB\u10D6\u10D4 \u10DC\u10D0\u10D9\u10DA\u10D4\u10D1\u10D8: ${res.low_stock_count}

\u{1F4CB} **\u10D3\u10D4\u10E4\u10D8\u10EA\u10D8\u10E2\u10E3\u10E0\u10D8 \u10D8\u10DC\u10D2\u10E0\u10D4\u10D3\u10D8\u10D4\u10DC\u10E2\u10D4\u10D1\u10D8:**
${alertsText || "  \u2022 \u10E7\u10D5\u10D4\u10DA\u10D0 \u10DE\u10E0\u10DD\u10D3\u10E3\u10E5\u10E2\u10D8\u10E1 \u10DB\u10D0\u10E0\u10D0\u10D2\u10D8 \u10DC\u10DD\u10E0\u10DB\u10D0\u10E8\u10D8\u10D0 \u2705"}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
        return {
          content: [{ type: "text", text: summaryText.trim() + "\n\n" + JSON.stringify(res, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `\u10E8\u10D4\u10EA\u10D3\u10DD\u10DB\u10D0 \u10DB\u10D0\u10E0\u10D0\u10D2\u10D4\u10D1\u10D8\u10E1 \u10E8\u10D4\u10DB\u10DD\u10EC\u10DB\u10D4\u10D1\u10D8\u10E1\u10D0\u10E1: ${err.message}` }],
          isError: true
        };
      }
    }
  );
  server.tool(
    "get_active_orders",
    "\u10DB\u10D8\u10DB\u10D3\u10D8\u10DC\u10D0\u10E0\u10D4 \u10E6\u10D8\u10D0 \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8 \u10D3\u10D0 \u10D3\u10D0\u10D9\u10D0\u10D5\u10D4\u10D1\u10E3\u10DA\u10D8 \u10DB\u10D0\u10D2\u10D8\u10D3\u10D4\u10D1\u10D8 \u10E0\u10D4\u10D0\u10DA\u10E3\u10E0 \u10D3\u10E0\u10DD\u10E8\u10D8 (Real-time active open orders and occupied tables)",
    {
      tenant: z.string().optional().describe("Tenant ID \u10D0\u10DC Slug")
    },
    async ({ tenant }) => {
      try {
        const res = await getActiveOrders(tenant);
        const ordersText = res.orders.map(
          (o) => `  \u2022 \u10DB\u10D0\u10D2\u10D8\u10D3\u10D0 #${o.table_number} (${o.room_name}) \u2014 ${o.total_amount} GEL | ${o.guests_count} \u10E1\u10E2\u10E3\u10DB\u10D0\u10E0\u10D8 | \u10DB\u10D8\u10DB\u10E2\u10D0\u10DC\u10D8: ${o.waiter_name} | \u10D2\u10D0\u10E6\u10D4\u10D1\u10E3\u10DA\u10D8\u10D0: ${o.duration_minutes} \u10EC\u10E3\u10D7\u10D8\u10E1 \u10EC\u10D8\u10DC (${o.items_count} \u10DE\u10DD\u10D6\u10D8\u10EA\u10D8\u10D0)`
        ).join("\n");
        const summaryText = `
\u{1F37D}\uFE0F **\u10DB\u10D8\u10DB\u10D3\u10D8\u10DC\u10D0\u10E0\u10D4 \u10E6\u10D8\u10D0 \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8 \u2014 ${res.tenant_name}**
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F7E2} \u10D0\u10E5\u10E2\u10D8\u10E3\u10E0\u10D8 \u10DB\u10D0\u10D2\u10D8\u10D3\u10D4\u10D1\u10D8 (Live Tables): ${res.active_tables_count}
\u{1F4B0} \u10E6\u10D8\u10D0 \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8\u10E1 \u10D7\u10D0\u10DC\u10EE\u10D0 \u10EF\u10D0\u10DB\u10E8\u10D8: ${res.total_open_amount} GEL
\u{1F465} \u10E1\u10E2\u10E3\u10DB\u10E0\u10D4\u10D1\u10D8\u10E1 \u10E0\u10D0\u10DD\u10D3\u10D4\u10DC\u10DD\u10D1\u10D0: ${res.total_guests}
${res.stale_unclosed_orders_count > 0 ? `\u26A0\uFE0F \u10EB\u10D5\u10D4\u10DA\u10D8 \u10D3\u10D0\u10E3\u10EE\u10E3\u10E0\u10D0\u10D5\u10D8 \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8 (>24 \u10E1\u10D7): ${res.stale_unclosed_orders_count}
` : ""}
\u{1F4CB} **\u10DB\u10D0\u10D2\u10D8\u10D3\u10D4\u10D1\u10D8\u10E1 \u10E1\u10D8\u10D0:**
${ordersText || "  \u2022 \u10D0\u10DB \u10DB\u10DD\u10DB\u10D4\u10DC\u10E2\u10E8\u10D8 \u10E7\u10D5\u10D4\u10DA\u10D0 \u10DB\u10D0\u10D2\u10D8\u10D3\u10D0 \u10D7\u10D0\u10D5\u10D8\u10E1\u10E3\u10E4\u10D0\u10DA\u10D8\u10D0"}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
        return {
          content: [{ type: "text", text: summaryText.trim() + "\n\n" + JSON.stringify(res, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `\u10E8\u10D4\u10EA\u10D3\u10DD\u10DB\u10D0 \u10E6\u10D8\u10D0 \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8\u10E1 \u10DB\u10D8\u10E6\u10D4\u10D1\u10D8\u10E1\u10D0\u10E1: ${err.message}` }],
          isError: true
        };
      }
    }
  );
  server.tool(
    "get_staff_performance",
    "\u10DE\u10D4\u10E0\u10E1\u10DD\u10DC\u10D0\u10DA\u10D8\u10E1 \u10E8\u10D4\u10D3\u10D4\u10D2\u10D4\u10D1\u10D8 \u10D3\u10D0 \u10E0\u10D4\u10D8\u10E2\u10D8\u10DC\u10D2\u10D8: \u10DD\u10E4\u10D8\u10EA\u10D8\u10D0\u10DC\u10E2\u10D4\u10D1\u10D8\u10E1 \u10D2\u10D0\u10E7\u10D8\u10D3\u10D5\u10D4\u10D1\u10D8, \u10E9\u10D4\u10D9\u10D4\u10D1\u10D8\u10E1 \u10E0\u10D0\u10DD\u10D3\u10D4\u10DC\u10DD\u10D1\u10D0 \u10D3\u10D0 \u10E1\u10D0\u10E8\u10E3\u10D0\u10DA\u10DD \u10E9\u10D4\u10D9\u10D8 (Staff performance: sales ranking, order counts, average check per waiter)",
    {
      tenant: z.string().optional().describe("Tenant ID \u10D0\u10DC Slug"),
      period: z.enum(["today", "yesterday", "this_week", "this_month", "last_month", "custom"]).default("today"),
      startDate: z.string().optional().describe("YYYY-MM-DD"),
      endDate: z.string().optional().describe("YYYY-MM-DD")
    },
    async ({ tenant, period, startDate, endDate }) => {
      try {
        const res = await getStaffPerformance(tenant, period, startDate, endDate);
        const rankText = res.ranking.map(
          (s, idx) => `  ${idx + 1}. ${s.name} (${s.role}) \u2014 ${s.total_revenue} GEL (${s.orders_count} \u10E9\u10D4\u10D9\u10D8, \u10E1\u10D0\u10E8\u10E3\u10D0\u10DA\u10DD: ${s.average_check} GEL)`
        ).join("\n");
        const summaryText = `
\u{1F465} **\u10DE\u10D4\u10E0\u10E1\u10DD\u10DC\u10D0\u10DA\u10D8\u10E1 \u10E8\u10D4\u10D3\u10D4\u10D2\u10D4\u10D1\u10D8 \u2014 ${res.period_label}**
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4CB} **\u10E0\u10D4\u10D8\u10E2\u10D8\u10DC\u10D2\u10D8 \u10D2\u10D0\u10E7\u10D8\u10D3\u10D5\u10D4\u10D1\u10D8\u10E1 \u10DB\u10D8\u10EE\u10D4\u10D3\u10D5\u10D8\u10D7:**
${rankText || "  \u2022 \u10E9\u10D0\u10DC\u10D0\u10EC\u10D4\u10E0\u10D4\u10D1\u10D8 \u10D0\u10E0 \u10DB\u10DD\u10D8\u10EB\u10D4\u10D1\u10DC\u10D0"}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
        return {
          content: [{ type: "text", text: summaryText.trim() + "\n\n" + JSON.stringify(res, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `\u10E8\u10D4\u10EA\u10D3\u10DD\u10DB\u10D0 \u10DE\u10D4\u10E0\u10E1\u10DD\u10DC\u10D0\u10DA\u10D8\u10E1 \u10D0\u10DC\u10D0\u10DA\u10D8\u10D6\u10D8\u10E1\u10D0\u10E1: ${err.message}` }],
          isError: true
        };
      }
    }
  );
  server.tool(
    "search_orders",
    "\u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8\u10E1 \u10EB\u10D4\u10D1\u10DC\u10D0 \u10D3\u10D0 \u10E4\u10D8\u10DA\u10E2\u10E0\u10D0\u10EA\u10D8\u10D0: \u10DC\u10DD\u10DB\u10E0\u10D8\u10D7, \u10DB\u10D0\u10D2\u10D8\u10D3\u10D8\u10D7, \u10DB\u10D8\u10E2\u10D0\u10DC\u10D8\u10E1 \u10E2\u10D8\u10DE\u10D8\u10D7 (Glovo/Bolt/Wolt/Taxi), \u10DB\u10D8\u10DB\u10E2\u10D0\u10DC\u10D8\u10D7 \u10D0\u10DC \u10E1\u10E2\u10D0\u10E2\u10E3\u10E1\u10D8\u10D7 (Search and filter orders by ID, table, delivery service, waiter, status, date)",
    {
      tenant: z.string().optional().describe("Tenant ID \u10D0\u10DC Slug"),
      query: z.string().optional().describe("\u10E1\u10D0\u10EB\u10D8\u10D4\u10D1\u10DD \u10E1\u10D8\u10E2\u10E7\u10D5\u10D0 (ID, \u10DB\u10D0\u10D2\u10D8\u10D3\u10D8\u10E1 \u10DC\u10DD\u10DB\u10D4\u10E0\u10D8, \u10D9\u10D4\u10E0\u10EB\u10D8\u10E1 \u10E1\u10D0\u10EE\u10D4\u10DA\u10D8, \u10DB\u10D8\u10DB\u10E2\u10D0\u10DC\u10D8)"),
      deliveryType: z.enum(["all", "glovo", "bolt", "wolt", "taxi", "delivery", "dine_in"]).default("all").describe("\u10DB\u10D8\u10E2\u10D0\u10DC\u10D8\u10E1 \u10E2\u10D8\u10DE\u10D8 (Glovo, Bolt, Wolt, Taxi, \u10D0\u10D3\u10D2\u10D8\u10DA\u10D6\u10D4)"),
      status: z.enum(["all", "open", "closed", "completed", "canceled"]).default("all").describe("\u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D8\u10E1 \u10E1\u10E2\u10D0\u10E2\u10E3\u10E1\u10D8"),
      period: z.enum(["today", "yesterday", "this_week", "this_month", "last_month", "custom"]).optional(),
      startDate: z.string().optional().describe("YYYY-MM-DD"),
      endDate: z.string().optional().describe("YYYY-MM-DD"),
      orderId: z.number().optional().describe("\u10D9\u10DD\u10DC\u10D9\u10E0\u10D4\u10E2\u10E3\u10DA\u10D8 \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D8\u10E1 ID"),
      limit: z.number().default(20).describe("\u10DB\u10D0\u10E5\u10E1\u10D8\u10DB\u10D0\u10DA\u10E3\u10E0\u10D8 \u10E0\u10D0\u10DD\u10D3\u10D4\u10DC\u10DD\u10D1\u10D0")
    },
    async ({ tenant, query, deliveryType, status, period, startDate, endDate, orderId, limit }) => {
      try {
        const { searchOrders: searchOrders2 } = await Promise.resolve().then(() => (init_orderSearch(), orderSearch_exports));
        const res = await searchOrders2(tenant, {
          query,
          deliveryType,
          status,
          period,
          startDate,
          endDate,
          orderId,
          limit
        });
        const listText = res.orders.map(
          (o) => `\u2022 [ID: #${o.order_id}] ${o.delivery_type ? `\u{1F6F5} [${o.delivery_type.toUpperCase()}]` : `\u{1F37D}\uFE0F \u10DB\u10D0\u10D2\u10D8\u10D3\u10D0 #${o.table_number}`} | ${o.total_price} GEL | \u10E1\u10E2\u10D0\u10E2\u10E3\u10E1\u10D8: ${o.status} | \u10D7\u10D0\u10E0\u10D8\u10E6\u10D8: ${new Date(o.date).toLocaleString("ka-GE")} | \u10DB\u10D8\u10DB\u10E2\u10D0\u10DC\u10D8: ${o.waiter_name}
  \u10D9\u10D4\u10E0\u10EB\u10D4\u10D1\u10D8: ${o.items_summary || "\u2014"}`
        ).join("\n\n");
        const summaryText = `
\u{1F50D} **\u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8\u10E1 \u10EB\u10D4\u10D1\u10DC\u10D8\u10E1 \u10E8\u10D4\u10D3\u10D4\u10D2\u10D4\u10D1\u10D8 \u2014 ${res.tenant_name}**
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u10E1\u10E3\u10DA \u10DB\u10DD\u10D8\u10EB\u10D4\u10D1\u10DC\u10D0: ${res.total_found} \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D0

${listText || "\u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8 \u10DB\u10DD\u10EA\u10D4\u10DB\u10E3\u10DA\u10D8 \u10DE\u10D0\u10E0\u10D0\u10DB\u10D4\u10E2\u10E0\u10D4\u10D1\u10D8\u10D7 \u10D5\u10D4\u10E0 \u10DB\u10DD\u10D8\u10EB\u10D4\u10D1\u10DC\u10D0."}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
        return {
          content: [{ type: "text", text: summaryText.trim() + "\n\n" + JSON.stringify(res, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `\u10E8\u10D4\u10EA\u10D3\u10DD\u10DB\u10D0 \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8\u10E1 \u10EB\u10D4\u10D1\u10DC\u10D8\u10E1\u10D0\u10E1: ${err.message}` }],
          isError: true
        };
      }
    }
  );
  server.tool(
    "get_order_details",
    "\u10D9\u10DD\u10DC\u10D9\u10E0\u10D4\u10E2\u10E3\u10DA\u10D8 \u10E9\u10D4\u10D9\u10D8\u10E1/\u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D8\u10E1 \u10E1\u10E0\u10E3\u10DA\u10D8 \u10D3\u10D4\u10E2\u10D0\u10DA\u10D4\u10D1\u10D8: \u10D9\u10D4\u10E0\u10EB\u10D4\u10D1\u10D8\u10E1 \u10E1\u10D8\u10D0, \u10E0\u10D0\u10DD\u10D3\u10D4\u10DC\u10DD\u10D1\u10D4\u10D1\u10D8, \u10E4\u10D0\u10E1\u10D4\u10D1\u10D8, \u10E4\u10D0\u10E1\u10D3\u10D0\u10D9\u10DA\u10D4\u10D1\u10D4\u10D1\u10D8, \u10D2\u10D0\u10D3\u10D0\u10EE\u10D3\u10D8\u10E1 \u10E9\u10D0\u10DC\u10D0\u10EC\u10D4\u10E0\u10D4\u10D1\u10D8 (Detailed receipt/order breakdown: dishes, prices, quantities, payments, comments)",
    {
      orderId: z.number().describe("\u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D8\u10E1 ID (Order ID)"),
      tenant: z.string().optional().describe("Tenant ID \u10D0\u10DC Slug")
    },
    async ({ orderId, tenant }) => {
      try {
        const { getOrderDetails: getOrderDetails2 } = await Promise.resolve().then(() => (init_orderSearch(), orderSearch_exports));
        const res = await getOrderDetails2(orderId, tenant);
        const itemsText = res.items.map(
          (it, idx) => `  ${idx + 1}. ${it.name} \u2014 ${it.count} x ${it.unit_price} GEL = ${it.total_price} GEL ${it.comment ? `(${it.comment})` : ""}`
        ).join("\n");
        const paymentsText = res.payments.map(
          (p) => `  \u2022 ${p.payment_method.toUpperCase()}: ${p.amount} GEL (\u10EE\u10E3\u10E0\u10D3\u10D0: ${p.change_back} GEL)`
        ).join("\n");
        const summaryText = `
\u{1F9FE} **\u10E9\u10D4\u10D9\u10D8\u10E1 \u10D3\u10D4\u10E2\u10D0\u10DA\u10D4\u10D1\u10D8: \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D0 #${res.order_id} (${res.tenant_name})**
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4CC} \u10E1\u10E2\u10D0\u10E2\u10E3\u10E1\u10D8: ${res.status} | \u10D7\u10D0\u10E0\u10D8\u10E6\u10D8: ${new Date(res.date).toLocaleString("ka-GE")}
\u{1F4CD} \u10DB\u10D0\u10D2\u10D8\u10D3\u10D0: #${res.table_number} (${res.room_name})
\u{1F464} \u10DB\u10D8\u10DB\u10E2\u10D0\u10DC\u10D8: ${res.waiter_name}
${res.delivery_type ? `\u{1F6F5} \u10DB\u10D8\u10E2\u10D0\u10DC\u10D8\u10E1 \u10E2\u10D8\u10DE\u10D8: ${res.delivery_type}` : ""}

\u{1F37D}\uFE0F **\u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D8\u10DA\u10D8 \u10DE\u10DD\u10D6\u10D8\u10EA\u10D8\u10D4\u10D1\u10D8:**
${itemsText || "  \u2022 \u10DE\u10DD\u10D6\u10D8\u10EA\u10D8\u10D4\u10D1\u10D8 \u10D0\u10E0 \u10D0\u10E0\u10D8\u10E1"}

\u{1F4B0} **\u10EF\u10D0\u10DB\u10D8:**
  \u2022 \u10E1\u10E3\u10DA \u10D7\u10D0\u10DC\u10EE\u10D0: ${res.total_price} GEL
  \u2022 \u10DB\u10DD\u10DB\u10E1\u10D0\u10EE\u10E3\u10E0\u10D4\u10D1\u10D0: ${res.service_fee} GEL
  \u2022 \u10E4\u10D0\u10E1\u10D3\u10D0\u10D9\u10DA\u10D4\u10D1\u10D0: ${res.discount_amount} GEL
  \u2022 \u10D0\u10D5\u10D0\u10DC\u10E1\u10D8 / \u10D3\u10D4\u10DE\u10DD\u10D6\u10D8\u10E2\u10D8: ${res.prepayment} GEL

\u{1F4B3} **\u10D2\u10D0\u10D3\u10D0\u10EE\u10D3\u10D4\u10D1\u10D8:**
${paymentsText || "  \u2022 \u10D2\u10D0\u10D3\u10D0\u10EE\u10D3\u10D0 \u10EF\u10D4\u10E0 \u10D0\u10E0 \u10D3\u10D0\u10E4\u10D8\u10E5\u10E1\u10D8\u10E0\u10D4\u10D1\u10E3\u10DA\u10D0"}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
        return {
          content: [{ type: "text", text: summaryText.trim() + "\n\n" + JSON.stringify(res, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `\u10E8\u10D4\u10EA\u10D3\u10DD\u10DB\u10D0 \u10E9\u10D4\u10D9\u10D8\u10E1 \u10D3\u10D4\u10E2\u10D0\u10DA\u10D4\u10D1\u10D8\u10E1 \u10DB\u10D8\u10E6\u10D4\u10D1\u10D8\u10E1\u10D0\u10E1: ${err.message}` }],
          isError: true
        };
      }
    }
  );
  server.tool(
    "get_delivery_orders",
    "\u10DB\u10D8\u10E2\u10D0\u10DC\u10D8\u10E1\u10D0 \u10D3\u10D0 \u10DD\u10DC\u10DA\u10D0\u10D8\u10DC \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8\u10E1 \u10E1\u10D8\u10D0 (Glovo, Bolt Food, Wolt, Taxi, Web Orders) \u10E2\u10D4\u10DA\u10D4\u10E4\u10DD\u10DC\u10D8\u10D7, \u10DB\u10D8\u10E1\u10D0\u10DB\u10D0\u10E0\u10D7\u10D8\u10D7 \u10D3\u10D0 \u10E1\u10E2\u10D0\u10E2\u10E3\u10E1\u10D8\u10D7 (Delivery and online orders registry with phone, address, platform, and items)",
    {
      tenant: z.string().optional().describe("Tenant ID \u10D0\u10DC Slug"),
      platform: z.enum(["all", "glovo", "bolt", "wolt", "taxi", "web"]).default("all").describe("\u10DE\u10DA\u10D0\u10E2\u10E4\u10DD\u10E0\u10DB\u10D0 (Glovo, Bolt, Wolt, Taxi, Web)"),
      limit: z.number().default(20).describe("\u10E0\u10D0\u10DD\u10D3\u10D4\u10DC\u10DD\u10D1\u10D0")
    },
    async ({ tenant, platform, limit }) => {
      try {
        const { getDeliveryOrders: getDeliveryOrders2 } = await Promise.resolve().then(() => (init_orderSearch(), orderSearch_exports));
        const res = await getDeliveryOrders2(tenant, { platform, limit });
        const webText = res.web_orders.map(
          (w) => `\u2022 [Web #${w.id}] ${w.price} GEL | ${w.phone} | \u10DB\u10D8\u10E1\u10D0\u10DB\u10D0\u10E0\u10D7\u10D8: ${w.address} | \u10E1\u10E2\u10D0\u10E2\u10E3\u10E1\u10D8: ${w.status} (${new Date(w.date).toLocaleString("ka-GE")})`
        ).join("\n");
        const posText = res.pos_delivery_orders.map(
          (p) => `\u2022 [POS #${p.order_id}] ${p.delivery_type ? `[${p.delivery_type.toUpperCase()}]` : "[DELIVERY]"} ${p.total_price} GEL | \u10DB\u10D0\u10D2\u10D8\u10D3\u10D0: ${p.table_number} | \u10E1\u10E2\u10D0\u10E2\u10E3\u10E1\u10D8: ${p.status} (${new Date(p.date).toLocaleString("ka-GE")})
  \u10D9\u10D4\u10E0\u10EB\u10D4\u10D1\u10D8: ${p.items_summary || "\u2014"}`
        ).join("\n");
        const summaryText = `
\u{1F6F5} **\u10DB\u10D8\u10E2\u10D0\u10DC\u10D8\u10E1 \u10D3\u10D0 \u10DD\u10DC\u10DA\u10D0\u10D8\u10DC \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8 \u2014 ${res.tenant_name}**
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4E6} \u10D5\u10D4\u10D1-\u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8 (Web Orders): ${res.web_orders_count}
\u{1F6F5} POS \u10DB\u10D8\u10E2\u10D0\u10DC\u10D8\u10E1 \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8: ${res.pos_delivery_orders_count}

\u{1F310} **\u10D5\u10D4\u10D1 \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8:**
${webText || "  \u2022 \u10D5\u10D4\u10D1 \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8 \u10D0\u10E0 \u10D0\u10E0\u10D8\u10E1"}

\u{1F3EA} **POS \u10DB\u10D8\u10E2\u10D0\u10DC\u10D8\u10E1 \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8:**
${posText || "  \u2022 POS \u10DB\u10D8\u10E2\u10D0\u10DC\u10D8\u10E1 \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8 \u10D0\u10E0 \u10D0\u10E0\u10D8\u10E1"}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
        return {
          content: [{ type: "text", text: summaryText.trim() + "\n\n" + JSON.stringify(res, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `\u10E8\u10D4\u10EA\u10D3\u10DD\u10DB\u10D0 \u10DB\u10D8\u10E2\u10D0\u10DC\u10D8\u10E1 \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8\u10E1 \u10DB\u10D8\u10E6\u10D4\u10D1\u10D8\u10E1\u10D0\u10E1: ${err.message}` }],
          isError: true
        };
      }
    }
  );
  server.tool(
    "get_purchases_analytics",
    "\u10E8\u10D4\u10E1\u10E7\u10D8\u10D3\u10D5\u10D4\u10D1\u10D8\u10E1\u10D0 \u10D3\u10D0 \u10DB\u10D8\u10E6\u10D4\u10D1\u10D4\u10D1\u10D8\u10E1 \u10E1\u10E0\u10E3\u10DA\u10D8 \u10D0\u10DC\u10D0\u10DA\u10D8\u10E2\u10D8\u10D9\u10D0: \u10EF\u10D0\u10DB\u10E3\u10E0\u10D8 \u10E8\u10D4\u10E1\u10E7\u10D8\u10D3\u10D5\u10D4\u10D1\u10D8, \u10DB\u10DD\u10DB\u10EC\u10DD\u10D3\u10D4\u10D1\u10DA\u10D4\u10D1\u10D8, \u10E1\u10D0\u10EC\u10E7\u10DD\u10D1\u10D4\u10D1\u10D8 \u10D3\u10D0 \u10E2\u10DD\u10DE \u10E8\u10D4\u10E1\u10E7\u10D8\u10D3\u10E3\u10DA\u10D8 \u10DE\u10E0\u10DD\u10D3\u10E3\u10E5\u10E2\u10D4\u10D1\u10D8 (Purchases and procurement analytics by period, suppliers, warehouses, top products)",
    {
      tenant: z.string().optional().describe("Tenant ID \u10D0\u10DC Slug"),
      period: z.enum(["today", "yesterday", "this_week", "this_month", "last_month", "custom"]).default("this_month").describe("\u10E1\u10D0\u10D0\u10DC\u10D2\u10D0\u10E0\u10D8\u10E8\u10DD \u10DE\u10D4\u10E0\u10D8\u10DD\u10D3\u10D8"),
      startDate: z.string().optional().describe("\u10E1\u10D0\u10EC\u10E7\u10D8\u10E1\u10D8 \u10D7\u10D0\u10E0\u10D8\u10E6\u10D8 YYYY-MM-DD (\u10D7\u10E3 period=custom)"),
      endDate: z.string().optional().describe("\u10E1\u10D0\u10D1\u10DD\u10DA\u10DD\u10DD \u10D7\u10D0\u10E0\u10D8\u10E6\u10D8 YYYY-MM-DD (\u10D7\u10E3 period=custom)"),
      supplierId: z.union([z.string(), z.number()]).optional().describe("\u10E4\u10D8\u10DA\u10E2\u10E0\u10D8 \u10D9\u10DD\u10DC\u10D9\u10E0\u10D4\u10E2\u10E3\u10DA \u10DB\u10DD\u10DB\u10EC\u10DD\u10D3\u10D4\u10D1\u10D4\u10DA\u10D6\u10D4"),
      warehouse: z.string().optional().describe("\u10E1\u10D0\u10EC\u10E7\u10DD\u10D1\u10D8 (bar, kitchen, main, ALL)")
    },
    async ({ tenant, period, startDate, endDate, supplierId, warehouse }) => {
      try {
        const res = await getPurchasesAnalytics(tenant, period, startDate, endDate, supplierId, warehouse);
        const cur = res.tenant.currency;
        const supText = res.suppliers_summary.slice(0, 8).map(
          (s, idx) => `  ${idx + 1}. ${s.supplier_name} \u2014 ${s.total_amount} ${cur} (${s.invoices_count} \u10D6\u10D4\u10D3\u10DC\u10D0\u10D3\u10D4\u10D1\u10D8, ${s.items_count} \u10DE\u10DD\u10D6\u10D8\u10EA\u10D8\u10D0)`
        ).join("\n");
        const whText = res.warehouse_breakdown.map(
          (w) => `  \u2022 ${w.warehouse_name}: ${w.total_amount} ${cur} (${w.items_count} \u10DE\u10DD\u10D6\u10D8\u10EA\u10D8\u10D0)`
        ).join("\n");
        const topProdsText = res.top_purchased_products.slice(0, 10).map(
          (p, idx) => `  ${idx + 1}. ${p.product_name} \u2014 ${p.total_amount} ${cur} (${p.total_quantity} ${p.unit_name}, \u10E1\u10D0\u10E8. \u10E4\u10D0\u10E1\u10D8: ${p.average_unit_price} ${cur})`
        ).join("\n");
        const summaryText = `
\u{1F69A} **\u10E8\u10D4\u10E1\u10E7\u10D8\u10D3\u10D5\u10D4\u10D1\u10D8\u10E1 \u10D0\u10DC\u10D0\u10DA\u10D8\u10E2\u10D8\u10D9\u10D0 \u2014 ${res.tenant.name} (${res.period_label})**
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4B0} **\u10EF\u10D0\u10DB\u10E3\u10E0\u10D8 \u10E8\u10D4\u10E1\u10E7\u10D8\u10D3\u10D5\u10D4\u10D1\u10D8:** ${res.summary.total_purchase_amount} ${cur}
\u{1F4D1} **\u10D6\u10D4\u10D3\u10DC\u10D0\u10D3\u10D4\u10D1\u10D4\u10D1\u10D8\u10E1 \u10E0\u10D0\u10DD\u10D3\u10D4\u10DC\u10DD\u10D1\u10D0:** ${res.summary.total_invoices_count} (\u10E1\u10D0\u10E8\u10E3\u10D0\u10DA\u10DD \u10D6\u10D4\u10D3\u10DC\u10D0\u10D3\u10D4\u10D1\u10D8: ${res.summary.average_invoice_amount} ${cur})
\u{1F4E6} **\u10E8\u10D4\u10E1\u10E7\u10D8\u10D3\u10E3\u10DA\u10D8 \u10DE\u10DD\u10D6\u10D8\u10EA\u10D8\u10D4\u10D1\u10D8:** ${res.summary.total_items_count} \u10E9\u10D0\u10DC\u10D0\u10EC\u10D4\u10E0\u10D8

\u{1F3DB}\uFE0F **\u10D2\u10D0\u10DC\u10D0\u10EC\u10D8\u10DA\u10D4\u10D1\u10D0 \u10E1\u10D0\u10EC\u10E7\u10DD\u10D1\u10D4\u10D1\u10D8\u10E1 \u10DB\u10D8\u10EE\u10D4\u10D3\u10D5\u10D8\u10D7:**
${whText || "  \u2022 \u10DB\u10DD\u10DC\u10D0\u10EA\u10D4\u10DB\u10D4\u10D1\u10D8 \u10D0\u10E0 \u10D0\u10E0\u10D8\u10E1"}

\u{1F69A} **\u10E2\u10DD\u10DE \u10DB\u10DD\u10DB\u10EC\u10DD\u10D3\u10D4\u10D1\u10DA\u10D4\u10D1\u10D8:**
${supText || "  \u2022 \u10DB\u10DD\u10DB\u10EC\u10DD\u10D3\u10D4\u10D1\u10DA\u10D4\u10D1\u10D8 \u10D0\u10E0 \u10E4\u10D8\u10E5\u10E1\u10D8\u10E0\u10D3\u10D4\u10D1\u10D0"}

\u{1F51D} **\u10E2\u10DD\u10DE \u10E8\u10D4\u10E1\u10E7\u10D8\u10D3\u10E3\u10DA\u10D8 \u10DE\u10E0\u10DD\u10D3\u10E3\u10E5\u10E2\u10D4\u10D1\u10D8:**
${topProdsText || "  \u2022 \u10DE\u10E0\u10DD\u10D3\u10E3\u10E5\u10E2\u10D4\u10D1\u10D8 \u10D0\u10E0 \u10E4\u10D8\u10E5\u10E1\u10D8\u10E0\u10D3\u10D4\u10D1\u10D0"}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
        return {
          content: [{ type: "text", text: summaryText.trim() + "\n\n" + JSON.stringify(res, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `\u10E8\u10D4\u10EA\u10D3\u10DD\u10DB\u10D0 \u10E8\u10D4\u10E1\u10E7\u10D8\u10D3\u10D5\u10D4\u10D1\u10D8\u10E1 \u10D0\u10DC\u10D0\u10DA\u10D8\u10D6\u10D8\u10E1\u10D0\u10E1: ${err.message}` }],
          isError: true
        };
      }
    }
  );
  server.tool(
    "search_purchases",
    "\u10E8\u10D4\u10E1\u10E7\u10D8\u10D3\u10D5\u10D4\u10D1\u10D8\u10E1/\u10D6\u10D4\u10D3\u10DC\u10D0\u10D3\u10D4\u10D1\u10D4\u10D1\u10D8\u10E1 \u10EB\u10D4\u10D1\u10DC\u10D0 \u10D3\u10D0 \u10E4\u10D8\u10DA\u10E2\u10E0\u10D0\u10EA\u10D8\u10D0: \u10D6\u10D4\u10D3\u10DC\u10D0\u10D3\u10D4\u10D1\u10D8\u10E1 \u10DC\u10DD\u10DB\u10E0\u10D8\u10D7, \u10DE\u10E0\u10DD\u10D3\u10E3\u10E5\u10E2\u10D8\u10E1 \u10E1\u10D0\u10EE\u10D4\u10DA\u10D8\u10D7 \u10D0\u10DC \u10DB\u10DD\u10DB\u10EC\u10DD\u10D3\u10D4\u10D1\u10DA\u10D8\u10D7 (Search purchases and invoices by waybill code, product name, supplier)",
    {
      tenant: z.string().optional().describe("Tenant ID \u10D0\u10DC Slug"),
      query: z.string().optional().describe("\u10E1\u10D0\u10EB\u10D8\u10D4\u10D1\u10DD \u10E2\u10D4\u10E5\u10E1\u10E2\u10D8 (\u10D6\u10D4\u10D3\u10DC\u10D0\u10D3\u10D4\u10D1\u10D8\u10E1 \u10DC\u10DD\u10DB\u10D4\u10E0\u10D8 \u10D0\u10DC \u10DE\u10E0\u10DD\u10D3\u10E3\u10E5\u10E2\u10D8\u10E1 \u10E1\u10D0\u10EE\u10D4\u10DA\u10D8)"),
      supplierId: z.union([z.string(), z.number()]).optional().describe("\u10DB\u10DD\u10DB\u10EC\u10DD\u10D3\u10D4\u10D1\u10DA\u10D8\u10E1 ID"),
      warehouse: z.string().optional().describe("\u10E1\u10D0\u10EC\u10E7\u10DD\u10D1\u10D8 (bar, kitchen, main, ALL)"),
      period: z.enum(["today", "yesterday", "this_week", "this_month", "last_month", "custom"]).optional(),
      startDate: z.string().optional().describe("YYYY-MM-DD"),
      endDate: z.string().optional().describe("YYYY-MM-DD"),
      limit: z.number().default(25).describe("\u10DB\u10D0\u10E5\u10E1\u10D8\u10DB\u10D0\u10DA\u10E3\u10E0\u10D8 \u10E0\u10D0\u10DD\u10D3\u10D4\u10DC\u10DD\u10D1\u10D0")
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
        const listText = res.items.map(
          (it) => `\u2022 [\u10D6\u10D4\u10D3\u10DC\u10D0\u10D3\u10D4\u10D1\u10D8: ${it.invoice_code}] ${it.product_name} \u2014 ${it.quantity} ${it.unit_name} x ${it.unit_price} GEL = ${it.total_price} GEL | \u10DB\u10DD\u10DB\u10EC\u10DD\u10D3\u10D4\u10D1\u10D4\u10DA\u10D8: ${it.supplier_name} | \u10D7\u10D0\u10E0\u10D8\u10E6\u10D8: ${new Date(it.date).toLocaleDateString("ka-GE")}`
        ).join("\n");
        const summaryText = `
\u{1F50D} **\u10E8\u10D4\u10E1\u10E7\u10D8\u10D3\u10D5\u10D4\u10D1\u10D8\u10E1 \u10EB\u10D4\u10D1\u10DC\u10D8\u10E1 \u10E8\u10D4\u10D3\u10D4\u10D2\u10D4\u10D1\u10D8 \u2014 ${res.tenant_name}**
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u10E1\u10E3\u10DA \u10DB\u10DD\u10D8\u10EB\u10D4\u10D1\u10DC\u10D0: ${res.total_found} \u10E9\u10D0\u10DC\u10D0\u10EC\u10D4\u10E0\u10D8

${listText || "\u10E9\u10D0\u10DC\u10D0\u10EC\u10D4\u10E0\u10D4\u10D1\u10D8 \u10DB\u10DD\u10EA\u10D4\u10DB\u10E3\u10DA\u10D8 \u10DE\u10D0\u10E0\u10D0\u10DB\u10D4\u10E2\u10E0\u10D4\u10D1\u10D8\u10D7 \u10D5\u10D4\u10E0 \u10DB\u10DD\u10D8\u10EB\u10D4\u10D1\u10DC\u10D0."}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
        return {
          content: [{ type: "text", text: summaryText.trim() + "\n\n" + JSON.stringify(res, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `\u10E8\u10D4\u10EA\u10D3\u10DD\u10DB\u10D0 \u10E8\u10D4\u10E1\u10E7\u10D8\u10D3\u10D5\u10D4\u10D1\u10D8\u10E1 \u10EB\u10D4\u10D1\u10DC\u10D8\u10E1\u10D0\u10E1: ${err.message}` }],
          isError: true
        };
      }
    }
  );
  server.tool(
    "get_purchase_details",
    "\u10D9\u10DD\u10DC\u10D9\u10E0\u10D4\u10E2\u10E3\u10DA\u10D8 \u10D6\u10D4\u10D3\u10DC\u10D0\u10D3\u10D4\u10D1\u10D8\u10E1/\u10E8\u10D4\u10E1\u10E7\u10D8\u10D3\u10D5\u10D8\u10E1 \u10E1\u10E0\u10E3\u10DA\u10D8 \u10E8\u10D4\u10DB\u10D0\u10D3\u10D2\u10D4\u10DC\u10DA\u10DD\u10D1\u10D0: \u10DE\u10E0\u10DD\u10D3\u10E3\u10E5\u10E2\u10D4\u10D1\u10D8, \u10E0\u10D0\u10DD\u10D3\u10D4\u10DC\u10DD\u10D1\u10D4\u10D1\u10D8, \u10E8\u10D4\u10E1\u10D0\u10E1\u10E7\u10D8\u10D3\u10D8 \u10E4\u10D0\u10E1\u10D4\u10D1\u10D8 \u10D3\u10D0 \u10DB\u10DD\u10DB\u10EC\u10DD\u10D3\u10D4\u10D1\u10D4\u10DA\u10D8 (Detailed invoice line items breakdown, quantities, purchase prices, supplier info)",
    {
      invoiceCode: z.union([z.string(), z.number()]).describe("\u10D6\u10D4\u10D3\u10DC\u10D0\u10D3\u10D4\u10D1\u10D8\u10E1 \u10DC\u10DD\u10DB\u10D4\u10E0\u10D8 (Code) \u10D0\u10DC \u10E8\u10D4\u10E1\u10E7\u10D8\u10D3\u10D5\u10D8\u10E1 ID"),
      tenant: z.string().optional().describe("Tenant ID \u10D0\u10DC Slug")
    },
    async ({ invoiceCode, tenant }) => {
      try {
        const res = await getPurchaseDetails(invoiceCode, tenant);
        const itemsText = res.items.map(
          (it, idx) => `  ${idx + 1}. ${it.product_name} \u2014 ${it.quantity} ${it.unit_name} x ${it.unit_price} GEL = ${it.total_price} GEL`
        ).join("\n");
        const summaryText = `
\u{1F4D1} **\u10D6\u10D4\u10D3\u10DC\u10D0\u10D3\u10D4\u10D1\u10D8\u10E1 \u10D3\u10D4\u10E2\u10D0\u10DA\u10D4\u10D1\u10D8: #${res.invoice_code} (${res.tenant_name})**
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4C5} \u10D7\u10D0\u10E0\u10D8\u10E6\u10D8: ${new Date(res.date).toLocaleString("ka-GE")}
\u{1F3E2} \u10E1\u10D0\u10EC\u10E7\u10DD\u10D1\u10D8: ${res.warehouse_type}
\u{1F69A} \u10DB\u10DD\u10DB\u10EC\u10DD\u10D3\u10D4\u10D1\u10D4\u10DA\u10D8: ${res.supplier.name} ${res.supplier.code ? `(\u10E1/\u10D9: ${res.supplier.code})` : ""} ${res.supplier.contact ? `| \u10E2\u10D4\u10DA: ${res.supplier.contact}` : ""}

\u{1F4E6} **\u10DE\u10DD\u10D6\u10D8\u10EA\u10D8\u10D4\u10D1\u10D8\u10E1 \u10E1\u10D8\u10D0 (${res.total_items_count}):**
${itemsText || "  \u2022 \u10DE\u10DD\u10D6\u10D8\u10EA\u10D8\u10D4\u10D1\u10D8 \u10D0\u10E0 \u10D0\u10E0\u10D8\u10E1"}

\u{1F4B0} **\u10E1\u10E3\u10DA \u10D6\u10D4\u10D3\u10DC\u10D0\u10D3\u10D4\u10D1\u10D8\u10E1 \u10EF\u10D0\u10DB\u10D8:** ${res.grand_total} ${res.currency}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
        return {
          content: [{ type: "text", text: summaryText.trim() + "\n\n" + JSON.stringify(res, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `\u10E8\u10D4\u10EA\u10D3\u10DD\u10DB\u10D0 \u10D6\u10D4\u10D3\u10DC\u10D0\u10D3\u10D4\u10D1\u10D8\u10E1 \u10D3\u10D4\u10E2\u10D0\u10DA\u10D4\u10D1\u10D8\u10E1 \u10DB\u10D8\u10E6\u10D4\u10D1\u10D8\u10E1\u10D0\u10E1: ${err.message}` }],
          isError: true
        };
      }
    }
  );
  server.tool(
    "get_inventory_acts",
    "\u10D8\u10DC\u10D5\u10D4\u10DC\u10E2\u10D0\u10E0\u10D8\u10D6\u10D0\u10EA\u10D8\u10D8\u10E1 \u10D0\u10E5\u10E2\u10D4\u10D1\u10D8\u10E1 \u10E1\u10D8\u10D0, \u10D3\u10D0\u10DC\u10D0\u10D9\u10DA\u10D8\u10E1\u10D4\u10D1\u10D8 \u10D3\u10D0 \u10D6\u10D4\u10D3\u10DB\u10D4\u10E2\u10DD\u10D1\u10D4\u10D1\u10D8 (Inventory audit acts history: shortages, surpluses, net balance, date, warehouse)",
    {
      tenant: z.string().optional().describe("Tenant ID \u10D0\u10DC Slug"),
      period: z.enum(["all", "today", "yesterday", "this_week", "this_month", "last_month", "custom"]).default("all").describe("\u10DE\u10D4\u10E0\u10D8\u10DD\u10D3\u10D8"),
      startDate: z.string().optional().describe("YYYY-MM-DD"),
      endDate: z.string().optional().describe("YYYY-MM-DD"),
      warehouse: z.string().optional().describe("\u10E1\u10D0\u10EC\u10E7\u10DD\u10D1\u10D8 (bar, kitchen, restourant, storage, \u10E7\u10D5\u10D4\u10DA\u10D0)"),
      status: z.enum(["all", "completed", "draft"]).default("all").describe("\u10E1\u10E2\u10D0\u10E2\u10E3\u10E1\u10D8"),
      limit: z.number().default(25).describe("\u10DB\u10D0\u10E5\u10E1\u10D8\u10DB\u10D0\u10DA\u10E3\u10E0\u10D8 \u10E0\u10D0\u10DD\u10D3\u10D4\u10DC\u10DD\u10D1\u10D0")
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
        const actsText = res.acts.map(
          (a) => `\u2022 [\u10D0\u10E5\u10E2\u10D8 #${a.id}] ${new Date(a.date).toLocaleDateString("ka-GE")} | \u10E1\u10D0\u10EC\u10E7\u10DD\u10D1\u10D8: ${a.warehouse_type} | \u10E8\u10D4\u10DB\u10DD\u10EC\u10DB\u10D3\u10D0: ${a.total_items} \u10DE\u10E0\u10DD\u10D3\u10E3\u10E5\u10E2\u10D8
  \u{1F53B} \u10D3\u10D0\u10DC\u10D0\u10D9\u10DA\u10D8\u10E1\u10D8: -${a.shortage_amount} ${cur} | \u{1F53A} \u10D6\u10D4\u10D3\u10DB\u10D4\u10E2\u10DD\u10D1\u10D0: +${a.surplus_amount} ${cur} | \u2696\uFE0F \u10E1\u10D0\u10DA\u10D3\u10DD: ${a.net_amount} ${cur} ${a.comment ? `(${a.comment})` : ""}`
        ).join("\n\n");
        const summaryText = `
\u{1F4CB} **\u10D8\u10DC\u10D5\u10D4\u10DC\u10E2\u10D0\u10E0\u10D8\u10D6\u10D0\u10EA\u10D8\u10D8\u10E1 \u10D0\u10E5\u10E2\u10D4\u10D1\u10D8\u10E1 \u10E0\u10D4\u10D4\u10E1\u10E2\u10E0\u10D8 \u2014 ${res.tenant.name} ${res.period_label ? `(${res.period_label})` : ""}**
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4CA} \u10E1\u10E3\u10DA \u10E9\u10D0\u10E2\u10D0\u10E0\u10D4\u10D1\u10E3\u10DA\u10D8 \u10D8\u10DC\u10D5\u10D4\u10DC\u10E2\u10D0\u10E0\u10D8\u10D6\u10D0\u10EA\u10D8\u10D0: ${res.summary.total_acts_count}
\u{1F4E6} \u10E8\u10D4\u10DB\u10DD\u10EC\u10DB\u10D4\u10D1\u10E3\u10DA\u10D8 \u10DE\u10DD\u10D6\u10D8\u10EA\u10D8\u10D4\u10D1\u10D8 \u10EF\u10D0\u10DB\u10E8\u10D8: ${res.summary.total_items_checked}
\u{1F53B} \u10EF\u10D0\u10DB\u10E3\u10E0\u10D8 \u10D3\u10D0\u10DC\u10D0\u10D9\u10DA\u10D8\u10E1\u10D8: -${res.summary.total_shortage_amount} ${cur}
\u{1F53A} \u10EF\u10D0\u10DB\u10E3\u10E0\u10D8 \u10D6\u10D4\u10D3\u10DB\u10D4\u10E2\u10DD\u10D1\u10D0: +${res.summary.total_surplus_amount} ${cur}
\u2696\uFE0F \u10EC\u10DB\u10D8\u10DC\u10D3\u10D0 \u10E4\u10D8\u10DC\u10D0\u10DC\u10E1\u10E3\u10E0\u10D8 \u10E1\u10EE\u10D5\u10D0\u10DD\u10D1\u10D0: ${res.summary.total_net_discrepancy} ${cur}

\u{1F4CB} **\u10D0\u10E5\u10E2\u10D4\u10D1\u10D8\u10E1 \u10E1\u10D8\u10D0:**
${actsText || "\u10D8\u10DC\u10D5\u10D4\u10DC\u10E2\u10D0\u10E0\u10D8\u10D6\u10D0\u10EA\u10D8\u10D8\u10E1 \u10D0\u10E5\u10E2\u10D4\u10D1\u10D8 \u10D0\u10E0 \u10DB\u10DD\u10D8\u10EB\u10D4\u10D1\u10DC\u10D0."}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
        return {
          content: [{ type: "text", text: summaryText.trim() + "\n\n" + JSON.stringify(res, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `\u10E8\u10D4\u10EA\u10D3\u10DD\u10DB\u10D0 \u10D8\u10DC\u10D5\u10D4\u10DC\u10E2\u10D0\u10E0\u10D8\u10D6\u10D0\u10EA\u10D8\u10D4\u10D1\u10D8\u10E1 \u10DB\u10D8\u10E6\u10D4\u10D1\u10D8\u10E1\u10D0\u10E1: ${err.message}` }],
          isError: true
        };
      }
    }
  );
  server.tool(
    "get_inventory_act_details",
    "\u10D9\u10DD\u10DC\u10D9\u10E0\u10D4\u10E2\u10E3\u10DA\u10D8 \u10D8\u10DC\u10D5\u10D4\u10DC\u10E2\u10D0\u10E0\u10D8\u10D6\u10D0\u10EA\u10D8\u10D8\u10E1 \u10D0\u10E5\u10E2\u10D8\u10E1 \u10E1\u10E0\u10E3\u10DA\u10D8 \u10D3\u10D4\u10E2\u10D0\u10DA\u10D4\u10D1\u10D8: \u10D0\u10E6\u10E0\u10D8\u10EA\u10EE\u10E3\u10DA\u10D8 vs \u10E4\u10D0\u10E5\u10E2\u10D8\u10E3\u10E0\u10D8 \u10DC\u10D0\u10E8\u10D7\u10D4\u10D1\u10D8, \u10E1\u10EE\u10D5\u10D0\u10DD\u10D1\u10D4\u10D1\u10D8 \u10D3\u10D0 \u10D3\u10D0\u10DC\u10D0\u10D9\u10DA\u10D8\u10E1\u10D4\u10D1\u10D8/\u10D6\u10D4\u10D3\u10DB\u10D4\u10E2\u10DD\u10D1\u10D4\u10D1\u10D8 (Detailed inventory audit breakdown: expected vs actual stock, discrepancies, top shortages and surpluses)",
    {
      actId: z.number().describe("\u10D8\u10DC\u10D5\u10D4\u10DC\u10E2\u10D0\u10E0\u10D8\u10D6\u10D0\u10EA\u10D8\u10D8\u10E1 \u10D0\u10E5\u10E2\u10D8\u10E1 ID"),
      tenant: z.string().optional().describe("Tenant ID \u10D0\u10DC Slug")
    },
    async ({ actId, tenant }) => {
      try {
        const res = await getInventoryActDetails(actId, tenant);
        const a = res.act;
        const cur = a.currency;
        const shortagesText = res.top_shortages.map(
          (s, idx) => `  ${idx + 1}. \u{1F53B} ${s.product_name} \u2014 \u10E1\u10EE\u10D5\u10D0\u10DD\u10D1\u10D0: ${s.difference} ${s.unit_name} (\u10D0\u10E6\u10E0\u10D8\u10EA\u10EE\u10E3\u10DA\u10D8: ${s.expected_stock}, \u10E4\u10D0\u10E5\u10E2\u10D8\u10E3\u10E0\u10D8: ${s.actual_stock}) = ${s.diff_amount} ${cur}`
        ).join("\n");
        const surplusesText = res.top_surpluses.map(
          (s, idx) => `  ${idx + 1}. \u{1F53A} ${s.product_name} \u2014 \u10E1\u10EE\u10D5\u10D0\u10DD\u10D1\u10D0: +${s.difference} ${s.unit_name} (\u10D0\u10E6\u10E0\u10D8\u10EA\u10EE\u10E3\u10DA\u10D8: ${s.expected_stock}, \u10E4\u10D0\u10E5\u10E2\u10D8\u10E3\u10E0\u10D8: ${s.actual_stock}) = +${s.diff_amount} ${cur}`
        ).join("\n");
        const summaryText = `
\u{1F4D1} **\u10D8\u10DC\u10D5\u10D4\u10DC\u10E2\u10D0\u10E0\u10D8\u10D6\u10D0\u10EA\u10D8\u10D8\u10E1 \u10D0\u10E5\u10E2\u10D8 #${a.id} \u2014 ${res.tenant_name}**
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4C5} \u10D7\u10D0\u10E0\u10D8\u10E6\u10D8: ${new Date(a.created_at).toLocaleString("ka-GE")}
\u{1F3DB}\uFE0F \u10E1\u10D0\u10EC\u10E7\u10DD\u10D1\u10D8: ${a.warehouse_type} | \u10E1\u10E2\u10D0\u10E2\u10E3\u10E1\u10D8: ${a.status} ${a.comment ? `| \u10D9\u10DD\u10DB\u10D4\u10DC\u10E2\u10D0\u10E0\u10D8: ${a.comment}` : ""}
\u{1F464} \u10E8\u10D4\u10DB\u10E1\u10E0\u10E3\u10DA\u10D4\u10D1\u10D4\u10DA\u10D8: ${a.created_by_name}

\u{1F4CA} **\u10E4\u10D8\u10DC\u10D0\u10DC\u10E1\u10E3\u10E0\u10D8 \u10E8\u10D4\u10D3\u10D4\u10D2\u10D8:**
  \u2022 \u10E8\u10D4\u10DB\u10DD\u10EC\u10DB\u10D4\u10D1\u10E3\u10DA\u10D8 \u10DE\u10DD\u10D6\u10D8\u10EA\u10D8\u10D4\u10D1\u10D8: ${res.statistics.total_items_count} (\u10D6\u10E3\u10E1\u10E2\u10D8: ${res.statistics.exact_count}, \u10D3\u10D0\u10DC\u10D0\u10D9\u10DA\u10D8\u10E1\u10D8: ${res.statistics.shortages_count}, \u10D6\u10D4\u10D3\u10DB\u10D4\u10E2\u10DD\u10D1\u10D0: ${res.statistics.surpluses_count})
  \u2022 \u{1F53B} \u10D3\u10D0\u10DC\u10D0\u10D9\u10DA\u10D8\u10E1\u10D8 \u10EF\u10D0\u10DB\u10E8\u10D8: -${a.shortage_amount} ${cur}
  \u2022 \u{1F53A} \u10D6\u10D4\u10D3\u10DB\u10D4\u10E2\u10DD\u10D1\u10D0 \u10EF\u10D0\u10DB\u10E8\u10D8: +${a.surplus_amount} ${cur}
  \u2022 \u2696\uFE0F **\u10EC\u10DB\u10D8\u10DC\u10D3\u10D0 \u10E1\u10D0\u10DA\u10D3\u10DD:** ${a.net_amount} ${cur}

\u{1F53B} **\u10E3\u10D3\u10D8\u10D3\u10D4\u10E1\u10D8 \u10D3\u10D0\u10DC\u10D0\u10D9\u10DA\u10D8\u10E1\u10D4\u10D1\u10D8 (Top Shortages):**
${shortagesText || "  \u2022 \u10D3\u10D0\u10DC\u10D0\u10D9\u10DA\u10D8\u10E1\u10D8 \u10D0\u10E0 \u10D0\u10E0\u10D8\u10E1 \u2705"}

\u{1F53A} **\u10E3\u10D3\u10D8\u10D3\u10D4\u10E1\u10D8 \u10D6\u10D4\u10D3\u10DB\u10D4\u10E2\u10DD\u10D1\u10D4\u10D1\u10D8 (Top Surpluses):**
${surplusesText || "  \u2022 \u10D6\u10D4\u10D3\u10DB\u10D4\u10E2\u10DD\u10D1\u10D0 \u10D0\u10E0 \u10D0\u10E0\u10D8\u10E1"}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
        return {
          content: [{ type: "text", text: summaryText.trim() + "\n\n" + JSON.stringify(res, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `\u10E8\u10D4\u10EA\u10D3\u10DD\u10DB\u10D0 \u10D0\u10E5\u10E2\u10D8\u10E1 \u10D3\u10D4\u10E2\u10D0\u10DA\u10D4\u10D1\u10D8\u10E1 \u10DB\u10D8\u10E6\u10D4\u10D1\u10D8\u10E1\u10D0\u10E1: ${err.message}` }],
          isError: true
        };
      }
    }
  );
  server.tool(
    "get_inventory_discrepancy_summary",
    "\u10D8\u10DC\u10D5\u10D4\u10DC\u10E2\u10D0\u10E0\u10D8\u10D6\u10D0\u10EA\u10D8\u10D4\u10D1\u10D8\u10E1 \u10EF\u10D0\u10DB\u10E3\u10E0\u10D8 \u10D0\u10DC\u10D0\u10DA\u10D8\u10E2\u10D8\u10D9\u10D0: \u10E7\u10D5\u10D4\u10DA\u10D0\u10D6\u10D4 \u10DE\u10E0\u10DD\u10D1\u10DA\u10D4\u10DB\u10E3\u10E0\u10D8 \u10DE\u10E0\u10DD\u10D3\u10E3\u10E5\u10E2\u10D4\u10D1\u10D8 \u10EE\u10E8\u10D8\u10E0\u10D8 \u10D3\u10D0\u10DC\u10D0\u10D9\u10DA\u10D8\u10E1\u10D4\u10D1\u10D8\u10D7\u10D0 \u10D3\u10D0 \u10D6\u10D4\u10D3\u10DB\u10D4\u10E2\u10DD\u10D1\u10D4\u10D1\u10D8\u10D7 (Discrepancy summary across audits: most problematic products by shortage amounts)",
    {
      tenant: z.string().optional().describe("Tenant ID \u10D0\u10DC Slug"),
      period: z.enum(["today", "yesterday", "this_week", "this_month", "last_month", "custom"]).default("this_month").describe("\u10DE\u10D4\u10E0\u10D8\u10DD\u10D3\u10D8"),
      startDate: z.string().optional().describe("YYYY-MM-DD"),
      endDate: z.string().optional().describe("YYYY-MM-DD")
    },
    async ({ tenant, period, startDate, endDate }) => {
      try {
        const res = await getInventoryDiscrepancySummary(tenant, period, startDate, endDate);
        const cur = res.currency;
        const probText = res.problematic_products.slice(0, 15).map(
          (p, idx) => `  ${idx + 1}. \u26A0\uFE0F ${p.product_name} \u2014 \u10D3\u10D0\u10DC\u10D0\u10D9\u10DA\u10D8\u10E1\u10D8: -${p.total_shortage_amount} ${cur} (${p.total_shortage_qty} ${p.unit_name}) | \u10D6\u10D4\u10D3\u10DB\u10D4\u10E2\u10DD\u10D1\u10D0: +${p.total_surplus_amount} ${cur} | \u10EC\u10DB\u10D8\u10DC\u10D3\u10D0: ${p.net_diff_amount} ${cur} (${p.discrepancy_occurrences} \u10D0\u10E5\u10E2\u10E8\u10D8)`
        ).join("\n");
        const summaryText = `
\u26A0\uFE0F **\u10D8\u10DC\u10D5\u10D4\u10DC\u10E2\u10D0\u10E0\u10D8\u10D6\u10D0\u10EA\u10D8\u10D8\u10E1 \u10D2\u10D0\u10D3\u10D0\u10EE\u10E0\u10D4\u10D1\u10D8\u10E1 \u10D0\u10DC\u10D0\u10DA\u10D8\u10D6\u10D8 \u2014 ${res.tenant_name} (${res.period_label})**
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4CA} \u10D2\u10D0\u10D0\u10DC\u10D0\u10DA\u10D8\u10D6\u10D4\u10D1\u10E3\u10DA\u10D8 \u10D0\u10E5\u10E2\u10D4\u10D1\u10D8: ${res.total_audits_count}
\u{1F53B} \u10E1\u10E3\u10DA \u10D3\u10D0\u10DC\u10D0\u10D9\u10DA\u10D8\u10E1\u10D8: -${res.total_shortages_sum} ${cur}
\u{1F53A} \u10E1\u10E3\u10DA \u10D6\u10D4\u10D3\u10DB\u10D4\u10E2\u10DD\u10D1\u10D0: +${res.total_surpluses_sum} ${cur}
\u2696\uFE0F \u10EC\u10DB\u10D8\u10DC\u10D3\u10D0 \u10D1\u10D0\u10DA\u10D0\u10DC\u10E1\u10D8: ${res.net_balance} ${cur}

\u{1F6A8} **\u10E7\u10D5\u10D4\u10DA\u10D0\u10D6\u10D4 \u10DE\u10E0\u10DD\u10D1\u10DA\u10D4\u10DB\u10E3\u10E0\u10D8 \u10DE\u10E0\u10DD\u10D3\u10E3\u10E5\u10E2\u10D4\u10D1\u10D8 (\u10D3\u10D0\u10DC\u10D0\u10D9\u10DA\u10D8\u10E1\u10D8\u10E1 \u10DB\u10D8\u10EE\u10D4\u10D3\u10D5\u10D8\u10D7):**
${probText || "  \u2022 \u10DE\u10E0\u10DD\u10D1\u10DA\u10D4\u10DB\u10E3\u10E0\u10D8 \u10D2\u10D0\u10D3\u10D0\u10EE\u10E0\u10D4\u10D1\u10D8 \u10D0\u10E0 \u10D3\u10D0\u10E4\u10D8\u10E5\u10E1\u10D8\u10E0\u10D4\u10D1\u10E3\u10DA\u10D0 \u2705"}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
        return {
          content: [{ type: "text", text: summaryText.trim() + "\n\n" + JSON.stringify(res, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `\u10E8\u10D4\u10EA\u10D3\u10DD\u10DB\u10D0 \u10D8\u10DC\u10D5\u10D4\u10DC\u10E2\u10D0\u10E0\u10D8\u10D6\u10D0\u10EA\u10D8\u10D8\u10E1 \u10D0\u10DC\u10D0\u10DA\u10D8\u10D6\u10D8\u10E1\u10D0\u10E1: ${err.message}` }],
          isError: true
        };
      }
    }
  );
  server.tool(
    "get_recipe_calculations",
    "\u10DB\u10D4\u10DC\u10D8\u10E3\u10E1 \u10D9\u10D0\u10DA\u10D9\u10E3\u10DA\u10D0\u10EA\u10D8\u10D4\u10D1\u10D8, \u10D7\u10D5\u10D8\u10D7\u10E6\u10D8\u10E0\u10D4\u10D1\u10E3\u10DA\u10D4\u10D1\u10D0 (Food Cost) \u10D3\u10D0 \u10DB\u10D0\u10E0\u10DF\u10D0 (Menu dish cost calculations, prime cost, gross profit margin, Food Cost %, markup %)",
    {
      tenant: z.string().optional().describe("Tenant ID \u10D0\u10DC Slug"),
      category: z.string().optional().describe("\u10D9\u10D0\u10E2\u10D4\u10D2\u10DD\u10E0\u10D8\u10D8\u10E1 \u10E1\u10D0\u10EE\u10D4\u10DA\u10D8 \u10D0\u10DC ID \u10E4\u10D8\u10DA\u10E2\u10E0\u10D0\u10EA\u10D8\u10D8\u10E1\u10D7\u10D5\u10D8\u10E1"),
      type: z.enum(["all", "kitchen", "bar", "restourant", "hookah"]).default("all").describe("\u10E2\u10D8\u10DE\u10D8 (\u10E1\u10D0\u10DB\u10D6\u10D0\u10E0\u10D4\u10E3\u10DA\u10DD, \u10D1\u10D0\u10E0\u10D8, \u10F0\u10E3\u10D9\u10D0)"),
      search: z.string().optional().describe("\u10D9\u10D4\u10E0\u10EB\u10D8\u10E1 \u10E1\u10D0\u10EB\u10D8\u10D4\u10D1\u10DD \u10E1\u10D8\u10E2\u10E7\u10D5\u10D0"),
      minFoodCost: z.number().optional().describe("\u10DB\u10D8\u10DC\u10D8\u10DB\u10D0\u10DA\u10E3\u10E0\u10D8 Food Cost % (\u10DB\u10D0\u10D2. 35-\u10D6\u10D4 \u10DB\u10D0\u10E6\u10D0\u10DA\u10D8 Food Cost-\u10D8\u10E1 \u10E1\u10D0\u10DE\u10DD\u10D5\u10DC\u10D4\u10DA\u10D0\u10D3)"),
      maxFoodCost: z.number().optional().describe("\u10DB\u10D0\u10E5\u10E1\u10D8\u10DB\u10D0\u10DA\u10E3\u10E0\u10D8 Food Cost %"),
      missingRecipesOnly: z.boolean().optional().describe("\u10DB\u10EE\u10DD\u10DA\u10DD\u10D3 \u10D8\u10E1 \u10D9\u10D4\u10E0\u10EB\u10D4\u10D1\u10D8, \u10E0\u10DD\u10DB\u10DA\u10D4\u10D1\u10E1\u10D0\u10EA \u10D0\u10E0 \u10D0\u10E5\u10D5\u10D7 \u10D9\u10D0\u10DA\u10D9\u10E3\u10DA\u10D0\u10EA\u10D8\u10D0/\u10E0\u10D4\u10EA\u10D4\u10DE\u10E2\u10D8"),
      includeDisabled: z.boolean().default(false).describe("\u10D2\u10D0\u10D7\u10D8\u10E8\u10E3\u10DA\u10D8 \u10D9\u10D4\u10E0\u10EB\u10D4\u10D1\u10D8\u10E1 \u10E9\u10D5\u10D4\u10DC\u10D4\u10D1\u10D0"),
      sortBy: z.enum(["food_cost_pct", "cost_price", "margin", "selling_price", "name"]).default("food_cost_pct").describe("\u10D3\u10D0\u10DA\u10D0\u10D2\u10D4\u10D1\u10D8\u10E1 \u10D5\u10D4\u10DA\u10D8"),
      sortDirection: z.enum(["asc", "desc"]).default("desc").describe("\u10D6\u10E0\u10D3\u10D0\u10D3\u10DD\u10D1\u10D8\u10D7 \u10D0\u10DC \u10D9\u10DA\u10D4\u10D1\u10D0\u10D3\u10DD\u10D1\u10D8\u10D7"),
      limit: z.number().default(50).describe("\u10DB\u10D0\u10E5\u10E1\u10D8\u10DB\u10D0\u10DA\u10E3\u10E0\u10D8 \u10E0\u10D0\u10DD\u10D3\u10D4\u10DC\u10DD\u10D1\u10D0")
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
          const fcBadge = !d.has_recipe ? "\u26A0\uFE0F [\u10E0\u10D4\u10EA\u10D4\u10DE\u10E2\u10D8\u10E1 \u10D2\u10D0\u10E0\u10D4\u10E8\u10D4]" : d.food_cost_pct > 35 ? `\u{1F6A8} [FC: ${d.food_cost_pct}%]` : `\u2705 [FC: ${d.food_cost_pct}%]`;
          return `  ${idx + 1}. ${d.name} (${d.category_name}) \u2014 \u10D2\u10D0\u10E1\u10D0\u10E7\u10D8\u10D3\u10D8: ${d.selling_price} ${cur} | \u10D7\u10D5\u10D8\u10D7\u10E6\u10D8\u10E0\u10D4\u10D1\u10E3\u10DA\u10D4\u10D1\u10D0: ${d.cost_price} ${cur} | \u10DB\u10D0\u10E0\u10DF\u10D0: ${d.gross_margin} ${cur} ${fcBadge} (${d.ingredients_count} \u10D8\u10DC\u10D2\u10E0\u10D4\u10D3\u10D8\u10D4\u10DC\u10E2\u10D8)`;
        }).join("\n");
        const summaryText = `
\u{1F37D}\uFE0F **\u10DB\u10D4\u10DC\u10D8\u10E3\u10E1 \u10D9\u10D0\u10DA\u10D9\u10E3\u10DA\u10D0\u10EA\u10D8\u10D4\u10D1\u10D8 \u10D3\u10D0 \u10D7\u10D5\u10D8\u10D7\u10E6\u10D8\u10E0\u10D4\u10D1\u10E3\u10DA\u10D4\u10D1\u10D0 \u2014 ${res.tenant.name}**
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4CB} \u10E1\u10E3\u10DA \u10D9\u10D4\u10E0\u10EB\u10D4\u10D1\u10D8: ${res.summary.total_dishes_count} (\u10E0\u10D4\u10EA\u10D4\u10DE\u10E2\u10D8\u10D7: ${res.summary.dishes_with_recipe}, \u10E0\u10D4\u10EA\u10D4\u10DE\u10E2\u10D8\u10E1 \u10D2\u10D0\u10E0\u10D4\u10E8\u10D4: ${res.summary.dishes_without_recipe})
\u{1F3AF} **\u10E1\u10D0\u10E8\u10E3\u10D0\u10DA\u10DD Food Cost:** ${res.summary.average_food_cost_pct}%
\u{1F4B0} **\u10E1\u10D0\u10E8\u10E3\u10D0\u10DA\u10DD \u10D2\u10D0\u10E1\u10D0\u10E7\u10D8\u10D3\u10D8 \u10E4\u10D0\u10E1\u10D8:** ${res.summary.average_selling_price} ${cur}
\u{1F4C9} **\u10E1\u10D0\u10E8\u10E3\u10D0\u10DA\u10DD \u10D7\u10D5\u10D8\u10D7\u10E6\u10D8\u10E0\u10D4\u10D1\u10E3\u10DA\u10D4\u10D1\u10D0:** ${res.summary.average_cost_price} ${cur}
\u2696\uFE0F **\u10E1\u10D0\u10E8\u10E3\u10D0\u10DA\u10DD \u10DB\u10D0\u10E0\u10DF\u10D0/\u10DB\u10DD\u10D2\u10D4\u10D1\u10D0:** ${res.summary.average_margin} ${cur}
\u{1F6A8} \u10DB\u10D0\u10E6\u10D0\u10DA\u10D8 Food Cost (>35%): ${res.summary.high_food_cost_count} \u10D9\u10D4\u10E0\u10EB\u10D8

\u{1F4CB} **\u10D9\u10D4\u10E0\u10EB\u10D4\u10D1\u10D8\u10E1 \u10E0\u10D4\u10D4\u10E1\u10E2\u10E0\u10D8 (\u10D3\u10D0\u10DA\u10D0\u10D2\u10D4\u10D1\u10E3\u10DA\u10D8 ${sortBy}-\u10D8\u10D7):**
${dishesText || "\u10D9\u10D4\u10E0\u10EB\u10D4\u10D1\u10D8 \u10DB\u10DD\u10EA\u10D4\u10DB\u10E3\u10DA\u10D8 \u10E4\u10D8\u10DA\u10E2\u10E0\u10D4\u10D1\u10D8\u10D7 \u10D0\u10E0 \u10DB\u10DD\u10D8\u10EB\u10D4\u10D1\u10DC\u10D0."}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
        return {
          content: [{ type: "text", text: summaryText.trim() + "\n\n" + JSON.stringify(res, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `\u10E8\u10D4\u10EA\u10D3\u10DD\u10DB\u10D0 \u10D9\u10D0\u10DA\u10D9\u10E3\u10DA\u10D0\u10EA\u10D8\u10D4\u10D1\u10D8\u10E1 \u10DB\u10D8\u10E6\u10D4\u10D1\u10D8\u10E1\u10D0\u10E1: ${err.message}` }],
          isError: true
        };
      }
    }
  );
  server.tool(
    "get_dish_recipe_details",
    "\u10D9\u10DD\u10DC\u10D9\u10E0\u10D4\u10E2\u10E3\u10DA\u10D8 \u10D9\u10D4\u10E0\u10EB\u10D8\u10E1 \u10E2\u10D4\u10E5\u10DC\u10DD\u10DA\u10DD\u10D2\u10D8\u10E3\u10E0\u10D8 \u10D1\u10D0\u10E0\u10D0\u10D7\u10D8 / \u10D9\u10D0\u10DA\u10D9\u10E3\u10DA\u10D0\u10EA\u10D8\u10D8\u10E1 \u10D3\u10D4\u10E2\u10D0\u10DA\u10D4\u10D1\u10D8: \u10D8\u10DC\u10D2\u10E0\u10D4\u10D3\u10D8\u10D4\u10DC\u10E2\u10D4\u10D1\u10D8\u10E1 \u10E1\u10D8\u10D0, \u10EC\u10DD\u10DC\u10D4\u10D1\u10D8/\u10E0\u10D0\u10DD\u10D3\u10D4\u10DC\u10DD\u10D1\u10D4\u10D1\u10D8, \u10E4\u10D0\u10E1\u10D4\u10D1\u10D8 \u10D3\u10D0 \u10D7\u10D5\u10D8\u10D7\u10E6\u10D8\u10E0\u10D4\u10D1\u10E3\u10DA\u10D4\u10D1\u10D0\u10E8\u10D8 \u10EC\u10D8\u10DA\u10D8 (Detailed dish recipe breakdown: ingredients, portions, unit costs, cost share %)",
    {
      dish: z.union([z.string(), z.number()]).describe("\u10D9\u10D4\u10E0\u10EB\u10D8\u10E1 \u10E1\u10D0\u10EE\u10D4\u10DA\u10D8, ID \u10D0\u10DC Hash \u10D9\u10DD\u10D3\u10D8"),
      tenant: z.string().optional().describe("Tenant ID \u10D0\u10DC Slug")
    },
    async ({ dish, tenant }) => {
      try {
        const res = await getDishRecipeDetails(dish, tenant);
        const it = res.item;
        const cur = it.currency;
        const ingText = res.ingredients.map(
          (ing, idx) => `  ${idx + 1}. ${ing.is_semi_finished ? "\u{1F963} [\u10DC/\u10E4] " : "\u{1F33F} "}${ing.product_name} \u2014 ${ing.quantity} ${ing.unit_name} x ${ing.unit_cost_price} GEL = ${ing.line_total_cost} ${cur} (\u10EC\u10D8\u10DA\u10D8: ${ing.cost_share_pct}%)`
        ).join("\n");
        const summaryText = `
\u{1F372} **\u10E2\u10D4\u10E5\u10DC\u10DD\u10DA\u10DD\u10D2\u10D8\u10E3\u10E0\u10D8 \u10D1\u10D0\u10E0\u10D0\u10D7\u10D8: ${it.name} (${res.tenant_name})**
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F3DB}\uFE0F \u10D9\u10D0\u10E2\u10D4\u10D2\u10DD\u10E0\u10D8\u10D0: ${it.category_name} | \u10E2\u10D8\u10DE\u10D8: ${it.type}
\u{1F4B0} **\u10D2\u10D0\u10E1\u10D0\u10E7\u10D8\u10D3\u10D8 \u10E4\u10D0\u10E1\u10D8:** ${it.selling_price} ${cur}
\u{1F4C9} **\u10D7\u10D5\u10D8\u10D7\u10E6\u10D8\u10E0\u10D4\u10D1\u10E3\u10DA\u10D4\u10D1\u10D0 (Prime Cost):** ${it.prime_cost} ${cur}
\u2696\uFE0F **\u10DB\u10D0\u10E0\u10DF\u10D0 / \u10DB\u10DD\u10D2\u10D4\u10D1\u10D0 \u10DE\u10DD\u10E0\u10EA\u10D8\u10D0\u10D6\u10D4:** ${it.gross_margin} ${cur}
\u{1F3AF} **Food Cost:** ${it.food_cost_pct}% | **\u10E4\u10D0\u10E1\u10DC\u10D0\u10DB\u10D0\u10E2\u10D8:** ${it.markup_pct}%

\u{1F33F} **\u10D9\u10D0\u10DA\u10D9\u10E3\u10DA\u10D0\u10EA\u10D8\u10D8\u10E1 \u10D8\u10DC\u10D2\u10E0\u10D4\u10D3\u10D8\u10D4\u10DC\u10E2\u10D4\u10D1\u10D8 (${it.ingredients_count}):**
${ingText || "  \u2022 \u10D8\u10DC\u10D2\u10E0\u10D4\u10D3\u10D8\u10D4\u10DC\u10E2\u10D4\u10D1\u10D8 \u10D0\u10E0 \u10D0\u10E0\u10D8\u10E1 \u10DB\u10D8\u10D7\u10D8\u10D7\u10D4\u10D1\u10E3\u10DA\u10D8 (\u10E0\u10D4\u10EA\u10D4\u10DE\u10E2\u10D8 \u10EA\u10D0\u10E0\u10D8\u10D4\u10DA\u10D8\u10D0)"}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
        return {
          content: [{ type: "text", text: summaryText.trim() + "\n\n" + JSON.stringify(res, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `\u10E8\u10D4\u10EA\u10D3\u10DD\u10DB\u10D0 \u10E0\u10D4\u10EA\u10D4\u10DE\u10E2\u10D8\u10E1 \u10D3\u10D4\u10E2\u10D0\u10DA\u10D4\u10D1\u10D8\u10E1 \u10DB\u10D8\u10E6\u10D4\u10D1\u10D8\u10E1\u10D0\u10E1: ${err.message}` }],
          isError: true
        };
      }
    }
  );
  server.tool(
    "get_semi_finished_products",
    "\u10DC\u10D0\u10EE\u10D4\u10D5\u10D0\u10E0\u10E4\u10D0\u10D1\u10E0\u10D8\u10D9\u10D0\u10E2\u10D4\u10D1\u10D8\u10E1 \u10E1\u10D8\u10D0, \u10D2\u10D0\u10DB\u10DD\u10E1\u10D0\u10D5\u10D0\u10DA\u10D8 \u10EC\u10DD\u10DC\u10D0 \u10D3\u10D0 \u10D7\u10D5\u10D8\u10D7\u10E6\u10D8\u10E0\u10D4\u10D1\u10E3\u10DA\u10D4\u10D1\u10D8\u10E1 \u10D9\u10D0\u10DA\u10D9\u10E3\u10DA\u10D0\u10EA\u10D8\u10D0 (Semi-finished products registry: yield weight, batch cost, unit cost per kg/l, nested ingredients)",
    {
      tenant: z.string().optional().describe("Tenant ID \u10D0\u10DC Slug"),
      search: z.string().optional().describe("\u10E1\u10D0\u10EB\u10D8\u10D4\u10D1\u10DD \u10E2\u10D4\u10E5\u10E1\u10E2\u10D8")
    },
    async ({ tenant, search }) => {
      try {
        const res = await getSemiFinishedAnalytics(tenant, search);
        const listText = res.items.map((s) => {
          const ingList = s.ingredients.map((i) => `    - ${i.product_name}: ${i.quantity} ${i.unit_name} (${i.total_cost} GEL)`).join("\n");
          return `\u{1F963} **${s.name}**
  \u2022 \u10D2\u10D0\u10DB\u10DD\u10E1\u10D0\u10D5\u10D0\u10DA\u10D8: ${s.yield_target_weight} ${s.unit_name} | \u10DE\u10D0\u10E0\u10E2\u10D8\u10D8\u10E1 \u10D7\u10D5\u10D8\u10D7\u10E6\u10D8\u10E0\u10D4\u10D1\u10E3\u10DA\u10D4\u10D1\u10D0: ${s.batch_total_cost} GEL | 1 ${s.unit_name}-\u10D8\u10E1 \u10E4\u10D0\u10E1\u10D8: ${s.calculated_cost_per_unit} GEL
  \u2022 \u10D8\u10DC\u10D2\u10E0\u10D4\u10D3\u10D8\u10D4\u10DC\u10E2\u10D4\u10D1\u10D8 (${s.ingredients_count}):
${ingList || "    - \u10D8\u10DC\u10D2\u10E0\u10D4\u10D3\u10D8\u10D4\u10DC\u10E2\u10D4\u10D1\u10D8 \u10D0\u10E0 \u10D0\u10E0\u10D8\u10E1"}`;
        }).join("\n\n");
        const summaryText = `
\u{1F963} **\u10DC\u10D0\u10EE\u10D4\u10D5\u10D0\u10E0\u10E4\u10D0\u10D1\u10E0\u10D8\u10D9\u10D0\u10E2\u10D4\u10D1\u10D8\u10E1 \u10E0\u10D4\u10D4\u10E1\u10E2\u10E0\u10D8 \u2014 ${res.tenant_name}**
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u10E1\u10E3\u10DA \u10DC\u10D0\u10EE\u10D4\u10D5\u10D0\u10E0\u10E4\u10D0\u10D1\u10E0\u10D8\u10D9\u10D0\u10E2\u10D8: ${res.total_semi_finished_count}

${listText || "\u10DC\u10D0\u10EE\u10D4\u10D5\u10D0\u10E0\u10E4\u10D0\u10D1\u10E0\u10D8\u10D9\u10D0\u10E2\u10D4\u10D1\u10D8 \u10D0\u10E0 \u10DB\u10DD\u10D8\u10EB\u10D4\u10D1\u10DC\u10D0."}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
        return {
          content: [{ type: "text", text: summaryText.trim() + "\n\n" + JSON.stringify(res, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `\u10E8\u10D4\u10EA\u10D3\u10DD\u10DB\u10D0 \u10DC\u10D0\u10EE\u10D4\u10D5\u10D0\u10E0\u10E4\u10D0\u10D1\u10E0\u10D8\u10D9\u10D0\u10E2\u10D4\u10D1\u10D8\u10E1 \u10DB\u10D8\u10E6\u10D4\u10D1\u10D8\u10E1\u10D0\u10E1: ${err.message}` }],
          isError: true
        };
      }
    }
  );
}

// src/resources.ts
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
function registerResources(server) {
  server.resource(
    "today-summary",
    new ResourceTemplate("pos://summary/today{?tenant}", { list: void 0 }),
    async (uri, { tenant }) => {
      const tenantStr = typeof tenant === "string" ? tenant : void 0;
      const data = await getTodaySummary(tenantStr);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    }
  );
  server.resource(
    "active-shift",
    new ResourceTemplate("pos://shifts/active{?tenant}", { list: void 0 }),
    async (uri, { tenant }) => {
      const tenantStr = typeof tenant === "string" ? tenant : void 0;
      const data = await getShiftAnalytics(tenantStr);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    }
  );
  server.resource(
    "inventory-alerts",
    new ResourceTemplate("pos://inventory/alerts{?tenant}", { list: void 0 }),
    async (uri, { tenant }) => {
      const tenantStr = typeof tenant === "string" ? tenant : void 0;
      const data = await getInventoryAlerts(tenantStr);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    }
  );
  server.resource(
    "purchases-summary",
    new ResourceTemplate("pos://purchases/summary{?tenant,period}", { list: void 0 }),
    async (uri, { tenant, period }) => {
      const tenantStr = typeof tenant === "string" ? tenant : void 0;
      const periodStr = typeof period === "string" ? period : "this_month";
      const data = await getPurchasesAnalytics(tenantStr, periodStr);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    }
  );
  server.resource(
    "inventory-acts",
    new ResourceTemplate("pos://inventory/acts{?tenant}", { list: void 0 }),
    async (uri, { tenant }) => {
      const tenantStr = typeof tenant === "string" ? tenant : void 0;
      const data = await getInventoryActs(tenantStr);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    }
  );
  server.resource(
    "recipes-calculations",
    new ResourceTemplate("pos://recipes/calculations{?tenant}", { list: void 0 }),
    async (uri, { tenant }) => {
      const tenantStr = typeof tenant === "string" ? tenant : void 0;
      const data = await getRecipeCalculations(tenantStr);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    }
  );
}

// src/restApi.ts
init_db();
import { Router } from "express";
init_orderSearch();
var restRouter = Router();
restRouter.get("/tenants", async (req, res) => {
  try {
    const { data, error } = await supabase.from("tenants").select("id, name, slug, code, currency, tax_id, license_plan, is_active").order("name", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ tenants: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
restRouter.get("/today-summary", async (req, res) => {
  try {
    const tenant = req.query.tenant || void 0;
    const date = req.query.date || void 0;
    const summary = await getTodaySummary(tenant, date);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
restRouter.get("/shift-report", async (req, res) => {
  try {
    const tenant = req.query.tenant || void 0;
    const shiftId = req.query.shiftId ? parseInt(req.query.shiftId, 10) : void 0;
    const report = await getShiftAnalytics(tenant, shiftId);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
restRouter.get("/sales", async (req, res) => {
  try {
    const tenant = req.query.tenant || void 0;
    const period = req.query.period || "today";
    const startDate = req.query.startDate || void 0;
    const endDate = req.query.endDate || void 0;
    const sales = await getSalesAnalytics(tenant, period, startDate, endDate);
    res.json(sales);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
restRouter.get("/top-items", async (req, res) => {
  try {
    const tenant = req.query.tenant || void 0;
    const period = req.query.period || "today";
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 15;
    const sortBy = req.query.sortBy || "revenue";
    const top = await getTopSellingItems(tenant, period, limit, sortBy);
    res.json(top);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
restRouter.get("/expenses", async (req, res) => {
  try {
    const tenant = req.query.tenant || void 0;
    const period = req.query.period || "this_month";
    const startDate = req.query.startDate || void 0;
    const endDate = req.query.endDate || void 0;
    const expenses = await getExpensesAnalytics(tenant, period, startDate, endDate);
    res.json(expenses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
restRouter.get("/inventory-alerts", async (req, res) => {
  try {
    const tenant = req.query.tenant || void 0;
    const alerts = await getInventoryAlerts(tenant);
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
restRouter.get("/active-orders", async (req, res) => {
  try {
    const tenant = req.query.tenant || void 0;
    const active = await getActiveOrders(tenant);
    res.json(active);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
restRouter.get("/staff-performance", async (req, res) => {
  try {
    const tenant = req.query.tenant || void 0;
    const period = req.query.period || "today";
    const startDate = req.query.startDate || void 0;
    const endDate = req.query.endDate || void 0;
    const staff = await getStaffPerformance(tenant, period, startDate, endDate);
    res.json(staff);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
restRouter.get("/search-orders", async (req, res) => {
  try {
    const tenant = req.query.tenant || void 0;
    const query = req.query.query || void 0;
    const deliveryType = req.query.deliveryType || "all";
    const status = req.query.status || "all";
    const period = req.query.period || void 0;
    const startDate = req.query.startDate || void 0;
    const endDate = req.query.endDate || void 0;
    const orderId = req.query.orderId ? parseInt(req.query.orderId, 10) : void 0;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
restRouter.get("/order-details", async (req, res) => {
  try {
    const orderId = parseInt(req.query.orderId, 10);
    const tenant = req.query.tenant || void 0;
    if (!orderId) return res.status(400).json({ error: "orderId is required" });
    const order = await getOrderDetails(orderId, tenant);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
restRouter.get("/delivery-orders", async (req, res) => {
  try {
    const tenant = req.query.tenant || void 0;
    const platform = req.query.platform || "all";
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
    const deliveries = await getDeliveryOrders(tenant, { platform, limit });
    res.json(deliveries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
restRouter.get("/purchases", async (req, res) => {
  try {
    const tenant = req.query.tenant || void 0;
    const period = req.query.period || "this_month";
    const startDate = req.query.startDate || void 0;
    const endDate = req.query.endDate || void 0;
    const supplierId = req.query.supplierId || void 0;
    const warehouse = req.query.warehouse || void 0;
    const purchases = await getPurchasesAnalytics(tenant, period, startDate, endDate, supplierId, warehouse);
    res.json(purchases);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
restRouter.get("/purchases/search", async (req, res) => {
  try {
    const tenant = req.query.tenant || void 0;
    const query = req.query.query || void 0;
    const supplierId = req.query.supplierId || void 0;
    const warehouse = req.query.warehouse || void 0;
    const period = req.query.period || void 0;
    const startDate = req.query.startDate || void 0;
    const endDate = req.query.endDate || void 0;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 25;
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
restRouter.get("/purchases/details", async (req, res) => {
  try {
    const invoiceCode = req.query.invoiceCode || req.query.code || req.query.id;
    const tenant = req.query.tenant || void 0;
    if (!invoiceCode) return res.status(400).json({ error: "invoiceCode or code is required" });
    const details = await getPurchaseDetails(invoiceCode, tenant);
    res.json(details);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
restRouter.get("/inventory/acts", async (req, res) => {
  try {
    const tenant = req.query.tenant || void 0;
    const period = req.query.period || "all";
    const startDate = req.query.startDate || void 0;
    const endDate = req.query.endDate || void 0;
    const warehouse = req.query.warehouse || void 0;
    const status = req.query.status || "all";
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 25;
    const acts = await getInventoryActs(tenant, {
      period,
      startDate,
      endDate,
      warehouse,
      status,
      limit
    });
    res.json(acts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
restRouter.get("/inventory/act-details", async (req, res) => {
  try {
    const actId = req.query.actId ? parseInt(req.query.actId, 10) : req.query.id ? parseInt(req.query.id, 10) : 0;
    const tenant = req.query.tenant || void 0;
    if (!actId) return res.status(400).json({ error: "actId is required" });
    const details = await getInventoryActDetails(actId, tenant);
    res.json(details);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
restRouter.get("/inventory/discrepancies", async (req, res) => {
  try {
    const tenant = req.query.tenant || void 0;
    const period = req.query.period || "this_month";
    const startDate = req.query.startDate || void 0;
    const endDate = req.query.endDate || void 0;
    const discrepancies = await getInventoryDiscrepancySummary(tenant, period, startDate, endDate);
    res.json(discrepancies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
restRouter.get("/recipes/calculations", async (req, res) => {
  try {
    const tenant = req.query.tenant || void 0;
    const category = req.query.category || void 0;
    const type = req.query.type || "all";
    const search = req.query.search || void 0;
    const minFoodCost = req.query.minFoodCost ? parseFloat(req.query.minFoodCost) : void 0;
    const maxFoodCost = req.query.maxFoodCost ? parseFloat(req.query.maxFoodCost) : void 0;
    const missingRecipesOnly = req.query.missingRecipesOnly === "true" || req.query.missingRecipesOnly === "1";
    const includeDisabled = req.query.includeDisabled === "true" || req.query.includeDisabled === "1";
    const sortBy = req.query.sortBy || "food_cost_pct";
    const sortDirection = req.query.sortDirection || "desc";
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
restRouter.get("/recipes/dish-details", async (req, res) => {
  try {
    const dish = req.query.dish || req.query.itemId || req.query.name;
    const tenant = req.query.tenant || void 0;
    if (!dish) return res.status(400).json({ error: "dish parameter is required (name, ID or hash)" });
    const details = await getDishRecipeDetails(dish, tenant);
    res.json(details);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
restRouter.get("/recipes/semi-finished", async (req, res) => {
  try {
    const tenant = req.query.tenant || void 0;
    const search = req.query.search || void 0;
    const semi = await getSemiFinishedAnalytics(tenant, search);
    res.json(semi);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
function getOpenApiSchema(baseUrl = "https://mcp.restiq.ge") {
  return {
    openapi: "3.0.0",
    info: {
      title: "RestIQ POS & Restaurant Analytics API",
      description: "API for real-time restaurant revenue, shift X/Z reports, sales, top menu items, expenses, purchases, inventories, and recipe costings.",
      version: "1.1.0"
    },
    servers: [
      {
        url: baseUrl
      }
    ],
    paths: {
      "/api/today-summary": {
        get: {
          operationId: "getTodaySummary",
          summary: "Get today financial summary (Revenue, Cash In Drawer, Average Check, Discounts)",
          parameters: [
            { name: "tenant", in: "query", required: false, schema: { type: "string" }, description: "Tenant name or slug" },
            { name: "date", in: "query", required: false, schema: { type: "string" }, description: "Date YYYY-MM-DD (defaults to today)" }
          ],
          responses: { "200": { description: "Successful response" } }
        }
      },
      "/api/purchases": {
        get: {
          operationId: "getPurchasesAnalytics",
          summary: "Get procurement and purchases analytics aggregated by period, suppliers and warehouses",
          parameters: [
            { name: "tenant", in: "query", required: false, schema: { type: "string" } },
            { name: "period", in: "query", required: false, schema: { type: "string", enum: ["today", "yesterday", "this_week", "this_month", "last_month", "custom"] } }
          ],
          responses: { "200": { description: "Successful response" } }
        }
      },
      "/api/inventory/acts": {
        get: {
          operationId: "getInventoryActs",
          summary: "List inventory acts with shortage, surplus and net discrepancies",
          parameters: [
            { name: "tenant", in: "query", required: false, schema: { type: "string" } }
          ],
          responses: { "200": { description: "Successful response" } }
        }
      },
      "/api/recipes/calculations": {
        get: {
          operationId: "getRecipeCalculations",
          summary: "Get dish prime costs, food cost %, and gross margin",
          parameters: [
            { name: "tenant", in: "query", required: false, schema: { type: "string" } },
            { name: "minFoodCost", in: "query", required: false, schema: { type: "number" } }
          ],
          responses: { "200": { description: "Successful response" } }
        }
      }
    }
  };
}

// src/sse-server.ts
var app = express();
app.use(cors());
app.use(express.json());
var port = parseInt(process.env.MCP_PORT || process.env.PORT || "3005", 10);
var transports = /* @__PURE__ */ new Map();
function createMcpServer() {
  const server = new McpServer2({
    name: "pos-analytics-mcp-server",
    version: "1.0.0"
  });
  registerTools(server);
  registerResources(server);
  return server;
}
app.get(["/sse", "/mcp"], async (req, res) => {
  console.log(`New incoming SSE MCP client connection on ${req.path}`);
  const transport = new SSEServerTransport("/messages", res);
  const server = createMcpServer();
  await server.connect(transport);
  transports.set(transport.sessionId, transport);
  req.on("close", () => {
    console.log(`SSE Client ${transport.sessionId} disconnected`);
    transports.delete(transport.sessionId);
  });
});
app.post(["/messages", "/mcp/messages"], async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).send("Session not found or expired");
    return;
  }
  await transport.handlePostMessage(req, res);
});
app.use("/api", restRouter);
app.get("/openapi.json", (req, res) => {
  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "mcp.restiq.ge";
  const baseUrl = `${protocol}://${host}`;
  res.json(getOpenApiSchema(baseUrl));
});
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    server: "pos-analytics-mcp-server",
    active_sessions: transports.size,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
});
app.listen(port, () => {
  console.log(`\u{1F310} POS Analytics MCP Server (SSE/HTTP) listening on http://localhost:${port}`);
  console.log(`\u{1F4E1} SSE Endpoint (MCP): http://localhost:${port}/sse`);
  console.log(`\u2709\uFE0F Message Endpoint: http://localhost:${port}/messages`);
  console.log(`\u{1F4D6} OpenAPI Spec (ChatGPT Actions): http://localhost:${port}/openapi.json`);
  console.log(`\u2764\uFE0F Health Check: http://localhost:${port}/health`);
});
