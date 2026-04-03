import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Newspaper, Zap, FileJson, FileText, Loader2, ExternalLink,
  BookOpen, CheckCircle2, Sparkles, Database, Upload, Settings2,
  ChevronDown, ChevronUp, Save, RotateCcw, Tag, AlignLeft,
  ClipboardList, Download, RefreshCw, CheckSquare, Terminal,
  AlertCircle, Circle, ArrowRight, BarChart3, Eye,
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
};

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
    return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100 text-xs font-semibold">Berhasil</Badge>;
  if (status === "partial")
    return <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100 text-xs font-semibold">Partial</Badge>;
  if (status === "duplicate")
    return <Badge className="bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-100 text-xs font-semibold">Duplikat</Badge>;
  return <Badge className="bg-red-100 text-red-600 border-red-200 hover:bg-red-100 text-xs font-semibold">Gagal</Badge>;
}

function StepBadge({ n, done }: { n: number; done?: boolean }) {
  return done ? (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500 text-white shrink-0">
      <CheckCircle2 className="w-3.5 h-3.5" />
    </span>
  ) : (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold shrink-0">{n}</span>
  );
}

/** Classify a log line and return a tailwind text color */
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

/** Prefix icon for a log line */
function logPrefix(line: string): string {
  const l = line.toLowerCase();
  if (l.includes("✅") || l.includes("berhasil") || l.includes("sukses") || l.includes("success")) return "";
  if (l.includes("❌") || l.includes("gagal") || l.includes("error") || l.includes("failed")) return "";
  if (l.includes("⚠️") || l.includes("partial")) return "";
  return "";
}

