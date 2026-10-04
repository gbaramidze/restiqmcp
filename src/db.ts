import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { TenantInfo } from './types.js';

// Resolve directory of current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Candidate .env paths to auto-discover
const candidateEnvPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'apps/mcp-server/.env'),
  path.resolve(process.cwd(), 'apps/client/.env'),
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../client/.env'),
  path.resolve(__dirname, '../../../.env')
];

for (const envPath of candidateEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Warning: SUPABASE_URL or SUPABASE_ANON_KEY is missing. Please ensure your .env file is configured.');
}

export const supabase: SupabaseClient = createClient(supabaseUrl || '', supabaseAnonKey || '');

/**
 * Universal pagination helper to overcome the default PostgREST 1000-row limit.
 * Fetches all available records in chunks of 1000 up to maxRows.
 */
export async function fetchAllRows<T = any>(
  queryBuilder: (from: number, to: number) => Promise<{ data: T[] | null; error: any }>,
  batchSize = 1000,
  maxRows = 100000
): Promise<T[]> {
  const allRows: T[] = [];
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

/**
 * Resolves the target tenant based on provided ID, slug, or environment defaults.
 */
export async function resolveTenant(tenantIdentifier?: string): Promise<TenantInfo> {
  const queryParam = tenantIdentifier || process.env.DEFAULT_TENANT || process.env.DEFAULT_TENANT_SLUG || process.env.DEFAULT_TENANT_NAME || process.env.DEFAULT_TENANT_ID;

  let query = supabase.from('tenants').select('id, name, slug, code, currency, tax_id');

  if (queryParam) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(queryParam);
    if (isUuid) {
      query = query.eq('id', queryParam);
    } else {
      query = query.or(`slug.ilike.%${queryParam}%,name.ilike.%${queryParam}%`);
    }
  }

  const { data, error } = await query.limit(1);

  if (error || !data || data.length === 0) {
    // Fallback: pick the first tenant available
    const { data: fallbackData } = await supabase
      .from('tenants')
      .select('id, name, slug, code, currency, tax_id')
      .order('created_at', { ascending: true })
      .limit(1);

    if (fallbackData && fallbackData.length > 0) {
      return {
        id: fallbackData[0].id,
        name: fallbackData[0].name || 'Main Venue',
        slug: fallbackData[0].slug,
        code: fallbackData[0].code,
        currency: fallbackData[0].currency || 'GEL',
        tax_id: fallbackData[0].tax_id
      };
    }

    return {
      id: 'default',
      name: 'Default Venue',
      currency: 'GEL'
    };
  }

  const tenant = data[0];
  return {
    id: tenant.id,
    name: tenant.name || 'Venue',
    slug: tenant.slug,
    code: tenant.code,
    currency: tenant.currency || 'GEL',
    tax_id: tenant.tax_id
  };
}

/**
 * Calculates date range for a given day (00:00:00 to 23:59:59.999)
 * Format adheres to the shift boundary rule: 00:00 - 23:59
 */
export function getDayBounds(dateInput?: string | Date): { start: string; end: string; dateStr: string } {
  const d = dateInput ? new Date(dateInput) : new Date();
  
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  // Local start of day 00:00:00 and end of day 23:59:59.999
  const startObj = new Date(yyyy, d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const endObj = new Date(yyyy, d.getMonth(), d.getDate(), 23, 59, 59, 999);

  return {
    start: startObj.toISOString(),
    end: endObj.toISOString(),
    dateStr
  };
}

/**
 * Calculates start and end timestamps for standard relative period labels
 */
export function getPeriodBounds(period: string, customStart?: string, customEnd?: string): { start: string; end: string; label: string } {
  const now = new Date();

  if (period === 'custom' && customStart && customEnd) {
    const s = new Date(customStart);
    s.setHours(0, 0, 0, 0);
    const e = new Date(customEnd);
    e.setHours(23, 59, 59, 999);
    return {
      start: s.toISOString(),
      end: e.toISOString(),
      label: `${customStart} – ${customEnd}`
    };
  }

  if (period === 'yesterday') {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const b = getDayBounds(y);
    return { start: b.start, end: b.end, label: `გუშინ (${b.dateStr}) / Вчера` };
  }

  if (period === 'this_week') {
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
    const monday = new Date(now.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return {
      start: monday.toISOString(),
      end: new Date().toISOString(),
      label: 'მიმდინარე კვირა / Текущая неделя'
    };
  }

  if (period === 'this_month') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return {
      start: startOfMonth.toISOString(),
      end: new Date().toISOString(),
      label: 'მიმდინარე თვე / Текущий месяц'
    };
  }

  if (period === 'last_month') {
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return {
      start: startOfLastMonth.toISOString(),
      end: endOfLastMonth.toISOString(),
      label: 'გასული თვე / Прошлый месяц'
    };
  }

  // Default: today
  const b = getDayBounds(now);
  return { start: b.start, end: b.end, label: `დღეს (${b.dateStr}) / Сегодня` };
}
