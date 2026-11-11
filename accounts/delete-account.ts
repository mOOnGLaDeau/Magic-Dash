import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const origins = new Set(["https://magicdash.app", "https://moongladeau.github.io"]);
const auth = { persistSession: false, autoRefreshToken: false };
const url = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth });

Deno.serve(async request => {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Access-Control-Allow-Origin": origins.has(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  const reply = (body: object, status: number) => Response.json(body, { status, headers });
  if (origin && !origins.has(origin)) return reply({ error: "Origin not allowed." }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);

  const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return reply({ error: "Sign in to delete your account." }, 401);
  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user?.email || !user.email_confirmed_at) {
    return reply({ error: "Sign in with your verified account to continue." }, 401);
  }
  const body = await request.json().catch(() => null);
  if (typeof body?.password !== "string" || !body.password) {
    return reply({ error: "Enter your current password." }, 400);
  }
  const passwordClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth });
  const { data, error } = await passwordClient.auth.signInWithPassword({ email: user.email, password: body.password });
  if (error || data.user?.id !== user.id) {
    return reply({ error: "Could not verify your password. Check it and try again." }, 403);
  }
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    await passwordClient.auth.signOut({ scope: "local" });
    return reply({ error: "Could not delete your account. Please try again." }, 500);
  }
  return reply({ deleted: true }, 200);
});