const Index = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [mode, setMode] = useState("full");
  const [progress, setProgress] = useState<ScrapeProgress>({
    running: false, phase: "idle", current: 0, total: 0,
    success: 0, partial: 0, failed: 0, duplicate: 0, logs: [],
  });
  const [articles, setArticles] = useState<Article[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(true);
  const [justFinished, setJustFinished] = useState(false);

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
    pollProgress();
    return () => stopPoll();
  }, []);

  const startScrape = async () => {
    setUrlError("");
    if (!url.trim()) { setUrlError("URL tidak boleh kosong."); return; }
    if (!url.startsWith("http")) { setUrlError("URL tidak valid, harus dimulai dengan http:// atau https://"); return; }
    setJustFinished(false);
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, mode }),
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
  const showLog = progress.phase !== "idle";

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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">

      {/* ── Top Navbar ── */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-screen-xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-indigo-600 rounded-md flex items-center justify-center shrink-0">
              <Newspaper className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-900 text-base tracking-tight">News Scraper</span>
            <span className="hidden sm:block text-slate-300 text-sm">|</span>
            <span className="hidden sm:block text-slate-400 text-xs">AINA KB Pipeline</span>
          </div>
          <div className="flex items-center gap-2">
            <a href="/export/json" download>
              <Button variant="ghost" size="sm" className="gap-1.5 text-slate-500 hover:text-slate-700 text-xs"
                data-testid="button-export-json">
                <FileJson className="w-3.5 h-3.5" />JSON
              </Button>
            </a>
            <a href="/export/csv" download>
              <Button variant="ghost" size="sm" className="gap-1.5 text-slate-500 hover:text-slate-700 text-xs"
                data-testid="button-export-csv">
                <FileText className="w-3.5 h-3.5" />CSV
              </Button>
            </a>
            <div className="w-px h-5 bg-slate-200 mx-1" />
            <Link to="/review">
              <Button data-testid="link-review-dashboard" size="sm"
                className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs">
                <CheckSquare className="w-3.5 h-3.5" />Review KB Draft
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-6 py-6 space-y-5">

        {/* ── Section: Scraping Controls ── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-4 h-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Scraping</h2>
          </div>

          {/* Settings Accordion */}
          <Card className="shadow-none border-slate-200">
            <button
              className="w-full text-left"
              onClick={() => setSettingsOpen(v => !v)}
            >
              <CardHeader className="py-3 px-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Settings2 className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-medium text-slate-600">Konfigurasi Selector</span>
                    <span className="text-xs text-slate-400 hidden sm:inline">— CSS selector untuk scraping</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!settingsOpen && (
                      <span className="text-xs text-slate-400 font-mono hidden sm:inline truncate max-w-[200px]">
                        {settings.article_link_selector}
                      </span>
                    )}
                    {settingsOpen
                      ? <ChevronUp className="w-4 h-4 text-slate-400" />
                      : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </div>
                </div>
              </CardHeader>
            </button>
            {settingsOpen && (
              <CardContent className="pt-0 px-5 pb-5 space-y-4 border-t border-slate-100">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                  {SELECTOR_FIELDS.map(({ key, label, hint }) => (
                    <div key={key} className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-600">{label}</Label>
                      <Textarea data-testid={`input-${key}`} rows={2} value={settings[key]}
                        onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
                        className="font-mono text-xs resize-none bg-slate-50 border-slate-200"
                        placeholder={DEFAULT_SETTINGS[key]} />
                      <p className="text-xs text-slate-400">{hint}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button data-testid="button-save-settings" onClick={saveSettings}
                    disabled={settingsSaving} size="sm"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5">
                    {settingsSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Simpan
                  </Button>
                  <Button data-testid="button-reset-settings" onClick={resetSettings}
                    variant="outline" size="sm" className="gap-1.5 text-slate-500 border-slate-200">
                    <RotateCcw className="w-3.5 h-3.5" />Reset Default
                  </Button>
                  {settingsError && (
                    <p className="text-xs text-red-500 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />{settingsError}
                    </p>
                  )}
                </div>
              </CardContent>
            )}
          </Card>

          {/* URL + Mode + Start */}
          <Card className="shadow-none border-slate-200">
            <CardContent className="px-5 py-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-600">URL Halaman Berita</Label>
                  <Input data-testid="input-url" type="url"
                    placeholder="https://www.kemlu.go.id/cairo/berita"
                    value={url} onChange={e => { setUrl(e.target.value); setUrlError(""); }}
                    onKeyDown={e => e.key === "Enter" && !isRunning && startScrape()}
                    disabled={isRunning}
                    className={`bg-slate-50 border-slate-200 ${urlError ? "border-red-400 focus-visible:ring-red-400" : ""}`} />
                  {urlError && (
                    <p className="text-red-500 text-xs flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />{urlError}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 sm:items-end">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-600 hidden sm:block">Mode</Label>
                    <Select value={mode} onValueChange={setMode} disabled={isRunning}>
                      <SelectTrigger data-testid="select-mode" className="w-36 bg-slate-50 border-slate-200">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MODES.map(m => (
                          <SelectItem key={m.value} value={m.value}>
                            <div>
                              <p className="font-medium text-sm">{m.label}</p>
                              <p className="text-xs text-slate-400">{m.desc}</p>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="sm:pt-[22px]">
                    <Button data-testid="button-start-scrape" onClick={startScrape}
                      disabled={isRunning}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2 px-5 whitespace-nowrap">
                      {isRunning
                        ? <><Loader2 className="w-4 h-4 animate-spin" />Scraping...</>
                        : <><Zap className="w-4 h-4" />Mulai Scraping</>}
                    </Button>
                  </div>
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                Mode aktif: <span className="font-medium text-slate-500">{MODES.find(m => m.value === mode)?.label}</span>
                {" — "}{MODES.find(m => m.value === mode)?.desc}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* ── Section: Statistics ── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Statistik</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {[
              { label: "Total",   value: statTotal, color: "text-slate-800",   bar: "bg-slate-300",   testid: "stat-total" },
              { label: "Berhasil", value: statSucc, color: "text-emerald-600", bar: "bg-emerald-400", testid: "stat-success" },
              { label: "Partial",  value: statPart, color: "text-amber-600",   bar: "bg-amber-400",   testid: "stat-partial" },
              { label: "Gagal",    value: statFail, color: "text-red-500",     bar: "bg-red-400",     testid: "stat-failed" },
              { label: "Duplikat", value: statDupe, color: "text-slate-400",   bar: "bg-slate-200",   testid: "stat-duplicate" },
            ].map(({ label, value, color, testid }) => (
              <Card key={label} className="shadow-none border-slate-200">
                <CardContent className="py-3 px-4">
                  <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">{label}</p>
                  <p data-testid={testid} className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* ── Section: Real-time Logs ── */}
        {showLog && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-indigo-500" />
                <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Log Proses</h2>
                {isRunning && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                    Live
                  </span>
                )}
                {progress.phase === "done" && (
                  <span className="text-xs text-slate-400">— selesai</span>
                )}
              </div>
              {progress.phase === "scraping" && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-indigo-600">{pct}%</span>
                  <div className="w-24">
                    <Progress value={pct} className="h-1.5" />
                  </div>
                  <span className="text-xs text-slate-400">{progress.current}/{progress.total}</span>
                </div>
              )}
            </div>

            <Card className="shadow-none border-slate-200 overflow-hidden">
              {/* Status bar */}
              <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Circle className="w-2.5 h-2.5 text-red-400 fill-red-400" />
                  <Circle className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />
                  <Circle className="w-2.5 h-2.5 text-emerald-400 fill-emerald-400" />
                  <span className="text-slate-400 text-xs ml-2 font-mono">
                    {phaseLabel[progress.phase] || progress.phase}
                  </span>
                </div>
                {isRunning && (
                  <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />
                )}
              </div>
              {/* Log lines */}
              <div ref={logRef} data-testid="log-panel"
                className="bg-slate-900 px-4 py-3 h-44 overflow-y-auto font-mono">
                {progress.logs.length === 0 ? (
                  <p className="text-slate-500 text-xs">Menunggu log...</p>
                ) : (
                  progress.logs.map((line, i) => (
                    <div key={i} className={`text-xs leading-5 ${logColor(line)}`}>
                      <span className="text-slate-600 select-none mr-2">{String(i + 1).padStart(3, "0")}</span>
                      {line}
                    </div>
                  ))
                )}
                {isRunning && (
                  <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span className="animate-pulse">memproses...</span>
                  </div>
                )}
              </div>
              {/* Summary footer when done */}
              {progress.phase === "done" && (
                <div className="px-4 py-2.5 bg-slate-800 border-t border-slate-700 flex items-center gap-4 text-xs">
                  <span className="text-emerald-400 font-medium">✅ {progress.success} berhasil</span>
                  <span className="text-amber-400">⚠️ {progress.partial} partial</span>
                  <span className="text-red-400">❌ {progress.failed} gagal</span>
                  <span className="text-slate-400">🔄 {progress.duplicate} duplikat</span>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ── Section: Results Table ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-indigo-500" />
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Hasil Scraping</h2>
              {articles.length > 0 && (
                <span className="text-xs text-slate-400">({articles.length} artikel)</span>
              )}
            </div>
            {articles.length > 0 && (
              <Button variant="ghost" size="sm" onClick={fetchArticles}
                className="gap-1.5 text-slate-400 hover:text-slate-600 text-xs">
                <RefreshCw className="w-3.5 h-3.5" />Refresh
              </Button>
            )}
          </div>

          <Card className="shadow-none border-slate-200">
            <CardContent className="p-0">
              {loadingArticles ? (
                <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">Memuat data...</span>
                </div>
              ) : articles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
                  <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center">
                    <Newspaper className="w-7 h-7 opacity-40" />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-sm font-medium text-slate-600">Belum ada artikel</p>
                    <p className="text-xs text-slate-400">Masukkan URL berita di atas lalu klik <strong>Mulai Scraping</strong></p>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-xs">
                        <th className="text-left px-5 py-3 font-semibold text-slate-500 w-10">#</th>
                        <th className="text-left px-4 py-3 font-semibold text-slate-500">Artikel</th>
                        <th className="text-left px-4 py-3 font-semibold text-slate-500 w-52">Preview Konten</th>
                        <th className="text-left px-4 py-3 font-semibold text-slate-500 w-28">Tanggal</th>
                        <th className="text-left px-4 py-3 font-semibold text-slate-500 w-20">Mode</th>
                        <th className="text-left px-4 py-3 font-semibold text-slate-500 w-24">Status</th>
                        <th className="text-left px-4 py-3 font-semibold text-slate-500 w-36">Error Reason</th>
                        <th className="text-left px-4 py-3 font-semibold text-slate-500 w-28">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {articles.map((article, i) => (
                        <tr key={article.id} data-testid={`row-article-${article.id}`}
                          className="border-b border-slate-50 hover:bg-slate-50/80 transition-colors align-top">
                          <td className="px-5 py-3.5 text-slate-400 text-xs">{i + 1}</td>
                          <td className="px-4 py-3.5 min-w-0 max-w-[220px]">
                            <button data-testid={`link-article-${article.id}`}
                              onClick={() => navigate(`/article/${article.id}`)}
                              className="text-slate-900 hover:text-indigo-600 text-left font-medium text-sm line-clamp-2 transition-colors leading-snug">
                              {article.title || "(Tanpa Judul)"}
                            </button>
                          </td>
                          <td className="px-4 py-3.5 w-52">
                            <p data-testid={`preview-${article.id}`}
                              className="text-xs text-slate-500 line-clamp-3 leading-relaxed">
                              {article.content
                                ? article.content.slice(0, 200) + (article.content.length > 200 ? "…" : "")
                                : <span className="text-slate-300 italic">Tidak ada konten</span>}
                            </p>
                          </td>
                          <td className="px-4 py-3.5 text-slate-500 text-xs whitespace-nowrap">{article.date || "—"}</td>
                          <td className="px-4 py-3.5">
                            {article.mode
                              ? <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">{article.mode}</span>
                              : <span className="text-slate-300 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3.5"><StatusBadge status={article.status} /></td>
                          <td className="px-4 py-3.5">
                            {article.error_reason ? (
                              <span data-testid={`reason-${article.id}`}
                                className="text-xs bg-orange-50 text-orange-600 border border-orange-200 px-2 py-0.5 rounded font-mono whitespace-nowrap">
                                {ERROR_REASON_LABELS[article.error_reason] ?? article.error_reason}
                              </span>
                            ) : <span className="text-slate-200 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-1.5">
                              <Button
                                data-testid={`button-detail-${article.id}`}
                                size="sm" variant="outline"
                                onClick={() => navigate(`/article/${article.id}`)}
                                className="h-7 text-xs px-2.5 border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 gap-1">
                                <Eye className="w-3 h-3" />Detail
                              </Button>
                              <a href={article.url} target="_blank" rel="noopener noreferrer"
                                data-testid={`link-source-${article.id}`}
                                className="flex items-center justify-center w-7 h-7 rounded border border-slate-200 text-slate-400 hover:text-indigo-500 hover:border-indigo-200 transition-colors">
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Section: KB Pipeline ── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Knowledge Base Pipeline</h2>
            <span className="text-xs text-slate-400">— {eligibleArticles.length} artikel eligible (success/partial)</span>
          </div>

          {articles.length === 0 ? (
            <Card className="shadow-none border-slate-200">
              <CardContent className="flex flex-col items-center justify-center py-14 gap-3 text-slate-400">
                <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center">
                  <BookOpen className="w-6 h-6 opacity-40" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium text-slate-600">Pipeline belum tersedia</p>
                  <p className="text-xs text-slate-400">Lakukan scraping terlebih dahulu untuk mengaktifkan KB Pipeline</p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-50 border border-slate-100 rounded-lg px-4 py-2 mt-1">
                  <ArrowRight className="w-3.5 h-3.5" />Scraping → Generate Summary → Auto Tag → Convert KB Draft → Review
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="shadow-none border-slate-200">
              <CardContent className="pt-5">
                <Tabs defaultValue="kb-draft">
                  <TabsList className="mb-5 bg-slate-100 border border-slate-200">
                    <TabsTrigger value="kb-draft" className="gap-1.5 text-xs">
                      <ClipboardList className="w-3.5 h-3.5" />KB Draft
                    </TabsTrigger>
                    <TabsTrigger value="ai" className="gap-1.5 text-xs">
                      <Sparkles className="w-3.5 h-3.5" />AI Summary
                    </TabsTrigger>
                    <TabsTrigger value="supabase" className="gap-1.5 text-xs">
                      <Database className="w-3.5 h-3.5" />Supabase
                    </TabsTrigger>
                  </TabsList>

                  {/* ── KB Draft Tab ── */}
                  <TabsContent value="kb-draft" className="space-y-4 mt-0">
                    {/* Steps */}
                    <div className="space-y-3">
                      {/* Step 1 */}
                      <div className={`border rounded-xl p-4 space-y-3 transition-colors ${summaryDone ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-white"}`}>
                        <div className="flex items-center gap-2.5">
                          <StepBadge n={1} done={summaryDone} />
                          <div>
                            <h3 className="font-semibold text-sm text-slate-800 flex items-center gap-1.5">
                              <AlignLeft className="w-3.5 h-3.5 text-slate-400" />Generate Summary
                            </h3>
                            <p className="text-xs text-slate-500 mt-0.5">
                              Buat ringkasan 2–4 kalimat secara otomatis. Hanya mengisi artikel yang belum punya summary.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 pl-8">
                          <Button data-testid="button-generate-summary" onClick={doGenerateSummary}
                            disabled={summaryLoading || isRunning} size="sm"
                            className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5">
                            {summaryLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : summaryDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlignLeft className="w-3.5 h-3.5" />}
                            {summaryLoading ? "Generating..." : summaryDone ? "Done" : "Generate Summary"}
                          </Button>
                          {summaryDone && summaryResult && (
                            <span className="text-xs text-emerald-600 font-medium">
                              {summaryResult.updated} dari {summaryResult.total} artikel diberi summary
                            </span>
                          )}
                          {summaryError && <p className="text-xs text-red-500">{summaryError}</p>}
                        </div>
                      </div>

                      {/* Step 2 */}
                      <div className={`border rounded-xl p-4 space-y-3 transition-colors ${tagDone ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-white"}`}>
                        <div className="flex items-center gap-2.5">
                          <StepBadge n={2} done={tagDone} />
                          <div>
                            <h3 className="font-semibold text-sm text-slate-800 flex items-center gap-1.5">
                              <Tag className="w-3.5 h-3.5 text-slate-400" />Auto Tagging
                            </h3>
                            <p className="text-xs text-slate-500 mt-0.5">
                              Generate tags otomatis dari keyword di judul dan konten.
                              Tag terdeteksi: paspor, visa, iqomah, kbri, palestina, beasiswa, dll.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 pl-8">
                          <Button data-testid="button-auto-tag" onClick={doAutoTag}
                            disabled={tagLoading || isRunning} size="sm"
                            className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5">
                            {tagLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : tagDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Tag className="w-3.5 h-3.5" />}
                            {tagLoading ? "Tagging..." : tagDone ? "Tagged" : "Auto Tag"}
                          </Button>
                          {tagDone && <span className="text-xs text-emerald-600 font-medium">Semua artikel berhasil di-tag.</span>}
                          {tagError && <p className="text-xs text-red-500">{tagError}</p>}
                        </div>
                      </div>

                      {/* Step 3 */}
                      <div className={`border rounded-xl p-4 space-y-3 transition-colors ${kbDone ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-white"}`}>
                        <div className="flex items-center gap-2.5">
                          <StepBadge n={3} done={kbDone} />
                          <div>
                            <h3 className="font-semibold text-sm text-slate-800 flex items-center gap-1.5">
                              <ClipboardList className="w-3.5 h-3.5 text-slate-400" />Convert to KB Draft
                            </h3>
                            <p className="text-xs text-slate-500 mt-0.5">
                              Konversi artikel success/partial ke format KB draft AINA.
                              Status awal: <span className="font-mono bg-yellow-50 text-yellow-600 px-1 rounded text-xs">pending</span>.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center flex-wrap gap-2 pl-8">
                          <Button data-testid="button-convert-kb" onClick={doConvertKb}
                            disabled={kbLoading || isRunning || eligibleArticles.length === 0}
                            size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5">
                            {kbLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : kbDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : <ClipboardList className="w-3.5 h-3.5" />}
                            {kbLoading ? "Mengkonversi..." : kbDone ? `${kbDraft.length} artikel di-draft` : "Convert to KB Draft"}
                          </Button>
                          {kbDone && (
                            <>
                              <a href="/export/kb" download>
                                <Button data-testid="button-download-kb" variant="outline" size="sm"
                                  className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                                  <Download className="w-3.5 h-3.5" />kb_articles.json
                                </Button>
                              </a>
                              <Link to="/review">
                                <Button variant="outline" size="sm"
                                  className="gap-1.5 border-indigo-300 text-indigo-700 hover:bg-indigo-50">
                                  <CheckSquare className="w-3.5 h-3.5" />Review Draft
                                </Button>
                              </Link>
                            </>
                          )}
                          <Button variant="ghost" size="sm" onClick={fetchKbDraft} disabled={kbDraftLoading}
                            className="gap-1 text-slate-400 hover:text-slate-600">
                            <RefreshCw className={`w-3 h-3 ${kbDraftLoading ? "animate-spin" : ""}`} />
                          </Button>
                        </div>
                        {kbError && <p data-testid="text-kb-error" className="text-red-500 text-xs pl-8">{kbError}</p>}
                        {eligibleArticles.length === 0 && (
                          <p className="text-xs text-slate-400 pl-8">Tidak ada artikel success/partial untuk dikonversi.</p>
                        )}
                      </div>
                    </div>

                    {/* KB Draft Preview */}
                    {kbDraft.length > 0 && (
                      <div className="space-y-2 pt-2">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                            <ClipboardList className="w-3.5 h-3.5 text-indigo-400" />
                            Preview KB Draft ({kbDraft.length} artikel)
                          </h3>
                        </div>
                        <div className="rounded-xl border border-slate-200 overflow-hidden">
                          <div className="overflow-x-auto max-h-80 overflow-y-auto">
                            <table className="w-full text-xs">
                              <thead className="sticky top-0 z-10">
                                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                                  <th className="text-left px-4 py-2.5 font-semibold w-8">#</th>
                                  <th className="text-left px-4 py-2.5 font-semibold">Title</th>
                                  <th className="text-left px-4 py-2.5 font-semibold w-40">Slug</th>
                                  <th className="text-left px-4 py-2.5 font-semibold w-52">Summary</th>
                                  <th className="text-left px-4 py-2.5 font-semibold w-36">Tags</th>
                                  <th className="text-left px-4 py-2.5 font-semibold w-24">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {kbDraft.map((kb, i) => (
                                  <tr key={kb.id || i} data-testid={`row-kb-${kb.id || i}`}
                                    className="border-b border-slate-50 hover:bg-slate-50/80 transition-colors align-top">
                                    <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                                    <td className="px-4 py-3">
                                      <p className="font-medium text-slate-900 line-clamp-2 leading-snug">{kb.title || "(Tanpa Judul)"}</p>
                                      {kb.published_date && <p className="text-slate-400 mt-0.5 text-xs">{kb.published_date}</p>}
                                    </td>
                                    <td className="px-4 py-3">
                                      <span data-testid={`slug-${i}`}
                                        className="font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded break-all text-xs">
                                        {kb.slug}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3">
                                      <p data-testid={`summary-${i}`} className="text-slate-600 line-clamp-3 leading-relaxed">
                                        {kb.summary || <span className="text-slate-300 italic">Tidak ada summary</span>}
                                      </p>
                                    </td>
                                    <td className="px-4 py-3">
                                      <div data-testid={`tags-${i}`} className="flex flex-wrap gap-1">
                                        {(kb.tags || []).map(t => (
                                          <span key={t} className="bg-indigo-50 text-indigo-600 px-1.5 py-px rounded font-medium text-xs">{t}</span>
                                        ))}
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <span data-testid={`approval-${i}`}
                                        className={`inline-block px-2 py-0.5 rounded text-xs font-semibold capitalize ${APPROVAL_COLORS[kb.approval_status] || "bg-slate-100 text-slate-500"}`}>
                                        {kb.approval_status}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}
                  </TabsContent>

                  {/* ── AI Summary Tab ── */}
                  <TabsContent value="ai" className="mt-0">
                    <div className="border border-slate-200 rounded-xl p-5 space-y-4 bg-white">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
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
                          Jalankan "Convert to KB Draft" di tab KB Draft terlebih dahulu.
                        </div>
                      ) : (
                        <Button data-testid="button-ai-summary-all" onClick={generateAiSummaries}
                          disabled={aiLoading}
                          className="bg-violet-600 hover:bg-violet-700 text-white gap-2">
                          {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : aiDone ? <CheckCircle2 className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                          {aiLoading ? "Generating AI Summary..." : aiDone ? "AI Summary Selesai!" : "Generate AI Summary"}
                        </Button>
                      )}
                      {aiError && (
                        <p data-testid="text-ai-error" className="text-red-500 text-sm flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5" />{aiError}
                        </p>
                      )}
                      {aiDone && (
                        <p data-testid="text-ai-success" className="text-emerald-600 text-sm flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          AI summary berhasil di-generate dan disimpan.
                        </p>
                      )}
                    </div>
                  </TabsContent>

                  {/* ── Supabase Tab ── */}
                  <TabsContent value="supabase" className="mt-0">
                    <div className="border border-slate-200 rounded-xl p-5 space-y-4 bg-white">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                          <Database className="w-4 h-4 text-emerald-600" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-sm text-slate-800">Push ke Supabase</h3>
                          <p className="text-xs text-slate-500">
                            Push semua KB articles ke tabel{" "}
                            <span className="font-mono bg-slate-100 px-1 py-0.5 rounded">kb_articles</span>.
                            Pastikan sudah menjalankan{" "}
                            <span className="font-mono bg-slate-100 px-1 py-0.5 rounded">supabase_setup.sql</span>.
                          </p>
                        </div>
                      </div>
                      {kbDraft.length === 0 ? (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-2 text-xs text-amber-700">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          Jalankan "Convert to KB Draft" terlebih dahulu.
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-3">
                          <Button data-testid="button-push-supabase" onClick={pushToSupabase}
                            disabled={pushLoading}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
                            {pushLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : pushDone ? <CheckCircle2 className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                            {pushLoading ? "Pushing..." : pushDone ? `${pushCount} artikel di-push!` : "Push to Supabase"}
                          </Button>
                          <Button data-testid="button-fetch-db" onClick={fetchDbArticles}
                            disabled={dbLoading} variant="outline" className="gap-2 border-slate-200">
                            {dbLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                            {dbLoading ? "Mengambil..." : "Lihat Data di DB"}
                          </Button>
                        </div>
                      )}
                      {pushError && (
                        <p data-testid="text-push-error" className="text-red-500 text-sm flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5" />{pushError}
                        </p>
                      )}
                      {dbError && (
                        <p data-testid="text-db-error" className="text-red-500 text-sm flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5" />{dbError}
                        </p>
                      )}
                      {dbArticles.length > 0 && (
                        <div className="rounded-lg border border-slate-200 overflow-hidden">
                          <div className="bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500 border-b">
                            {dbArticles.length} artikel di Supabase
                          </div>
                          <div className="overflow-x-auto max-h-64 overflow-y-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b bg-white text-slate-500">
                                  <th className="text-left px-4 py-2 font-semibold">Judul</th>
                                  <th className="text-left px-4 py-2 font-semibold w-28">Tanggal</th>
                                  <th className="text-left px-4 py-2 font-semibold w-40">Tags</th>
                                </tr>
                              </thead>
                              <tbody>
                                {dbArticles.map((a, i) => (
                                  <tr key={i} className="border-b hover:bg-slate-50 transition-colors">
                                    <td className="px-4 py-2 text-slate-900 font-medium">{a.title || "(Tanpa Judul)"}</td>
                                    <td className="px-4 py-2 text-slate-500">{a.published_date || "—"}</td>
                                    <td className="px-4 py-2">
                                      <div className="flex flex-wrap gap-1">
                                        {(a.tags || []).map((t: string) => (
                                          <span key={t} className="bg-indigo-50 text-indigo-600 px-1.5 py-px rounded text-xs">{t}</span>
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
              </CardContent>
            </Card>
          )}
        </div>

      </main>
    </div>
  );
};

export default Index;
