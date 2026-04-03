import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import {
  Newspaper, Zap, FileJson, FileText, Loader2, ExternalLink,
  BookOpen, CheckCircle2, Sparkles, Database, Upload, Settings2,
  ChevronDown, ChevronUp, Save, RotateCcw, Tag, AlignLeft,
  ClipboardList, Download, RefreshCw, CheckSquare, Terminal,
  AlertCircle, Circle, ArrowRight, BarChart3, Eye,
  Clock, CalendarDays, Play, ToggleLeft, ToggleRight, Timer,
  LayoutList, FileCode2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface Article {
  id: string;
  title: string;
  date: string;
  url: string;
  content: string;
  status: "success" | "partial" | "failed" | "duplicate";
  error_reason?: string;
  mode?: string;
  summary?: string;
  tags?: string[];
}

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
  approval_status: string;
}

interface ScrapeProgress {
  running: boolean;
  phase: "idle" | "listing" | "scraping" | "done";
  current: number;
  total: number;
  success: number;
  partial: number;
  failed: number;
  duplicate: number;
  logs: string[];
}

interface ScraperSettings {
  article_link_selector: string;
  next_page_selector: string;
  title_selector: string;
  date_selector: string;
  content_selector: string;
}

interface SchedulerSettings {
  enabled: boolean;
  interval: "manual" | "daily" | "weekly";
  day_of_week: string;
  time_of_day: string;
  url: string;
  scrape_mode: string;
  incremental: boolean;
  last_run_at: string | null;
  last_run_articles_added: number;
  last_run_url: string;
  last_run_mode: string;
  next_run_at: string | null;
}

const DEFAULT_SCHEDULER_SETTINGS: SchedulerSettings = {
  enabled: false,
  interval: "manual",
  day_of_week: "mon",
  time_of_day: "06:00",
  url: "",
  scrape_mode: "full",
  incremental: true,
  last_run_at: null,
  last_run_articles_added: 0,
  last_run_url: "",
  last_run_mode: "full",
  next_run_at: null,
};

const DEFAULT_SETTINGS: ScraperSettings = {
  article_link_selector: 'a[href*="/berita/"]',
  next_page_selector: 'a[rel="next"], a.next, .pagination a',
  title_selector: "h1, h2, .title, .news-title, .post-title",
  date_selector: ".date, .news-date, time, .published-date, .post-date",
  content_selector: ".ck-content, .post-content, .news-content, .article-content, .content, article, .entry-content",
};

const MODES = [
  { value: "list", label: "List Only", desc: "Ambil title, date & URL saja (cepat)" },
  { value: "full", label: "Full Article", desc: "Ambil title, date, URL & konten lengkap" },
  { value: "kb", label: "KB Mode", desc: "Full article + langsung siap untuk Knowledge Base" },
];

const ERROR_REASON_LABELS: Record<string, string> = {
  timeout: "Timeout",
  blocked: "Diblokir",
  selector_not_found: "Selector Tidak Ditemukan",
  empty_content: "Konten Kosong",
  duplicate: "Duplikat",
  request_failed: "Request Gagal",
  parse_failed: "Parse Gagal",
  date_unknown: "Tanggal Tidak Dikenal",
};

const SCRAPE_RANGES = [
  { value: "all",     label: "Semua Artikel",    desc: "Tanpa filter tanggal" },
  { value: "last_7",  label: "7 Hari Terakhir",  desc: "Artikel 7 hari ke belakang" },
  { value: "last_30", label: "30 Hari Terakhir", desc: "Artikel 30 hari ke belakang" },
  { value: "custom",  label: "Rentang Kustom",   desc: "Pilih tanggal mulai dan selesai" },
];

const APPROVAL_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  reviewed: "bg-blue-100 text-blue-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
  exported: "bg-indigo-100 text-indigo-700",
};

const SELECTOR_FIELDS: { key: keyof ScraperSettings; label: string; hint: string }[] = [
  { key: "article_link_selector", label: "Article Link Selector", hint: "Selector untuk link artikel di halaman list." },
  { key: "next_page_selector", label: "Next Page Selector", hint: "Selector untuk tombol halaman berikutnya (pagination)." },
  { key: "title_selector", label: "Title Selector", hint: "Selector untuk judul artikel." },
  { key: "date_selector", label: "Date Selector", hint: "Selector untuk tanggal artikel." },
  { key: "content_selector", label: "Content Selector", hint: "Selector untuk konten/isi artikel." },
];

function StatusBadge({ status }: { status: Article["status"] }) {
  if (status === "success")
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />Berhasil
      </span>
    );
  if (status === "partial")
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />Partial
      </span>
    );
  if (status === "duplicate")
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />Duplikat
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />Gagal
    </span>
  );
}

function StepBadge({ n, done }: { n: number; done?: boolean }) {
  return done ? (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500 text-white shrink-0 shadow-sm">
      <CheckCircle2 className="w-4 h-4" />
    </span>
  ) : (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-600 text-white text-xs font-bold shrink-0 shadow-sm">{n}</span>
  );
}

function logColor(line: string): string {
  const l = line.toLowerCase();
  if (l.includes("✅") || l.includes("berhasil") || l.includes("sukses") || l.includes("success")) return "text-emerald-400";
  if (l.includes("❌") || l.includes("gagal") || l.includes("error") || l.includes("failed")) return "text-red-400";
  if (l.includes("⚠️") || l.includes("partial") || l.includes("warning")) return "text-amber-400";
  if (l.includes("🔄") || l.includes("duplikat") || l.includes("duplicate") || l.includes("skip")) return "text-slate-400";
  if (l.includes("📦") || l.includes("export") || l.includes("selesai") || l.includes("done")) return "text-indigo-400";
  if (l.includes("🔍") || l.includes("menemukan") || l.includes("found")) return "text-sky-400";
  return "text-slate-300";
}

