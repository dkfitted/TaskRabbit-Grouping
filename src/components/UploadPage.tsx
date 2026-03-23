"use client";

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
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

const IMAGE_TYPE_OPTIONS: { value: PieceImageType; label: string }[] = [
  { value: "FRONT", label: "Front" },
  { value: "BACK", label: "Back" },
  { value: "TAG", label: "Tag" },
];

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error === "string" && body.error.trim()) return body.error;
    if (typeof body?.details === "string" && body.details.trim()) return body.details;
    return fallback;
  } catch {
    try {
      const text = await res.text();
      return text?.trim() ? text : fallback;
    } catch {
      return fallback;
    }
  }
}

function resizeImage(file: File, maxDim = 768): Promise<string> {
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
  const MAX_PHOTOS_PER_BATCH = 50;
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [standbyPhotos, setStandbyPhotos] = useState<LocalPhoto[]>([]);
  const [items, setItems] = useState<GroupedItem[]>([]);
  const [stage, setStage] = useState<Stage>("upload");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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
    setNotice("");
  }, []);

  const removePhoto = useCallback((id: string) => {
    setPhotos((prev) => {
      const p = prev.find((x) => x.id === id);
      if (p) URL.revokeObjectURL(p.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  const handleAutoGroup = async () => {
    if (photos.length === 0) return;
    const activePhotos = photos.slice(0, MAX_PHOTOS_PER_BATCH);
    const overflowPhotos = photos.slice(MAX_PHOTOS_PER_BATCH);

    setStage("processing");
    setStatus("Analyzing photos...");
    setError("");

    const BATCH_SIZE = 50;

    try {
      const inputs = await Promise.all(
        activePhotos.map(async (p) => ({
          id: p.id,
          base64: await resizeImage(p.file),
          mimeType: "image/jpeg",
          fileName: p.file.name,
        }))
      );

      const allItems: GroupedItem[] = [];
      for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
        const batch = inputs.slice(i, i + BATCH_SIZE);
        setStatus(`Analyzing photos ${i + 1}\u2013${Math.min(i + BATCH_SIZE, inputs.length)} of ${inputs.length}...`);
        const res = await fetch("/api/auto-group", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photos: batch }),
        });
        if (!res.ok) {
          throw new Error(await readErrorMessage(res, "Grouping failed"));
        }
        let data: { groups: { photos: { photoId: string; imageType: PieceImageType }[] }[] };
        try {
          data = await res.json();
        } catch {
          throw new Error("Invalid grouping response");
        }
        const batchItems = data.groups.map(
          (g: { photos: { photoId: string; imageType: PieceImageType }[] }) => ({
            id: crypto.randomUUID(),
            photos: g.photos.map((p) => ({ localPhotoId: p.photoId, imageType: p.imageType })),
          })
        );
        allItems.push(...batchItems);
      }

      if (overflowPhotos.length > 0) {
        setPhotos(activePhotos);
        setStandbyPhotos((prev) => [...prev, ...overflowPhotos]);
        setNotice(
          `${overflowPhotos.length} photos moved to standby. Submit this batch to continue with the next one.`
        );
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
        if (!res.ok) throw new Error(await readErrorMessage(res, "Upload failed"));
        try {
          uploads.set(entry.localPhotoId, await res.json());
        } catch {
          throw new Error("Invalid upload response");
        }
      }

      const submitItems = validItems.map((item) => ({
        photos: item.photos.map((p, i) => {
          const u = uploads.get(p.localPhotoId)!;
          const isMain = item.photos.length === 1 || (p.imageType === "FRONT" && i === item.photos.findIndex((x) => x.imageType === "FRONT"));
          return { ...u, imageType: p.imageType, isMainImage: isMain };
        }),
      }));

      const SUBMIT_BATCH_SIZE = 12;
      const totalBatches = Math.ceil(submitItems.length / SUBMIT_BATCH_SIZE);
      let totalSubmittedItems = 0;
      let totalSubmittedPhotos = 0;

      for (let i = 0; i < submitItems.length; i += SUBMIT_BATCH_SIZE) {
        const batchIndex = Math.floor(i / SUBMIT_BATCH_SIZE);
        const batchItems = submitItems.slice(i, i + SUBMIT_BATCH_SIZE);
        setStatus(`Submitting batch ${batchIndex + 1} of ${totalBatches}...`);

        const res = await fetch("/api/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskRabbitId: session.taskRabbitId,
            items: batchItems,
            batchIndex,
            batchTotal: totalBatches,
          }),
        });

        if (!res.ok) throw new Error(await readErrorMessage(res, "Submit failed"));
        let data: SubmitResponse;
        try {
          data = await res.json();
        } catch {
          throw new Error("Invalid submit response");
        }
        totalSubmittedItems += data.itemCount;
        totalSubmittedPhotos += data.photoCount;
      }

      if (standbyPhotos.length > 0) {
        const nextBatch = standbyPhotos.slice(0, MAX_PHOTOS_PER_BATCH);
        const remainingStandby = standbyPhotos.slice(MAX_PHOTOS_PER_BATCH);
        setPhotos(nextBatch);
        setStandbyPhotos(remainingStandby);
        setItems([]);
        setStage("upload");
        setNotice(
          `${standbyPhotos.length} standby photos remaining. Next batch is ready to auto-group.`
        );
        return;
      }

      onComplete({ itemCount: totalSubmittedItems, photoCount: totalSubmittedPhotos });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setStage("review");
    }
  };

  // ─── Processing state ───
  if (stage === "processing") {
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center bg-white">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col items-center px-6"
        >
          <div className="w-12 h-12 border-[3px] border-gray-200 border-t-black rounded-full animate-spin mb-5" />
          <p className="text-base font-medium text-gray-700 text-center">{status}</p>
        </motion.div>
      </div>
    );
  }

  // ─── Review state ───
  if (stage === "review") {
    const validItems = items.filter((i) => i.photos.length > 0);
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center">
        <header className="sticky top-0 z-10 w-full bg-white/95 backdrop-blur-sm border-b border-gray-100">
          <div className="max-w-lg mx-auto px-6 py-3 flex items-center justify-between">
            <button
              onClick={() => setStage("upload")}
              className="w-10 h-10 -ml-2 flex items-center justify-center rounded-xl active:bg-gray-100 transition-colors"
              aria-label="Back"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-xs font-mono text-gray-400 bg-gray-50 px-3 py-1 rounded-full">{session.taskRabbitId}</span>
          </div>
        </header>

        <main className="flex-1 w-full max-w-lg px-6 pt-5 pb-28">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <h2 className="text-xl font-bold mb-1">Review {validItems.length} {validItems.length === 1 ? "item" : "items"}</h2>
            <p className="text-sm text-gray-400 mb-5">Tap labels to adjust, then submit</p>

            <div className="space-y-4">
              {items.map((item, idx) => {
                if (item.photos.length === 0) return null;
                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: idx * 0.05 }}
                    className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
                  >
                    <div className="px-4 py-3 flex justify-between items-center">
                      <span className="text-sm font-semibold">Item {idx + 1}</span>
                      <button
                        onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                        className="text-xs font-medium text-gray-400 hover:text-red-500 active:text-red-600 transition-colors px-2 py-1 -mr-2 rounded-lg"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="px-4 pb-4 space-y-3">
                      {item.photos.map((p) => {
                        const photo = photos.find((x) => x.id === p.localPhotoId);
                        if (!photo) return null;
                        return (
                          <div key={p.localPhotoId} className="flex items-center gap-3">
                            <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100">
                              <img src={photo.previewUrl} className="w-full h-full object-cover" alt="" />
                            </div>
                            <div className="flex gap-1.5 flex-1">
                              {IMAGE_TYPE_OPTIONS.map((opt) => (
                                <button
                                  key={opt.value}
                                  onClick={() => {
                                    setItems((prev) =>
                                      prev.map((i) =>
                                        i.id === item.id
                                          ? { ...i, photos: i.photos.map((x) => (x.localPhotoId === p.localPhotoId ? { ...x, imageType: opt.value } : x)) }
                                          : i
                                      )
                                    );
                                  }}
                                  className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                                    p.imageType === opt.value
                                      ? "bg-black text-white"
                                      : "bg-gray-100 text-gray-500 active:bg-gray-200"
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {error && (
              <div className="mt-4 p-3 bg-red-50 rounded-xl">
                <p className="text-sm text-red-600 text-center font-medium">{error}</p>
              </div>
            )}
          </motion.div>
        </main>

        <footer className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur-sm border-t border-gray-100 pb-safe-footer flex justify-center">
          <div className="w-full max-w-lg px-8 pt-4">
            <button
              onClick={handleSubmit}
              disabled={validItems.length === 0}
              className="w-full h-14 bg-black text-white text-base font-semibold rounded-xl disabled:opacity-30 active:scale-[0.98] transition-all"
            >
              Submit {validItems.length} {validItems.length === 1 ? "item" : "items"} to Fitted
            </button>
          </div>
        </footer>
      </div>
    );
  }

  // ─── Upload state (default) ───

  const headerEl = (
    <header className="sticky top-0 z-10 w-full bg-white/95 backdrop-blur-sm border-b border-gray-100">
      <div className="max-w-lg mx-auto px-6 py-3 flex items-center justify-between">
        <button
          onClick={onBack}
          className="w-10 h-10 -ml-2 flex items-center justify-center rounded-xl active:bg-gray-100 transition-colors"
          aria-label="Back"
        >
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xs font-mono text-gray-400 bg-gray-50 px-3 py-1 rounded-full">{session.taskRabbitId}</span>
      </div>
    </header>
  );

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      multiple
      className="hidden"
      onChange={(e) => e.target.files && addPhotos(e.target.files)}
    />
  );

  if (photos.length === 0) {
    return (
      <div className="h-[100dvh] bg-white flex flex-col items-center">
        {headerEl}
        {fileInput}

        {notice && (
          <div className="mx-6 mt-4 p-3 bg-amber-50 border border-amber-100 rounded-xl max-w-lg w-full">
            <p className="text-xs text-amber-700 text-center font-medium">{notice}</p>
          </div>
        )}

        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          onClick={() => fileInputRef.current?.click()}
          className="flex-1 flex flex-col items-center justify-center active:bg-gray-50 transition-colors"
        >
          <div className="w-20 h-20 bg-gray-100 rounded-3xl flex items-center justify-center mb-5">
            <svg className="w-9 h-9 text-gray-400" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <span className="text-xl font-bold text-gray-800 mb-2">Add photos</span>
          <p className="text-sm text-gray-400">Tap to select from camera roll</p>
          <p className="text-xs text-gray-300 mt-1">
            Up to 99 per batch &middot; Upload in sequence for better grouping
          </p>
        </motion.button>

        {error && (
          <div className="mx-4 mb-4 p-3 bg-red-50 rounded-xl">
            <p className="text-sm text-red-600 text-center font-medium">{error}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center">
      <header className="sticky top-0 z-10 w-full bg-white/95 backdrop-blur-sm border-b border-gray-100">
        <div className="max-w-lg mx-auto px-6 py-3 flex items-center justify-between">
          <button
            onClick={onBack}
            className="w-10 h-10 -ml-2 flex items-center justify-center rounded-xl active:bg-gray-100 transition-colors"
            aria-label="Back"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-xs font-mono text-gray-400 bg-gray-50 px-3 py-1 rounded-full">{session.taskRabbitId}</span>
        </div>
      </header>
      {fileInput}

      <main className="flex-1 w-full max-w-lg px-6 pt-5 pb-28">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          {notice && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-100 rounded-xl">
              <p className="text-xs text-amber-700 text-center font-medium">{notice}</p>
            </div>
          )}

          <h2 className="text-xl font-bold text-center mb-1">Add photos</h2>
          <p className="text-sm text-gray-400 text-center mb-5">Upload all clothing photos</p>

          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">
                {photos.length} {photos.length === 1 ? "photo" : "photos"}
              </span>
              {standbyPhotos.length > 0 && (
                <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium">
                  +{standbyPhotos.length} standby
                </span>
              )}
            </div>
            <button
              onClick={() => {
                photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
                standbyPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
                setPhotos([]);
                setStandbyPhotos([]);
                setNotice("");
              }}
              className="text-xs font-medium text-gray-400 active:text-red-500 px-2 py-1 -mr-2 rounded-lg transition-colors"
            >
              Clear all
            </button>
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full h-12 flex items-center justify-center gap-2 bg-gray-50 border border-gray-200 rounded-xl active:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-sm font-semibold text-gray-600">Add more</span>
          </button>

          <div style={{ height: 32 }} />

          <div className="grid grid-cols-3 gap-3">
            <AnimatePresence>
              {photos.map((p) => (
                <motion.div
                  key={p.id}
                  layout
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.2 }}
                  className="relative aspect-square rounded-xl overflow-hidden bg-gray-100"
                >
                  <img src={p.previewUrl} className="w-full h-full object-cover" alt="" />
                  <button
                    onClick={() => removePhoto(p.id)}
                    className="absolute top-1.5 right-1.5 w-7 h-7 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center active:bg-black/70 transition-colors"
                    aria-label="Remove photo"
                  >
                    <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-50 rounded-xl">
              <p className="text-sm text-red-600 text-center font-medium">{error}</p>
            </div>
          )}
        </motion.div>
      </main>

      {photos.length > 0 && (
        <footer className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur-sm border-t border-gray-100 pb-safe-footer flex justify-center">
          <div className="w-full max-w-lg px-8 pt-4">
            <button
              onClick={handleAutoGroup}
              className="w-full h-14 bg-black text-white text-base font-semibold rounded-xl active:scale-[0.98] transition-all"
            >
              Continue with {photos.length} {photos.length === 1 ? "photo" : "photos"}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
