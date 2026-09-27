import { createClient } from '@supabase/supabase-js';

function env(name) {
  const value=String(process.env[name]||'').trim();
  if(!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
function db(){ return createClient(env('VITE_SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false}}); }

export async function handler() {
  try {
    const supabase=db();
    let cleaned=0;
    while(true){
      const {data:rows,error}=await supabase.from('manager_match_evidence_cleanup')
        .select('auth_user_id,match_id').order('queued_at',{ascending:true}).range(0,124);
      if(error) throw error;
      if(!rows?.length) break;
      const keys=[];
      for(const row of rows) for(const slot of ['a','b']) for(const ext of ['jpg','png','webp','gif'])
        keys.push(`${row.auth_user_id}/${row.match_id}/evidence-${slot}.${ext}`);
      const {error:storageError}=await supabase.storage.from('match-evidence').remove(keys);
      if(storageError) throw storageError;
      for(const row of rows){
        const {error:deleteError}=await supabase.from('manager_match_evidence_cleanup').delete()
          .eq('auth_user_id',row.auth_user_id).eq('match_id',row.match_id);
        if(deleteError) throw deleteError;
      }
      cleaned+=rows.length;
      if(rows.length<125) break;
    }
    return {statusCode:200,body:JSON.stringify({ok:true,cleaned})};
  } catch(error){ return {statusCode:500,body:JSON.stringify({ok:false,error:error.message})}; }
}
