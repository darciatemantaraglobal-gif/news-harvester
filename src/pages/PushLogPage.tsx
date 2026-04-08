import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Send, Trash2, Loader2, AlertCircle, RefreshCw, User, Clock, FileText, ClipboardPaste, CheckSquare } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { getToken, getIsAdmin } from "@/lib/auth";
import { BottomNav } from "@/components/BottomNav";

interface PushEntry {
  id: string;
  timestamp: string;
  username: string;
  source: string;
  count: number;
  skipped: number;
  titles: string[];
}

function sourceLabel(s: string) {
  if (s === "paste") return { label: "Paste", color: "#818cf8", bg: "rgba(99,102,241,0.15)", border: "rgba(99,102,241,0.35)", icon: <ClipboardPaste className="w-3 h-3" /> };
  if (s === "review-approved") return { label: "Review Approved", color: "#34d399", bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.3)", icon: <CheckSquare className="w-3 h-3" /> };
  return { label: "Review All", color: "#a78bfa", bg: "rgba(139,92,246,0.15)", border: "rgba(139,92,246,0.35)", icon: <Send className="w-3 h-3" /> };
}

function fmtTime(ts: string) {
  try {
    const d = new Date(ts);
    return d.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return ts; }
}

export default function PushLogPage() {
  const navigate = useNavigate();
  const isAdmin = getIsAdmin();
  const [log, setLog] = useState<PushEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");
  const [dataSource, setDataSource] = useState<"supabase" | "local" | null>(null);

  const fetchLog = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/api/push-log"), {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal memuat laporan.");
      const entries = (data.log || []).map((e: PushEntry) => ({ ...e, skipped: e.skipped ?? 0 }));
      setLog(entries);
      setTotal(data.total || 0);
      setDataSource(data.source || "local");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan.");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    if (!confirm("Hapus seluruh riwayat push? Tindakan ini tidak bisa dibatalkan.")) return;
    setClearing(true);
    try {
      await fetch(apiUrl("/api/push-log/clear"), {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      setLog([]);
      setTotal(0);
    } finally {
      setClearing(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) { navigate("/"); return; }
    fetchLog();
  }, [isAdmin, navigate]);

  const totalInserted = log.reduce((s, e) => s + e.count, 0);
  const uniqueUsers = [...new Set(log.map(e => e.username))];

  return (
    <div className="bg-black relative overflow-hidden flex flex-col" style={{ minHeight: "100dvh" }}>
      <div className="absolute inset-0 pointer-events-none select-none">
        <img src="/bg-home.jpg" alt="" className="absolute inset-0 w-full h-full object-cover sm:hidden" style={{ opacity: 0.15 }} />
        <img src="/bg-desktop.jpg" alt="" className="absolute inset-0 w-full h-full object-cover hidden sm:block" style={{ opacity: 0.15 }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 70% 50% at 50% 25%, rgba(109,40,217,0.2) 0%, transparent 70%)" }} />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center gap-3 px-4 sm:px-8 pt-4 pb-3 shrink-0 border-b border-violet-900/30">
        <button onClick={() => navigate("/")}
          className="flex items-center justify-center w-8 h-8 rounded-xl text-violet-400 hover:text-violet-200 hover:bg-violet-900/30 transition-all">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="font-bold text-white text-sm sm:text-base leading-tight">Laporan Push Supabase</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-violet-400/60 text-[10px] sm:text-xs">Riwayat siapa yang mengirim ke Supabase</p>
            {dataSource && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide"
                style={dataSource === "supabase"
                  ? { background: "rgba(16,185,129,0.15)", color: "#34d399", border: "1px solid rgba(16,185,129,0.3)" }
                  : { background: "rgba(251,191,36,0.12)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.25)" }}>
                {dataSource === "supabase" ? "☁ Supabase" : "⚠ Lokal"}
              </span>
            )}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={fetchLog} disabled={loading}
            className="flex items-center justify-center w-8 h-8 rounded-xl text-violet-400 hover:text-violet-200 hover:bg-violet-900/30 transition-all disabled:opacity-40">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          {log.length > 0 && (
            <button onClick={handleClear} disabled={clearing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-semibold text-red-400 hover:text-red-200 bg-red-900/20 hover:bg-red-900/30 border border-red-800/30 transition-all disabled:opacity-40">
              {clearing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              Hapus Log
            </button>
          )}
        </div>
      </header>

      <main className="relative z-10 flex-1 flex flex-col gap-4 p-4 sm:p-6 pb-24 sm:pb-6 overflow-y-auto">

        {/* Summary stats */}
        {!loading && log.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total Push", value: total, color: "text-violet-300" },
              { label: "Artikel Terkirim", value: totalInserted, color: "text-emerald-300" },
              { label: "Pengguna Aktif", value: uniqueUsers.length, color: "text-indigo-300" },
            ].map(({ label, value, color }) => (
              <div key={label} className="relative overflow-hidden rounded-xl" style={{ background: "#0d0720", border: "1px solid rgba(139,92,246,0.2)" }}>
                <div className="p-3 text-center">
                  <p className={`text-xl sm:text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-wide">{label}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Info: tabel push_logs belum dibuat di Supabase */}
        {!loading && dataSource === "local" && (
          <div className="flex items-start gap-3 px-3.5 py-3 rounded-xl border"
            style={{ background: "rgba(251,191,36,0.07)", borderColor: "rgba(251,191,36,0.25)" }}>
            <span className="text-amber-400 text-base shrink-0">⚠</span>
            <div>
              <p className="text-[11px] font-semibold text-amber-300">Log tersimpan lokal — tidak permanen di production</p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Buat tabel <code className="text-amber-400">push_logs</code> di Supabase agar log tersimpan permanen.
                Jalankan SQL ini di Supabase SQL Editor:
              </p>
              <pre className="text-[9px] text-slate-300 bg-black/40 rounded-lg px-2.5 py-2 mt-1.5 overflow-x-auto">
{`create table push_logs (
  id text primary key,
  timestamp text,
  username text,
  source text,
  count int default 0,
  skipped int default 0,
  titles jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);`}
              </pre>
            </div>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center gap-3 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
            <span className="text-sm">Memuat laporan...</span>
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-red-900/20 border border-red-800/30">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        ) : log.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-600 py-20">
            <Send className="w-10 h-10 text-slate-800" strokeWidth={1.2} />
            <p className="text-sm font-medium">Belum ada riwayat push</p>
            <p className="text-xs">Push log akan muncul setelah ada yang mengirim ke Supabase</p>
          </div>
        ) : (
          <div className="space-y-3">
            {log.map((entry) => {
              const src = sourceLabel(entry.source);
              return (
                <div key={entry.id} className="relative overflow-hidden rounded-xl"
                  style={{ background: "#0d0720", border: "1px solid rgba(139,92,246,0.18)" }}>
                  <div className="p-3 sm:p-4">
                    {/* Row 1: user + source + count */}
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-900/40 border border-violet-700/40">
                        <User className="w-3 h-3 text-violet-300" />
                        <span className="text-xs font-bold text-violet-200">{entry.username}</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
                        style={{ background: src.bg, border: `1px solid ${src.border}`, color: src.color }}>
                        {src.icon}
                        {src.label}
                      </div>
                      <div className="flex items-center gap-2 ml-auto">
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-bold text-emerald-400">{entry.count}</span>
                          <span className="text-[10px] text-slate-500">baru</span>
                        </div>
                        {entry.skipped > 0 && (
                          <div className="flex items-center gap-1">
                            <span className="text-xs font-bold text-amber-400">{entry.skipped}</span>
                            <span className="text-[10px] text-slate-500">skip</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Row 2: timestamp */}
                    <div className="flex items-center gap-1.5 mb-2">
                      <Clock className="w-3 h-3 text-slate-600 shrink-0" />
                      <span className="text-[11px] text-slate-500">{fmtTime(entry.timestamp)}</span>
                    </div>

                    {/* Row 3: titles */}
                    {entry.titles && entry.titles.length > 0 && (
                      <div className="space-y-1">
                        {entry.titles.slice(0, 3).map((t, i) => (
                          <div key={i} className="flex items-start gap-1.5">
                            <FileText className="w-3 h-3 text-slate-700 shrink-0 mt-0.5" />
                            <span className="text-[11px] text-slate-400 leading-snug line-clamp-1">{t}</span>
                          </div>
                        ))}
                        {entry.titles.length > 3 && (
                          <span className="text-[10px] text-slate-600 ml-4">+{entry.titles.length - 3} artikel lainnya</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <BottomNav active="home" />
    </div>
  );
}
