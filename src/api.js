// Backend access: Supabase (auth + data) and the Netlify AI function.
import { createClient } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
// On the web the functions live on the same site; in the iOS app they're on your Netlify domain.
const API_BASE = Capacitor.isNativePlatform() ? (import.meta.env.VITE_API_BASE || "") : "";

export const configured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

// Keep the session in native storage on iOS so it survives WebView data purges.
const nativeStorage = {
  getItem: async k => (await Preferences.get({ key: k })).value,
  setItem: async (k, v) => { await Preferences.set({ key: k, value: v }); },
  removeItem: async k => { await Preferences.remove({ key: k }); },
};

export const supabase = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: Capacitor.isNativePlatform() ? nativeStorage : undefined,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: !Capacitor.isNativePlatform(),
      },
    })
  : null;

/* ---------- data ---------- */
export async function loadAll(uid) {
  const [p, j, l] = await Promise.all([
    supabase.from("profiles").select("*").eq("user_id", uid).maybeSingle(),
    supabase.from("jobs").select("id,data").eq("user_id", uid),
    supabase.from("letters").select("id,data").eq("user_id", uid),
  ]);
  for (const r of [p, j, l]) if (r.error) throw r.error;
  const jobs = {}, letters = {};
  (j.data || []).forEach(r => { jobs[r.id] = { ...r.data, id: r.id }; });
  (l.data || []).forEach(r => { letters[r.id] = { ...r.data, id: r.id }; });
  const prof = p.data || {};
  return {
    profile: { name: prof.name || "", target: prof.target || "", resume: prof.resume || "", experience: prof.experience || "" },
    aiConsent: !!prof.ai_consent,
    jobs, letters,
  };
}
const check = r => { if (r.error) throw r.error; return r; };
export const saveProfile = (uid, p, aiConsent) =>
  supabase.from("profiles").upsert({ user_id: uid, name: p.name, target: p.target, resume: p.resume, experience: p.experience, ai_consent: aiConsent, updated_at: new Date().toISOString() }).then(check);
export const saveJob = (uid, job) =>
  supabase.from("jobs").upsert({ id: job.id, user_id: uid, data: job, updated_at: new Date().toISOString() }).then(check);
export const deleteJob = id => supabase.from("jobs").delete().eq("id", id).then(check);
export const saveLetter = (uid, l) =>
  supabase.from("letters").upsert({ id: l.id, user_id: uid, data: l, updated_at: new Date().toISOString() }).then(check);
export const deleteLetter = id => supabase.from("letters").delete().eq("id", id).then(check);

async function token() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

export async function deleteAccount() {
  const t = await token();
  const res = await fetch(API_BASE + "/api/delete-account", { method: "POST", headers: { Authorization: "Bearer " + t } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Couldn't delete the account.");
}

/* ---------- AI ---------- */
// Streams plain text from the AI function. kind: chat | fit | cover | tweaks | interview | extract
export async function ai(kind, payload, { signal, onText } = {}) {
  const t = await token();
  if (!t) throw { code: "session_expired" };
  let res;
  try {
    res = await fetch(API_BASE + "/api/ai", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
      body: JSON.stringify({ kind, ...payload }),
    });
  } catch (e) {
    throw { code: e?.name === "AbortError" ? "cancelled" : "network" };
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw { code: err.code || "upstream_error", message: err.message };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      if (text.includes("\u0000ERR:")) {
        const [ok, code] = text.split("\u0000ERR:");
        throw { code: code.trim() || "upstream_error", text: ok };
      }
      onText?.(text);
    }
  } catch (e) {
    if (e?.name === "AbortError") throw { code: "cancelled", text };
    throw e.code ? e : { code: "upstream_error", text };
  }
  if (!text.trim()) throw { code: "empty_completion" };
  return text;
}

export async function aiJson(kind, payload, opts) {
  const text = await ai(kind, payload, opts);
  const v = parseJsonLoose(text);
  if (v === undefined) throw { code: "invalid_json", text };
  return v;
}

export function parseJsonLoose(t) {
  const tryP = s => { try { return JSON.parse(s); } catch { return undefined; } };
  let v = tryP(t.trim()); if (v !== undefined) return v;
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) { v = tryP(fence[1].trim()); if (v !== undefined) return v; }
  const a = t.search(/[[{]/), b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (a >= 0 && b > a) return tryP(t.slice(a, b + 1));
  return undefined;
}
