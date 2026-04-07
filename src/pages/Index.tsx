import { useState, useEffect, useRef, useCallback } from "react";
import { apiUrl } from "@/lib/api";
import { useNavigate, Link } from "react-router-dom";
import { BottomNav } from "@/components/BottomNav";
import ReactMarkdown from "react-markdown";
import {
  Newspaper, Zap, FileJson, FileText, Loader2, ExternalLink,
  BookOpen, CheckCircle2, Sparkles, Database, Upload, Settings2,
  ChevronDown, ChevronUp, ChevronLeft, Save, RotateCcw, Tag, AlignLeft,
  ClipboardList, Download, RefreshCw, CheckSquare, Terminal,
  AlertCircle, Circle, ArrowRight, BarChart3, Eye,
  Clock, CalendarDays, Play, ToggleLeft, ToggleRight, Timer,
  LayoutList, FileCode2, XCircle, Copy, Globe, X, Trash2,
  History, Shield, Activity,
} from "lucide-react";

function getSourceMeta(url: string): {
  category: string; categoryColor: string;
  trust: string; trustColor: string;
} {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    if (domain.includes("kemlu.go.id") || domain.includes("kbri") || domain.includes("kemenlu") || domain.includes(".go.id") || domain.includes(".gov") || domain.includes("antaranews") || domain.includes("detik.com") || domain.includes("kompas.com") || domain.includes("bbc.") || domain.includes("reuters.com") || domain.includes("aljazeera")) {
      return { category: "Official", categoryColor: "bg-blue-900/40 text-blue-300", trust: "High", trustColor: "bg-emerald-900/30 text-emerald-400" };
    }
    if (domain.includes("pcinu") || domain.includes("ppi-") || domain.includes("ppimesir") || domain.includes("indonesia") || domain.includes("republika") || domain.includes("tempo.co") || domain.includes("tribun")) {
      return { category: "Community", categoryColor: "bg-violet-900/40 text-violet-300", trust: "Medium", trustColor: "bg-amber-900/40 text-amber-300" };
    }
  } catch {}
  return { category: "Article", categoryColor: "bg-white/10 text-slate-500", trust: "Default", trustColor: "bg-white/10 text-slate-500" };
}
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  reviewed: "bg-blue-900/40 text-blue-300",
  approved: "bg-emerald-900/30 text-emerald-400",
  rejected: "bg-red-900/40 text-red-300",
  exported: "bg-indigo-900/30 text-indigo-400",
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
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300 bg-emerald-900/20 border border-emerald-700/40 px-2 py-0.5 rounded-full whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-900/200 shrink-0" />Berhasil
      </span>
    );
  if (status === "partial")
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-300 bg-amber-900/20 border border-amber-700/40 px-2 py-0.5 rounded-full whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-900/200 shrink-0" />Partial
      </span>
    );
  if (status === "duplicate")
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 bg-white/10 border border-white/15 px-2 py-0.5 rounded-full whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />Duplikat
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-red-300 bg-red-900/20 border border-red-700/40 px-2 py-0.5 rounded-full whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-red-900/200 shrink-0" />Gagal
    </span>
  );
}

