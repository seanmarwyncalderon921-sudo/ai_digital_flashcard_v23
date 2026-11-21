/*
 * The Render app serves both the frontend and API from one origin. The
 * Firebase-hosted frontend keeps using the separate Render API service.
 */
const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const isLocalServer = isLocalHost && window.location.port === "3000";
const isLocalPreview = isLocalHost && !isLocalServer;
const isPrimaryRenderApp = window.location.hostname === "ai-digital-flashcard-v23.onrender.com";

window.SAPC_API_BASE_URL = isLocalPreview
  ? "http://localhost:3000"
  : isLocalServer || isPrimaryRenderApp ? "" : "https://sapc-ai-reviewer-api.onrender.com";

// Cloudinary browser uploads use an unsigned preset. Never put an API secret here.
window.SAPC_CLOUDINARY_CONFIG = {
  cloudName: "x3fejaey",
  uploadPreset: "ai_driven_academic_reviewer_chat"
};
