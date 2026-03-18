"use client";

import { useState, useRef, useCallback } from "react";
import type { VerifiedSession } from "@/app/page";
import type {
  PieceImageType,
  LocalPhoto,
  GroupedItem,
  UploadImageResponse,
  SubmitResponse,
} from "@/types/upload";

interface Props {
  session: VerifiedSession;
  onComplete: (result: { itemCount: number; photoCount: number }) => void;
  onBack: () => void;
}

type Stage = "upload" | "processing" | "review";

function resizeImage(file: File, maxDim = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("No canvas"));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.7).split(",")[1]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Load failed"));
    };
    img.src = url;
  });
}

export default function UploadPage({ session, onComplete, onBack }: Props) {
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [items, setItems] = useState<GroupedItem[]>([]);
  const [stage, setStage] = useState<Stage>("upload");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addPhotos = useCallback((files: FileList | File[]) => {
    const newPhotos: LocalPhoto[] = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      }));
    setPhotos((prev) => [...prev, ...newPhotos]);
  }, []);

  const removePhoto = useCallback((id: string) => {
    setPhotos((prev) => {
      const p = prev.find((x) => x.id === id);
      if (p) URL.revokeObjectURL(p.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  const updatePhotoType = useCallback(
    (itemId: string, localPhotoId: string, newType: PieceImageType) => {
      setItems((prev) =>
        prev.map((item) =>
          item.id === itemId
            ? {
                ...item,
                photos: item.photos.map((p) =>
                  p.localPhotoId === localPhotoId ? { ...p, imageType: newType } : p
                ),
              }
            : item
        )
      );
    },
    []
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = e.dataTransfer.files;
      if (files.length > 0) addPhotos(files);
    },
    [addPhotos]
  );

  const handleAutoGroup = async () => {
    if (photos.length === 0) return;
    if (photos.length > 99) {
      setError("Maximum 99 photos. Remove some and try again.");
      return;
    }
    setStage("processing");
    setStatus("Analyzing photos...");
    setError("");

    const BATCH_SIZE = 50;

    try {
      const inputs = await Promise.all(
        photos.map(async (p) => ({
          id: p.id,
          base64: await resizeImage(p.file),
          mimeType: "image/jpeg",
          fileName: p.file.name,
        }))
      );

      const allItems: GroupedItem[] = [];
      for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
        const batch = inputs.slice(i, i + BATCH_SIZE);
        setStatus(`Analyzing photos ${i + 1}–${Math.min(i + BATCH_SIZE, inputs.length)} of ${inputs.length}...`);
        const res = await fetch("/api/auto-group", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photos: batch }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || err.details || "Grouping failed");
        }
        const data = await res.json();
        const batchItems = data.groups.map(
          (g: { photos: { photoId: string; imageType: PieceImageType }[] }) => ({
            id: crypto.randomUUID(),
            photos: g.photos.map((p) => ({ localPhotoId: p.photoId, imageType: p.imageType })),
          })
        );
        allItems.push(...batchItems);
      }
      setItems(allItems);
      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setStage("upload");
    }
  };

  const handleSubmit = async () => {
    const validItems = items.filter((i) => i.photos.length > 0);
    if (validItems.length === 0) return;
    setStage("processing");
    setStatus("Uploading...");
    setError("");

    try {
      const uploads = new Map<string, UploadImageResponse>();

      for (const entry of validItems.flatMap((i) => i.photos)) {
        const photo = photos.find((p) => p.id === entry.localPhotoId);
        if (!photo) continue;
        const form = new FormData();
        form.append("file", photo.file);
        const res = await fetch("/api/upload-image", { method: "POST", body: form });
        if (!res.ok) throw new Error("Upload failed");
        uploads.set(entry.localPhotoId, await res.json());
      }

      setStatus("Submitting...");

      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskRabbitId: session.taskRabbitId,
          items: validItems.map((item) => ({
            photos: item.photos.map((p, i) => {
              const u = uploads.get(p.localPhotoId)!;
              const isMain = item.photos.length === 1 || (p.imageType === "FRONT" && i === item.photos.findIndex((x) => x.imageType === "FRONT"));
              return { ...u, imageType: p.imageType, isMainImage: isMain };
            }),
          })),
        }),
      });

      if (!res.ok) throw new Error((await res.json()).error || "Submit failed");
      const data: SubmitResponse = await res.json();
      onComplete({ itemCount: data.itemCount, photoCount: data.photoCount });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setStage("review");
    }
  };

  /* ── Processing ──────────────────────────────────────────── */
  if (stage === "processing") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F9F9F7]">
        <div className="text-center">
          <div className="logo-breath mb-8">
            <img src="/logo.png" alt="Fitted" className="h-7 mx-auto" />
          </div>
          <div className="flex items-center justify-center gap-1.5 mb-5">
            <span className="dot-1 w-1.5 h-1.5 bg-[#0D0D0D] rounded-full inline-block" />
            <span className="dot-2 w-1.5 h-1.5 bg-[#0D0D0D] rounded-full inline-block" />
            <span className="dot-3 w-1.5 h-1.5 bg-[#0D0D0D] rounded-full inline-block" />
          </div>
          <p className="text-[13px] text-[#8C8C8C] max-w-[200px] mx-auto leading-relaxed">{status}</p>
        </div>
      </div>
    );
  }

  /* ── Review ──────────────────────────────────────────────── */
  if (stage === "review") {
    const validItems = items.filter((i) => i.photos.length > 0);

    return (
      <div className="min-h-screen bg-[#F9F9F7] flex flex-col">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-[#E8E8E5] px-4 py-3.5 flex items-center justify-between">
          <button
            onClick={() => setStage("upload")}
            className="flex items-center gap-1.5 text-[13px] text-[#8C8C8C] hover:text-[#0D0D0D] transition-colors font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <span className="text-[12px] font-mono text-[#8C8C8C] tracking-wider bg-[#F2F2EF] px-2.5 py-1 rounded-full">
            {session.taskRabbitId}
          </span>
        </header>

        <main className="flex-1 w-full max-w-2xl mx-auto px-4 pt-6 pb-28">
          <div className="mb-6">
            <h2 className="font-display text-[22px] font-bold text-[#0D0D0D] tracking-tight">
              Review {validItems.length} items
            </h2>
            <p className="text-[13px] text-[#9A9A94] mt-1">
              Adjust photo labels if needed, then submit
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {items.map((item, idx) => {
              if (item.photos.length === 0) return null;
              return (
                <div
                  key={item.id}
                  className="bg-white rounded-2xl border border-[#E8E8E5] overflow-hidden"
                >
                  {/* Card header */}
                  <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#F0F0EE]">
                    <span className="text-[11px] font-bold text-[#0D0D0D] tracking-widest uppercase">
                      {idx + 1}
                    </span>
                    <button
                      onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                      className="w-5 h-5 flex items-center justify-center rounded-full text-[#BCBCB6] hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Photos */}
                  <div className={`p-2 grid gap-1.5 ${item.photos.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                    {item.photos.map((p) => {
                      const photo = photos.find((x) => x.id === p.localPhotoId);
                      if (!photo) return null;
                      return (
                        <div key={p.localPhotoId}>
                          {/* Photo thumbnail */}
                          <div className="aspect-[3/4] rounded-xl overflow-hidden bg-[#F2F2EF]">
                            <img
                              src={photo.previewUrl}
                              className="w-full h-full object-cover"
                              alt=""
                            />
                          </div>
                          {/* Type pill selectors */}
                          <div className="flex gap-1 mt-1.5">
                            {(["FRONT", "BACK", "TAG"] as PieceImageType[]).map((type) => (
                              <button
                                key={type}
                                onClick={() => updatePhotoType(item.id, p.localPhotoId, type)}
                                className={`flex-1 py-1 text-[10px] font-bold rounded-lg transition-all duration-100 ${
                                  p.imageType === type
                                    ? "bg-[#0D0D0D] text-white"
                                    : "bg-[#F2F2EF] text-[#9A9A94] hover:bg-[#E8E8E5]"
                                }`}
                              >
                                {type === "FRONT" ? "F" : type === "BACK" ? "B" : "T"}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {error && (
            <p className="mt-5 text-[13px] text-red-500 text-center font-medium">{error}</p>
          )}
        </main>

        {/* Submit footer */}
        <footer className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-[#E8E8E5] p-4 flex justify-center">
          <div className="w-full max-w-2xl">
            <button
              onClick={handleSubmit}
              disabled={validItems.length === 0}
              className="w-full h-14 bg-[#0D0D0D] text-white font-medium rounded-2xl disabled:opacity-30 hover:bg-black active:scale-[0.99] transition-all text-[15px] tracking-[-0.01em]"
            >
              Submit {validItems.length} item{validItems.length !== 1 ? "s" : ""} to Fitted
            </button>
          </div>
        </footer>
      </div>
    );
  }

  /* ── Upload ──────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-[#F9F9F7] flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-[#E8E8E5] px-4 py-3.5 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[13px] text-[#8C8C8C] hover:text-[#0D0D0D] transition-colors font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <span className="text-[12px] font-mono text-[#8C8C8C] tracking-wider bg-[#F2F2EF] px-2.5 py-1 rounded-full">
          {session.taskRabbitId}
        </span>
      </header>

      <main className={`flex-1 w-full max-w-2xl mx-auto px-4 pt-6 ${photos.length > 0 ? "pb-28" : "pb-8"}`}>

        {/* Page title */}
        <div className="mb-6">
          <h2 className="font-display text-[22px] font-bold text-[#0D0D0D] tracking-tight">
            Upload photos
          </h2>
          <p className="text-[13px] text-[#9A9A94] mt-1">
            Upload in order for best AI grouping · max 99
          </p>
        </div>

        {/* Drop zone — shown when no photos yet */}
        {photos.length === 0 && (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-3xl border-2 border-dashed transition-all duration-200 flex flex-col items-center justify-center min-h-[280px] sm:min-h-[360px] select-none ${
              isDragging
                ? "border-[#0D0D0D] bg-[#0D0D0D]/[0.04] scale-[1.005]"
                : "border-[#DEDED9] hover:border-[#B0B0A8] hover:bg-white/80"
            }`}
          >
            <div className="text-center px-6 py-10">
              <div
                className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5 transition-colors ${
                  isDragging ? "bg-[#0D0D0D]" : "bg-[#EDEDEA]"
                }`}
              >
                <svg
                  className={`w-6 h-6 transition-colors ${isDragging ? "text-white" : "text-[#9A9A94]"}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <p className={`font-semibold text-[15px] mb-1.5 transition-colors ${isDragging ? "text-[#0D0D0D]" : "text-[#5A5A55]"}`}>
                {isDragging ? "Drop to add photos" : "Select photos"}
              </p>
              <p className="text-[13px] text-[#B0B0A8]">
                Tap to browse · Drag & drop on desktop
              </p>
            </div>
          </div>
        )}

        {/* Photo grid */}
        {photos.length > 0 && (
          <div>
            {/* Grid toolbar */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-[#0D0D0D]">
                  {photos.length}
                </span>
                <span className="text-[13px] text-[#9A9A94]">
                  photo{photos.length !== 1 ? "s" : ""}
                </span>
              </div>
              <button
                onClick={() => {
                  photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
                  setPhotos([]);
                }}
                className="text-[12px] text-[#B0B0A8] hover:text-red-500 transition-colors font-medium"
              >
                Clear all
              </button>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {photos.map((p) => (
                <div key={p.id} className="relative aspect-square rounded-xl overflow-hidden bg-[#EDEDEA] group">
                  <img src={p.previewUrl} className="w-full h-full object-cover" alt="" />
                  {/* Remove button — always visible on mobile, hover on desktop */}
                  <button
                    onClick={() => removePhoto(p.id)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/55 hover:bg-black rounded-full flex items-center justify-center transition-all opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                    aria-label="Remove photo"
                  >
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}

              {/* Add more tile */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`aspect-square rounded-xl border-2 border-dashed transition-all cursor-pointer flex items-center justify-center ${
                  isDragging
                    ? "border-[#0D0D0D] bg-[#0D0D0D]/[0.05]"
                    : "border-[#DEDED9] hover:border-[#B0B0A8] hover:bg-white/60"
                }`}
              >
                <svg className="w-5 h-5 text-[#C0C0BB]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </div>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-5 text-[13px] text-red-500 text-center font-medium">{error}</p>
        )}
      </main>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && addPhotos(e.target.files)}
      />

      {/* Continue footer */}
      {photos.length > 0 && (
        <footer className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-[#E8E8E5] p-4 flex justify-center">
          <div className="w-full max-w-2xl">
            <button
              onClick={handleAutoGroup}
              className="w-full h-14 bg-[#0D0D0D] text-white font-medium rounded-2xl hover:bg-black active:scale-[0.99] transition-all text-[15px] tracking-[-0.01em]"
            >
              Continue with {photos.length} photo{photos.length !== 1 ? "s" : ""}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
