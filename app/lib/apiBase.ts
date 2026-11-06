const DEFAULT_API_BASE = "https://15.156.194.69/shuffle-crash";
const legacyBase = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
// Preserve custom deployments; migrate the old Render setting automatically.
const rawBase = process.env.NEXT_PUBLIC_TRACKER_API_URL ||
  (legacyBase === "https://shuffle-server-7bvr.onrender.com" ? DEFAULT_API_BASE : legacyBase) || DEFAULT_API_BASE;

export const API_BASE = rawBase.replace(/\/+$/, "");

export function apiUrl(path: string) {
  if (!API_BASE) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}
