import { useState, useEffect, useCallback } from "react";
import { apiUrl } from "@/lib/api";
import { Link } from "react-router-dom";
import {
  Newspaper, CheckCircle2, XCircle, Clock, Eye, Send, Download,
  Loader2, ChevronLeft, RefreshCw, FileJson, CheckSquare,
  AlertCircle, Filter, BarChart3, FileText, Upload, X, ChevronDown,
} from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

type ApprovalStatus = "pending" | "reviewed" | "approved" | "rejected" | "exported";

interface KbDraft {
  id: string;
  title: string;
  slug: string;
  source_url: string;
  published_date: string;
  content: string;
  summary: string;
  tags: string[];
  scrape_status: string;
  approval_status: ApprovalStatus;
  last_updated: string;
  notes: string;
}

interface KbStats {
  total: number;
  pending: number;
  reviewed: number;
  approved: number;
  rejected: number;
  exported: number;
}

const STATUS_CONFIG: Record<ApprovalStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending:  { label: "Pending",  color: "bg-yellow-100 text-yellow-700 border-yellow-200", icon: <Clock className="w-3 h-3" /> },
  reviewed: { label: "Reviewed", color: "bg-blue-900/40 text-blue-300 border-blue-200",       icon: <Eye className="w-3 h-3" /> },
  approved: { label: "Approved", color: "bg-emerald-900/30 text-emerald-400 border-emerald-700/40", icon: <CheckCircle2 className="w-3 h-3" /> },
  rejected: { label: "Rejected", color: "bg-red-900/40 text-red-300 border-red-700/40",           icon: <XCircle className="w-3 h-3" /> },
  exported: { label: "Exported", color: "bg-indigo-900/30 text-indigo-400 border-indigo-700/40",  icon: <Send className="w-3 h-3" /> },
};

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "pending", label: "Pending" },
  { value: "reviewed", label: "Reviewed" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "exported", label: "Exported" },
];

const BULK_ACTIONS: { action: string; label: string; color: string }[] = [
  { action: "mark_reviewed", label: "Reviewed", color: "bg-blue-600 hover:bg-blue-700" },
  { action: "approve",       label: "Approve",  color: "bg-emerald-600 hover:bg-emerald-700" },
  { action: "reject",        label: "Reject",   color: "bg-red-600 hover:bg-red-700" },
  { action: "export",        label: "Export",   color: "bg-indigo-600 hover:bg-indigo-700" },
];

