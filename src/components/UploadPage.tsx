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
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Add photos
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

  // Auto-group with AI
  const handleAutoGroup = async () => {
    if (photos.length === 0) return;

    setStage("grouping");
    setProgress({ current: 0, total: photos.length, message: "Preparing photos..." });
    setError("");

    try {
      // Resize all photos
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

      // Batch and send to AI
      const batches: typeof photoInputs[] = [];
      for (let i = 0; i < photoInputs.length; i += AUTO_GROUP_BATCH_SIZE) {
        batches.push(photoInputs.slice(i, i + AUTO_GROUP_BATCH_SIZE));
      }

      setProgress({ current: 0, total: batches.length, message: "AI analyzing photos..." });

      const allItems: GroupedItem[] = [];

      for (let i = 0; i < batches.length; i++) {
        setProgress({ current: i + 1, total: batches.length, message: `Analyzing batch ${i + 1} of ${batches.length}...` });

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

  // Submit to Fitted
  const handleSubmit = async () => {
    const validItems = items.filter((item) => item.photos.length > 0);
    if (validItems.length === 0) return;

    setStage("submitting");
    setError("");

    try {
      const allPhotosToUpload = validItems.flatMap((item) => item.photos);
      const total = allPhotosToUpload.length;
      setProgress({ current: 0, total, message: "Uploading photos..." });

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
        setProgress({ current: Math.min(i + UPLOAD_BATCH_SIZE, total), total, message: "Uploading photos..." });
      }

      setProgress({ current: total, total, message: "Submitting to Fitted..." });

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

  // Item management
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

  // Drop handler
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer.files.length > 0) {
        addPhotos(e.dataTransfer.files);
      }
    },
    [addPhotos]
  );

  // Render upload stage
  if (stage === "upload") {
    return (
      <div className="min-h-screen flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between p-4 border-b border-zinc-800">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="text-sm">
            <span className="text-zinc-500">Customer:</span>{" "}
            <span className="font-mono text-white">{session.taskRabbitId}</span>
          </div>
        </header>

        {/* Main content */}
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <div className="w-full max-w-2xl">
            <h1 className="text-3xl font-bold text-center mb-2">Upload Photos</h1>
            <p className="text-zinc-400 text-center mb-8">
              Add all clothing photos, then AI will automatically group them
            </p>

            {/* Drop zone */}
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-zinc-700 rounded-3xl p-12 text-center cursor-pointer hover:border-zinc-500 hover:bg-zinc-900/50 transition-all"
            >
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-zinc-800 flex items-center justify-center">
                <svg className="w-8 h-8 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-lg font-medium mb-1">Drop photos here or click to browse</p>
              <p className="text-sm text-zinc-500">JPG, PNG, HEIC supported</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && addPhotos(e.target.files)}
              />
            </div>

            {/* Photo grid */}
            {photos.length > 0 && (
              <div className="mt-8">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-zinc-400">
                    {photos.length} photo{photos.length !== 1 ? "s" : ""} ready
                  </p>
                  <button
                    onClick={() => {
                      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
                      setPhotos([]);
                    }}
                    className="text-sm text-zinc-500 hover:text-red-400 transition-colors"
                  >
                    Clear all
                  </button>
                </div>

                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                  {photos.map((photo) => (
                    <motion.div
                      key={photo.id}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="relative aspect-square rounded-xl overflow-hidden bg-zinc-800 group"
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
                        className="absolute top-1 right-1 w-6 h-6 bg-black/70 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm text-center">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Bottom bar */}
        {photos.length > 0 && (
          <div className="border-t border-zinc-800 p-4">
            <div className="max-w-2xl mx-auto flex items-center justify-between">
              <p className="text-zinc-400 text-sm">
                {photos.length} photo{photos.length !== 1 ? "s" : ""} selected
              </p>
              <button
                onClick={handleAutoGroup}
                className="px-8 py-3 bg-white text-zinc-900 font-semibold rounded-xl hover:bg-zinc-100 transition-colors flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Auto-Group with AI
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Render grouping stage (loading)
  if (stage === "grouping" || stage === "submitting") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-6 relative">
            <div className="absolute inset-0 rounded-full border-4 border-zinc-800" />
            <div
              className="absolute inset-0 rounded-full border-4 border-white border-t-transparent animate-spin"
            />
          </div>
          <p className="text-lg font-medium mb-2">{progress.message}</p>
          <p className="text-zinc-500 text-sm">
            {progress.current} / {progress.total}
          </p>
        </div>
      </div>
    );
  }

  // Render review stage
  const validItems = items.filter((item) => item.photos.length > 0);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b border-zinc-800">
        <button
          onClick={() => setStage("upload")}
          className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Photos
        </button>
        <div className="text-sm">
          <span className="text-zinc-500">Customer:</span>{" "}
          <span className="font-mono text-white">{session.taskRabbitId}</span>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold mb-1">Review Items</h1>
          <p className="text-zinc-400 mb-6">
            AI found {validItems.length} item{validItems.length !== 1 ? "s" : ""}. Review and adjust if needed.
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence>
              {items.map((item, index) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden"
                >
                  <div className="flex items-center justify-between p-3 border-b border-zinc-800">
                    <span className="font-semibold">Item {index + 1}</span>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="text-zinc-500 hover:text-red-400 transition-colors text-sm"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="p-3">
                    {item.photos.length === 0 ? (
                      <p className="text-zinc-500 text-sm py-8 text-center">No photos</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {item.photos.map((p, pIdx) => {
                          const localPhoto = photos.find((lp) => lp.id === p.localPhotoId);
                          if (!localPhoto) return null;

                          const isFront = p.imageType === "FRONT";
                          const isFirstFront = pIdx === item.photos.findIndex((pp) => pp.imageType === "FRONT");
                          const isMain = isFront && isFirstFront;

                          return (
                            <div
                              key={p.localPhotoId}
                              className={`relative rounded-xl overflow-hidden ${
                                isMain ? "ring-2 ring-white" : ""
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
                                  <span className="bg-white text-zinc-900 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                    MAIN
                                  </span>
                                </div>
                              )}
                              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                                <div className="flex items-center justify-between">
                                  <select
                                    value={p.imageType}
                                    onChange={(e) =>
                                      updatePhotoType(item.id, p.localPhotoId, e.target.value as PieceImageType)
                                    }
                                    className="bg-transparent text-xs font-medium focus:outline-none cursor-pointer"
                                  >
                                    <option value="FRONT" className="bg-zinc-900">FRONT</option>
                                    <option value="BACK" className="bg-zinc-900">BACK</option>
                                    <option value="TAG" className="bg-zinc-900">TAG</option>
                                  </select>
                                  <button
                                    onClick={() => removePhotoFromItem(item.id, p.localPhotoId)}
                                    className="text-zinc-400 hover:text-red-400"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {error && (
            <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm text-center">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-zinc-800 p-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <p className="text-zinc-400 text-sm">
            {validItems.length} item{validItems.length !== 1 ? "s" : ""} ready to submit
          </p>
          <button
            onClick={handleSubmit}
            disabled={validItems.length === 0}
            className="px-8 py-3 bg-white text-zinc-900 font-semibold rounded-xl hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Submit to Fitted
          </button>
        </div>
      </div>
    </div>
  );
}
