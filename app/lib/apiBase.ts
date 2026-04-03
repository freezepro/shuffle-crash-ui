const rawBase = process.env.NEXT_PUBLIC_API_BASE || "";

export const API_BASE = rawBase.replace(/\/+$/, "");

export function apiUrl(path: string) {
  if (!API_BASE) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}
