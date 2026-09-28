import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "https://vote.smtop100.blog",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });
  if (req.headers.get("origin") !== "https://vote.smtop100.blog") {
    return new Response(JSON.stringify({ error: "Invalid origin" }), { status: 403, headers: cors });
  }

  const body = await req.json().catch(() => ({}));
  const code = String(body.code || "");
  if (!/^[a-f0-9]{64}$/.test(code)) {
    return new Response(JSON.stringify({ error: "Invalid handoff" }), { status: 400, headers: cors });
  }

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");

  const { data: row } = await service
    .from("manager_auth_handoffs")
    .select("auth_user_id,expires_at,consumed_at")
    .eq("code_hash", hash)
    .eq("destination", "vote")
    .maybeSingle();

  if (!row || row.consumed_at || new Date(row.expires_at) <= new Date()) {
    return new Response(JSON.stringify({ error: "Handoff expired or already used" }), { status: 400, headers: cors });
  }

  const { data: account } = await service
    .from("manager_portal_accounts")
    .select("id")
    .eq("auth_user_id", row.auth_user_id)
    .eq("active", true)
    .maybeSingle();

  if (!account) return new Response(JSON.stringify({ error: "Manager account unavailable" }), { status: 403, headers: cors });

  const { data: userData, error: userError } = await service.auth.admin.getUserById(row.auth_user_id);
  if (userError || !userData.user?.email) {
    return new Response(JSON.stringify({ error: "User unavailable" }), { status: 400, headers: cors });
  }

  const { data: consumed, error: consumeError } = await service
    .from("manager_auth_handoffs")
    .update({ consumed_at: new Date().toISOString() })
    .eq("code_hash", hash)
    .is("consumed_at", null)
    .select("code_hash");

  if (consumeError || consumed?.length !== 1) {
    return new Response(JSON.stringify({ error: "Handoff already used" }), { status: 409, headers: cors });
  }

  const { data: link, error: linkError } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: userData.user.email,
    options: { redirectTo: "https://vote.smtop100.blog/vote" },
  });

  if (linkError || !link?.properties?.hashed_token) {
    return new Response(JSON.stringify({ error: "Could not create voting session" }), { status: 500, headers: cors });
  }

  return new Response(JSON.stringify({ token_hash: link.properties.hashed_token }), { headers: cors });
});