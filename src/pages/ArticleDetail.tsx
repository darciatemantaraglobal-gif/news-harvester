import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Loader2, Newspaper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface Article {
  id: string;
  title: string;
  date: string;
  url: string;
  content: string;
  status: "success" | "partial" | "failed";
}

const statusBadge = (status: Article["status"]) => {
  if (status === "success")
    return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">SUCCESS</Badge>;
  if (status === "partial")
    return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">PARTIAL</Badge>;
  return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">FAILED</Badge>;
};

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
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <Button
            data-testid="button-back"
            variant="ghost"
            size="icon"
            onClick={() => navigate("/")}
            className="text-slate-400 hover:text-slate-700"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Newspaper className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">Detail Artikel</h1>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {isLoading && (
          <div className="flex items-center justify-center py-24 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Memuat artikel...
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
            <Newspaper className="w-12 h-12 opacity-30" />
            <p className="text-base">Artikel tidak ditemukan.</p>
            <Button variant="outline" onClick={() => navigate("/")}>
              Kembali ke Dashboard
            </Button>
          </div>
        )}

        {article && (
          <Card>
            <CardContent className="p-8">
              <div className="mb-4" data-testid="status-badge">
                {statusBadge(article.status)}
              </div>
              <h2 data-testid="text-title" className="text-2xl font-bold text-slate-900 mb-3">
                {article.title || "(Tanpa Judul)"}
              </h2>
              <div className="flex items-center gap-4 text-sm text-slate-500 mb-6 flex-wrap">
                {article.date && (
                  <span data-testid="text-date">{article.date}</span>
                )}
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="link-source-url"
                  className="text-indigo-600 hover:underline flex items-center gap-1 truncate max-w-sm"
                >
                  {article.url}
                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
              </div>
              <hr className="mb-6 border-slate-100" />
              <div
                data-testid="text-content"
                className="text-slate-700 leading-relaxed whitespace-pre-line text-base"
              >
                {article.content || "(Konten tidak tersedia)"}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
};

export default ArticleDetail;
