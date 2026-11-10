// POST /api/delete-account — permanently deletes the signed-in user (Apple guideline 5.1.1(v)).
// Their profile, jobs, letters and usage rows are removed by ON DELETE CASCADE.
import { CORS, json, getUser, SUPABASE_URL, SERVICE_KEY, serviceHeaders } from "../lib/shared.mjs";

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { code: "method_not_allowed" });
  if (!SERVICE_KEY) return json(500, { code: "not_configured", message: "Account deletion isn't configured yet." });

  const user = await getUser(req);
  if (!user) return json(401, { code: "unauthorized", message: "Sign in again, then retry." });

  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, { method: "DELETE", headers: serviceHeaders() });
  if (!r.ok) {
    console.error("delete user failed", r.status, await r.text().catch(() => ""));
    return json(502, { code: "delete_failed", message: "Couldn't delete the account. Try again." });
  }
  return json(200, { ok: true });
};

export const config = { path: "/api/delete-account" };
