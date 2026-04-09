import { useState, useRef } from "react";
import { apiUrl } from "@/lib/api";
import { Link } from "react-router-dom";
import {
  Youtube, FileText, Rss, Send, ChevronLeft, Loader2,
  CheckCircle2, AlertCircle, ArrowRight, Upload, X, Hash,
  RefreshCw, ExternalLink, Wand2, Sparkles,
  Newspaper, BookOpen, Zap, List, Radio, ThumbsUp, ThumbsDown,
  CloudUpload, Clock, XCircle, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { BottomNav } from "@/components/BottomNav";
import { getToken } from "@/lib/auth";

type Tab = "youtube" | "docx" | "rss" | "telegram";
type ArticleStatus = "pending" | "approved" | "rejected" | "exported";

interface KbResult {
  id: string;
  title: string;
  content?: string;
  source_url: string;
  approval_status: string;
  scrape_status: string;
  is_duplicate?: boolean;
  duplicate_of_title?: string;
  duplicate_of_status?: string;
}

interface ScrapeResult {
  status: "ok" | "error";
  count?: number;
  articles?: KbResult[];
  article?: KbResult;
  error?: string;
  hint?: "no_cc" | "ip_block";
}

type AiFormat = "berita" | "kitab" | "laporan" | "ringkasan" | "poin" | "briefing";

interface AiItemState {
  open: boolean;
  loading: boolean;
  done: boolean;
  error: string;
}

interface PushState {
  loading: boolean;
  result: { ok: boolean; msg: string } | null;
}

const AI_FORMATS: { value: AiFormat; label: string; icon: React.ReactNode; activeBg: string; activeBorder: string; activeColor: string }[] = [
  { value: "berita",    label: "Berita",    icon: <Newspaper className="w-2.5 h-2.5" />, activeColor: "text-violet-300",  activeBg: "rgba(139,92,246,0.18)",  activeBorder: "rgba(139,92,246,0.5)" },
  { value: "kitab",     label: "Kitab",     icon: <BookOpen className="w-2.5 h-2.5" />,  activeColor: "text-orange-300",  activeBg: "rgba(251,146,60,0.15)",  activeBorder: "rgba(251,146,60,0.5)" },
  { value: "laporan",   label: "Laporan",   icon: <FileText className="w-2.5 h-2.5" />,  activeColor: "text-blue-300",    activeBg: "rgba(96,165,250,0.15)",  activeBorder: "rgba(96,165,250,0.5)" },
  { value: "ringkasan", label: "Ringkasan", icon: <Zap className="w-2.5 h-2.5" />,       activeColor: "text-yellow-300",  activeBg: "rgba(251,191,36,0.15)",  activeBorder: "rgba(251,191,36,0.5)" },
  { value: "poin",      label: "Poin",      icon: <List className="w-2.5 h-2.5" />,      activeColor: "text-emerald-300", activeBg: "rgba(52,211,153,0.15)",  activeBorder: "rgba(52,211,153,0.5)" },
  { value: "briefing",  label: "Briefing",  icon: <Radio className="w-2.5 h-2.5" />,     activeColor: "text-pink-300",    activeBg: "rgba(232,121,249,0.15)", activeBorder: "rgba(232,121,249,0.5)" },
];

const STATUS_UI: Record<ArticleStatus, { label: string; icon: React.ReactNode; cls: string }> = {
  pending:  { label: "Pending",  icon: <Clock className="w-2.5 h-2.5" />,       cls: "text-yellow-300 bg-yellow-900/25 border-yellow-600/30" },
  approved: { label: "Approved", icon: <CheckCircle2 className="w-2.5 h-2.5" />, cls: "text-emerald-300 bg-emerald-900/25 border-emerald-600/30" },
  rejected: { label: "Rejected", icon: <XCircle className="w-2.5 h-2.5" />,      cls: "text-red-300 bg-red-900/25 border-red-600/30" },
  exported: { label: "Exported", icon: <CloudUpload className="w-2.5 h-2.5" />,  cls: "text-indigo-300 bg-indigo-900/25 border-indigo-600/30" },
};

const TAB_CONFIG: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "youtube", label: "YouTube",  icon: <Youtube className="w-3.5 h-3.5" /> },
  { id: "docx",    label: "DOCX",     icon: <FileText className="w-3.5 h-3.5" /> },
  { id: "rss",     label: "RSS Feed", icon: <Rss className="w-3.5 h-3.5" /> },
  { id: "telegram",label: "Telegram", icon: <Send className="w-3.5 h-3.5" /> },
];