function StepBadge({ n, done }: { n: number; done?: boolean }) {
  return done ? (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-900/200 text-white shrink-0 shadow-sm">
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
  return "text-slate-500";
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

  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set());
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [clearAllConfirm, setClearAllConfirm] = useState(false);
  const [resetAllConfirm, setResetAllConfirm] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

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
  const [kbCutoff, setKbCutoff] = useState<string>("all"); // "all"|"7"|"30"|"90"|"180"
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

  const [ingestionHistory, setIngestionHistory] = useState<Record<string, unknown>[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTickRef = useRef(0);
  const lastLogsRef = useRef<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const wasRunningRef = useRef(false);

  const fetchArticles = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/articles"), { cache: "no-store" });
      if (res.ok) setArticles(await res.json());
    } catch {}
    setLoadingArticles(false);
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch(apiUrl("/settings"));
      if (res.ok) setSettings(await res.json());
    } catch {}
  };

  const fetchKbDraft = async () => {
    setKbDraftLoading(true);
    try {
      const res = await fetch(apiUrl("/api/kb-draft"));
      if (res.ok) {
        const data = await res.json();
        setKbDraft(data);
        if (data.length > 0) setKbDone(true);
      }
    } catch {}
    setKbDraftLoading(false);
  };

  const toggleSelectArticle = (id: string) => {
    setSelectedArticles(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleSelectAllArticles = () => {
    if (selectedArticles.size === filteredArticles.length) {
      setSelectedArticles(new Set());
    } else {
      setSelectedArticles(new Set(filteredArticles.map(a => a.id)));
    }
  };

  const deleteSelectedArticles = async () => {
    if (selectedArticles.size === 0) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(apiUrl("/api/articles/bulk-delete"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedArticles) }),
      });
      let data: Record<string, unknown> = {};
      try { data = await res.json(); } catch { /* non-JSON response */ }
      if (res.ok) {
        toast({ title: "Artikel dihapus", description: `${data.deleted ?? selectedArticles.size} artikel berhasil dihapus.` });
        setSelectedArticles(new Set());
        await fetchArticles();
      } else {
        toast({
          title: "Gagal menghapus",
          description: res.status === 404
            ? "Endpoint tidak ditemukan — pastikan backend sudah di-deploy ulang dengan kode terbaru."
            : String(data.error || `Server error ${res.status}`),
          variant: "destructive",
        });
      }
    } catch (err: unknown) {
      toast({
        title: "Koneksi gagal",
        description: err instanceof TypeError
          ? "Tidak dapat terhubung ke server. Periksa koneksi atau status backend."
          : String(err),
        variant: "destructive",
      });
    }
    setDeleteLoading(false);
  };

  const resetAll = async () => {
    setResetLoading(true);
    try {
      const res = await fetch(apiUrl("/api/reset-all"), { method: "POST" });
      let data: Record<string, unknown> = {};
      try { data = await res.json(); } catch { /* non-JSON */ }
      if (res.ok) {
        stopPoll();
        wasRunningRef.current = false;
        lastLogsRef.current = [];
        setArticles([]);
        setKbDraft([]);
        setKbDone(false);
        setSummaryDone(false);
        setTagDone(false);
        setJustFinished(false);
        setSelectedArticles(new Set());
        setClearAllConfirm(false);
        setResetAllConfirm(false);

        setProgress({ running: false, phase: "idle", current: 0, total: 0, success: 0, partial: 0, failed: 0, duplicate: 0, logs: [] });
        toast({ title: "Reset selesai", description: `${data.articles_deleted ?? 0} artikel & ${data.kb_deleted ?? 0} KB Draft dihapus. Siap scraping ulang.` });
      } else {
        toast({ title: "Gagal reset", description: String(data.error || `Server error ${res.status}`), variant: "destructive" });
      }
    } catch (err: unknown) {
      toast({ title: "Koneksi gagal", description: err instanceof TypeError ? "Tidak dapat terhubung ke server." : String(err), variant: "destructive" });
    }
    setResetLoading(false);
  };

  const clearAllArticles = async () => {
    setDeleteLoading(true);
    try {
      const res = await fetch(apiUrl("/api/articles/clear-all"), { method: "POST" });
      let data: Record<string, unknown> = {};
      try { data = await res.json(); } catch { /* non-JSON response */ }
      if (res.ok) {
        toast({ title: "Semua artikel dihapus", description: `${data.deleted ?? 0} artikel berhasil dibersihkan.` });
        setSelectedArticles(new Set());
        setClearAllConfirm(false);
        await fetchArticles();
      } else {
        toast({
          title: "Gagal menghapus",
          description: res.status === 404
            ? "Endpoint tidak ditemukan — pastikan backend sudah di-deploy ulang dengan kode terbaru."
            : String(data.error || `Server error ${res.status}`),
          variant: "destructive",
        });
      }
    } catch (err: unknown) {
      toast({
        title: "Koneksi gagal",
        description: err instanceof TypeError
          ? "Tidak dapat terhubung ke server. Periksa koneksi atau status backend."
          : String(err),
        variant: "destructive",
      });
    }
    setDeleteLoading(false);
  };

  const fetchSchedulerSettings = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/scheduler/settings"));
      if (res.ok) {
        const data = await res.json();
        setSchedulerSettings(prev => ({ ...prev, ...data }));
      }
    } catch {}
  }, []);

  const fetchIngestionHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(apiUrl("/api/ingestion-history"), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setIngestionHistory(data.runs ?? []);
      }
    } catch {}
    setHistoryLoading(false);
  }, []);

  const saveSchedulerSettings = async () => {
    setSchedulerSaving(true);
    try {
      const res = await fetch(apiUrl("/api/scheduler/settings"), {
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
      const res = await fetch(apiUrl("/api/scheduler/run-now"), { method: "POST" });
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
      const res = await fetch(apiUrl("/api/progress"), { cache: "no-store" });
      if (!res.ok) return;
      const data: ScrapeProgress = await res.json();

      // Auto-resume polling if backend is already running (e.g. page refresh mid-scrape)
      if (data.running && !pollRef.current) {
        wasRunningRef.current = true;
        pollTickRef.current = 0;
        pollRef.current = setInterval(pollProgress, 1000);
      }

      // Preserve last known logs — if backend briefly resets, keep old logs visible
      if (data.logs && data.logs.length > 0) {
        lastLogsRef.current = data.logs;
      } else if (data.running || data.phase !== "idle") {
        data.logs = lastLogsRef.current;
      }
      setProgress(data);
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;

      // Refresh articles every 2 ticks (~2 seconds) while scraping — feels live
      pollTickRef.current += 1;
      if (data.running && pollTickRef.current % 2 === 0) {
        fetchArticles();
      }

      if (wasRunningRef.current && !data.running && data.phase === "done") {
        stopPoll();
        pollTickRef.current = 0;
        setJustFinished(true);
        await fetchArticles();
        setTimeout(() => {
          resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 200);
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
    fetchIngestionHistory();
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
      const res = await fetch(apiUrl("/api/scrape"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let data: Record<string, string> = {};
      try { data = await res.json(); } catch { /* non-JSON response */ }
      if (!res.ok) { setUrlError(data.error || `Server error ${res.status}`); return; }
      wasRunningRef.current = true;
      pollTickRef.current = 0;
      pollRef.current = setInterval(pollProgress, 1000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setUrlError(`Gagal: ${msg}`);
    }
  };

  const saveSettings = async () => {
    setSettingsSaving(true); setSettingsError("");
    try {
      const res = await fetch(apiUrl("/settings"), {
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
      await fetch(apiUrl("/settings"), {
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
      const res = await fetch(apiUrl("/api/generate-summary"), { method: "POST" });
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
      const res = await fetch(apiUrl("/api/auto-tag"), { method: "POST" });
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
      const body: Record<string, unknown> = {};
      if (kbCutoff !== "all") body.cutoff_days = parseInt(kbCutoff);
      const res = await fetch(apiUrl("/api/convert-kb"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) setKbError(data.error || "Gagal mengkonversi.");
      else {
        setKbDone(true); setKbCount(data.count);
        await fetchKbDraft();
        const skippedNote = data.skipped > 0 ? ` (${data.skipped} artikel dilewati karena terlalu lama)` : "";
        toast({ title: "KB Draft dibuat", description: `${data.count} artikel berhasil dikonversi ke KB Draft.${skippedNote}` });
      }
    } catch { setKbError("Tidak bisa menghubungi server."); }
    finally { setKbLoading(false); }
  };

  const generateAiSummaries = async () => {
    setAiLoading(true); setAiError(""); setAiDone(false);
    try {
      const res = await fetch(apiUrl("/api/ai-summary-all"), { method: "POST" });
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
      const res = await fetch(apiUrl("/api/push-supabase"), { method: "POST" });
      const data = await res.json();
      if (!res.ok) setPushError(data.error || "Gagal push ke Supabase.");
      else {
        setPushDone(true); setPushCount(data.inserted || 0);
        const skipped = data.skipped || 0;
        const errCount = (data.errors || []).length;
        let desc = `${data.inserted || 0} artikel berhasil di-insert ke knowledge_base AINA (status: pending).`;
        if (skipped > 0) desc += ` ${skipped} dilewati (tanpa konten).`;
        if (errCount > 0) desc += ` ${errCount} gagal.`;
        toast({ title: "Push ke Supabase berhasil", description: desc });
        if (errCount > 0) setPushError(`${errCount} artikel gagal di-push. Cek console untuk detail.`);
      }
    } catch { setPushError("Tidak bisa menghubungi server."); }
    finally { setPushLoading(false); }
  };

  const fetchDbArticles = async () => {
    setDbLoading(true); setDbError("");
    try {
      const res = await fetch(apiUrl("/api/db-articles"));
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
  const clearFilters = () => { setTitleFilter(""); setStatusFilter("all"); setDateFrom(""); setDateTo(""); setSelectedArticles(new Set()); };

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
    <div className="flex h-screen overflow-hidden bg-black text-white relative">

      {/* ── Background (same theme as homepage) ── */}
      <div className="absolute inset-0 pointer-events-none select-none">
        <img src="/bg-home.jpg" alt="" className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: 0.22, objectPosition: "center 82%", transform: "scale(1.38)", transformOrigin: "center bottom" }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 70% at 55% 40%, rgba(109,40,217,0.22) 0%, transparent 65%)" }} />
        <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "radial-gradient(circle at 1.5px 1.5px, rgba(200,180,255,0.8) 1.5px, transparent 0)", backgroundSize: "32px 32px" }} />
        <div className="absolute top-0 inset-x-0 h-28" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.82) 0%, transparent 100%)" }} />
        <div className="absolute bottom-0 inset-x-0 h-1/2" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.35) 55%, transparent 100%)" }} />
      </div>

      {/* ─── Main Content Area ─── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 relative z-10">

        {/* ─── Dark Header Card ─── */}
        <div className="mx-2 sm:mx-4 lg:mx-6 mt-2 sm:mt-4 lg:mt-5 rounded-xl sm:rounded-2xl px-3 sm:px-5 lg:px-8 py-3 sm:py-4 lg:py-5 flex items-center justify-between shrink-0 animate-fade-in-up" style={{ background: "linear-gradient(135deg, #1a0535 0%, #2f0c60 40%, #4a1890 100%)", border: "1px solid rgba(139,92,246,0.3)", boxShadow: "0 0 40px rgba(109,40,217,0.22), 0 4px 20px rgba(0,0,0,0.6)" }}>
          <div className="flex items-center gap-2.5 sm:gap-3 lg:gap-4 min-w-0">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-1 lg:gap-2 text-white/70 hover:text-white hover:bg-white/15 -ml-1 h-8 lg:h-10 px-2 lg:px-3 text-xs lg:text-sm">
                <ChevronLeft className="w-3.5 h-3.5 lg:w-4 lg:h-4" /><span className="hidden sm:inline">Beranda</span>
              </Button>
            </Link>
            <div className="w-px h-4 lg:h-6 bg-white/15 shrink-0 hidden sm:block" />
            <img
              src="/AIGYPT_logo.png"
              alt="AINA"
              className="w-8 h-8 sm:w-9 sm:h-9 lg:w-12 lg:h-12 object-contain shrink-0 animate-float hidden sm:block"
              style={{ filter: "brightness(0) invert(1) drop-shadow(0 0 6px rgba(200,160,255,0.8))" }}
            />
            <div className="leading-none min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="font-bold text-white text-base lg:text-xl tracking-tight">Scraper Berita Web</p>
                <span className="inline-flex items-center gap-1 text-[9px] lg:text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(139,92,246,0.25)", border: "1px solid rgba(167,139,250,0.4)", color: "rgba(196,181,253,0.9)" }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />AI
                </span>
              </div>
              <p className="text-violet-300/70 text-[11px] lg:text-[13px] mt-0 lg:mt-0.5">Scrape artikel dari website manapun</p>
            </div>
          </div>
          {schedulerSettings.enabled && schedulerSettings.interval !== "manual" && (
            <div className="hidden lg:flex items-center gap-1.5 bg-white/10 rounded-full px-4 py-2 text-sm text-white backdrop-blur-sm">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
              </span>
              Scheduler aktif · {schedulerSettings.interval === "daily" ? "Harian" : "Mingguan"} {schedulerSettings.time_of_day}
              {schedulerSettings.next_run_at && (
                <span className="text-indigo-200 font-medium ml-1">
                  · next: {new Date(schedulerSettings.next_run_at).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })}
                </span>
              )}
            </div>
          )}
          {/* Reset All button */}
          {!resetAllConfirm ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setResetAllConfirm(true)}
              disabled={isRunning}
              className="gap-1.5 text-white/60 hover:text-white hover:bg-white/15 h-8 lg:h-9 text-xs px-2 sm:px-3 rounded-full"
              title="Reset semua data"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reset</span>
            </Button>
          ) : (
            <div className="flex items-center gap-1.5 bg-red-900/60 border border-red-400/40 rounded-full px-2.5 py-1.5">
              <span className="text-[11px] text-red-200 font-medium whitespace-nowrap">Reset semua?</span>
              <button onClick={resetAll} disabled={resetLoading}
                className="text-[11px] font-bold text-white bg-red-600 hover:bg-red-700 px-2 py-0.5 rounded-full">
                {resetLoading ? "..." : "Ya"}
              </button>
              <button onClick={() => setResetAllConfirm(false)}
                className="text-[11px] text-white/60 hover:text-white px-1.5 py-0.5 rounded-full hover:bg-white/10">
                Batal
              </button>
            </div>
          )}
          <Link to="/review" className="hidden sm:inline-flex">
            <Button data-testid="link-review-dashboard" size="sm"
              className="gap-1.5 bg-white text-[#2e0d5e] hover:bg-white/90 h-8 lg:h-11 text-xs lg:text-sm px-3 sm:px-4 lg:px-6 font-semibold shadow-sm rounded-full">
              <CheckSquare className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
              <span className="hidden sm:inline">Review KB Draft</span>
              <span className="sm:hidden">Review</span>
            </Button>
          </Link>
        </div>

        {/* ─── Scrollable Content ─── */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6 pb-24 lg:pb-24 space-y-3 sm:space-y-4 lg:space-y-5 min-w-0">

          {/* ── URL Input Card ── */}
          <div className="relative overflow-hidden rounded-2xl animate-fade-in-up animation-delay-100" style={{ background: "#0d0720" }}>
            <div className="absolute animate-border-beam pointer-events-none" style={{ inset: "-50%", width: "200%", height: "200%", background: "conic-gradient(transparent 260deg, rgba(139,92,246,0.6) 300deg, rgba(196,181,253,1) 345deg, transparent 360deg)" }} />
            <div className="relative m-px rounded-[15px]" style={{ background: "#0d0720" }}>
            {/* Animated gradient top bar */}
            <div className="h-[3px] bg-gradient-to-r from-violet-500 via-purple-400 to-violet-500 gradient-flow" />

            <div className="p-4 sm:p-5 lg:p-7 space-y-4 lg:space-y-5">

              {/* ─ URL row: label + source badge + input ─ */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 lg:w-6 lg:h-6 rounded-lg bg-violet-900/50 flex items-center justify-center shrink-0">
                      <Globe className="w-3 h-3 lg:w-3.5 lg:h-3.5 text-violet-400" />
                    </div>
                    <span className="text-[10px] lg:text-[11px] font-black uppercase tracking-[0.18em] text-violet-400/80">Sumber Berita</span>
                  </div>
                  {url && (
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${getSourceMeta(url).categoryColor}`}>
                      {getSourceMeta(url).category} · {getSourceMeta(url).trust}
                    </span>
                  )}
                </div>

                <div className="relative group">
                  <Globe className="absolute left-4 lg:left-5 top-1/2 -translate-y-1/2 w-4 h-4 lg:w-[18px] lg:h-[18px] text-violet-500/50 group-focus-within:text-violet-400 transition-colors duration-200 pointer-events-none" />
                  <input
                    data-testid="input-url"
                    type="url"
                    placeholder="https://contoh.com/kategori/berita"
                    value={url}
                    onChange={e => { setUrl(e.target.value); setUrlError(""); }}
                    onKeyDown={e => e.key === "Enter" && !isRunning && startScrape()}
                    disabled={isRunning}
                    className={`w-full h-14 lg:h-[56px] pl-11 lg:pl-13 pr-10 rounded-xl lg:rounded-2xl text-sm lg:text-[15px] border-2 outline-none transition-all duration-200 font-mono tracking-tight
                      placeholder:text-slate-600 disabled:opacity-60 disabled:cursor-not-allowed
                      ${urlError
                        ? "border-red-500/50 bg-red-900/20 text-red-300"
                        : "border-violet-800/40 bg-[#0f0a1e] text-white focus:border-violet-500/70 focus:bg-[#130d26]"
                      }`}
                    style={!urlError ? { boxShadow: "0 0 0 0 transparent" } : undefined}
                  />
                  {url && !isRunning && (
                    <button onClick={() => { setUrl(""); setUrlError(""); }}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-300 transition-colors rounded-full p-0.5 hover:bg-white/10">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {urlError && (
                  <p className="text-red-400 text-xs flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />{urlError}
                  </p>
                )}
              </div>

              {/* ─ Mode icon cards + Mulai Scraping ─ */}
              <div className="flex flex-col sm:flex-row gap-3">
                {/* 3-column mode cards */}
                <div className="grid grid-cols-3 gap-2 flex-1">
                  {[
                    { value: "list", label: "List Only",    Icon: LayoutList, sub: "Judul & URL" },
                    { value: "full", label: "Full Article", Icon: Newspaper,  sub: "Konten lengkap" },
                    { value: "kb",   label: "KB Mode",      Icon: Database,   sub: "Knowledge Base" },
                  ].map(({ value, label, Icon, sub }) => (
                    <button
                      key={value}
                      data-testid={`mode-${value}`}
                      onClick={() => !isRunning && setMode(value)}
                      disabled={isRunning}
                      className={`relative flex flex-col items-center justify-center gap-1.5 p-3.5 rounded-xl border-2 transition-all duration-200 overflow-hidden
                        ${mode === value
                          ? "border-violet-500/70 text-white"
                          : "border-transparent text-slate-600 hover:text-slate-400"
                        }`}
                      style={mode === value ? {
                        background: "linear-gradient(145deg, rgba(109,40,217,0.28) 0%, rgba(79,20,180,0.14) 100%)",
                        boxShadow: "0 0 16px rgba(139,92,246,0.25), inset 0 1px 0 rgba(196,181,253,0.15)"
                      } : { background: "rgba(255,255,255,0.025)", opacity: 0.55 }}>
                      {mode === value && (
                        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-violet-500 via-purple-400 to-violet-500" />
                      )}
                      <Icon className={`w-5 h-5 relative z-10 transition-colors ${mode === value ? "text-violet-300" : ""}`} />
                      <span className="text-[11px] font-bold tracking-wide relative z-10 leading-none">{label}</span>
                      <span className={`text-[10px] relative z-10 leading-none ${mode === value ? "text-violet-400/70" : "text-slate-600"}`}>{sub}</span>
                    </button>
                  ))}
                </div>

                {/* Mulai Scraping */}
                <div className="relative shrink-0">
                  <div className="absolute inset-0 -z-10 rounded-2xl pointer-events-none"
                    style={{
                      background: "radial-gradient(ellipse 120% 160% at 50% 50%, rgba(139,92,246,0.65) 0%, rgba(109,40,217,0.35) 40%, transparent 70%)",
                      filter: "blur(14px)", transform: "scale(1.5)",
                    }} />
                  <button
                    data-testid="button-start-scrape"
                    onClick={startScrape}
                    disabled={isRunning}
                    className={`relative w-full sm:w-auto h-12 sm:h-full px-6 lg:px-8 rounded-xl lg:rounded-2xl font-bold text-sm lg:text-base text-white gap-2 flex items-center justify-center
                      transition-all duration-200 overflow-hidden
                      ${isRunning
                        ? "bg-gradient-to-r from-violet-600 to-purple-600 opacity-80 cursor-not-allowed"
                        : "bg-gradient-to-br from-violet-600 via-violet-600 to-purple-500 hover:from-violet-500 hover:to-purple-400 hover:scale-[1.03] active:scale-95"
                      }`}
                    style={isRunning ? {} : { boxShadow: "0 0 20px rgba(139,92,246,0.75), 0 0 45px rgba(109,40,217,0.4), 0 4px 16px rgba(0,0,0,0.5)" }}>
                    {isRunning && (
                      <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_1.5s_infinite] -skew-x-12" />
                    )}
                    {isRunning
                      ? <><Loader2 className="w-4 h-4 lg:w-5 lg:h-5 animate-spin relative z-10" /><span className="relative z-10 whitespace-nowrap">Scraping...</span></>
                      : <><Zap className="w-4 h-4 lg:w-5 lg:h-5" /><span className="whitespace-nowrap">Mulai Scraping</span></>}
                  </button>
                </div>
              </div>

              {/* ─ Date range ─ */}
              <div className="flex flex-wrap items-center gap-2 pt-4 lg:pt-5 border-t border-violet-900/30">
                <CalendarDays className="w-3.5 h-3.5 text-violet-500/50 shrink-0" />
                <span className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 shrink-0">Rentang</span>
                <div className="flex flex-wrap gap-1.5">
                  {SCRAPE_RANGES.map(r => (
                    <button
                      key={r.value}
                      data-testid={`range-${r.value}`}
                      onClick={() => !isRunning && setScrapeRange(r.value)}
                      disabled={isRunning}
                      className={`text-[11px] px-3 py-1.5 rounded-full font-semibold transition-all duration-150
                        ${scrapeRange === r.value
                          ? "bg-violet-600 text-white shadow-[0_0_10px_rgba(139,92,246,0.5)]"
                          : "bg-white/5 text-slate-500 hover:bg-white/10 hover:text-slate-200 border border-white/8"
                        }`}>
                      {r.label}
                    </button>
                  ))}
                </div>
                {scrapeRange === "custom" && (
                  <div className="flex items-center gap-1.5 mt-1.5 w-full sm:w-auto sm:mt-0">
                    <Input data-testid="input-custom-start" type="date" value={customStart}
                      onChange={e => setCustomStart(e.target.value)} disabled={isRunning}
                      className="w-36 h-7 text-xs bg-white/5 border-white/15 rounded-lg" />
                    <span className="text-slate-400 text-xs shrink-0">–</span>
                    <Input data-testid="input-custom-end" type="date" value={customEnd}
                      onChange={e => setCustomEnd(e.target.value)} disabled={isRunning}
                      className="w-36 h-7 text-xs bg-white/5 border-white/15 rounded-lg" />
                  </div>
                )}
              </div>
            </div>
            </div>{/* /m-px inner */}
          </div>

          {/* ── Stats Row ── */}
          {/* Mobile: horizontal scroll · sm+: 5-col grid */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-2.5">
            {[
              { label: "Total",    value: statTotal, icon: BarChart3,    numColor: "text-slate-100",   iconBg: "bg-white/10",    iconColor: "text-slate-500",   top: "bg-gradient-to-r from-slate-300 to-slate-400",       testid: "stat-total",     delay: "animation-delay-150" },
              { label: "Berhasil", value: statSucc,  icon: CheckCircle2, numColor: "text-emerald-400", iconBg: "bg-emerald-900/40",  iconColor: "text-emerald-400", top: "bg-gradient-to-r from-emerald-400 to-teal-400",     testid: "stat-success",   delay: "animation-delay-200" },
              { label: "Partial",  value: statPart,  icon: AlertCircle,  numColor: "text-amber-400",   iconBg: "bg-amber-900/40",    iconColor: "text-amber-500",   top: "bg-gradient-to-r from-amber-400 to-orange-400",     testid: "stat-partial",   delay: "animation-delay-300" },
              { label: "Gagal",    value: statFail,  icon: XCircle,      numColor: "text-red-400",     iconBg: "bg-red-900/40",      iconColor: "text-red-500",     top: "bg-gradient-to-r from-red-400 to-rose-500",         testid: "stat-failed",    delay: "animation-delay-400" },
              { label: "Duplikat", value: statDupe,  icon: Copy,         numColor: "text-violet-400",  iconBg: "bg-violet-900/40",   iconColor: "text-violet-500",  top: "bg-gradient-to-r from-violet-400 to-purple-500",    testid: "stat-duplicate", delay: "animation-delay-500" },
            ].map(({ label, value, icon: Icon, numColor, iconBg, iconColor, top, testid, delay }, idx) => (
              <div key={label} className={`${idx === 4 ? "col-span-2 sm:col-span-1" : ""} bg-[#0d0720] rounded-xl sm:rounded-2xl border border-violet-700/40 overflow-hidden stat-glow animate-scale-in ${delay} cursor-default`}>
                {/* Coloured top accent */}
                <div className={`h-[3px] w-full ${top}`} />
                {/* Unified layout: label+icon top, big number bottom */}
                <div className="px-3 sm:px-3.5 lg:px-5 py-3 lg:py-4">
                  <div className="flex items-center justify-between mb-2 lg:mb-3">
                    <p className="text-[9px] lg:text-[11px] text-slate-400 font-bold uppercase tracking-widest leading-none">{label}</p>
                    <div className={`w-6 h-6 lg:w-8 lg:h-8 rounded-md lg:rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
                      <Icon className={`w-3 h-3 lg:w-4 lg:h-4 ${iconColor}`} />
                    </div>
                  </div>
                  <p data-testid={testid} className={`text-3xl sm:text-2xl lg:text-4xl font-extrabold leading-none tabular-nums ${numColor}`} style={value > 0 ? { textShadow: "0 0 20px currentColor, 0 0 8px currentColor" } : {}}>{value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* ── Pipeline Nudge Banner ── */}
          {!isRunning && eligibleArticles.length > 0 && kbDraft.length === 0 && (
            <div className="flex flex-col gap-3 bg-indigo-900/20 border border-indigo-700/30 rounded-2xl px-4 py-3.5 animate-fade-in-up">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-indigo-900/200 rounded-xl flex items-center justify-center shrink-0">
                  <Activity className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-indigo-200">
                    {eligibleArticles.length} artikel siap — ikuti pipeline KB di bawah
                  </p>
                  <p className="text-xs text-indigo-400 mt-0.5">Jalankan setiap langkah secara berurutan</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { n: 1, label: "Scraping", done: true,       color: "bg-emerald-900/200 text-white" },
                  { n: 2, label: "Summary",  done: summaryDone, color: "bg-indigo-900/200 text-white" },
                  { n: 3, label: "Auto Tag", done: tagDone,     color: "bg-violet-900/200 text-white" },
                  { n: 4, label: "Convert KB", done: kbDone,   color: "bg-amber-900/200 text-white" },
                  { n: 5, label: "Push Supabase", done: false,  color: "bg-slate-400 text-white" },
                ].map(({ n, label, done, color }, idx, arr) => (
                  <span key={n} className="flex items-center gap-1">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full transition-all ${done ? color : "bg-white/8 border border-indigo-700/30 text-indigo-300"}`}>
                      <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-extrabold">
                        {done ? "✓" : n}
                      </span>
                      {label}
                    </span>
                    {idx < arr.length - 1 && <ArrowRight className="w-2.5 h-2.5 text-indigo-300 shrink-0" />}
                  </span>
                ))}
              </div>
            </div>
          )}

          {!isRunning && kbDraft.length > 0 && (
            <div className="flex items-center gap-3 bg-emerald-900/20 border border-emerald-700/30 rounded-2xl px-4 py-3.5 animate-fade-in-up">
              <div className="w-8 h-8 bg-emerald-900/200 rounded-xl flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-emerald-200">KB Draft siap — {kbDraft.length} artikel</p>
                <p className="text-xs text-emerald-300 mt-0.5">
                  Buka Review Dashboard untuk approval workflow, atau jalankan AI Summary sebelum dikirim ke Supabase.
                </p>
              </div>
              <Link to="/review">
                <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 text-xs h-8 rounded-xl">
                  <CheckSquare className="w-3.5 h-3.5" />Review KB Draft
                </Button>
              </Link>
            </div>
          )}

          {/* ── 3-column Grid ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5 items-start">

            {/* ═══ Left: Results + KB Pipeline (2 cols) ═══ */}
            <div className="lg:col-span-2 space-y-4 lg:space-y-5">

              {/* Results Card */}
              <div ref={resultsRef} className="bg-[#0d0720] rounded-2xl border border-violet-700/40 shadow-[0_0_24px_rgba(109,40,217,0.12)] overflow-hidden animate-fade-in-up animation-delay-200">
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 bg-indigo-900/40 rounded-lg flex items-center justify-center">
                      <ClipboardList className="w-3.5 h-3.5 text-indigo-400" />
                    </div>
                    <h2 className="text-sm font-bold text-slate-100">Hasil Scraping</h2>
                    {/* Live article counter — updates every 2s during scrape */}
                    {articles.length > 0 && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                        isRunning
                          ? "text-indigo-400 bg-indigo-900/40 animate-pulse"
                          : "text-indigo-500 bg-indigo-900/20"
                      }`}>
                        {hasActiveFilter ? `${filteredArticles.length} / ${articles.length}` : articles.length}
                      </span>
                    )}
                    {isRunning && articles.length === 0 && progress.phase === "scraping" && (
                      <span className="text-xs text-indigo-500 bg-indigo-900/20 px-2 py-0.5 rounded-full font-medium animate-pulse">
                        {progress.success} artikel
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {articles.length > 0 && (
                      <div className="flex items-center bg-white/10 rounded-lg p-0.5 gap-0.5">
                        <button onClick={() => setViewMode("table")}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${viewMode === "table" ? "bg-violet-600 text-white shadow-sm" : "text-slate-400 hover:text-slate-500"}`}>
                          <LayoutList className="w-3.5 h-3.5" />Tabel
                        </button>
                        <button onClick={() => setViewMode("markdown")}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${viewMode === "markdown" ? "bg-violet-600 text-white shadow-sm" : "text-slate-400 hover:text-slate-500"}`}>
                          <FileCode2 className="w-3.5 h-3.5" />Markdown
                        </button>
                      </div>
                    )}
                    {articles.length > 0 && (
                      <Button variant="ghost" size="sm" onClick={fetchArticles}
                        className="gap-1 text-slate-400 hover:text-indigo-400 hover:bg-indigo-900/20 h-7 text-xs px-2 rounded-lg">
                        <RefreshCw className="w-3 h-3" />
                      </Button>
                    )}
                    {articles.length > 0 && !clearAllConfirm && (
                      <Button variant="ghost" size="sm" onClick={() => setClearAllConfirm(true)}
                        disabled={isRunning || deleteLoading}
                        className="gap-1 text-red-400 hover:text-red-400 hover:bg-red-900/20 h-7 text-xs px-2 rounded-lg">
                        <Trash2 className="w-3 h-3" />Hapus Semua
                      </Button>
                    )}
                    {clearAllConfirm && (
                      <div className="flex items-center gap-1.5 bg-red-900/20 border border-red-700/30 rounded-lg px-2.5 py-1">
                        <span className="text-xs text-red-300 font-medium whitespace-nowrap">Yakin hapus semua?</span>
                        <button onClick={clearAllArticles} disabled={deleteLoading}
                          className="text-xs font-bold text-white bg-red-600 hover:bg-red-700 px-2 py-0.5 rounded-md">
                          {deleteLoading ? "..." : "Ya"}
                        </button>
                        <button onClick={() => setClearAllConfirm(false)}
                          className="text-xs text-slate-500 hover:text-slate-200 px-1.5 py-0.5 rounded-md hover:bg-white/10">
                          Batal
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Live scraping status strip ── */}
                {isRunning && (
                  <div className={`flex items-center gap-3 px-5 py-2.5 border-b ${
                    progress.phase === "listing"
                      ? "bg-blue-900/20 border-blue-700/30"
                      : "bg-indigo-900/20 border-indigo-700/30"
                  }`}>
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-indigo-500" />
                    <div className="flex-1 min-w-0">
                      {progress.phase === "listing" ? (
                        <p className="text-xs font-semibold text-blue-300">
                          Mengumpulkan daftar artikel dari halaman...
                        </p>
                      ) : (
                        <div className="flex items-center gap-3">
                          <p className="text-xs font-semibold text-indigo-300 shrink-0">
                            Scraping {progress.current} / {progress.total}
                          </p>
                          <div className="flex-1 h-1.5 bg-indigo-900/40 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-900/200 rounded-full transition-all duration-500"
                              style={{ width: `${progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-bold text-indigo-500 tabular-nums shrink-0">
                            {progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}%
                          </span>
                        </div>
                      )}
                      {progress.phase === "scraping" && (
                        <p className="text-[10px] text-indigo-400 mt-0.5">
                          {progress.success} berhasil · {progress.partial > 0 ? `${progress.partial} partial · ` : ""}{progress.failed > 0 ? `${progress.failed} gagal · ` : ""}{progress.duplicate > 0 ? `${progress.duplicate} duplikat` : ""}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {articles.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-white/10 bg-white/5">
                    <div className="relative flex-1 min-w-[120px]">
                      <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <Input data-testid="filter-title" value={titleFilter}
                        onChange={e => setTitleFilter(e.target.value)}
                        placeholder="Cari judul..." className="pl-8 h-8 text-xs border-white/15 w-full bg-white/8 text-slate-200 placeholder:text-slate-500 rounded-full" />
                    </div>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger data-testid="filter-status" className="w-32 h-8 text-xs border-white/15 bg-white/8 text-white rounded-full">
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
                      className="hidden md:block w-32 h-8 text-xs border-white/15 bg-white/8 text-white" />
                    <span className="hidden md:block text-slate-500 text-xs">→</span>
                    <Input data-testid="filter-date-to" type="date" value={dateTo}
                      onChange={e => setDateTo(e.target.value)}
                      className="hidden md:block w-32 h-8 text-xs border-white/15 bg-white/8 text-white" />
                    {hasActiveFilter && (
                      <Button variant="ghost" size="sm" onClick={clearFilters}
                        className="h-8 text-xs text-red-500 hover:bg-red-900/20 px-2 gap-1">
                        ✕ Hapus
                      </Button>
                    )}
                  </div>
                )}

                {/* Bulk action bar */}
                {selectedArticles.size > 0 && (
                  <div className="flex items-center gap-2 px-5 py-2.5 bg-red-900/20 border-b border-red-700/30">
                    <span className="text-xs font-semibold text-red-300">{selectedArticles.size} artikel dipilih</span>
                    <Button size="sm" disabled={deleteLoading}
                      onClick={deleteSelectedArticles}
                      className="gap-1.5 text-white bg-red-600 hover:bg-red-700 h-7 text-xs px-3 rounded-lg">
                      {deleteLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      Hapus Terpilih
                    </Button>
                    <button onClick={() => setSelectedArticles(new Set())}
                      className="text-xs text-slate-400 hover:text-slate-200 underline">
                      Batal pilih
                    </button>
                  </div>
                )}

                {loadingArticles ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                    <div className="w-8 h-8 rounded-full border-2 border-white/15 border-t-indigo-400 animate-spin" />
                    <p className="text-sm text-slate-500">Memuat artikel...</p>
                  </div>
                ) : articles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-900/30 to-slate-800/30 flex items-center justify-center">
                      <Newspaper className="w-6 h-6 text-indigo-300" />
                    </div>
                    <div className="text-center space-y-1">
                      <p className="text-sm font-semibold text-slate-200">Belum ada artikel</p>
                      <p className="text-xs text-slate-400 max-w-xs">Masukkan URL halaman berita di atas, pilih mode, lalu klik <strong className="text-slate-500">Mulai Scraping</strong></p>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 bg-white/8 border border-white/15 rounded-full px-3.5 py-1.5">
                      <Zap className="w-3 h-3 text-indigo-400" />Scraping → Stats → KB Pipeline
                    </div>
                  </div>
                ) : filteredArticles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-4">
                    <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center">
                      <AlertCircle className="w-5 h-5 text-slate-500" />
                    </div>
                    <div className="text-center space-y-1">
                      <p className="text-sm font-semibold text-slate-200">Tidak ada hasil yang cocok</p>
                      <p className="text-xs text-slate-400">{articles.length} artikel tersimpan, tapi tidak ada yang cocok filter aktif.</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={clearFilters} className="text-xs gap-1.5 h-8 border-white/15 text-slate-400">
                      Hapus Semua Filter
                    </Button>
                  </div>
                ) : viewMode === "markdown" ? (
                  <div className="divide-y divide-white/10">
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
                          className="px-5 py-5 hover:bg-white/5 transition-colors group">
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <span className="text-[10px] text-slate-500 tabular-nums font-mono mt-1 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <StatusBadge status={article.status} />
                              <Button data-testid={`button-detail-${article.id}`} size="sm" variant="outline"
                                onClick={() => navigate(`/article/${article.id}`)}
                                className="h-7 text-xs px-2 border-white/15 text-slate-400 hover:text-indigo-300 hover:border-indigo-500 hover:bg-indigo-900/20 gap-1 transition-colors">
                                <Eye className="w-3 h-3" />Detail
                              </Button>
                              <a href={article.url} target="_blank" rel="noopener noreferrer"
                                data-testid={`link-source-${article.id}`}
                                className="flex items-center justify-center w-7 h-7 rounded-md border border-white/15 text-slate-500 hover:text-indigo-300 hover:border-indigo-500 hover:bg-indigo-900/20 transition-colors">
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          </div>
                          <div className="prose prose-sm max-w-none prose-headings:text-white prose-a:text-indigo-400 prose-p:text-slate-500 prose-p:text-sm">
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
                        <tr className="border-b border-white/10 bg-white/5">
                          <th className="px-4 py-3 w-10">
                            <Checkbox
                              checked={filteredArticles.length > 0 && selectedArticles.size === filteredArticles.length}
                              onCheckedChange={toggleSelectAllArticles}
                              className={selectedArticles.size > 0 && selectedArticles.size < filteredArticles.length ? "data-[state=checked]:bg-slate-400" : ""}
                            />
                          </th>
                          <th className="hidden sm:table-cell text-left px-3 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wide w-8">#</th>
                          <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Judul</th>
                          <th className="hidden md:table-cell text-left px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wide w-28">Tanggal</th>
                          <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wide w-24">Status</th>
                          <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wide w-24">Aksi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredArticles.map((article, i) => {
                          const isSelected = selectedArticles.has(article.id);
                          const rowDelay = i < 8 ? `animation-delay-${[75, 100, 150, 200, 300, 400, 500, 600][i]}` : "";
                          return (
                          <tr key={article.id} data-testid={`row-article-${article.id}`}
                            className={`border-b border-white/5 transition-colors align-top animate-fade-in-up ${rowDelay} ${isSelected ? "bg-red-900/20" : i % 2 === 1 ? "bg-white/3 hover:bg-violet-900/10" : "hover:bg-violet-900/10"}`}>
                            <td className="px-4 py-4 w-10">
                              <Checkbox checked={isSelected} onCheckedChange={() => toggleSelectArticle(article.id)} />
                            </td>
                            <td className="hidden sm:table-cell px-3 py-4 text-slate-500 text-xs tabular-nums font-mono">{i + 1}</td>
                            <td className="px-4 py-4 max-w-0">
                              <p className="font-medium text-slate-100 text-sm leading-snug truncate">{article.title || "(Tanpa Judul)"}</p>
                              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed line-clamp-1">
                                {article.content
                                  ? article.content.slice(0, 120) + (article.content.length > 120 ? "…" : "")
                                  : <span className="italic text-slate-500">—</span>}
                              </p>
                              {article.url && (() => {
                                const meta = getSourceMeta(article.url);
                                return (
                                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${meta.categoryColor}`}>
                                      <Globe className="w-2.5 h-2.5" />{meta.category}
                                    </span>
                                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${meta.trustColor}`}>
                                      <Shield className="w-2.5 h-2.5" />Trust: {meta.trust}
                                    </span>
                                  </div>
                                );
                              })()}
                              {article.status === "partial" && (
                                <div className="mt-1.5 flex items-start gap-1.5 text-[10px] text-amber-300 bg-amber-900/20 border border-amber-700/30 rounded-md px-2 py-1 leading-snug">
                                  <AlertCircle className="w-3 h-3 shrink-0 mt-px" />
                                  <span>
                                    {article.error_reason
                                      ? `${ERROR_REASON_LABELS[article.error_reason] || article.error_reason} — `
                                      : ""}
                                    Konten tidak lengkap, namun tetap dapat dikonversi ke KB Draft.
                                  </span>
                                </div>
                              )}
                              {article.status === "failed" && article.error_reason && (
                                <div className="mt-1.5 flex items-start gap-1.5 text-[10px] text-red-400 bg-red-900/20 border border-red-700/30 rounded-md px-2 py-1 leading-snug">
                                  <XCircle className="w-3 h-3 shrink-0 mt-px" />
                                  <span>{ERROR_REASON_LABELS[article.error_reason] || article.error_reason} — Artikel tidak dapat dikonversi ke KB.</span>
                                </div>
                              )}
                            </td>
                            <td className="hidden md:table-cell px-4 py-4 text-slate-400 text-xs whitespace-nowrap tabular-nums">{article.date || "—"}</td>
                            <td className="px-4 py-4"><StatusBadge status={article.status} /></td>
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-1.5">
                                <Button data-testid={`button-detail-${article.id}`} size="sm" variant="outline"
                                  onClick={() => navigate(`/article/${article.id}`)}
                                  className="h-7 text-xs px-2 border-white/15 text-slate-400 hover:text-indigo-300 hover:border-indigo-500 hover:bg-indigo-900/20 gap-1 transition-colors">
                                  <Eye className="w-3 h-3" /><span className="hidden sm:inline">Detail</span>
                                </Button>
                                <a href={article.url} target="_blank" rel="noopener noreferrer"
                                  data-testid={`link-source-${article.id}`}
                                  className="flex items-center justify-center w-7 h-7 rounded-md border border-white/15 text-slate-500 hover:text-indigo-300 hover:border-indigo-500 hover:bg-indigo-900/20 transition-colors">
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* KB Pipeline Card */}
              <div className="bg-[#0d0720] rounded-2xl border border-violet-700/40 shadow-[0_0_24px_rgba(109,40,217,0.12)] overflow-hidden animate-fade-in-up animation-delay-300">
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 bg-indigo-900/40 rounded-lg flex items-center justify-center">
                      <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                    </div>
                    <h2 className="text-sm font-bold text-slate-100">KB Pipeline</h2>
                    {eligibleArticles.length > 0 && (
                      <span className="text-xs text-emerald-400 bg-emerald-900/20 px-2 py-0.5 rounded-full font-medium">
                        {eligibleArticles.length} eligible
                      </span>
                    )}
                  </div>
                  {kbDraft.length > 0 && (
                    <div className="flex items-center gap-2">
                      <a href={apiUrl("/export/kb-markdown")} download>
                        <Button variant="ghost" size="sm"
                          className="h-7 text-xs gap-1.5 text-violet-400 hover:bg-violet-900/20 rounded-lg">
                          <Download className="w-3 h-3" />Download .md
                        </Button>
                      </a>
                      <a href={apiUrl("/export/kb")} download>
                        <Button data-testid="button-download-kb" variant="ghost" size="sm"
                          className="h-7 text-xs gap-1.5 text-emerald-400 hover:bg-emerald-900/20 rounded-lg">
                          <Download className="w-3 h-3" />Export JSON
                        </Button>
                      </a>
                      <Link to="/review">
                        <Button variant="ghost" size="sm"
                          className="h-7 text-xs gap-1.5 text-indigo-400 hover:bg-indigo-900/20 rounded-lg">
                          <CheckSquare className="w-3 h-3" />Review
                        </Button>
                      </Link>
                    </div>
                  )}
                </div>

                {articles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-900/30 to-violet-900/30 flex items-center justify-center">
                      <BookOpen className="w-6 h-6 text-indigo-300" />
                    </div>
                    <div className="text-center space-y-1">
                      <p className="text-sm font-semibold text-slate-200">Pipeline belum tersedia</p>
                      <p className="text-xs text-slate-400">Lakukan scraping terlebih dahulu untuk mengaktifkan KB Pipeline</p>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] flex-wrap justify-center">
                      {["Scraping", "Summary", "Auto Tag", "KB Draft", "Review"].map((s, i, arr) => (
                        <span key={s} className="flex items-center gap-2">
                          <span className="text-slate-500 bg-white/10 border border-white/15 px-2.5 py-1 rounded-full font-medium">{s}</span>
                          {i < arr.length - 1 && <ArrowRight className="w-3 h-3 text-slate-500" />}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-5">
                    <Tabs defaultValue="kb-draft">
                      <TabsList className="mb-5 bg-white/10 border border-white/15 h-9">
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
                          <div className={`rounded-2xl p-4 space-y-3 transition-all duration-200 ${summaryDone ? "bg-emerald-900/20/40" : "bg-white/5"}`}>
                            <div className="flex items-start gap-3">
                              <StepBadge n={1} done={summaryDone} />
                              <div className="flex-1 min-w-0 pt-0.5">
                                <h3 className="font-semibold text-sm text-slate-100">Generate Summary</h3>
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
                                <span className="text-xs text-emerald-400 font-medium">{summaryResult.updated} artikel diberi summary.</span>
                              )}
                              {summaryError && <span className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{summaryError}</span>}
                            </div>
                          </div>
                          {/* Step 2 */}
                          <div className={`rounded-2xl p-4 space-y-3 transition-all duration-200 ${tagDone ? "bg-emerald-900/20/40" : "bg-white/5"}`}>
                            <div className="flex items-start gap-3">
                              <StepBadge n={2} done={tagDone} />
                              <div className="flex-1 min-w-0 pt-0.5">
                                <h3 className="font-semibold text-sm text-slate-100">Auto Tagging</h3>
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
                              {tagDone && <span className="text-xs text-emerald-400 font-medium">Semua artikel berhasil di-tag.</span>}
                              {tagError && <span className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{tagError}</span>}
                            </div>
                          </div>
                          {/* Step 3 */}
                          <div className={`rounded-2xl p-4 space-y-3 transition-all duration-200 ${kbDone ? "bg-emerald-900/20/40" : "bg-white/5"}`}>
                            <div className="flex items-start gap-3">
                              <StepBadge n={3} done={kbDone} />
                              <div className="flex-1 min-w-0 pt-0.5">
                                <h3 className="font-semibold text-sm text-slate-100 flex items-center gap-2">
                                  Convert to KB Draft
                                  {kbDone && <span className="text-[10px] font-medium text-emerald-400 bg-emerald-900/20 border border-emerald-700/40 px-2 py-0.5 rounded-full">{kbDraft.length} artikel</span>}
                                </h3>
                                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                                  Konversi artikel success/partial ke format KB draft AINA. Status awal:{" "}
                                  <span className="font-mono text-amber-300 bg-amber-900/20 border border-amber-700/40 px-1.5 py-px rounded-full text-[10px] font-medium">pending</span>.
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 pl-10">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-slate-500 font-medium whitespace-nowrap">Berita dari:</span>
                                <select
                                  value={kbCutoff}
                                  onChange={e => setKbCutoff(e.target.value)}
                                  disabled={kbLoading || isRunning}
                                  className="text-xs border border-white/15 rounded-lg px-2 py-1 bg-[#0d0720] text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer">
                                  <option value="all">Semua waktu</option>
                                  <option value="7">7 hari terakhir</option>
                                  <option value="30">30 hari terakhir</option>
                                  <option value="90">90 hari terakhir</option>
                                  <option value="180">6 bulan terakhir</option>
                                </select>
                              </div>
                              <Button data-testid="button-convert-kb" onClick={doConvertKb}
                                disabled={kbLoading || isRunning || eligibleArticles.length === 0}
                                size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 h-8 shadow-sm">
                                {kbLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : kbDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : <ClipboardList className="w-3.5 h-3.5" />}
                                {kbLoading ? "Mengkonversi..." : kbDone ? "Re-convert" : "Convert to KB Draft"}
                              </Button>
                              <Button variant="ghost" size="sm" onClick={fetchKbDraft} disabled={kbDraftLoading}
                                className="h-8 w-8 p-0 text-slate-400 hover:text-slate-500">
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
                          <div className="rounded-xl border border-white/15 overflow-hidden mt-4">
                            <div className="flex items-center gap-2 px-4 py-2.5 bg-white/5 border-b border-white/15">
                              <ClipboardList className="w-3.5 h-3.5 text-indigo-400" />
                              <span className="text-xs font-semibold text-slate-500">Preview KB Draft</span>
                              <span className="text-xs text-slate-400">({kbDraft.length} artikel)</span>
                            </div>
                            <div className="overflow-x-auto max-h-72 overflow-y-auto">
                              <table className="w-full text-xs">
                                <thead className="sticky top-0 z-10">
                                  <tr className="bg-white/5 border-b border-white/10 text-slate-400">
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
                                      className={`border-b border-white/5 hover:bg-indigo-900/20/30 transition-colors align-top ${i % 2 === 1 ? "bg-white/5" : ""}`}>
                                      <td className="px-4 py-2.5 text-slate-500 tabular-nums">{i + 1}</td>
                                      <td className="px-4 py-2.5">
                                        <p className="font-medium text-slate-100 line-clamp-2 leading-snug">{kb.title || "(Tanpa Judul)"}</p>
                                        {kb.published_date && <p className="text-slate-400 mt-0.5">{kb.published_date}</p>}
                                      </td>
                                      <td className="px-4 py-2.5">
                                        <span data-testid={`slug-${i}`} className="font-mono text-indigo-400 bg-indigo-900/20 px-1.5 py-0.5 rounded break-all">{kb.slug}</span>
                                      </td>
                                      <td className="px-4 py-2.5">
                                        <p data-testid={`summary-${i}`} className="text-slate-500 line-clamp-3 leading-relaxed">
                                          {kb.summary || <span className="italic text-slate-500">—</span>}
                                        </p>
                                      </td>
                                      <td className="px-4 py-2.5">
                                        <div data-testid={`tags-${i}`} className="flex flex-wrap gap-1">
                                          {(kb.tags || []).map(t => (
                                            <span key={t} className="bg-indigo-900/20 text-indigo-400 px-1.5 py-px rounded font-medium">{t}</span>
                                          ))}
                                        </div>
                                      </td>
                                      <td className="px-4 py-2.5">
                                        <span data-testid={`approval-${i}`}
                                          className={`inline-block px-2 py-0.5 rounded font-semibold capitalize ${APPROVAL_COLORS[kb.approval_status] || "bg-white/10 text-slate-500"}`}>
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
                        <div className="border border-white/15 rounded-xl p-5 space-y-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-violet-900/40 flex items-center justify-center shrink-0">
                              <Sparkles className="w-4 h-4 text-violet-400" />
                            </div>
                            <div>
                              <h3 className="font-semibold text-sm text-slate-100">AI Summary — GPT-4o-mini</h3>
                              <p className="text-xs text-slate-500">Upgrade ringkasan dengan AI untuk semua artikel di KB Draft</p>
                            </div>
                          </div>
                          {kbDraft.length === 0 ? (
                            <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg px-4 py-3 flex items-center gap-2 text-xs text-amber-300">
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
                          {aiDone && <p data-testid="text-ai-success" className="text-emerald-400 text-sm flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" />AI summary berhasil disimpan.</p>}
                        </div>
                      </TabsContent>

                      <TabsContent value="supabase" className="mt-0">
                        <div className="border border-white/15 rounded-xl p-5 space-y-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-emerald-900/40 flex items-center justify-center shrink-0">
                              <Database className="w-4 h-4 text-emerald-400" />
                            </div>
                            <div>
                              <h3 className="font-semibold text-sm text-slate-100">Push ke Supabase AINA</h3>
                              <p className="text-xs text-slate-500">
                                Insert semua KB articles ke tabel <span className="font-mono bg-white/10 px-1 rounded">knowledge_base</span> AINA dengan <span className="font-mono bg-white/10 px-1 rounded">status: pending</span> untuk review admin.
                              </p>
                            </div>
                          </div>
                          {kbDraft.length === 0 ? (
                            <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg px-4 py-3 flex items-center gap-2 text-xs text-amber-300">
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
                                disabled={dbLoading} variant="outline" className="gap-2 border-white/15">
                                {dbLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                                {dbLoading ? "Mengambil..." : "Lihat Data"}
                              </Button>
                            </div>
                          )}
                          {pushError && <p data-testid="text-push-error" className="text-red-500 text-sm flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" />{pushError}</p>}
                          {dbError && <p data-testid="text-db-error" className="text-red-500 text-sm flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" />{dbError}</p>}
                          {dbArticles.length > 0 && (
                            <div className="rounded-xl border border-white/15 overflow-hidden">
                              <div className="bg-white/5 px-4 py-2 text-xs font-semibold text-slate-500 border-b">
                                {dbArticles.length} artikel di Supabase
                              </div>
                              <div className="overflow-x-auto max-h-56 overflow-y-auto">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b bg-white/5 text-slate-400">
                                      <th className="text-left px-4 py-2 font-semibold">Judul</th>
                                      <th className="text-left px-4 py-2 font-semibold w-32">Kategori</th>
                                      <th className="text-left px-4 py-2 font-semibold w-24">Status AINA</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {dbArticles.map((a, i) => (
                                      <tr key={i} className="border-b hover:bg-white/5 transition-colors">
                                        <td className="px-4 py-2 text-slate-100 font-medium">{a.title || "(Tanpa Judul)"}</td>
                                        <td className="px-4 py-2 text-slate-500">{a.category || "—"}</td>
                                        <td className="px-4 py-2">
                                          <span className={`px-1.5 py-px rounded font-medium ${
                                            a.status === "approved" ? "bg-emerald-900/20 text-emerald-300" :
                                            a.status === "rejected" ? "bg-red-900/20 text-red-400" :
                                            "bg-amber-900/20 text-amber-300"
                                          }`}>{a.status || "pending"}</span>
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
            <div className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">

              {/* Log Panel */}
              <div className="bg-[#0d0720] rounded-2xl border border-violet-700/40 shadow-[0_0_24px_rgba(109,40,217,0.12)] overflow-hidden animate-slide-in-right animation-delay-200">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-white/10 rounded-lg flex items-center justify-center">
                      <Terminal className="w-3.5 h-3.5 text-slate-500" />
                    </div>
                    <span className="text-sm font-bold text-slate-100">Log Proses</span>
                    {isRunning && (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-900/200" />
                        </span>
                        Live
                      </span>
                    )}
                  </div>
                  {(progress.phase === "listing" || progress.phase === "scraping") && (
                    <div className="flex items-center gap-2">
                      {progress.phase === "scraping" && (
                        <span className="text-xs font-bold text-indigo-400 tabular-nums">{pct}%</span>
                      )}
                      <div className="w-20">
                        {progress.phase === "scraping"
                          ? <Progress value={pct} className="h-1.5" />
                          : <div className="relative h-1.5 rounded-full bg-white/10 overflow-hidden">
                              <div className="absolute top-0 left-0 h-full w-1/2 bg-indigo-400 rounded-full"
                                style={{ animation: "indeterminate 1.4s ease-in-out infinite" }} />
                            </div>
                        }
                      </div>
                    </div>
                  )}
                </div>

                {/* Status banner — prominent indicator */}
                {progress.phase === "done" ? (
                  progress.failed === 0 && progress.partial === 0 ? (
                    <div className="flex items-center gap-3 px-4 py-3 bg-emerald-900/20 border-b border-emerald-700/30">
                      <div className="w-7 h-7 rounded-full bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-emerald-300">Scraping selesai!</p>
                        <p className="text-xs text-emerald-400">
                          {progress.success} artikel berhasil
                          {progress.duplicate > 0 && ` · ${progress.duplicate} duplikat dilewati`}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-3 bg-amber-900/20 border-b border-amber-700/30">
                      <div className="w-7 h-7 rounded-full bg-amber-900/40 flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-amber-300">Selesai dengan peringatan</p>
                        <p className="text-xs text-amber-300">
                          {progress.success} berhasil · {progress.partial > 0 && `${progress.partial} partial · `}{progress.failed > 0 && `${progress.failed} gagal · `}{progress.duplicate > 0 && `${progress.duplicate} duplikat`}
                        </p>
                      </div>
                    </div>
                  )
                ) : isRunning ? (
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-indigo-900/20 border-b border-indigo-700/30">
                    <Loader2 className="w-4 h-4 text-indigo-500 animate-spin flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-indigo-300">
                        {progress.phase === "listing"
                          ? "Mengumpulkan daftar artikel..."
                          : `Scraping artikel ${progress.current} / ${progress.total}`}
                      </p>
                      {progress.phase === "scraping" && progress.total > 0 && (
                        <p className="text-[10px] text-indigo-400 mt-0.5">
                          {progress.success} berhasil · {progress.failed} gagal · {progress.duplicate} duplikat
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}

                {/* Terminal-style log bar */}
                <div className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 border-b border-slate-600">
                  <Circle className="w-2 h-2 text-red-400 fill-red-400" />
                  <Circle className="w-2 h-2 text-amber-400 fill-amber-400" />
                  <Circle className="w-2 h-2 text-emerald-400 fill-emerald-400" />
                  <span className="text-slate-400 text-[10px] ml-2 font-mono">
                    {progress.phase === "idle" ? "Menunggu perintah scraping..." : (phaseLabel[progress.phase] || progress.phase)}
                  </span>
                </div>

                {/* Log content */}
                <div ref={logRef} data-testid="log-panel"
                  className="bg-[#1e2433] px-4 py-3 h-52 overflow-y-auto font-mono">
                  {progress.logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                      <Terminal className="w-6 h-6 text-slate-200" />
                      <p className="text-slate-500 text-xs leading-relaxed">
                        Log scraping akan tampil di sini<br />
                        <span className="text-slate-200">setelah kamu klik Mulai Scraping</span>
                      </p>
                    </div>
                  ) : (
                    progress.logs.map((line, i) => (
                      <div key={i} className={`text-xs leading-5 ${logColor(line)}`}>
                        <span className="text-slate-200 select-none mr-2 tabular-nums">{String(i + 1).padStart(3, "0")}</span>
                        {line}
                      </div>
                    ))
                  )}
                  {isRunning && (
                    <div className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      <span className="animate-pulse">memproses...</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Scheduler Card */}
              <div className="bg-[#0d0720] rounded-2xl border border-violet-700/40 shadow-[0_0_24px_rgba(109,40,217,0.12)] overflow-hidden animate-slide-in-right animation-delay-300">
                <button
                  onClick={() => setSchedulerOpen(o => !o)}
                  className="w-full flex items-center justify-between px-4 py-3.5 border-b border-white/10 hover:bg-white/5 transition-colors"
                  data-testid="scheduler-toggle"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-indigo-900/40 rounded-lg flex items-center justify-center">
                      <Timer className="w-3.5 h-3.5 text-indigo-400" />
                    </div>
                    <span className="text-sm font-bold text-slate-100">Scheduler</span>
                    {schedulerSettings.enabled && schedulerSettings.interval !== "manual" && (
                      <span className="text-[10px] font-semibold text-indigo-300 bg-indigo-900/40 px-2 py-0.5 rounded-full">
                        {schedulerSettings.interval === "daily" ? "Harian" : "Mingguan"}
                      </span>
                    )}
                  </div>
                  {schedulerOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>

                {schedulerOpen && (
                  <div className="p-4 space-y-4">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-xl bg-white/5 p-2.5 text-center">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide">Last Run</p>
                        <p className="text-xs font-semibold text-slate-200 mt-0.5 tabular-nums leading-tight">
                          {schedulerSettings.last_run_at
                            ? new Date(schedulerSettings.last_run_at).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })
                            : "—"}
                        </p>
                      </div>
                      <div className="rounded-xl bg-indigo-900/20 p-2.5 text-center">
                        <p className="text-[10px] text-indigo-400 uppercase tracking-wide">Next</p>
                        <p className="text-xs font-semibold text-indigo-300 mt-0.5 tabular-nums leading-tight">
                          {schedulerSettings.next_run_at
                            ? new Date(schedulerSettings.next_run_at).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })
                            : "—"}
                        </p>
                      </div>
                      <div className="rounded-xl bg-emerald-900/20 p-2.5 text-center">
                        <p className="text-[10px] text-emerald-500 uppercase tracking-wide">Artikel</p>
                        <p className="text-xl font-bold text-emerald-300 mt-0.5 tabular-nums leading-none">
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
                            <SelectTrigger data-testid="scheduler-interval" className="h-8 text-xs bg-white/5 border-white/15">
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
                              className="w-24 h-8 text-xs bg-white/5 border-white/15" />
                          </div>
                        )}
                      </div>
                      {schedulerSettings.interval === "weekly" && (
                        <div className="space-y-1">
                          <Label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Hari</Label>
                          <Select value={schedulerSettings.day_of_week}
                            onValueChange={v => setSchedulerSettings(s => ({ ...s, day_of_week: v }))}>
                            <SelectTrigger data-testid="scheduler-dow" className="h-8 text-xs bg-white/5 border-white/15">
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
                          placeholder="https://contoh.com/kategori/berita"
                          value={schedulerSettings.url}
                          onChange={e => setSchedulerSettings(s => ({ ...s, url: e.target.value }))}
                          className="h-8 text-xs bg-white/5 border-white/15" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Mode Scraping</Label>
                        <Select value={schedulerSettings.scrape_mode}
                          onValueChange={v => setSchedulerSettings(s => ({ ...s, scrape_mode: v }))}>
                          <SelectTrigger data-testid="scheduler-mode" className="h-8 text-xs bg-white/5 border-white/15">
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
                            ? <ToggleRight className="w-8 h-8 text-indigo-400" />
                            : <ToggleLeft className="w-8 h-8 text-slate-500" />}
                        </button>
                        <div>
                          <p className="text-xs font-semibold text-slate-200">Incremental</p>
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
                        className="gap-1.5 h-8 border-white/15 text-slate-500 hover:text-indigo-400 hover:border-indigo-300 rounded-full">
                        {schedulerRunNow ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                        Jalankan
                      </Button>
                      <Button variant="ghost" size="sm" onClick={fetchSchedulerSettings}
                        className="h-8 w-8 p-0 text-slate-400 hover:text-slate-500">
                        <RefreshCw className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    {schedulerSettings.interval !== "manual" && schedulerSettings.enabled && (
                      <p className="text-[11px] text-indigo-400 bg-indigo-900/20 border border-indigo-100 px-3 py-2 rounded-lg leading-relaxed">
                        ✓ Aktif — {schedulerSettings.interval === "daily"
                          ? `setiap hari pukul ${schedulerSettings.time_of_day}`
                          : `setiap ${DOW_LABELS[schedulerSettings.day_of_week] || schedulerSettings.day_of_week} pukul ${schedulerSettings.time_of_day}`} WIB
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Riwayat Pipeline Card */}
              <div className="bg-[#0d0720] rounded-2xl border border-violet-700/40 shadow-[0_0_24px_rgba(109,40,217,0.12)] overflow-hidden animate-slide-in-right animation-delay-350">
                <button
                  onClick={() => { setHistoryOpen(o => !o); if (!historyOpen) fetchIngestionHistory(); }}
                  className="w-full flex items-center justify-between px-4 py-3.5 border-b border-white/10 hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-emerald-900/40 rounded-lg flex items-center justify-center">
                      <History className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <span className="text-sm font-bold text-slate-100">Riwayat Pipeline</span>
                    {ingestionHistory.length > 0 && (
                      <span className="text-[10px] font-semibold text-emerald-300 bg-emerald-900/40 px-2 py-0.5 rounded-full">
                        {ingestionHistory.length} run
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {historyLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
                    {historyOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </div>
                </button>

                {historyOpen && (
                  <div className="p-4 space-y-2">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[11px] text-slate-400 font-medium">Hasil pipeline background (terbaru di atas)</p>
                      <Button variant="ghost" size="sm" onClick={fetchIngestionHistory}
                        disabled={historyLoading}
                        className="h-6 w-6 p-0 text-slate-400 hover:text-emerald-400">
                        <RefreshCw className={`w-3 h-3 ${historyLoading ? "animate-spin" : ""}`} />
                      </Button>
                    </div>

                    {ingestionHistory.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                        <History className="w-8 h-8 text-slate-200" />
                        <p className="text-xs text-slate-400 font-medium">Belum ada riwayat</p>
                        <p className="text-[11px] text-slate-500">Pipeline belum pernah dijalankan,<br />atau scheduler belum aktif.</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {ingestionHistory.map((run, i) => {
                          const status = run.status as string;
                          const isSuccess = status === "success";
                          const isFailed  = status === "failed";
                          const isSkipped = status === "skipped_concurrent";
                          const startedAt = run.started_at as string;
                          const dt = startedAt ? new Date(startedAt) : null;
                          const dateStr = dt ? dt.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "2-digit" }) : "—";
                          const timeStr = dt ? dt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "";
                          const inserted   = (run.inserted   as number) ?? 0;
                          const updated    = (run.updated    as number) ?? 0;
                          const chunks     = (run.chunk_count as number) ?? 0;
                          const duration   = (run.duration_sec as number) ?? 0;
                          const errMsg     = run.error_message as string | null;
                          return (
                            <div key={i} className={`rounded-xl p-3 border text-xs ${
                              isSuccess ? "bg-emerald-900/20/60 border-emerald-700/30"
                              : isFailed ? "bg-red-900/20/60 border-red-700/30"
                              : "bg-amber-900/20/60 border-amber-700/30"
                            }`}>
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5">
                                  {isSuccess ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                    : isFailed ? <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                                    : <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                                  <span className="font-semibold text-slate-200">{dateStr}</span>
                                  <span className="text-slate-400">{timeStr}</span>
                                </div>
                                <div className="flex items-center gap-2 text-[10px] shrink-0">
                                  {isSuccess && (
                                    <>
                                      <span className="text-emerald-300 font-semibold">+{inserted} baru</span>
                                      {updated > 0 && <span className="text-blue-400">{updated} update</span>}
                                      <span className="text-slate-400">{chunks} chunk</span>
                                      <span className="text-slate-500">{duration.toFixed(1)}s</span>
                                    </>
                                  )}
                                  {isFailed && (
                                    <span className="text-red-500 font-semibold truncate max-w-[120px]" title={errMsg ?? ""}>
                                      {errMsg ? errMsg.slice(0, 40) + (errMsg.length > 40 ? "…" : "") : "Error"}
                                    </span>
                                  )}
                                  {isSkipped && <span className="text-amber-400 font-semibold">Dilewati (concurrent)</span>}
                                </div>
                              </div>
                              {isSuccess && (
                                <div className="mt-1.5 flex items-center gap-2 text-[10px] text-slate-400 pl-5">
                                  <span>{(run.scraped_count as number) ?? 0} di-scrape</span>
                                  <span>·</span>
                                  <span>{(run.skipped as number) ?? 0} dilewati</span>
                                  <span>·</span>
                                  <span>{(run.rejected as number) ?? 0} ditolak</span>
                                  <span>·</span>
                                  <span className="text-indigo-400 font-mono text-[10px] truncate max-w-[100px]">{(run.url as string ?? "").replace(/^https?:\/\//, "").slice(0, 25)}</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* CSS Selector Card */}
              <div className="bg-[#0d0720] rounded-2xl border border-violet-700/40 shadow-[0_0_24px_rgba(109,40,217,0.12)] overflow-hidden animate-slide-in-right animation-delay-400">
                <button
                  className="w-full flex items-center justify-between px-4 py-3.5 border-b border-white/10 hover:bg-white/5 transition-colors"
                  onClick={() => setSettingsOpen(v => !v)}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-violet-900/40 rounded-lg flex items-center justify-center">
                      <Settings2 className="w-3.5 h-3.5 text-violet-400" />
                    </div>
                    <span className="text-sm font-bold text-slate-100">CSS Selector</span>
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
                            className="font-mono text-xs resize-none bg-indigo-900/20/40 border-indigo-100 rounded-xl focus-visible:ring-indigo-300"
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
                        variant="ghost" size="sm" className="gap-1.5 text-slate-500 hover:text-slate-200 hover:bg-white/10 h-8 rounded-full">
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

      {/* ─── Bottom Nav ─── */}
      <BottomNav active="scraper" />
    </div>
  );
};

export default Index;
