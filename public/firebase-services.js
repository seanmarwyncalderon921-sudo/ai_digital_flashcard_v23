/* Firebase remains the sign-in provider. User data is stored by the Render API
 * in Supabase so the Supabase secret never reaches browser code. */
(function initialiseFirebaseServices() {
  const config = window.SAPC_FIREBASE_CONFIG;
  const isConfigured = config && !Object.values(config).some(value => String(value).startsWith("REPLACE_WITH"));

  if (!isConfigured || !window.firebase) {
    window.sapcFirebase = {
      configured: false,
      getCurrentUser: () => null,
      getIdToken: async () => null,
      ensureChatIdentity: async () => { throw new Error("User must be signed in to chat."); },
      ensureChatConversation: async () => null,
      createGroupConversation: async () => { throw new Error("Group chat service is not configured."); },
      listGroupConversations: async () => [],
      subscribeToChatMessages: () => () => {},
      sendChatMessage: async () => { throw new Error("Chat service is not configured."); },
      listChatMessages: async () => [],
      deleteChatConversation: async () => { throw new Error("Chat service is not configured."); },
      unsendChatMessage: async () => { throw new Error("Chat service is not configured."); },
      markChatMessagesSeen: async () => {},
      uploadChatAttachment: async () => { throw new Error("Attachment upload is not configured."); },
      uploadChatConversationAttachment: async () => { throw new Error("Attachment upload is not configured."); },
      fetchChatAttachment: async () => { throw new Error("Attachment download is not configured."); },
      deleteChatAttachment: async () => { throw new Error("Attachment deletion is not configured."); }
    };
    return;
  }

  if (!firebase.apps.length) firebase.initializeApp(config);
  const auth = firebase.auth();
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const getRecipientId = profile => profile?.id || profile?.uid || profile || "";
  const apiBase = String(window.SAPC_API_BASE_URL || "").replace(/\/+$/, "");
  const apiUrl = path => `${apiBase}/api/data${path}`;
  let chatSocket = null;
  let chatSocketUserId = "";
  const chatTypingSequences = new Map();
  async function ensureChatSocket() {
    if (chatSocket && chatSocketUserId !== auth.currentUser?.uid) {
      chatSocket.disconnect(); chatSocket = null; chatSocketUserId = "";
    }
    if (chatSocket?.connected) return chatSocket;
    if (chatSocket?.active) return chatSocket;
    if (typeof window.io !== "function" || !auth.currentUser) return null;
    const token = await auth.currentUser.getIdToken();
    chatSocket = window.io(apiBase || window.location.origin, { auth: { token }, autoConnect: false });
    chatSocketUserId = auth.currentUser.uid;
    chatSocket.on("call:incoming", event => window.dispatchEvent(new CustomEvent("sapc:incoming-call", { detail: event })));
    chatSocket.on("connect_error", async error => {
      if (chatSocket && /token|expired|invalid/i.test(error?.message || "") && auth.currentUser) {
        chatSocket.auth = { token: await auth.currentUser.getIdToken(true) };
        chatSocket.connect();
      }
    });
    chatSocket.connect();
    return chatSocket;
  }
  auth.onAuthStateChanged(user => {
    if (!user && chatSocket) { chatSocket.disconnect(); chatSocket = null; chatSocketUserId = ""; }
    else if (user) ensureChatSocket().catch(error => console.warn("Live chat connection unavailable:", error.message));
  });

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (!options.public) {
      const user = auth.currentUser;
      if (!user) throw new Error("Please sign in to continue.");
      headers.Authorization = `Bearer ${await user.getIdToken()}`;
    }
    if (options.json !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(apiUrl(path), {
      method: options.method || "GET",
      headers,
      ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
      ...(options.body !== undefined ? { body: options.body } : {})
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!response.ok) {
      const message = typeof data === "object" && data ? data.error || data.message : data;
      const readableMessage = typeof message === "string" && /<\s*!doctype\s+html|<\s*html[\s>]/i.test(message)
        ? "The server does not have this API route yet. Restart the local server or deploy the latest server.js, then reload the app."
        : message;
      throw new Error(readableMessage || `Request failed (${response.status}).`);
    }
    return data;
  }

  function sanitizeDeckCards(cards) {
    const heavyFieldNames = new Set([
      "notes", "rawnotes", "sourcenotes", "sourcetext", "images", "image", "imagedata",
      "base64", "filebuffer", "filedata", "attachmentdata"
    ]);
    const clean = JSON.parse(JSON.stringify(cards, (key, value) => {
      if (heavyFieldNames.has(String(key).toLowerCase()) || /base64|image|filebuffer|attachmentdata/i.test(String(key))) return undefined;
      if (typeof value === "string" && (/^data:[^;,]+;base64,/i.test(value)
        || (value.length > 1024 && /^[A-Za-z0-9+/_=-]+$/.test(value)))) return undefined;
      return value;
    }));
    if (new TextEncoder().encode(JSON.stringify(clean)).length > 750 * 1024) {
      throw new Error("This deck is too large to save. Remove extra cards or embedded media and try again.");
    }
    return clean;
  }

  function conversationIdFor(user, profile) {
    if (typeof profile === "string" && (profile.startsWith("chat:") || profile.startsWith("group:"))) return profile;
    if (profile?.conversationId) return profile.conversationId;
    if (profile?.type === "group" && profile?.id) return profile.id;
    const recipientId = getRecipientId(profile);
    if (!user || !recipientId) return "";
    return `chat:${[String(user.uid), String(recipientId)].sort().join(":")}`;
  }

  async function ensureProfile(user) {
    return api("/profile");
  }

  window.sapcFirebase = {
    configured: true,
    auth,
    provider,
    getCurrentUser: () => auth.currentUser,
    getIdToken: () => auth.currentUser ? auth.currentUser.getIdToken() : null,

    ensureChatIdentity: async () => {
      const user = auth.currentUser;
      if (!user) throw new Error("User must be signed in to chat.");
      return { userId: user.uid, token: await user.getIdToken(true) };
    },

    ensureChatConversation: async (userOrRecipient, profileOrNull) => {
      const user = auth.currentUser || (userOrRecipient?.uid ? userOrRecipient : null);
      const otherId = getRecipientId(profileOrNull || userOrRecipient);
      if (!user || !otherId) return null;
      const conversation = await api("/conversations/direct", { method: "POST", json: { otherId: String(otherId) } });
      return conversation.id;
    },

    createGroupConversation: async (user, friends, title) => {
      if (!auth.currentUser && !user) throw new Error("Sign in to create a group chat.");
      const memberIds = [...new Set((friends || []).map(getRecipientId).map(String).filter(Boolean))];
      return api("/conversations/groups", { method: "POST", json: { memberIds, title: String(title || "") } });
    },

    listGroupConversations: async () => api("/conversations/groups"),
    listChatInbox: async () => api("/conversations/inbox"),
    getChatPresence: async userIds => api("/friends/presence", { method: "POST", json: { userIds: (userIds || []).slice(0, 100) } }),
    connectChatSocket: ensureChatSocket,
    sendChatTyping: async (conversationId, typing) => {
      const socket = await ensureChatSocket();
      if (socket?.connected) {
        const sequence = (chatTypingSequences.get(conversationId) || 0) + 1;
        chatTypingSequences.set(conversationId, sequence);
        socket.emit("chat:typing", { conversationId, typing: typing ? "start" : "stop", sequence });
      }
    },
    subscribeToChatTyping: async (conversationId, callback) => {
      const socket = await ensureChatSocket();
      if (!socket || typeof callback !== "function") return () => {};
      const handler = event => { if (event.conversationId === conversationId) callback(event); };
      socket.on("chat:typing", handler);
      return () => socket.off("chat:typing", handler);
    },
    getWebRtcIceServers: async () => {
      const result = await api("/webrtc/ice-config");
      return Array.isArray(result?.iceServers) ? result.iceServers : [];
    },
    getChatProfile: async userId => api(`/profiles/${encodeURIComponent(String(userId))}`),
    subscribeToPeerCall: async (conversationId, callback) => {
      const socket = await ensureChatSocket();
      if (!socket || typeof callback !== "function") throw new Error("Live calling is unavailable.");
      if (!socket.connected) {
        socket.connect();
        await new Promise((resolve, reject) => {
          const cleanup = () => { clearTimeout(timer); socket.off("connect", connected); socket.off("connect_error", failed); };
          const connected = () => { cleanup(); resolve(); };
          const failed = error => { cleanup(); reject(new Error(error?.message || "Could not connect to the call server.")); };
          const timer = setTimeout(() => { cleanup(); reject(new Error("Could not connect to the call server.")); }, 10000);
          socket.once("connect", connected);
          socket.once("connect_error", failed);
        });
      }
      const joined = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Could not join this chat for calling.")), 8000);
        socket.emit("chat:join", { conversationId }, result => { clearTimeout(timer); resolve(result); });
      });
      if (!joined?.ok) throw new Error(joined?.error || "Could not join this chat for calling.");
      const handler = event => {
        if (event?.conversationId === conversationId) Promise.resolve().then(() => callback(event)).catch(error => console.error("Call signal handler failed:", error));
      };
      const blockedHandler = event => {
        if (event?.conversationId === conversationId) Promise.resolve().then(() => callback({ ...event, type: "blocked" })).catch(() => {});
      };
      const disconnectHandler = () => Promise.resolve().then(() => callback({ conversationId, type: "disconnect" })).catch(() => {});
      socket.on("call:signal", handler);
      socket.on("chat:blocked", blockedHandler);
      socket.on("disconnect", disconnectHandler);
      return {
        send: (type, callId, data = {}) => socket.emit("call:signal", { conversationId, type, callId, data }),
        unsubscribe: () => { socket.off("call:signal", handler); socket.off("chat:blocked", blockedHandler); socket.off("disconnect", disconnectHandler); }
      };
    },

    subscribeToChatMessages: (arg1, arg2, arg3) => {
      const user = typeof arg1 === "string" ? auth.currentUser : arg1;
      const profile = typeof arg1 === "string" ? arg1 : arg2;
      const callback = typeof arg1 === "string" ? arg2 : arg3;
      const id = conversationIdFor(user, profile);
      if (!id || typeof callback !== "function") return () => {};
      let closed = false;
      let loading = false;
      let lastSignature = null;
      let cursorMs = 0;
      const messageCache = new Map();
      let socket = null;
      let fallbackTimer = null;
      let joinHandler = null;
      const eventNames = ["chat:message", "chat:reaction", "chat:unsend", "chat:seen", "chat:blocked"];
      const onChatEvent = event => {
        if (event?.conversationId !== id && event?.room !== id) return;
        if (event?.blockedBy) {
          window.dispatchEvent(new CustomEvent("sapc:chat-blocked", { detail: event }));
          return;
        }
        refresh(true);
      };
      const onChatDelete = event => {
        if (event?.conversationId === id && event.deletedBy !== auth.currentUser?.uid) {
          messageCache.clear(); lastSignature = null; callback(null);
        }
      };
      const refresh = async (force = false) => {
        if (closed || loading || (document.hidden && !force)) return;
        loading = true;
        try {
          const since = cursorMs > 0
            ? `?since=${encodeURIComponent(new Date(Math.max(0, cursorMs - 2000)).toISOString())}`
            : "";
          const updates = await api(`/conversations/${encodeURIComponent(id)}/messages${since}`);
          updates.forEach(message => {
            messageCache.set(String(message.id), message);
            const updatedAt = Date.parse(message.updatedAt || message.timestamp || "");
            if (Number.isFinite(updatedAt)) cursorMs = Math.max(cursorMs, updatedAt);
          });
          let messages = [...messageCache.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
          while (messages.length > 100) {
            messageCache.delete(String(messages.shift().id));
          }
          const signature = JSON.stringify(messages.map(message => [
            message.id, message.updatedAt || message.timestamp, message.text,
            message.isUnsent, message.seenBy, message.reactions, message.attachments?.map(item => item.id)
          ]));
          if (signature !== lastSignature) {
            lastSignature = signature;
            callback(messages);
          }
        }
        catch (error) { if (!closed) console.error("Error loading chat messages:", error); }
        finally { loading = false; }
      };
      const start = async () => {
        socket = await ensureChatSocket();
        if (closed) return;
        if (socket) {
          joinHandler = () => socket.emit("chat:join", { conversationId: id }, result => {
            if (!result?.ok && !closed) console.warn("Could not join live chat room:", result?.error);
          });
          socket.on("connect", joinHandler);
          if (socket.connected) joinHandler();
          eventNames.forEach(name => socket.on(name, onChatEvent));
          socket.on("chat:delete", onChatDelete);
          fallbackTimer = setInterval(() => { if (!socket?.connected) refresh(); }, 10000);
        } else fallbackTimer = setInterval(() => refresh(), 10000);
        refresh(true);
      };
      start();
      const onConnectionChange = () => { if (!document.hidden) refresh(true); };
      const onVisibilityChange = () => { if (!document.hidden) refresh(); };
      chatSocket?.on("connect", onConnectionChange);
      chatSocket?.on("disconnect", onConnectionChange);
      document.addEventListener("visibilitychange", onVisibilityChange);
      const unsubscribe = () => {
        closed = true;
        clearInterval(fallbackTimer);
        if (socket) {
          socket.emit("chat:leave", { conversationId: id });
          socket.off("connect", onConnectionChange);
          eventNames.forEach(name => socket.off(name, onChatEvent));
          socket.off("chat:delete", onChatDelete);
          if (joinHandler) socket.off("connect", joinHandler);
        }
        chatSocket?.off("connect", onConnectionChange);
        chatSocket?.off("disconnect", onConnectionChange);
        document.removeEventListener("visibilitychange", onVisibilityChange);
      };
      unsubscribe.refresh = refresh;
      return unsubscribe;
    },

    listChatMessages: async (user, profile) => {
      const id = conversationIdFor(user, profile);
      if (!id) return [];
      return api(`/conversations/${encodeURIComponent(id)}/messages`);
    },

    deleteChatConversation: async (user, profile) => {
      const id = conversationIdFor(user, profile);
      if (!id) throw new Error("A chat conversation is required.");
      return api(`/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    markChatMessagesSeen: async (user, profile, messages) => {
      const id = conversationIdFor(user, profile);
      if (!id || !Array.isArray(messages)) return;
      const messageIds = messages.filter(message => message.senderId !== user.uid && !message.seenBy?.[user.uid]).map(message => message.id);
      if (messageIds.length) await api(`/conversations/${encodeURIComponent(id)}/seen`, { method: "POST", json: { messageIds } });
    },

    uploadChatAttachment: async () => { throw new Error("Choose a chat before uploading an attachment."); },

    uploadChatConversationAttachment: async (user, id, file) => {
      if (!user || !id || !file) throw new Error("Choose a file and a chat first.");
      const token = await user.getIdToken();
      const response = await fetch(apiUrl("/chat/attachments"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": file.type || "application/octet-stream",
          "X-Chat-Conversation": id,
          "X-File-Name": encodeURIComponent(file.name || "attachment")
        },
        body: file
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Upload failed (${response.status}).`);
      return { ...result, url: apiUrl(`/chat/attachments/${encodeURIComponent(result.id)}`), storage: "supabase" };
    },

    fetchChatAttachment: async (user, attachment) => {
      if (!user || !attachment?.url) throw new Error("This attachment is unavailable.");
      if (/^(blob:|data:)/.test(String(attachment.url))) return attachment.url;
      const url = new URL(attachment.url, window.location.origin);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Could not load this attachment.");
      }
      return URL.createObjectURL(await response.blob());
    },

    deleteChatAttachment: async (user, attachment) => {
      if (user && attachment?.id) await api(`/chat/attachments/${encodeURIComponent(attachment.id)}`, { method: "DELETE" });
    },

    sendChatMessage: async (userOrConvId, profileOrText, messageData) => {
      const user = auth.currentUser || (userOrConvId?.uid ? userOrConvId : null);
      let id;
      let payload;
      if (typeof userOrConvId === "string" && /^(chat:|group:)/.test(userOrConvId)) {
        id = userOrConvId;
        payload = typeof profileOrText === "object" && profileOrText
          ? profileOrText
          : { text: profileOrText, attachments: Array.isArray(messageData) ? messageData : messageData ? [messageData] : [] };
      } else {
        id = conversationIdFor(user, profileOrText);
        payload = messageData || {};
      }
      if (!user || !id) throw new Error("Invalid chat parameters.");
      return api(`/conversations/${encodeURIComponent(id)}/messages`, { method: "POST", json: {
        text: String(payload.text || "").trim().slice(0, 2000),
        attachments: Array.isArray(payload.attachments) ? payload.attachments.slice(0, 10) : (payload.attachment ? [payload.attachment] : []),
        replyTo: payload.replyTo || null
      } });
    },

    unsendChatMessage: async (user, id, messageId) => {
      if (!user || !id || !messageId) throw new Error("Could not identify this message.");
      return api(`/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/unsend`, { method: "POST", json: {} });
    },
    toggleChatReaction: async (id, messageId, emoji) => {
      if (!id || !messageId) throw new Error("Could not identify this message.");
      return api(`/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/react`, { method: "POST", json: { emoji } });
    },

    ensureProfile,
    recordLegalConsent: async consent => api("/legal/consent", { method: "POST", json: consent }),
    getLegalConsent: async () => api("/legal/consent"),
    reportSafetyIssue: async report => api("/safety/reports", { method: "POST", json: report }),
    blockUser: async userId => api("/safety/blocks", { method: "POST", json: { userId } }),
    listBlockedUsers: async () => api("/safety/blocks"),
    unblockUser: async userId => api(`/safety/blocks/${encodeURIComponent(userId)}`, { method: "DELETE" }),
    submitPrivacyRequest: async request => api("/privacy/requests", { method: "POST", json: request }),
    updatePresence: async () => api("/profile/presence", { method: "POST", json: {} }),
    signIn: (email, password) => auth.signInWithEmailAndPassword(email, password),
    resolveLoginEmail: async identifier => {
      const value = String(identifier || "").trim().toLowerCase();
      const result = await api(`/username/resolve?username=${encodeURIComponent(value)}`, { public: true });
      return result.email;
    },
    isUsernameAvailable: async username => {
      const result = await api(`/username/available?username=${encodeURIComponent(String(username || "").trim().toLowerCase())}`, { public: true });
      return result.available;
    },
    register: (email, password) => auth.createUserWithEmailAndPassword(email, password),
    signInWithGoogle: () => auth.signInWithPopup(provider),
    signInWithGoogleRedirect: () => auth.signInWithRedirect(provider),
    completeGoogleRedirect: () => auth.getRedirectResult(),
    linkGoogle: user => user.linkWithPopup(provider),
    sendPasswordReset: email => auth.sendPasswordResetEmail(email, {
      url: `${window.location.origin}/reset-password.html`,
      handleCodeInApp: false
    }),
    signOut: () => auth.signOut(),

    listDecks: async () => api("/decks"),
    saveDeck: async (user, deck) => {
      const clean = {
        ...(deck.id ? { id: deck.id } : {}),
        title: String(deck.title || "Saved Reviewer Deck").trim().slice(0, 120),
        subjectMode: String(deck.subjectMode || "general").slice(0, 30),
        gradeLevel: String(deck.gradeLevel || "Grade 11").slice(0, 40),
        academicStrand: String(deck.academicStrand || "General").slice(0, 80),
        tags: Array.isArray(deck.tags) ? deck.tags.slice(0, 20).map(tag => String(tag).slice(0, 60)) : [],
        cards: sanitizeDeckCards(Array.isArray(deck.cards) ? deck.cards : [])
      };
      return api("/decks", { method: "POST", json: clean });
    },
    deleteDeck: async (user, deckId) => api(`/decks/${encodeURIComponent(deckId)}`, { method: "DELETE" }),
    recordStudySession: async (user, data) => api("/study-sessions", { method: "POST", json: data }),

    saveProfile: async (user, profile) => api("/profile", { method: "PUT", json: {
      displayName: String(profile.displayName || "").trim().slice(0, 80),
      username: String(profile.username || "").trim().toLowerCase().slice(0, 24),
      bio: String(profile.bio || "").trim().slice(0, 300),
      gradeLevel: String(profile.gradeLevel || "").slice(0, 30),
      strand: String(profile.strand || "").slice(0, 50),
      photoURL: String(profile.photoURL || "").slice(0, 400000)
    } }),
    getProfile: async () => api("/profile"),
    createShare: async (user, deck) => (await api("/shares", { method: "POST", json: {
      title: deck.title || "Shared Reviewer Deck", subjectMode: deck.subjectMode || "general", cards: deck.cards || []
    } })).id,
    getSharedDeck: async shareId => api(`/shares/${encodeURIComponent(shareId)}`, { public: true }),
    getPublicProfile: async uid => api(`/profiles/${encodeURIComponent(uid)}`),
    searchUsers: async query => api(`/users/search?q=${encodeURIComponent(String(query || "").trim())}`),
    sendFriendRequest: async (user, target) => api("/friends/requests", { method: "POST", json: { toId: getRecipientId(target) } }),
    listFriendRequests: async () => {
      const requests = (await api("/friends/requests")).filter(request => request.toId === auth.currentUser?.uid && request.status === "pending");
      return Promise.all(requests.map(async request => {
        try {
          const profile = await api(`/profiles/${encodeURIComponent(request.fromId)}`);
          return { ...request, fromName: profile?.displayName || request.fromName, fromUsername: profile?.username || "" };
        } catch {
          return request;
        }
      }));
    },
    listOutgoingFriendRequests: async () => (await api("/friends/requests")).filter(request => request.fromId === auth.currentUser?.uid && request.status === "pending"),
    listFriends: async () => (await api("/friends")).map(request => ({
      ...request,
      id: request.id,
      displayName: request.fromId === auth.currentUser?.uid ? request.toName : request.fromName
    })),
    respondToFriendRequest: async (requestId, status) => api(`/friends/requests/${encodeURIComponent(requestId)}`, { method: "PATCH", json: { status } }),
    removeFriend: async requestId => api(`/friends/requests/${encodeURIComponent(requestId)}`, { method: "DELETE" })
  };
})();
