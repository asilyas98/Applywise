import "@fontsource/bricolage-grotesque/600.css";
import "@fontsource/bricolage-grotesque/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";
import { Capacitor } from "@capacitor/core";
import { Clipboard } from "@capacitor/clipboard";
import { Share } from "@capacitor/share";
import { Browser } from "@capacitor/browser";
import * as api from "./api.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const uidGen = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const NATIVE = Capacitor.isNativePlatform();
const API_BASE = NATIVE ? (import.meta.env.VITE_API_BASE || "") : "";
const PRIVACY_URL = (API_BASE || location.origin) + "/privacy.html";

const STATUSES = [
  { id: "saved", name: "Saved" },
  { id: "applied", name: "Applied" },
  { id: "interview", name: "Interviewing" },
  { id: "offer", name: "Offer" },
  { id: "rejected", name: "Closed" },
];

const EXAMPLES = [
  { id: "ex-1", example: true, company: "Brightpath Learning", role: "Full-Stack Engineer, Student Tools", location: "Remote (US)", url: "", status: "interview", applied: "2026-10-20", followUp: "2026-11-03", notes: "Recruiter screen went well. Panel interview next week.",
    jd: "Build React + Node features for our K-12 practice platform used by 2M students. Requirements: 3+ years full-stack JavaScript, React, PostgreSQL, REST APIs, experience shipping to production. Nice to have: education background, accessibility (WCAG), LLM integrations.",
    fit: { score: 84, verdict: "Strong match: shipped student-facing apps and has classroom experience the team values.", strengths: ["Built and deployed full-stack study tools for real students", "Teaching background maps to the product's users", "Experience integrating LLM APIs"], gaps: ["No explicit PostgreSQL work on the resume", "Accessibility / WCAG not mentioned"], missingKeywords: ["PostgreSQL", "WCAG", "K-12", "REST"], advice: "Name the database behind your projects and add one accessibility detail. Lead with student usage numbers." },
    interview: [{ q: "Tell us about a feature you built that changed how students learn.", type: "behavioral", why: "They want product sense grounded in real users.", answer: "Pick your strongest student-facing project: the problem, what you built, how you measured it, and what you changed after feedback." }, { q: "How would you design a practice-test engine that adapts difficulty?", type: "technical", why: "Core to their platform.", answer: "Outline question bank schema, scoring model, next-question selection, and caching. Mention trade-offs between simple rules and IRT." }] },
  { id: "ex-2", example: true, company: "Northgate Health", role: "Frontend Developer", location: "Detroit, MI (hybrid)", url: "", status: "applied", applied: "2026-10-28", followUp: "2026-11-11", notes: "",
    jd: "Own the patient portal UI. Requirements: TypeScript, React, design systems, testing with Jest/Playwright. HIPAA awareness a plus.",
    fit: { score: 68, verdict: "Reasonable match; frontend skills fit, but testing and TypeScript depth need to show.", strengths: ["Solid React experience", "Ships complete products end to end"], gaps: ["TypeScript not listed", "No automated testing examples", "No healthcare domain"], missingKeywords: ["TypeScript", "Jest", "Playwright", "design system", "HIPAA"], advice: "Add TypeScript and any testing you've done. A note on handling sensitive data helps with the HIPAA ask." } },
  { id: "ex-3", example: true, company: "Lumen Robotics", role: "Developer Advocate", location: "Remote", url: "", status: "saved", applied: "", followUp: "", notes: "Referral possible through a meetup contact.", jd: "Teach developers to use our robotics SDK through tutorials, talks, and sample apps." },
];

const S = {
  user: null, jobs: {}, letters: {}, profile: { name: "", target: "", resume: "", experience: "" }, aiConsent: false,
  loaded: false, openId: null, dTab: "overview", view: "pipeline", examples: EXAMPLES.map(j => ({ ...j })), busy: {}, ctl: {}, chatMessages: [], chatBusy: false,
};

/* ---------- helpers ---------- */
const isExample = id => String(id).startsWith("ex-");
const getJob = id => isExample(id) ? S.examples.find(j => j.id === id) : S.jobs[id];
const visibleJobs = () => { const real = Object.values(S.jobs); return real.length ? real : S.examples; };
const fitClass = s => s >= 75 ? "fit-hi" : s >= 50 ? "fit-mid" : "fit-lo";
const fmtDate = d => d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
const hasBackground = () => !!((S.profile.resume || "").trim() || (S.profile.experience || "").trim());
const arr = v => Array.isArray(v) ? v.map(String) : [];
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); }
function aiErr(e) {
  switch (e && e.code) {
    case "daily_limit": return "You've reached today's AI limit. It resets at midnight UTC.";
    case "rate_limited": return "Too many requests right now. Try again in a minute.";
    case "too_large": return "That's too much text. Shorten the resume or job description.";
    case "invalid_json": return "The answer came back in the wrong format. Try again.";
    case "refused": return "Claude declined this request. Try editing the job description.";
    case "session_expired": case "unauthorized": return "Your session expired. Sign out and back in.";
    case "network": return "Can't reach the server. Check your connection.";
    case "no_consent": return "Allow AI sharing to use this feature.";
    case "cancelled": return "Stopped.";
    default: return "Something went wrong reaching Claude. Try again.";
  }
}
async function copyText(text) {
  try { if (NATIVE) await Clipboard.write({ string: text }); else await navigator.clipboard.writeText(text); toast("Copied"); }
  catch { toast("Couldn't copy. Select the text and copy it manually."); }
}
async function shareText(title, text) {
  try {
    if (NATIVE || navigator.share) await Share.share({ title, text, dialogTitle: title });
    else await copyText(text);
  } catch (e) { /* user dismissed the share sheet */ }
}
function openUrl(url) { if (NATIVE) Browser.open({ url }); else window.open(url, "_blank", "noopener"); }

