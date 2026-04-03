import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Newspaper, CheckCircle2, XCircle, Clock, Eye, Send, Download,
  Loader2, ChevronLeft, RefreshCw, FileJson, CheckSquare,
  AlertCircle, Filter,
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
      const url = statusFilter === "all" ? "/kb-drafts" : `/kb-drafts?status=${statusFilter}`;
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
      const res = await fetch("/kb/stats");
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
      const res = await fetch("/kb/update-status", {
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
      await fetch("/kb/update-status", {
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
      const res = await fetch("/kb/bulk-action", {
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
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-1 sm:gap-1.5 text-slate-500 hover:text-slate-700 -ml-2 px-2 sm:px-3">
                <ChevronLeft className="w-4 h-4" /><span className="hidden sm:inline">Scraper</span>
              </Button>
            </Link>
            <div className="w-px h-5 bg-slate-200 shrink-0" />
            <div className="w-7 h-7 sm:w-8 sm:h-8 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0">
              <CheckSquare className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-bold text-slate-900 truncate">KB Review Dashboard</h1>
              <p className="hidden sm:block text-xs text-slate-500">AINA Knowledge Base — Approval Workflow</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <a href="/export/kb-approved" download>
              <Button variant="outline" size="sm"
                className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 h-8 px-2 sm:px-3 text-xs">
                <Download className="w-3.5 h-3.5" /><span className="hidden sm:inline">Approved</span>
              </Button>
            </a>
            <a href="/export/kb-exported" download>
              <Button variant="outline" size="sm"
                className="gap-1.5 border-indigo-300 text-indigo-700 hover:bg-indigo-50 h-8 px-2 sm:px-3 text-xs">
                <Download className="w-3.5 h-3.5" /><span className="hidden sm:inline">Exported</span>
              </Button>
            </a>
            <Button variant="ghost" size="sm" onClick={() => { fetchArticles(); fetchStats(); }}
              className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-5">

        {/* Stats Bar */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 sm:gap-3">
          {[
            { label: "Total",    value: stats.total,    color: "text-slate-800",   accent: "bg-slate-400" },
            { label: "Pending",  value: stats.pending,  color: "text-amber-600",   accent: "bg-amber-400" },
            { label: "Reviewed", value: stats.reviewed, color: "text-blue-600",    accent: "bg-blue-400" },
            { label: "Approved", value: stats.approved, color: "text-emerald-600", accent: "bg-emerald-500" },
            { label: "Rejected", value: stats.rejected, color: "text-red-600",     accent: "bg-red-500" },
            { label: "Exported", value: stats.exported, color: "text-indigo-600",  accent: "bg-indigo-500" },
          ].map(({ label, value, color, accent }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex">
              <div className={`w-1 shrink-0 ${accent}`} />
              <div className="px-2.5 py-2.5 sm:px-4 sm:py-3 min-w-0">
                <p className="text-[10px] sm:text-xs text-slate-400 font-semibold uppercase tracking-wide leading-none truncate">{label}</p>
                <p className={`text-lg sm:text-xl font-bold mt-1 leading-none tabular-nums ${color}`}>{value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Filter + Bulk Action Row */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Filter tabs — scrollable on mobile */}
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1 shadow-sm overflow-x-auto max-w-full">
            <Filter className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-0.5 shrink-0" />
            {STATUS_FILTERS.map(f => (
              <button key={f.value}
                data-testid={`filter-${f.value}`}
                onClick={() => setStatusFilter(f.value)}
                className={`text-xs px-2.5 sm:px-3 py-1.5 rounded-md font-medium transition-all whitespace-nowrap ${
                  statusFilter === f.value
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                }`}>
                {f.label}
                {f.value !== "all" && (
                  <span className={`ml-1 sm:ml-1.5 text-xs font-normal ${statusFilter === f.value ? "text-indigo-200" : "text-slate-400"}`}>
                    {stats[f.value as keyof KbStats] ?? 0}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Bulk action bar */}
          {selected.size > 0 && (
            <div className="flex items-center gap-2 bg-white border border-indigo-200 rounded-lg px-3 py-1.5 shadow-sm">
              <span className="text-xs font-semibold text-indigo-700 mr-1">
                {selected.size} dipilih
              </span>
              {BULK_ACTIONS.map(ba => (
                <Button key={ba.action} data-testid={`bulk-${ba.action}`}
                  size="sm" disabled={bulkLoading}
                  onClick={() => doBulkAction(ba.action)}
                  className={`text-white text-xs py-1 h-7 px-3 ${ba.color}`}>
                  {bulkLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : ba.label}
                </Button>
              ))}
              <button onClick={() => setSelected(new Set())}
                className="text-xs text-slate-400 hover:text-slate-600 ml-1 underline">
                Batal
              </button>
            </div>
          )}
          {bulkMsg && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
              <CheckCircle2 className="w-3.5 h-3.5" />{bulkMsg}
            </div>
          )}
        </div>

        {/* Table */}
        <Card className="shadow-sm">
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-20 text-slate-400 gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />Memuat artikel...
              </div>
            ) : articles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-2">
                <AlertCircle className="w-10 h-10 opacity-30" />
                <p className="text-sm font-medium">Tidak ada artikel</p>
                <p className="text-xs">
                  {statusFilter === "all"
                    ? "Jalankan Convert to KB Draft di halaman Scraper terlebih dahulu."
                    : `Tidak ada artikel dengan status "${statusFilter}".`}
                </p>
                <Link to="/">
                  <Button variant="outline" size="sm" className="mt-2 gap-1.5">
                    <ChevronLeft className="w-3.5 h-3.5" />Ke Scraper
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-[11px]">
                      <th className="px-3 sm:px-4 py-3 w-10">
                        <Checkbox
                          checked={allSelected}
                          data-testid="checkbox-select-all"
                          onCheckedChange={toggleSelectAll}
                          className={someSelected ? "data-[state=checked]:bg-slate-400" : ""}
                        />
                      </th>
                      <th className="hidden sm:table-cell text-left px-3 py-3 font-semibold text-slate-500 uppercase tracking-wide w-8">#</th>
                      <th className="text-left px-3 py-3 font-semibold text-slate-500 uppercase tracking-wide">Artikel</th>
                      <th className="hidden md:table-cell text-left px-3 py-3 font-semibold text-slate-500 uppercase tracking-wide w-52">Summary</th>
                      <th className="hidden md:table-cell text-left px-3 py-3 font-semibold text-slate-500 uppercase tracking-wide w-36">Tags</th>
                      <th className="text-left px-3 py-3 font-semibold text-slate-500 uppercase tracking-wide w-28 sm:w-36">Status</th>
                      <th className="hidden lg:table-cell text-left px-3 py-3 font-semibold text-slate-500 uppercase tracking-wide w-32">Updated</th>
                      <th className="hidden sm:table-cell text-left px-3 py-3 font-semibold text-slate-500 uppercase tracking-wide w-36">Notes</th>
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
                            isSelected ? "bg-indigo-50/60" : "hover:bg-slate-50/80"
                          }`}>
                          {/* Checkbox */}
                          <td className="px-3 sm:px-4 py-3.5 w-10">
                            <Checkbox
                              data-testid={`checkbox-${article.id}`}
                              checked={isSelected}
                              onCheckedChange={() => toggleSelect(article.id)}
                            />
                          </td>

                          {/* Row number */}
                          <td className="hidden sm:table-cell px-3 py-3.5 text-slate-400 text-xs">{i + 1}</td>

                          {/* Title + slug + date + source */}
                          <td className="px-3 py-3.5 min-w-0">
                            <p className="font-semibold text-slate-900 line-clamp-2 text-xs sm:text-sm leading-snug">
                              {article.title || "(Tanpa Judul)"}
                            </p>
                            <p className="font-mono text-[10px] sm:text-xs text-indigo-500 mt-0.5 truncate max-w-[140px] sm:max-w-xs">
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
                            {/* Summary inline on mobile */}
                            {article.summary && (
                              <p className="md:hidden text-[10px] text-slate-500 mt-1.5 line-clamp-2 leading-relaxed">
                                {article.summary}
                              </p>
                            )}
                          </td>

                          {/* Summary */}
                          <td className="hidden md:table-cell px-3 py-3.5 w-52">
                            <p data-testid={`summary-${article.id}`}
                              className="text-xs text-slate-600 line-clamp-4 leading-relaxed">
                              {article.summary || <span className="text-slate-300 italic">Tidak ada summary</span>}
                            </p>
                          </td>

                          {/* Tags */}
                          <td className="hidden md:table-cell px-3 py-3.5 w-36">
                            <div data-testid={`tags-${article.id}`} className="flex flex-wrap gap-1">
                              {(article.tags || []).map(t => (
                                <span key={t}
                                  className="text-xs bg-slate-100 text-slate-600 px-1.5 py-px rounded font-medium">
                                  {t}
                                </span>
                              ))}
                            </div>
                          </td>

                          {/* Status select */}
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

                          {/* Last updated */}
                          <td className="hidden lg:table-cell px-3 py-3.5 w-32">
                            <span data-testid={`updated-${article.id}`}
                              className="text-xs text-slate-400 whitespace-nowrap">
                              {formatDate(article.last_updated)}
                            </span>
                          </td>

                          {/* Notes */}
                          <td className="hidden sm:table-cell px-3 py-3.5 w-36">
                            <Input
                              data-testid={`notes-${article.id}`}
                              value={notesMap[article.id] ?? ""}
                              onChange={e => setNotesMap(prev => ({ ...prev, [article.id]: e.target.value }))}
                              onBlur={() => saveNotes(article.id)}
                              onKeyDown={e => e.key === "Enter" && saveNotes(article.id)}
                              placeholder="Tambah catatan..."
                              className="h-7 text-xs border-slate-200 focus-visible:ring-indigo-400 placeholder:text-slate-300"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Download section */}
        {(stats.approved > 0 || stats.exported > 0) && (
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileJson className="w-4 h-4 text-indigo-500" />
                Download Hasil Review
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              {stats.approved > 0 && (
                <a href="/export/kb-approved" download>
                  <Button data-testid="button-download-approved" variant="outline"
                    className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                    <Download className="w-4 h-4" />
                    kb_approved.json
                    <span className="bg-emerald-100 text-emerald-700 text-xs px-1.5 py-px rounded font-bold">
                      {stats.approved}
                    </span>
                  </Button>
                </a>
              )}
              {stats.exported > 0 && (
                <a href="/export/kb-exported" download>
                  <Button data-testid="button-download-exported" variant="outline"
                    className="gap-2 border-indigo-300 text-indigo-700 hover:bg-indigo-50">
                    <Download className="w-4 h-4" />
                    kb_exported.json
                    <span className="bg-indigo-100 text-indigo-700 text-xs px-1.5 py-px rounded font-bold">
                      {stats.exported}
                    </span>
                  </Button>
                </a>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
