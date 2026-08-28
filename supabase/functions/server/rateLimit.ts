import { createClient } from "npm:@supabase/supabase-js@2";

export const DAILY_IMPORT_LIMIT = 20;

export function hasImportCapacity(recentImportCount: number): boolean {
  return recentImportCount < DAILY_IMPORT_LIMIT;
}

export async function countRecentImports(
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
): Promise<number> {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("recipes")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId)
    .gte("created_at", since);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
