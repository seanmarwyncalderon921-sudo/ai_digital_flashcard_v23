import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import { randomUUID } from "crypto";

const api = express.Router();
const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
// Use only the replacement server-side secret key. Never fall back to the
// legacy service_role key that was exposed during setup.
const supabaseKey = String(process.env.SUPABASE_SECRET_KEY || "").trim();
const hasServerSecretKey = supabaseKey.startsWith("sb_secret_");
const supabaseReady = Boolean(supabaseUrl && hasServerSecretKey);
const storageBucket = process.env.SUPABASE_CHAT_BUCKET || "chat-attachments";
const CURRENT_TERMS_VERSION = "2026-11-19";
const CURRENT_PRIVACY_VERSION = "2026-11-19";
let publishChatEvent = () => {};

export function setChatEventPublisher(publisher) {
  publishChatEvent = typeof publisher === "function" ? publisher : () => {};
}

function emitChatEvent(conversationId, event, payload) {
  try { publishChatEvent(String(conversationId), event, payload); }
  catch (error) { console.error("Could not publish chat event:", error.message); }
}

function supabaseError(message, statusCode = 500) {
  return Object.assign(new Error(message), { statusCode });
}

async function supabaseRequest(resource, { method = "GET", params, body, headers = {}, raw = false } = {}) {
  if (!supabaseReady) throw supabaseError("Supabase server access is not configured. Set SUPABASE_URL and set SUPABASE_SECRET_KEY to the server-side key beginning with sb_secret_ (not the publishable key), then save and restart the server.", 503);
  const url = new URL(`${supabaseUrl}${resource.startsWith("/") ? resource : `/${resource}`}`);
  if (params) Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, {
    method,
    headers: {
      apikey: supabaseKey,
      ...(body !== undefined && !raw ? { "Content-Type": "application/json" } : {}),
      ...headers
    },
    ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {})
  });
  const responseText = await response.text();
  let result = null;
  if (responseText) {
    try { result = JSON.parse(responseText); } catch { result = responseText; }
  }
  if (!response.ok) {
    const message = typeof result === "object" && result
      ? result.message || result.error || result.hint || "Supabase request failed."
      : String(result || "Supabase request failed.");
    throw supabaseError(message, response.status);
  }
  return result;
}

const rest = (table, options = {}) => supabaseRequest(`/rest/v1/${table}`, options);
const rows = async (table, options = {}) => (await rest(table, options)) || [];
const first = async (table, options = {}) => (await rows(table, { ...options, params: { ...options.params, limit: 1 } }))[0] || null;
const upsert = (table, body, conflict) => rest(table, {
  method: "POST", body,
  params: conflict ? { on_conflict: conflict } : undefined,
  headers: { Prefer: "resolution=merge-duplicates,return=representation" }
});
const patch = (table, params, body) => rest(table, {
  method: "PATCH", params, body,
  headers: { Prefer: "return=representation" }
});
const remove = (table, params) => rest(table, {
  method: "DELETE", params,
  headers: { Prefer: "return=representation" }
});

export const isSupabaseConfigured = () => supabaseReady;
export async function reserveSupabaseAiPrompt(userId) {
  return supabaseRequest("/rest/v1/rpc/reserve_ai_prompt", {
    method: "POST", body: { p_user_id: String(userId) }
  });
}

export async function enqueueAiGenerationJob(userId, payload) {
  const result = await rest("ai_generation_jobs", {
    method: "POST",
    body: { owner_id: String(userId), request_payload: payload },
    headers: { Prefer: "return=representation" }
  });
  return result?.[0] || null;
}

export async function getAiGenerationJob(jobId, userId) {
  const job = await first("ai_generation_jobs", { params: {
    id: `eq.${jobId}`, owner_id: `eq.${String(userId)}`,
    select: "id,status,cards,error_code,error_message,retry_after_seconds,created_at"
  } });
  if (!job) return null;
  let position = null;
  if (job.status === "queued") {
    const waiting = await rows("ai_generation_jobs", { params: {
      status: "eq.queued", created_at: `lte.${job.created_at}`, select: "id"
    } });
    position = waiting.length;
  }
  return { ...job, position };
}

export async function claimNextAiGenerationJob() {
  const claimed = await supabaseRequest("/rest/v1/rpc/claim_ai_generation_job", {
    method: "POST", body: {}
  });
  return Array.isArray(claimed) ? claimed[0] || null : null;
}

export async function finishAiGenerationJob(jobId, outcome) {
  const completed = outcome?.status === "completed";
  return patch("ai_generation_jobs", { id: `eq.${jobId}`, status: "eq.running" }, {
    status: completed ? "completed" : "failed",
    cards: completed ? outcome.cards : null,
    error_code: completed ? null : String(outcome?.errorCode || "AI_GENERATION_FAILED").slice(0, 80),
    error_message: completed ? null : String(outcome?.errorMessage || "Could not generate flashcards. Please try again.").slice(0, 500),
    retry_after_seconds: completed ? null : Math.max(0, Number(outcome?.retryAfterSeconds) || 0),
    request_payload: null,
    updated_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    lease_until: null
  });
}

function ownerId(req) {
  return String(req.user?.uid || req.user?.userId || "");
}

function profileView(row) {
  if (!row) return null;
  return {
    id: row.user_id,
    uid: row.user_id,
    email: row.email || "",
    displayName: row.display_name || "Paduan",
    displayNameLower: row.display_name_lower || "",
    username: row.username || "",
    usernameLower: row.username_lower || "",
    bio: row.bio || "",
    photoURL: row.photo_url || "",
    gradeLevel: row.grade_level || "",
    strand: row.strand || "",
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at
  };
}