/* ---------- career assistant ---------- */
function renderChat() {
  const thread = $("#chatThread");
  thread.replaceChildren();
  const messages = S.chatMessages.length ? S.chatMessages : [{ role: "assistant", content: "Hi! I can help with your job search, applications, resumes, and interview preparation. I can use your saved background and tracked jobs to make suggestions." }];
  for (const item of messages) {
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${item.role === "user" ? "chat-user" : "chat-assistant"}`;
    bubble.textContent = item.content || (S.chatBusy ? "Thinking…" : "I couldn't create a response. Please try again.");
    thread.append(bubble);
  }
  $("#chatSuggestions").hidden = S.chatMessages.length > 0;
  $("#chatSend").disabled = S.chatBusy;
  $("#chatInput").disabled = S.chatBusy;
  thread.scrollTop = thread.scrollHeight;
}

async function sendChat(raw) {
  const message = String(raw || "").trim().slice(0, 1800);
  if (!message || S.chatBusy) return;
  if (!(await ensureConsent())) return;
  S.chatMessages.push({ role: "user", content: message });
  S.chatMessages.push({ role: "assistant", content: "" });
  S.chatBusy = true;
  renderChat();
  const current = S.chatMessages.length - 1;
  const jobs = Object.values(S.jobs).sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 20).map(j => ({
    role: j.role || "", company: j.company || "", status: j.status || "saved", location: j.location || "",
    notes: j.notes || "", fitScore: Number.isFinite(j.fit?.score) ? j.fit.score : null,
  }));
  try {
    const messages = S.chatMessages.slice(0, current).slice(-10).map(m => ({ role: m.role, content: m.content }));
    await api.ai("chat", { profile: { ...S.profile }, options: { messages, jobs } }, { onText: text => { S.chatMessages[current].content = text; renderChat(); } });
  } catch (e) {
    S.chatMessages[current].content = aiErr(e);
  } finally {
    S.chatBusy = false;
    renderChat();
  }
}

$("#chatForm").addEventListener("submit", e => {
  e.preventDefault();
  const input = $("#chatInput"), value = input.value;
  input.value = "";
  sendChat(value);
});
$("#chatClear").onclick = () => { if (S.chatBusy) return; S.chatMessages = []; renderChat(); };
$("#chatSuggestions").addEventListener("click", e => {
  const b = e.target.closest("[data-chat-suggestion]");
  if (b) sendChat(b.dataset.chatSuggestion);
});

/* ---------- persistence ---------- */
const chains = {};
function queueWrite(key, fn) {
  chains[key] = (chains[key] || Promise.resolve()).then(fn).catch(e => {
    console.error(e); toast("Couldn't save that change. Check your connection.");
  });
  return chains[key];
}
function persistJob(id) {
  if (isExample(id) || !S.jobs[id]) return;
  const body = JSON.parse(JSON.stringify(S.jobs[id]));
  queueWrite("job:" + id, () => api.saveJob(S.user.id, body));
}
function removeJob(id) { delete S.jobs[id]; queueWrite("job:" + id, () => api.deleteJob(id)); }
const jobTimers = {};
function persistJobSoon(id) { clearTimeout(jobTimers[id]); jobTimers[id] = setTimeout(() => persistJob(id), 700); }
let profTimer;
function persistProfile(now) {
  clearTimeout(profTimer);
  $("#pSaved").textContent = "Saving…";
  const go = () => { const p = { ...S.profile }; queueWrite("profile", () => api.saveProfile(S.user.id, p, S.aiConsent)).then(() => $("#pSaved").textContent = "Saved"); };
  if (now) go(); else profTimer = setTimeout(go, 700);
}
function persistLetter(id) { const body = { ...S.letters[id] }; queueWrite("letter:" + id, () => api.saveLetter(S.user.id, body)); }

/* ---------- AI consent (App Store 5.1.2: disclose third-party AI sharing) ---------- */
function ensureConsent() {
  if (S.aiConsent) return Promise.resolve(true);
  return new Promise(resolve => {
    const m = $("#consentModal"); m.hidden = false;
    const done = ok => { m.hidden = true; $("#consentYes").onclick = $("#consentNo").onclick = null; if (ok) setConsent(true); resolve(ok); };
    $("#consentYes").onclick = () => done(true);
    $("#consentNo").onclick = () => done(false);
  });
}
function setConsent(v) { S.aiConsent = v; persistProfile(true); renderAccount(); }
const payloadFor = j => ({ job: { company: j.company || "", role: j.role || "", location: j.location || "", jd: (j.jd || "").slice(0, 14000) }, profile: { name: S.profile.name, target: S.profile.target, resume: (S.profile.resume || "").slice(0, 12000), experience: (S.profile.experience || "").slice(0, 10000) } });

/* ---------- render: pipeline ---------- */
function isDue(j) { return j.followUp && j.status !== "rejected" && j.status !== "offer" && j.followUp <= today(); }
function renderSummary() {
  const jobs = visibleJobs();
  const applied = jobs.filter(j => j.status !== "saved").length;
  const heard = jobs.filter(j => j.status === "interview" || j.status === "offer").length;
  const active = jobs.filter(j => j.status !== "rejected" && j.status !== "offer").length;
  const fits = jobs.filter(j => j.fit && typeof j.fit.score === "number").map(j => j.fit.score);
  const avg = fits.length ? Math.round(fits.reduce((a, b) => a + b, 0) / fits.length) : null;
  const due = jobs.filter(isDue).length;
  $("#summary").innerHTML = [
    ["Active", active, "jobs in play"],
    ["Applied", applied, "applications sent"],
    ["Response rate", applied ? Math.round(heard / applied * 100) + "%" : "—", "reached interview or offer"],
    ["Avg. fit", avg == null ? "—" : avg, "across analyzed jobs"],
    ["Follow-ups due", due, due ? "check these today" : "nothing overdue"],
  ].map(([l, v, s]) => `<div class="stat"><span class="label">${l}</span><b>${esc(v)}</b><small>${s}</small></div>`).join("");
}
function renderBoard() {
  const jobs = visibleJobs();
  $("#exBanner").hidden = !(S.loaded && Object.keys(S.jobs).length === 0);
  $("#resumeBanner").hidden = !S.loaded || hasBackground();
  $("#board").innerHTML = STATUSES.map(st => {
    const list = jobs.filter(j => (j.status || "saved") === st.id).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    return `<div class="col"><div class="col-h"><span class="dot" style="background:var(--st-${st.id})"></span><h3>${st.name}</h3><span class="n">${list.length}</span></div>
      ${list.length ? list.map(cardHtml).join("") : `<div class="empty-col">${st.id === "saved" ? "Jobs you're considering" : "None yet"}</div>`}</div>`;
  }).join("");
  renderSummary();
}
function cardHtml(j) {
  const bits = [];
  if (j.fit && typeof j.fit.score === "number") bits.push(`<span class="pill ${fitClass(j.fit.score)}">fit ${j.fit.score}</span>`);
  if (isDue(j)) bits.push(`<span class="pill due">follow up</span>`);
  if (j.applied) bits.push(`<span>applied ${fmtDate(j.applied)}</span>`);
  if (j.example) bits.push(`<span class="pill ex">example</span>`);
  return `<button class="card" data-open="${esc(j.id)}"><span class="co">${esc(j.company || "Company")}${j.location ? " · " + esc(j.location) : ""}</span><span class="role">${esc(j.role || "Untitled role")}</span>${bits.length ? `<span class="meta">${bits.join("")}</span>` : ""}</button>`;
}

/* ---------- drawer ---------- */
const DTABS = [["overview", "Overview"], ["fit", "Fit score"], ["cover", "Cover letter"], ["tweaks", "Resume tweaks"], ["interview", "Interview prep"]];
function openJob(id, tab) {
  S.openId = id; S.dTab = tab || "overview";
  $("#drawer").hidden = false; $("#scrim").hidden = false;
  document.body.style.overflow = "hidden";
  renderDrawer();
}
function closeJob() {
  S.openId = null; $("#drawer").hidden = true; $("#scrim").hidden = true; document.body.style.overflow = "";
  renderBoard();
}
function renderDrawer() {
  const j = getJob(S.openId);
  if (!j) { closeJob(); return; }
  const d = $("#drawer");
  const scroll = $(".d-body", d)?.scrollTop || 0;
  d.innerHTML = `<div class="d-head"><div class="d-title"><div><div class="co">${esc(j.company || "Company")}${j.example ? ' <span class="pill ex">example</span>' : ""}</div><h2>${esc(j.role || "Untitled role")}</h2></div><button class="btn ghost x" id="dClose">Done</button></div>
    <div class="d-tabs" role="tablist">${DTABS.map(([k, n]) => `<button class="d-tab" role="tab" data-dtab="${k}" aria-selected="${S.dTab === k}">${n}</button>`).join("")}</div></div>
    <div class="d-body" id="dBody">${tabHtml(j)}</div>`;
  $(".d-body", d).scrollTop = scroll;
  bindDrawer(j);
}
function needs(j) {
  if (j.example) return `<div class="hint">This is an example job. Add your own job to run the AI tools on it.</div>`;
  if (!hasBackground()) return `<div class="hint">Add your resume or work experience first. The AI works from it. <button class="btn sm" data-goto="resume" style="margin-left:6px">Add background</button></div>`;
  if (!(j.jd || "").trim()) return `<div class="hint">Paste the job description in the Overview tab so the AI has something to work from.</div>`;
  return "";
}
function aiBar(j, kind, label, extra = "") {
  if (j.example) return "";
  const busy = S.busy[j.id + kind];
  const has = kind === "fit" ? j.fit : kind === "cover" ? j.cover : kind === "tweaks" ? j.tweaks : j.interview;
  const err = S.busy[j.id + kind + ":err"];
  return `<div class="actions">${extra}<button class="btn primary" data-ai="${kind}" ${busy || needs(j) ? "disabled" : ""}>${busy ? "Working…" : has ? "Regenerate" : label}</button>${busy ? `<button class="btn ghost" data-stop="${kind}">Stop</button>` : ""}<span class="status-msg ${err ? "err" : ""}">${esc(err || (busy ? "Claude is reading the posting and your background…" : ""))}</span></div>`;
}
function tabHtml(j) {
  if (S.dTab === "overview") {
    return `<div class="panel">
      <div class="row">
        <div class="field"><label class="label" for="fStatus">Status</label><select id="fStatus" data-f="status">${STATUSES.map(s => `<option value="${s.id}" ${j.status === s.id ? "selected" : ""}>${s.name}</option>`).join("")}</select></div>
        <div class="field"><label class="label" for="fApplied">Applied on</label><input id="fApplied" type="date" data-f="applied" value="${esc(j.applied)}"></div>
        <div class="field"><label class="label" for="fFollow">Follow up on</label><input id="fFollow" type="date" data-f="followUp" value="${esc(j.followUp)}"></div>
      </div>
      <div class="row">
        <div class="field"><label class="label" for="fCompany">Company</label><input id="fCompany" data-f="company" value="${esc(j.company)}"></div>
        <div class="field"><label class="label" for="fRole">Role</label><input id="fRole" data-f="role" value="${esc(j.role)}"></div>
      </div>
      <div class="row">
        <div class="field"><label class="label" for="fLoc">Location</label><input id="fLoc" data-f="location" value="${esc(j.location)}"></div>
        <div class="field"><label class="label" for="fUrl">Posting link</label><input id="fUrl" type="url" inputmode="url" autocapitalize="off" data-f="url" value="${esc(j.url)}"></div>
      </div>
      ${j.url && /^https?:\/\//.test(j.url) ? `<button class="btn sm" id="openPosting" style="justify-self:start">Open posting ↗</button>` : ""}
      <div class="field"><label class="label" for="fNotes">Notes</label><textarea id="fNotes" data-f="notes" placeholder="Contacts, referral, salary range, how the call went…">${esc(j.notes)}</textarea></div>
      <div class="field"><label class="label" for="fJd">Job description</label><textarea id="fJd" data-f="jd" rows="10" placeholder="Paste the full posting.">${esc(j.jd)}</textarea></div>
      ${j.example ? "" : `<div class="actions" id="delZone"><button class="btn danger sm" id="delBtn">Delete job</button></div>`}
    </div>`;
  }
  if (S.dTab === "fit") {
    const f = j.fit;
    return `${needs(j)}${aiBar(j, "fit", "Analyze my fit")}
    ${f ? `<div class="box meter"><span class="label">Fit score</span><div class="score"><b>${esc(f.score)}</b><span>/ 100 · ${f.score >= 75 ? "Strong" : f.score >= 50 ? "Reasonable" : "Stretch"}</span></div>
      <div class="track" role="img" aria-label="Score ${esc(f.score)} of 100"><i style="left:${Math.max(0, Math.min(100, +f.score || 0))}%"></i></div>
      <div class="scale"><span style="left:0">0</span><span style="left:50%">50</span><span style="left:75%">75</span><span style="left:100%">100</span></div>
      <p style="margin:4px 0 0">${esc(f.verdict)}</p></div>
      <div class="two"><div class="box"><h3>Where you match</h3><ul class="list">${(f.strengths || []).map(s => `<li>${esc(s)}</li>`).join("")}</ul></div>
      <div class="box"><h3>Gaps to address</h3><ul class="list">${(f.gaps || []).map(s => `<li>${esc(s)}</li>`).join("")}</ul></div></div>
      ${(f.missingKeywords || []).length ? `<div class="box"><h3>Keywords missing from your resume</h3><div class="chips">${f.missingKeywords.map(k => `<span class="chip">${esc(k)}</span>`).join("")}</div><small style="color:var(--muted)">Add the ones that are true for you. Applicant tracking systems scan for these terms.</small></div>` : ""}
      ${f.advice ? `<div class="box"><h3>What to do next</h3><p style="margin:0">${esc(f.advice)}</p></div>` : ""}`
      : `<div class="hint">Get a 0–100 match score, your strongest selling points, the gaps a recruiter will notice, and the keywords to add.</div>`}`;
  }
  if (S.dTab === "cover") {
    const tone = j.tone || "confident";
    const toneSel = `<select id="toneSel" aria-label="Tone" class="btn">${["confident", "warm", "concise", "formal", "enthusiastic"].map(t => `<option ${t === tone ? "selected" : ""}>${t}</option>`).join("")}</select>`;
    return `${needs(j)}${aiBar(j, "cover", "Write cover letter", toneSel)}
      ${j.cover || S.busy[j.id + "cover"] ? `<div class="field"><div class="actions" style="justify-content:space-between"><span class="label">Your letter, edit freely</span><div class="actions"><button class="btn sm" id="copyCover">Copy</button><button class="btn sm" id="shareCover">Share</button></div></div><textarea id="coverText" style="min-height:380px">${esc(j.cover || "")}</textarea></div>`
      : `<div class="hint">A tailored letter built from your resume, your work experience notes and this posting's requirements. You can edit it after it's written.</div>`}`;
  }
  if (S.dTab === "tweaks") {
    const t = j.tweaks;
    return `${needs(j)}${aiBar(j, "tweaks", "Tailor my resume")}
      ${t ? `<div class="box"><div class="actions" style="justify-content:space-between"><h3>Tailored summary</h3><button class="btn sm" data-copy="${esc(t.summary)}">Copy</button></div><p style="margin:0">${esc(t.summary)}</p></div>
        <div class="box"><h3>Rewritten bullets</h3>${(t.bullets || []).map(b => `<div class="bullet"><p>${esc(b.text)}<small>Targets: ${esc(b.targets)}</small></p><button class="btn sm" data-copy="${esc(b.text)}">Copy</button></div>`).join("")}</div>`
      : `<div class="hint">Get a summary and rewritten bullet points that echo this posting's language, using only experience you already have.</div>`}`;
  }
  if (S.dTab === "interview") {
    const qs = j.interview;
    return `${needs(j)}${aiBar(j, "interview", "Generate questions")}
      ${qs ? qs.map((q, i) => `<details class="q" ${i === 0 ? "open" : ""}><summary><span class="chip">${esc(q.type || "question")}</span><span>${esc(q.q)}</span></summary><p class="why"><b>Why they ask:</b> ${esc(q.why)}</p><p><b>Your answer:</b> ${esc(q.answer)}</p></details>`).join("")
      : `<div class="hint">Likely questions for this role, why interviewers ask them, and an answer outline drawn from your own experience.</div>`}`;
  }
  return "";
}
function bindDrawer(j) {
  const d = $("#drawer");
  $("#dClose", d).onclick = closeJob;
  d.querySelectorAll("[data-dtab]").forEach(b => b.onclick = () => { S.dTab = b.dataset.dtab; renderDrawer(); $(".d-body", d).scrollTop = 0; });
  d.querySelectorAll("[data-f]").forEach(el => {
    const ev = el.tagName === "SELECT" || el.type === "date" ? "change" : "input";
    el.addEventListener(ev, () => {
      j[el.dataset.f] = el.value; j.updated = Date.now();
      if (el.dataset.f === "status" && el.value === "applied" && !j.applied) { j.applied = today(); $("#fApplied").value = j.applied; }
      if (ev === "change") persistJob(j.id); else persistJobSoon(j.id);
      if (el.dataset.f === "role") $(".d-title h2", d).textContent = j.role || "Untitled role";
    });
  });
  const op = $("#openPosting", d); if (op) op.onclick = () => openUrl(j.url);
  const del = $("#delBtn", d);
  if (del) del.onclick = () => {
    $("#delZone").innerHTML = `<span class="status-msg">Delete this job and all its AI results?</span><button class="btn danger sm" id="delYes">Delete</button><button class="btn sm" id="delNo">Keep</button>`;
    $("#delYes").onclick = () => { removeJob(j.id); closeJob(); toast("Job deleted"); };
    $("#delNo").onclick = renderDrawer;
  };
  d.querySelectorAll("[data-ai]").forEach(b => b.onclick = () => runAI(j, b.dataset.ai));
  d.querySelectorAll("[data-stop]").forEach(b => b.onclick = () => S.ctl[j.id + b.dataset.stop]?.abort());
  d.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => copyText(b.dataset.copy));
  d.querySelectorAll("[data-goto]").forEach(b => b.onclick = () => { closeJob(); showView(b.dataset.goto); });
  const tone = $("#toneSel", d); if (tone) tone.onchange = () => { j.tone = tone.value; persistJob(j.id); };
  const ct = $("#coverText", d);
  if (ct) {
    ct.oninput = () => { j.cover = ct.value; persistJobSoon(j.id); };
    $("#copyCover", d).onclick = () => copyText(ct.value);
    $("#shareCover", d).onclick = () => shareText(`Cover letter · ${j.company || ""}`, ct.value);
  }
}

/* ---------- AI ---------- */
async function runAI(j, kind) {
  if (needs(j)) return;
  if (!(await ensureConsent())) return;
  const key = j.id + kind;
  const ctl = new AbortController(); S.ctl[key] = ctl;
  S.busy[key] = true; delete S.busy[key + ":err"];
  if (kind === "cover") j.cover = "";
  renderDrawer();
  try {
    const payload = payloadFor(j);
    if (kind === "cover") {
      payload.options = { tone: j.tone || "confident", len: 300 };
      j.cover = await api.ai("cover", payload, { signal: ctl.signal, onText: text => { j.cover = text; const ta = $("#coverText"); if (ta && S.openId === j.id) ta.value = text; } });
    } else {
      const out = await api.aiJson(kind, payload, { signal: ctl.signal });
      if (kind === "fit") {
        if (!out || typeof out.score !== "number") throw { code: "invalid_json" };
        j.fit = { score: Math.round(out.score), verdict: String(out.verdict || ""), strengths: arr(out.strengths), gaps: arr(out.gaps), missingKeywords: arr(out.missingKeywords), advice: String(out.advice || "") };
      } else if (kind === "tweaks") {
        if (!out || !Array.isArray(out.bullets)) throw { code: "invalid_json" };
        j.tweaks = { summary: String(out.summary || ""), bullets: out.bullets.map(b => ({ text: String(b.text || b), targets: String(b.targets || "") })) };
      } else {
        const list = Array.isArray(out) ? out : Array.isArray(out?.questions) ? out.questions : null;
        if (!list) throw { code: "invalid_json" };
        j.interview = list.map(q => ({ q: String(q.q || q.question || ""), type: String(q.type || ""), why: String(q.why || ""), answer: String(q.answer || "") }));
      }
    }
    j.updated = Date.now();
    persistJob(j.id);
  } catch (e) {
    if (kind === "cover" && e?.text) { j.cover = e.text; persistJob(j.id); }
    if (e?.code !== "cancelled") S.busy[key + ":err"] = aiErr(e);
  } finally {
    delete S.busy[key]; delete S.ctl[key];
    if (S.openId === j.id) renderDrawer();
  }
}

/* ---------- add job ---------- */
function openAdd() { $("#addForm").reset(); $("#aMsg").textContent = ""; $("#addModal").hidden = false; }
function closeAdd() { $("#addModal").hidden = true; }
$("#addBtn").onclick = openAdd;
$("#addClose").onclick = closeAdd;
$("#addModal").addEventListener("click", e => { if (e.target.id === "addModal") closeAdd(); });
$("#aExtract").onclick = async () => {
  const jd = $("#aJd").value.trim(), msg = $("#aMsg");
  msg.className = "status-msg";
  if (!jd) { msg.textContent = "Paste a job description first."; return; }
  if (!(await ensureConsent())) return;
  const b = $("#aExtract"); b.disabled = true; msg.textContent = "Reading the posting…";
  try {
    const out = await api.aiJson("extract", { job: { jd: jd.slice(0, 12000) } });
    if (out?.company) $("#aCompany").value = out.company;
    if (out?.role) $("#aRole").value = out.role;
    if (out?.location) $("#aLocation").value = out.location;
    msg.textContent = "Filled in. Check the details.";
  } catch (e) { msg.className = "status-msg err"; msg.textContent = aiErr(e); }
  finally { b.disabled = false; }
};
$("#addForm").addEventListener("submit", e => {
  e.preventDefault();
  const company = $("#aCompany").value.trim(), role = $("#aRole").value.trim();
  if (!company || !role) { $("#aMsg").className = "status-msg err"; $("#aMsg").textContent = "Add the company and role."; return; }
  const id = uidGen();
  S.jobs[id] = { id, company, role, location: $("#aLocation").value.trim(), url: $("#aUrl").value.trim(), jd: $("#aJd").value.trim(), status: "saved", applied: "", followUp: "", notes: "", created: Date.now(), updated: Date.now() };
  persistJob(id); closeAdd(); renderBoard(); openJob(id, hasBackground() && S.jobs[id].jd ? "fit" : "overview");
  toast("Job added");
});

/* ---------- cover letter studio ---------- */
let lCtl = null, lCurrentId = null;
function renderLetters() {
  const sel = $("#lJob"), prev = sel.value;
  const jobs = Object.values(S.jobs).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  sel.innerHTML = `<option value="">New job (paste the posting below)</option>` + jobs.map(j => `<option value="${esc(j.id)}">${esc((j.role || "Untitled role") + " · " + (j.company || "Company"))}</option>`).join("");
  if (prev && S.jobs[prev]) sel.value = prev;
  $("#lNew").hidden = !!sel.value;
  $("#lNeeds").innerHTML = hasBackground() ? "" : `<div class="hint">Add your resume or work experience in <b>Background</b> first. <button class="btn sm" data-lgoto="resume" style="margin-left:6px">Go there</button></div>`;
  const b = $("#lNeeds [data-lgoto]"); if (b) b.onclick = () => showView("resume");
  $("#lGen").disabled = !!lCtl || !hasBackground();
  renderLibrary();
}
function letterJob() {
  const id = $("#lJob").value;
  if (id && S.jobs[id]) return S.jobs[id];
  return { id: "", company: $("#lCompany").value.trim(), role: $("#lRole").value.trim(), jd: $("#lJd").value.trim() };
}
$("#lJob").addEventListener("change", () => { $("#lNew").hidden = !!$("#lJob").value; lCurrentId = null; });
$("#lGen").onclick = async () => {
  const j = letterJob(), msg = $("#lMsg");
  msg.className = "status-msg";
  if (!(j.jd || "").trim()) { msg.className = "status-msg err"; msg.textContent = j.id ? "That job has no description yet. Add it in the Pipeline." : "Paste the job description first."; return; }
  if (!(await ensureConsent())) return;
  lCtl = new AbortController(); lCurrentId = null;
  $("#lGen").disabled = true; $("#lStop").hidden = false; msg.textContent = "Claude is matching your experience to the posting…";
  const ta = $("#lText"); ta.value = "";
  try {
    const payload = payloadFor(j);
    payload.options = { tone: $("#lTone").value, len: +$("#lLen").value, focus: $("#lFocus").value.trim().slice(0, 1000) };
    ta.value = await api.ai("cover", payload, { signal: lCtl.signal, onText: text => { ta.value = text; } });
    msg.textContent = "Done. Edit anything, then save it.";
  } catch (e) {
    if (e?.text) ta.value = e.text;
    msg.className = e?.code === "cancelled" ? "status-msg" : "status-msg err"; msg.textContent = aiErr(e);
  } finally { lCtl = null; $("#lStop").hidden = true; $("#lGen").disabled = !hasBackground(); }
};
$("#lStop").onclick = () => lCtl?.abort();
$("#lCopy").onclick = () => { const t = $("#lText").value.trim(); if (t) copyText(t); else toast("Nothing to copy yet"); };
$("#lShare").onclick = () => { const t = $("#lText").value.trim(); if (t) shareText("Cover letter", t); else toast("Nothing to share yet"); };
$("#lSave").onclick = () => {
  const text = $("#lText").value.trim();
  if (!text) { toast("Write or paste a letter first"); return; }
  const j = letterJob();
  const id = lCurrentId || uidGen();
  const prev = S.letters[id];
  S.letters[id] = { id, title: `${j.role || "Cover letter"} · ${j.company || "Company"}`, jobId: j.id || "", text, tone: $("#lTone").value, created: prev?.created || Date.now(), updated: Date.now() };
  lCurrentId = id;
  persistLetter(id);
  if (j.id && S.jobs[j.id]) { S.jobs[j.id].cover = text; S.jobs[j.id].updated = Date.now(); persistJob(j.id); }
  renderLibrary(); toast(j.id ? "Saved, and attached to the job" : "Letter saved");
};
function renderLibrary() {
  const list = Object.values(S.letters).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  $("#libCount").textContent = list.length ? list.length + (list.length === 1 ? " letter" : " letters") : "";
  $("#lib").innerHTML = list.length ? list.map(l => `<div class="lcard" data-lid="${esc(l.id)}"><b>${esc(l.title)}</b><small>${esc(new Date(l.updated || l.created).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }))}${l.tone ? " · " + esc(l.tone) : ""}</small><p>${esc(l.text.slice(0, 280))}</p>
      <div class="actions"><button class="btn sm" data-lact="open">Open</button><button class="btn sm" data-lact="copy">Copy</button><button class="btn sm" data-lact="share">Share</button><button class="btn sm ghost" data-lact="del">Delete</button></div></div>`).join("")
    : `<div class="hint" style="grid-column:1/-1">Letters you save show up here, so you can reuse and adapt them for similar roles.</div>`;
}
$("#lib").addEventListener("click", e => {
  const b = e.target.closest("[data-lact]"); if (!b) return;
  const id = b.closest("[data-lid]").dataset.lid, l = S.letters[id]; if (!l) return;
  const act = b.dataset.lact;
  if (act === "copy") copyText(l.text);
  else if (act === "share") shareText(l.title, l.text);
  else if (act === "open") {
    $("#lText").value = l.text; lCurrentId = id;
    if (l.jobId && S.jobs[l.jobId]) { $("#lJob").value = l.jobId; $("#lNew").hidden = true; }
    if (l.tone) $("#lTone").value = l.tone;
    $("#lMsg").className = "status-msg"; $("#lMsg").textContent = "Editing a saved letter. Save updates it.";
    $("#lText").scrollIntoView({ behavior: "smooth", block: "center" });
  } else if (act === "del") {
    b.parentElement.innerHTML = `<span class="status-msg">Delete this letter?</span><button class="btn danger sm" data-lact="delyes">Delete</button><button class="btn sm" data-lact="delno">Keep</button>`;
  } else if (act === "delyes") {
    delete S.letters[id]; if (lCurrentId === id) lCurrentId = null;
    queueWrite("letter:" + id, () => api.deleteLetter(id)); renderLibrary(); toast("Letter deleted");
  } else if (act === "delno") renderLibrary();
});

/* ---------- background (profile) ---------- */
function fillProfile() { $("#pName").value = S.profile.name; $("#pTarget").value = S.profile.target; $("#pResume").value = S.profile.resume; $("#pExp").value = S.profile.experience; }
[["pName", "name"], ["pTarget", "target"], ["pResume", "resume"], ["pExp", "experience"]].forEach(([id, k]) => $("#" + id).addEventListener("input", e => { S.profile[k] = e.target.value; persistProfile(); }));
$("#pFile").addEventListener("change", e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader(); r.onload = () => { S.profile.resume = String(r.result); $("#pResume").value = S.profile.resume; persistProfile(); toast("Resume loaded"); }; r.readAsText(f);
});

/* ---------- account ---------- */
function renderAccount() {
  $("#acctEmail").textContent = S.user?.email || "";
  $("#consentState").textContent = S.aiConsent ? "Allowed" : "Off";
  $("#consentToggle").textContent = S.aiConsent ? "Turn off AI sharing" : "Allow AI sharing";
}
$("#consentToggle").onclick = () => setConsent(!S.aiConsent);
$("#signOutBtn").onclick = async () => { await api.supabase.auth.signOut(); };
$("#privacyLink").onclick = $("#authPrivacy").onclick = e => { e.preventDefault(); openUrl(PRIVACY_URL); };
$("#delAcctZone").addEventListener("click", async e => {
  const z = $("#delAcctZone"), id = e.target.id;
  if (id === "delAcctBtn") {
    z.innerHTML = `<span class="status-msg">Delete your account and all data permanently?</span><button class="btn danger" id="delAcctYes">Delete forever</button><button class="btn" id="delAcctNo">Cancel</button>`;
  } else if (id === "delAcctNo") {
    z.innerHTML = `<button class="btn danger" id="delAcctBtn">Delete my account</button>`;
  } else if (id === "delAcctYes") {
    e.target.disabled = true; e.target.textContent = "Deleting…";
    try { await api.deleteAccount(); await api.supabase.auth.signOut(); toast("Your account was deleted"); }
    catch (err) { toast(err.message || "Couldn't delete the account. Try again."); }
    z.innerHTML = `<button class="btn danger" id="delAcctBtn">Delete my account</button>`;
  }
});

/* ---------- views ---------- */
function showView(v) {
  S.view = v;
  document.querySelectorAll(".tab, .bottom-nav button").forEach(t => t.setAttribute("aria-selected", t.dataset.view === v));
  ["pipeline", "chat", "letters", "resume", "account"].forEach(k => $("#view-" + k).hidden = k !== v);
  $("#addBtn").hidden = v === "account";
  if (v === "pipeline") renderBoard();
  if (v === "chat") renderChat();
  if (v === "letters") renderLetters();
  if (v === "account") renderAccount();
  window.scrollTo(0, 0);
}
document.querySelectorAll(".tab, .bottom-nav button").forEach(t => t.onclick = () => showView(t.dataset.view));
document.addEventListener("click", e => {
  const o = e.target.closest("[data-open]"); if (o) openJob(o.dataset.open);
  const g = e.target.closest("#view-pipeline [data-goto]"); if (g) showView(g.dataset.goto);
});
$("#scrim").onclick = closeJob;
document.addEventListener("keydown", e => { if (e.key === "Escape") { if (!$("#addModal").hidden) closeAdd(); else if (S.openId) closeJob(); } });

/* ---------- auth ---------- */
let aMode = "signin", resetEmail = "";
function setAuthMode(m) {
  aMode = m;
  document.querySelectorAll("[data-amode]").forEach(b => b.setAttribute("aria-selected", b.dataset.amode === m));
  $(".seg").hidden = m === "reset";
  $("#auPassWrap").hidden = m === "reset";
  $("#auCodeWrap").hidden = $("#auNewWrap").hidden = m !== "reset" || !resetEmail;
  $("#auPass").autocomplete = m === "signup" ? "new-password" : "current-password";
  $("#auSubmit").textContent = m === "signin" ? "Sign in" : m === "signup" ? "Create account" : resetEmail ? "Set new password" : "Email me a code";
  $("#auForgot").textContent = m === "reset" ? "Back to sign in" : "Forgot password?";
  $("#auMsg").textContent = ""; $("#auMsg").className = "status-msg";
}
document.querySelectorAll("[data-amode]").forEach(b => b.onclick = () => setAuthMode(b.dataset.amode));
$("#auForgot").onclick = () => { resetEmail = ""; setAuthMode(aMode === "reset" ? "signin" : "reset"); };
$("#authForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("#auEmail").value.trim(), pass = $("#auPass").value, msg = $("#auMsg"), btn = $("#auSubmit");
  const fail = t => { msg.className = "status-msg err"; msg.textContent = t; };
  if (!/^\S+@\S+\.\S+$/.test(email)) return fail("Enter a valid email address.");
  btn.disabled = true; msg.className = "status-msg"; msg.textContent = "";
  try {
    const A = api.supabase.auth;
    if (aMode === "signin") {
      if (!pass) return fail("Enter your password.");
      const { error } = await A.signInWithPassword({ email, password: pass });
      if (error) fail(error.message === "Invalid login credentials" ? "That email and password don't match." : error.message);
    } else if (aMode === "signup") {
      if (pass.length < 8) return fail("Use at least 8 characters for your password.");
      const { data, error } = await A.signUp({ email, password: pass });
      if (error) fail(error.message);
      else if (!data.session) { setAuthMode("signin"); $("#auMsg").textContent = "Check your email to confirm your account, then sign in here."; }
    } else if (!resetEmail) {
      const { error } = await A.resetPasswordForEmail(email);
      if (error) fail(error.message);
      else { resetEmail = email; setAuthMode("reset"); $("#auMsg").textContent = "We emailed you a code. Enter it with a new password."; }
    } else {
      const code = $("#auCode").value.trim(), np = $("#auNew").value;
      if (!code) return fail("Enter the code from your email.");
      if (np.length < 8) return fail("Use at least 8 characters for your new password.");
      const v = await A.verifyOtp({ email: resetEmail, token: code, type: "recovery" });
      if (v.error) return fail("That code didn't work. Check it or request a new one.");
      const u = await A.updateUser({ password: np });
      if (u.error) fail(u.error.message); else toast("Password updated");
    }
  } catch (err) { fail("Can't reach the server. Check your connection."); }
  finally { btn.disabled = false; }
});

async function enterApp(user) {
  S.user = user;
  $("#auth").hidden = true; $("#app").hidden = false; $("#boot").hidden = true;
  renderBoard();
  try {
    const d = await api.loadAll(user.id);
    Object.assign(S, { profile: d.profile, aiConsent: d.aiConsent, jobs: d.jobs, letters: d.letters, loaded: true });
  } catch (e) { console.error(e); S.loaded = true; toast("Couldn't load your data. Pull down or reopen the app."); }
  fillProfile(); showView(S.view);
}
function leaveApp() {
  Object.assign(S, { user: null, jobs: {}, letters: {}, profile: { name: "", target: "", resume: "", experience: "" }, aiConsent: false, loaded: false, view: "pipeline", chatMessages: [], chatBusy: false });
  closeJob(); fillProfile();
  $("#app").hidden = true; $("#auth").hidden = false; $("#boot").hidden = true;
  $("#auPass").value = ""; resetEmail = ""; setAuthMode("signin");
}

(async () => {
  if (!api.configured) {
    $("#boot").hidden = true; $("#auth").hidden = false;
    $("#auMsg").className = "status-msg err"; $("#auMsg").textContent = "App isn't configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.";
    return;
  }
  const { data } = await api.supabase.auth.getSession();
  if (data.session) enterApp(data.session.user); else leaveApp();
  api.supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session && (!S.user || S.user.id !== session.user.id)) enterApp(session.user);
    if (event === "SIGNED_OUT") leaveApp();
  });
  $("#versionLine").textContent = "Offer Desk " + (import.meta.env.VITE_APP_VERSION || "1.0");
})();
