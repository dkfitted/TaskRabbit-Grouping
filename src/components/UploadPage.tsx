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

  const handleAutoGroup = async () => {
    if (photos.length === 0) return;
    setStage("processing");
    setStatus("Analyzing photos...");
    setError("");

    try {
      const inputs = await Promise.all(
        photos.map(async (p) => ({
          id: p.id,
          base64: await resizeImage(p.file),
          mimeType: "image/jpeg",
          fileName: p.file.name,
        }))
      );

      const res = await fetch("/api/auto-group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos: inputs }),
      });

      if (!res.ok) throw new Error((await res.json()).error || "Grouping failed");

      const data = await res.json();
      setItems(
        data.groups.map((g: { photos: { photoId: string; imageType: PieceImageType }[] }) => ({
          id: crypto.randomUUID(),
          photos: g.photos.map((p) => ({ localPhotoId: p.photoId, imageType: p.imageType })),
        }))
      );
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

  // Processing state
  if (stage === "processing") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-black rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-600">{status}</p>
        </div>
      </div>
    );
  }

  // Review state
  if (stage === "review") {
    const validItems = items.filter((i) => i.photos.length > 0);
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <button onClick={() => setStage("upload")} className="text-sm text-gray-500 hover:text-black">
            ← Back
          </button>
          <span className="text-sm font-mono">{session.taskRabbitId}</span>
        </header>

        <main className="p-4 max-w-2xl mx-auto">
          <h2 className="text-lg font-semibold mb-1">Review {validItems.length} items</h2>
          <p className="text-sm text-gray-500 mb-4">Tap to adjust, then submit</p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {items.map((item, idx) => {
              if (item.photos.length === 0) return null;
              return (
                <div key={item.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-3 py-2 border-b border-gray-100 flex justify-between items-center">
                    <span className="text-xs font-medium">Item {idx + 1}</span>
                    <button
                      onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                      className="text-xs text-gray-400 hover:text-red-500"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="p-2 grid grid-cols-2 gap-1">
                    {item.photos.map((p) => {
                      const photo = photos.find((x) => x.id === p.localPhotoId);
                      if (!photo) return null;
                      return (
                        <div key={p.localPhotoId} className="relative aspect-square rounded-lg overflow-hidden">
                          <img src={photo.previewUrl} className="w-full h-full object-cover" />
                          <select
                            value={p.imageType}
                            onChange={(e) => {
                              setItems((prev) =>
                                prev.map((i) =>
                                  i.id === item.id
                                    ? { ...i, photos: i.photos.map((x) => (x.localPhotoId === p.localPhotoId ? { ...x, imageType: e.target.value as PieceImageType } : x)) }
                                    : i
                                )
                              );
                            }}
                            className="absolute bottom-1 left-1 text-[10px] bg-black/60 text-white rounded px-1 py-0.5"
                          >
                            <option value="FRONT">Front</option>
                            <option value="BACK">Back</option>
                            <option value="TAG">Tag</option>
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {error && <p className="mt-4 text-sm text-red-500 text-center">{error}</p>}
        </main>

        <footer className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 p-4">
          <button
            onClick={handleSubmit}
            disabled={validItems.length === 0}
            className="w-full max-w-2xl mx-auto block h-12 bg-black text-white font-medium rounded-xl disabled:opacity-40"
          >
            Submit {validItems.length} items to Fitted
          </button>
        </footer>
      </div>
    );
  }

  // Upload state (default)
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-black">
          ← Back
        </button>
        <span className="text-sm font-mono">{session.taskRabbitId}</span>
      </header>

      <main className="p-4 max-w-lg mx-auto">
        <h2 className="text-lg font-semibold text-center mb-1">Add photos</h2>
        <p className="text-sm text-gray-500 text-center mb-6">Upload all clothing photos</p>

        {/* Upload button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full py-8 border-2 border-dashed border-gray-200 rounded-xl hover:border-gray-300 hover:bg-gray-50 transition-colors"
        >
          <div className="text-center">
            <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center mx-auto mb-2">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <span className="text-sm font-medium text-gray-700">Add photos</span>
          </div>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && addPhotos(e.target.files)}
        />

        {/* Photo grid */}
        {photos.length > 0 && (
          <div className="mt-6">
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm text-gray-500">{photos.length} photos</span>
              <button
                onClick={() => {
                  photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
                  setPhotos([]);
                }}
                className="text-xs text-gray-400 hover:text-red-500"
              >
                Clear
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {photos.map((p) => (
                <div key={p.id} className="relative aspect-square rounded-lg overflow-hidden group">
                  <img src={p.previewUrl} className="w-full h-full object-cover" />
                  <button
                    onClick={() => removePhoto(p.id)}
                    className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                  >
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-red-500 text-center">{error}</p>}
      </main>

      {/* Bottom button */}
      {photos.length > 0 && (
        <footer className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 p-4">
          <button
            onClick={handleAutoGroup}
            className="w-full max-w-lg mx-auto block h-12 bg-black text-white font-medium rounded-xl"
          >
            Continue with {photos.length} photos
          </button>
        </footer>
      )}
    </div>
  );
}
