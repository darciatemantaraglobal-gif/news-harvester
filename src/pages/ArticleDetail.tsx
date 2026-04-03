import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, ExternalLink, Loader2, Newspaper, Calendar, Tag,
  AlertCircle, CheckCircle2, FileText, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";

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

  const { data: article, isLoading, isError } = useQuery<Article>({
    queryKey: ["/api/article", id],
    queryFn: async () => {
      const res = await fetch(`/api/article/${id}`);
      if (!res.ok) throw new Error("Article not found");
      return res.json();
    },
  });

  return (
    <div className="min-h-screen bg-[#f4f5f7]">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-6 h-13 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              data-testid="button-back"
              variant="ghost"
              size="sm"
              onClick={() => navigate("/")}
              className="gap-1.5 text-slate-500 hover:text-slate-800 h-8 px-3 -ml-2"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm">Kembali</span>
            </Button>
            <div className="w-px h-4 bg-slate-200" />
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-indigo-600 rounded-md flex items-center justify-center">
                <Newspaper className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-sm font-semibold text-slate-700">Detail Artikel</span>
            </div>
          </div>
          {article && (
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="link-source-url"
            >
              <Button variant="outline" size="sm"
                className="gap-1.5 h-8 text-xs border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-200">
                <ExternalLink className="w-3.5 h-3.5" />
                Sumber Asli
              </Button>
            </a>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">

        {/* Loading */}
        {isLoading && (
          <div className="bg-white rounded-xl border border-slate-200 p-12 flex flex-col items-center justify-center gap-3 text-slate-400">
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
            <p className="text-sm">Memuat artikel...</p>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="bg-white rounded-xl border border-slate-200 p-12 flex flex-col items-center justify-center gap-4">
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
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-6 py-5 space-y-4">
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
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-6 py-4">
                <p className="text-[11px] font-semibold text-indigo-500 uppercase tracking-wider mb-2">Ringkasan</p>
                <p className="text-sm text-indigo-900 leading-relaxed">{article.summary}</p>
              </div>
            )}

            {/* Content card */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-6 py-6">
              <div className="flex items-center gap-2 mb-5 pb-4 border-b border-slate-100">
                <FileText className="w-4 h-4 text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-600">Konten Artikel</h2>
              </div>
              <div
                data-testid="text-content"
                className="text-slate-700 leading-[1.85] text-[15px] whitespace-pre-line max-w-prose"
              >
                {article.content || (
                  <span className="text-slate-400 italic">Konten tidak tersedia untuk artikel ini.</span>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default ArticleDetail;
