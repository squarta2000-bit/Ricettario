import { createClient } from "npm:@supabase/supabase-js@2";

export async function findConfirmedUserIdByEmail(
  supabaseUrl: string,
  serviceRoleKey: string,
  email: string,
): Promise<string | null> {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await supabase.rpc("find_confirmed_user_id_by_email", { lookup_email: email });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}
