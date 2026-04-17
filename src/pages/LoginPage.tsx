import { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Lock, User, Eye, EyeOff, AlertCircle } from "lucide-react";
import { setToken, setIsAdmin, setUsername as saveUsername } from "@/lib/auth";
import { apiUrl } from "@/lib/api";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/api/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        cache: "no-store",
      });
      let data: Record<string, string> = {};
      try {
        data = await res.json();
      } catch {
        setError(`Server mengembalikan respons tidak valid (HTTP ${res.status}). Coba refresh halaman.`);
        setLoading(false);
        return;
      }
      if (res.ok && data.token) {
        setToken(data.token);
        setIsAdmin(!!data.is_admin);
        saveUsername(data.username || "");
        navigate("/", { replace: true });
      } else {
        setError(data.error || "Login gagal.");
      }
    } catch (err) {
      setError("Tidak dapat terhubung ke server. Pastikan koneksi internet kamu stabil, lalu refresh halaman.");
    }
    setLoading(false);
  };

  return (
    <div className="bg-black relative overflow-hidden" style={{ height: '100dvh' }}>

      {/* ── Background ── */}
      <div className="absolute inset-0 pointer-events-none select-none">
        {/* Wallpaper images — dramatic Ken Burns */}
        <img src="/bg-home.jpg" alt="" className="absolute inset-0 w-full h-full object-cover sm:hidden"
          style={{ opacity: 0.45, objectPosition: "center 82%", transformOrigin: "center bottom", animation: "login-bg-drift-mobile 8s ease-in-out infinite" }} />
        <img src="/bg-desktop.jpg" alt="" className="absolute inset-0 w-full h-full object-cover hidden sm:block"
          style={{ opacity: 0.45, transformOrigin: "center center", animation: "login-bg-drift 9s ease-in-out infinite" }} />
        {/* Animated aurora overlay */}
        <div className="absolute inset-0" style={{ animation: "login-aurora 8s ease-in-out infinite", background: "radial-gradient(ellipse 80% 70% at 50% 40%, rgba(109,40,217,0.32) 0%, transparent 65%)" }} />
        {/* Floating orb 1 */}
        <div className="absolute" style={{ width: "380px", height: "380px", borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.18) 0%, transparent 70%)", top: "-100px", left: "-100px", animation: "login-orb-1 9s ease-in-out infinite" }} />
        {/* Floating orb 2 */}
        <div className="absolute" style={{ width: "280px", height: "280px", borderRadius: "50%", background: "radial-gradient(circle, rgba(167,139,250,0.14) 0%, transparent 70%)", bottom: "-60px", right: "-60px", animation: "login-orb-2 11s ease-in-out infinite 2s" }} />
        {/* Floating orb 3 — subtle mid accent */}
        <div className="absolute hidden sm:block" style={{ width: "200px", height: "200px", borderRadius: "50%", background: "radial-gradient(circle, rgba(196,181,253,0.12) 0%, transparent 70%)", top: "35%", right: "12%", animation: "login-orb-3 7s ease-in-out infinite 1s" }} />
        {/* Dot grid */}
        <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "radial-gradient(circle at 1.5px 1.5px, rgba(200,180,255,0.8) 1.5px, transparent 0)", backgroundSize: "32px 32px", animation: "login-grid 16s linear infinite" }} />
        <div className="absolute top-0 inset-x-0 h-1/3" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.82) 0%, transparent 100%)" }} />
        <div className="absolute bottom-0 inset-x-0 h-1/3" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.82) 0%, transparent 100%)" }} />
      </div>

      {/* Animation keyframes */}
      <style>{`
        @keyframes login-bg-drift {
          0%   { transform: scale(1.15) translate(0%, 0%); }
          25%  { transform: scale(1.28) translate(-6%, 4%); }
          50%  { transform: scale(1.22) translate(6%, -5%); }
          75%  { transform: scale(1.3)  translate(-4%, -4%); }
          100% { transform: scale(1.15) translate(0%, 0%); }
        }
        @keyframes login-bg-drift-mobile {
          0%   { transform: scale(1.45) translate(0%, 0%); }
          25%  { transform: scale(1.6)  translate(-5%, 4%); }
          50%  { transform: scale(1.52) translate(5%, -5%); }
          75%  { transform: scale(1.62) translate(-3%, -3%); }
          100% { transform: scale(1.45) translate(0%, 0%); }
        }
        @keyframes login-aurora {
          0%   { opacity: 0.85; transform: scale(1) translate(0, 0); }
          33%  { opacity: 1;    transform: scale(1.1) translate(3%, -3%); }
          66%  { opacity: 0.9;  transform: scale(1.05) translate(-3%, 2%); }
          100% { opacity: 0.85; transform: scale(1) translate(0, 0); }
        }
        @keyframes login-orb-1 {
          0%   { transform: translate(0, 0) scale(1); }
          50%  { transform: translate(50px, 60px) scale(1.25); }
          100% { transform: translate(0, 0) scale(1); }
        }
        @keyframes login-orb-2 {
          0%   { transform: translate(0, 0) scale(1); }
          50%  { transform: translate(-40px, -50px) scale(1.2); }
          100% { transform: translate(0, 0) scale(1); }
        }
        @keyframes login-orb-3 {
          0%   { transform: translate(0, 0); opacity: 0.6; }
          50%  { transform: translate(-30px, 35px); opacity: 1; }
          100% { transform: translate(0, 0); opacity: 0.6; }
        }
        @keyframes login-grid {
          0%   { background-position: 0 0; }
          100% { background-position: 32px 32px; }
        }
      `}</style>

      {/* ══ MOBILE layout — full screen ══ */}
      <div className="sm:hidden absolute inset-0 z-10 flex flex-col px-6 pt-0 pb-8">

        {/* Upper: logo */}
        <div className="flex flex-col items-center justify-end text-center" style={{ flex: "0 0 42%", paddingBottom: "20px" }}>
          <div className="relative">
            <div className="absolute inset-0 scale-[3] bg-violet-500/20 rounded-full blur-2xl pointer-events-none" />
            <img src="/AIGYPT_logo.png" alt="AINA" className="relative w-40 h-40 object-contain"
              style={{ filter: "drop-shadow(0 0 28px rgba(200,160,255,0.9))" }} />
          </div>
        </div>

        {/* Lower: form */}
        <div className="flex flex-col flex-1 justify-center gap-5">

          {/* Divider */}
          <div className="h-px bg-gradient-to-r from-transparent via-violet-700/40 to-transparent" />

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">

            {/* Username */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-[0.15em] text-violet-400/70">Username</label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-400/50 pointer-events-none" />
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="Username"
                  autoComplete="username"
                  required
                  className="w-full bg-[#0f0a1e] border border-violet-800/50 rounded-2xl pl-10 pr-4 py-3.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20 transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-[0.15em] text-violet-400/70">Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-400/50 pointer-events-none" />
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                  required
                  className="w-full bg-[#0f0a1e] border border-violet-800/50 rounded-2xl pl-10 pr-10 py-3.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20 transition-all"
                />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-violet-400 transition-colors p-0.5">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 bg-red-900/20 border border-red-700/40 rounded-2xl px-3.5 py-3 text-xs text-red-300">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full h-14 rounded-2xl font-bold text-base text-white flex items-center justify-center gap-2 transition-all duration-200 mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(135deg, #6d28d9, #7c3aed, #8b5cf6)", boxShadow: loading ? "none" : "0 0 20px rgba(139,92,246,0.45), 0 4px 14px rgba(0,0,0,0.5)" }}
            >
              {loading ? <><Loader2 className="w-5 h-5 animate-spin" />Masuk...</> : <>Masuk ke AINA Scraper</>}
            </button>

          </form>
        </div>

        <p className="text-center text-[10px] text-slate-700 tracking-wider uppercase pt-4">© AINA Internal Tool</p>
      </div>

      {/* ══ DESKTOP layout — centered card ══ */}
      <div className="hidden sm:flex items-center justify-center h-full px-4">
        <div className="relative z-10 w-full max-w-sm">

          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <div className="relative">
              <div className="absolute inset-0 scale-[3] bg-violet-500/20 rounded-full blur-2xl pointer-events-none" />
              <img src="/AIGYPT_logo.png" alt="AINA" className="relative w-40 h-40 object-contain"
                style={{ filter: "drop-shadow(0 0 28px rgba(200,160,255,0.9))" }} />
            </div>
          </div>

          {/* Form card */}
          <div className="relative overflow-hidden rounded-2xl"
            style={{ background: "#0d0720", border: "1px solid rgba(139,92,246,0.3)", boxShadow: "0 0 40px rgba(109,40,217,0.22), 0 4px 24px rgba(0,0,0,0.7)" }}>
            <div className="h-[3px] bg-gradient-to-r from-violet-600 via-purple-400 to-violet-600" />
            <form onSubmit={handleSubmit} className="p-6 space-y-4">

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-[0.15em] text-violet-400/70">Username</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-400/50 pointer-events-none" />
                  <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                    placeholder="Username" autoComplete="username" required
                    className="w-full bg-[#0f0a1e] border border-violet-800/50 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20 transition-all" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-[0.15em] text-violet-400/70">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-400/50 pointer-events-none" />
                  <input type={showPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="Password" autoComplete="current-password" required
                    className="w-full bg-[#0f0a1e] border border-violet-800/50 rounded-xl pl-10 pr-10 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20 transition-all" />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-violet-400 transition-colors p-0.5">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 bg-red-900/20 border border-red-700/40 rounded-xl px-3 py-2.5 text-xs text-red-300">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}
                </div>
              )}

              <button type="submit" disabled={loading || !username || !password}
                className="w-full h-11 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 transition-all duration-200 mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg, #6d28d9, #7c3aed, #8b5cf6)", boxShadow: loading ? "none" : "0 0 14px rgba(139,92,246,0.4), 0 2px 10px rgba(0,0,0,0.5)" }}>
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Masuk...</> : <>Masuk ke AINA Scraper</>}
              </button>

            </form>
          </div>

          <p className="text-center text-[10px] text-slate-700 mt-5 tracking-wider uppercase">© AINA Internal Tool</p>
        </div>
      </div>

    </div>
  );
}
