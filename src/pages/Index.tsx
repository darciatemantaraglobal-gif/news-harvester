import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Newspaper, Zap, FileJson, FileText, Loader2, ExternalLink,
  BookOpen, CheckCircle2, Sparkles, Database, Upload, Settings2,
  ChevronDown, ChevronUp, Save, RotateCcw, Tag, AlignLeft,
  ClipboardList, Download, RefreshCw,
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
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
};

const statusBadge = (status: Article["status"]) => {
  if (status === "success")
    return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">SUCCESS</Badge>;
  if (status === "partial")
    return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">PARTIAL</Badge>;
  if (status === "duplicate")
    return <Badge className="bg-slate-100 text-slate-500 hover:bg-slate-100">DUPLIKAT</Badge>;
  return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">FAILED</Badge>;
};

const SELECTOR_FIELDS: { key: keyof ScraperSettings; label: string; hint: string }[] = [
  { key: "article_link_selector", label: "Article Link Selector", hint: "Selector untuk link artikel di halaman list." },
  { key: "next_page_selector", label: "Next Page Selector", hint: "Selector untuk tombol halaman berikutnya (pagination)." },
  { key: "title_selector", label: "Title Selector", hint: "Selector untuk judul artikel." },
  { key: "date_selector", label: "Date Selector", hint: "Selector untuk tanggal artikel." },
  { key: "content_selector", label: "Content Selector", hint: "Selector untuk konten/isi artikel." },
];

const StepBadge = ({ n }: { n: number }) => (
  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-600 text-white text-xs font-bold shrink-0">{n}</span>
);

