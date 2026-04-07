import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const _base = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const _orig = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input
    : input instanceof URL ? input.href
    : (input as Request).url;

  const isApi = _base ? url.startsWith(_base) : (url.startsWith("/api") || url.startsWith("/kb") || url.startsWith("/export") || url.startsWith("/settings"));

  if (isApi && !url.endsWith("/api/login")) {
    const token = localStorage.getItem("aina_auth_token");
    if (token) {
      const headers = new Headers((init?.headers as HeadersInit) || {});
      headers.set("Authorization", `Bearer ${token}`);
      init = { ...init, headers };
    }
    const res = await _orig(input, init);
    if (res.status === 401) {
      localStorage.removeItem("aina_auth_token");
      window.location.href = "/login";
    }
    return res;
  }

  return _orig(input, init);
};

createRoot(document.getElementById("root")!).render(<App />);