export default function MoreSourcesPage() {
  const [activeTab, setActiveTab] = useState<Tab>("youtube");

  // ── YouTube ──
  const [ytUrl, setYtUrl] = useState("");
  const [ytLoading, setYtLoading] = useState(false);
  const [ytResult, setYtResult] = useState<ScrapeResult | null>(null);

  // ── DOCX ──
  const [docxFiles, setDocxFiles] = useState<File[]>([]);
  const [docxLoading, setDocxLoading] = useState(false);
  const [docxResult, setDocxResult] = useState<ScrapeResult | null>(null);
  const [docxDrag, setDocxDrag] = useState(false);
  const docxRef = useRef<HTMLInputElement>(null);

  // ── RSS ──
  const [rssUrl, setRssUrl] = useState("");
  const [rssMax, setRssMax] = useState(10);
  const [rssLoading, setRssLoading] = useState(false);
  const [rssResult, setRssResult] = useState<ScrapeResult | null>(null);

  // ── Telegram ──
  const [tgChannel, setTgChannel] = useState("");
  const [tgLimit, setTgLimit] = useState(20);
  const [tgLoading, setTgLoading] = useState(false);
  const [tgResult, setTgResult] = useState<ScrapeResult | null>(null);

  // ── AI Fix state (keyed by article ID) ──
  const [aiState, setAiState] = useState<Record<string, AiItemState>>({});
  const [aiFormatPicker, setAiFormatPicker] = useState<Record<string, boolean>>({});

  // ── Approve/Reject state (keyed by article ID) ──
  const [articleStatus, setArticleStatus] = useState<Record<string, ArticleStatus>>({});
  const [approveLoading, setApproveLoading] = useState<Record<string, boolean>>({});

  // ── Push to Supabase state ──
  const [pushState, setPushState] = useState<PushState>({ loading: false, result: null });

  // ── Bulk delete state (per result box, keyed by label) ──
  const [bulkSelected, setBulkSelected] = useState<Record<string, Set<string>>>({});
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState<Record<string, boolean>>({});
  const [bulkDeleteMsg, setBulkDeleteMsg] = useState<Record<string, string>>({});

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` };

  // ── Scrape handlers ──
  const doYoutube = async () => {
    if (!ytUrl.trim()) return;
    setYtLoading(true); setYtResult(null);
    try {
      const res = await fetch(apiUrl("/api/youtube/scrape"), {
        method: "POST", headers,
        body: JSON.stringify({ url: ytUrl.trim() }),
      });
      const data = await res.json();
      setYtResult(data);
      initArticleStatus(data);
    } catch { setYtResult({ status: "error", error: "Gagal terhubung ke server." }); }
    setYtLoading(false);
  };

  const doDocx = async () => {
    if (docxFiles.length === 0) return;
    setDocxLoading(true); setDocxResult(null);
    try {
      const fd = new FormData();
      docxFiles.forEach(f => fd.append("files", f));
      const res = await fetch(apiUrl("/api/docx/upload"), {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      const data = await res.json();
      setDocxResult(data);
      initArticleStatus(data);
    } catch { setDocxResult({ status: "error", error: "Gagal terhubung ke server." }); }
    setDocxLoading(false);
  };

  const doRss = async () => {
    if (!rssUrl.trim()) return;
    setRssLoading(true); setRssResult(null);
    try {
      const res = await fetch(apiUrl("/api/rss/fetch"), {
        method: "POST", headers,
        body: JSON.stringify({ url: rssUrl.trim(), max_items: rssMax }),
      });
      const data = await res.json();
      setRssResult(data);
      initArticleStatus(data);
    } catch { setRssResult({ status: "error", error: "Gagal terhubung ke server." }); }
    setRssLoading(false);
  };

  const doTelegram = async () => {
    if (!tgChannel.trim()) return;
    setTgLoading(true); setTgResult(null);
    try {
      const res = await fetch(apiUrl("/api/telegram/scrape"), {
        method: "POST", headers,
        body: JSON.stringify({ channel: tgChannel.trim(), limit: tgLimit }),
      });
      const data = await res.json();
      setTgResult(data);
      initArticleStatus(data);
    } catch { setTgResult({ status: "error", error: "Gagal terhubung ke server." }); }
    setTgLoading(false);
  };

  const addDocxFiles = (files: FileList | null) => {
    if (!files) return;
    const valid = Array.from(files).filter(f =>
      f.name.toLowerCase().endsWith(".docx")
    );
    setDocxFiles(prev => {
      const names = new Set(prev.map(f => f.name));
      return [...prev, ...valid.filter(f => !names.has(f.name))];
    });
  };

  // ── Helpers ──
  const initArticleStatus = (result: ScrapeResult) => {
    if (result.status !== "ok") return;
    const arts = result.articles ?? (result.article ? [result.article] : []);
    setArticleStatus(prev => {
      const next = { ...prev };
      arts.forEach(a => { next[a.id] = (a.approval_status as ArticleStatus) || "pending"; });
      return next;
    });
  };

  // ── Approve / Reject ──
  const doApprove = async (id: string, newStatus: ArticleStatus) => {
    setApproveLoading(prev => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(apiUrl("/kb/update-status"), {
        method: "POST", headers,
        body: JSON.stringify({ id, status: newStatus }),
      });
      const data = await res.json();
      if (res.ok && data.status === "ok") {
        setArticleStatus(prev => ({ ...prev, [id]: newStatus }));
      }
    } catch { /* silently ignore */ }
    setApproveLoading(prev => ({ ...prev, [id]: false }));
  };

  // ── AI Fix ──
  const toggleAiPicker = (id: string) => {
    setAiFormatPicker(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const doAiFix = async (article: KbResult, format: AiFormat) => {
    const id = article.id;
    setAiFormatPicker(prev => ({ ...prev, [id]: false }));
    setAiState(prev => ({ ...prev, [id]: { open: true, loading: true, done: false, error: "" } }));
    try {
      const fmtRes = await fetch(apiUrl("/api/format-text"), {
        method: "POST", headers,
        body: JSON.stringify({
          title: article.title || "",
          content: article.content || article.title || "",
          format,
        }),
      });
      const fmtData = await fmtRes.json();
      if (!fmtRes.ok) throw new Error(fmtData.error || "AI format gagal");

      const saveRes = await fetch(apiUrl("/kb/update-status"), {
        method: "POST", headers,
        body: JSON.stringify({ id, status: articleStatus[id] || "pending", content: fmtData.formatted_content }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveData.error || "Gagal menyimpan ke KB");

      setAiState(prev => ({ ...prev, [id]: { open: true, loading: false, done: true, error: "" } }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Terjadi kesalahan";
      setAiState(prev => ({ ...prev, [id]: { open: true, loading: false, done: false, error: msg } }));
    }
  };

  // ── Push to Supabase ──
  const doPushApproved = async () => {
    setPushState({ loading: true, result: null });
    try {
      const res = await fetch(apiUrl("/api/push-approved"), { method: "POST", headers });
      const data = await res.json();
      if (res.ok && data.status === "ok") {
        const inserted = data.inserted ?? 0;
        const skipped = data.skipped ?? 0;
        const msg = inserted > 0
          ? `${inserted} artikel berhasil di-push ke Supabase.${skipped > 0 ? ` ${skipped} dilewati.` : ""}`
          : skipped > 0
          ? `${skipped} artikel sudah ada di Supabase (dilewati).`
          : "Tidak ada artikel yang di-push.";
        setPushState({ loading: false, result: { ok: true, msg } });
        // Mark exported articles in local state
        if (inserted > 0) {
          setArticleStatus(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(id => {
              if (next[id] === "approved") next[id] = "exported";
            });
            return next;
          });
        }
      } else {
        setPushState({ loading: false, result: { ok: false, msg: data.error || "Push ke Supabase gagal." } });
      }
    } catch {
      setPushState({ loading: false, result: { ok: false, msg: "Gagal terhubung ke server." } });
    }
    setTimeout(() => setPushState(prev => ({ ...prev, result: null })), 7000);
  };

  // ── Sub-components (defined inside to access closures) ──

  function AiFixSection({ article }: { article: KbResult }) {
    const state = aiState[article.id];
    const pickerOpen = aiFormatPicker[article.id] ?? false;

    if (state?.loading) {
      return (
        <div className="mt-2 flex items-center gap-2 px-2 py-1.5 bg-violet-900/20 border border-violet-700/30 rounded-lg">
          <Loader2 className="w-3 h-3 text-violet-400 animate-spin shrink-0" />
          <span className="text-[11px] text-violet-300">AI sedang memproses...</span>
        </div>
      );
    }

    if (state?.done) {
      return (
        <div className="mt-1 flex items-center gap-2 px-2 py-1 bg-emerald-900/15 border border-emerald-700/25 rounded-lg">
          <Sparkles className="w-3 h-3 text-emerald-400 shrink-0" />
          <span className="text-[11px] text-emerald-300 font-semibold">AI selesai — konten diperbarui</span>
        </div>
      );
    }

    if (state?.error) {
      return (
        <div className="mt-1 space-y-1">
          <div className="flex items-start gap-2 px-2 py-1.5 bg-red-900/20 border border-red-700/30 rounded-lg">
            <AlertCircle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
            <span className="text-[11px] text-red-300">{state.error}</span>
          </div>
          <button onClick={() => toggleAiPicker(article.id)}
            className="flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300 transition-colors">
            <Wand2 className="w-3 h-3" />Coba lagi
          </button>
        </div>
      );
    }

    return (
      <div className="mt-1 space-y-1.5">
        <button onClick={() => toggleAiPicker(article.id)}
          className={`flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-lg border transition-all ${
            pickerOpen
              ? "bg-violet-700/25 border-violet-500/50 text-violet-300"
              : "bg-violet-900/10 border-violet-700/25 text-violet-500 hover:text-violet-300 hover:bg-violet-900/20"
          }`}>
          <Wand2 className="w-3 h-3" />Perbaiki dengan AI
        </button>
        {pickerOpen && (
          <div className="bg-[#0a061a] border border-violet-800/40 rounded-xl p-2.5 space-y-2">
            <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Pilih format output</p>
            <div className="grid grid-cols-3 gap-1.5">
              {AI_FORMATS.map(fmt => (
                <button key={fmt.value} onClick={() => doAiFix(article, fmt.value)}
                  className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border text-[11px] font-semibold transition-all hover:opacity-90 active:scale-95"
                  style={{ background: fmt.activeBg, borderColor: fmt.activeBorder, color: fmt.activeColor }}>
                  {fmt.icon}{fmt.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-600 leading-relaxed">
              Mendukung teks Arab, Latin, dan campuran.
            </p>
          </div>
        )}
      </div>
    );
  }

  function ArticleCard({ article, isSelected, onToggle }: { article: KbResult; isSelected?: boolean; onToggle?: () => void }) {
    const status = articleStatus[article.id] || "pending";
    const loading = approveLoading[article.id] ?? false;
    const statusUi = STATUS_UI[status];
    const isExported = status === "exported";

    return (
      <div className={`bg-white/5 border rounded-xl px-3 py-2.5 space-y-2 transition-colors ${isSelected ? "border-violet-500/50 bg-violet-900/10" : "border-white/8"}`}>
        {/* Title row */}
        <div className="flex items-start gap-2">
          {onToggle !== undefined ? (
            <Checkbox checked={!!isSelected} onCheckedChange={onToggle} className="mt-0.5 shrink-0" />
          ) : (
            <Hash className="w-3 h-3 text-violet-400 shrink-0 mt-0.5" />
          )}
          <p className="text-xs text-slate-300 flex-1 font-medium leading-snug">{article.title || "(Tanpa Judul)"}</p>
          <div className="flex items-center gap-1.5 shrink-0 ml-1">
            <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded border ${statusUi.cls}`}>
              {statusUi.icon}{statusUi.label}
            </span>
            {article.source_url && (
              <a href={article.source_url} target="_blank" rel="noopener noreferrer"
                className="text-indigo-400 hover:text-indigo-300">
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>

        {/* Duplicate warning */}
        {article.is_duplicate && (
          <div className="flex items-start gap-1.5 text-[10px] text-orange-300 bg-orange-900/20 border border-orange-700/30 rounded-lg px-2 py-1.5 leading-snug">
            <AlertCircle className="w-3 h-3 shrink-0 mt-px" />
            <span>URL ini sudah ada di KB{article.duplicate_of_title ? `: "${article.duplicate_of_title}"` : ""}{article.duplicate_of_status ? ` (${article.duplicate_of_status})` : ""}. Pertimbangkan untuk menghapus artikel ini.</span>
          </div>
        )}

        {/* Approve / Reject buttons */}
        {!isExported && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => doApprove(article.id, status === "approved" ? "pending" : "approved")}
              disabled={loading}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-all disabled:opacity-50 ${
                status === "approved"
                  ? "bg-emerald-900/35 border-emerald-600/50 text-emerald-300"
                  : "bg-white/5 border-white/10 text-slate-400 hover:bg-emerald-900/20 hover:border-emerald-700/40 hover:text-emerald-300"
              }`}>
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsUp className="w-3 h-3" />}
              {status === "approved" ? "Approved" : "Approve"}
            </button>
            <button
              onClick={() => doApprove(article.id, status === "rejected" ? "pending" : "rejected")}
              disabled={loading}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-all disabled:opacity-50 ${
                status === "rejected"
                  ? "bg-red-900/35 border-red-600/50 text-red-300"
                  : "bg-white/5 border-white/10 text-slate-400 hover:bg-red-900/20 hover:border-red-700/40 hover:text-red-300"
              }`}>
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsDown className="w-3 h-3" />}
              {status === "rejected" ? "Rejected" : "Reject"}
            </button>
          </div>
        )}
        {isExported && (
          <div className="flex items-center gap-1.5 text-[11px] text-indigo-300">
            <CloudUpload className="w-3 h-3" />
            <span>Berhasil di-push ke Supabase</span>
          </div>
        )}

        <AiFixSection article={article} />
      </div>
    );
  }

  function ResultBox({ result, label }: { result: ScrapeResult | null; label: string }) {
    if (!result) return null;
    const articles = result.articles ?? (result.article ? [result.article] : []);
    const count = result.count ?? articles.length;
    const approvedCount = articles.filter(a => (articleStatus[a.id] || "pending") === "approved").length;
    const hasApproved = approvedCount > 0;

    const selectedIds: Set<string> = bulkSelected[label] ?? new Set();
    const deleteLoading = bulkDeleteLoading[label] ?? false;
    const deleteMsg = bulkDeleteMsg[label] ?? "";

    const shownArticles = articles.slice(0, 5);
    const allShownSelected = shownArticles.length > 0 && shownArticles.every(a => selectedIds.has(a.id));
    const someShownSelected = shownArticles.some(a => selectedIds.has(a.id));

    const toggleOne = (id: string) => {
      setBulkSelected(prev => {
        const cur = new Set(prev[label] ?? []);
        cur.has(id) ? cur.delete(id) : cur.add(id);
        return { ...prev, [label]: cur };
      });
    };

    const toggleAll = () => {
      setBulkSelected(prev => {
        const cur = new Set(prev[label] ?? []);
        if (allShownSelected) {
          shownArticles.forEach(a => cur.delete(a.id));
        } else {
          shownArticles.forEach(a => cur.add(a.id));
        }
        return { ...prev, [label]: cur };
      });
    };

    const doDeleteSelected = async () => {
      if (selectedIds.size === 0) return;
      if (!confirm(`Hapus ${selectedIds.size} artikel yang dipilih dari KB Draft? Tindakan ini tidak bisa dibatalkan.`)) return;
      setBulkDeleteLoading(prev => ({ ...prev, [label]: true }));
      setBulkDeleteMsg(prev => ({ ...prev, [label]: "" }));
      try {
        const res = await fetch(apiUrl("/kb/bulk-delete"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: Array.from(selectedIds) }),
        });
        const data = await res.json();
        if (res.ok) {
          setBulkDeleteMsg(prev => ({ ...prev, [label]: `${data.deleted} artikel berhasil dihapus dari KB Draft` }));
          setBulkSelected(prev => ({ ...prev, [label]: new Set() }));
          setTimeout(() => setBulkDeleteMsg(prev => ({ ...prev, [label]: "" })), 4000);
        }
      } catch {}
      setBulkDeleteLoading(prev => ({ ...prev, [label]: false }));
    };

    return (
      <div className={`rounded-xl border p-3.5 space-y-3 ${
        result.status === "ok"
          ? "bg-emerald-900/15 border-emerald-700/30"
          : "bg-red-900/15 border-red-700/30"
      }`}>
        {/* Status header */}
        <div className="flex items-start gap-2">
          {result.status === "ok"
            ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            : <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />}
          <div className="flex-1 min-w-0">
            {result.status === "ok" ? (
              <p className="text-sm font-semibold text-emerald-300">
                {count} artikel dari {label} disimpan ke KB Draft
              </p>
            ) : (
              <p className="text-sm font-semibold text-red-300">{result.error}</p>
            )}
          </div>
        </div>

        {result.status === "ok" && count > 0 && (
          <>
            {/* Workflow guide */}
            <div className="flex items-center gap-3 px-3 py-2 bg-black/30 border border-white/8 rounded-lg overflow-x-auto">
              {[
                { n: "1", txt: "Simpan", done: true },
                { n: "2", txt: "AI Fix", done: false },
                { n: "3", txt: "Approve", done: hasApproved },
                { n: "4", txt: "Push", done: false },
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-1.5 shrink-0">
                  {i > 0 && <ArrowRight className="w-2.5 h-2.5 text-slate-700 shrink-0" />}
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black shrink-0 ${
                    step.done ? "bg-emerald-600 text-white" : "bg-white/10 text-slate-500"
                  }`}>{step.done ? "✓" : step.n}</div>
                  <span className={`text-[11px] font-medium ${step.done ? "text-emerald-300" : "text-slate-500"}`}>{step.txt}</span>
                </div>
              ))}
            </div>

            {/* Article list with bulk select */}
            <div className="space-y-2">
              {/* Select-all bar */}
              {shownArticles.length > 1 && (
                <div className="flex items-center gap-2 px-1 pb-1 border-b border-white/8">
                  <Checkbox
                    checked={allShownSelected}
                    onCheckedChange={toggleAll}
                    className={someShownSelected && !allShownSelected ? "data-[state=checked]:bg-slate-400" : ""}
                  />
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex-1">
                    {selectedIds.size > 0 ? `${selectedIds.size} dari ${shownArticles.length} dipilih` : `Pilih semua (${shownArticles.length})`}
                  </span>
                  {selectedIds.size > 0 && (
                    <Button size="sm" disabled={deleteLoading}
                      onClick={doDeleteSelected}
                      className="h-6 px-2 text-[10px] rounded-full bg-red-700 hover:bg-red-800 text-white gap-1">
                      {deleteLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Trash2 className="w-3 h-3" />Hapus Terpilih</>}
                    </Button>
                  )}
                </div>
              )}
              {deleteMsg && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-300 bg-emerald-900/20 border border-emerald-700/30 px-2.5 py-1.5 rounded-lg">
                  <CheckCircle2 className="w-3.5 h-3.5" />{deleteMsg}
                </div>
              )}
              {shownArticles.map((a, i) => (
                <ArticleCard key={i} article={a}
                  isSelected={selectedIds.has(a.id)}
                  onToggle={() => toggleOne(a.id)}
                />
              ))}
              {count > 5 && (
                <p className="text-xs text-slate-500 pl-2">...dan {count - 5} lainnya tersimpan di KB</p>
              )}
            </div>

            {/* Push to Supabase section */}
            <div className="space-y-2 pt-1">
              {/* Push result banner */}
              {pushState.result && (
                <div className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border text-xs font-medium ${
                  pushState.result.ok
                    ? "bg-emerald-900/25 border-emerald-600/40 text-emerald-300"
                    : "bg-red-900/25 border-red-600/40 text-red-300"
                }`}>
                  {pushState.result.ok
                    ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    : <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                  {pushState.result.msg}
                </div>
              )}

              {/* Approve hint if none approved yet */}
              {!hasApproved && !pushState.result && (
                <p className="text-[11px] text-slate-500 text-center px-2">
                  Klik <span className="font-semibold text-emerald-400">Approve</span> pada artikel yang ingin dipush, lalu tekan tombol di bawah.
                </p>
              )}

              {/* Push button */}
              <button
                onClick={doPushApproved}
                disabled={pushState.loading || !hasApproved}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  hasApproved
                    ? "bg-indigo-700/30 border-indigo-600/50 text-indigo-200 hover:bg-indigo-700/40"
                    : "bg-white/5 border-white/10 text-slate-600"
                }`}>
                {pushState.loading
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Mendorong ke Supabase...</>
                  : <><CloudUpload className="w-3.5 h-3.5" />Push {hasApproved ? `${approvedCount} Artikel` : ""} ke Supabase</>
                }
              </button>

              <Link to="/review">
                <button className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 border border-white/8 hover:border-white/15 transition-colors">
                  Buka Review Dashboard <ArrowRight className="w-3 h-3" />
                </button>
              </Link>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-black text-white relative" style={{ minHeight: "100dvh" }}>

      {/* Background */}
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

      <div className="relative z-10 flex flex-col flex-1">

        {/* Header */}
        <div className="mx-2 sm:mx-4 lg:mx-6 mt-2 sm:mt-4 lg:mt-5 rounded-xl sm:rounded-2xl px-3 sm:px-5 lg:px-8 py-3 sm:py-4 flex items-center justify-between shrink-0"
          style={{ background: "linear-gradient(135deg, #1a0535 0%, #2f0c60 40%, #4a1890 100%)", border: "1px solid rgba(139,92,246,0.3)", boxShadow: "0 0 40px rgba(109,40,217,0.22), 0 4px 20px rgba(0,0,0,0.6)" }}>
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-1 text-white/70 hover:text-white hover:bg-white/15 -ml-1 h-8 px-2 lg:px-3 text-xs">
                <ChevronLeft className="w-3.5 h-3.5" /><span className="hidden sm:inline">Beranda</span>
              </Button>
            </Link>
            <div className="min-w-0 leading-none">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="font-bold text-white text-base lg:text-xl tracking-tight">Sumber Tambahan</p>
                <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full shrink-0"
                  style={{ background: "rgba(139,92,246,0.25)", border: "1px solid rgba(167,139,250,0.4)", color: "rgba(196,181,253,0.9)" }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />AINA
                </span>
              </div>
              <p className="text-violet-300/70 text-[11px] lg:text-[13px]">YouTube · DOCX · RSS · Telegram</p>
            </div>
          </div>
          <Link to="/review">
            <Button variant="ghost" size="sm"
              className="gap-1 text-white/60 hover:text-white hover:bg-white/10 h-8 px-2 sm:px-3 text-xs rounded-full">
              <CheckCircle2 className="w-3.5 h-3.5" /><span className="hidden sm:inline text-xs">Review</span>
            </Button>
          </Link>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6 pb-nav-safe">
          <div className="max-w-2xl mx-auto space-y-3 sm:space-y-4">

            {/* Tab selector */}
            <div className="flex items-center gap-1 bg-[#0d0720] rounded-xl p-1 border border-violet-700/30 overflow-x-auto">
              {TAB_CONFIG.map(t => (
                <button key={t.id} onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-1.5 flex-1 justify-center text-xs px-2.5 py-2 rounded-lg font-semibold transition-all whitespace-nowrap ${
                    activeTab === t.id
                      ? "bg-violet-600 text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-200 hover:bg-white/8"
                  }`}>
                  {t.icon}{t.label}
                </button>
              ))}
            </div>

            {/* ── YouTube Tab ── */}
            {activeTab === "youtube" && (
              <div className="bg-[#0d0720] rounded-2xl border border-violet-700/40 overflow-hidden"
                style={{ boxShadow: "0 0 24px rgba(109,40,217,0.14)" }}>
                <div className="h-[3px] bg-gradient-to-r from-red-600 via-red-400 to-red-600" />
                <div className="p-4 sm:p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-red-900/40 border border-red-500/30 flex items-center justify-center shrink-0">
                      <Youtube className="w-4 h-4 text-red-400" />
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-sm">YouTube Transcript</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Ambil transkrip video YouTube → KB Draft → Approve → Push Supabase.</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">URL Video YouTube</label>
                    <div className="flex gap-2">
                      <Input value={ytUrl} onChange={e => setYtUrl(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && doYoutube()}
                        placeholder="https://www.youtube.com/watch?v=..."
                        className="flex-1 h-9 text-xs bg-[#0f0a1e] border-violet-800/40 text-slate-200 rounded-xl placeholder:text-slate-600 focus-visible:ring-red-400/40" />
                      <Button onClick={doYoutube} disabled={ytLoading || !ytUrl.trim()}
                        className="h-9 px-4 bg-red-700 hover:bg-red-600 text-white text-xs rounded-xl shrink-0 disabled:opacity-50">
                        {ytLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Ambil"}
                      </Button>
                    </div>
                    {/* Syarat video yang bisa diambil transkrip */}
                    <div className="flex items-start gap-2 px-3 py-2 bg-amber-950/25 border border-amber-800/30 rounded-lg">
                      <AlertCircle className="w-3 h-3 text-amber-500/80 shrink-0 mt-0.5" />
                      <p className="text-[10px] text-amber-300/60 leading-relaxed">
                        Hanya video yang memiliki <span className="font-semibold text-amber-300/80">subtitle/CC aktif</span> yang bisa diambil transkrip-nya. Video tanpa CC (kebanyakan konten Indonesia/live/musik) tidak didukung.
                      </p>
                    </div>
                  </div>
                  {/* Tip saat error CC tidak tersedia */}
                  {ytResult?.status === "error" && ytResult.hint === "no_cc" && (
                    <div className="bg-amber-950/30 border border-amber-700/40 rounded-xl px-3 py-2.5 space-y-1">
                      <p className="text-[11px] font-semibold text-amber-300">Tips: Video yang biasanya punya CC</p>
                      <ul className="text-[10px] text-amber-300/70 space-y-0.5 list-disc list-inside">
                        <li>Channel berita internasional (BBC, Al Jazeera, DW)</li>
                        <li>TED Talks & konferensi akademik</li>
                        <li>Ceramah/kajian dengan subtitle manual</li>
                        <li>Video berbahasa Inggris umumnya punya auto-CC</li>
                        <li>Cek ikon <span className="font-semibold">CC</span> di player YouTube sebelum ambil</li>
                      </ul>
                    </div>
                  )}
                  {ytLoading && (
                    <div className="flex items-center gap-2 text-xs text-slate-400 bg-white/5 rounded-xl px-3 py-2.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />Mengambil transkrip YouTube...
                    </div>
                  )}
                  <ResultBox result={ytResult} label="YouTube" />
                  {ytResult && (
                    <button onClick={() => { setYtUrl(""); setYtResult(null); }}
                      className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
                      <RefreshCw className="w-3 h-3" />Reset
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── DOCX Tab ── */}
            {activeTab === "docx" && (
              <div className="bg-[#0d0720] rounded-2xl border border-violet-700/40 overflow-hidden"
                style={{ boxShadow: "0 0 24px rgba(109,40,217,0.14)" }}>
                <div className="h-[3px] bg-gradient-to-r from-blue-600 via-blue-400 to-blue-600" />
                <div className="p-4 sm:p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-900/40 border border-blue-500/30 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-blue-400" />
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-sm">Word / DOCX Parser</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Upload file .docx → KB Draft → Approve → Push Supabase.</p>
                    </div>
                  </div>
                  <div
                    onDragOver={e => { e.preventDefault(); setDocxDrag(true); }}
                    onDragLeave={() => setDocxDrag(false)}
                    onDrop={e => { e.preventDefault(); setDocxDrag(false); addDocxFiles(e.dataTransfer.files); }}
                    onClick={() => docxRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center gap-2 cursor-pointer transition-colors ${
                      docxDrag ? "border-blue-500/70 bg-blue-900/20" : "border-blue-800/40 bg-blue-950/20 hover:border-blue-600/50 hover:bg-blue-900/15"
                    }`}>
                    <Upload className="w-5 h-5 text-blue-400" />
                    <p className="text-xs text-blue-300/70 font-medium">Drag & drop atau klik untuk pilih</p>
                    <p className="text-[10px] text-slate-600">.docx — bisa banyak file sekaligus</p>
                    <input ref={docxRef} type="file" className="hidden" multiple accept=".docx"
                      onChange={e => addDocxFiles(e.target.files)} />
                  </div>
                  {docxFiles.length > 0 && (
                    <div className="space-y-1.5">
                      {docxFiles.map(f => (
                        <div key={f.name} className="flex items-center gap-2 bg-blue-950/30 border border-blue-800/30 rounded-lg px-3 py-1.5">
                          <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          <p className="flex-1 text-xs text-slate-300 truncate">{f.name}</p>
                          <span className="text-[10px] text-slate-600 shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                          <button onClick={() => setDocxFiles(prev => prev.filter(x => x.name !== f.name))}
                            className="text-slate-600 hover:text-red-400 transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      <Button onClick={doDocx} disabled={docxLoading}
                        className="w-full h-9 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded-xl disabled:opacity-50">
                        {docxLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />Memproses...</> : `Proses ${docxFiles.length} File`}
                      </Button>
                    </div>
                  )}
                  {docxLoading && (
                    <div className="flex items-center gap-2 text-xs text-slate-400 bg-white/5 rounded-xl px-3 py-2.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />Mengekstrak konten dokumen...
                    </div>
                  )}
                  <ResultBox result={docxResult} label="DOCX" />
                  {docxResult && (
                    <button onClick={() => { setDocxFiles([]); setDocxResult(null); }}
                      className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
                      <RefreshCw className="w-3 h-3" />Reset
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── RSS Tab ── */}
            {activeTab === "rss" && (
              <div className="bg-[#0d0720] rounded-2xl border border-violet-700/40 overflow-hidden"
                style={{ boxShadow: "0 0 24px rgba(109,40,217,0.14)" }}>
                <div className="h-[3px] bg-gradient-to-r from-orange-600 via-orange-400 to-orange-600" />
                <div className="p-4 sm:p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-orange-900/40 border border-orange-500/30 flex items-center justify-center shrink-0">
                      <Rss className="w-4 h-4 text-orange-400" />
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-sm">RSS / Atom Feed</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Ambil artikel dari feed RSS/Atom → KB Draft → Approve → Push Supabase.</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">URL Feed RSS / Atom</label>
                      <Input value={rssUrl} onChange={e => setRssUrl(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && doRss()}
                        placeholder="https://example.com/feed.xml"
                        className="h-9 text-xs bg-[#0f0a1e] border-violet-800/40 text-slate-200 rounded-xl placeholder:text-slate-600 focus-visible:ring-orange-400/40" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">Maks. Artikel</label>
                      <div className="flex items-center gap-3 bg-[#0f0a1e] border border-violet-800/40 rounded-xl px-3.5 py-2.5">
                        <span className="text-xs text-slate-500 flex-1">Item per fetch</span>
                        <span className="text-sm font-bold text-orange-300 tabular-nums w-8 text-right">{rssMax}</span>
                        <input type="range" min={1} max={50} step={1} value={rssMax}
                          onChange={e => setRssMax(Number(e.target.value))}
                          className="w-28 accent-orange-500 cursor-pointer" />
                      </div>
                    </div>
                    <Button onClick={doRss} disabled={rssLoading || !rssUrl.trim()}
                      className="w-full h-9 bg-orange-700 hover:bg-orange-600 text-white text-xs rounded-xl disabled:opacity-50">
                      {rssLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />Mengambil Feed...</> : "Fetch RSS Feed"}
                    </Button>
                  </div>
                  <ResultBox result={rssResult} label="RSS" />
                  {rssResult && (
                    <button onClick={() => { setRssUrl(""); setRssResult(null); }}
                      className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
                      <RefreshCw className="w-3 h-3" />Reset
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── Telegram Tab ── */}
            {activeTab === "telegram" && (
              <div className="bg-[#0d0720] rounded-2xl border border-violet-700/40 overflow-hidden"
                style={{ boxShadow: "0 0 24px rgba(109,40,217,0.14)" }}>
                <div className="h-[3px] bg-gradient-to-r from-sky-600 via-sky-400 to-sky-600" />
                <div className="p-4 sm:p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-sky-900/40 border border-sky-500/30 flex items-center justify-center shrink-0">
                      <Send className="w-4 h-4 text-sky-400" />
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-sm">Telegram Channel Scraper</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Scrape channel Telegram publik → KB Draft → Approve → Push Supabase.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 text-[11px] text-sky-300 bg-sky-900/20 border border-sky-700/30 rounded-xl px-3 py-2.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>Hanya bekerja untuk <strong>channel publik</strong>. Channel privat tidak bisa diakses.</span>
                  </div>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">Username Channel Telegram</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-semibold select-none">@</span>
                        <Input value={tgChannel}
                          onChange={e => setTgChannel(e.target.value.replace(/^@/, ""))}
                          onKeyDown={e => e.key === "Enter" && doTelegram()}
                          placeholder="namachannel"
                          className="h-9 text-xs bg-[#0f0a1e] border-violet-800/40 text-slate-200 rounded-xl placeholder:text-slate-600 focus-visible:ring-sky-400/40 pl-7" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">Jumlah Postingan</label>
                      <div className="flex items-center gap-3 bg-[#0f0a1e] border border-violet-800/40 rounded-xl px-3.5 py-2.5">
                        <span className="text-xs text-slate-500 flex-1">Post yang diambil</span>
                        <span className="text-sm font-bold text-sky-300 tabular-nums w-8 text-right">{tgLimit}</span>
                        <input type="range" min={5} max={50} step={5} value={tgLimit}
                          onChange={e => setTgLimit(Number(e.target.value))}
                          className="w-28 accent-sky-500 cursor-pointer" />
                      </div>
                    </div>
                    <Button onClick={doTelegram} disabled={tgLoading || !tgChannel.trim()}
                      className="w-full h-9 bg-sky-700 hover:bg-sky-600 text-white text-xs rounded-xl disabled:opacity-50">
                      {tgLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />Scraping Channel...</> : "Scrape Channel"}
                    </Button>
                  </div>
                  <ResultBox result={tgResult} label="Telegram" />
                  {tgResult && (
                    <button onClick={() => { setTgChannel(""); setTgResult(null); }}
                      className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
                      <RefreshCw className="w-3 h-3" />Reset
                    </button>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
