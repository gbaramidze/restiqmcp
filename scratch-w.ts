import { supabase } from './src/db.js';

async function checkWriteoffs() {
  const { data: sampleW } = await supabase.from('writeoff_acts').select('*').limit(1);
  console.log('Sample writeoff columns:', Object.keys(sampleW?.[0] || {}));
}

checkWriteoffs().catch(console.error);
