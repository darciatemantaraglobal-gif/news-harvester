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
      });
      const data = await res.json();
      if (res.ok && data.token) {
        setToken(data.token);
        setIsAdmin(!!data.is_admin);
        saveUsername(data.username || "");
        navigate("/", { replace: true });
      } else {
        setError(data.error || "Login gagal.");
      }
    } catch {
      setError("Tidak dapat terhubung ke server.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center relative overflow-hidden px-4">

      {/* ── Background ── */}
      <div className="absolute inset-0 pointer-events-none select-none">
        <img src="/bg-home.jpg" alt="" className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: 0.28, objectPosition: "center 82%", transform: "scale(1.38)", transformOrigin: "center bottom" }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 70% at 50% 40%, rgba(109,40,217,0.30) 0%, transparent 65%)" }} />
        <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "radial-gradient(circle at 1.5px 1.5px, rgba(200,180,255,0.8) 1.5px, transparent 0)", backgroundSize: "32px 32px" }} />
        <div className="absolute top-0 inset-x-0 h-1/3" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%)" }} />
        <div className="absolute bottom-0 inset-x-0 h-1/3" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)" }} />
      </div>

      {/* ── Card ── */}
      <div className="relative z-10 w-full max-w-sm">

        {/* Logo + title */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-4">
            <div className="absolute inset-0 scale-[3] bg-violet-500/20 rounded-full blur-2xl pointer-events-none" />
            <img src="/AIGYPT_logo.png" alt="AINA" className="relative w-14 h-14 object-contain"
              style={{ filter: "brightness(0) invert(1) drop-shadow(0 0 14px rgba(200,160,255,1))" }} />
          </div>
          <div className="flex flex-col items-center leading-none"
            style={{ fontFamily: "'Sunspire', cursive", letterSpacing: "0.04em" }}>
            <span style={{
              fontSize: "clamp(2rem, 12vw, 3.2rem)",
              background: "linear-gradient(135deg, #ffffff 0%, #e9d5ff 60%, #c084fc 100%)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1.05,
            }}>AINA</span>
            <span style={{
              fontSize: "clamp(1.6rem, 10vw, 2.6rem)",
              background: "linear-gradient(135deg, #ddd6fe 0%, #a855f7 50%, #7c3aed 100%)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1.05,
            }}>Scraper</span>
          </div>
          <p className="mt-2 text-violet-300/50 text-xs tracking-widest uppercase font-medium">Internal Access Only</p>
        </div>

        {/* Form card */}
        <div className="relative overflow-hidden rounded-2xl"
          style={{ background: "#0d0720", border: "1px solid rgba(139,92,246,0.3)", boxShadow: "0 0 40px rgba(109,40,217,0.22), 0 4px 24px rgba(0,0,0,0.7)" }}>
          <div className="h-[3px] bg-gradient-to-r from-violet-600 via-purple-400 to-violet-600" />
          <form onSubmit={handleSubmit} className="p-6 space-y-4">

            {/* Username */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-[0.15em] text-violet-400/70">Username</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-400/50 pointer-events-none" />
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="Username"
                  autoComplete="username"
                  required
                  className="w-full bg-[#0f0a1e] border border-violet-800/50 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20 transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-[0.15em] text-violet-400/70">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-400/50 pointer-events-none" />
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                  required
                  className="w-full bg-[#0f0a1e] border border-violet-800/50 rounded-xl pl-10 pr-10 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20 transition-all"
                />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-violet-400 transition-colors p-0.5">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 bg-red-900/20 border border-red-700/40 rounded-xl px-3 py-2.5 text-xs text-red-300">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full h-11 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 transition-all duration-200 mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: "linear-gradient(135deg, #6d28d9, #7c3aed, #8b5cf6)",
                boxShadow: loading ? "none" : "0 0 14px rgba(139,92,246,0.4), 0 2px 10px rgba(0,0,0,0.5)",
              }}
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Masuk...</> : <>Masuk ke AINA Scraper</>}
            </button>

          </form>
        </div>

        <p className="text-center text-[10px] text-slate-700 mt-5 tracking-wider uppercase">
          © AINA Internal Tool
        </p>
      </div>
    </div>
  );
}
