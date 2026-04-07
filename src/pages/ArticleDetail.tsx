import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ExternalLink, Loader2, Newspaper, Calendar, Tag,
  AlertCircle, CheckCircle2, FileText, Clock, CheckSquare,
  Sparkles, Save, RotateCcw, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api";
import { getToken } from "@/lib/auth";
import ReactMarkdown from "react-markdown";

interface Article {
  id: string;
  title: string;
  date: string;
  url: string;
  content: string;
  status: "success" | "partial" | "failed";
  summary?: string;
  tags?: string[];
  mode?: string;
  formatted_by_ai?: boolean;
}

function StatusChip({ status }: { status: Article["status"] }) {
  if (status === "success")
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
        <CheckCircle2 className="w-3 h-3" />Berhasil
      </span>
    );
  if (status === "partial")
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
        <AlertCircle className="w-3 h-3" />Partial
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full">
      <AlertCircle className="w-3 h-3" />Gagal
    </span>
  );
}

const ArticleDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [formatting, setFormatting] = useState(false);
  const [formattedContent, setFormattedContent] = useState<string | null>(null);
  const [formatError, setFormatError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  const { data: article, isLoading, isError } = useQuery<Article>({
    queryKey: ["/api/article", id],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/article/${id}`));
      if (!res.ok) throw new Error("Article not found");
      return res.json();
    },
  });

  const handleFormat = async () => {
    if (!id) return;
    setFormatting(true);
    setFormatError("");
    setFormattedContent(null);
    setSavedOk(false);
    try {
      const res = await fetch(apiUrl(`/api/article/${id}/format`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ save: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal memformat artikel.");
      setFormattedContent(data.formatted_content);
    } catch (e: unknown) {
      setFormatError(e instanceof Error ? e.message : "Terjadi kesalahan.");
    }
    setFormatting(false);
  };

  const handleSave = async () => {
    if (!id || !formattedContent) return;
    setSaving(true);
    try {
      const res = await fetch(apiUrl(`/api/article/${id}/format`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ save: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal menyimpan.");
      setSavedOk(true);
      queryClient.invalidateQueries({ queryKey: ["/api/article", id] });
    } catch (e: unknown) {
      setFormatError(e instanceof Error ? e.message : "Gagal menyimpan.");
    }
    setSaving(false);
  };

  const handleDiscard = () => {
    setFormattedContent(null);
    setFormatError("");
    setSavedOk(false);
  };

  const displayContent = formattedContent ?? article?.content;
  const isFormatted = formattedContent !== null;

  return (
    <div className="min-h-screen bg-[#f0f1f8] pb-16 sm:pb-0">
      {/* Header */}
      <header className="bg-gradient-to-r from-[#1a0533] via-[#2e0d5e] to-[#3d1480] sticky top-0 z-20 shadow-lg shadow-purple-900/40">
        <div className="max-w-4xl mx-auto px-3 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              data-testid="button-back"
              variant="ghost"
              size="sm"
              onClick={() => navigate("/")}
              className="gap-1.5 text-white/80 hover:text-white hover:bg-white/15 h-8 px-3 -ml-2"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm">Kembali</span>
            </Button>
            <div className="w-px h-4 bg-white/30" />
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-white/20 rounded-lg flex items-center justify-center">
                <Newspaper className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-sm font-bold text-white">Detail Artikel</span>
            </div>
          </div>
          {article && (
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="link-source-url"
            >
              <Button variant="ghost" size="sm"
                className="gap-1.5 h-8 text-xs text-white/80 hover:text-white hover:bg-white/15">
                <ExternalLink className="w-3.5 h-3.5" />
                Sumber Asli
              </Button>
            </a>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-8">

        {/* Loading */}
        {isLoading && (
          <div className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(79,70,229,0.08)] p-12 flex flex-col items-center justify-center gap-3 text-slate-400">
            <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
            </div>
            <p className="text-sm">Memuat artikel...</p>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(79,70,229,0.08)] p-12 flex flex-col items-center justify-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center">
              <FileText className="w-7 h-7 text-red-300" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-slate-700">Artikel tidak ditemukan</p>
              <p className="text-sm text-slate-400 mt-1">Artikel mungkin telah dihapus atau ID tidak valid.</p>
            </div>
            <Button variant="outline" onClick={() => navigate("/")}
              className="gap-1.5 border-slate-200">
              <ArrowLeft className="w-4 h-4" />Kembali ke Dashboard
            </Button>
          </div>
        )}

        {/* Article */}
        {article && (
          <div className="space-y-5">
            {/* Meta card */}
            <div className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(79,70,229,0.08)] px-6 py-5 space-y-4">
              {/* Status + mode */}
              <div className="flex items-center gap-2 flex-wrap">
                <span data-testid="status-badge">
                  <StatusChip status={article.status} />
                </span>
                {article.mode && (
                  <span className="text-xs font-mono text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full">
                    {article.mode}
                  </span>
                )}
                {(article.formatted_by_ai || savedOk) && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 bg-violet-50 border border-violet-200 px-2.5 py-1 rounded-full">
                    <Sparkles className="w-3 h-3" />Dirapikan AI
                  </span>
                )}
              </div>

              {/* Title */}
              <h1 data-testid="text-title" className="text-xl font-bold text-slate-900 leading-snug">
                {article.title || "(Tanpa Judul)"}
              </h1>

              {/* Meta row */}
              <div className="flex items-center gap-4 flex-wrap text-sm text-slate-500">
                {article.date && (
                  <span data-testid="text-date" className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    {article.date}
                  </span>
                )}
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="link-source-url-inline"
                  className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 transition-colors truncate max-w-sm"
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate text-xs">{article.url}</span>
                </a>
              </div>

              {/* Tags */}
              {article.tags && article.tags.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-slate-100">
                  <Tag className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  {article.tags.map(t => (
                    <span key={t} className="text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 rounded-full">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Summary card */}
            {article.summary && (
              <div className="bg-gradient-to-r from-indigo-50 to-violet-50 rounded-2xl px-6 py-4">
                <p className="text-[11px] font-semibold text-indigo-500 uppercase tracking-widest mb-2">Ringkasan</p>
                <p className="text-sm text-indigo-900 leading-relaxed">{article.summary}</p>
              </div>
            )}

            {/* Content card */}
            <div className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(79,70,229,0.08)] px-6 py-6">

              {/* Content header */}
              <div className="flex items-center justify-between gap-3 mb-5 pb-4 border-b border-indigo-50">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-slate-100 rounded-lg flex items-center justify-center">
                    <FileText className="w-3.5 h-3.5 text-slate-500" />
                  </div>
                  <h2 className="text-sm font-bold text-slate-700">Konten Artikel</h2>
                  {isFormatted && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-violet-600 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full">
                      <Sparkles className="w-2.5 h-2.5" />Hasil AI
                    </span>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 shrink-0">
                  {!isFormatted && (
                    <button
                      onClick={handleFormat}
                      disabled={formatting}
                      className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                      style={{
                        background: formatting ? "transparent" : "linear-gradient(135deg, #6d28d9, #7c3aed)",
                        borderColor: "#7c3aed",
                        color: "white",
                        boxShadow: formatting ? "none" : "0 0 10px rgba(139,92,246,0.3)",
                      }}
                    >
                      {formatting
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span className="hidden sm:inline">Memformat...</span></>
                        : <><Sparkles className="w-3.5 h-3.5" /><span>Rapikan AI</span></>
                      }
                    </button>
                  )}

                  {isFormatted && !savedOk && (
                    <>
                      <button
                        onClick={handleDiscard}
                        className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 px-3 py-1.5 rounded-full transition-all"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />Batal
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-1.5 text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 border border-violet-700 px-3 py-1.5 rounded-full transition-all disabled:opacity-60"
                      >
                        {saving
                          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Menyimpan...</>
                          : <><Save className="w-3.5 h-3.5" />Simpan</>
                        }
                      </button>
                    </>
                  )}

                  {savedOk && (
                    <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full">
                      <Check className="w-3.5 h-3.5" />Tersimpan
                    </span>
                  )}
                </div>
              </div>

              {/* Format error */}
              {formatError && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-xs text-red-600">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />{formatError}
                </div>
              )}

              {/* Formatting in-progress placeholder */}
              {formatting && (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-400">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-violet-50 border border-violet-100 flex items-center justify-center">
                      <Sparkles className="w-5 h-5 text-violet-400" />
                    </div>
                    <div className="absolute -inset-1 rounded-full border-2 border-violet-300/40 animate-ping" />
                  </div>
                  <p className="text-sm text-slate-500 font-medium">AI sedang merapikan konten...</p>
                  <p className="text-xs text-slate-400">Biasanya butuh 5–15 detik</p>
                </div>
              )}

              {/* Content text */}
              {!formatting && (
                <div
                  data-testid="text-content"
                  className={`max-w-prose transition-all ${isFormatted ? "ring-1 ring-violet-100 bg-violet-50/30 rounded-xl p-4 -mx-1" : ""}`}
                >
                  {displayContent ? (
                    isFormatted ? (
                      <div className="prose prose-sm prose-slate max-w-none
                        prose-headings:font-bold prose-headings:text-slate-800 prose-headings:mt-4 prose-headings:mb-2
                        prose-h2:text-base prose-h3:text-sm
                        prose-p:text-slate-700 prose-p:leading-[1.85] prose-p:my-2
                        prose-li:text-slate-700 prose-li:leading-relaxed
                        prose-ul:my-2 prose-ul:pl-4
                        prose-strong:text-slate-800 prose-strong:font-semibold
                        prose-blockquote:border-violet-300 prose-blockquote:text-slate-600 prose-blockquote:italic
                      ">
                        <ReactMarkdown>{displayContent}</ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-slate-700 leading-[1.85] text-[15px] whitespace-pre-line">{displayContent}</p>
                    )
                  ) : (
                    <span className="text-slate-400 italic">Konten tidak tersedia untuk artikel ini.</span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ── Mobile Bottom Nav ── */}
      <nav className="fixed bottom-0 inset-x-0 z-30 sm:hidden bg-white/95 backdrop-blur-sm border-t border-slate-200 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-around h-14 px-2">
          <button onClick={() => navigate("/")} className="flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors min-w-[60px]">
            <Newspaper style={{ width: 18, height: 18 }} />
            <span className="text-[10px] font-semibold">Scraper</span>
          </button>
          <Link to="/review" className="flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors min-w-[60px]">
            <CheckSquare style={{ width: 18, height: 18 }} />
            <span className="text-[10px] font-semibold">Review</span>
          </Link>
          <div className="flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl bg-slate-900 text-white min-w-[60px]">
            <FileText style={{ width: 18, height: 18 }} />
            <span className="text-[10px] font-semibold">Artikel</span>
          </div>
        </div>
      </nav>
    </div>
  );
};

export default ArticleDetail;