function StatusBadge({ status }: { status: ApprovalStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded border ${cfg.color}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

function formatDate(iso: string) {
  if (!iso) return "—";
  return iso.replace("T", " ").slice(0, 16);
}

export default function ReviewDashboard() {
  const [articles, setArticles] = useState<KbDraft[]>([]);
  const [stats, setStats] = useState<KbStats>({ total: 0, pending: 0, reviewed: 0, approved: 0, rejected: 0, exported: 0 });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushResult, setPushResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    try {
      const url = statusFilter === "all" ? apiUrl("/kb-drafts") : apiUrl(`/kb-drafts?status=${statusFilter}`);
      const res = await fetch(url);
      if (res.ok) {
        const data: KbDraft[] = await res.json();
        setArticles(data);
        const nm: Record<string, string> = {};
        data.forEach(a => { nm[a.id] = a.notes || ""; });
        setNotesMap(nm);
      }
    } catch {}
    setLoading(false);
  }, [statusFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/kb/stats"));
      if (res.ok) setStats(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchArticles();
    fetchStats();
    setSelected(new Set());
  }, [statusFilter]);

  const updateStatus = async (id: string, status: ApprovalStatus, notes?: string) => {
    setSavingId(id);
    try {
      const body: Record<string, string> = { id, status };
      if (notes !== undefined) body.notes = notes;
      const res = await fetch(apiUrl("/kb/update-status"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setArticles(prev => prev.map(a => a.id === id ? { ...a, ...data.article } : a));
        fetchStats();
      }
    } catch {}
    setSavingId(null);
  };

  const saveNotes = async (id: string) => {
    const notes = notesMap[id] ?? "";
    const article = articles.find(a => a.id === id);
    if (!article || notes === (article.notes || "")) return;
    setSavingId(id);
    try {
      await fetch(apiUrl("/kb/update-status"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: article.approval_status, notes }),
      });
      setArticles(prev => prev.map(a => a.id === id ? { ...a, notes } : a));
    } catch {}
    setSavingId(null);
  };

  const doBulkAction = async (action: string) => {
    if (selected.size === 0) return;
    setBulkLoading(true);
    setBulkMsg("");
    try {
      const res = await fetch(apiUrl("/kb/bulk-action"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), action }),
      });
      const data = await res.json();
      if (res.ok) {
        setBulkMsg(`${data.updated} artikel diubah ke "${data.new_status}"`);
        setSelected(new Set());
        await fetchArticles();
        await fetchStats();
        setTimeout(() => setBulkMsg(""), 4000);
      }
    } catch {}
    setBulkLoading(false);
  };

  const doPushApproved = async () => {
    setPushLoading(true);
    setPushResult(null);
    try {
      const res = await fetch(apiUrl("/api/push-approved"), { method: "POST" });
      const data = await res.json();
      if (res.ok && data.status === "ok") {
        setPushResult({ ok: true, msg: `${data.inserted} artikel berhasil di-push ke Supabase. ${data.skipped ? `${data.skipped} dilewati.` : ""}` });
        await fetchArticles();
        await fetchStats();
      } else {
        setPushResult({ ok: false, msg: data.error || "Push gagal." });
      }
    } catch {
      setPushResult({ ok: false, msg: "Gagal terhubung ke backend." });
    }
    setPushLoading(false);
    setTimeout(() => setPushResult(null), 6000);
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === articles.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(articles.map(a => a.id)));
    }
  };

  const allSelected = articles.length > 0 && selected.size === articles.length;
  const someSelected = selected.size > 0 && selected.size < articles.length;

  return (
    <div className="flex overflow-hidden bg-black text-white relative" style={{ height: '100dvh' }}>

      {/* ── Background ── */}
      <div className="absolute inset-0 pointer-events-none select-none">
        <img src="/bg-home.jpg" alt="" className="absolute inset-0 w-full h-full object-cover sm:hidden"
          style={{ opacity: 0.22, objectPosition: "center 82%", transform: "scale(1.38)", transformOrigin: "center bottom" }} />
        <img src="/bg-desktop.jpg" alt="" className="absolute inset-0 w-full h-full object-cover hidden sm:block"
          style={{ opacity: 0.22 }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 70% at 55% 40%, rgba(109,40,217,0.22) 0%, transparent 65%)" }} />
        <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "radial-gradient(circle at 1.5px 1.5px, rgba(200,180,255,0.8) 1.5px, transparent 0)", backgroundSize: "32px 32px" }} />
        <div className="absolute top-0 inset-x-0 h-28" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.82) 0%, transparent 100%)" }} />
        <div className="absolute bottom-0 inset-x-0 h-1/2" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.35) 55%, transparent 100%)" }} />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0 relative z-10">

        {/* ─── Header ─── */}
        <div className="mx-2 sm:mx-4 lg:mx-6 mt-2 sm:mt-4 lg:mt-5 rounded-xl sm:rounded-2xl px-3 sm:px-5 lg:px-8 py-3 sm:py-4 lg:py-5 flex items-center justify-between shrink-0"
          style={{ background: "linear-gradient(135deg, #1a0535 0%, #2f0c60 40%, #4a1890 100%)", border: "1px solid rgba(139,92,246,0.3)", boxShadow: "0 0 40px rgba(109,40,217,0.22), 0 4px 20px rgba(0,0,0,0.6)" }}>
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-1 text-white/70 hover:text-white hover:bg-white/15 -ml-1 h-8 px-2 lg:px-3 text-xs">
                <ChevronLeft className="w-3.5 h-3.5" /><span className="hidden sm:inline">Beranda</span>
              </Button>
            </Link>
            <div className="min-w-0 leading-none">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="font-bold text-white text-base lg:text-xl tracking-tight">KB Review</p>
                <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full shrink-0"
                  style={{ background: "rgba(139,92,246,0.25)", border: "1px solid rgba(167,139,250,0.4)", color: "rgba(196,181,253,0.9)" }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />AINA
                </span>
              </div>
              <p className="text-violet-300/70 text-[11px] lg:text-[13px]">Approval Workflow · Knowledge Base</p>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            {stats.approved > 0 && (
              <Button variant="ghost" size="sm" onClick={doPushApproved} disabled={pushLoading}
                className="gap-1.5 text-emerald-300 hover:text-emerald-200 hover:bg-emerald-900/30 h-8 px-2 sm:px-3 text-xs rounded-full border border-emerald-500/30">
                {pushLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline text-xs">Push Supabase</span>
              </Button>
            )}
            <a href={apiUrl("/export/kb-approved")} download>
              <Button variant="ghost" size="sm"
                className="gap-1 text-white/60 hover:text-white hover:bg-white/10 h-8 px-2 sm:px-3 text-xs rounded-full">
                <Download className="w-3.5 h-3.5" /><span className="hidden sm:inline text-xs">Approved</span>
              </Button>
            </a>
            <Button variant="ghost" size="sm" onClick={() => { fetchArticles(); fetchStats(); }}
              className="h-8 w-8 p-0 text-white/60 hover:text-white hover:bg-white/10 rounded-full shrink-0">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* ─── Scrollable Content ─── */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6 pb-24 min-w-0">
        <div className="max-w-screen-xl mx-auto space-y-3 sm:space-y-4 lg:space-y-5">

          {/* ── Stats: 3-col on mobile, 6-col on sm+ ── */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-2.5">
            {[
              { label: "Total",    value: stats.total,    icon: BarChart3,    numColor: "text-slate-100",   iconBg: "bg-white/10",       iconColor: "text-slate-400",   top: "bg-gradient-to-r from-slate-300 to-slate-400" },
              { label: "Pending",  value: stats.pending,  icon: Clock,        numColor: "text-amber-400",   iconBg: "bg-amber-900/40",   iconColor: "text-amber-500",   top: "bg-gradient-to-r from-amber-400 to-orange-400" },
              { label: "Reviewed", value: stats.reviewed, icon: Eye,          numColor: "text-blue-400",    iconBg: "bg-blue-900/40",    iconColor: "text-blue-400",    top: "bg-gradient-to-r from-blue-400 to-cyan-400" },
              { label: "Approved", value: stats.approved, icon: CheckCircle2, numColor: "text-emerald-400", iconBg: "bg-emerald-900/40", iconColor: "text-emerald-400", top: "bg-gradient-to-r from-emerald-400 to-teal-400" },
              { label: "Rejected", value: stats.rejected, icon: XCircle,      numColor: "text-red-400",     iconBg: "bg-red-900/40",     iconColor: "text-red-400",     top: "bg-gradient-to-r from-red-400 to-rose-500" },
              { label: "Exported", value: stats.exported, icon: Send,         numColor: "text-indigo-400",  iconBg: "bg-indigo-900/40",  iconColor: "text-indigo-400",  top: "bg-gradient-to-r from-indigo-400 to-violet-400" },
            ].map(({ label, value, icon: Icon, numColor, iconBg, iconColor, top }) => (
              <div key={label} className="bg-[#0d0720] rounded-xl sm:rounded-2xl border border-violet-700/40 overflow-hidden cursor-default">
                <div className={`h-[3px] w-full ${top}`} />
                <div className="px-2.5 sm:px-3.5 lg:px-5 py-2.5 sm:py-3 lg:py-4">
                  <div className="flex items-center justify-between mb-1.5 sm:mb-2.5">
                    <p className="text-[8px] sm:text-[9px] lg:text-[11px] text-slate-400 font-bold uppercase tracking-widest leading-none">{label}</p>
                    <div className={`w-5 h-5 sm:w-6 sm:h-6 lg:w-8 lg:h-8 rounded-md lg:rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
                      <Icon className={`w-2.5 h-2.5 sm:w-3 sm:h-3 lg:w-4 lg:h-4 ${iconColor}`} />
                    </div>
                  </div>
                  <p className={`text-2xl sm:text-2xl lg:text-4xl font-extrabold leading-none tabular-nums ${numColor}`}
                    style={value > 0 ? { textShadow: "0 0 16px currentColor, 0 0 6px currentColor" } : {}}>
                    {value}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* ── Filter row ── */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Mobile: select dropdown */}
            <div className="relative sm:hidden flex-1 min-w-0">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-violet-400/60 pointer-events-none" />
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="w-full appearance-none bg-[#0d0720] border border-violet-800/40 text-white text-xs font-semibold rounded-xl pl-8 pr-8 py-2.5 outline-none cursor-pointer focus:border-violet-500/60"
                style={{ colorScheme: "dark" }}
              >
                {STATUS_FILTERS.map(f => (
                  <option key={f.value} value={f.value}>
                    {f.label}{f.value !== "all" ? ` (${stats[f.value as keyof KbStats] ?? 0})` : ""}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-violet-400/60 pointer-events-none" />
            </div>

            {/* sm+: tab bar */}
            <div className="hidden sm:flex items-center gap-0.5 bg-violet-950/40 rounded-xl p-1 border border-violet-700/30 overflow-x-auto max-w-full">
              <Filter className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-0.5 shrink-0" />
              {STATUS_FILTERS.map(f => (
                <button key={f.value}
                  data-testid={`filter-${f.value}`}
                  onClick={() => setStatusFilter(f.value)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all whitespace-nowrap ${
                    statusFilter === f.value
                      ? "bg-violet-600 text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-100 hover:bg-white/10"
                  }`}>
                  {f.label}
                  {f.value !== "all" && (
                    <span className={`ml-1 text-[10px] font-normal ${statusFilter === f.value ? "text-white/70" : "text-slate-400"}`}>
                      {stats[f.value as keyof KbStats] ?? 0}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Bulk action bar — sm+ inline */}
            {selected.size > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 bg-[#1a0d3a] rounded-xl px-3 py-1.5 border border-violet-700/40">
                <span className="text-xs font-semibold text-violet-300 mr-0.5">{selected.size} dipilih</span>
                {BULK_ACTIONS.map(ba => (
                  <Button key={ba.action} data-testid={`bulk-${ba.action}`}
                    size="sm" disabled={bulkLoading}
                    onClick={() => doBulkAction(ba.action)}
                    className={`text-white text-xs py-1 h-7 px-2.5 rounded-full ${ba.color}`}>
                    {bulkLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : ba.label}
                  </Button>
                ))}
                <button onClick={() => setSelected(new Set())}
                  className="text-slate-500 hover:text-white ml-0.5 p-1 rounded-full hover:bg-white/10">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {bulkMsg && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-300 bg-emerald-900/20 border border-emerald-700/30 px-3 py-1.5 rounded-xl">
                <CheckCircle2 className="w-3.5 h-3.5" />{bulkMsg}
              </div>
            )}
          </div>

          {/* ── Article List Card ── */}
          <div className="bg-[#0d0720] rounded-2xl border border-violet-700/40 overflow-hidden"
            style={{ boxShadow: "0 0 24px rgba(109,40,217,0.14)" }}>
            {loading ? (
              <div className="flex items-center justify-center py-20 text-slate-400 gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />Memuat artikel...
              </div>
            ) : articles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3 px-6">
                <div className="w-14 h-14 rounded-2xl bg-white/8 flex items-center justify-center">
                  <FileText className="w-6 h-6 text-slate-500" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-semibold text-slate-400">
                    {statusFilter === "all" ? "Belum ada KB Draft" : `Tidak ada artikel "${statusFilter}"`}
                  </p>
                  {statusFilter === "all" && (
                    <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                      KB Draft dibuat dari hasil scraping. Mulai scraping terlebih dahulu.
                    </p>
                  )}
                </div>
                {statusFilter === "all" && (
                  <div className="flex flex-col gap-1.5 w-full max-w-xs">
                    {[
                      { n: 1, label: "Mulai Scraping — ambil artikel dari URL berita" },
                      { n: 2, label: "Generate Summary — buat ringkasan tiap artikel" },
                      { n: 3, label: "Auto Tag — beri tag topik otomatis" },
                      { n: 4, label: "Convert to KB Draft — konversi ke format KB AINA" },
                    ].map(s => (
                      <div key={s.n} className="flex items-center gap-2.5 bg-violet-950/30 border border-violet-800/40 rounded-xl px-3 py-2">
                        <span className="w-5 h-5 rounded-full bg-violet-900/60 text-violet-300 text-[10px] font-bold flex items-center justify-center shrink-0">{s.n}</span>
                        <span className="text-xs text-slate-500">{s.label}</span>
                      </div>
                    ))}
                  </div>
                )}
                <Link to="/">
                  <Button size="sm" className="mt-1 gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white">
                    <ChevronLeft className="w-3.5 h-3.5" />Ke Beranda
                  </Button>
                </Link>
              </div>
            ) : (
              <>
                {/* ── Mobile: card list ── */}
                <div className="sm:hidden">
                  {/* Select-all bar */}
                  <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-violet-800/40 bg-violet-950/30">
                    <Checkbox
                      checked={allSelected}
                      data-testid="checkbox-select-all"
                      onCheckedChange={toggleSelectAll}
                      className={someSelected ? "data-[state=checked]:bg-slate-400" : ""}
                    />
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      {selected.size > 0 ? `${selected.size} dari ${articles.length} dipilih` : `${articles.length} artikel`}
                    </span>
                  </div>

                  <div className="divide-y divide-white/5">
                    {articles.map((article) => {
                      const isSelected = selected.has(article.id);
                      const isSaving = savingId === article.id;
                      return (
                        <div key={article.id}
                          data-testid={`row-kb-${article.id}`}
                          className={`relative px-3.5 py-3.5 transition-colors ${isSelected ? "bg-violet-900/20" : ""}`}>
                          {isSelected && (
                            <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-violet-500 to-purple-500 rounded-r" />
                          )}

                          <div className="flex items-start gap-3">
                            {/* Checkbox */}
                            <div className="mt-0.5 shrink-0">
                              <Checkbox
                                data-testid={`checkbox-${article.id}`}
                                checked={isSelected}
                                onCheckedChange={() => toggleSelect(article.id)}
                              />
                            </div>

                            <div className="flex-1 min-w-0 space-y-2">
                              {/* Title + slug */}
                              <div className="flex items-start gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="font-semibold text-white text-sm leading-snug line-clamp-2">
                                    {article.title || "(Tanpa Judul)"}
                                  </p>
                                  <p className="font-mono text-[10px] text-indigo-400/80 mt-0.5 truncate">
                                    {article.slug}
                                  </p>
                                </div>
                                <button
                                  onClick={() => setDetailId(article.id)}
                                  title="Lihat Detail"
                                  className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg text-slate-500 hover:text-violet-300 hover:bg-violet-900/30 transition-all border border-transparent hover:border-violet-700/40">
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              {/* Meta row */}
                              <div className="flex flex-wrap items-center gap-2">
                                {article.published_date && (
                                  <span className="text-[10px] text-slate-500">{article.published_date}</span>
                                )}
                                {article.source_url && (
                                  <a href={article.source_url} target="_blank" rel="noopener noreferrer"
                                    className="text-[10px] text-indigo-400 hover:underline">
                                    source ↗
                                  </a>
                                )}
                                {article.scrape_status && (
                                  <span className={`text-[9px] font-mono px-1.5 py-px rounded-md ${
                                    article.scrape_status === "success"
                                      ? "bg-emerald-900/30 text-emerald-400"
                                      : "bg-amber-900/20 text-amber-400"
                                  }`}>{article.scrape_status}</span>
                                )}
                              </div>

                              {/* Partial warning */}
                              {article.scrape_status === "partial" && (
                                <div className="flex items-start gap-1.5 text-[10px] text-amber-300 bg-amber-900/20 border border-amber-700/30 rounded-lg px-2.5 py-2 leading-snug">
                                  <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                                  <span>Konten tidak lengkap saat di-scrape. Verifikasi sebelum approve.</span>
                                </div>
                              )}

                              {/* Status select */}
                              <div className="flex items-center gap-2">
                                <Select
                                  value={article.approval_status}
                                  disabled={isSaving}
                                  onValueChange={(val) => updateStatus(article.id, val as ApprovalStatus)}
                                >
                                  <SelectTrigger data-testid={`status-select-${article.id}`}
                                    className="h-7 text-xs border-0 shadow-none p-0 focus:ring-0 w-auto gap-1">
                                    <SelectValue>
                                      <StatusBadge status={article.approval_status} />
                                    </SelectValue>
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(Object.keys(STATUS_CONFIG) as ApprovalStatus[]).map(s => (
                                      <SelectItem key={s} value={s}>
                                        <StatusBadge status={s} />
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {isSaving && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
                                <span className="text-[10px] text-slate-600 ml-auto">{formatDate(article.last_updated)}</span>
                              </div>

                              {/* Summary */}
                              {article.summary && (
                                <p className="text-[10px] text-slate-500 line-clamp-2 leading-relaxed">
                                  {article.summary}
                                </p>
                              )}

                              {/* Tags */}
                              {(article.tags || []).length > 0 && (
                                <div data-testid={`tags-${article.id}`} className="flex flex-wrap gap-1">
                                  {(article.tags || []).map(t => (
                                    <span key={t} className="text-[9px] bg-indigo-900/30 text-indigo-300 px-1.5 py-px rounded-md font-medium">
                                      {t}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {/* Notes */}
                              <Input
                                data-testid={`notes-${article.id}`}
                                value={notesMap[article.id] ?? ""}
                                onChange={e => setNotesMap(prev => ({ ...prev, [article.id]: e.target.value }))}
                                onBlur={() => saveNotes(article.id)}
                                onKeyDown={e => e.key === "Enter" && saveNotes(article.id)}
                                placeholder="Tambah catatan..."
                                className="h-7 text-xs border-violet-800/40 bg-violet-950/30 text-slate-300 rounded-lg focus-visible:ring-violet-400/40 placeholder:text-slate-600"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ── Desktop: table ── */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-violet-800/40 bg-violet-950/20 text-[11px]">
                        <th className="px-3 sm:px-4 py-3 w-10">
                          <Checkbox
                            checked={allSelected}
                            data-testid="checkbox-select-all"
                            onCheckedChange={toggleSelectAll}
                            className={someSelected ? "data-[state=checked]:bg-slate-400" : ""}
                          />
                        </th>
                        <th className="hidden sm:table-cell text-left px-3 py-3 font-bold text-slate-400 uppercase tracking-widest w-8">#</th>
                        <th className="text-left px-3 py-3 font-bold text-slate-400 uppercase tracking-widest">Artikel</th>
                        <th className="hidden md:table-cell text-left px-3 py-3 font-bold text-slate-400 uppercase tracking-widest w-52">Summary</th>
                        <th className="hidden md:table-cell text-left px-3 py-3 font-bold text-slate-400 uppercase tracking-widest w-36">Tags</th>
                        <th className="text-left px-3 py-3 font-bold text-slate-400 uppercase tracking-widest w-28 sm:w-36">Status</th>
                        <th className="hidden lg:table-cell text-left px-3 py-3 font-bold text-slate-400 uppercase tracking-widest w-32">Updated</th>
                        <th className="hidden sm:table-cell text-left px-3 py-3 font-bold text-slate-400 uppercase tracking-widest w-36">Notes</th>
                        <th className="px-3 py-3 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {articles.map((article, i) => {
                        const isSelected = selected.has(article.id);
                        const isSaving = savingId === article.id;
                        return (
                          <tr key={article.id}
                            data-testid={`row-kb-${article.id}`}
                            className={`border-b border-violet-900/40 align-top transition-colors ${isSelected ? "bg-violet-900/30" : "hover:bg-violet-950/30"}`}>
                            <td className="px-3 sm:px-4 py-3.5 w-10">
                              <Checkbox
                                data-testid={`checkbox-${article.id}`}
                                checked={isSelected}
                                onCheckedChange={() => toggleSelect(article.id)}
                              />
                            </td>
                            <td className="hidden sm:table-cell px-3 py-3.5 text-slate-400 text-xs">{i + 1}</td>
                            <td className="px-3 py-3.5 min-w-0">
                              <p className="font-semibold text-white line-clamp-2 text-xs sm:text-sm leading-snug">
                                {article.title || "(Tanpa Judul)"}
                              </p>
                              <p className="font-mono text-[10px] sm:text-xs text-indigo-400 mt-0.5 truncate max-w-[140px] sm:max-w-xs">
                                {article.slug}
                              </p>
                              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-1">
                                {article.published_date && (
                                  <span className="text-[10px] sm:text-xs text-slate-400">{article.published_date}</span>
                                )}
                                {article.source_url && (
                                  <a href={article.source_url} target="_blank" rel="noopener noreferrer"
                                    className="text-[10px] sm:text-xs text-indigo-400 hover:text-indigo-400 underline truncate max-w-[100px] sm:max-w-[140px]">
                                    source ↗
                                  </a>
                                )}
                                {article.scrape_status && (
                                  <span className={`text-[10px] sm:text-xs font-mono px-1.5 py-px rounded ${
                                    article.scrape_status === "success" ? "bg-emerald-900/30 text-emerald-300" : "bg-yellow-900/20 text-yellow-300"
                                  }`}>{article.scrape_status}</span>
                                )}
                              </div>
                              {article.scrape_status === "partial" && (
                                <div className="mt-1.5 flex items-start gap-1.5 text-[10px] text-amber-300 bg-amber-900/20 border border-amber-700/30 rounded-md px-2 py-1 leading-snug">
                                  <AlertCircle className="w-3 h-3 shrink-0 mt-px" />
                                  <span>Konten artikel ini tidak lengkap. Verifikasi sebelum approve.</span>
                                </div>
                              )}
                              {article.summary && (
                                <p className="md:hidden text-[10px] text-slate-500 mt-1.5 line-clamp-2 leading-relaxed">
                                  {article.summary}
                                </p>
                              )}
                            </td>
                            <td className="hidden md:table-cell px-3 py-3.5 w-52">
                              <p data-testid={`summary-${article.id}`}
                                className="text-xs text-slate-500 line-clamp-4 leading-relaxed">
                                {article.summary || <span className="text-slate-500 italic">Tidak ada summary</span>}
                              </p>
                            </td>
                            <td className="hidden md:table-cell px-3 py-3.5 w-36">
                              <div data-testid={`tags-${article.id}`} className="flex flex-wrap gap-1">
                                {(article.tags || []).map(t => (
                                  <span key={t} className="text-[10px] bg-indigo-900/30 text-indigo-300 px-1.5 py-px rounded-md font-medium">
                                    {t}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="px-3 py-3.5 w-28 sm:w-36">
                              <div className="flex flex-col gap-1.5">
                                <Select
                                  value={article.approval_status}
                                  disabled={isSaving}
                                  onValueChange={(val) => updateStatus(article.id, val as ApprovalStatus)}
                                >
                                  <SelectTrigger data-testid={`status-select-${article.id}`}
                                    className="h-7 text-xs border-0 shadow-none p-0 focus:ring-0 w-auto gap-1">
                                    <SelectValue>
                                      <StatusBadge status={article.approval_status} />
                                    </SelectValue>
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(Object.keys(STATUS_CONFIG) as ApprovalStatus[]).map(s => (
                                      <SelectItem key={s} value={s}>
                                        <StatusBadge status={s} />
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {isSaving && (
                                  <span className="text-xs text-slate-400 flex items-center gap-1">
                                    <Loader2 className="w-3 h-3 animate-spin" />Menyimpan...
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="hidden lg:table-cell px-3 py-3.5 w-32">
                              <span data-testid={`updated-${article.id}`} className="text-xs text-slate-400 whitespace-nowrap">
                                {formatDate(article.last_updated)}
                              </span>
                            </td>
                            <td className="hidden sm:table-cell px-3 py-3.5 w-36">
                              <Input
                                data-testid={`notes-${article.id}`}
                                value={notesMap[article.id] ?? ""}
                                onChange={e => setNotesMap(prev => ({ ...prev, [article.id]: e.target.value }))}
                                onBlur={() => saveNotes(article.id)}
                                onKeyDown={e => e.key === "Enter" && saveNotes(article.id)}
                                placeholder="Tambah catatan..."
                                className="h-7 text-xs border-violet-700/40 bg-violet-950/30 text-slate-200 rounded-lg focus-visible:ring-violet-400 placeholder:text-slate-500"
                              />
                            </td>
                            <td className="px-2 py-3.5 w-10">
                              <button
                                onClick={() => setDetailId(article.id)}
                                title="Lihat Detail"
                                className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-600 hover:text-violet-300 hover:bg-violet-900/30 transition-all border border-transparent hover:border-violet-700/40">
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {/* ── Push result toast ── */}
          {pushResult && (
            <div className={`flex items-center gap-2 text-xs px-4 py-2.5 rounded-xl border ${
              pushResult.ok
                ? "text-emerald-300 bg-emerald-900/20 border-emerald-700/30"
                : "text-red-300 bg-red-900/20 border-red-700/30"
            }`}>
              {pushResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
              {pushResult.msg}
            </div>
          )}

          {/* ── Export & Push card ── */}
          {(stats.approved > 0 || stats.exported > 0) && (
            <div className="bg-[#0d0720] rounded-2xl border border-violet-700/40 p-4"
              style={{ boxShadow: "0 0 24px rgba(109,40,217,0.14)" }}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 bg-indigo-900/40 rounded-lg flex items-center justify-center shrink-0">
                  <FileJson className="w-3 h-3 text-indigo-400" />
                </div>
                <h3 className="text-sm font-bold text-slate-100">Export & Push ke Supabase</h3>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                {stats.approved > 0 && (
                  <button onClick={doPushApproved} disabled={pushLoading}
                    className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl h-10 px-4 text-xs font-semibold transition-colors w-full sm:w-auto">
                    {pushLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    <span data-testid="button-push-supabase">Push ke Supabase</span>
                    <span className="bg-emerald-900/50 text-emerald-200 text-xs px-1.5 py-px rounded-md font-bold">{stats.approved}</span>
                  </button>
                )}
                {stats.approved > 0 && (
                  <a href={apiUrl("/export/kb-approved")} download className="w-full sm:w-auto">
                    <button data-testid="button-download-approved"
                      className="flex items-center justify-center gap-2 border border-emerald-700/40 text-emerald-400 hover:bg-emerald-900/20 rounded-xl h-10 px-4 text-xs font-semibold transition-colors w-full">
                      <Download className="w-3.5 h-3.5" />kb_approved.json
                      <span className="bg-emerald-900/30 text-emerald-400 text-xs px-1.5 py-px rounded-md font-bold">{stats.approved}</span>
                    </button>
                  </a>
                )}
                {stats.exported > 0 && (
                  <a href={apiUrl("/export/kb-exported")} download className="w-full sm:w-auto">
                    <button data-testid="button-download-exported"
                      className="flex items-center justify-center gap-2 border border-indigo-700/40 text-indigo-400 hover:bg-indigo-900/20 rounded-xl h-10 px-4 text-xs font-semibold transition-colors w-full">
                      <Download className="w-3.5 h-3.5" />kb_exported.json
                      <span className="bg-indigo-900/30 text-indigo-400 text-xs px-1.5 py-px rounded-md font-bold">{stats.exported}</span>
                    </button>
                  </a>
                )}
              </div>
            </div>
          )}

        </div>
        </div>

        {/* ── Mobile bulk action bar — fixed above bottom nav ── */}
        {selected.size > 0 && (
          <div className="fixed bottom-[68px] inset-x-0 z-40 sm:hidden px-3 pb-1">
            <div className="rounded-2xl p-3 flex items-center gap-2"
              style={{ background: "#160830", border: "1px solid rgba(139,92,246,0.45)", boxShadow: "0 0 24px rgba(109,40,217,0.45), 0 4px 16px rgba(0,0,0,0.6)" }}>
              <span className="text-xs font-bold text-violet-300 shrink-0 whitespace-nowrap">{selected.size} dipilih</span>
              <div className="flex flex-1 gap-1.5 overflow-x-auto scrollbar-hide">
                {BULK_ACTIONS.map(ba => (
                  <button key={ba.action} data-testid={`bulk-${ba.action}`}
                    disabled={bulkLoading}
                    onClick={() => doBulkAction(ba.action)}
                    className={`text-white text-xs h-7 px-2.5 rounded-full whitespace-nowrap shrink-0 font-semibold transition-colors ${ba.color}`}>
                    {bulkLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : ba.label}
                  </button>
                ))}
              </div>
              <button onClick={() => setSelected(new Set())}
                className="text-slate-500 hover:text-white p-1 rounded-full hover:bg-white/10 shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

      </div>

      {/* ── Detail Drawer ── */}
      {detailId && (() => {
        const a = articles.find(x => x.id === detailId);
        if (!a) return null;
        const isSaving = savingId === a.id;
        return (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
              onClick={() => setDetailId(null)}
            />
            {/* Panel — full on mobile, right side on desktop */}
            <div className="fixed inset-y-0 right-0 z-50 flex flex-col w-full sm:w-[480px] lg:w-[540px]"
              style={{ background: "#09051a", borderLeft: "1px solid rgba(139,92,246,0.25)", boxShadow: "-8px 0 40px rgba(0,0,0,0.7)" }}>

              {/* Header */}
              <div className="flex items-center gap-3 px-4 py-3.5 border-b border-violet-900/30 shrink-0">
                <div className="w-7 h-7 rounded-lg bg-violet-900/40 flex items-center justify-center shrink-0">
                  <Eye className="w-3.5 h-3.5 text-violet-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-bold text-white text-sm leading-snug line-clamp-1">{a.title || "(Tanpa Judul)"}</h2>
                  <p className="font-mono text-[10px] text-indigo-400/70 truncate">{a.slug}</p>
                </div>
                <button onClick={() => setDetailId(null)}
                  className="shrink-0 flex items-center justify-center w-8 h-8 rounded-xl text-slate-500 hover:text-white hover:bg-white/10 transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">

                {/* Status + Meta */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Select value={a.approval_status} disabled={isSaving}
                      onValueChange={(val) => updateStatus(a.id, val as ApprovalStatus)}>
                      <SelectTrigger className="h-7 text-xs border-0 shadow-none p-0 focus:ring-0 w-auto gap-1">
                        <SelectValue><StatusBadge status={a.approval_status} /></SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(STATUS_CONFIG) as ApprovalStatus[]).map(s => (
                          <SelectItem key={s} value={s}><StatusBadge status={s} /></SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {isSaving && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {a.published_date && (
                      <div className="rounded-lg px-2.5 py-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                        <p className="text-[9px] text-slate-600 uppercase tracking-wide mb-0.5">Tanggal</p>
                        <p className="text-xs text-slate-300">{a.published_date}</p>
                      </div>
                    )}
                    <div className="rounded-lg px-2.5 py-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                      <p className="text-[9px] text-slate-600 uppercase tracking-wide mb-0.5">Diperbarui</p>
                      <p className="text-xs text-slate-300">{formatDate(a.last_updated)}</p>
                    </div>
                    {a.scrape_status && (
                      <div className="rounded-lg px-2.5 py-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                        <p className="text-[9px] text-slate-600 uppercase tracking-wide mb-0.5">Scrape</p>
                        <p className={`text-xs font-mono font-semibold ${a.scrape_status === "success" ? "text-emerald-400" : "text-amber-400"}`}>{a.scrape_status}</p>
                      </div>
                    )}
                    {a.source_url && (
                      <div className="rounded-lg px-2.5 py-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                        <p className="text-[9px] text-slate-600 uppercase tracking-wide mb-0.5">Sumber</p>
                        <a href={a.source_url} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-indigo-400 hover:underline truncate block">
                          Buka Link ↗
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                {/* Tags */}
                {(a.tags || []).length > 0 && (
                  <div>
                    <p className="text-[9px] text-slate-600 uppercase tracking-widest font-bold mb-1.5">Tags</p>
                    <div className="flex flex-wrap gap-1">
                      {(a.tags || []).map(t => (
                        <span key={t} className="text-[10px] bg-indigo-900/40 text-indigo-300 border border-indigo-800/40 px-2 py-px rounded-full font-medium">{t}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Summary */}
                {a.summary && (
                  <div>
                    <p className="text-[9px] text-slate-600 uppercase tracking-widest font-bold mb-1.5">Summary</p>
                    <p className="text-[11px] sm:text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">{a.summary}</p>
                  </div>
                )}

                {/* Content */}
                {a.content && (
                  <div>
                    <p className="text-[9px] text-slate-600 uppercase tracking-widest font-bold mb-1.5">Konten</p>
                    <div className="rounded-xl px-3.5 py-3 text-[11px] sm:text-xs text-slate-300 leading-relaxed whitespace-pre-wrap"
                      style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", direction: "auto", fontFamily: "inherit" }}>
                      {a.content}
                    </div>
                  </div>
                )}

                {/* Notes */}
                <div>
                  <p className="text-[9px] text-slate-600 uppercase tracking-widest font-bold mb-1.5">Catatan</p>
                  <Input
                    value={notesMap[a.id] ?? ""}
                    onChange={e => setNotesMap(prev => ({ ...prev, [a.id]: e.target.value }))}
                    onBlur={() => saveNotes(a.id)}
                    onKeyDown={e => e.key === "Enter" && saveNotes(a.id)}
                    placeholder="Tambah catatan reviewer..."
                    className="h-8 text-xs border-violet-800/40 bg-violet-950/30 text-slate-300 rounded-xl focus-visible:ring-violet-400/40 placeholder:text-slate-600"
                  />
                </div>

              </div>

              {/* Footer */}
              <div className="shrink-0 px-4 py-3 border-t border-violet-900/30 flex items-center justify-between gap-2">
                <div className="flex gap-1.5">
                  {(["approved", "rejected"] as ApprovalStatus[]).map(s => {
                    const cfg = STATUS_CONFIG[s];
                    const isActive = a.approval_status === s;
                    return (
                      <button key={s} disabled={isSaving || isActive}
                        onClick={() => updateStatus(a.id, s)}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all border disabled:opacity-50 disabled:cursor-default ${
                          isActive
                            ? `${cfg.color} opacity-80`
                            : s === "approved"
                              ? "text-emerald-400 bg-emerald-900/20 border-emerald-700/40 hover:bg-emerald-900/40"
                              : "text-red-400 bg-red-900/20 border-red-700/40 hover:bg-red-900/40"
                        }`}>
                        {cfg.icon}{cfg.label}
                      </button>
                    );
                  })}
                </div>
                <button onClick={() => setDetailId(null)}
                  className="px-4 py-1.5 rounded-lg text-[11px] font-semibold text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-all">
                  Tutup
                </button>
              </div>
            </div>
          </>
        );
      })()}

      <BottomNav active="review" />
    </div>
  );
}