function deckView(row) {
  return {
    id: row.id,
    title: row.title,
    subjectMode: row.subject_mode,
    gradeLevel: row.grade_level,
    academicStrand: row.academic_strand,
    tags: row.tags || [],
    cards: row.cards || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function conversationView(row) {
  return {
    id: row.id,
    conversationId: row.id,
    type: row.type,
    title: row.title,
    createdBy: row.created_by,
    participants: row.participants || [],
    members: row.members || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function messageView(row, conversationId) {
  const attachments = Array.isArray(row.attachments) ? row.attachments : [];
  return {
    id: row.id,
    room: conversationId,
    conversationId,
    senderId: row.sender_id,
    text: row.text || "",
    ciphertext: row.ciphertext || null,
    iv: row.iv || null,
    isUnsent: Boolean(row.is_unsent),
    attachments,
    reactions: row.reactions || {},
    attachment: attachments[0] || null,
    replyTo: row.reply_to || null,
    seenBy: row.seen_by || {},
    timestamp: row.timestamp,
    updatedAt: row.updated_at || row.timestamp
  };
}

async function ensureProfileForRequest(req) {
  const uid = ownerId(req);
  if (!uid) throw supabaseError("A signed-in user is required.", 401);
  const existing = await first("profiles", { params: { user_id: `eq.${uid}`, select: "*" } });
  if (existing) return existing;
  const email = String(req.user?.email || "");
  const name = email.split("@")[0] || "Paduan";
  const created = await upsert("profiles", {
    user_id: uid,
    email,
    display_name: name,
    display_name_lower: name.toLowerCase(),
    username: "",
    username_lower: "",
    updated_at: new Date().toISOString()
  }, "user_id");
  return created?.[0] || { user_id: uid, email, display_name: name };
}

async function getConversation(conversationId) {
  return first("chat_conversations", { params: { id: `eq.${String(conversationId)}`, select: "*" } });
}

export async function areAcceptedFriends(firstId, secondId) {
  if (!supabaseReady || !firstId || !secondId || String(firstId) === String(secondId)) return false;
  const [forward, reverse] = await Promise.all([
    first("friend_requests", { params: { id: `eq.${firstId}_${secondId}`, select: "id,status,from_id,to_id" } }),
    first("friend_requests", { params: { id: `eq.${secondId}_${firstId}`, select: "id,status,from_id,to_id" } })
  ]);
  const accepted = [forward, reverse].some(request => request?.status === "accepted"
    && [String(request.from_id), String(request.to_id)].includes(String(firstId))
    && [String(request.from_id), String(request.to_id)].includes(String(secondId)));
  return accepted && !(await areUsersBlocked(firstId, secondId));
}

export async function areUsersBlocked(firstId, secondId) {
  if (!supabaseReady || !firstId || !secondId || String(firstId) === String(secondId)) return false;
  const [forward, reverse] = await Promise.all([
    first("user_blocks", { params: { blocker_id: `eq.${firstId}`, blocked_user_id: `eq.${secondId}`, select: "blocker_id" } }),
    first("user_blocks", { params: { blocker_id: `eq.${secondId}`, blocked_user_id: `eq.${firstId}`, select: "blocker_id" } })
  ]);
  return Boolean(forward || reverse);
}

export async function getAuthorizedChatConversation(conversationId, userId) {
  if (!supabaseReady) throw supabaseError("Supabase is not configured on the Render server.", 503);
  const conversation = await getConversation(conversationId);
  if (!conversation) throw supabaseError("This conversation could not be found.", 404);
  const participants = Array.isArray(conversation.participants) ? conversation.participants.map(String) : [];
  if (!participants.includes(String(userId))) throw supabaseError("You cannot access this conversation.", 403);
  if (conversation.type === "direct") {
    const other = participants.find(id => id !== String(userId));
    if (other && await areUsersBlocked(userId, other)) throw supabaseError("This conversation is unavailable because one participant blocked the other.", 403);
  }
  return { ...conversation, participants, isGroup: conversation.type === "group" };
}

// Remove only uploads that were never attached to a saved message. This keeps
// abandoned upload attempts from consuming storage without pruning chat history.
export async function cleanupUnreferencedChatAttachments() {
  if (!supabaseReady) return 0;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const abandoned = await rows("chat_attachments", { params: {
    is_referenced: "eq.false", created_at: `lt.${cutoff}`, select: "id,storage_path", limit: "100"
  } });
  if (!abandoned.length) return 0;
  const paths = abandoned.map(item => String(item.storage_path || "")).filter(Boolean);
  if (paths.length) {
    await supabaseRequest(`/storage/v1/object/${encodeURIComponent(storageBucket)}`, {
      method: "DELETE", body: { prefixes: paths }
    });
  }
  const ids = abandoned.map(item => String(item.id)).filter(Boolean);
  if (ids.length) await remove("chat_attachments", { id: `in.(${ids.map(id => `"${id.replaceAll('"', '')}"`).join(",")})` });
  return abandoned.length;
}

async function requireParticipant(conversationId, uid) {
  const conversation = await getAuthorizedChatConversation(conversationId, uid);
  return conversation;
}

async function deleteStoredAttachments(attachments = []) {
  const paths = attachments.map(item => String(item?.path || item?.storage_path || "")).filter(Boolean);
  const ids = [...new Set(attachments.map(item => String(item?.id || "")).filter(Boolean))];
  if (ids.length) {
    const metadata = await rows("chat_attachments", { params: {
      id: `in.(${ids.map(value => `"${value.replaceAll('"', '')}"`).join(",")})`, select: "storage_path"
    } });
    paths.push(...metadata.map(item => String(item.storage_path || "")).filter(Boolean));
  }
  const uniquePaths = [...new Set(paths)];
  if (!uniquePaths.length) return;
  await supabaseRequest(`/storage/v1/object/${encodeURIComponent(storageBucket)}`, {
    method: "DELETE", body: { prefixes: uniquePaths }
  });
  await remove("chat_attachments", { storage_path: `in.(${uniquePaths.map(value => `"${value.replaceAll('"', '')}"`).join(",")})` });
}

export function createSupabaseDataRouter(authenticateToken) {
  const router = express.Router();
  const usernameResolveRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 200,
    standardHeaders: "draft-8", legacyHeaders: false
  });
  const usernameAvailabilityRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 200,
    standardHeaders: "draft-8", legacyHeaders: false
  });
  const publicShareRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 600,
    standardHeaders: "draft-8", legacyHeaders: false
  });
  const safetyActionRateLimit = rateLimit({
    windowMs: 60 * 60 * 1000, limit: 30,
    standardHeaders: "draft-8", legacyHeaders: false
  });
  const authenticatedDataRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 600,
    standardHeaders: "draft-8", legacyHeaders: false,
    keyGenerator: req => {
      const uid = ownerId(req);
      return uid ? `user:${uid}` : `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
    }
  });

  // These three lookups must work before sign-in: username login, registration
  // availability checks, and public shared-deck links.
  router.get("/username/resolve", usernameResolveRateLimit, async (req, res) => {
    try {
      const username = String(req.query.username || "").trim().toLowerCase();
      if (username.includes("@")) return res.json({ email: username });
      const row = await first("profiles", { params: { username_lower: `eq.${username}`, select: "email" } });
      if (!row?.email) return res.status(404).json({ error: "No account was found with that username." });
      return res.json({ email: row.email });
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });
  router.get("/username/available", usernameAvailabilityRateLimit, async (req, res) => {
    try {
      const username = String(req.query.username || "").trim().toLowerCase();
      const row = await first("profiles", { params: { username_lower: `eq.${username}`, select: "user_id" } });
      return res.json({ available: !row });
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });
  router.get("/shares/:id", publicShareRateLimit, async (req, res) => {
    try {
      const row = await first("shared_decks", { params: { id: `eq.${req.params.id}`, select: "*" } });
      return res.json(row ? { id: row.id, ownerId: row.owner_id, title: row.title, subjectMode: row.subject_mode, cards: row.cards, createdAt: row.created_at } : null);
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.use(authenticateToken);
  router.use(authenticatedDataRateLimit);

  router.get("/legal/consent", async (req, res) => {
    try {
      const row = await first("policy_consents", { params: { user_id: `eq.${ownerId(req)}`, select: "terms_version,privacy_version,accepted_at", order: "accepted_at.desc" } });
      return res.json(row || null);
    } catch (error) {
      if (/policy_consents.*schema cache/i.test(error.message || "")) {
        return res.status(503).json({ error: "Consent storage is not initialized. An administrator must run supabase/legal-safety-upgrade.sql in the Supabase SQL Editor, then retry." });
      }
      return res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  router.post("/legal/consent", async (req, res) => {
    try {
      if (req.body?.termsAccepted !== true || req.body?.privacyAccepted !== true
        || req.body?.termsVersion !== CURRENT_TERMS_VERSION || req.body?.privacyVersion !== CURRENT_PRIVACY_VERSION) {
        return res.status(400).json({ error: "Accept the current Terms of Service and Privacy Policy before creating an account." });
      }
      const uid = ownerId(req);
      await ensureProfileForRequest(req);
      const acceptedAt = new Date().toISOString();
      await rest("policy_consents", { method: "POST", body: {
        user_id: uid,
        terms_version: CURRENT_TERMS_VERSION,
        privacy_version: CURRENT_PRIVACY_VERSION,
        accepted_at: acceptedAt
      } });
      return res.json({ termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION, acceptedAt });
    } catch (error) {
      if (/policy_consents.*schema cache/i.test(error.message || "")) {
        return res.status(503).json({ error: "Consent storage is not initialized. An administrator must run supabase/legal-safety-upgrade.sql in the Supabase SQL Editor, then retry." });
      }
      return res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  router.get("/safety/blocks", async (req, res) => {
    try {
      const blocked = await rows("user_blocks", { params: { blocker_id: `eq.${ownerId(req)}`, select: "blocked_user_id,created_at", order: "created_at.desc" } });
      if (!blocked.length) return res.json([]);
      const profiles = await rows("profiles", { params: {
        user_id: `in.(${blocked.map(item => `"${String(item.blocked_user_id).replaceAll('"', '')}"`).join(",")})`,
        select: "user_id,display_name,username"
      } });
      const byId = new Map(profiles.map(profile => [String(profile.user_id), profile]));
      return res.json(blocked.map(item => ({
        userId: item.blocked_user_id,
        displayName: byId.get(String(item.blocked_user_id))?.display_name || "User",
        username: byId.get(String(item.blocked_user_id))?.username || "",
        createdAt: item.created_at
      })));
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.post("/safety/blocks", safetyActionRateLimit, async (req, res) => {
    try {
      const uid = ownerId(req);
      const blockedUserId = String(req.body?.userId || "").slice(0, 160);
      if (!blockedUserId || blockedUserId === uid) return res.status(400).json({ error: "Choose another user to block." });
      await ensureProfileForRequest(req);
      if (!(await first("profiles", { params: { user_id: `eq.${blockedUserId}`, select: "user_id" } }))) return res.status(404).json({ error: "User not found." });
      await upsert("user_blocks", { blocker_id: uid, blocked_user_id: blockedUserId }, "blocker_id,blocked_user_id");
      const conversations = await rows("chat_conversations", { params: { participants: `cs.{${uid}}`, select: "id,participants,type" } });
      conversations.filter(item => item.type === "direct" && (item.participants || []).map(String).includes(blockedUserId))
        .forEach(item => emitChatEvent(item.id, "chat:blocked", { conversationId: item.id, blockedBy: uid }));
      return res.json({ blocked: true, userId: blockedUserId });
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.delete("/safety/blocks/:uid", async (req, res) => {
    try {
      await remove("user_blocks", { blocker_id: `eq.${ownerId(req)}`, blocked_user_id: `eq.${String(req.params.uid).slice(0, 160)}` });
      return res.json({ blocked: false });
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.post("/safety/reports", safetyActionRateLimit, async (req, res) => {
    try {
      const uid = ownerId(req);
      const reportedUserId = String(req.body?.reportedUserId || "").slice(0, 160);
      const category = String(req.body?.category || "other");
      const allowedCategories = new Set(["harassment", "threat", "sexual_content", "spam", "self_harm", "other"]);
      if (!reportedUserId || reportedUserId === uid || !allowedCategories.has(category)) return res.status(400).json({ error: "The report information is incomplete." });
      await ensureProfileForRequest(req);
      if (!(await first("profiles", { params: { user_id: `eq.${reportedUserId}`, select: "user_id" } }))) return res.status(404).json({ error: "Reported user not found." });
      const conversationId = String(req.body?.conversationId || "").slice(0, 200) || null;
      const messageId = String(req.body?.messageId || "").slice(0, 200) || null;
      if (conversationId) {
        const conversation = await requireParticipant(conversationId, uid);
        if (!conversation.participants.includes(reportedUserId)) return res.status(403).json({ error: "That user is not part of this conversation." });
        if (messageId) {
          const message = await first("chat_messages", { params: { id: `eq.${messageId}`, conversation_id: `eq.${conversationId}`, select: "sender_id" } });
          if (!message || message.sender_id !== reportedUserId) return res.status(400).json({ error: "The reported message could not be verified." });
        }
      }
      const result = await rest("safety_reports", { method: "POST", body: {
        reporter_id: uid,
        reported_user_id: reportedUserId,
        conversation_id: conversationId,
        message_id: messageId,
        category,
        details: String(req.body?.details || "").trim().slice(0, 2000)
      }, headers: { Prefer: "return=representation" } });
      return res.status(201).json({ reportId: result?.[0]?.id, status: "received" });
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.post("/privacy/requests", safetyActionRateLimit, async (req, res) => {
    try {
      const uid = ownerId(req);
      const requestType = String(req.body?.requestType || "");
      if (!["access", "correction", "erasure", "withdraw_consent", "other"].includes(requestType)) return res.status(400).json({ error: "Choose a valid privacy request type." });
      await ensureProfileForRequest(req);
      const result = await rest("privacy_requests", { method: "POST", body: {
        user_id: uid,
        request_type: requestType,
        details: String(req.body?.details || "").trim().slice(0, 2000)
      }, headers: { Prefer: "return=representation" } });
      return res.status(201).json({ requestId: result?.[0]?.id, status: "received" });
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.get("/profile", async (req, res) => {
    try { return res.json(profileView(await ensureProfileForRequest(req))); }
    catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.put("/profile", async (req, res) => {
    try {
      const uid = ownerId(req);
      const current = await ensureProfileForRequest(req);
      const displayName = String(req.body?.displayName ?? current.display_name ?? "Paduan").trim().slice(0, 80) || "Paduan";
      const username = String(req.body?.username ?? current.username ?? "").trim().toLowerCase().slice(0, 24);
      const payload = {
        user_id: uid,
        email: String(req.user?.email || current.email || ""),
        display_name: displayName,
        display_name_lower: displayName.toLowerCase(),
        username,
        username_lower: username,
        bio: String(req.body?.bio ?? current.bio ?? "").trim().slice(0, 300),
        photo_url: String(req.body?.photoURL ?? current.photo_url ?? "").slice(0, 400000),
        grade_level: String(req.body?.gradeLevel ?? current.grade_level ?? "").slice(0, 30),
        strand: String(req.body?.strand ?? current.strand ?? "").slice(0, 50),
        updated_at: new Date().toISOString()
      };
      const result = await upsert("profiles", payload, "user_id");
      return res.json(profileView(result?.[0] || payload));
    } catch (error) {
      const status = error.statusCode || (error.code === "23505" ? 409 : 500);
      return res.status(status).json({ error: status === 409 ? "That username is already taken." : error.message });
    }
  });

  router.post("/profile/presence", async (req, res) => {
    try {
      const uid = ownerId(req);
      await ensureProfileForRequest(req);
      await patch("profiles", { user_id: `eq.${uid}` }, { last_seen_at: new Date().toISOString() });
      return res.json({ success: true });
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.get("/profiles/:uid", async (req, res) => {
    try {
      const row = await first("profiles", { params: {
        user_id: `eq.${req.params.uid}`,
        select: "user_id,display_name,display_name_lower,username,username_lower,bio,photo_url,grade_level,strand,last_seen_at,updated_at"
      } });
      return res.json(profileView(row));
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.get("/users/search", async (req, res) => {
    try {
      const query = String(req.query.q || "").trim().toLowerCase().replace(/[%_*(),]/g, "");
      if (query.length < 2) return res.json([]);
      const params = {
        select: "user_id,display_name,display_name_lower,username,username_lower,photo_url,grade_level,strand",
        or: `(display_name_lower.ilike.${query}*,username_lower.ilike.${query}*)`,
        limit: "20"
      };
      const results = await rows("profiles", { params });
      return res.json(results.filter(row => row.user_id !== ownerId(req)).map(profileView));
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.get("/decks", async (req, res) => {
    try {
      const list = await rows("decks", { params: {
        owner_id: `eq.${ownerId(req)}`, select: "*", order: "updated_at.desc", limit: "100"
      } });
      return res.json(list.map(deckView));
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.post("/decks", async (req, res) => {
    try {
      const uid = ownerId(req);
      await ensureProfileForRequest(req);
      const deck = req.body || {};
      const cards = Array.isArray(deck.cards) ? deck.cards : [];
      if (!cards.length) return res.status(400).json({ error: "Deck must contain at least one card." });
      if (Buffer.byteLength(JSON.stringify(cards), "utf8") > 750 * 1024) {
        return res.status(413).json({ error: "This deck is too large to save. Remove extra cards or embedded media and try again." });
      }
      const payload = {
        owner_id: uid,
        title: String(deck.title || "Saved Reviewer Deck").trim().slice(0, 120),
        subject_mode: String(deck.subjectMode || "general").slice(0, 30),
        grade_level: String(deck.gradeLevel || "Grade 11").slice(0, 40),
        academic_strand: String(deck.academicStrand || "General").slice(0, 80),
        tags: Array.isArray(deck.tags) ? deck.tags.slice(0, 20).map(tag => String(tag).slice(0, 60)) : [],
        cards,
        updated_at: new Date().toISOString()
      };
      let result;
      if (deck.id) {
        result = await patch("decks", { id: `eq.${String(deck.id)}`, owner_id: `eq.${uid}` }, payload);
        if (!result?.length) return res.status(404).json({ error: "Deck not found." });
      } else {
        payload.created_at = new Date().toISOString();
        result = await rest("decks", { method: "POST", body: payload, headers: { Prefer: "return=representation" } });
      }
      return res.json(deckView(result[0]));
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.delete("/decks/:id", async (req, res) => {
    try {
      const result = await remove("decks", { id: `eq.${req.params.id}`, owner_id: `eq.${ownerId(req)}` });
      if (!result?.length) return res.status(404).json({ error: "Deck not found." });
      return res.json({ success: true });
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.post("/study-sessions", async (req, res) => {
    try {
      const uid = ownerId(req);
      await ensureProfileForRequest(req);
      const data = req.body || {};
      const payload = {
        owner_id: uid,
        deck_id: String(data.deckId || "local-session").slice(0, 160),
        correct: Math.max(0, Number(data.correct) || 0),
        total: Math.max(0, Number(data.total) || 0),
        duration_seconds: Math.max(0, Number(data.durationSeconds) || 0),
        completed_at: new Date().toISOString()
      };
      const result = await rest("study_sessions", { method: "POST", body: payload, headers: { Prefer: "return=representation" } });
      await patch("profiles", { user_id: `eq.${uid}` }, { last_seen_at: payload.completed_at });
      return res.status(201).json(result[0]);
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.post("/shares", async (req, res) => {
    try {
      await ensureProfileForRequest(req);
      const data = req.body || {};
      const result = await rest("shared_decks", { method: "POST", body: {
        owner_id: ownerId(req), title: String(data.title || "Shared Reviewer Deck").slice(0, 120),
        subject_mode: String(data.subjectMode || "general").slice(0, 30),
        cards: Array.isArray(data.cards) ? data.cards.slice(0, 200) : []
      }, headers: { Prefer: "return=representation" } });
      return res.status(201).json({ id: result[0].id });
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.post("/friends/requests", async (req, res) => {
    try {
      const fromId = ownerId(req);
      const toId = String(req.body?.toId || "");
      if (!toId || toId === fromId) return res.status(400).json({ error: "Choose another user." });
      await ensureProfileForRequest(req);
      const target = await first("profiles", { params: { user_id: `eq.${toId}`, select: "user_id,display_name,username" } });
      if (!target) return res.status(404).json({ error: "That account could not be found." });
      if (await areUsersBlocked(fromId, toId)) return res.status(403).json({ error: "You cannot send a friend request because one user blocked the other." });
      const sender = await first("profiles", { params: { user_id: `eq.${fromId}`, select: "display_name,username" } });
      const id = `${fromId}_${toId}`;
      const prior = await first("friend_requests", { params: { id: `eq.${id}`, select: "status" } });
      if (prior?.status === "accepted") return res.json({ success: true, alreadyFriends: true });
      const request = await upsert("friend_requests", {
        id, from_id: fromId, to_id: toId,
        from_name: sender?.display_name || req.user?.email?.split("@")[0] || "Paduan",
        to_name: target.display_name || target.username || "Paduan",
        status: "pending", updated_at: new Date().toISOString()
      }, "id");
      return res.status(201).json(request?.[0] || { id });
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.get("/friends/requests", async (req, res) => {
    try {
      const uid = ownerId(req);
      const result = await rows("friend_requests", { params: {
        select: "*", or: `(from_id.eq.${uid},to_id.eq.${uid})`, order: "created_at.desc", limit: "100"
      } });
      const visible = [];
      for (const row of result) {
        const otherId = row.from_id === uid ? row.to_id : row.from_id;
        if (!(await areUsersBlocked(uid, otherId))) visible.push(row);
      }
      return res.json(visible.map(row => ({ id: row.id, fromId: row.from_id, toId: row.to_id, fromName: row.from_name, toName: row.to_name, status: row.status, createdAt: row.created_at })));
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.get("/friends", async (req, res) => {
    try {
      const uid = ownerId(req);
      const result = await rows("friend_requests", { params: {
        select: "*", status: "eq.accepted", or: `(from_id.eq.${uid},to_id.eq.${uid})`, limit: "100"
      } });
      const visible = [];
      for (const row of result) {
        const otherId = row.from_id === uid ? row.to_id : row.from_id;
        if (!(await areUsersBlocked(uid, otherId))) visible.push(row);
      }
      return res.json(visible.map(row => ({ id: row.id, fromId: row.from_id, toId: row.to_id, fromName: row.from_name, toName: row.to_name, status: row.status, createdAt: row.created_at })));
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.post("/friends/presence", async (req, res) => {
    try {
      const uid = ownerId(req);
      const requested = [...new Set((Array.isArray(req.body?.userIds) ? req.body.userIds : []).map(String).filter(id => id && id !== uid))].slice(0, 100);
      if (!requested.length) return res.json([]);
      const accepted = await rows("friend_requests", { params: {
        status: "eq.accepted", or: `(from_id.eq.${uid},to_id.eq.${uid})`, select: "from_id,to_id", limit: "200"
      } });
      const allowed = new Set(accepted.map(row => row.from_id === uid ? String(row.to_id) : String(row.from_id)));
      const ids = [];
      for (const id of requested) if (allowed.has(id) && !(await areUsersBlocked(uid, id))) ids.push(id);
      if (!ids.length) return res.json([]);
      const profiles = await rows("profiles", { params: {
        user_id: `in.(${ids.map(id => `"${id.replaceAll('"', '')}"`).join(",")})`,
        select: "user_id,display_name,photo_url,last_seen_at"
      } });
      return res.json(profiles.map(row => ({ id: row.user_id, uid: row.user_id, displayName: row.display_name || "Paduan", photoURL: row.photo_url || "", lastSeenAt: row.last_seen_at })));
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.patch("/friends/requests/:id", async (req, res) => {
    try {
      const uid = ownerId(req);
      const status = String(req.body?.status || "");
      if (!["accepted", "rejected"].includes(status)) return res.status(400).json({ error: "Invalid friend request response." });
      const result = await patch("friend_requests", { id: `eq.${req.params.id}`, to_id: `eq.${uid}`, status: "eq.pending" }, { status, updated_at: new Date().toISOString() });
      if (!result?.length) return res.status(404).json({ error: "Friend request not found." });
      return res.json({ success: true });
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.delete("/friends/requests/:id", async (req, res) => {
    try {
      const uid = ownerId(req);
      const result = await rows("friend_requests", { params: { id: `eq.${req.params.id}`, or: `(from_id.eq.${uid},to_id.eq.${uid})`, select: "id" } });
      if (!result.length) return res.status(404).json({ error: "Friend request not found." });
      await remove("friend_requests", { id: `eq.${req.params.id}` });
      return res.json({ success: true });
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.post("/conversations/direct", async (req, res) => {
    try {
      const uid = ownerId(req);
      const otherId = String(req.body?.otherId || "");
      if (!otherId || otherId === uid) return res.status(400).json({ error: "Invalid chat participant." });
      if (!(await areAcceptedFriends(uid, otherId))) return res.status(403).json({ error: "You can only chat with an accepted friend." });
      await ensureProfileForRequest(req);
      const [me, other] = await Promise.all([
        first("profiles", { params: { user_id: `eq.${uid}`, select: "user_id,display_name,photo_url" } }),
        first("profiles", { params: { user_id: `eq.${otherId}`, select: "user_id,display_name,photo_url" } })
      ]);
      if (!other) return res.status(404).json({ error: "Chat participant not found." });
      const participants = [uid, otherId].sort();
      const id = `chat:${participants.join(":")}`;
      const result = await upsert("chat_conversations", {
        id, type: "direct", created_by: participants[0], participants,
        members: [me, other].map(row => ({ id: row.user_id, displayName: row.display_name, photoURL: row.photo_url }))
      }, "id");
      return res.json(conversationView(result[0]));
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.post("/conversations/groups", async (req, res) => {
    try {
      const uid = ownerId(req);
      const selected = [...new Set((Array.isArray(req.body?.memberIds) ? req.body.memberIds : []).map(String).filter(id => id && id !== uid))];
      if (selected.length < 2 || selected.length > 19) return res.status(400).json({ error: "Choose between 2 and 19 friends." });
      await ensureProfileForRequest(req);
      for (const memberId of selected) {
        if (!(await areAcceptedFriends(uid, memberId))) return res.status(403).json({ error: "Group chats can include accepted friends only." });
      }
      const ids = [uid, ...selected];
      const profileRows = await rows("profiles", { params: {
        user_id: `in.(${ids.map(value => `"${value.replaceAll('"', '')}"`).join(",")})`,
        select: "user_id,display_name,photo_url"
      } });
      if (profileRows.length !== ids.length) return res.status(404).json({ error: "One or more group members could not be found." });
      const members = profileRows.map(row => ({ id: row.user_id, displayName: row.display_name, photoURL: row.photo_url }));
      const id = `group:${randomUUID()}`;
      const result = await rest("chat_conversations", { method: "POST", body: {
        id, type: "group", title: String(req.body?.title || "Study group").trim().slice(0, 60) || "Study group",
        created_by: uid, participants: ids.sort(), members
      }, headers: { Prefer: "return=representation" } });
      return res.status(201).json(conversationView(result[0]));
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.get("/conversations/groups", async (req, res) => {
    try {
      const uid = ownerId(req);
      const result = await rows("chat_conversations", { params: {
        type: "eq.group", participants: `cs.{${uid}}`, select: "*", order: "updated_at.desc", limit: "100"
      } });
      return res.json(result.map(conversationView));
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.get("/conversations/inbox", async (req, res) => {
    try {
      const uid = ownerId(req);
      const conversations = await rows("chat_conversations", { params: {
        participants: `cs.{${uid}}`, select: "*", order: "updated_at.desc", limit: "100"
      } });
      const availableConversations = [];
      for (const conversation of conversations) {
        if (conversation.type !== "direct") { availableConversations.push(conversation); continue; }
        const other = (conversation.participants || []).map(String).find(id => id !== uid);
        if (!other || !(await areUsersBlocked(uid, other))) availableConversations.push(conversation);
      }
      if (!availableConversations.length) return res.json([]);
      const ids = availableConversations.map(item => String(item.id));
      const inFilter = `(${ids.map(id => `"${id.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(",")})`;
      const messages = await rows("chat_messages", { params: {
        conversation_id: `in.${inFilter}`, select: "*", order: "timestamp.desc", limit: "1000"
      } });
      const latest = new Map();
      for (const message of messages) {
        if (!latest.has(message.conversation_id)) latest.set(message.conversation_id, messageView(message, message.conversation_id));
      }
      return res.json(availableConversations.map(conversation => ({
        ...conversationView(conversation),
        lastMessage: latest.get(conversation.id) || null
      })));
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.get("/conversations/:id/messages", async (req, res) => {
    try {
      const conversation = await requireParticipant(req.params.id, ownerId(req));
      if (conversation.type === "direct") {
        const other = conversation.participants.find(id => id !== ownerId(req));
        if (!(await areAcceptedFriends(ownerId(req), other))) return res.status(403).json({ error: "This chat is no longer available." });
      }
      const sinceMs = Date.parse(String(req.query.since || ""));
      const params = Number.isFinite(sinceMs) ? {
        conversation_id: `eq.${req.params.id}`,
        updated_at: `gt.${new Date(sinceMs).toISOString()}`,
        select: "*", order: "updated_at.asc", limit: "200"
      } : {
        conversation_id: `eq.${req.params.id}`, select: "*", order: "timestamp.desc", limit: "100"
      };
      const result = await rows("chat_messages", { params });
      return res.json((Number.isFinite(sinceMs) ? result : result.reverse()).map(row => messageView(row, req.params.id)));
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.post("/conversations/:id/messages", async (req, res) => {
    try {
      const uid = ownerId(req);
      const conversation = await requireParticipant(req.params.id, uid);
      if (conversation.type === "direct") {
        const other = conversation.participants.find(id => id !== uid);
        if (!(await areAcceptedFriends(uid, other))) return res.status(403).json({ error: "This chat is no longer available." });
      }
      const text = String(req.body?.text || "").trim().slice(0, 2000);
      const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments.slice(0, 10) : [];
      if (!text && !attachments.length) return res.status(400).json({ error: "Write a message or attach a file." });
      for (const item of attachments) {
        const attachment = await first("chat_attachments", { params: {
          id: `eq.${String(item.id || "")}`, owner_id: `eq.${uid}`,
          conversation_id: `eq.${req.params.id}`, select: "id"
        } });
        if (!attachment) return res.status(400).json({ error: "An attachment is invalid or unavailable." });
      }
      const replyTo = req.body?.replyTo?.messageId && req.body?.replyTo?.text
        ? { messageId: String(req.body.replyTo.messageId).slice(0, 160), senderId: String(req.body.replyTo.senderId || "").slice(0, 160), text: String(req.body.replyTo.text).trim().slice(0, 240) }
        : null;
      const result = await rest("chat_messages", { method: "POST", body: {
        conversation_id: req.params.id, sender_id: uid, text, attachments, reply_to: replyTo,
        seen_by: { [uid]: new Date().toISOString() }
      }, headers: { Prefer: "return=representation" } });
      await patch("chat_conversations", { id: `eq.${req.params.id}` }, { updated_at: new Date().toISOString() });
      if (attachments.length) {
        await patch("chat_attachments", { id: `in.(${attachments.map(item => `"${String(item.id).replaceAll('"', '')}"`).join(",")})` }, { is_referenced: true });
      }
      const message = messageView(result[0], req.params.id);
      emitChatEvent(req.params.id, "chat:message", message);
      return res.status(201).json(message);
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.post("/conversations/:id/seen", async (req, res) => {
    try {
      const uid = ownerId(req);
      const conversation = await requireParticipant(req.params.id, uid);
      if (conversation.type === "direct") {
        const other = conversation.participants.find(id => id !== uid);
        if (!(await areAcceptedFriends(uid, other))) return res.status(403).json({ error: "This chat is no longer available." });
      }
      const ids = Array.isArray(req.body?.messageIds) ? req.body.messageIds.slice(0, 100) : [];
      if (ids.length) await supabaseRequest("/rest/v1/rpc/mark_chat_messages_seen", {
        method: "POST",
        body: { p_conversation_id: String(req.params.id), p_user_id: uid, p_message_ids: ids.map(String) }
      });
      if (ids.length) emitChatEvent(req.params.id, "chat:seen", { conversationId: req.params.id, userId: uid, messageIds: ids.map(String) });
      return res.json({ success: true });
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.delete("/conversations/:id", async (req, res) => {
    try {
      await requireParticipant(req.params.id, ownerId(req));
      const attachments = await rows("chat_attachments", { params: { conversation_id: `eq.${req.params.id}`, select: "storage_path" } });
      if (attachments.length) {
        await supabaseRequest(`/storage/v1/object/${encodeURIComponent(storageBucket)}`, {
          method: "DELETE", body: { prefixes: attachments.map(item => item.storage_path) }
        });
      }
      await remove("chat_conversations", { id: `eq.${req.params.id}` });
      emitChatEvent(req.params.id, "chat:delete", { conversationId: req.params.id, deletedBy: ownerId(req) });
      return res.json({ success: true });
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.post("/conversations/:id/messages/:messageId/unsend", async (req, res) => {
    try {
      const uid = ownerId(req);
      await requireParticipant(req.params.id, uid);
      const existing = await first("chat_messages", { params: {
        id: `eq.${req.params.messageId}`, conversation_id: `eq.${req.params.id}`, select: "*"
      } });
      if (!existing) return res.status(404).json({ error: "Message not found." });
      if (existing.sender_id !== uid) return res.status(403).json({ error: "You can only unsend your own messages." });
      await deleteStoredAttachments(existing.attachments || []);
      const result = await patch("chat_messages", { id: `eq.${existing.id}`, conversation_id: `eq.${req.params.id}` }, {
        text: "This message was unsent.", attachments: [], reactions: {}, is_unsent: true, updated_at: new Date().toISOString()
      });
      const message = messageView(result[0], req.params.id);
      emitChatEvent(req.params.id, "chat:unsend", message);
      return res.json(message);
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.post("/conversations/:id/messages/:messageId/react", async (req, res) => {
    try {
      const uid = ownerId(req);
      const conversation = await requireParticipant(req.params.id, uid);
      if (conversation.type === "direct") {
        const other = conversation.participants.find(id => id !== uid);
        if (!(await areAcceptedFriends(uid, other))) return res.status(403).json({ error: "This chat is no longer available." });
      }
      const emoji = String(req.body?.emoji || "");
      const allowed = new Set(["❤️", "😂", "😮", "😢", "😡", "👍"]);
      if (!allowed.has(emoji)) return res.status(400).json({ error: "Choose one of the supported reactions." });
      const result = await supabaseRequest("/rest/v1/rpc/toggle_chat_message_reaction", {
        method: "POST", body: {
          p_conversation_id: String(req.params.id), p_message_id: String(req.params.messageId),
          p_user_id: uid, p_emoji: emoji
        }
      });
      const row = Array.isArray(result) ? result[0] : result;
      if (!row) return res.status(404).json({ error: "Message not found." });
      const message = messageView(row, req.params.id);
      emitChatEvent(req.params.id, "chat:reaction", message);
      return res.json(message);
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.post("/chat/attachments", express.raw({ type: () => true, limit: "25mb" }), async (req, res) => {
    try {
      const uid = ownerId(req);
      const conversationId = String(req.get("x-chat-conversation") || "");
      const mimeType = String(req.get("content-type") || "").split(";")[0].toLowerCase();
      const allowedTypes = new Set([
        "image/jpeg", "image/png", "image/webp", "image/avif", "image/bmp", "image/heic", "image/heif",
        "video/mp4", "video/webm", "video/quicktime", "video/3gpp", "video/x-m4v",
        "audio/mp4", "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp3", "audio/aac", "audio/wav", "audio/x-wav", "audio/x-m4a", "audio/3gpp",
        "application/pdf", "text/plain", "text/csv", "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      ]);
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Choose a file to upload." });
      if (!allowedTypes.has(mimeType)) return res.status(415).json({ error: "That file type is not supported." });
      const maxBytes = mimeType.startsWith("video/") ? 25 * 1024 * 1024 : 10 * 1024 * 1024;
      if (req.body.length > maxBytes) return res.status(413).json({ error: `Attachments must be ${mimeType.startsWith("video/") ? "25" : "10"} MB or smaller.` });
      const conversation = await requireParticipant(conversationId, uid);
      if (conversation.type === "direct") {
        const other = conversation.participants.find(id => id !== uid);
        if (!(await areAcceptedFriends(uid, other))) return res.status(403).json({ error: "This chat is no longer available." });
      }
      const nameHeader = req.get("x-file-name") || "attachment";
      let name = nameHeader;
      try { name = decodeURIComponent(nameHeader); } catch {}
      name = name.split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, "").slice(0, 180) || "attachment";
      const id = randomUUID();
      const storagePath = `${conversationId}/${id}`;
      await supabaseRequest(`/storage/v1/object/${encodeURIComponent(storageBucket)}/${storagePath.split("/").map(encodeURIComponent).join("/")}`, {
        method: "POST", body: req.body, raw: true,
        headers: { "Content-Type": mimeType, "x-upsert": "false" }
      });
      let result;
      try {
        result = await rest("chat_attachments", { method: "POST", body: {
          id, owner_id: uid, conversation_id: conversationId, name, mime_type: mimeType,
          size_bytes: req.body.length, storage_path: storagePath
        }, headers: { Prefer: "return=representation" } });
      } catch (metadataError) {
        await supabaseRequest(`/storage/v1/object/${encodeURIComponent(storageBucket)}`, {
          method: "DELETE", body: { prefixes: [storagePath] }
        }).catch(() => {});
        throw metadataError;
      }
      return res.status(201).json({ id, name, mimeType, size: req.body.length, url: `/api/data/chat/attachments/${id}`, storage: "supabase" });
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message || "Could not save this attachment." }); }
  });

  router.get("/chat/attachments/:id", async (req, res) => {
    try {
      const uid = ownerId(req);
      const attachment = await first("chat_attachments", { params: { id: `eq.${req.params.id}`, select: "*" } });
      if (!attachment) return res.status(404).json({ error: "Attachment not found." });
      await requireParticipant(attachment.conversation_id, uid);
      const encodedPath = attachment.storage_path.split("/").map(encodeURIComponent).join("/");
      const response = await fetch(`${supabaseUrl}/storage/v1/object/authenticated/${encodeURIComponent(storageBucket)}/${encodedPath}`, {
        headers: {
          apikey: supabaseKey
        }
      });
      if (!response.ok) return res.status(response.status).json({ error: "Could not load attachment." });
      res.set("Content-Type", attachment.mime_type);
      res.set("Content-Length", String(attachment.size_bytes));
      res.set("X-Content-Type-Options", "nosniff");
      res.set("Cache-Control", "private, no-store");
      res.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(attachment.name)}`);
      return res.send(Buffer.from(await response.arrayBuffer()));
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.post("/chat/attachments/:id/retain", async (req, res) => {
    try {
      const uid = ownerId(req);
      const attachment = await first("chat_attachments", { params: { id: `eq.${req.params.id}`, select: "*" } });
      if (!attachment) return res.status(404).json({ error: "Attachment not found." });
      await requireParticipant(attachment.conversation_id, uid);
      if (attachment.owner_id !== uid) return res.status(403).json({ error: "Only the uploader can retain this attachment." });
      await patch("chat_attachments", { id: `eq.${attachment.id}`, owner_id: `eq.${uid}` }, { is_referenced: true });
      return res.json({ success: true });
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.delete("/chat/attachments/:id", async (req, res) => {
    try {
      const uid = ownerId(req);
      const attachment = await first("chat_attachments", { params: { id: `eq.${req.params.id}`, select: "*" } });
      if (!attachment) return res.json({ success: true });
      await requireParticipant(attachment.conversation_id, uid);
      if (attachment.owner_id !== uid) return res.status(403).json({ error: "Only the uploader can delete this attachment." });
      await deleteStoredAttachments([{ storage: "supabase", path: attachment.storage_path }]);
      return res.json({ success: true });
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  return router;
}
