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
    setProgress({ current: 0, total: photos.length, message: "Preparing photos..." });
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

      setProgress({ current: 0, total: batches.length, message: "AI is analyzing..." });

      const allItems: GroupedItem[] = [];

      for (let i = 0; i < batches.length; i++) {
        setProgress({ 
          current: i + 1, 
          total: batches.length, 
          message: batches.length > 1 ? `Processing batch ${i + 1}/${batches.length}` : "AI is analyzing..." 
        });

        const res = await fetch("/api/auto-group", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photos: batches[i] }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "AI grouping failed");
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="relative w-16 h-16 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full border-2 border-[#222]" />
            <div className="absolute inset-0 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
          </div>
          <p className="text-[15px] font-medium text-white mb-1">{progress.message}</p>
          <p className="text-[13px] text-[#666]">
            {progress.current} of {progress.total}
          </p>
        </div>
      </div>
    );
  }

  // Upload state
  if (stage === "upload") {
    return (
      <div className="min-h-screen flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-[rgba(255,255,255,0.06)]">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-[14px] text-[#888] hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="flex items-center gap-2 text-[14px]">
            <span className="text-[#666]">Customer</span>
            <span className="font-mono text-white bg-[#1a1a1a] px-2.5 py-1 rounded-md">{session.taskRabbitId}</span>
          </div>
        </header>

        {/* Main */}
        <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
          <div className="w-full max-w-xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center mb-10"
            >
              <h1 className="text-[28px] font-semibold tracking-tight mb-2">
                Upload Photos
              </h1>
              <p className="text-[15px] text-[#888]">
                Add all clothing photos. AI will group them automatically.
              </p>
            </motion.div>

            {/* Drop zone */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
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
                relative cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200
                ${isDragging 
                  ? "border-violet-500 bg-violet-500/5" 
                  : "border-[#333] hover:border-[#444] hover:bg-[rgba(255,255,255,0.02)]"
                }
              `}
            >
              <div className="py-16 px-8 text-center">
                <div className={`
                  w-14 h-14 mx-auto mb-5 rounded-2xl flex items-center justify-center transition-colors
                  ${isDragging ? "bg-violet-500/20" : "bg-[#1a1a1a]"}
                `}>
                  <svg className={`w-6 h-6 ${isDragging ? "text-violet-400" : "text-[#666]"}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
                  </svg>
                </div>
                <p className="text-[15px] font-medium text-white mb-1">
                  {isDragging ? "Drop photos here" : "Click to upload or drag and drop"}
                </p>
                <p className="text-[13px] text-[#666]">
                  JPG, PNG, or HEIC
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
                  className="mt-8"
                >
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[14px] text-[#888]">
                      {photos.length} photo{photos.length !== 1 ? "s" : ""} added
                    </span>
                    <button
                      onClick={() => {
                        photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
                        setPhotos([]);
                      }}
                      className="text-[13px] text-[#666] hover:text-red-400 transition-colors"
                    >
                      Clear all
                    </button>
                  </div>

                  <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
                    {photos.map((photo, i) => (
                      <motion.div
                        key={photo.id}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.02 }}
                        className="relative aspect-square rounded-xl overflow-hidden bg-[#111] group ring-1 ring-[rgba(255,255,255,0.06)]"
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
                          className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                        >
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
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
                className="mt-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-[14px] text-red-400 text-center"
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
              className="border-t border-[rgba(255,255,255,0.06)] px-6 py-4"
            >
              <div className="max-w-xl mx-auto flex items-center justify-between">
                <span className="text-[14px] text-[#888]">
                  {photos.length} photo{photos.length !== 1 ? "s" : ""} ready
                </span>
                <button
                  onClick={handleAutoGroup}
                  className="btn btn-primary h-11 px-6 rounded-xl text-[14px] gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                  </svg>
                  Group with AI
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
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-[rgba(255,255,255,0.06)]">
        <button
          onClick={() => setStage("upload")}
          className="flex items-center gap-1.5 text-[14px] text-[#888] hover:text-white transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <div className="flex items-center gap-2 text-[14px]">
          <span className="text-[#666]">Customer</span>
          <span className="font-mono text-white bg-[#1a1a1a] px-2.5 py-1 rounded-md">{session.taskRabbitId}</span>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 overflow-auto px-6 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="text-[24px] font-semibold tracking-tight mb-1">
              Review Items
            </h1>
            <p className="text-[15px] text-[#888]">
              AI found {validItems.length} item{validItems.length !== 1 ? "s" : ""}. Adjust if needed.
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
                  className="card overflow-hidden"
                >
                  {/* Item header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.06)]">
                    <span className="text-[14px] font-medium">Item {index + 1}</span>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="text-[13px] text-[#666] hover:text-red-400 transition-colors"
                    >
                      Remove
                    </button>
                  </div>

                  {/* Photos grid */}
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
                            className={`relative rounded-xl overflow-hidden ring-1 ${
                              isMain 
                                ? "ring-violet-500 ring-2" 
                                : "ring-[rgba(255,255,255,0.06)]"
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
                                <span className="text-[10px] font-semibold uppercase tracking-wide bg-violet-500 text-white px-2 py-0.5 rounded-full">
                                  Main
                                </span>
                              </div>
                            )}

                            <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
                              <div className="flex items-center justify-between">
                                <select
                                  value={p.imageType}
                                  onChange={(e) => updatePhotoType(item.id, p.localPhotoId, e.target.value as PieceImageType)}
                                  className="bg-transparent text-[12px] font-medium text-white focus:outline-none cursor-pointer"
                                >
                                  <option value="FRONT" className="bg-[#1a1a1a]">Front</option>
                                  <option value="BACK" className="bg-[#1a1a1a]">Back</option>
                                  <option value="TAG" className="bg-[#1a1a1a]">Tag</option>
                                </select>
                                <button
                                  onClick={() => removePhotoFromItem(item.id, p.localPhotoId)}
                                  className="p-1 text-[#888] hover:text-red-400 transition-colors"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
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
              className="mt-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-[14px] text-red-400 text-center"
            >
              {error}
            </motion.div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[rgba(255,255,255,0.06)] px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <span className="text-[14px] text-[#888]">
            {validItems.length} item{validItems.length !== 1 ? "s" : ""} · {validItems.reduce((sum, i) => sum + i.photos.length, 0)} photos
          </span>
          <button
            onClick={handleSubmit}
            disabled={validItems.length === 0}
            className="btn btn-primary h-11 px-8 rounded-xl text-[14px]"
          >
            Submit to Fitted
          </button>
        </div>
      </footer>
    </div>
  );
}
