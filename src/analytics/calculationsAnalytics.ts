import { supabase, resolveTenant, fetchAllRows } from '../db.js';

export interface RecipeIngredientSummary {
  product_id: number;
  product_name: string;
  unit_name: string;
  quantity: number;
  unit_cost_price: number;
  line_total_cost: number;
  cost_share_pct: number;
  is_semi_finished?: boolean;
}

export interface DishCostSummary {
  item_id: number;
  name: string;
  name_en?: string;
  name_ru?: string;
  hash: string;
  category_name: string;
  type: string;
  selling_price: number;
  cost_price: number;
  gross_margin: number;
  food_cost_pct: number;
  markup_pct: number;
  ingredients_count: number;
  has_recipe: boolean;
  is_disabled: boolean;
}

export interface RecipeCalculationsResult {
  tenant: {
    id: string;
    name: string;
    currency: string;
  };
  summary: {
    total_dishes_count: number;
    dishes_with_recipe: number;
    dishes_without_recipe: number;
    average_food_cost_pct: number;
    average_selling_price: number;
    average_cost_price: number;
    average_margin: number;
    high_food_cost_count: number; // dishes with food cost > 35%
  };
  dishes: DishCostSummary[];
}

export async function getRecipeCalculations(
  tenantIdentifier?: string,
  options: {
    category?: string;
    type?: string; // 'all' | 'kitchen' | 'bar' | 'restourant' | 'hookah'
    search?: string;
    minFoodCost?: number;
    maxFoodCost?: number;
    missingRecipesOnly?: boolean;
    includeDisabled?: boolean;
    sortBy?: 'food_cost_pct' | 'cost_price' | 'margin' | 'selling_price' | 'name';
    sortDirection?: 'asc' | 'desc';
    limit?: number;
  } = {}
): Promise<RecipeCalculationsResult> {
  const tenant = await resolveTenant(tenantIdentifier);
  const limit = options.limit || 100;
  const sortBy = options.sortBy || 'food_cost_pct';
  const sortDirection = options.sortDirection || 'desc';

  // 1. Fetch Categories
  const { data: categoriesData } = await supabase
    .from('categories')
    .select('id, name, hash, type')
    .eq('tenant_id', tenant.id);

  const categoryMap = new Map<string, string>();
  (categoriesData || []).forEach((c: any) => {
    if (c.hash) categoryMap.set(c.hash, c.name);
    if (c.id) categoryMap.set(String(c.id), c.name);
  });

  // 2. Fetch Units
  const { data: unitsData } = await supabase.from('units').select('id, name, short_name');
  const unitMap = new Map<number, string>((unitsData || []).map((u: any) => [u.id, u.short_name || u.name]));

  // 3. Fetch Items (dishes)
  let itemsQuery = supabase
    .from('items')
    .select('id, name, name_en, name_ru, hash, price, category, type, disable, tenant_id')
    .eq('tenant_id', tenant.id);

  if (!options.includeDisabled) {
    itemsQuery = itemsQuery.eq('disable', 0);
  }

  if (options.type && options.type !== 'all') {
    if (options.type === 'kitchen') {
      itemsQuery = itemsQuery.in('type', ['restourant', 'kitchen']);
    } else {
      itemsQuery = itemsQuery.eq('type', options.type);
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
      tenant: { id: tenant.id, name: tenant.name, currency: tenant.currency || 'GEL' },
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

  // 4. Fetch Recipes (need table) for tenant
  const needRows = await fetchAllRows(async (from, to) => {
    return supabase
      .from('need')
      .select('id, hash, item, count, dish_hash, dish_id, item_type')
      .eq('tenant_id', tenant.id)
      .range(from, to);
  });

  // Group need rows by item hash
  const needMap = new Map<string, any[]>();
  needRows.forEach(n => {
    if (!n.hash) return;
    const list = needMap.get(n.hash) || [];
    list.push(n);
    needMap.set(n.hash, list);
  });

  // 5. Fetch Products
  const prodIds = [...new Set(needRows.map(n => n.item).filter(Boolean))];
  const { data: productsData } = prodIds.length > 0
    ? await supabase.from('products').select('id, name, price, ert, count, type').in('id', prodIds)
    : { data: [] };

  const prodMap = new Map<number, any>();
  (productsData || []).forEach((p: any) => prodMap.set(p.id, p));

  // 6. Fetch Semi-Finished Products to resolve accurate cost per unit
  const { data: semiData } = await supabase
    .from('semi_finished_products')
    .select('id, product_id, target_weight, total_cost')
    .eq('tenant_id', tenant.id);

  const semiMap = new Map<number, any>();
  (semiData || []).forEach((s: any) => {
    if (s.product_id) semiMap.set(s.product_id, s);
  });

  // Adjust product prices if they are semi-finished items
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

  // 7. Calculate Costs and Margins for each dish
  const calculatedDishes: DishCostSummary[] = [];
  let sumFoodCostPct = 0;
  let dishesWithRecipeCount = 0;
  let totalSellingPrice = 0;
  let totalCostPrice = 0;
  let highFoodCostCount = 0;

  for (const item of items) {
    const itemNeeds = needMap.get(item.hash) || [];
    const hasRecipe = itemNeeds.length > 0;
    let costPrice = 0;

    itemNeeds.forEach(n => {
      const prod = prodMap.get(n.item);
      const qty = parseFloat(n.count) || 0;
      const unitCost = Math.max(0, parseFloat(prod?.price) || 0);
      costPrice += qty * unitCost;
    });

    const sellPrice = parseFloat(item.price) || 0;
    const margin = sellPrice - costPrice;
    const foodCostPct = sellPrice > 0 ? (costPrice / sellPrice) * 100 : 0;
    const markupPct = costPrice > 0 ? ((sellPrice - costPrice) / costPrice) * 100 : 0;

    // Resolve Category Name
    let catName = 'კატეგორიის გარეშე';
    if (item.category) {
      const cleaned = item.category.replace(/,/g, '').trim();
      catName = categoryMap.get(cleaned) || categoryMap.get(item.category) || `კატეგორია #${cleaned}`;
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
      type: item.type === 'bar' ? 'ბარი' : item.type === 'hookah' ? 'ჰუკა' : 'სამზარეულო',
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

  // Filter if requested
  let filtered = calculatedDishes;
  if (options.missingRecipesOnly) {
    filtered = filtered.filter(d => !d.has_recipe);
  }
  if (options.minFoodCost !== undefined) {
    filtered = filtered.filter(d => d.food_cost_pct >= options.minFoodCost!);
  }
  if (options.maxFoodCost !== undefined) {
    filtered = filtered.filter(d => d.food_cost_pct <= options.maxFoodCost!);
  }
  if (options.category) {
    const cLow = options.category.toLowerCase();
    filtered = filtered.filter(d => d.category_name.toLowerCase().includes(cLow));
  }

  // Sort
  filtered.sort((a, b) => {
    let valA = a[sortBy] as any;
    let valB = b[sortBy] as any;
    if (typeof valA === 'string') {
      return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return sortDirection === 'asc' ? valA - valB : valB - valA;
  });

  const avgFoodCost = dishesWithRecipeCount > 0 ? sumFoodCostPct / dishesWithRecipeCount : 0;
  const avgSelling = items.length > 0 ? totalSellingPrice / items.length : 0;
  const avgCost = dishesWithRecipeCount > 0 ? totalCostPrice / dishesWithRecipeCount : 0;

  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      currency: tenant.currency || 'GEL'
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

export async function getDishRecipeDetails(
  itemIdOrNameOrHash: string | number,
  tenantIdentifier?: string
) {
  const tenant = await resolveTenant(tenantIdentifier);

  // 1. Find the Item
  let itemQuery = supabase
    .from('items')
    .select('id, name, name_en, name_ru, hash, price, category, type, disable, tenant_id')
    .eq('tenant_id', tenant.id);

  const queryStr = String(itemIdOrNameOrHash).trim();
  if (/^\d+$/.test(queryStr) && queryStr.length < 8) {
    itemQuery = itemQuery.or(`id.eq.${queryStr},name.ilike.%${queryStr}%`);
  } else if (/^[a-f0-9]{32}$/i.test(queryStr)) {
    itemQuery = itemQuery.eq('hash', queryStr);
  } else {
    itemQuery = itemQuery.ilike('name', `%${queryStr}%`);
  }

  const { data: itemData, error: itemErr } = await itemQuery.limit(1).maybeSingle();
  if (itemErr) throw itemErr;
  if (!itemData) {
    throw new Error(`კერძი პარამეტრით "${itemIdOrNameOrHash}" ვერ მოიძებნა.`);
  }

  const item = itemData;

  // 2. Fetch Category Name
  let categoryName = 'კატეგორიის გარეშე';
  if (item.category) {
    const cleaned = item.category.replace(/,/g, '').trim();
    const { data: cat } = await supabase.from('categories').select('name').eq('id', cleaned).maybeSingle();
    if (cat?.name) categoryName = cat.name;
  }

  // 3. Fetch Units Map
  const { data: unitsData } = await supabase.from('units').select('id, name, short_name');
  const unitMap = new Map<number, string>((unitsData || []).map((u: any) => [u.id, u.short_name || u.name]));

  // 4. Fetch Recipe Need rows
  const { data: needList, error: needErr } = await supabase
    .from('need')
    .select('id, hash, item, count, dish_hash, dish_id, item_type')
    .eq('tenant_id', tenant.id)
    .eq('hash', item.hash);

  if (needErr) throw needErr;

  const productIds = (needList || []).map(n => n.item).filter(Boolean);

  // 5. Fetch Products
  const { data: productsData } = productIds.length > 0
    ? await supabase.from('products').select('id, name, price, ert, count, type').in('id', productIds)
    : { data: [] };

  const prodMap = new Map<number, any>((productsData || []).map((p: any) => [p.id, p]));

  // 6. Fetch Semi-Finished info
  const { data: semiData } = await supabase
    .from('semi_finished_products')
    .select('id, product_id, target_weight, total_cost')
    .eq('tenant_id', tenant.id)
    .in('product_id', productIds);

  const semiMap = new Map<number, any>((semiData || []).map((s: any) => [s.product_id, s]));

  // 7. Calculate itemized ingredients
  let totalPrimeCost = 0;
  const rawIngredients: Array<{
    product_id: number;
    product_name: string;
    unit_name: string;
    quantity: number;
    unit_cost_price: number;
    line_total_cost: number;
    is_semi_finished: boolean;
  }> = [];

  for (const need of (needList || [])) {
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
      product_name: prod?.name || `პროდუქტი #${need.item}`,
      unit_name: prod ? (unitMap.get(prod.ert) || 'ც') : 'ც',
      quantity: Number(qty.toFixed(4)),
      unit_cost_price: Number(unitCost.toFixed(3)),
      line_total_cost: Number(lineCost.toFixed(3)),
      is_semi_finished: isSemi
    });
  }

  const ingredients: RecipeIngredientSummary[] = rawIngredients.map(ing => ({
    ...ing,
    cost_share_pct: totalPrimeCost > 0 ? Number(((ing.line_total_cost / totalPrimeCost) * 100).toFixed(1)) : 0
  })).sort((a, b) => b.line_total_cost - a.line_total_cost);

  const sellPrice = parseFloat(item.price) || 0;
  const margin = sellPrice - totalPrimeCost;
  const foodCostPct = sellPrice > 0 ? (totalPrimeCost / sellPrice) * 100 : 0;
  const markupPct = totalPrimeCost > 0 ? ((sellPrice - totalPrimeCost) / totalPrimeCost) * 100 : 0;

  return {
    tenant_name: tenant.name,
    item: {
      id: item.id,
      name: item.name,
      name_en: item.name_en,
      name_ru: item.name_ru,
      hash: item.hash,
      category_name: categoryName,
      type: item.type === 'bar' ? 'ბარი' : item.type === 'hookah' ? 'ჰუკა' : 'სამზარეულო',
      selling_price: Number(sellPrice.toFixed(2)),
      prime_cost: Number(totalPrimeCost.toFixed(2)),
      gross_margin: Number(margin.toFixed(2)),
      food_cost_pct: Number(foodCostPct.toFixed(1)),
      markup_pct: Number(markupPct.toFixed(1)),
      ingredients_count: ingredients.length,
      has_recipe: ingredients.length > 0,
      currency: tenant.currency || 'GEL'
    },
    ingredients
  };
}

export async function getSemiFinishedAnalytics(
  tenantIdentifier?: string,
  search?: string
) {
  const tenant = await resolveTenant(tenantIdentifier);

  // 1. Fetch Semi-Finished Products
  let query = supabase
    .from('semi_finished_products')
    .select('id, name, unit, target_weight, total_cost, created_at, updated_at, product_id, tenant_id')
    .eq('tenant_id', tenant.id);

  if (search) {
    query = query.ilike('name', `%${search.trim()}%`);
  }

  const { data: semiList, error: semiErr } = await query.order('name', { ascending: true });
  if (semiErr) throw semiErr;

  const semiIds = (semiList || []).map(s => s.id);

  // 2. Fetch Units Map
  const { data: unitsData } = await supabase.from('units').select('id, name, short_name');
  const unitMap = new Map<number, string>((unitsData || []).map((u: any) => [u.id, u.short_name || u.name]));

  // 3. Fetch Semi-Finished Ingredients
  const { data: ingrData } = semiIds.length > 0
    ? await supabase.from('semi_finished_ingredients').select('*').in('semi_finished_id', semiIds)
    : { data: [] };

  const prodIds = [...new Set((ingrData || []).map(i => i.product_id).filter(Boolean))];
  const { data: prodsData } = prodIds.length > 0
    ? await supabase.from('products').select('id, name, ert').in('id', prodIds)
    : { data: [] };

  const prodMap = new Map<number, any>((prodsData || []).map((p: any) => [p.id, p]));

  const ingrMap = new Map<number, any[]>();
  (ingrData || []).forEach(i => {
    const list = ingrMap.get(i.semi_finished_id) || [];
    list.push(i);
    ingrMap.set(i.semi_finished_id, list);
  });

  const result = (semiList || []).map(s => {
    const tw = parseFloat(s.target_weight) || 1;
    const tc = parseFloat(s.total_cost) || 0;
    const unitCost = tw > 0 ? tc / tw : 0;
    const unitName = unitMap.get(s.unit) || 'კგ';

    const ingredients = (ingrMap.get(s.id) || []).map(ing => {
      const p = prodMap.get(ing.product_id);
      return {
        product_id: ing.product_id,
        product_name: p?.name || `პროდუქტი #${ing.product_id}`,
        unit_name: p ? (unitMap.get(p.ert) || 'ც') : 'ც',
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
