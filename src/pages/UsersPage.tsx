import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { apiUrl } from "@/lib/api";
import { getIsAdmin, getToken } from "@/lib/auth";
import {
  ChevronLeft, UserPlus, Trash2, Loader2, CheckCircle2,
  AlertCircle, Eye, EyeOff, Users, ShieldCheck, RefreshCw,
  Clock, Wifi, WifiOff, Activity, Send, KeyRound, X,
} from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { Navigate } from "react-router-dom";

interface UserActivity {
  username: string;
  is_admin: boolean;
  last_login: string | null;
  last_seen: string | null;
  status: "online" | "away" | "offline";
  push_count: number;
  push_articles: number;
  last_push: string | null;
  last_source: string | null;
}

function fmtAgo(iso: string | null): string {
  if (!iso) return "Belum pernah";
  try {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return `${diff}d yang lalu`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m yang lalu`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}j yang lalu`;
    return `${Math.floor(diff / 86400)}hr yang lalu`;
  } catch { return iso.slice(0, 16).replace("T", " "); }
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso.slice(0, 16).replace("T", " "); }
}

const STATUS_DOT: Record<string, { dot: string; label: string; text: string }> = {
  online: { dot: "bg-emerald-400", label: "Online", text: "text-emerald-400" },
  away:   { dot: "bg-amber-400",   label: "Away",   text: "text-amber-400" },
  offline:{ dot: "bg-slate-600",   label: "Offline", text: "text-slate-500" },
};

const SOURCE_LABEL: Record<string, string> = {
  paste: "Paste",
  "review-all": "Review All",
  "review-approved": "Review Approved",
};