const Index = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [mode, setMode] = useState("full");
  const [scrapeRange, setScrapeRange] = useState("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [progress, setProgress] = useState<ScrapeProgress>({
    running: false, phase: "idle", current: 0, total: 0,
    success: 0, partial: 0, failed: 0, duplicate: 0, logs: [],
  });
  const [articles, setArticles] = useState<Article[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(true);
  const [justFinished, setJustFinished] = useState(false);

  const [viewMode, setViewMode] = useState<"table" | "markdown">("table");
  const [titleFilter, setTitleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [settings, setSettings] = useState<ScraperSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");

  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryDone, setSummaryDone] = useState(false);
  const [summaryResult, setSummaryResult] = useState<{ updated: number; total: number } | null>(null);
  const [summaryError, setSummaryError] = useState("");

  const [tagLoading, setTagLoading] = useState(false);
  const [tagDone, setTagDone] = useState(false);
  const [tagError, setTagError] = useState("");

  const [kbLoading, setKbLoading] = useState(false);
  const [kbDone, setKbDone] = useState(false);
  const [kbCount, setKbCount] = useState(0);
  const [kbError, setKbError] = useState("");

  const [kbDraft, setKbDraft] = useState<KbDraft[]>([]);
  const [kbDraftLoading, setKbDraftLoading] = useState(false);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiDone, setAiDone] = useState(false);
  const [aiError, setAiError] = useState("");

  const [pushLoading, setPushLoading] = useState(false);
  const [pushDone, setPushDone] = useState(false);
  const [pushCount, setPushCount] = useState(0);
  const [pushError, setPushError] = useState("");
  const [dbArticles, setDbArticles] = useState<any[]>([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbError, setDbError] = useState("");

  const [schedulerSettings, setSchedulerSettings] = useState<SchedulerSettings>(DEFAULT_SCHEDULER_SETTINGS);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [schedulerSaving, setSchedulerSaving] = useState(false);
  const [schedulerRunNow, setSchedulerRunNow] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const wasRunningRef = useRef(false);

  const fetchArticles = useCallback(async () => {
    try {
      const res = await fetch("/api/articles");
      if (res.ok) setArticles(await res.json());
    } catch {}
    setLoadingArticles(false);
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch("/settings");
      if (res.ok) setSettings(await res.json());
    } catch {}
  };

  const fetchKbDraft = async () => {
    setKbDraftLoading(true);
    try {
      const res = await fetch("/api/kb-draft");
      if (res.ok) {
        const data = await res.json();
        setKbDraft(data);
        if (data.length > 0) setKbDone(true);
      }
    } catch {}
    setKbDraftLoading(false);
  };

  const fetchSchedulerSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/scheduler/settings");
      if (res.ok) {
        const data = await res.json();
        setSchedulerSettings(prev => ({ ...prev, ...data }));
      }
    } catch {}
  }, []);

  const saveSchedulerSettings = async () => {
    setSchedulerSaving(true);
    try {
      const res = await fetch("/api/scheduler/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(schedulerSettings),
      });
      if (res.ok) {
        const data = await res.json();
        setSchedulerSettings(prev => ({ ...prev, ...data.settings }));
        toast({
          title: "Pengaturan disimpan",
          description: schedulerSettings.interval === "manual"
            ? "Scheduler dinonaktifkan (mode manual)."
            : `Scraping dijadwalkan ${schedulerSettings.interval === "daily" ? "setiap hari" : "setiap minggu"} pukul ${schedulerSettings.time_of_day}.`,
        });
      } else {
        toast({ title: "Gagal menyimpan", description: "Coba lagi.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Gagal menyimpan", description: "Tidak dapat terhubung ke server.", variant: "destructive" });
    }
    setSchedulerSaving(false);
  };

  const triggerRunNow = async () => {
    setSchedulerRunNow(true);
    try {
      const res = await fetch("/api/scheduler/run-now", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Scraping dimulai", description: "Menggunakan URL dan mode dari pengaturan scheduler." });
        await fetchArticles();
      } else {
        toast({ title: "Gagal", description: data.error || "Tidak bisa memulai scraping.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Gagal", description: "Tidak dapat terhubung ke server.", variant: "destructive" });
    }
    setSchedulerRunNow(false);
  };

  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const pollProgress = useCallback(async () => {
    try {
      const res = await fetch("/api/progress");
      if (!res.ok) return;
      const data: ScrapeProgress = await res.json();
      setProgress(data);
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
      if (wasRunningRef.current && !data.running && data.phase === "done") {
        stopPoll();
        setJustFinished(true);
        await fetchArticles();
        toast({
          title: "Scraping selesai!",
          description: `${data.success} berhasil · ${data.partial} partial · ${data.failed} gagal · ${data.duplicate} duplikat`,
        });
      }
      wasRunningRef.current = data.running;
    } catch {}
  }, [fetchArticles, toast]);

  useEffect(() => {
    fetchArticles();
    fetchSettings();
    fetchKbDraft();
    fetchSchedulerSettings();
    pollProgress();
    return () => stopPoll();
  }, []);

  const startScrape = async () => {
    setUrlError("");
    if (!url.trim()) { setUrlError("URL tidak boleh kosong."); return; }
    if (!url.startsWith("http")) { setUrlError("URL tidak valid, harus dimulai dengan http:// atau https://"); return; }
    if (scrapeRange === "custom" && !customStart && !customEnd) {
      setUrlError("Pilih setidaknya satu tanggal untuk Rentang Kustom.");
      return;
    }
    setJustFinished(false);
    try {
      const body: Record<string, string> = { url, mode, date_filter: scrapeRange };
      if (scrapeRange === "custom") {
        if (customStart) body.start_date = customStart;
        if (customEnd) body.end_date = customEnd;
      }
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setUrlError(data.error || "Terjadi kesalahan."); return; }
      wasRunningRef.current = true;
      pollRef.current = setInterval(pollProgress, 1000);
    } catch {
      setUrlError("Tidak bisa menghubungi server. Pastikan backend berjalan.");
    }
  };

  const saveSettings = async () => {
    setSettingsSaving(true); setSettingsError("");
    try {
      const res = await fetch("/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) { setSettingsError(data.error || "Gagal menyimpan settings."); }
      else {
        setSettings(data.settings);
        toast({ title: "Settings tersimpan", description: "Konfigurasi selector berhasil diperbarui." });
        setSettingsOpen(false);
      }
    } catch { setSettingsError("Tidak bisa menghubungi server."); }
    finally { setSettingsSaving(false); }
  };

  const resetSettings = async () => {
    setSettings(DEFAULT_SETTINGS);
    try {
      await fetch("/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(DEFAULT_SETTINGS),
      });
      toast({ title: "Settings direset", description: "Konfigurasi selector dikembalikan ke default." });
    } catch {}
  };

  const doGenerateSummary = async () => {
    setSummaryLoading(true); setSummaryError(""); setSummaryDone(false); setSummaryResult(null);
    try {
      const res = await fetch("/api/generate-summary", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setSummaryError(data.error || "Gagal generate summary.");
      else {
        setSummaryDone(true); setSummaryResult(data); fetchArticles();
        toast({ title: "Summary berhasil", description: `${data.updated} artikel diberi summary.` });
      }
    } catch { setSummaryError("Tidak bisa menghubungi server."); }
    finally { setSummaryLoading(false); }
  };

  const doAutoTag = async () => {
    setTagLoading(true); setTagError(""); setTagDone(false);
    try {
      const res = await fetch("/api/auto-tag", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setTagError(data.error || "Gagal auto tag.");
      else {
        setTagDone(true); fetchArticles();
        toast({ title: "Auto-tagging selesai", description: "Semua artikel berhasil di-tag." });
      }
    } catch { setTagError("Tidak bisa menghubungi server."); }
    finally { setTagLoading(false); }
  };

  const doConvertKb = async () => {
    setKbLoading(true); setKbError(""); setKbDone(false);
    try {
      const res = await fetch("/api/convert-kb", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setKbError(data.error || "Gagal mengkonversi.");
      else {
        setKbDone(true); setKbCount(data.count);
        await fetchKbDraft();
        toast({ title: "KB Draft dibuat", description: `${data.count} artikel berhasil dikonversi ke KB Draft.` });
      }
    } catch { setKbError("Tidak bisa menghubungi server."); }
    finally { setKbLoading(false); }
  };

  const generateAiSummaries = async () => {
    setAiLoading(true); setAiError(""); setAiDone(false);
    try {
      const res = await fetch("/api/ai-summary-all", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setAiError(data.error || "Gagal generate AI summary.");
      else {
        setAiDone(true); await fetchKbDraft();
        toast({ title: "AI Summary selesai", description: "Summary GPT-4o-mini berhasil disimpan." });
      }
    } catch { setAiError("Tidak bisa menghubungi server."); }
    finally { setAiLoading(false); }
  };

  const pushToSupabase = async () => {
    setPushLoading(true); setPushError(""); setPushDone(false);
    try {
      const res = await fetch("/api/push-supabase", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setPushError(data.error || "Gagal push ke Supabase.");
      else {
        setPushDone(true); setPushCount(data.inserted || 0);
        toast({ title: "Push ke Supabase berhasil", description: `${data.inserted || 0} artikel berhasil di-insert.` });
      }
    } catch { setPushError("Tidak bisa menghubungi server."); }
    finally { setPushLoading(false); }
  };

  const fetchDbArticles = async () => {
    setDbLoading(true); setDbError("");
    try {
      const res = await fetch("/api/db-articles");
      const data = await res.json();
      if (!res.ok) setDbError(data.error || "Gagal mengambil data.");
      else setDbArticles(data);
    } catch { setDbError("Tidak bisa menghubungi server."); }
    finally { setDbLoading(false); }
  };

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const isRunning = progress.running;

  const filteredArticles = articles.filter(a => {
    if (titleFilter && !a.title.toLowerCase().includes(titleFilter.toLowerCase())) return false;
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (dateFrom || dateTo) {
      const raw = a.date || "";
      const isoMatch = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
      const dmyMatch = raw.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
      let articleIso = "";
      if (isoMatch) articleIso = isoMatch[0];
      else if (dmyMatch) articleIso = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
      if (articleIso) {
        if (dateFrom && articleIso < dateFrom) return false;
        if (dateTo && articleIso > dateTo) return false;
      }
    }
    return true;
  });

  const hasActiveFilter = titleFilter || statusFilter !== "all" || dateFrom || dateTo;
  const clearFilters = () => { setTitleFilter(""); setStatusFilter("all"); setDateFrom(""); setDateTo(""); };

  const statSucc = progress.phase !== "idle" ? progress.success : articles.filter(a => a.status === "success").length;
  const statPart = progress.phase !== "idle" ? progress.partial : articles.filter(a => a.status === "partial").length;
  const statFail = progress.phase !== "idle" ? progress.failed : articles.filter(a => a.status === "failed").length;
  const statDupe = progress.phase !== "idle" ? progress.duplicate : 0;
  const statTotal = progress.phase !== "idle" ? progress.total : articles.length;

  const eligibleArticles = articles.filter(a => a.status === "success" || a.status === "partial");

  const phaseLabel: Record<string, string> = {
    idle: "Siap",
    listing: "Mengumpulkan daftar artikel...",
    scraping: `Scraping artikel ${progress.current} dari ${progress.total}`,
    done: "Scraping selesai!",
  };

  const DOW_LABELS: Record<string, string> = {
    mon: "Senin", tue: "Selasa", wed: "Rabu", thu: "Kamis",
    fri: "Jumat", sat: "Sabtu", sun: "Minggu",
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#f0f0f2] text-slate-900">

      {/* ─── Left Icon Sidebar ─── */}
      <aside className="w-[68px] shrink-0 bg-white border-r border-gray-100 flex flex-col items-center py-5 z-20 shadow-sm">
        {/* Logo */}
        <div className="w-11 h-11 bg-gradient-to-br from-[#1a0533] to-[#3d1480] rounded-2xl flex items-center justify-center mb-5 shadow-md shadow-purple-900/20">
          <img src="/AIGYPT.png" alt="AINA" className="w-7 h-7 object-contain"
            style={{ filter: "invert(1) brightness(0.95) drop-shadow(0 0 2px rgba(200,160,255,0.5))" }} />
        </div>

        {/* Nav icons */}
        <div className="flex flex-col gap-1.5 w-full px-3">
          <div className="w-full flex items-center justify-center h-10 bg-slate-900 text-white rounded-xl shadow-sm cursor-default" title="Scraper">
            <Newspaper className="w-[18px] h-[18px]" />
          </div>
          <Link to="/review" className="w-full">
            <div data-testid="link-review-sidebar"
              className="w-full flex items-center justify-center h-10 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 rounded-xl transition-colors cursor-pointer"
              title="Review KB">
              <CheckSquare className="w-[18px] h-[18px]" />
            </div>
          </Link>
        </div>

        <div className="flex-1" />

        {/* Bottom: Export icons */}
        <div className="flex flex-col gap-1.5 w-full px-3">
          <a href="/export/json" download data-testid="button-export-json" className="w-full">
            <div className="w-full flex items-center justify-center h-10 text-slate-400 hover:bg-slate-100 hover:text-slate-600 rounded-xl transition-colors" title="Export JSON">
              <FileJson className="w-[18px] h-[18px]" />
            </div>
          </a>
          <a href="/export/csv" download data-testid="button-export-csv" className="w-full">
            <div className="w-full flex items-center justify-center h-10 text-slate-400 hover:bg-slate-100 hover:text-slate-600 rounded-xl transition-colors" title="Export CSV">
              <FileText className="w-[18px] h-[18px]" />
            </div>
          </a>
        </div>
      </aside>

      {/* ─── Main Content Area ─── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* ─── Dark Header Card ─── */}
        <div className="mx-4 mt-4 bg-gradient-to-r from-[#1a0533] via-[#2e0d5e] to-[#3d1480] rounded-2xl px-5 py-3.5 flex items-center justify-between shrink-0 shadow-lg shadow-purple-900/20">
          <div className="leading-none">
            <p className="font-bold text-white text-sm tracking-tight">AINA Scraper</p>
            <p className="text-purple-300 text-[11px] mt-0.5">Internal Knowledge Scraping Tool</p>
          </div>
          {schedulerSettings.enabled && schedulerSettings.interval !== "manual" && (
            <div className="hidden lg:flex items-center gap-1.5 bg-white/15 rounded-full px-3 py-1.5 text-xs text-white backdrop-blur-sm">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
              </span>
              Scheduler aktif · {schedulerSettings.interval === "daily" ? "Harian" : "Mingguan"} {schedulerSettings.time_of_day}
              {schedulerSettings.next_run_at && (
                <span className="text-indigo-200 font-medium ml-1">
                  · next: {new Date(schedulerSettings.next_run_at).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })}
                </span>
              )}
            </div>
          )}
          <Link to="/review">
            <Button data-testid="link-review-dashboard" size="sm"
              className="gap-1.5 bg-white text-[#2e0d5e] hover:bg-white/90 h-8 text-xs px-4 font-semibold shadow-sm rounded-full">
              <CheckSquare className="w-3.5 h-3.5" />Review KB Draft
            </Button>
          </Link>
        </div>

        {/* ─── Scrollable Content ─── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-w-0">

          {/* ── URL Input Card ── */}
          <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold text-indigo-400 uppercase tracking-widest">URL Halaman Berita</Label>
              <Input data-testid="input-url" type="url"
                placeholder="https://www.kemlu.go.id/cairo/berita"
                value={url} onChange={e => { setUrl(e.target.value); setUrlError(""); }}
                onKeyDown={e => e.key === "Enter" && !isRunning && startScrape()}
                disabled={isRunning}
                className={`h-10 rounded-xl border-slate-200 bg-slate-50 text-sm focus-visible:ring-2 ${urlError ? "border-red-400 focus-visible:ring-red-300" : "focus-visible:ring-indigo-300"}`} />
              {urlError && (
                <p className="text-red-500 text-xs flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />{urlError}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Select value={mode} onValueChange={setMode} disabled={isRunning}>
                <SelectTrigger data-testid="select-mode" className="w-44 h-10 rounded-xl border-slate-200 bg-slate-50 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {MODES.map(m => (
                    <SelectItem key={m.value} value={m.value}>
                      <div>
                        <p className="font-medium">{m.label}</p>
                        <p className="text-xs text-slate-400">{m.desc}</p>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button data-testid="button-start-scrape" onClick={startScrape}
                disabled={isRunning}
                className="h-10 px-6 rounded-full bg-gradient-to-r from-indigo-600 to-violet-500 hover:from-indigo-700 hover:to-violet-600 text-white gap-2 font-semibold shadow-md shadow-indigo-300/40 transition-all duration-200 hover:scale-[1.02]">
                {isRunning
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Scraping...</>
                  : <><Zap className="w-4 h-4" />Mulai Scraping</>}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest shrink-0">Rentang</span>
              <Select value={scrapeRange} onValueChange={setScrapeRange} disabled={isRunning}>
                <SelectTrigger data-testid="select-scrape-range" className="w-40 h-8 rounded-full bg-slate-100 border-slate-200 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCRAPE_RANGES.map(r => (
                    <SelectItem key={r.value} value={r.value}>
                      <div>
                        <p className="font-medium">{r.label}</p>
                        <p className="text-xs text-slate-400">{r.desc}</p>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {scrapeRange === "custom" && (
                <>
                  <Input data-testid="input-custom-start" type="date" value={customStart}
                    onChange={e => setCustomStart(e.target.value)} disabled={isRunning}
                    className="w-36 h-8 text-xs bg-slate-50 border-slate-200" />
                  <Input data-testid="input-custom-end" type="date" value={customEnd}
                    onChange={e => setCustomEnd(e.target.value)} disabled={isRunning}
                    className="w-36 h-8 text-xs bg-slate-50 border-slate-200" />
                </>
              )}
              {scrapeRange !== "all" && (
                <span className="text-[11px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-full">
                  {SCRAPE_RANGES.find(r => r.value === scrapeRange)?.label}
                </span>
              )}
              <span className="ml-auto text-xs text-slate-400 hidden lg:block">
                {MODES.find(m => m.value === mode)?.label} — {MODES.find(m => m.value === mode)?.desc}
              </span>
            </div>
          </div>

          {/* ── Stats Row ── */}
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: "Total",    value: statTotal, numColor: "text-slate-800",   accent: "bg-slate-400",   testid: "stat-total" },
              { label: "Berhasil", value: statSucc,  numColor: "text-emerald-700", accent: "bg-emerald-500", testid: "stat-success" },
              { label: "Partial",  value: statPart,  numColor: "text-amber-700",   accent: "bg-amber-500",   testid: "stat-partial" },
              { label: "Gagal",    value: statFail,  numColor: "text-red-600",     accent: "bg-red-500",     testid: "stat-failed" },
              { label: "Duplikat", value: statDupe,  numColor: "text-slate-400",   accent: "bg-slate-300",   testid: "stat-duplicate" },
            ].map(({ label, value, numColor, accent, testid }) => (
              <div key={label} className="bg-white rounded-2xl shadow-sm overflow-hidden flex">
                <div className={`w-1 shrink-0 ${accent}`} />
                <div className="px-4 py-4 min-w-0 flex-1">
                  <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest leading-none">{label}</p>
                  <p data-testid={testid} className={`text-2xl font-bold mt-1.5 leading-none tabular-nums ${numColor}`}>{value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* ── 3-column Grid ── */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">

            {/* ═══ Left: Results + KB Pipeline (2 cols) ═══ */}
            <div className="xl:col-span-2 space-y-4">

              {/* Results Card */}
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 bg-indigo-100 rounded-lg flex items-center justify-center">
                      <ClipboardList className="w-3.5 h-3.5 text-indigo-600" />
                    </div>
                    <h2 className="text-sm font-bold text-slate-800">Hasil Scraping</h2>
                    {articles.length > 0 && (
                      <span className="text-xs text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full font-medium">
                        {hasActiveFilter ? `${filteredArticles.length} / ${articles.length}` : articles.length}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {articles.length > 0 && (
                      <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
                        <button onClick={() => setViewMode("table")}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${viewMode === "table" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}>
                          <LayoutList className="w-3.5 h-3.5" />Tabel
                        </button>
                        <button onClick={() => setViewMode("markdown")}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${viewMode === "markdown" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}>
                          <FileCode2 className="w-3.5 h-3.5" />Markdown
                        </button>
                      </div>
                    )}
                    {articles.length > 0 && (
                      <Button variant="ghost" size="sm" onClick={fetchArticles}
                        className="gap-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 h-7 text-xs px-2 rounded-lg">
                        <RefreshCw className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>

                {articles.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/60">
                    <div className="relative flex-1 min-w-[120px]">
                      <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <Input data-testid="filter-title" value={titleFilter}
                        onChange={e => setTitleFilter(e.target.value)}
                        placeholder="Cari judul..." className="pl-8 h-8 text-xs border-slate-200 w-full bg-white rounded-full" />
                    </div>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger data-testid="filter-status" className="w-32 h-8 text-xs border-slate-200 bg-white rounded-full">
                        <SelectValue placeholder="Semua" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Semua Status</SelectItem>
                        <SelectItem value="success">Berhasil</SelectItem>
                        <SelectItem value="partial">Partial</SelectItem>
                        <SelectItem value="failed">Gagal</SelectItem>
                        <SelectItem value="duplicate">Duplikat</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input data-testid="filter-date-from" type="date" value={dateFrom}
                      onChange={e => setDateFrom(e.target.value)}
                      className="hidden md:block w-32 h-8 text-xs border-slate-200 bg-white" />
                    <span className="hidden md:block text-slate-300 text-xs">→</span>
                    <Input data-testid="filter-date-to" type="date" value={dateTo}
                      onChange={e => setDateTo(e.target.value)}
                      className="hidden md:block w-32 h-8 text-xs border-slate-200 bg-white" />
                    {hasActiveFilter && (
                      <Button variant="ghost" size="sm" onClick={clearFilters}
                        className="h-8 text-xs text-red-500 hover:bg-red-50 px-2 gap-1">
                        ✕ Hapus
                      </Button>
                    )}
                  </div>
                )}

                {loadingArticles ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                    <div className="w-8 h-8 rounded-full border-2 border-slate-200 border-t-indigo-400 animate-spin" />
                    <p className="text-sm text-slate-500">Memuat artikel...</p>
                  </div>
                ) : articles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-50 to-slate-50 flex items-center justify-center">
                      <Newspaper className="w-6 h-6 text-indigo-300" />
                    </div>
                    <div className="text-center space-y-1">
                      <p className="text-sm font-semibold text-slate-700">Belum ada artikel</p>
                      <p className="text-xs text-slate-400 max-w-xs">Masukkan URL halaman berita di atas, pilih mode, lalu klik <strong className="text-slate-600">Mulai Scraping</strong></p>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 bg-slate-50 border border-slate-200 rounded-full px-3.5 py-1.5">
                      <Zap className="w-3 h-3 text-indigo-400" />Scraping → Stats → KB Pipeline
                    </div>
                  </div>
                ) : filteredArticles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-4">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
                      <AlertCircle className="w-5 h-5 text-slate-300" />
                    </div>
                    <div className="text-center space-y-1">
                      <p className="text-sm font-semibold text-slate-700">Tidak ada hasil yang cocok</p>
                      <p className="text-xs text-slate-400">{articles.length} artikel tersimpan, tapi tidak ada yang cocok filter aktif.</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={clearFilters} className="text-xs gap-1.5 h-8 border-slate-200 text-slate-500">
                      Hapus Semua Filter
                    </Button>
                  </div>
                ) : viewMode === "markdown" ? (
                  <div className="divide-y divide-slate-100">
                    {filteredArticles.map((article, i) => {
                      const md = [
                        `# ${article.title || "(Tanpa Judul)"}`,
                        ``,
                        `## Informasi Artikel`,
                        ``,
                        article.date ? `**Tanggal:** ${article.date}` : null,
                        `**Sumber:** [${article.url}](${article.url})`,
                        `**Status:** ${article.status}`,
                        ``,
                        `### Konten`,
                        ``,
                        article.content || "_Konten tidak tersedia._",
                      ].filter(l => l !== null).join("\n");
                      return (
                        <div key={article.id} data-testid={`row-article-${article.id}`}
                          className="px-5 py-5 hover:bg-slate-50/60 transition-colors group">
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <span className="text-[10px] text-slate-300 tabular-nums font-mono mt-1 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <StatusBadge status={article.status} />
                              <Button data-testid={`button-detail-${article.id}`} size="sm" variant="outline"
                                onClick={() => navigate(`/article/${article.id}`)}
                                className="h-7 text-xs px-2 border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50 gap-1 transition-colors">
                                <Eye className="w-3 h-3" />Detail
                              </Button>
                              <a href={article.url} target="_blank" rel="noopener noreferrer"
                                data-testid={`link-source-${article.id}`}
                                className="flex items-center justify-center w-7 h-7 rounded-md border border-slate-200 text-slate-400 hover:text-indigo-500 hover:border-indigo-200 hover:bg-indigo-50 transition-colors">
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          </div>
                          <div className="prose prose-sm max-w-none prose-headings:text-slate-800 prose-a:text-indigo-600 prose-p:text-slate-600 prose-p:text-sm">
                            <ReactMarkdown>{md}</ReactMarkdown>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/60">
                          <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wide w-8">#</th>
                          <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Judul</th>
                          <th className="hidden md:table-cell text-left px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wide w-28">Tanggal</th>
                          <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wide w-24">Status</th>
                          <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wide w-24">Aksi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredArticles.map((article, i) => (
                          <tr key={article.id} data-testid={`row-article-${article.id}`}
                            className={`border-b border-slate-50 hover:bg-indigo-50/20 transition-colors align-top ${i % 2 === 1 ? "bg-slate-50/30" : ""}`}>
                            <td className="px-5 py-4 text-slate-300 text-xs tabular-nums font-mono">{i + 1}</td>
                            <td className="px-4 py-4 max-w-0">
                              <p className="font-medium text-slate-800 text-sm leading-snug truncate">{article.title || "(Tanpa Judul)"}</p>
                              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed line-clamp-1">
                                {article.content
                                  ? article.content.slice(0, 120) + (article.content.length > 120 ? "…" : "")
                                  : <span className="italic text-slate-300">—</span>}
                              </p>
                            </td>
                            <td className="hidden md:table-cell px-4 py-4 text-slate-400 text-xs whitespace-nowrap tabular-nums">{article.date || "—"}</td>
                            <td className="px-4 py-4"><StatusBadge status={article.status} /></td>
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-1.5">
                                <Button data-testid={`button-detail-${article.id}`} size="sm" variant="outline"
                                  onClick={() => navigate(`/article/${article.id}`)}
                                  className="h-7 text-xs px-2 border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50 gap-1 transition-colors">
                                  <Eye className="w-3 h-3" /><span className="hidden sm:inline">Detail</span>
                                </Button>
                                <a href={article.url} target="_blank" rel="noopener noreferrer"
                                  data-testid={`link-source-${article.id}`}
                                  className="flex items-center justify-center w-7 h-7 rounded-md border border-slate-200 text-slate-400 hover:text-indigo-500 hover:border-indigo-200 hover:bg-indigo-50 transition-colors">
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* KB Pipeline Card */}
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 bg-indigo-100 rounded-lg flex items-center justify-center">
                      <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
                    </div>
                    <h2 className="text-sm font-bold text-slate-800">KB Pipeline</h2>
                    {eligibleArticles.length > 0 && (
                      <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
                        {eligibleArticles.length} eligible
                      </span>
                    )}
                  </div>
                  {kbDraft.length > 0 && (
                    <div className="flex items-center gap-2">
                      <a href="/export/kb" download>
                        <Button data-testid="button-download-kb" variant="ghost" size="sm"
                          className="h-7 text-xs gap-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg">
                          <Download className="w-3 h-3" />Export JSON
                        </Button>
                      </a>
                      <Link to="/review">
                        <Button variant="ghost" size="sm"
                          className="h-7 text-xs gap-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg">
                          <CheckSquare className="w-3 h-3" />Review
                        </Button>
                      </Link>
                    </div>
                  )}
                </div>

                {articles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-50 to-violet-50 flex items-center justify-center">
                      <BookOpen className="w-6 h-6 text-indigo-300" />
                    </div>
                    <div className="text-center space-y-1">
                      <p className="text-sm font-semibold text-slate-700">Pipeline belum tersedia</p>
                      <p className="text-xs text-slate-400">Lakukan scraping terlebih dahulu untuk mengaktifkan KB Pipeline</p>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] flex-wrap justify-center">
                      {["Scraping", "Summary", "Auto Tag", "KB Draft", "Review"].map((s, i, arr) => (
                        <span key={s} className="flex items-center gap-2">
                          <span className="text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full font-medium">{s}</span>
                          {i < arr.length - 1 && <ArrowRight className="w-3 h-3 text-slate-300" />}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-5">
                    <Tabs defaultValue="kb-draft">
                      <TabsList className="mb-5 bg-slate-100 border border-slate-200 h-9">
                        <TabsTrigger value="kb-draft" className="gap-1.5 text-xs h-7">
                          <ClipboardList className="w-3.5 h-3.5" />KB Draft
                        </TabsTrigger>
                        <TabsTrigger value="ai" className="gap-1.5 text-xs h-7">
                          <Sparkles className="w-3.5 h-3.5" />AI Summary
                        </TabsTrigger>
                        <TabsTrigger value="supabase" className="gap-1.5 text-xs h-7">
                          <Database className="w-3.5 h-3.5" />Supabase
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="kb-draft" className="mt-0">
                        <div className="space-y-3">
                          {/* Step 1 */}
                          <div className={`rounded-2xl p-4 space-y-3 transition-all duration-200 ${summaryDone ? "bg-emerald-50/40" : "bg-slate-50/60"}`}>
                            <div className="flex items-start gap-3">
                              <StepBadge n={1} done={summaryDone} />
                              <div className="flex-1 min-w-0 pt-0.5">
                                <h3 className="font-semibold text-sm text-slate-800">Generate Summary</h3>
                                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">Buat ringkasan singkat untuk setiap artikel success/partial.</p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 pl-10">
                              <Button data-testid="button-generate-summary" onClick={doGenerateSummary}
                                disabled={summaryLoading || isRunning || eligibleArticles.length === 0}
                                size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5 h-8 shadow-sm">
                                {summaryLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : summaryDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlignLeft className="w-3.5 h-3.5" />}
                                {summaryLoading ? "Generating..." : summaryDone ? "Re-generate" : "Generate Summary"}
                              </Button>
                              {summaryDone && summaryResult && (
                                <span className="text-xs text-emerald-600 font-medium">{summaryResult.updated} artikel diberi summary.</span>
                              )}
                              {summaryError && <span className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{summaryError}</span>}
                            </div>
                          </div>
                          {/* Step 2 */}
                          <div className={`rounded-2xl p-4 space-y-3 transition-all duration-200 ${tagDone ? "bg-emerald-50/40" : "bg-slate-50/60"}`}>
                            <div className="flex items-start gap-3">
                              <StepBadge n={2} done={tagDone} />
                              <div className="flex-1 min-w-0 pt-0.5">
                                <h3 className="font-semibold text-sm text-slate-800">Auto Tagging</h3>
                                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">Tag otomatis topik, lokasi, dan entitas dari setiap artikel.</p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 pl-10">
                              <Button data-testid="button-auto-tag" onClick={doAutoTag}
                                disabled={tagLoading || isRunning || eligibleArticles.length === 0}
                                size="sm" className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5 h-8 shadow-sm">
                                {tagLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : tagDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Tag className="w-3.5 h-3.5" />}
                                {tagLoading ? "Tagging..." : tagDone ? "Re-tag" : "Auto Tag"}
                              </Button>
                              {tagDone && <span className="text-xs text-emerald-600 font-medium">Semua artikel berhasil di-tag.</span>}
                              {tagError && <span className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{tagError}</span>}
                            </div>
                          </div>
                          {/* Step 3 */}
                          <div className={`rounded-2xl p-4 space-y-3 transition-all duration-200 ${kbDone ? "bg-emerald-50/40" : "bg-slate-50/60"}`}>
                            <div className="flex items-start gap-3">
                              <StepBadge n={3} done={kbDone} />
                              <div className="flex-1 min-w-0 pt-0.5">
                                <h3 className="font-semibold text-sm text-slate-800 flex items-center gap-2">
                                  Convert to KB Draft
                                  {kbDone && <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">{kbDraft.length} artikel</span>}
                                </h3>
                                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                                  Konversi artikel success/partial ke format KB draft AINA. Status awal:{" "}
                                  <span className="font-mono text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-px rounded-full text-[10px] font-medium">pending</span>.
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 pl-10">
                              <Button data-testid="button-convert-kb" onClick={doConvertKb}
                                disabled={kbLoading || isRunning || eligibleArticles.length === 0}
                                size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 h-8 shadow-sm">
                                {kbLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : kbDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : <ClipboardList className="w-3.5 h-3.5" />}
                                {kbLoading ? "Mengkonversi..." : kbDone ? "Re-convert" : "Convert to KB Draft"}
                              </Button>
                              <Button variant="ghost" size="sm" onClick={fetchKbDraft} disabled={kbDraftLoading}
                                className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600">
                                <RefreshCw className={`w-3.5 h-3.5 ${kbDraftLoading ? "animate-spin" : ""}`} />
                              </Button>
                            </div>
                            {kbError && <p data-testid="text-kb-error" className="text-red-500 text-xs pl-10 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{kbError}</p>}
                            {eligibleArticles.length === 0 && !kbDone && (
                              <p className="text-xs text-slate-400 pl-10 italic">Tidak ada artikel success/partial untuk dikonversi.</p>
                            )}
                          </div>
                        </div>

                        {kbDraft.length > 0 && (
                          <div className="rounded-xl border border-slate-200 overflow-hidden mt-4">
                            <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                              <ClipboardList className="w-3.5 h-3.5 text-indigo-400" />
                              <span className="text-xs font-semibold text-slate-500">Preview KB Draft</span>
                              <span className="text-xs text-slate-400">({kbDraft.length} artikel)</span>
                            </div>
                            <div className="overflow-x-auto max-h-72 overflow-y-auto">
                              <table className="w-full text-xs">
                                <thead className="sticky top-0 z-10">
                                  <tr className="bg-white border-b border-slate-100 text-slate-400">
                                    <th className="text-left px-4 py-2.5 font-semibold w-7">#</th>
                                    <th className="text-left px-4 py-2.5 font-semibold">Judul</th>
                                    <th className="text-left px-4 py-2.5 font-semibold w-36">Slug</th>
                                    <th className="text-left px-4 py-2.5 font-semibold w-44">Summary</th>
                                    <th className="text-left px-4 py-2.5 font-semibold w-32">Tags</th>
                                    <th className="text-left px-4 py-2.5 font-semibold w-20">Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {kbDraft.map((kb, i) => (
                                    <tr key={kb.id || i} data-testid={`row-kb-${kb.id || i}`}
                                      className={`border-b border-slate-50 hover:bg-indigo-50/30 transition-colors align-top ${i % 2 === 1 ? "bg-slate-50/40" : ""}`}>
                                      <td className="px-4 py-2.5 text-slate-300 tabular-nums">{i + 1}</td>
                                      <td className="px-4 py-2.5">
                                        <p className="font-medium text-slate-800 line-clamp-2 leading-snug">{kb.title || "(Tanpa Judul)"}</p>
                                        {kb.published_date && <p className="text-slate-400 mt-0.5">{kb.published_date}</p>}
                                      </td>
                                      <td className="px-4 py-2.5">
                                        <span data-testid={`slug-${i}`} className="font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded break-all">{kb.slug}</span>
                                      </td>
                                      <td className="px-4 py-2.5">
                                        <p data-testid={`summary-${i}`} className="text-slate-500 line-clamp-3 leading-relaxed">
                                          {kb.summary || <span className="italic text-slate-300">—</span>}
                                        </p>
                                      </td>
                                      <td className="px-4 py-2.5">
                                        <div data-testid={`tags-${i}`} className="flex flex-wrap gap-1">
                                          {(kb.tags || []).map(t => (
                                            <span key={t} className="bg-indigo-50 text-indigo-600 px-1.5 py-px rounded font-medium">{t}</span>
                                          ))}
                                        </div>
                                      </td>
                                      <td className="px-4 py-2.5">
                                        <span data-testid={`approval-${i}`}
                                          className={`inline-block px-2 py-0.5 rounded font-semibold capitalize ${APPROVAL_COLORS[kb.approval_status] || "bg-slate-100 text-slate-500"}`}>
                                          {kb.approval_status}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </TabsContent>

                      <TabsContent value="ai" className="mt-0">
                        <div className="border border-slate-200 rounded-xl p-5 space-y-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                              <Sparkles className="w-4 h-4 text-violet-600" />
                            </div>
                            <div>
                              <h3 className="font-semibold text-sm text-slate-800">AI Summary — GPT-4o-mini</h3>
                              <p className="text-xs text-slate-500">Upgrade ringkasan dengan AI untuk semua artikel di KB Draft</p>
                            </div>
                          </div>
                          {kbDraft.length === 0 ? (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-2 text-xs text-amber-700">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              Jalankan "Convert to KB Draft" terlebih dahulu.
                            </div>
                          ) : (
                            <Button data-testid="button-ai-summary-all" onClick={generateAiSummaries}
                              disabled={aiLoading}
                              className="bg-violet-600 hover:bg-violet-700 text-white gap-2">
                              {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : aiDone ? <CheckCircle2 className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                              {aiLoading ? "Generating..." : aiDone ? "Selesai!" : "Generate AI Summary"}
                            </Button>
                          )}
                          {aiError && <p data-testid="text-ai-error" className="text-red-500 text-sm flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" />{aiError}</p>}
                          {aiDone && <p data-testid="text-ai-success" className="text-emerald-600 text-sm flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" />AI summary berhasil disimpan.</p>}
                        </div>
                      </TabsContent>

                      <TabsContent value="supabase" className="mt-0">
                        <div className="border border-slate-200 rounded-xl p-5 space-y-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                              <Database className="w-4 h-4 text-emerald-600" />
                            </div>
                            <div>
                              <h3 className="font-semibold text-sm text-slate-800">Push ke Supabase</h3>
                              <p className="text-xs text-slate-500">
                                Push semua KB articles ke tabel <span className="font-mono bg-slate-100 px-1 rounded">kb_articles</span>.
                              </p>
                            </div>
                          </div>
                          {kbDraft.length === 0 ? (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-2 text-xs text-amber-700">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              Jalankan "Convert to KB Draft" terlebih dahulu.
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              <Button data-testid="button-push-supabase" onClick={pushToSupabase}
                                disabled={pushLoading}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
                                {pushLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : pushDone ? <CheckCircle2 className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                                {pushLoading ? "Pushing..." : pushDone ? `${pushCount} artikel di-push!` : "Push to Supabase"}
                              </Button>
                              <Button data-testid="button-fetch-db" onClick={fetchDbArticles}
                                disabled={dbLoading} variant="outline" className="gap-2 border-slate-200">
                                {dbLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                                {dbLoading ? "Mengambil..." : "Lihat Data"}
                              </Button>
                            </div>
                          )}
                          {pushError && <p data-testid="text-push-error" className="text-red-500 text-sm flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" />{pushError}</p>}
                          {dbError && <p data-testid="text-db-error" className="text-red-500 text-sm flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" />{dbError}</p>}
                          {dbArticles.length > 0 && (
                            <div className="rounded-xl border border-slate-200 overflow-hidden">
                              <div className="bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500 border-b">
                                {dbArticles.length} artikel di Supabase
                              </div>
                              <div className="overflow-x-auto max-h-56 overflow-y-auto">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b bg-white text-slate-400">
                                      <th className="text-left px-4 py-2 font-semibold">Judul</th>
                                      <th className="text-left px-4 py-2 font-semibold w-24">Tanggal</th>
                                      <th className="text-left px-4 py-2 font-semibold w-36">Tags</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {dbArticles.map((a, i) => (
                                      <tr key={i} className="border-b hover:bg-slate-50 transition-colors">
                                        <td className="px-4 py-2 text-slate-800 font-medium">{a.title || "(Tanpa Judul)"}</td>
                                        <td className="px-4 py-2 text-slate-400">{a.published_date || "—"}</td>
                                        <td className="px-4 py-2">
                                          <div className="flex flex-wrap gap-1">
                                            {(a.tags || []).map((t: string) => (
                                              <span key={t} className="bg-indigo-50 text-indigo-600 px-1.5 py-px rounded">{t}</span>
                                            ))}
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      </TabsContent>
                    </Tabs>
                  </div>
                )}
              </div>
            </div>

            {/* ═══ Right Sidebar (1 col) ═══ */}
            <div className="space-y-4">

              {/* Log Panel */}
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-slate-100 rounded-lg flex items-center justify-center">
                      <Terminal className="w-3.5 h-3.5 text-slate-500" />
                    </div>
                    <span className="text-sm font-bold text-slate-800">Log Proses</span>
                    {isRunning && (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                        </span>
                        Live
                      </span>
                    )}
                  </div>
                  {progress.phase === "scraping" && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-indigo-600 tabular-nums">{pct}%</span>
                      <div className="w-16"><Progress value={pct} className="h-1" /></div>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 border-b border-slate-600">
                  <Circle className="w-2 h-2 text-red-400 fill-red-400" />
                  <Circle className="w-2 h-2 text-amber-400 fill-amber-400" />
                  <Circle className="w-2 h-2 text-emerald-400 fill-emerald-400" />
                  <span className="text-slate-400 text-[10px] ml-2 font-mono">
                    {progress.phase === "idle" ? "Menunggu perintah scraping..." : (phaseLabel[progress.phase] || progress.phase)}
                  </span>
                  {isRunning && <Loader2 className="w-3 h-3 text-slate-500 animate-spin ml-auto" />}
                </div>
                <div ref={logRef} data-testid="log-panel"
                  className="bg-[#1e2433] px-4 py-3 h-52 overflow-y-auto font-mono">
                  {progress.phase === "idle" || progress.logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                      <Terminal className="w-6 h-6 text-slate-700" />
                      <p className="text-slate-600 text-xs leading-relaxed">
                        Log scraping akan tampil di sini<br />
                        <span className="text-slate-700">setelah kamu klik Mulai Scraping</span>
                      </p>
                    </div>
                  ) : (
                    progress.logs.map((line, i) => (
                      <div key={i} className={`text-xs leading-5 ${logColor(line)}`}>
                        <span className="text-slate-700 select-none mr-2 tabular-nums">{String(i + 1).padStart(3, "0")}</span>
                        {line}
                      </div>
                    ))
                  )}
                  {isRunning && (
                    <div className="text-xs text-slate-600 flex items-center gap-1 mt-1">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      <span className="animate-pulse">memproses...</span>
                    </div>
                  )}
                </div>
                {progress.phase === "done" && (
                  <div className="px-4 py-2.5 bg-slate-700 border-t border-slate-600 flex flex-wrap items-center gap-3 text-[11px]">
                    <span className="text-emerald-400 font-medium">✓ {progress.success} berhasil</span>
                    <span className="text-amber-400">⚠ {progress.partial} partial</span>
                    <span className="text-red-400">✗ {progress.failed} gagal</span>
                    <span className="text-slate-400">↺ {progress.duplicate} duplikat</span>
                  </div>
                )}
              </div>

              {/* Scheduler Card */}
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <button
                  onClick={() => setSchedulerOpen(o => !o)}
                  className="w-full flex items-center justify-between px-4 py-3.5 border-b border-slate-100 hover:bg-slate-50 transition-colors"
                  data-testid="scheduler-toggle"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-indigo-100 rounded-lg flex items-center justify-center">
                      <Timer className="w-3.5 h-3.5 text-indigo-600" />
                    </div>
                    <span className="text-sm font-bold text-slate-800">Scheduler</span>
                    {schedulerSettings.enabled && schedulerSettings.interval !== "manual" && (
                      <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                        {schedulerSettings.interval === "daily" ? "Harian" : "Mingguan"}
                      </span>
                    )}
                  </div>
                  {schedulerOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>

                {schedulerOpen && (
                  <div className="p-4 space-y-4">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-xl bg-slate-50 p-2.5 text-center">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide">Last Run</p>
                        <p className="text-xs font-semibold text-slate-700 mt-0.5 tabular-nums leading-tight">
                          {schedulerSettings.last_run_at
                            ? new Date(schedulerSettings.last_run_at).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })
                            : "—"}
                        </p>
                      </div>
                      <div className="rounded-xl bg-indigo-50 p-2.5 text-center">
                        <p className="text-[10px] text-indigo-400 uppercase tracking-wide">Next</p>
                        <p className="text-xs font-semibold text-indigo-700 mt-0.5 tabular-nums leading-tight">
                          {schedulerSettings.next_run_at
                            ? new Date(schedulerSettings.next_run_at).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })
                            : "—"}
                        </p>
                      </div>
                      <div className="rounded-xl bg-emerald-50 p-2.5 text-center">
                        <p className="text-[10px] text-emerald-500 uppercase tracking-wide">Artikel</p>
                        <p className="text-xl font-bold text-emerald-700 mt-0.5 tabular-nums leading-none">
                          {schedulerSettings.last_run_articles_added}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        <div className="space-y-1 flex-1 min-w-[130px]">
                          <Label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Mode Jadwal</Label>
                          <Select value={schedulerSettings.interval}
                            onValueChange={v => setSchedulerSettings(s => ({
                              ...s, interval: v as "manual" | "daily" | "weekly", enabled: v !== "manual",
                            }))}>
                            <SelectTrigger data-testid="scheduler-interval" className="h-8 text-xs bg-slate-50 border-slate-200">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="manual">Manual Only</SelectItem>
                              <SelectItem value="daily">Harian</SelectItem>
                              <SelectItem value="weekly">Mingguan</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {schedulerSettings.interval !== "manual" && (
                          <div className="space-y-1">
                            <Label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Jam (WIB)</Label>
                            <Input data-testid="scheduler-time" type="time"
                              value={schedulerSettings.time_of_day}
                              onChange={e => setSchedulerSettings(s => ({ ...s, time_of_day: e.target.value }))}
                              className="w-24 h-8 text-xs bg-slate-50 border-slate-200" />
                          </div>
                        )}
                      </div>
                      {schedulerSettings.interval === "weekly" && (
                        <div className="space-y-1">
                          <Label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Hari</Label>
                          <Select value={schedulerSettings.day_of_week}
                            onValueChange={v => setSchedulerSettings(s => ({ ...s, day_of_week: v }))}>
                            <SelectTrigger data-testid="scheduler-dow" className="h-8 text-xs bg-slate-50 border-slate-200">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {[{ v:"mon",l:"Senin" },{ v:"tue",l:"Selasa" },{ v:"wed",l:"Rabu" },{ v:"thu",l:"Kamis" },{ v:"fri",l:"Jumat" },{ v:"sat",l:"Sabtu" },{ v:"sun",l:"Minggu" }].map(d => (
                                <SelectItem key={d.v} value={d.v}>{d.l}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <div className="space-y-1">
                        <Label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">URL Default</Label>
                        <Input data-testid="scheduler-url" type="url"
                          placeholder="https://www.kemlu.go.id/cairo/berita"
                          value={schedulerSettings.url}
                          onChange={e => setSchedulerSettings(s => ({ ...s, url: e.target.value }))}
                          className="h-8 text-xs bg-slate-50 border-slate-200" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Mode Scraping</Label>
                        <Select value={schedulerSettings.scrape_mode}
                          onValueChange={v => setSchedulerSettings(s => ({ ...s, scrape_mode: v }))}>
                          <SelectTrigger data-testid="scheduler-mode" className="h-8 text-xs bg-slate-50 border-slate-200">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="list">List Only</SelectItem>
                            <SelectItem value="full">Full Article</SelectItem>
                            <SelectItem value="kb">KB Mode</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setSchedulerSettings(s => ({ ...s, incremental: !s.incremental }))} className="shrink-0">
                          {schedulerSettings.incremental
                            ? <ToggleRight className="w-8 h-8 text-indigo-600" />
                            : <ToggleLeft className="w-8 h-8 text-slate-300" />}
                        </button>
                        <div>
                          <p className="text-xs font-semibold text-slate-700">Incremental</p>
                          <p className="text-[10px] text-slate-400">Hanya ambil artikel baru (lewati duplikat)</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <Button data-testid="button-save-scheduler" onClick={saveSchedulerSettings}
                        disabled={schedulerSaving} size="sm"
                        className="rounded-full bg-gradient-to-r from-indigo-600 to-violet-500 hover:from-indigo-700 hover:to-violet-600 text-white gap-1.5 h-8 px-4 shadow-sm">
                        {schedulerSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        Simpan
                      </Button>
                      <Button data-testid="button-run-now" onClick={triggerRunNow}
                        disabled={schedulerRunNow || !schedulerSettings.url} size="sm" variant="outline"
                        className="gap-1.5 h-8 border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-300 rounded-full">
                        {schedulerRunNow ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                        Jalankan
                      </Button>
                      <Button variant="ghost" size="sm" onClick={fetchSchedulerSettings}
                        className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600">
                        <RefreshCw className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    {schedulerSettings.interval !== "manual" && schedulerSettings.enabled && (
                      <p className="text-[11px] text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-2 rounded-lg leading-relaxed">
                        ✓ Aktif — {schedulerSettings.interval === "daily"
                          ? `setiap hari pukul ${schedulerSettings.time_of_day}`
                          : `setiap ${DOW_LABELS[schedulerSettings.day_of_week] || schedulerSettings.day_of_week} pukul ${schedulerSettings.time_of_day}`} WIB
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* CSS Selector Card */}
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-4 py-3.5 border-b border-slate-100 hover:bg-slate-50 transition-colors"
                  onClick={() => setSettingsOpen(v => !v)}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-violet-100 rounded-lg flex items-center justify-center">
                      <Settings2 className="w-3.5 h-3.5 text-violet-600" />
                    </div>
                    <span className="text-sm font-bold text-slate-800">CSS Selector</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!settingsOpen && (
                      <span className="text-[10px] text-slate-400 font-mono hidden sm:inline truncate max-w-[100px]">
                        {settings.article_link_selector}
                      </span>
                    )}
                    {settingsOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </div>
                </button>
                {settingsOpen && (
                  <div className="p-4 space-y-4">
                    <div className="space-y-3">
                      {SELECTOR_FIELDS.map(({ key, label, hint }) => (
                        <div key={key} className="space-y-1">
                          <Label className="text-[11px] font-semibold text-indigo-400 uppercase tracking-widest">{label}</Label>
                          <Textarea data-testid={`input-${key}`} rows={2} value={settings[key]}
                            onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
                            className="font-mono text-xs resize-none bg-indigo-50/40 border-indigo-100 rounded-xl focus-visible:ring-indigo-300"
                            placeholder={DEFAULT_SETTINGS[key]} />
                          <p className="text-[10px] text-slate-400">{hint}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button data-testid="button-save-settings" onClick={saveSettings}
                        disabled={settingsSaving} size="sm"
                        className="rounded-full bg-gradient-to-r from-indigo-600 to-violet-500 hover:from-indigo-700 hover:to-violet-600 text-white gap-1.5 h-8 px-4 shadow-sm">
                        {settingsSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        Simpan
                      </Button>
                      <Button data-testid="button-reset-settings" onClick={resetSettings}
                        variant="ghost" size="sm" className="gap-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 h-8 rounded-full">
                        <RotateCcw className="w-3.5 h-3.5" />Reset
                      </Button>
                      {settingsError && (
                        <p className="text-xs text-red-500 flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5" />{settingsError}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
