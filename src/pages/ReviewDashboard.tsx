import { useState, useEffect, useCallback } from "react";
import { apiUrl } from "@/lib/api";
import { Link } from "react-router-dom";
import {
  Newspaper, CheckCircle2, XCircle, Clock, Eye, Send, Download,
  Loader2, ChevronLeft, RefreshCw, FileJson, CheckSquare,
  AlertCircle, Filter, BarChart3, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  reviewed: { label: "Reviewed", color: "bg-blue-100 text-blue-700 border-blue-200",       icon: <Eye className="w-3 h-3" /> },
  approved: { label: "Approved", color: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: <CheckCircle2 className="w-3 h-3" /> },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-700 border-red-200",           icon: <XCircle className="w-3 h-3" /> },
  exported: { label: "Exported", color: "bg-indigo-100 text-indigo-700 border-indigo-200",  icon: <Send className="w-3 h-3" /> },
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
  { action: "mark_reviewed", label: "Mark Reviewed", color: "bg-blue-600 hover:bg-blue-700" },
  { action: "approve",       label: "Approve",       color: "bg-emerald-600 hover:bg-emerald-700" },
  { action: "reject",        label: "Reject",        color: "bg-red-600 hover:bg-red-700" },
  { action: "export",        label: "Export",        color: "bg-indigo-600 hover:bg-indigo-700" },
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
  // Notes local state (keyed by id)
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    try {
      const url = statusFilter === "all" ? apiUrl("/kb-drafts") : apiUrl(`/kb-drafts?status=${statusFilter}`);
      const res = await fetch(url);
      if (res.ok) {
        const data: KbDraft[] = await res.json();
        setArticles(data);
        // Sync notes into local state
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
    <div className="flex h-screen overflow-hidden bg-[#f0f1f8] text-slate-900">

      {/* ─── Main Content Area ─── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* ─── Dark Header Card ─── */}
        <div className="mx-2 sm:mx-4 lg:mx-6 mt-2 sm:mt-4 lg:mt-5 bg-gradient-to-r from-[#1a0533] via-[#2e0d5e] to-[#3d1480] rounded-xl sm:rounded-2xl px-3 sm:px-5 lg:px-8 py-2.5 sm:py-3.5 lg:py-5 flex items-center justify-between shrink-0 shadow-lg shadow-purple-900/20">
          <div className="flex items-center gap-2 sm:gap-3 lg:gap-4 min-w-0">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-1 lg:gap-2 text-white/70 hover:text-white hover:bg-white/15 -ml-1 h-8 lg:h-10 px-2 lg:px-3 text-xs lg:text-sm">
                <ChevronLeft className="w-3.5 h-3.5 lg:w-4 lg:h-4" /><span className="hidden sm:inline">Scraper</span>
              </Button>
            </Link>
            <div className="w-px h-4 lg:h-6 bg-white/30 shrink-0 hidden sm:block" />
            <div className="min-w-0">
              <p className="font-bold text-white text-sm lg:text-xl tracking-tight">KB Review Dashboard</p>
              <p className="hidden sm:block text-purple-300 text-[11px] lg:text-sm mt-0.5 lg:mt-1">AINA Knowledge Base — Approval Workflow</p>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-1.5 lg:gap-2 shrink-0">
            <a href={apiUrl("/export/kb-approved")} download>
              <Button variant="ghost" size="sm"
                className="gap-1.5 text-white/80 hover:text-white hover:bg-white/15 h-8 lg:h-10 px-2 sm:px-3 lg:px-4 text-xs lg:text-sm rounded-full">
                <Download className="w-3.5 h-3.5 lg:w-4 lg:h-4" /><span className="hidden sm:inline text-xs lg:text-sm">Approved</span>
              </Button>
            </a>
            <a href={apiUrl("/export/kb-exported")} download>
              <Button variant="ghost" size="sm"
                className="gap-1.5 text-white/80 hover:text-white hover:bg-white/15 h-8 lg:h-10 px-2 sm:px-3 lg:px-4 text-xs lg:text-sm rounded-full">
                <Download className="w-3.5 h-3.5 lg:w-4 lg:h-4" /><span className="hidden sm:inline text-xs lg:text-sm">Exported</span>
              </Button>
            </a>
            <Button variant="ghost" size="sm" onClick={() => { fetchArticles(); fetchStats(); }}
              className="h-8 lg:h-10 w-8 lg:w-10 p-0 text-white/70 hover:text-white hover:bg-white/15 rounded-full">
              <RefreshCw className={`w-4 h-4 lg:w-5 lg:h-5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* ─── Scrollable Content ─── */}
        <div className="flex-1 overflow-y-auto p-2.5 sm:p-4 lg:p-6 pb-20 lg:pb-24 space-y-3 sm:space-y-4 lg:space-y-5 min-w-0">

          {/* ── Stats Row ── */}
          <div className="flex sm:grid sm:grid-cols-6 gap-2 sm:gap-2.5 overflow-x-auto sm:overflow-visible pb-0.5 sm:pb-0 -mx-2.5 px-2.5 sm:mx-0 sm:px-0 snap-x snap-mandatory sm:snap-none">
            {[
              { label: "Total",    value: stats.total,    icon: BarChart3,    numColor: "text-slate-800",   iconBg: "bg-slate-100",   iconColor: "text-slate-500",   top: "bg-slate-300" },
              { label: "Pending",  value: stats.pending,  icon: Clock,        numColor: "text-amber-600",   iconBg: "bg-amber-100",   iconColor: "text-amber-500",   top: "bg-amber-400" },
              { label: "Reviewed", value: stats.reviewed, icon: Eye,          numColor: "text-blue-600",    iconBg: "bg-blue-100",    iconColor: "text-blue-500",    top: "bg-blue-400" },
              { label: "Approved", value: stats.approved, icon: CheckCircle2, numColor: "text-emerald-600", iconBg: "bg-emerald-100", iconColor: "text-emerald-600", top: "bg-emerald-400" },
              { label: "Rejected", value: stats.rejected, icon: XCircle,      numColor: "text-red-600",     iconBg: "bg-red-100",     iconColor: "text-red-500",     top: "bg-red-400" },
              { label: "Exported", value: stats.exported, icon: Send,         numColor: "text-indigo-600",  iconBg: "bg-indigo-100",  iconColor: "text-indigo-500",  top: "bg-indigo-400" },
            ].map(({ label, value, icon: Icon, numColor, iconBg, iconColor, top }) => (
              <div key={label} className="snap-start shrink-0 w-[108px] sm:w-auto bg-white rounded-xl sm:rounded-2xl shadow-sm border border-slate-100/80 overflow-hidden">
                <div className={`h-[3px] w-full ${top}`} />
                {/* Mobile layout */}
                <div className="sm:hidden flex items-center gap-2 px-2.5 py-2.5">
                  <div className={`w-7 h-7 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
                    <Icon className={`w-3.5 h-3.5 ${iconColor}`} />
                  </div>
                  <div className="min-w-0">
                    <p className={`text-lg font-extrabold leading-none tabular-nums ${numColor}`}>{value}</p>
                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wide mt-0.5 truncate">{label}</p>
                  </div>
                </div>
                {/* Desktop layout */}
                <div className="hidden sm:block px-3.5 lg:px-5 py-3 lg:py-4">
                  <div className="flex items-center justify-between mb-2 lg:mb-3">
                    <p className="text-[9px] lg:text-[11px] text-slate-400 font-bold uppercase tracking-widest leading-none">{label}</p>
                    <div className={`w-6 h-6 lg:w-8 lg:h-8 rounded-md lg:rounded-lg ${iconBg} flex items-center justify-center`}>
                      <Icon className={`w-3 h-3 lg:w-4 lg:h-4 ${iconColor}`} />
                    </div>
                  </div>
                  <p className={`text-2xl lg:text-4xl font-extrabold leading-none tabular-nums ${numColor}`}>{value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* ── Filter + Bulk Action Row ── */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Filter tabs */}
            <div className="flex items-center gap-0.5 bg-white rounded-xl p-1 shadow-sm border border-slate-100/80 overflow-x-auto max-w-full">
              <Filter className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-0.5 shrink-0" />
              {STATUS_FILTERS.map(f => (
                <button key={f.value}
                  data-testid={`filter-${f.value}`}
                  onClick={() => setStatusFilter(f.value)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all whitespace-nowrap ${
                    statusFilter === f.value
                      ? "bg-slate-900 text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
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

            {/* Bulk action bar */}
            {selected.size > 0 && (
              <div className="flex items-center gap-1.5 bg-white rounded-xl px-3 py-1.5 shadow-sm border border-slate-100/80">
                <span className="text-xs font-semibold text-indigo-700 mr-0.5">
                  {selected.size} dipilih
                </span>
                {BULK_ACTIONS.map(ba => (
                  <Button key={ba.action} data-testid={`bulk-${ba.action}`}
                    size="sm" disabled={bulkLoading}
                    onClick={() => doBulkAction(ba.action)}
                    className={`text-white text-xs py-1 h-7 px-2.5 rounded-full ${ba.color}`}>
                    {bulkLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : ba.label}
                  </Button>
                ))}
                <button onClick={() => setSelected(new Set())}
                  className="text-xs text-slate-400 hover:text-slate-600 ml-0.5 underline">
                  Batal
                </button>
              </div>
            )}
            {bulkMsg && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-xl">
                <CheckCircle2 className="w-3.5 h-3.5" />{bulkMsg}
              </div>
            )}
          </div>

          {/* ── Table Card ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100/80 overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-20 text-slate-400 gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />Memuat artikel...
              </div>
            ) : articles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3 px-6">
                <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
                  <FileText className="w-6 h-6 text-slate-300" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-semibold text-slate-600">
                    {statusFilter === "all" ? "Belum ada KB Draft" : `Tidak ada artikel dengan status "${statusFilter}"`}
                  </p>
                  {statusFilter === "all" && (
                    <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
                      KB Draft dibuat dari hasil scraping. Ikuti langkah berikut di halaman Scraper:
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
                      <div key={s.n} className="flex items-center gap-2.5 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
                        <span className="w-5 h-5 rounded-full bg-indigo-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">{s.n}</span>
                        <span className="text-xs text-slate-600">{s.label}</span>
                      </div>
                    ))}
                  </div>
                )}
                <Link to="/">
                  <Button size="sm" className="mt-1 gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white">
                    <ChevronLeft className="w-3.5 h-3.5" />Ke Halaman Scraper
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px]">
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
                    </tr>
                  </thead>
                  <tbody>
                    {articles.map((article, i) => {
                      const isSelected = selected.has(article.id);
                      const isSaving = savingId === article.id;
                      return (
                        <tr key={article.id}
                          data-testid={`row-kb-${article.id}`}
                          className={`border-b border-slate-50 align-top transition-colors ${
                            isSelected ? "bg-indigo-50/60" : "hover:bg-slate-50/60"
                          }`}>
                          <td className="px-3 sm:px-4 py-3.5 w-10">
                            <Checkbox
                              data-testid={`checkbox-${article.id}`}
                              checked={isSelected}
                              onCheckedChange={() => toggleSelect(article.id)}
                            />
                          </td>
                          <td className="hidden sm:table-cell px-3 py-3.5 text-slate-400 text-xs">{i + 1}</td>
                          <td className="px-3 py-3.5 min-w-0">
                            <p className="font-semibold text-slate-900 line-clamp-2 text-xs sm:text-sm leading-snug">
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
                                  className="text-[10px] sm:text-xs text-indigo-400 hover:text-indigo-600 underline truncate max-w-[100px] sm:max-w-[140px]">
                                  source ↗
                                </a>
                              )}
                              {article.scrape_status && (
                                <span className={`text-[10px] sm:text-xs font-mono px-1.5 py-px rounded ${
                                  article.scrape_status === "success" ? "bg-emerald-50 text-emerald-600" : "bg-yellow-50 text-yellow-600"
                                }`}>{article.scrape_status}</span>
                              )}
                            </div>
                            {article.scrape_status === "partial" && (
                              <div className="mt-1.5 flex items-start gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1 leading-snug">
                                <AlertCircle className="w-3 h-3 shrink-0 mt-px" />
                                <span>Konten artikel ini tidak lengkap saat di-scrape. Verifikasi dan lengkapi konten secara manual sebelum diapprove, atau reject jika tidak layak.</span>
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
                              className="text-xs text-slate-600 line-clamp-4 leading-relaxed">
                              {article.summary || <span className="text-slate-300 italic">Tidak ada summary</span>}
                            </p>
                          </td>
                          <td className="hidden md:table-cell px-3 py-3.5 w-36">
                            <div data-testid={`tags-${article.id}`} className="flex flex-wrap gap-1">
                              {(article.tags || []).map(t => (
                                <span key={t} className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-px rounded-md font-medium">
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
                            <span data-testid={`updated-${article.id}`}
                              className="text-xs text-slate-400 whitespace-nowrap">
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
                              className="h-7 text-xs border-slate-200 rounded-lg focus-visible:ring-indigo-400 placeholder:text-slate-300"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Download section ── */}
          {(stats.approved > 0 || stats.exported > 0) && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100/80 p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 bg-indigo-100 rounded-lg flex items-center justify-center">
                  <FileJson className="w-3.5 h-3.5 text-indigo-600" />
                </div>
                <h3 className="text-sm font-bold text-slate-800">Download Hasil Review</h3>
              </div>
              <div className="flex flex-wrap gap-2.5">
                {stats.approved > 0 && (
                  <a href={apiUrl("/export/kb-approved")} download>
                    <Button data-testid="button-download-approved" variant="outline"
                      className="gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 rounded-xl h-9 text-xs">
                      <Download className="w-3.5 h-3.5" />
                      kb_approved.json
                      <span className="bg-emerald-100 text-emerald-700 text-xs px-1.5 py-px rounded-md font-bold">
                        {stats.approved}
                      </span>
                    </Button>
                  </a>
                )}
                {stats.exported > 0 && (
                  <a href={apiUrl("/export/kb-exported")} download>
                    <Button data-testid="button-download-exported" variant="outline"
                      className="gap-2 border-indigo-200 text-indigo-700 hover:bg-indigo-50 rounded-xl h-9 text-xs">
                      <Download className="w-3.5 h-3.5" />
                      kb_exported.json
                      <span className="bg-indigo-100 text-indigo-700 text-xs px-1.5 py-px rounded-md font-bold">
                        {stats.exported}
                      </span>
                    </Button>
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom Nav (all screens) ── */}
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-sm border-t border-slate-200 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-around h-14 lg:h-16 px-2 lg:px-8 max-w-screen-2xl mx-auto">
          <Link to="/" className="flex flex-col items-center gap-0.5 lg:gap-1 px-4 lg:px-8 py-1.5 lg:py-2 rounded-xl lg:rounded-2xl text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors min-w-[60px] lg:min-w-[100px]">
            <Newspaper style={{ width: 18, height: 18 }} className="lg:!w-5 lg:!h-5" />
            <span className="text-[10px] lg:text-xs font-semibold">Scraper</span>
          </Link>
          <div className="flex flex-col items-center gap-0.5 lg:gap-1 px-4 lg:px-8 py-1.5 lg:py-2 rounded-xl lg:rounded-2xl bg-slate-900 text-white min-w-[60px] lg:min-w-[100px]">
            <CheckSquare style={{ width: 18, height: 18 }} className="lg:!w-5 lg:!h-5" />
            <span className="text-[10px] lg:text-xs font-semibold">Review</span>
          </div>
          <a href={apiUrl("/export/kb-approved")} download className="flex flex-col items-center gap-0.5 lg:gap-1 px-4 lg:px-8 py-1.5 lg:py-2 rounded-xl lg:rounded-2xl text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors min-w-[60px] lg:min-w-[100px]">
            <Download style={{ width: 18, height: 18 }} className="lg:!w-5 lg:!h-5" />
            <span className="text-[10px] lg:text-xs font-semibold">Export</span>
          </a>
        </div>
      </nav>
    </div>
  );
}
