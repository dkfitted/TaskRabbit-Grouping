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

type Stage = "upload" | "grouping" | "review" | "submitting";

const AUTO_GROUP_BATCH_SIZE = 50;

function resizeImage(file: File, maxDim = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error(`No canvas context`));
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      resolve(dataUrl.split(",")[1]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load image`));
    };
    img.src = url;
  });
}

export default function UploadPage({ session, onComplete, onBack }: Props) {
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [items, setItems] = useState<GroupedItem[]>([]);
  const [stage, setStage] = useState<Stage>("upload");
  const [progress, setProgress] = useState({ current: 0, total: 0, message: "" });
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

  const removePhoto = useCallback((photoId: string) => {
    setPhotos((prev) => {
      const photo = prev.find((p) => p.id === photoId);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      return prev.filter((p) => p.id !== photoId);
    });
  }, []);

  const handleAutoGroup = async () => {
    if (photos.length === 0) return;

    setStage("grouping");
    setProgress({ current: 0, total: photos.length, message: "Preparing..." });
    setError("");

    try {
      const results = await Promise.allSettled(
        photos.map(async (photo, i) => {
          const base64 = await resizeImage(photo.file, 512);
          setProgress((p) => ({ ...p, current: i + 1 }));
          return {
            id: photo.id,
            base64,
            mimeType: "image/jpeg",
            fileName: photo.file.name,
          };
        })
      );

      type PhotoInput = { id: string; base64: string; mimeType: string; fileName: string };
      const photoInputs: PhotoInput[] = results
        .filter((r): r is PromiseFulfilledResult<PhotoInput> => r.status === "fulfilled")
        .map((r) => r.value);

      if (photoInputs.length === 0) {
        throw new Error("No photos could be processed");
      }

      const batches: typeof photoInputs[] = [];
      for (let i = 0; i < photoInputs.length; i += AUTO_GROUP_BATCH_SIZE) {
        batches.push(photoInputs.slice(i, i + AUTO_GROUP_BATCH_SIZE));
      }

      setProgress({ current: 0, total: batches.length, message: "Analyzing..." });

      const allItems: GroupedItem[] = [];

      for (let i = 0; i < batches.length; i++) {
        setProgress({ 
          current: i + 1, 
          total: batches.length, 
          message: batches.length > 1 ? `Batch ${i + 1} of ${batches.length}` : "Analyzing..." 
        });

        const res = await fetch("/api/auto-group", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photos: batches[i] }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Grouping failed");
        }

        const data = await res.json();

        const batchItems: GroupedItem[] = data.groups.map(
          (group: { photos: { photoId: string; imageType: PieceImageType; isMain: boolean }[] }) => ({
            id: crypto.randomUUID(),
            photos: group.photos.map((p) => ({
              localPhotoId: p.photoId,
              imageType: p.imageType,
            })),
          })
        );

        allItems.push(...batchItems);
      }

      setItems(allItems);
      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Grouping failed");
      setStage("upload");
    }
  };

  const handleSubmit = async () => {
    const validItems = items.filter((item) => item.photos.length > 0);
    if (validItems.length === 0) return;

    setStage("submitting");
    setError("");

    try {
      const allPhotosToUpload = validItems.flatMap((item) => item.photos);
      const total = allPhotosToUpload.length;
      setProgress({ current: 0, total, message: "Uploading..." });

      const uploadResults = new Map<string, UploadImageResponse>();
      const UPLOAD_BATCH_SIZE = 10;

      for (let i = 0; i < allPhotosToUpload.length; i += UPLOAD_BATCH_SIZE) {
        const batch = allPhotosToUpload.slice(i, i + UPLOAD_BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (entry) => {
            const localPhoto = photos.find((p) => p.id === entry.localPhotoId);
            if (!localPhoto) throw new Error("Photo not found");
            const formData = new FormData();
            formData.append("file", localPhoto.file);
            const res = await fetch("/api/upload-image", {
              method: "POST",
              body: formData,
            });
            if (!res.ok) throw new Error("Upload failed");
            const data: UploadImageResponse = await res.json();
            return { localPhotoId: entry.localPhotoId, data };
          })
        );
        results.forEach(({ localPhotoId, data }) =>
          uploadResults.set(localPhotoId, data)
        );
        setProgress({ current: Math.min(i + UPLOAD_BATCH_SIZE, total), total, message: "Uploading..." });
      }

      setProgress({ current: total, total, message: "Finalizing..." });

      const submitBody = {
        taskRabbitId: session.taskRabbitId,
        items: validItems.map((item) => ({
          photos: item.photos.map((p, idx) => {
            const uploaded = uploadResults.get(p.localPhotoId)!;
            const isFront = p.imageType === "FRONT";
            const isFirstFront = idx === item.photos.findIndex((pp) => pp.imageType === "FRONT");
            return {
              photoId: uploaded.photoId,
              fileName: uploaded.fileName,
              mimeType: uploaded.mimeType,
              fileSize: uploaded.fileSize,
              imageType: p.imageType,
              isMainImage: item.photos.length === 1 || (isFront && isFirstFront),
            };
          }),
        })),
      };

      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitBody),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Submit failed");
      }

      const data: SubmitResponse = await res.json();
      onComplete({ itemCount: data.itemCount, photoCount: data.photoCount });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
      setStage("review");
    }
  };

  const removeItem = (itemId: string) => {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
  };

  const updatePhotoType = (itemId: string, localPhotoId: string, imageType: PieceImageType) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        return {
          ...item,
          photos: item.photos.map((p) =>
            p.localPhotoId === localPhotoId ? { ...p, imageType } : p
          ),
        };
      })
    );
  };

  const removePhotoFromItem = (itemId: string, localPhotoId: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        return {
          ...item,
          photos: item.photos.filter((p) => p.localPhotoId !== localPhotoId),
        };
      })
    );
  };

  // Loading state
  if (stage === "grouping" || stage === "submitting") {
    return (
      <div className="min-h-screen bg-[#faf5f3] flex items-center justify-center">
        <div className="text-center">
          <div className="relative w-12 h-12 mx-auto mb-4">
            <div className="absolute inset-0 rounded-full border-2 border-neutral-200" />
            <div className="absolute inset-0 rounded-full border-2 border-neutral-900 border-t-transparent animate-spin" />
          </div>
          <p className="text-sm font-medium text-neutral-900">{progress.message}</p>
          <p className="text-xs text-neutral-400 mt-1">
            {progress.current} of {progress.total}
          </p>
        </div>
      </div>
    );
  }

  // Upload state
  if (stage === "upload") {
    return (
      <div className="min-h-screen bg-white flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="text-sm">
            <span className="text-neutral-400">Customer </span>
            <span className="font-mono font-medium">{session.taskRabbitId}</span>
          </div>
        </header>

        {/* Main */}
        <main className="flex-1 flex flex-col px-5 py-8">
          <div className="max-w-lg mx-auto w-full">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center mb-8"
            >
              <h1 className="text-2xl font-semibold text-neutral-900 mb-2">
                Upload photos
              </h1>
              <p className="text-sm text-neutral-500">
                Add all clothing photos, then AI groups them into items
              </p>
            </motion.div>

            {/* Drop zone */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (e.dataTransfer.files.length > 0) addPhotos(e.dataTransfer.files);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onClick={() => fileInputRef.current?.click()}
              className={`
                cursor-pointer rounded-2xl border-2 border-dashed transition-all py-12 px-6
                ${isDragging 
                  ? "border-neutral-900 bg-neutral-50" 
                  : "border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50"
                }
              `}
            >
              <div className="text-center">
                <div className={`
                  w-12 h-12 mx-auto mb-4 rounded-xl flex items-center justify-center transition-colors
                  ${isDragging ? "bg-neutral-200" : "bg-neutral-100"}
                `}>
                  <svg className="w-6 h-6 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-neutral-900 mb-1">
                  {isDragging ? "Drop photos here" : "Click or drag photos"}
                </p>
                <p className="text-xs text-neutral-400">
                  JPG, PNG, HEIC
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && addPhotos(e.target.files)}
              />
            </motion.div>

            {/* Photo grid */}
            <AnimatePresence>
              {photos.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-6"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-neutral-500">
                      {photos.length} photo{photos.length !== 1 ? "s" : ""}
                    </span>
                    <button
                      onClick={() => {
                        photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
                        setPhotos([]);
                      }}
                      className="text-xs text-neutral-400 hover:text-red-500 transition-colors"
                    >
                      Clear all
                    </button>
                  </div>

                  <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                    {photos.map((photo, i) => (
                      <motion.div
                        key={photo.id}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.02 }}
                        className="relative aspect-square rounded-xl overflow-hidden bg-neutral-100 group"
                      >
                        <img
                          src={photo.previewUrl}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removePhoto(photo.id);
                          }}
                          className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                        >
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {error && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-4 p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-600 text-center"
              >
                {error}
              </motion.div>
            )}
          </div>
        </main>

        {/* Footer */}
        <AnimatePresence>
          {photos.length > 0 && (
            <motion.footer
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="border-t border-neutral-100 px-5 py-4 bg-white"
            >
              <div className="max-w-lg mx-auto flex items-center justify-between">
                <span className="text-sm text-neutral-500">
                  {photos.length} photo{photos.length !== 1 ? "s" : ""} ready
                </span>
                <button
                  onClick={handleAutoGroup}
                  className="h-10 px-5 bg-neutral-900 text-white text-sm font-medium rounded-xl hover:bg-neutral-800 transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                  Auto-group
                </button>
              </div>
            </motion.footer>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Review state
  const validItems = items.filter((item) => item.photos.length > 0);

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 bg-white">
        <button
          onClick={() => setStage("upload")}
          className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <div className="text-sm">
          <span className="text-neutral-400">Customer </span>
          <span className="font-mono font-medium">{session.taskRabbitId}</span>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 overflow-auto px-5 py-6">
        <div className="max-w-3xl mx-auto">
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-neutral-900 mb-1">
              Review items
            </h1>
            <p className="text-sm text-neutral-500">
              {validItems.length} item{validItems.length !== 1 ? "s" : ""} found — adjust if needed
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item, index) => {
              if (item.photos.length === 0) return null;
              
              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-white rounded-2xl border border-neutral-200 overflow-hidden"
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100">
                    <span className="text-sm font-medium text-neutral-900">Item {index + 1}</span>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="text-xs text-neutral-400 hover:text-red-500 transition-colors"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="p-3">
                    <div className="grid grid-cols-2 gap-2">
                      {item.photos.map((p, pIdx) => {
                        const localPhoto = photos.find((lp) => lp.id === p.localPhotoId);
                        if (!localPhoto) return null;

                        const isFront = p.imageType === "FRONT";
                        const isFirstFront = pIdx === item.photos.findIndex((pp) => pp.imageType === "FRONT");
                        const isMain = item.photos.length === 1 || (isFront && isFirstFront);

                        return (
                          <div
                            key={p.localPhotoId}
                            className={`relative rounded-xl overflow-hidden ${
                              isMain ? "ring-2 ring-neutral-900" : "ring-1 ring-neutral-200"
                            }`}
                          >
                            <div className="aspect-square">
                              <img
                                src={localPhoto.previewUrl}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            </div>
                            
                            {isMain && (
                              <div className="absolute top-2 left-2">
                                <span className="text-[10px] font-semibold uppercase tracking-wide bg-neutral-900 text-white px-2 py-0.5 rounded-full">
                                  Main
                                </span>
                              </div>
                            )}

                            <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/60 to-transparent">
                              <div className="flex items-center justify-between">
                                <select
                                  value={p.imageType}
                                  onChange={(e) => updatePhotoType(item.id, p.localPhotoId, e.target.value as PieceImageType)}
                                  className="bg-transparent text-xs font-medium text-white focus:outline-none cursor-pointer"
                                >
                                  <option value="FRONT" className="text-neutral-900">Front</option>
                                  <option value="BACK" className="text-neutral-900">Back</option>
                                  <option value="TAG" className="text-neutral-900">Tag</option>
                                </select>
                                <button
                                  onClick={() => removePhotoFromItem(item.id, p.localPhotoId)}
                                  className="p-1 text-white/70 hover:text-white transition-colors"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-600 text-center"
            >
              {error}
            </motion.div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-200 px-5 py-4 bg-white">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <span className="text-sm text-neutral-500">
            {validItems.length} item{validItems.length !== 1 ? "s" : ""}, {validItems.reduce((sum, i) => sum + i.photos.length, 0)} photos
          </span>
          <button
            onClick={handleSubmit}
            disabled={validItems.length === 0}
            className="h-10 px-6 bg-neutral-900 text-white text-sm font-medium rounded-xl hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Submit to Fitted
          </button>
        </div>
      </footer>
    </div>
  );
}