const Index = () => {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [mode, setMode] = useState("full");
  const [progress, setProgress] = useState<ScrapeProgress>({
    running: false, phase: "idle", current: 0, total: 0,
    success: 0, partial: 0, failed: 0, duplicate: 0, logs: [],
  });
  const [articles, setArticles] = useState<Article[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(true);

  // Settings
  const [settings, setSettings] = useState<ScraperSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsError, setSettingsError] = useState("");

  // Generate Summary (rule-based)
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryDone, setSummaryDone] = useState(false);
  const [summaryResult, setSummaryResult] = useState<{ updated: number; total: number } | null>(null);
  const [summaryError, setSummaryError] = useState("");

  // Auto Tag
  const [tagLoading, setTagLoading] = useState(false);
  const [tagDone, setTagDone] = useState(false);
  const [tagError, setTagError] = useState("");

  // Convert to KB Draft
  const [kbLoading, setKbLoading] = useState(false);
  const [kbDone, setKbDone] = useState(false);
  const [kbCount, setKbCount] = useState(0);
  const [kbError, setKbError] = useState("");

  // KB Draft preview
  const [kbDraft, setKbDraft] = useState<KbDraft[]>([]);
  const [kbDraftLoading, setKbDraftLoading] = useState(false);

  // AI Summary (GPT)
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDone, setAiDone] = useState(false);
  const [aiError, setAiError] = useState("");

  // Supabase
  const [pushLoading, setPushLoading] = useState(false);
  const [pushDone, setPushDone] = useState(false);
  const [pushCount, setPushCount] = useState(0);
  const [pushError, setPushError] = useState("");
  const [dbArticles, setDbArticles] = useState<any[]>([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbError, setDbError] = useState("");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const fetchArticles = async () => {
    try {
      const res = await fetch("/api/articles");
      if (res.ok) setArticles(await res.json());
    } catch {}
    setLoadingArticles(false);
  };

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

  const pollProgress = async () => {
    try {
      const res = await fetch("/api/progress");
      if (!res.ok) return;
      const data: ScrapeProgress = await res.json();
      setProgress(data);
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
      if (!data.running && data.phase === "done") {
        stopPoll();
        fetchArticles();
      }
    } catch {}
  };

  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

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
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, mode }),
      });
      const data = await res.json();
      if (!res.ok) { setUrlError(data.error || "Terjadi kesalahan."); return; }
      pollRef.current = setInterval(pollProgress, 1000);
    } catch {
      setUrlError("Tidak bisa menghubungi server. Pastikan backend berjalan.");
    }
  };

  const saveSettings = async () => {
    setSettingsSaving(true); setSettingsError(""); setSettingsSaved(false);
    try {
      const res = await fetch("/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) setSettingsError(data.error || "Gagal menyimpan settings.");
      else { setSettings(data.settings); setSettingsSaved(true); setTimeout(() => setSettingsSaved(false), 3000); }
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
    } catch {}
  };

  const doGenerateSummary = async () => {
    setSummaryLoading(true); setSummaryError(""); setSummaryDone(false); setSummaryResult(null);
    try {
      const res = await fetch("/api/generate-summary", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setSummaryError(data.error || "Gagal generate summary.");
      else { setSummaryDone(true); setSummaryResult(data); fetchArticles(); }
    } catch { setSummaryError("Tidak bisa menghubungi server."); }
    finally { setSummaryLoading(false); }
  };

  const doAutoTag = async () => {
    setTagLoading(true); setTagError(""); setTagDone(false);
    try {
      const res = await fetch("/api/auto-tag", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setTagError(data.error || "Gagal auto tag.");
      else { setTagDone(true); fetchArticles(); }
    } catch { setTagError("Tidak bisa menghubungi server."); }
    finally { setTagLoading(false); }
  };

  const doConvertKb = async () => {
    setKbLoading(true); setKbError(""); setKbDone(false);
    try {
      const res = await fetch("/api/convert-kb", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setKbError(data.error || "Gagal mengkonversi.");
      else { setKbDone(true); setKbCount(data.count); await fetchKbDraft(); }
    } catch { setKbError("Tidak bisa menghubungi server."); }
    finally { setKbLoading(false); }
  };

  const generateAiSummaries = async () => {
    setAiLoading(true); setAiError(""); setAiDone(false);
    try {
      const res = await fetch("/api/ai-summary-all", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setAiError(data.error || "Gagal generate AI summary.");
      else { setAiDone(true); await fetchKbDraft(); }
    } catch { setAiError("Tidak bisa menghubungi server."); }
    finally { setAiLoading(false); }
  };

  const pushToSupabase = async () => {
    setPushLoading(true); setPushError(""); setPushDone(false);
    try {
      const res = await fetch("/api/push-supabase", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setPushError(data.error || "Gagal push ke Supabase.");
      else { setPushDone(true); setPushCount(data.inserted || 0); }
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
  const showProgress = progress.phase !== "idle";
  const phaseLabel: Record<string, string> = {
    idle: "Siap", listing: "Mengumpulkan daftar artikel...",
    scraping: `Scraping artikel ${progress.current} / ${progress.total}`, done: "Selesai!",
  };

  const eligibleArticles = articles.filter(a => a.status === "success" || a.status === "partial");

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Newspaper className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">News Scraper</h1>
            <p className="text-xs text-slate-500">Internal scraping tool — AINA KB Pipeline</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {/* Scraper Settings Card */}
        <Card>
          <CardHeader className="pb-2 cursor-pointer select-none" onClick={() => setSettingsOpen(v => !v)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-slate-500" />
                <CardTitle className="text-sm font-semibold text-slate-700">Scraper Settings</CardTitle>
                <span className="text-xs text-slate-400">— konfigurasi selector HTML</span>
              </div>
              {settingsOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>
          </CardHeader>
          {settingsOpen && (
            <CardContent className="pt-0 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {SELECTOR_FIELDS.map(({ key, label, hint }) => (
                  <div key={key} className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-600">{label}</Label>
                    <Textarea data-testid={`input-${key}`} rows={2} value={settings[key]}
                      onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
                      className="font-mono text-xs resize-none" placeholder={DEFAULT_SETTINGS[key]} />
                    <p className="text-xs text-slate-400">{hint}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3 pt-1">
                <Button data-testid="button-save-settings" onClick={saveSettings} disabled={settingsSaving} size="sm"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5">
                  {settingsSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : settingsSaved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                  {settingsSaved ? "Tersimpan!" : "Simpan Settings"}
                </Button>
                <Button data-testid="button-reset-settings" onClick={resetSettings} variant="outline" size="sm" className="gap-1.5 text-slate-600">
                  <RotateCcw className="w-3.5 h-3.5" />Reset ke Default
                </Button>
                {settingsError && <p className="text-xs text-red-500">{settingsError}</p>}
              </div>
            </CardContent>
          )}
        </Card>

        {/* URL + Mode + Start */}
        <Card>
          <CardContent className="pt-5">
            <div className="space-y-3">
              <Label className="block text-sm font-semibold text-slate-700">URL Halaman Berita</Label>
              <div className="flex gap-3">
                <div className="flex-1">
                  <Input data-testid="input-url" type="url" placeholder="https://www.kemlu.go.id/cairo/berita"
                    value={url} onChange={e => setUrl(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !isRunning && startScrape()}
                    disabled={isRunning}
                    className={urlError ? "border-red-400 focus-visible:ring-red-400" : ""} />
                  {urlError && <p className="text-red-500 text-xs mt-1">{urlError}</p>}
                </div>
                <Select value={mode} onValueChange={setMode} disabled={isRunning}>
                  <SelectTrigger data-testid="select-mode" className="w-44">
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
                <Button data-testid="button-start-scrape" onClick={startScrape} disabled={isRunning}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white whitespace-nowrap">
                  {isRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
                  {isRunning ? "Sedang Scraping..." : "Start Scraping"}
                </Button>
              </div>
              <p className="text-xs text-slate-400">
                Mode: <span className="font-medium text-slate-600">{MODES.find(m => m.value === mode)?.label}</span>
                {" — "}{MODES.find(m => m.value === mode)?.desc}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Progress */}
        {showProgress && (
          <Card>
            <CardContent className="pt-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">{phaseLabel[progress.phase] || progress.phase}</span>
                {progress.phase === "scraping" && <span className="text-sm text-slate-500">{pct}%</span>}
              </div>
              {progress.phase === "scraping" && <Progress value={pct} className="h-2.5" />}
              {progress.logs.length > 0 && (
                <div ref={logRef} data-testid="log-panel" className="bg-slate-900 rounded-lg p-3 max-h-48 overflow-y-auto">
                  {progress.logs.map((log, i) => (
                    <p key={i} className="text-xs text-slate-300 font-mono leading-relaxed">{log}</p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: "Total Ditemukan", value: progress.total || articles.length, color: "text-slate-900", testid: "stat-total" },
            { label: "Berhasil", value: progress.phase !== "idle" ? progress.success : articles.filter(a => a.status === "success").length, color: "text-emerald-600", testid: "stat-success" },
            { label: "Partial", value: progress.phase !== "idle" ? progress.partial : articles.filter(a => a.status === "partial").length, color: "text-yellow-500", testid: "stat-partial" },
            { label: "Gagal", value: progress.phase !== "idle" ? progress.failed : articles.filter(a => a.status === "failed").length, color: "text-red-500", testid: "stat-failed" },
            { label: "Duplikat", value: progress.phase !== "idle" ? progress.duplicate : 0, color: "text-slate-400", testid: "stat-duplicate" },
          ].map(({ label, value, color, testid }) => (
            <Card key={label}>
              <CardContent className="pt-4">
                <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
                <p data-testid={testid} className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Articles Table */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Artikel Terscrape
                {articles.length > 0 && <span className="ml-2 text-sm font-normal text-slate-500">({articles.length})</span>}
              </CardTitle>
              {articles.length > 0 && (
                <div className="flex gap-2">
                  <a href="/export/json" download>
                    <Button data-testid="button-export-json" variant="outline" size="sm" className="gap-1.5">
                      <FileJson className="w-4 h-4" />JSON
                    </Button>
                  </a>
                  <a href="/export/csv" download>
                    <Button data-testid="button-export-csv" variant="outline" size="sm" className="gap-1.5">
                      <FileText className="w-4 h-4" />CSV
                    </Button>
                  </a>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loadingArticles ? (
              <div className="flex items-center justify-center py-16 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />Memuat artikel...
              </div>
            ) : articles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
                <Newspaper className="w-10 h-10 opacity-30" />
                <p className="text-sm">Belum ada artikel. Mulai scraping di atas.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="text-left px-6 py-3 font-medium text-slate-500 w-12">#</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-500">Judul</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-500 w-28">Tanggal</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-500 w-20">Mode</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-500 w-24">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-500 w-40">Error Reason</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-500 w-12">URL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {articles.map((article, i) => (
                      <tr key={article.id} data-testid={`row-article-${article.id}`} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-3 text-slate-400">{i + 1}</td>
                        <td className="px-4 py-3">
                          <button data-testid={`link-article-${article.id}`}
                            onClick={() => navigate(`/article/${article.id}`)}
                            className="text-slate-900 hover:text-indigo-600 text-left font-medium line-clamp-2 transition-colors">
                            {article.title || "(Tanpa Judul)"}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{article.date || "-"}</td>
                        <td className="px-4 py-3">
                          {article.mode
                            ? <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">{article.mode}</span>
                            : "-"}
                        </td>
                        <td className="px-4 py-3">{statusBadge(article.status)}</td>
                        <td className="px-4 py-3">
                          {article.error_reason ? (
                            <span data-testid={`reason-${article.id}`}
                              className="text-xs bg-orange-50 text-orange-600 border border-orange-200 px-2 py-0.5 rounded font-mono whitespace-nowrap">
                              {ERROR_REASON_LABELS[article.error_reason] ?? article.error_reason}
                            </span>
                          ) : <span className="text-slate-300 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <a href={article.url} target="_blank" rel="noopener noreferrer"
                            data-testid={`link-source-${article.id}`}
                            className="text-indigo-500 hover:text-indigo-700 transition-colors">
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* KB Pipeline */}
        {articles.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-indigo-600" />
                Knowledge Base Pipeline — AINA
              </CardTitle>
              <p className="text-xs text-slate-400 mt-1">
                Pipeline membuat KB draft dari {eligibleArticles.length} artikel (success/partial)
              </p>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="kb-draft">
                <TabsList className="mb-5">
                  <TabsTrigger value="kb-draft">
                    <ClipboardList className="w-4 h-4 mr-1.5" />KB Draft
                  </TabsTrigger>
                  <TabsTrigger value="ai">
                    <Sparkles className="w-4 h-4 mr-1.5" />AI Summary
                  </TabsTrigger>
                  <TabsTrigger value="supabase">
                    <Database className="w-4 h-4 mr-1.5" />Supabase
                  </TabsTrigger>
                </TabsList>

                {/* ── KB Draft Tab ── */}
                <TabsContent value="kb-draft" className="space-y-5 mt-0">

                  {/* Step 1 — Generate Summary */}
                  <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <StepBadge n={1} />
                      <h3 className="font-semibold text-sm text-slate-800 flex items-center gap-1.5">
                        <AlignLeft className="w-4 h-4 text-slate-500" />Generate Summary
                      </h3>
                      {summaryDone && <CheckCircle2 className="w-4 h-4 text-emerald-500 ml-auto" />}
                    </div>
                    <p className="text-xs text-slate-500">
                      Buat ringkasan singkat 2–4 kalimat dari konten artikel secara otomatis.
                      Hanya mengisi artikel yang belum punya summary.
                    </p>
                    <div className="flex items-center gap-3">
                      <Button data-testid="button-generate-summary" onClick={doGenerateSummary}
                        disabled={summaryLoading || isRunning}
                        size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5">
                        {summaryLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : summaryDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlignLeft className="w-3.5 h-3.5" />}
                        {summaryLoading ? "Generating..." : summaryDone ? "Done!" : "Generate Summary"}
                      </Button>
                      {summaryDone && summaryResult && (
                        <p className="text-xs text-emerald-600">
                          {summaryResult.updated} artikel diberi summary (dari {summaryResult.total} total)
                        </p>
                      )}
                      {summaryError && <p className="text-xs text-red-500">{summaryError}</p>}
                    </div>
                  </div>

                  {/* Step 2 — Auto Tag */}
                  <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <StepBadge n={2} />
                      <h3 className="font-semibold text-sm text-slate-800 flex items-center gap-1.5">
                        <Tag className="w-4 h-4 text-slate-500" />Auto Tagging
                      </h3>
                      {tagDone && <CheckCircle2 className="w-4 h-4 text-emerald-500 ml-auto" />}
                    </div>
                    <p className="text-xs text-slate-500">
                      Generate tags otomatis berdasarkan keyword di judul dan konten. Tag default:{" "}
                      <span className="font-mono bg-slate-100 px-1 rounded">berita, kemlu, kairo, mesir</span>.
                      Tag tambahan terdeteksi otomatis: paspor, visa, iqomah, kbri, palestina, beasiswa, dll.
                    </p>
                    <div className="flex items-center gap-3">
                      <Button data-testid="button-auto-tag" onClick={doAutoTag}
                        disabled={tagLoading || isRunning}
                        size="sm" className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5">
                        {tagLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : tagDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Tag className="w-3.5 h-3.5" />}
                        {tagLoading ? "Tagging..." : tagDone ? "Tagged!" : "Auto Tag"}
                      </Button>
                      {tagDone && <p className="text-xs text-emerald-600">Semua artikel berhasil di-tag.</p>}
                      {tagError && <p className="text-xs text-red-500">{tagError}</p>}
                    </div>
                  </div>

                  {/* Step 3 — Convert to KB Draft */}
                  <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <StepBadge n={3} />
                      <h3 className="font-semibold text-sm text-slate-800 flex items-center gap-1.5">
                        <ClipboardList className="w-4 h-4 text-slate-500" />Convert to KB Draft
                      </h3>
                      {kbDone && <CheckCircle2 className="w-4 h-4 text-emerald-500 ml-auto" />}
                    </div>
                    <p className="text-xs text-slate-500">
                      Konversi artikel ke format KB draft AINA. Menghasilkan:{" "}
                      <span className="font-mono bg-slate-100 px-1 rounded text-xs">title, slug, source_url, published_date, content, summary, tags, scrape_status, approval_status</span>.
                      Hanya artikel success/partial yang dikonversi. Approval status default:{" "}
                      <span className="font-mono bg-yellow-50 text-yellow-600 px-1 rounded text-xs">pending</span>.
                    </p>
                    <div className="flex items-center gap-3 flex-wrap">
                      <Button data-testid="button-convert-kb" onClick={doConvertKb}
                        disabled={kbLoading || isRunning || eligibleArticles.length === 0}
                        size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5">
                        {kbLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : kbDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : <ClipboardList className="w-3.5 h-3.5" />}
                        {kbLoading ? "Mengkonversi..." : kbDone ? `${kbDraft.length} artikel di-draft!` : "Convert to KB Draft"}
                      </Button>
                      {kbDone && (
                        <a href="/export/kb" download>
                          <Button data-testid="button-download-kb" variant="outline" size="sm"
                            className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                            <Download className="w-3.5 h-3.5" />Download kb_articles.json
                          </Button>
                        </a>
                      )}
                      <Button variant="ghost" size="sm" onClick={fetchKbDraft} disabled={kbDraftLoading}
                        className="gap-1.5 text-slate-400 hover:text-slate-600">
                        <RefreshCw className={`w-3.5 h-3.5 ${kbDraftLoading ? "animate-spin" : ""}`} />
                      </Button>
                    </div>
                    {kbError && <p data-testid="text-kb-error" className="text-red-500 text-xs">{kbError}</p>}
                    {eligibleArticles.length === 0 && (
                      <p className="text-xs text-slate-400">Tidak ada artikel success/partial untuk dikonversi.</p>
                    )}
                  </div>

                  {/* KB Draft Preview */}
                  {kbDraft.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                          <ClipboardList className="w-4 h-4 text-indigo-500" />
                          Preview KB Draft
                          <span className="text-xs font-normal text-slate-400">({kbDraft.length} artikel)</span>
                        </h3>
                      </div>
                      <div className="rounded-xl border border-slate-200 overflow-hidden">
                        <div className="overflow-x-auto max-h-96 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0">
                              <tr className="bg-slate-50 border-b border-slate-200">
                                <th className="text-left px-4 py-2.5 font-semibold text-slate-500 w-8">#</th>
                                <th className="text-left px-4 py-2.5 font-semibold text-slate-500">Title</th>
                                <th className="text-left px-4 py-2.5 font-semibold text-slate-500 w-40">Slug</th>
                                <th className="text-left px-4 py-2.5 font-semibold text-slate-500 w-52">Summary</th>
                                <th className="text-left px-4 py-2.5 font-semibold text-slate-500 w-40">Tags</th>
                                <th className="text-left px-4 py-2.5 font-semibold text-slate-500 w-24">Approval</th>
                              </tr>
                            </thead>
                            <tbody>
                              {kbDraft.map((kb, i) => (
                                <tr key={kb.id || i} data-testid={`row-kb-${kb.id || i}`}
                                  className="border-b border-slate-50 hover:bg-slate-50 transition-colors align-top">
                                  <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                                  <td className="px-4 py-3">
                                    <p className="font-medium text-slate-900 line-clamp-2">{kb.title || "(Tanpa Judul)"}</p>
                                    {kb.published_date && <p className="text-slate-400 mt-0.5">{kb.published_date}</p>}
                                  </td>
                                  <td className="px-4 py-3">
                                    <span data-testid={`slug-${i}`}
                                      className="font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded break-all">
                                      {kb.slug}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3">
                                    <p data-testid={`summary-${i}`} className="text-slate-600 line-clamp-3">
                                      {kb.summary || <span className="text-slate-300 italic">Tidak ada summary</span>}
                                    </p>
                                  </td>
                                  <td className="px-4 py-3">
                                    <div data-testid={`tags-${i}`} className="flex flex-wrap gap-1">
                                      {(kb.tags || []).map((t) => (
                                        <span key={t}
                                          className="inline-block bg-indigo-100 text-indigo-600 text-xs px-1.5 py-0.5 rounded font-medium">
                                          {t}
                                        </span>
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
                <TabsContent value="ai" className="space-y-3 mt-0">
                  <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                    <h3 className="font-semibold text-sm text-slate-800 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-violet-500" />
                      AI Summary (GPT-4o-mini)
                    </h3>
                    <p className="text-xs text-slate-500">
                      Upgrade summary dengan GPT-4o-mini untuk semua artikel di KB Draft.
                      Pastikan sudah menjalankan <strong>Convert to KB Draft</strong> terlebih dahulu.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <Button data-testid="button-ai-summary-all" onClick={generateAiSummaries}
                        disabled={aiLoading || kbDraft.length === 0}
                        className="bg-violet-600 hover:bg-violet-700 text-white gap-2">
                        {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : aiDone ? <CheckCircle2 className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                        {aiLoading ? "Generating AI Summary..." : aiDone ? "AI Summary Selesai!" : "Generate AI Summary"}
                      </Button>
                    </div>
                    {kbDraft.length === 0 && (
                      <p className="text-xs text-slate-400">Jalankan "Convert to KB Draft" di tab KB Draft terlebih dahulu.</p>
                    )}
                    {aiError && <p data-testid="text-ai-error" className="text-red-500 text-sm">{aiError}</p>}
                    {aiDone && (
                      <p data-testid="text-ai-success" className="text-emerald-600 text-sm">
                        AI summary berhasil di-generate dan disimpan ke{" "}
                        <span className="font-mono text-xs">data/kb_articles.json</span>
                      </p>
                    )}
                  </div>
                </TabsContent>

                {/* ── Supabase Tab ── */}
                <TabsContent value="supabase" className="space-y-3 mt-0">
                  <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                    <h3 className="font-semibold text-sm text-slate-800 flex items-center gap-2">
                      <Database className="w-4 h-4 text-emerald-600" />Push ke Supabase
                    </h3>
                    <p className="text-xs text-slate-500">
                      Push semua KB articles ke tabel{" "}
                      <span className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">kb_articles</span> di Supabase.
                      Pastikan sudah menjalankan SQL dari{" "}
                      <span className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">supabase_setup.sql</span>.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <Button data-testid="button-push-supabase" onClick={pushToSupabase}
                        disabled={pushLoading || kbDraft.length === 0}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
                        {pushLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : pushDone ? <CheckCircle2 className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                        {pushLoading ? "Pushing..." : pushDone ? `${pushCount} artikel di-push!` : "Push to Supabase"}
                      </Button>
                      <Button data-testid="button-fetch-db" onClick={fetchDbArticles} disabled={dbLoading} variant="outline" className="gap-2">
                        {dbLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                        {dbLoading ? "Mengambil..." : "Lihat Data di DB"}
                      </Button>
                    </div>
                    {kbDraft.length === 0 && (
                      <p className="text-xs text-slate-400">Jalankan "Convert to KB Draft" terlebih dahulu.</p>
                    )}
                    {pushError && <p data-testid="text-push-error" className="text-red-500 text-sm">{pushError}</p>}
                    {pushDone && <p data-testid="text-push-success" className="text-emerald-600 text-sm">Berhasil push {pushCount} artikel ke Supabase!</p>}
                    {dbError && <p data-testid="text-db-error" className="text-red-500 text-sm">{dbError}</p>}
                    {dbArticles.length > 0 && (
                      <div className="rounded-lg border border-slate-200 overflow-hidden mt-3">
                        <div className="bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500 border-b">{dbArticles.length} artikel di Supabase</div>
                        <div className="overflow-x-auto max-h-60 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b bg-white">
                                <th className="text-left px-4 py-2 text-slate-500">Judul</th>
                                <th className="text-left px-4 py-2 text-slate-500 w-32">Tanggal</th>
                                <th className="text-left px-4 py-2 text-slate-500 w-40">Tags</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dbArticles.map((a, i) => (
                                <tr key={i} className="border-b hover:bg-slate-50">
                                  <td className="px-4 py-2 text-slate-900 font-medium">{a.title || "(Tanpa Judul)"}</td>
                                  <td className="px-4 py-2 text-slate-500">{a.published_date || "-"}</td>
                                  <td className="px-4 py-2">
                                    {(a.tags || []).map((t: string) => (
                                      <span key={t} className="inline-block bg-indigo-100 text-indigo-600 text-xs px-1.5 py-0.5 rounded mr-1">{t}</span>
                                    ))}
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
      </main>
    </div>
  );
};

export default Index;
