import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Newspaper, Zap, FileJson, FileText, Loader2, ExternalLink, BookOpen, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface Article {
  id: string;
  title: string;
  date: string;
  url: string;
  content: string;
  status: "success" | "partial" | "failed";
}

interface ScrapeProgress {
  running: boolean;
  phase: "idle" | "listing" | "scraping" | "done";
  current: number;
  total: number;
  success: number;
  partial: number;
  failed: number;
  logs: string[];
}

const statusBadge = (status: Article["status"]) => {
  if (status === "success")
    return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">SUCCESS</Badge>;
  if (status === "partial")
    return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">PARTIAL</Badge>;
  return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">FAILED</Badge>;
};

const Index = () => {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [progress, setProgress] = useState<ScrapeProgress>({
    running: false,
    phase: "idle",
    current: 0,
    total: 0,
    success: 0,
    partial: 0,
    failed: 0,
    logs: [],
  });
  const [articles, setArticles] = useState<Article[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(true);
  const [kbConverting, setKbConverting] = useState(false);
  const [kbDone, setKbDone] = useState(false);
  const [kbError, setKbError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const fetchArticles = async () => {
    try {
      const res = await fetch("/api/articles");
      if (res.ok) {
        const data = await res.json();
        setArticles(data);
      }
    } catch {}
    setLoadingArticles(false);
  };

  const pollProgress = async () => {
    try {
      const res = await fetch("/api/progress");
      if (!res.ok) return;
      const data: ScrapeProgress = await res.json();
      setProgress(data);
      if (logRef.current) {
        logRef.current.scrollTop = logRef.current.scrollHeight;
      }
      if (!data.running && data.phase === "done") {
        stopPoll();
        fetchArticles();
      }
    } catch {}
  };

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    fetchArticles();
    pollProgress();
    return () => stopPoll();
  }, []);

  const startScrape = async () => {
    setUrlError("");
    if (!url.trim()) {
      setUrlError("URL tidak boleh kosong.");
      return;
    }
    if (!url.startsWith("http")) {
      setUrlError("URL tidak valid, harus dimulai dengan http:// atau https://");
      return;
    }
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUrlError(data.error || "Terjadi kesalahan.");
        return;
      }
      pollRef.current = setInterval(pollProgress, 1000);
    } catch {
      setUrlError("Tidak bisa menghubungi server. Pastikan backend berjalan.");
    }
  };

  const convertToKb = async () => {
    setKbConverting(true);
    setKbError("");
    setKbDone(false);
    try {
      const res = await fetch("/api/convert-kb", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setKbError(data.error || "Gagal mengkonversi.");
      } else {
        setKbDone(true);
      }
    } catch {
      setKbError("Tidak bisa menghubungi server.");
    } finally {
      setKbConverting(false);
    }
  };

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const isRunning = progress.running;
  const showProgress = progress.phase !== "idle";

  const phaseLabel: Record<string, string> = {
    idle: "Siap",
    listing: "Mengumpulkan daftar artikel...",
    scraping: `Scraping artikel ${progress.current} / ${progress.total}`,
    done: "Selesai!",
  };

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
            <p className="text-xs text-slate-500">Internal scraping tool</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Input Section */}
        <Card>
          <CardContent className="pt-5">
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              URL Halaman Berita
            </label>
            <div className="flex gap-3">
              <div className="flex-1">
                <Input
                  data-testid="input-url"
                  type="url"
                  placeholder="https://www.kemlu.go.id/cairo/berita"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !isRunning && startScrape()}
                  disabled={isRunning}
                  className={urlError ? "border-red-400 focus-visible:ring-red-400" : ""}
                />
                {urlError && <p className="text-red-500 text-xs mt-1">{urlError}</p>}
              </div>
              <Button
                data-testid="button-start-scrape"
                onClick={startScrape}
                disabled={isRunning}
                className="bg-indigo-600 hover:bg-indigo-700 text-white whitespace-nowrap"
              >
                {isRunning ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4 mr-2" />
                )}
                {isRunning ? "Sedang Scraping..." : "Start Scraping"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Progress */}
        {showProgress && (
          <Card>
            <CardContent className="pt-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">
                  {phaseLabel[progress.phase] || progress.phase}
                </span>
                {progress.phase === "scraping" && (
                  <span className="text-sm text-slate-500">{pct}%</span>
                )}
              </div>
              {progress.phase === "scraping" && (
                <Progress value={pct} className="h-2.5" />
              )}
              {progress.logs.length > 0 && (
                <div
                  ref={logRef}
                  data-testid="log-panel"
                  className="bg-slate-900 rounded-lg p-3 max-h-48 overflow-y-auto"
                >
                  {progress.logs.map((log, i) => (
                    <p key={i} className="text-xs text-slate-300 font-mono leading-relaxed">
                      {log}
                    </p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Total Ditemukan</p>
              <p data-testid="stat-total" className="text-2xl font-bold text-slate-900 mt-1">
                {progress.total || articles.length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Berhasil</p>
              <p data-testid="stat-success" className="text-2xl font-bold text-emerald-600 mt-1">
                {progress.phase !== "idle" ? progress.success : articles.filter((a) => a.status === "success").length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Partial</p>
              <p data-testid="stat-partial" className="text-2xl font-bold text-yellow-500 mt-1">
                {progress.phase !== "idle" ? progress.partial : articles.filter((a) => a.status === "partial").length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Gagal</p>
              <p data-testid="stat-failed" className="text-2xl font-bold text-red-500 mt-1">
                {progress.phase !== "idle" ? progress.failed : articles.filter((a) => a.status === "failed").length}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Articles Table */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Artikel Terscrape
                {articles.length > 0 && (
                  <span className="ml-2 text-sm font-normal text-slate-500">({articles.length})</span>
                )}
              </CardTitle>
              {articles.length > 0 && (
                <div className="flex gap-2">
                  <a href="/export/json" download>
                    <Button data-testid="button-export-json" variant="outline" size="sm" className="gap-1.5">
                      <FileJson className="w-4 h-4" />
                      JSON
                    </Button>
                  </a>
                  <a href="/export/csv" download>
                    <Button data-testid="button-export-csv" variant="outline" size="sm" className="gap-1.5">
                      <FileText className="w-4 h-4" />
                      CSV
                    </Button>
                  </a>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loadingArticles ? (
              <div className="flex items-center justify-center py-16 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Memuat artikel...
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
                      <th className="text-left px-6 py-3 font-medium text-slate-500 w-16">#</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-500">Judul</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-500 w-32">Tanggal</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-500 w-24">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-500 w-24">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {articles.map((article, i) => (
                      <tr
                        key={article.id}
                        data-testid={`row-article-${article.id}`}
                        className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                      >
                        <td className="px-6 py-3 text-slate-400">{i + 1}</td>
                        <td className="px-4 py-3">
                          <button
                            data-testid={`link-article-${article.id}`}
                            onClick={() => navigate(`/article/${article.id}`)}
                            className="text-slate-900 hover:text-indigo-600 text-left font-medium line-clamp-2 transition-colors"
                          >
                            {article.title || "(Tanpa Judul)"}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{article.date || "-"}</td>
                        <td className="px-4 py-3">{statusBadge(article.status)}</td>
                        <td className="px-4 py-3">
                          <a
                            href={article.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid={`link-source-${article.id}`}
                            className="text-indigo-500 hover:text-indigo-700 transition-colors"
                          >
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

        {/* Knowledge Base Conversion */}
        {articles.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-indigo-600" />
                <CardTitle className="text-base">Knowledge Base Format</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-500">
                Konversi {articles.length} artikel hasil scraping ke format KB dengan field:{" "}
                <span className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">
                  title, slug, source_url, published_date, content, summary, tags
                </span>
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  data-testid="button-convert-kb"
                  onClick={convertToKb}
                  disabled={kbConverting || isRunning}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
                >
                  {kbConverting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : kbDone ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <BookOpen className="w-4 h-4" />
                  )}
                  {kbConverting ? "Mengkonversi..." : kbDone ? "Dikonversi!" : "Convert to KB Format"}
                </Button>

                {kbDone && (
                  <a href="/export/kb" download>
                    <Button
                      data-testid="button-download-kb"
                      variant="outline"
                      className="gap-2 border-indigo-300 text-indigo-600 hover:bg-indigo-50"
                    >
                      <FileJson className="w-4 h-4" />
                      Download kb_articles.json
                    </Button>
                  </a>
                )}
              </div>

              {kbError && (
                <p data-testid="text-kb-error" className="text-red-500 text-sm">
                  {kbError}
                </p>
              )}

              {kbDone && (
                <p data-testid="text-kb-success" className="text-emerald-600 text-sm">
                  Berhasil dikonversi! File disimpan ke <span className="font-mono text-xs">data/kb_articles.json</span>
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
};

export default Index;
