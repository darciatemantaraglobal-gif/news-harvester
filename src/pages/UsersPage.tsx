import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { apiUrl } from "@/lib/api";
import { getIsAdmin } from "@/lib/auth";
import {
  ChevronLeft, UserPlus, Trash2, Loader2, CheckCircle2,
  AlertCircle, Eye, EyeOff, Users, ShieldCheck,
} from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { Navigate } from "react-router-dom";

interface UserEntry { username: string }

export default function UsersPage() {
  if (!getIsAdmin()) return <Navigate to="/" replace />;

  const [users, setUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/users"));
      if (res.ok) setUsers(await res.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) return;
    setAdding(true);
    try {
      const res = await fetch(apiUrl("/api/users"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername.trim(), password: newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        flash(true, `Akun "${newUsername.trim()}" berhasil dibuat.`);
        setNewUsername("");
        setNewPassword("");
        fetchUsers();
      } else {
        flash(false, data.error || "Gagal membuat akun.");
      }
    } catch {
      flash(false, "Tidak dapat terhubung ke server.");
    }
    setAdding(false);
  };

  const deleteUser = async (username: string) => {
    setDeletingId(username);
    try {
      const res = await fetch(apiUrl(`/api/users/${username}`), { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        flash(true, `Akun "${username}" dihapus.`);
        fetchUsers();
      } else {
        flash(false, data.error || "Gagal menghapus.");
      }
    } catch {
      flash(false, "Tidak dapat terhubung ke server.");
    }
    setDeletingId(null);
  };

  return (
    <div className="flex flex-col min-h-screen bg-black text-white relative">

      {/* ── Background ── */}
      <div className="absolute inset-0 pointer-events-none select-none">
        <img src="/bg-home.jpg" alt="" className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: 0.22, objectPosition: "center 82%", transform: "scale(1.38)", transformOrigin: "center bottom" }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 70% at 55% 40%, rgba(109,40,217,0.22) 0%, transparent 65%)" }} />
        <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "radial-gradient(circle at 1.5px 1.5px, rgba(200,180,255,0.8) 1.5px, transparent 0)", backgroundSize: "32px 32px" }} />
        <div className="absolute top-0 inset-x-0 h-28" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.82) 0%, transparent 100%)" }} />
        <div className="absolute bottom-0 inset-x-0 h-1/2" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.35) 55%, transparent 100%)" }} />
      </div>

      <div className="relative z-10 flex flex-col flex-1">

        {/* ── Header ── */}
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
                  <ShieldCheck className="w-2.5 h-2.5" />Admin
                </span>
              </div>
              <p className="text-violet-300/70 text-[11px]">Buat & hapus akun pengguna</p>
            </div>
          </div>
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 pb-24 max-w-lg mx-auto w-full space-y-4">

          {/* Flash message */}
          {msg && (
            <div className={`flex items-center gap-2 text-xs px-4 py-2.5 rounded-xl border ${
              msg.ok
                ? "text-emerald-300 bg-emerald-900/20 border-emerald-700/30"
                : "text-red-300 bg-red-900/20 border-red-700/30"
            }`}>
              {msg.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
              {msg.text}
            </div>
          )}

          {/* Tambah akun */}
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
                  <input
                    type="text"
                    value={newUsername}
                    onChange={e => setNewUsername(e.target.value)}
                    placeholder="contoh: ahmad"
                    required
                    className="w-full bg-[#0f0a1e] border border-violet-800/50 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20 transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-violet-400/60">Password</label>
                  <div className="relative">
                    <input
                      type={showPw ? "text" : "password"}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="Password untuk akun ini"
                      required
                      className="w-full bg-[#0f0a1e] border border-violet-800/50 rounded-xl px-3.5 pr-10 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20 transition-all"
                    />
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

          {/* Daftar akun */}
          <div className="bg-[#0d0720] rounded-2xl border border-violet-700/40 overflow-hidden"
            style={{ boxShadow: "0 0 24px rgba(109,40,217,0.14)" }}>
            <div className="h-[3px] bg-gradient-to-r from-indigo-500 via-violet-400 to-indigo-500" />
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-md bg-indigo-900/50 flex items-center justify-center">
                  <Users className="w-3 h-3 text-indigo-400" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-400/80">Daftar Pengguna</span>
              </div>

              {/* Admin row (fixed) */}
              <div className="flex items-center gap-3 bg-violet-900/20 border border-violet-700/40 rounded-xl px-3.5 py-2.5">
                <div className="w-8 h-8 rounded-full bg-violet-800/60 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-4 h-4 text-violet-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">admin</p>
                  <p className="text-[10px] text-violet-400/60">Administrator · dari env var</p>
                </div>
                <span className="text-[9px] font-bold uppercase tracking-wider bg-violet-800/40 text-violet-300 px-2 py-0.5 rounded-full">Admin</span>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-6 text-slate-500 gap-2 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />Memuat...
                </div>
              ) : users.length === 0 ? (
                <div className="text-center py-6 text-slate-600 text-xs">
                  Belum ada pengguna lain. Tambahkan di atas.
                </div>
              ) : (
                <div className="space-y-2">
                  {users.map(u => (
                    <div key={u.username} className="flex items-center gap-3 bg-white/3 border border-violet-800/30 rounded-xl px-3.5 py-2.5">
                      <div className="w-8 h-8 rounded-full bg-slate-800/60 flex items-center justify-center shrink-0 text-sm font-bold text-slate-400 uppercase">
                        {u.username[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white">{u.username}</p>
                        <p className="text-[10px] text-slate-500">Pengguna biasa</p>
                      </div>
                      <button
                        onClick={() => deleteUser(u.username)}
                        disabled={deletingId === u.username}
                        className="text-slate-600 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-red-900/20 disabled:opacity-50"
                        title="Hapus akun">
                        {deletingId === u.username
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      <BottomNav active="home" />
    </div>
  );
}
