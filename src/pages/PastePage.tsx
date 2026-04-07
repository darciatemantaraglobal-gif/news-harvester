import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, Copy, Check, Loader2, AlertCircle, Trash2, ClipboardPaste } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { apiUrl } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { BottomNav } from "@/components/BottomNav";

export default function PastePage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleRapikan = async () => {
    if (!content.trim()) return;
    setLoading(true);
    setError("");
    setResult("");
    try {
      const res = await fetch(apiUrl("/api/format-text"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ title: title.trim(), content: content.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal memproses konten.");
      setResult(data.formatted_content);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleClear = () => {
    setTitle("");
    setContent("");
    setResult("");
    setError("");
    textareaRef.current?.focus();
  };

  const charCount = content.length;
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  return (
    <div className="bg-black relative overflow-hidden flex flex-col" style={{ minHeight: '100dvh' }}>

      {/* Background */}
      <div className="absolute inset-0 pointer-events-none select-none">
        <img src="/bg-home.jpg" alt="" className="absolute inset-0 w-full h-full object-cover sm:hidden"
          style={{ opacity: 0.18, objectPosition: "center 82%", transform: "scale(1.38)", transformOrigin: "center bottom" }} />
        <img src="/bg-desktop.jpg" alt="" className="absolute inset-0 w-full h-full object-cover hidden sm:block"
          style={{ opacity: 0.18 }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 70% 55% at 50% 30%, rgba(109,40,217,0.22) 0%, transparent 70%)" }} />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center gap-3 px-4 sm:px-8 pt-4 pb-3 shrink-0 border-b border-violet-900/30">
        <button
          onClick={() => navigate("/")}
          className="flex items-center justify-center w-8 h-8 rounded-xl text-violet-400 hover:text-violet-200 hover:bg-violet-900/30 transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="font-bold text-white text-sm sm:text-base leading-tight">Paste & Rapikan</h1>
          <p className="text-violet-400/60 text-[10px] sm:text-xs">Tempel artikel, rapikan otomatis dengan AI</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-violet-900/30 border border-violet-700/40 rounded-full px-2.5 py-1">
            <Sparkles className="w-3 h-3 text-violet-400" />
            <span className="text-[10px] font-semibold text-violet-300">Rapikan AI</span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex-1 flex flex-col sm:flex-row gap-3 sm:gap-4 p-4 sm:p-6 pb-24 sm:pb-6 overflow-y-auto">

        {/* ── Input panel ── */}
        <div className="flex flex-col gap-3 sm:flex-1 sm:min-w-0">

          {/* Title input */}
          <div className="relative overflow-hidden rounded-xl" style={{ background: "#0d0720" }}>
            <div className="absolute animate-border-beam pointer-events-none"
              style={{ inset: "-50%", width: "200%", height: "200%", background: "conic-gradient(transparent 260deg, rgba(139,92,246,0.4) 300deg, rgba(196,181,253,0.8) 345deg, transparent 360deg)" }} />
            <div className="relative m-px rounded-[11px] p-3 sm:p-4" style={{ background: "#0d0720" }}>
              <label className="block text-[10px] font-bold text-violet-500 uppercase tracking-widest mb-1.5">
                Judul <span className="text-violet-700 normal-case font-normal tracking-normal">(opsional)</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Judul artikel..."
                className="w-full bg-transparent text-white text-sm placeholder:text-slate-600 outline-none"
              />
            </div>
          </div>

          {/* Textarea */}
          <div className="relative overflow-hidden rounded-xl flex-1" style={{ background: "#0d0720", minHeight: '200px' }}>
            <div className="absolute animate-border-beam-delay pointer-events-none"
              style={{ inset: "-50%", width: "200%", height: "200%", background: "conic-gradient(transparent 260deg, rgba(139,92,246,0.4) 300deg, rgba(196,181,253,0.8) 345deg, transparent 360deg)" }} />
            <div className="relative m-px rounded-[11px] flex flex-col h-full" style={{ background: "#0d0720" }}>
              <div className="flex items-center justify-between px-3 sm:px-4 pt-3 pb-2 border-b border-violet-900/40">
                <label className="text-[10px] font-bold text-violet-500 uppercase tracking-widest">Konten Artikel</label>
                {content && (
                  <span className="text-[10px] text-slate-600">{wordCount} kata · {charCount} karakter</span>
                )}
              </div>
              <textarea
                ref={textareaRef}
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="Tempel konten artikel di sini..."
                className="flex-1 w-full bg-transparent text-slate-300 text-sm leading-relaxed placeholder:text-slate-700 outline-none resize-none px-3 sm:px-4 py-3"
                style={{ minHeight: '180px' }}
              />
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleRapikan}
              disabled={loading || !content.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: loading || !content.trim() ? "rgba(109,40,217,0.3)" : "linear-gradient(135deg, #6d28d9, #7c3aed)",
                boxShadow: loading || !content.trim() ? "none" : "0 0 20px rgba(139,92,246,0.4)",
              }}
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" />Sedang Merapikan...</>
                : <><Sparkles className="w-4 h-4" />Rapikan AI</>
              }
            </button>
            {(content || title || result) && (
              <button
                onClick={handleClear}
                className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl font-semibold text-xs text-slate-500 hover:text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />Reset
              </button>
            )}
          </div>

          {/* Paste hint */}
          {!content && !loading && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-900/20 border border-violet-800/30">
              <ClipboardPaste className="w-3.5 h-3.5 text-violet-500 shrink-0" />
              <p className="text-[11px] text-violet-400/70">
                Paste teks dari artikel berita, blog, atau sumber apapun. AI akan menyaring info penting dan memformatnya jadi Markdown.
              </p>
            </div>
          )}
        </div>

        {/* ── Result panel ── */}
        <div className="sm:flex-1 sm:min-w-0">
          <div className="relative overflow-hidden rounded-xl h-full" style={{ background: "#0d0720", minHeight: result || loading || error ? '300px' : '0' }}>
            {(result || loading || error) && (
              <>
                <div className="absolute animate-border-beam-slow pointer-events-none"
                  style={{ inset: "-50%", width: "200%", height: "200%", background: error ? "conic-gradient(transparent 260deg, rgba(239,68,68,0.4) 300deg, rgba(252,165,165,0.8) 345deg, transparent 360deg)" : "conic-gradient(transparent 260deg, rgba(16,185,129,0.5) 300deg, rgba(110,231,183,1) 345deg, transparent 360deg)" }} />
                <div className="relative m-px rounded-[11px] flex flex-col h-full" style={{ background: "#0d0720" }}>

                  {/* Result header */}
                  <div className="flex items-center justify-between px-3 sm:px-4 pt-3 pb-2 border-b border-violet-900/40 shrink-0">
                    <div className="flex items-center gap-2">
                      {error
                        ? <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                        : <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                      }
                      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: error ? '#f87171' : '#34d399' }}>
                        {error ? "Error" : "Hasil Rapikan AI"}
                      </span>
                    </div>
                    {result && !error && (
                      <button
                        onClick={handleCopy}
                        className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all"
                        style={{
                          background: copied ? "rgba(16,185,129,0.2)" : "rgba(139,92,246,0.2)",
                          color: copied ? "#34d399" : "#a78bfa",
                          border: copied ? "1px solid rgba(16,185,129,0.4)" : "1px solid rgba(139,92,246,0.4)",
                        }}
                      >
                        {copied ? <><Check className="w-3 h-3" />Tersalin!</> : <><Copy className="w-3 h-3" />Salin</>}
                      </button>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3">
                    {loading && (
                      <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-500">
                        <div className="relative">
                          <div className="w-10 h-10 rounded-full bg-violet-900/40 border border-violet-800/60 flex items-center justify-center">
                            <Sparkles className="w-5 h-5 text-violet-400" />
                          </div>
                          <div className="absolute -inset-1 rounded-full border-2 border-violet-500/30 animate-ping" />
                        </div>
                        <p className="text-sm text-slate-400 font-medium">AI sedang merapikan konten...</p>
                        <p className="text-xs text-slate-600">Biasanya butuh 5–15 detik</p>
                      </div>
                    )}
                    {error && !loading && (
                      <p className="text-sm text-red-400 leading-relaxed">{error}</p>
                    )}
                    {result && !loading && (
                      <div className="prose prose-sm prose-invert max-w-none
                        prose-headings:font-bold prose-headings:text-slate-100 prose-headings:mt-4 prose-headings:mb-2
                        prose-h2:text-sm prose-h3:text-xs
                        prose-p:text-slate-300 prose-p:leading-[1.85] prose-p:my-2
                        prose-li:text-slate-300 prose-li:leading-relaxed
                        prose-ul:my-2 prose-ul:pl-4
                        prose-strong:text-white prose-strong:font-semibold
                        prose-blockquote:border-violet-600 prose-blockquote:text-slate-400 prose-blockquote:italic
                      ">
                        <ReactMarkdown>{result}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Empty state */}
            {!result && !loading && !error && (
              <div className="relative m-px rounded-[11px] flex flex-col items-center justify-center py-12 px-4 text-center" style={{ background: "#0d0720" }}>
                <div className="w-12 h-12 rounded-2xl bg-violet-900/40 border border-violet-800/50 flex items-center justify-center mb-3">
                  <Sparkles className="w-6 h-6 text-violet-600" />
                </div>
                <p className="text-sm text-slate-600 font-medium">Hasil akan muncul di sini</p>
                <p className="text-xs text-slate-700 mt-1">Paste konten dan klik Rapikan AI</p>
              </div>
            )}
          </div>
        </div>

      </main>

      <BottomNav active="home" />
    </div>
  );
}
