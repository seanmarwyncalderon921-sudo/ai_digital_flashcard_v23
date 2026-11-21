/*
 * Production API deployed by render.yaml. Keep this in sync with the Render
 * service URL if the service is renamed or given a custom domain.
 */
const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const isLocalServer = isLocalHost && window.location.port === "3000";
const isLocalPreview = isLocalHost && !isLocalServer;

window.SAPC_API_BASE_URL = isLocalPreview
  ? "http://localhost:3000"
  : isLocalServer ? "" : "https://sapc-ai-reviewer-api.onrender.com";

// Cloudinary browser uploads use an unsigned preset. Never put an API secret here.
window.SAPC_CLOUDINARY_CONFIG = {
  cloudName: "x3fejaey",
  uploadPreset: "ai_driven_academic_reviewer_chat"
};
