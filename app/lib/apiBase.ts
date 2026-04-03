const DEFAULT_API_BASE = "https://shuffle-server-7bvr.onrender.com";
const rawBase = process.env.NEXT_PUBLIC_API_BASE || DEFAULT_API_BASE;

export const API_BASE = rawBase.replace(/\/+$/, "");

export function apiUrl(path: string) {
  if (!API_BASE) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}