export default function UsersPage() {
  if (!getIsAdmin()) return <Navigate to="/" replace />;

  const [activity, setActivity] = useState<UserActivity[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [showResetPw, setShowResetPw] = useState(false);
  const [resetting, setResetting] = useState(false);

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const fetchActivity = useCallback(async () => {
    setLoadingActivity(true);
    try {
      const res = await fetch(apiUrl("/api/users/activity"), {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) setActivity(await res.json());
    } catch {}
    setLoadingActivity(false);
  }, []);

  useEffect(() => {
    fetchActivity();
    const interval = setInterval(fetchActivity, 30000);
    return () => clearInterval(interval);
  }, [fetchActivity]);

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) return;
    setAdding(true);
    try {
      const res = await fetch(apiUrl("/api/users"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ username: newUsername.trim(), password: newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        flash(true, `Akun "${newUsername.trim()}" berhasil dibuat.`);
        setNewUsername(""); setNewPassword("");
        fetchActivity();
      } else {
        flash(false, data.error || "Gagal membuat akun.");
      }
    } catch { flash(false, "Tidak dapat terhubung ke server."); }
    setAdding(false);
  };

  const deleteUser = async (username: string) => {
    if (!confirm(`Hapus akun "${username}"? Tindakan ini tidak bisa dibatalkan.`)) return;
    setDeletingId(username);
    try {
      const res = await fetch(apiUrl(`/api/users/${username}`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (res.ok) { flash(true, `Akun "${username}" dihapus.`); fetchActivity(); }
      else flash(false, data.error || "Gagal menghapus.");
    } catch { flash(false, "Tidak dapat terhubung ke server."); }
    setDeletingId(null);
  };

  const doResetPassword = async () => {
    if (!resetTarget || !resetPw.trim()) return;
    setResetting(true);
    try {
      const res = await fetch(apiUrl(`/api/users/${resetTarget}/reset-password`), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ password: resetPw }),
      });
      const data = await res.json();
      if (res.ok) {
        flash(true, `Password "${resetTarget}" berhasil direset.`);
        setResetTarget(null); setResetPw("");
      } else flash(false, data.error || "Gagal reset password.");
    } catch { flash(false, "Tidak dapat terhubung ke server."); }
    setResetting(false);
  };

  const onlineCount = activity.filter(a => a.status === "online").length;
  const awayCount = activity.filter(a => a.status === "away").length;

  return (
    <div className="flex flex-col bg-black text-white relative sm:overflow-hidden" style={{ minHeight: "100dvh" }}>

      <div className="absolute inset-0 pointer-events-none select-none">
        <img src="/bg-home.jpg" alt="" className="absolute inset-0 w-full h-full object-cover sm:hidden" style={{ opacity: 0.22, objectPosition: "center 82%", transform: "scale(1.38)", transformOrigin: "center bottom" }} />
        <img src="/bg-desktop.jpg" alt="" className="absolute inset-0 w-full h-full object-cover hidden sm:block" style={{ opacity: 0.22 }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 70% at 55% 40%, rgba(109,40,217,0.22) 0%, transparent 65%)" }} />
        <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "radial-gradient(circle at 1.5px 1.5px, rgba(200,180,255,0.8) 1.5px, transparent 0)", backgroundSize: "32px 32px" }} />
        <div className="absolute top-0 inset-x-0 h-28" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.82) 0%, transparent 100%)" }} />
        <div className="absolute bottom-0 inset-x-0 h-1/2" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.35) 55%, transparent 100%)" }} />
      </div>

      <div className="relative z-10 flex flex-col flex-1">

        {/* Header */}
        <div className="mx-2 sm:mx-4 lg:mx-6 mt-2 sm:mt-4 rounded-xl sm:rounded-2xl px-3 sm:px-5 py-3 sm:py-4 flex items-center justify-between shrink-0"
          style={{ background: "linear-gradient(135deg, #1a0535 0%, #2f0c60 40%, #4a1890 100%)", border: "1px solid rgba(139,92,246,0.3)", boxShadow: "0 0 40px rgba(109,40,217,0.22), 0 4px 20px rgba(0,0,0,0.6)" }}>
          <div className="flex items-center gap-2 min-w-0">
            <Link to="/">
              <button className="gap-1 text-white/70 hover:text-white hover:bg-white/15 h-8 px-2 text-xs rounded-lg flex items-center transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" /><span className="hidden sm:inline">Beranda</span>
              </button>
            </Link>
            <div className="min-w-0 leading-none">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="font-bold text-white text-base lg:text-xl tracking-tight">Kelola Akun</p>
                <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full shrink-0"
                  style={{ background: "rgba(139,92,246,0.25)", border: "1px solid rgba(167,139,250,0.4)", color: "rgba(196,181,253,0.9)" }}>
                  <ShieldCheck className="w-2.5 h-2.5" />Master Admin
                </span>
              </div>
              <p className="text-violet-300/70 text-[11px]">Buat, monitor, & kelola akun pengguna</p>
            </div>
          </div>
          <button onClick={fetchActivity} disabled={loadingActivity}
            className="flex items-center justify-center w-8 h-8 rounded-xl text-violet-400 hover:text-violet-200 hover:bg-violet-900/30 transition-all disabled:opacity-40">
            <RefreshCw className={`w-4 h-4 ${loadingActivity ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 pb-nav-safe sm:pb-6 max-w-2xl mx-auto w-full space-y-4">

          {/* Flash */}
          {msg && (
            <div className={`flex items-center gap-2 text-xs px-4 py-2.5 rounded-xl border ${msg.ok ? "text-emerald-300 bg-emerald-900/20 border-emerald-700/30" : "text-red-300 bg-red-900/20 border-red-700/30"}`}>
              {msg.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
              {msg.text}
            </div>
          )}

          {/* ── MONITOR SECTION ── */}
          <div className="bg-[#0d0720] rounded-2xl border border-violet-700/40 overflow-hidden"
            style={{ boxShadow: "0 0 24px rgba(109,40,217,0.14)" }}>
            <div className="h-[3px] bg-gradient-to-r from-emerald-500 via-violet-400 to-emerald-500" />
            <div className="p-4 space-y-3">

              {/* Section header + summary */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-md bg-emerald-900/50 flex items-center justify-center">
                    <Activity className="w-3 h-3 text-emerald-400" />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-400/80">Monitor Pengguna</span>
                </div>
                <div className="flex items-center gap-2">
                  {onlineCount > 0 && (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {onlineCount} online
                    </span>
                  )}
                  {awayCount > 0 && (
                    <span className="flex items-center gap-1 text-[10px] text-amber-400 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      {awayCount} away
                    </span>
                  )}
                </div>
              </div>

              {loadingActivity ? (
                <div className="flex items-center justify-center py-6 text-slate-500 gap-2 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />Memuat data...
                </div>
              ) : activity.length === 0 ? (
                <div className="text-center py-6 text-slate-600 text-xs">Tidak ada data pengguna.</div>
              ) : (
                <div className="space-y-2">
                  {activity.map(u => {
                    const sd = STATUS_DOT[u.status] ?? STATUS_DOT.offline;
                    return (
                      <div key={u.username} className="rounded-xl overflow-hidden"
                        style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(139,92,246,0.18)" }}>

                        {/* Row 1: avatar + name + status + actions */}
                        <div className="flex items-center gap-3 px-3.5 pt-3 pb-2">
                          <div className="relative shrink-0">
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold uppercase ${u.is_admin ? "bg-violet-800/60 text-violet-300" : "bg-slate-800/60 text-slate-400"}`}>
                              {u.username[0]}
                            </div>
                            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0d0720] ${sd.dot}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-bold text-white">{u.username}</p>
                              {u.is_admin && (
                                <span className="text-[9px] font-black uppercase tracking-wider text-violet-300 bg-violet-900/40 border border-violet-700/40 px-1.5 py-px rounded-full flex items-center gap-1">
                                  <ShieldCheck className="w-2.5 h-2.5" />Admin
                                </span>
                              )}
                            </div>
                            <p className={`text-[10px] font-semibold ${sd.text}`}>
                              {u.status === "online" ? <span className="flex items-center gap-1"><Wifi className="w-3 h-3" />Online sekarang</span>
                                : u.status === "away" ? <span className="flex items-center gap-1"><Wifi className="w-3 h-3" />Aktif {fmtAgo(u.last_seen)}</span>
                                : <span className="flex items-center gap-1"><WifiOff className="w-3 h-3" />Terakhir {fmtAgo(u.last_seen)}</span>}
                            </p>
                          </div>
                          {/* Actions — only for non-admin users */}
                          {!u.is_admin && (
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button onClick={() => { setResetTarget(u.username); setResetPw(""); setShowResetPw(false); }}
                                title="Reset Password"
                                className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-600 hover:text-amber-400 hover:bg-amber-900/20 transition-all border border-transparent hover:border-amber-700/40">
                                <KeyRound className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => deleteUser(u.username)} disabled={deletingId === u.username}
                                title="Hapus Akun"
                                className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-900/20 transition-all border border-transparent hover:border-red-700/40 disabled:opacity-40">
                                {deletingId === u.username ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Row 2: stats grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-violet-900/10 border-t border-violet-900/20">
                          {[
                            { label: "Login Terakhir", value: fmtAgo(u.last_login), sub: fmtDateTime(u.last_login), icon: <Clock className="w-2.5 h-2.5" /> },
                            { label: "Aktif Terakhir", value: fmtAgo(u.last_seen), sub: fmtDateTime(u.last_seen), icon: <Activity className="w-2.5 h-2.5" /> },
                            { label: "Total Push", value: u.push_count > 0 ? `${u.push_count}x` : "—", sub: u.push_articles > 0 ? `${u.push_articles} artikel` : "Belum pernah push", icon: <Send className="w-2.5 h-2.5" /> },
                            { label: "Push Terakhir", value: fmtAgo(u.last_push), sub: u.last_source ? SOURCE_LABEL[u.last_source] || u.last_source : "—", icon: <Send className="w-2.5 h-2.5" /> },
                          ].map(({ label, value, sub, icon }) => (
                            <div key={label} className="px-2.5 py-2" style={{ background: "rgba(0,0,0,0.3)" }}>
                              <div className="flex items-center gap-1 text-slate-600 mb-0.5">{icon}<span className="text-[9px] uppercase tracking-wide">{label}</span></div>
                              <p className="text-xs font-bold text-slate-300">{value}</p>
                              <p className="text-[10px] text-slate-600 truncate">{sub}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── TAMBAH AKUN ── */}
          <div className="relative overflow-hidden rounded-2xl" style={{ background: "#0d0720" }}>
            <div className="absolute animate-border-beam pointer-events-none" style={{ inset: "-50%", width: "200%", height: "200%", background: "conic-gradient(transparent 260deg, rgba(139,92,246,0.6) 300deg, rgba(196,181,253,1) 345deg, transparent 360deg)" }} />
            <div className="relative m-px rounded-[15px]" style={{ background: "#0d0720" }}>
              <div className="h-[3px] bg-gradient-to-r from-violet-600 via-purple-400 to-violet-600" />
              <form onSubmit={addUser} className="p-4 sm:p-5 space-y-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-5 h-5 rounded-md bg-violet-900/50 flex items-center justify-center shrink-0">
                    <UserPlus className="w-3 h-3 text-violet-400" />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-400/80">Tambah Pengguna Baru</span>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-violet-400/60">Username</label>
                  <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)}
                    placeholder="contoh: ahmad" required
                    className="w-full bg-[#0f0a1e] border border-violet-800/50 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20 transition-all" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-violet-400/60">Password</label>
                  <div className="relative">
                    <input type={showPw ? "text" : "password"} value={newPassword} onChange={e => setNewPassword(e.target.value)}
                      placeholder="Password untuk akun ini" required
                      className="w-full bg-[#0f0a1e] border border-violet-800/50 rounded-xl px-3.5 pr-10 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20 transition-all" />
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-violet-400 transition-colors">
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={adding || !newUsername.trim() || !newPassword.trim()}
                  className="w-full h-10 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: "linear-gradient(135deg, #6d28d9, #7c3aed, #8b5cf6)", boxShadow: "0 0 10px rgba(139,92,246,0.35)" }}>
                  {adding ? <><Loader2 className="w-4 h-4 animate-spin" />Membuat akun...</> : <><UserPlus className="w-4 h-4" />Buat Akun</>}
                </button>
              </form>
            </div>
          </div>

          {/* Summary bar */}
          {!loadingActivity && activity.length > 0 && (
            <div className="flex items-center justify-center gap-4 py-1">
              <span className="text-[10px] text-slate-600 flex items-center gap-1.5">
                <Users className="w-3 h-3" />{activity.length} pengguna terdaftar
              </span>
            </div>
          )}

        </div>
      </div>

      {/* ── Reset Password Modal ── */}
      {resetTarget && (
        <>
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" onClick={() => setResetTarget(null)} />
          <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-sm mx-auto rounded-2xl p-5 space-y-4"
            style={{ background: "#0d0720", border: "1px solid rgba(251,191,36,0.3)", boxShadow: "0 0 40px rgba(0,0,0,0.8)" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-900/40 flex items-center justify-center">
                  <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">Reset Password</p>
                  <p className="text-[10px] text-slate-500">Akun: <span className="text-amber-400 font-bold">{resetTarget}</span></p>
                </div>
              </div>
              <button onClick={() => setResetTarget(null)} className="text-slate-600 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-amber-400/70">Password Baru</label>
              <div className="relative">
                <input type={showResetPw ? "text" : "password"} value={resetPw} onChange={e => setResetPw(e.target.value)}
                  placeholder="Minimal 6 karakter"
                  className="w-full bg-[#0f0a1e] border border-amber-800/50 rounded-xl px-3.5 pr-10 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-amber-500/70 focus:ring-2 focus:ring-amber-500/20 transition-all" />
                <button type="button" onClick={() => setShowResetPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-amber-400 transition-colors">
                  {showResetPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setResetTarget(null)}
                className="flex-1 h-9 rounded-xl text-xs font-bold text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-all">
                Batal
              </button>
              <button onClick={doResetPassword} disabled={resetting || !resetPw.trim()}
                className="flex-1 h-9 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #92400e, #d97706)" }}>
                {resetting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                Reset Password
              </button>
            </div>
          </div>
        </>
      )}

      <BottomNav active="home" />
    </div>
  );
}
