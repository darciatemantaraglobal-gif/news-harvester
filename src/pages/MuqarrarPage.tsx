import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Upload, BookOpen, Search, Trash2, Loader2,
  AlertCircle, CheckCircle2, Sparkles, FileText, ChevronDown,
  ChevronUp, X, Database, Copy, Check, RefreshCw,
  ScanLine, List, Hash, ChevronRight, Eye, ChevronLeft,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiUrl } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { BottomNav } from "@/components/BottomNav";

interface KitabItem {
  kitab_id: string;
  kitab_name: string;
  author: string;
  description: string;
  total_pages: number;
  created_at: string;
}

interface SourceItem {
  page: number;
  chapter: string;
  kitab_name: string;
  author: string;
  excerpt: string;
  score: number;
}

type Tab = "library" | "upload" | "ask" | "review";

interface PageChunk {
  page_number: number;
  chapter: string;
  content: string;
  word_count: number;
  is_ocr: boolean;
}

const authHeaders = () => ({
  Authorization: `Bearer ${getToken() || ""}`,
  "Content-Type": "application/json",
});

export default function MuqarrarPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("library");

  // ── DB status ──────────────────────────────────────────────────────────────
  const [dbExists, setDbExists] = useState<boolean | null>(null);
  const [dbError, setDbError] = useState("");

  // ── Upload state ───────────────────────────────────────────────────────────
  const [file, setFile] = useState<File | null>(null);
  const [kitabName, setKitabName] = useState("");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [useOcr, setUseOcr] = useState(true);

  // ── Detect AI state ────────────────────────────────────────────────────────
  const [detectLoading, setDetectLoading] = useState(false);
  const [detectError, setDetectError] = useState("");
  const [jobId, setJobId] = useState("");
  const [jobStatus, setJobStatus] = useState<Record<string, any> | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Scan state ─────────────────────────────────────────────────────────────
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scanResult, setScanResult] = useState<{
    pages_total: number;
    toc_source: "native" | "detected" | "none";
    chapters_count: number;
    chapters: { level: number; title: string; page: number; page_count: number }[];
    first_page_preview: string;
  } | null>(null);
  const [showAllChapters, setShowAllChapters] = useState(false);

  // ── Library state ──────────────────────────────────────────────────────────
  const [kitabList, setKitabList] = useState<KitabItem[]>([]);
  const [libLoading, setLibLoading] = useState(false);
  const [deletingId, setDeletingId] = useState("");

  // ── Review state ───────────────────────────────────────────────────────────
  const [reviewKitab, setReviewKitab] = useState<KitabItem | null>(null);
  const [reviewPages, setReviewPages] = useState<PageChunk[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [activePageIdx, setActivePageIdx] = useState(0);

  // ── Ask state ──────────────────────────────────────────────────────────────
  const [question, setQuestion] = useState("");
  const [selectedKitab, setSelectedKitab] = useState<string>("");
  const [askLoading, setAskLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [askError, setAskError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showSources, setShowSources] = useState(true);

  // ── Init ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    checkDb();
    fetchLibrary();
  }, []);

  const checkDb = async () => {
    try {
      const res = await fetch(apiUrl("/api/muqarrar/db-status"), {
        headers: { Authorization: `Bearer ${getToken() || ""}` },
      });
      const data = await res.json();
      setDbExists(data.exists);
      setDbError(data.error || "");
    } catch {
      setDbExists(false);
      setDbError("Tidak bisa cek status database.");
    }
  };

  const fetchLibrary = async () => {
    setLibLoading(true);
    try {
      const res = await fetch(apiUrl("/api/muqarrar/list"), {
        headers: { Authorization: `Bearer ${getToken() || ""}` },
      });
      const data = await res.json();
      setKitabList(data.kitab || []);
    } catch {
      // silent
    } finally {
      setLibLoading(false);
    }
  };

  // ── Detect with AI ─────────────────────────────────────────────────────────
  const handleDetect = async () => {
    if (!file) return;
    setDetectLoading(true);
    setDetectError("");

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch(apiUrl("/api/muqarrar/detect"), {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() || ""}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Deteksi gagal.");
      if (data.kitab_name) setKitabName(data.kitab_name);
      if (data.author) setAuthor(data.author);
      if (data.description) setDescription(data.description);
    } catch (e: any) {
      setDetectError(e.message || "Gagal mendeteksi metadata PDF.");
    } finally {
      setDetectLoading(false);
    }
  };

  // ── Scan PDF ───────────────────────────────────────────────────────────────
  const handleScan = async () => {
    if (!file) return;
    setScanLoading(true);
    setScanError("");
    setScanResult(null);
    setShowAllChapters(false);

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch(apiUrl("/api/muqarrar/scan"), {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() || ""}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan gagal.");
      setScanResult(data);
    } catch (e: any) {
      setScanError(e.message || "Gagal scan PDF.");
    } finally {
      setScanLoading(false);
    }
  };

  // ── Upload ─────────────────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!file || !kitabName.trim()) return;
    setUploadLoading(true);
    setUploadError("");
    setJobStatus(null);
    setJobId("");

    const form = new FormData();
    form.append("file", file);
    form.append("kitab_name", kitabName.trim());
    form.append("author", author.trim());
    form.append("description", description.trim());
    form.append("use_ocr", useOcr ? "true" : "false");

    try {
      const res = await fetch(apiUrl("/api/muqarrar/upload"), {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() || ""}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload gagal.");
      setJobId(data.job_id);
      startPolling(data.job_id);
    } catch (e: any) {
      setUploadError(e.message || "Upload gagal.");
      setUploadLoading(false);
    }
  };

  const startPolling = (jid: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(apiUrl(`/api/muqarrar/job/${jid}`), {
          headers: { Authorization: `Bearer ${getToken() || ""}` },
        });
        const data = await res.json();
        setJobStatus(data);
        if (data.status === "done" || data.status === "error") {
          clearInterval(pollRef.current!);
          setUploadLoading(false);
          if (data.status === "done") {
            fetchLibrary();
            setTimeout(() => setTab("library"), 1200);
          }
        }
      } catch {
        // keep polling
      }
    }, 1500);
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const resetUpload = () => {
    setFile(null);
    setKitabName("");
    setAuthor("");
    setDescription("");
    setDetectError("");
    setDetectLoading(false);
    setJobId("");
    setJobStatus(null);
    setUploadError("");
    setUploadLoading(false);
    setScanResult(null);
    setScanError("");
    setScanLoading(false);
    setShowAllChapters(false);
    if (fileRef.current) fileRef.current.value = "";
    if (pollRef.current) clearInterval(pollRef.current);
  };

  // ── Review ─────────────────────────────────────────────────────────────────
  const openReview = async (kitab: KitabItem) => {
    setReviewKitab(kitab);
    setReviewPages([]);
    setReviewError("");
    setActivePageIdx(0);
    setTab("review");
    setReviewLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/muqarrar/${kitab.kitab_id}/pages`), {
        headers: { Authorization: `Bearer ${getToken() || ""}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal memuat halaman.");
      setReviewPages(data.pages || []);
    } catch (e: any) {
      setReviewError(e.message || "Gagal memuat halaman kitab.");
    } finally {
      setReviewLoading(false);
    }
  };

  // ── Library delete ─────────────────────────────────────────────────────────
  const handleDelete = async (kitab: KitabItem) => {
    if (!confirm(`Hapus "${kitab.kitab_name}"? Semua ${kitab.total_pages} halaman akan dihapus.`)) return;
    setDeletingId(kitab.kitab_id);
    try {
      await fetch(apiUrl(`/api/muqarrar/${kitab.kitab_id}`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getToken() || ""}` },
      });
      fetchLibrary();
    } finally {
      setDeletingId("");
    }
  };

  // ── Ask ────────────────────────────────────────────────────────────────────
  const handleAsk = async () => {
    if (!question.trim()) return;
    setAskLoading(true);
    setAskError("");
    setAnswer("");
    setSources([]);
    setCopied(false);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000); // 2 menit timeout
    try {
      const res = await fetch(apiUrl("/api/muqarrar/ask"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ question: question.trim(), kitab_id: selectedKitab || undefined, top_k: 5 }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal mendapat jawaban.");
      setAnswer(data.answer || "");
      setSources(data.sources || []);
      setShowSources(true);
    } catch (e: any) {
      if (e.name === "AbortError") {
        setAskError("Timeout — jawaban terlalu lama. Coba lagi.");
      } else {
        setAskError(e.message || "Gagal terhubung ke server.");
      }
    } finally {
      clearTimeout(timer);
      setAskLoading(false);
    }
  };

  const handleCopy = () => {
    if (!answer) return;
    navigator.clipboard.writeText(answer).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const progressPct = jobStatus
    ? jobStatus.pages_total > 0
      ? Math.round((jobStatus.pages_done / jobStatus.pages_total) * 100)
      : 0
    : 0;

  const isDone = jobStatus?.status === "done";
  const isError = jobStatus?.status === "error";

  const phaseLabel = (phase: string) => {
    if (phase === "extract") return "Fase 1/3 — Ekstraksi teks";
    if (phase === "embed")   return "Fase 2/3 — Membuat embedding (batch)";
    if (phase === "save")    return "Fase 3/3 — Menyimpan ke database";
    return "Memproses...";
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "linear-gradient(135deg,#0a0118 0%,#050010 60%,#0d0520 100%)" }}>

      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 border-b border-violet-900/30"
        style={{ background: "rgba(10,1,24,0.92)", backdropFilter: "blur(20px)" }}>
        <button onClick={() => navigate("/")} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
          <ArrowLeft className="w-4 h-4 text-slate-400" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-violet-900/60 border border-violet-700/40 flex items-center justify-center">
            <BookOpen className="w-3.5 h-3.5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white leading-tight">Muqarrar AI</h1>
            <p className="text-[10px] text-violet-400/60">Upload kitab → Tanya AINA → Dapat jawaban + halaman</p>
          </div>
        </div>
      </header>

      {/* DB Setup Banner */}
      {dbExists === false && (
        <div className="mx-4 mt-3 rounded-xl p-3 border border-amber-600/40" style={{ background: "rgba(251,191,36,0.08)" }}>
          <div className="flex items-start gap-2">
            <Database className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-amber-300">Setup Database Diperlukan</p>
              <p className="text-[11px] text-amber-400/80 mt-0.5">
                Tabel <code className="bg-amber-900/30 px-1 rounded">muqarrar_chunks</code> belum ada.
                Jalankan SQL berikut di <strong>Supabase SQL Editor</strong>:
              </p>
              <pre className="mt-2 text-[10px] text-amber-300/90 bg-black/40 rounded-lg p-2 overflow-x-auto select-all">
{`CREATE TABLE IF NOT EXISTS muqarrar_chunks (
  id          text        PRIMARY KEY,
  kitab_id    text        NOT NULL,
  kitab_name  text        NOT NULL,
  author      text        DEFAULT '',
  page_number integer     NOT NULL,
  chapter     text        DEFAULT '',
  content     text        NOT NULL,
  embedding   jsonb       DEFAULT '[]',
  word_count  integer     DEFAULT 0,
  is_ocr      boolean     DEFAULT false,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS muqarrar_kitab_id_idx ON muqarrar_chunks (kitab_id);
ALTER TABLE muqarrar_chunks DISABLE ROW LEVEL SECURITY;`}
              </pre>
              <button onClick={checkDb} className="mt-2 flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 font-semibold">
                <RefreshCw className="w-3 h-3" /> Cek Lagi
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 px-4 pb-nav-safe pt-3 max-w-3xl mx-auto w-full">

        {/* Tab bar */}
        <div className="flex gap-1 mb-4 p-1 rounded-xl" style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)" }}>
          {([
            { id: "library", label: `Perpustakaan${kitabList.length > 0 ? ` (${kitabList.length})` : ""}`, icon: <BookOpen className="w-3.5 h-3.5" /> },
            { id: "upload",  label: "Upload Kitab", icon: <Upload className="w-3.5 h-3.5" /> },
            { id: "ask",     label: "Tanya AINA",   icon: <Sparkles className="w-3.5 h-3.5" /> },
          ] as { id: Tab; label: string; icon: React.ReactNode }[]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-semibold transition-all"
              style={{
                background: tab === t.id ? "rgba(139,92,246,0.25)" : "transparent",
                color: tab === t.id ? "#a78bfa" : "#6b7280",
                border: tab === t.id ? "1px solid rgba(139,92,246,0.4)" : "1px solid transparent",
              }}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {/* ── TAB: LIBRARY ──────────────────────────────────────────────── */}
        {tab === "library" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-slate-500">{kitabList.length} kitab tersimpan</p>
              <button onClick={fetchLibrary} disabled={libLoading} className="flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300">
                <RefreshCw className={`w-3 h-3 ${libLoading ? "animate-spin" : ""}`} /> Refresh
              </button>
            </div>

            {libLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
              </div>
            )}

            {!libLoading && kitabList.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-14 h-14 rounded-2xl bg-violet-900/30 border border-violet-800/40 flex items-center justify-center mb-3">
                  <BookOpen className="w-7 h-7 text-violet-600" />
                </div>
                <p className="text-sm text-slate-500 font-medium">Belum ada kitab</p>
                <p className="text-xs text-slate-600 mt-1">Upload muqarrar PDF di tab "Upload Kitab"</p>
                <button onClick={() => setTab("upload")}
                  className="mt-4 px-4 py-2 rounded-xl text-xs font-bold text-white"
                  style={{ background: "linear-gradient(135deg,#7c3aed,#5b21b6)" }}>
                  Upload Sekarang
                </button>
              </div>
            )}

            {kitabList.map(k => (
              <div key={k.kitab_id} className="rounded-xl p-4 border border-violet-900/30"
                style={{ background: "rgba(139,92,246,0.06)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-violet-900/40 border border-violet-700/30 flex items-center justify-center shrink-0 mt-0.5">
                      <BookOpen className="w-4.5 h-4.5 text-violet-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white leading-tight">{k.kitab_name}</p>
                      {k.author && <p className="text-[11px] text-slate-400 mt-0.5 italic">{k.author}</p>}
                      {k.description && (
                        <p className="text-[11px] text-slate-400/80 mt-1.5 leading-relaxed line-clamp-2">{k.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.3)" }}>
                          {k.total_pages} halaman
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {new Date(k.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => openReview(k)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
                      style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.3)" }}>
                      <Eye className="w-3 h-3" />Review
                    </button>
                    <button
                      onClick={() => { setSelectedKitab(k.kitab_id); setTab("ask"); }}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
                      style={{ background: "rgba(139,92,246,0.2)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.3)" }}>
                      <Sparkles className="w-3 h-3" />Tanya
                    </button>
                    <button
                      onClick={() => handleDelete(k)}
                      disabled={deletingId === k.kitab_id}
                      className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-900/20 transition-all disabled:opacity-50">
                      {deletingId === k.kitab_id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── TAB: UPLOAD ───────────────────────────────────────────────── */}
        {tab === "upload" && (
          <div className="space-y-4">
            {/* Info banner */}
            <div className="rounded-xl p-3 border border-violet-800/30" style={{ background: "rgba(109,40,217,0.07)" }}>
              <div className="flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-violet-300/80 leading-relaxed">
                  Upload PDF muqarrar/kitab. Sistem akan ekstrak teks per halaman, OCR halaman scan,
                  dan buat embedding untuk pencarian semantik. Setelah selesai, AINA bisa menjawab
                  dengan menyebut nomor halaman sumber.
                </p>
              </div>
            </div>

            {/* File drop zone */}
            <div>
              <label className="block text-xs text-slate-400 font-semibold mb-1.5">File PDF *</label>
              <label className="relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed cursor-pointer transition-all py-8 px-4 text-center"
                style={{
                  borderColor: file ? "rgba(139,92,246,0.6)" : "rgba(139,92,246,0.25)",
                  background: file ? "rgba(139,92,246,0.08)" : "rgba(139,92,246,0.03)",
                }}>
                <input ref={fileRef} type="file" accept=".pdf" className="sr-only"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setFile(f);
                      setScanResult(null);
                      setScanError("");
                      setShowAllChapters(false);
                    }
                  }} />
                {file ? (
                  <>
                    <FileText className="w-8 h-8 text-violet-400 mb-2" />
                    <p className="text-sm font-semibold text-violet-300">{file.name}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                    <button onClick={e => { e.preventDefault(); setFile(null); if (fileRef.current) fileRef.current.value = ""; }}
                      className="mt-2 text-[10px] text-slate-500 hover:text-red-400 flex items-center gap-1">
                      <X className="w-3 h-3" />Ganti file
                    </button>
                  </>
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-violet-600/50 mb-2" />
                    <p className="text-sm font-semibold text-slate-400">Klik atau drag PDF ke sini</p>
                    <p className="text-[11px] text-slate-600 mt-0.5">Muqarrar, kitab, modul — format PDF</p>
                  </>
                )}
              </label>
            </div>

            {/* ── Action buttons: Deteksi AI + Pra-Scan ─────────────────────── */}
            {file && !jobId && (
              <div className="space-y-2">
                {/* Deteksi AI — primary */}
                <button
                  onClick={handleDetect}
                  disabled={detectLoading || scanLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
                  style={{
                    background: detectLoading
                      ? "rgba(139,92,246,0.15)"
                      : "linear-gradient(135deg,rgba(124,58,237,0.35),rgba(109,40,217,0.25))",
                    border: "1px solid rgba(139,92,246,0.5)",
                    color: "#c4b5fd",
                  }}>
                  {detectLoading
                    ? <><Loader2 className="w-4 h-4 animate-spin" />AI sedang membaca PDF...</>
                    : <><Sparkles className="w-4 h-4" />Deteksi Otomatis dengan AI</>}
                </button>
                <p className="text-[10px] text-slate-500 text-center -mt-1">
                  AI baca halaman awal → auto-isi nama kitab, pengarang &amp; deskripsi
                </p>

                {/* Deteksi error */}
                {detectError && (
                  <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}>
                    <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    <p className="text-xs text-red-400">{detectError}</p>
                  </div>
                )}

                {/* Pra-Scan — secondary */}
                <button
                  onClick={handleScan}
                  disabled={scanLoading || detectLoading}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-50"
                  style={{
                    background: "rgba(139,92,246,0.07)",
                    border: "1px dashed rgba(139,92,246,0.25)",
                    color: "#7c6fad",
                  }}>
                  {scanLoading
                    ? <><Loader2 className="w-3 h-3 animate-spin" />Meng-scan...</>
                    : <><ScanLine className="w-3 h-3" />Pra-Scan Struktur (tanpa AI)</>}
                </button>
              </div>
            )}

            {/* Scan error */}
            {scanError && (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}>
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <p className="text-xs text-red-400">{scanError}</p>
              </div>
            )}

            {/* Scan result panel */}
            {scanResult && !jobId && (
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(139,92,246,0.3)" }}>
                {/* Header */}
                <div className="px-4 py-3 flex items-center gap-2" style={{ background: "rgba(109,40,217,0.15)" }}>
                  <ScanLine className="w-4 h-4 text-violet-400 shrink-0" />
                  <span className="text-xs font-bold text-violet-300">Hasil Pra-Scan PDF</span>
                  {scanResult.toc_source === "native" && (
                    <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "rgba(16,185,129,0.15)", color: "#34d399", border: "1px solid rgba(16,185,129,0.3)" }}>
                      Daftar Isi Native
                    </span>
                  )}
                  {scanResult.toc_source === "detected" && (
                    <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.3)" }}>
                      Deteksi Otomatis
                    </span>
                  )}
                  {scanResult.toc_source === "none" && (
                    <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "rgba(100,116,139,0.2)", color: "#94a3b8", border: "1px solid rgba(100,116,139,0.3)" }}>
                      Tidak Ada TOC
                    </span>
                  )}
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 divide-x" style={{ divideColor: "rgba(139,92,246,0.15)", background: "rgba(15,10,30,0.6)" }}>
                  <div className="px-3 py-3 text-center">
                    <Hash className="w-3.5 h-3.5 text-violet-400 mx-auto mb-1" />
                    <p className="text-lg font-bold text-white">{scanResult.pages_total}</p>
                    <p className="text-[10px] text-slate-500">Halaman</p>
                  </div>
                  <div className="px-3 py-3 text-center" style={{ borderLeft: "1px solid rgba(139,92,246,0.15)" }}>
                    <List className="w-3.5 h-3.5 text-violet-400 mx-auto mb-1" />
                    <p className="text-lg font-bold text-white">{scanResult.chapters_count}</p>
                    <p className="text-[10px] text-slate-500">Bab/Entri</p>
                  </div>
                  <div className="px-3 py-3 text-center" style={{ borderLeft: "1px solid rgba(139,92,246,0.15)" }}>
                    <BookOpen className="w-3.5 h-3.5 text-violet-400 mx-auto mb-1" />
                    <p className="text-lg font-bold text-white">
                      {scanResult.pages_total > 0
                        ? Math.round(scanResult.pages_total / Math.max(scanResult.chapters_count, 1))
                        : "-"}
                    </p>
                    <p className="text-[10px] text-slate-500">Hal/Bab rata²</p>
                  </div>
                </div>

                {/* Chapters list */}
                {scanResult.chapters.length > 0 && (
                  <div style={{ background: "rgba(10,5,25,0.7)" }}>
                    <div className="px-3 py-2 border-t" style={{ borderColor: "rgba(139,92,246,0.15)" }}>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Daftar Bab / Isi</p>
                    </div>
                    <div className="max-h-52 overflow-y-auto">
                      {(showAllChapters ? scanResult.chapters : scanResult.chapters.slice(0, 10)).map((ch, i) => (
                        <div key={i}
                          className="flex items-start gap-2 px-3 py-2 border-t"
                          style={{
                            borderColor: "rgba(139,92,246,0.08)",
                            paddingLeft: `${(ch.level - 1) * 12 + 12}px`,
                          }}>
                          <ChevronRight className="w-3 h-3 text-violet-600 shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] text-slate-300 leading-tight truncate" title={ch.title}>
                              {ch.title}
                            </p>
                            <p className="text-[10px] text-slate-600 mt-0.5">
                              Hal. {ch.page}
                              {ch.page_count > 0 ? ` · ${ch.page_count} hal` : ""}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                    {scanResult.chapters.length > 10 && (
                      <button
                        onClick={() => setShowAllChapters(v => !v)}
                        className="w-full py-2 text-[11px] text-violet-400 font-semibold hover:text-violet-300 transition-colors"
                        style={{ borderTop: "1px solid rgba(139,92,246,0.1)" }}>
                        {showAllChapters
                          ? "Tampilkan lebih sedikit ↑"
                          : `Tampilkan semua ${scanResult.chapters.length} entri ↓`}
                      </button>
                    )}
                  </div>
                )}

                {/* First page preview */}
                {scanResult.first_page_preview && (
                  <div className="px-3 py-3 border-t" style={{ borderColor: "rgba(139,92,246,0.12)", background: "rgba(10,5,25,0.5)" }}>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Preview Halaman 1</p>
                    <p className="text-[11px] text-slate-400 leading-relaxed whitespace-pre-wrap font-mono" style={{ maxHeight: 80, overflow: "hidden" }}>
                      {scanResult.first_page_preview}
                    </p>
                  </div>
                )}

                {scanResult.chapters.length === 0 && scanResult.toc_source !== "native" && (
                  <div className="px-3 py-3 text-center border-t" style={{ borderColor: "rgba(139,92,246,0.12)", background: "rgba(10,5,25,0.5)" }}>
                    <p className="text-[11px] text-slate-500">Tidak ada bab terdeteksi — kemungkinan PDF scan/gambar tanpa teks. OCR akan diaktifkan saat proses.</p>
                  </div>
                )}
              </div>
            )}

            {/* Kitab name */}
            <div>
              <label className="block text-xs text-slate-400 font-semibold mb-1.5">Nama Kitab / Muqarrar *</label>
              <input
                type="text"
                placeholder="cth: Fathul Qarib, Mabadi Fiqhiyyah Juz 1"
                value={kitabName}
                onChange={e => setKitabName(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none transition-all"
                style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.25)" }}
              />
            </div>

            {/* Author */}
            <div>
              <label className="block text-xs text-slate-400 font-semibold mb-1.5">Pengarang (opsional)</label>
              <input
                type="text"
                placeholder="cth: Syaikh Ibrahim Al-Bajuri"
                value={author}
                onChange={e => setAuthor(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none transition-all"
                style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.25)" }}
              />
            </div>

            {/* Description */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-slate-400 font-semibold">Deskripsi Kitab (opsional)</label>
                {description && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                    style={{ background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.25)" }}>
                    ✓ Terisi AI
                  </span>
                )}
              </div>
              <textarea
                rows={3}
                placeholder="Deskripsi singkat tentang isi dan tema kitab ini… atau klik 'Deteksi AI' di atas untuk auto-generate"
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none transition-all resize-none leading-relaxed"
                style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.25)" }}
              />
            </div>

            {/* OCR toggle */}
            <div className="flex items-center justify-between rounded-xl px-3 py-2.5"
              style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)" }}>
              <div>
                <p className="text-xs font-semibold text-slate-300">OCR Halaman Scan</p>
                <p className="text-[10px] text-slate-500">Halaman gambar akan di-OCR dengan GPT-4o Vision (lebih lambat)</p>
              </div>
              <button onClick={() => setUseOcr(!useOcr)}
                className="relative w-10 h-5 rounded-full transition-colors"
                style={{ background: useOcr ? "rgba(139,92,246,0.7)" : "rgba(75,85,99,0.5)" }}>
                <span className="absolute top-0.5 rounded-full w-4 h-4 bg-white transition-all shadow"
                  style={{ left: useOcr ? "calc(100% - 18px)" : "2px" }} />
              </button>
            </div>

            {uploadError && (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}>
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <p className="text-xs text-red-400">{uploadError}</p>
              </div>
            )}

            {/* Progress */}
            {jobId && jobStatus && (
              <div className="rounded-xl p-4 border"
                style={{
                  background: isDone ? "rgba(16,185,129,0.07)" : isError ? "rgba(239,68,68,0.07)" : "rgba(139,92,246,0.07)",
                  borderColor: isDone ? "rgba(16,185,129,0.3)" : isError ? "rgba(239,68,68,0.3)" : "rgba(139,92,246,0.3)",
                }}>
                <div className="flex items-center gap-2 mb-2">
                  {isDone
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    : isError
                      ? <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                      : <Loader2 className="w-4 h-4 text-violet-400 animate-spin shrink-0" />}
                  <span className="text-xs font-bold leading-tight" style={{ color: isDone ? "#34d399" : isError ? "#f87171" : "#a78bfa" }}>
                    {isDone
                      ? `Selesai! ${jobStatus.saved_count || jobStatus.pages_total} halaman tersimpan.`
                      : isError
                        ? `Error: ${jobStatus.error_msg}`
                        : jobStatus.phase
                          ? phaseLabel(jobStatus.phase)
                          : "Memulai proses..."}
                  </span>
                </div>

                {/* Phase detail */}
                {!isDone && !isError && jobStatus.phase === "extract" && (
                  <p className="text-[11px] text-slate-400 mb-2">
                    Halaman {jobStatus.current_page || "..."} / {jobStatus.pages_total || "..."}
                    {jobStatus.ocr_count > 0 && ` · ${jobStatus.ocr_count} halaman di-OCR`}
                  </p>
                )}
                {!isDone && !isError && jobStatus.phase === "embed" && (
                  <p className="text-[11px] text-slate-400 mb-2">
                    Membuat embedding batch — {jobStatus.phase_label}
                  </p>
                )}
                {!isDone && !isError && jobStatus.phase === "save" && (
                  <p className="text-[11px] text-slate-400 mb-2">
                    Menyimpan halaman {jobStatus.pages_done} / {jobStatus.pages_total}...
                  </p>
                )}

                {!isError && (
                  <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${isDone ? 100 : progressPct}%`,
                        background: isDone
                          ? "linear-gradient(90deg,#10b981,#34d399)"
                          : jobStatus.phase === "embed"
                            ? "linear-gradient(90deg,#f59e0b,#fbbf24)"
                            : jobStatus.phase === "save"
                              ? "linear-gradient(90deg,#3b82f6,#60a5fa)"
                              : "linear-gradient(90deg,#7c3aed,#a78bfa)",
                      }} />
                  </div>
                )}
                {!isError && (
                  <p className="text-[10px] text-slate-500 mt-1.5">
                    {isDone
                      ? `${jobStatus.ocr_count ? `${jobStatus.ocr_count} halaman OCR · ` : ""}Embedding batch selesai.`
                      : `${progressPct}%`}
                  </p>
                )}
                {jobStatus.errors?.length > 0 && (
                  <p className="text-[10px] text-amber-400 mt-1">{jobStatus.errors.length} halaman gagal simpan</p>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={handleUpload}
                disabled={!file || !kitabName.trim() || uploadLoading || dbExists === false}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg,#7c3aed,#5b21b6)", boxShadow: "0 0 20px rgba(124,58,237,0.35)" }}>
                {uploadLoading
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Memproses...</>
                  : <><Upload className="w-4 h-4" />Mulai Upload & Proses</>}
              </button>
              {(file || kitabName || jobId) && (
                <button onClick={resetUpload} className="px-4 py-3 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-300 transition-colors"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  Reset
                </button>
              )}
            </div>

            {dbExists === false && (
              <p className="text-[11px] text-amber-400 text-center">Selesaikan setup database terlebih dahulu di atas.</p>
            )}
          </div>
        )}

        {/* ── TAB: ASK ──────────────────────────────────────────────────── */}
        {tab === "ask" && (
          <div className="space-y-4">
            {kitabList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <BookOpen className="w-10 h-10 text-violet-700 mb-3" />
                <p className="text-sm text-slate-500">Belum ada kitab yang diupload.</p>
                <button onClick={() => setTab("upload")} className="mt-3 px-4 py-2 rounded-xl text-xs font-bold text-white"
                  style={{ background: "linear-gradient(135deg,#7c3aed,#5b21b6)" }}>
                  Upload Kitab
                </button>
              </div>
            ) : (
              <>
                {/* Kitab filter */}
                <div>
                  <label className="block text-xs text-slate-400 font-semibold mb-1.5">
                    Cari di kitab mana?
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setSelectedKitab("")}
                      className="px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-all"
                      style={{
                        background: !selectedKitab ? "rgba(139,92,246,0.25)" : "rgba(139,92,246,0.07)",
                        color: !selectedKitab ? "#a78bfa" : "#6b7280",
                        border: !selectedKitab ? "1px solid rgba(139,92,246,0.4)" : "1px solid rgba(139,92,246,0.15)",
                      }}>
                      Semua Kitab
                    </button>
                    {kitabList.map(k => (
                      <button key={k.kitab_id}
                        onClick={() => setSelectedKitab(k.kitab_id)}
                        className="px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-all"
                        style={{
                          background: selectedKitab === k.kitab_id ? "rgba(139,92,246,0.25)" : "rgba(139,92,246,0.07)",
                          color: selectedKitab === k.kitab_id ? "#a78bfa" : "#6b7280",
                          border: selectedKitab === k.kitab_id ? "1px solid rgba(139,92,246,0.4)" : "1px solid rgba(139,92,246,0.15)",
                        }}>
                        {k.kitab_name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Question input */}
                <div>
                  <label className="block text-xs text-slate-400 font-semibold mb-1.5">Pertanyaan</label>
                  <textarea
                    rows={3}
                    placeholder="cth: Apa hukum wudhu dengan air musta'mal? Sebutkan halamannya."
                    value={question}
                    onChange={e => setQuestion(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleAsk(); }}
                    className="w-full rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none resize-none transition-all"
                    style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.25)" }}
                  />
                  <p className="text-[10px] text-slate-600 mt-1">Ctrl+Enter untuk kirim</p>
                </div>

                <button
                  onClick={handleAsk}
                  disabled={!question.trim() || askLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm text-white transition-all disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg,#7c3aed,#5b21b6)", boxShadow: question.trim() && !askLoading ? "0 0 20px rgba(124,58,237,0.4)" : "none" }}>
                  {askLoading
                    ? <><Loader2 className="w-4 h-4 animate-spin" />AINA sedang mencari jawaban...</>
                    : <><Sparkles className="w-4 h-4" />Tanya AINA</>}
                </button>

                {askError && (
                  <div className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}>
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-400">{askError}</p>
                  </div>
                )}

                {/* Answer */}
                {answer && (
                  <div className="rounded-xl overflow-hidden border border-emerald-700/30"
                    style={{ background: "rgba(16,185,129,0.04)" }}>
                    {/* Answer header */}
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-emerald-700/20">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Jawaban AINA</span>
                      </div>
                      <button onClick={handleCopy}
                        className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all"
                        style={{
                          background: copied ? "rgba(16,185,129,0.2)" : "rgba(139,92,246,0.2)",
                          color: copied ? "#34d399" : "#a78bfa",
                          border: copied ? "1px solid rgba(16,185,129,0.4)" : "1px solid rgba(139,92,246,0.4)",
                        }}>
                        {copied ? <><Check className="w-3 h-3" />Tersalin!</> : <><Copy className="w-3 h-3" />Salin</>}
                      </button>
                    </div>

                    {/* Answer body */}
                    <div className="px-4 py-3">
                      <div className="prose prose-sm prose-invert max-w-none
                        prose-headings:font-bold prose-headings:text-slate-100 prose-headings:mt-4 prose-headings:mb-2
                        prose-h2:text-sm prose-h3:text-xs
                        prose-p:text-slate-300 prose-p:leading-[1.85] prose-p:my-2
                        prose-li:text-slate-300 prose-li:leading-relaxed
                        prose-ul:my-2 prose-ul:pl-4
                        prose-strong:text-white prose-strong:font-semibold
                        prose-blockquote:border-emerald-600 prose-blockquote:text-slate-400 prose-blockquote:italic
                        prose-code:text-emerald-300 prose-code:bg-emerald-900/20
                        prose-table:w-full prose-table:border-collapse prose-table:text-xs
                        prose-th:border prose-th:border-emerald-700/40 prose-th:px-2 prose-th:py-1.5 prose-th:text-emerald-300 prose-th:font-semibold prose-th:text-left
                        prose-td:border prose-td:border-slate-700/40 prose-td:px-2 prose-td:py-1.5 prose-td:text-slate-300">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                )}

                {/* Sources */}
                {sources.length > 0 && (
                  <div className="rounded-xl border border-violet-900/30" style={{ background: "rgba(139,92,246,0.04)" }}>
                    <button onClick={() => setShowSources(!showSources)}
                      className="w-full flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <BookOpen className="w-3.5 h-3.5 text-violet-400" />
                        <span className="text-[11px] font-bold text-violet-300">
                          Sumber Halaman ({sources.length} kutipan)
                        </span>
                      </div>
                      {showSources ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                    </button>
                    {showSources && (
                      <div className="px-4 pb-3 space-y-2">
                        {sources.map((s, i) => (
                          <div key={i} className="rounded-lg p-3 border border-violet-900/20"
                            style={{ background: "rgba(139,92,246,0.06)" }}>
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                                style={{ background: "rgba(139,92,246,0.2)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.3)" }}>
                                Hal. {s.page}
                              </span>
                              {s.chapter && (
                                <span className="text-[10px] text-slate-400 font-medium">{s.chapter}</span>
                              )}
                              <span className="text-[10px] text-slate-500 ml-auto">
                                Relevansi: {Math.round(s.score * 100)}%
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-3">{s.excerpt}</p>
                            <p className="text-[10px] text-slate-600 mt-1 font-medium">
                              {s.kitab_name}{s.author ? ` — ${s.author}` : ""}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── TAB: REVIEW ───────────────────────────────────────────────── */}
        {tab === "review" && reviewKitab && (
          <div className="space-y-3">
            {/* Header review */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setTab("library")}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors shrink-0">
                <ChevronLeft className="w-4 h-4 text-slate-400" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-white truncate">{reviewKitab.kitab_name}</p>
                {reviewKitab.author && (
                  <p className="text-[10px] text-slate-500 italic truncate">{reviewKitab.author}</p>
                )}
              </div>
              {!reviewLoading && reviewPages.length > 0 && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                  style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.3)" }}>
                  {reviewPages.length} halaman
                </span>
              )}
            </div>

            {/* Loading */}
            {reviewLoading && (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
              </div>
            )}

            {/* Error */}
            {reviewError && !reviewLoading && (
              <div className="flex items-center gap-2 rounded-xl px-3 py-3"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}>
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <p className="text-xs text-red-400">{reviewError}</p>
              </div>
            )}

            {/* Navigator halaman */}
            {!reviewLoading && reviewPages.length > 0 && (() => {
              const page = reviewPages[activePageIdx];
              return (
                <div className="space-y-3">
                  {/* Prev/Next nav */}
                  <div className="flex items-center gap-2">
                    <button
                      disabled={activePageIdx === 0}
                      onClick={() => setActivePageIdx(i => i - 1)}
                      className="p-2 rounded-lg transition-all disabled:opacity-30"
                      style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)" }}>
                      <ChevronLeft className="w-4 h-4 text-violet-400" />
                    </button>
                    <div className="flex-1 text-center">
                      <span className="text-xs font-bold text-white">Hal. {page.page_number}</span>
                      <span className="text-[10px] text-slate-500 ml-1">/ {reviewPages[reviewPages.length - 1].page_number}</span>
                    </div>
                    <button
                      disabled={activePageIdx === reviewPages.length - 1}
                      onClick={() => setActivePageIdx(i => i + 1)}
                      className="p-2 rounded-lg transition-all disabled:opacity-30"
                      style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)" }}>
                      <ChevronRight className="w-4 h-4 text-violet-400" />
                    </button>
                  </div>

                  {/* Jump to page */}
                  <div className="flex gap-1.5 flex-wrap">
                    {reviewPages.map((p, i) => (
                      <button
                        key={i}
                        onClick={() => setActivePageIdx(i)}
                        className="min-w-[2rem] px-1.5 py-1 rounded-lg text-[10px] font-bold transition-all"
                        style={{
                          background: i === activePageIdx ? "rgba(139,92,246,0.35)" : "rgba(139,92,246,0.07)",
                          color: i === activePageIdx ? "#c4b5fd" : "#4b5563",
                          border: i === activePageIdx ? "1px solid rgba(139,92,246,0.5)" : "1px solid transparent",
                        }}>
                        {p.page_number}
                      </button>
                    ))}
                  </div>

                  {/* Konten halaman */}
                  <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(139,92,246,0.25)" }}>
                    {/* Page header */}
                    <div className="flex items-center gap-2 px-3 py-2.5 flex-wrap"
                      style={{ background: "rgba(109,40,217,0.12)", borderBottom: "1px solid rgba(139,92,246,0.15)" }}>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(139,92,246,0.25)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.4)" }}>
                        Hal. {page.page_number}
                      </span>
                      {page.chapter && (
                        <span className="text-[11px] text-slate-300 font-medium">{page.chapter}</span>
                      )}
                      <div className="ml-auto flex items-center gap-1.5">
                        {page.is_ocr && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                            style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.3)" }}>
                            OCR
                          </span>
                        )}
                        <span className="text-[10px] text-slate-600">{page.word_count} kata</span>
                      </div>
                    </div>

                    {/* Page content */}
                    <div className="px-4 py-4" style={{ background: "rgba(10,5,25,0.7)" }}>
                      <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap font-mono"
                        style={{ fontSize: "12px", lineHeight: "1.7" }}>
                        {page.content || <span className="text-slate-600 italic">Halaman ini kosong.</span>}
                      </p>
                    </div>
                  </div>

                  {/* Tanya tentang halaman ini */}
                  <button
                    onClick={() => {
                      setSelectedKitab(reviewKitab.kitab_id);
                      setQuestion(`Jelaskan isi halaman ${page.page_number} dari kitab ${reviewKitab.kitab_name}.`);
                      setTab("ask");
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition-all"
                    style={{ background: "rgba(139,92,246,0.1)", border: "1px dashed rgba(139,92,246,0.3)", color: "#7c6fad" }}>
                    <Sparkles className="w-3.5 h-3.5" />
                    Tanya AINA tentang halaman ini
                  </button>
                </div>
              );
            })()}

            {/* Empty */}
            {!reviewLoading && !reviewError && reviewPages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <BookOpen className="w-10 h-10 text-violet-800 mb-3" />
                <p className="text-sm text-slate-500">Tidak ada halaman ditemukan.</p>
              </div>
            )}
          </div>
        )}
      </main>

      <BottomNav active="home" />
    </div>
  );
}
