"use client";

import { useState, useRef, useCallback } from "react";
import type {
  PieceImageType,
  LocalPhoto,
  GroupedItem,
  UploadImageResponse,
  SubmitResponse,
} from "@/types/upload";

type UploadStage = "idle" | "uploading" | "submitting" | "done" | "error";
type GroupingStage = "idle" | "resizing" | "analyzing" | "done";

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
      if (!ctx) return reject(new Error(`No canvas context: ${file.name}`));
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      const base64 = dataUrl.split(",")[1];
      resolve(base64);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error(
          `Failed to load "${file.name}". HEIC/HEIF may not be supported in this browser — try converting to JPG (iPhone: Settings > Camera > Formats > Most Compatible).`
        )
      );
    };
    img.src = url;
  });
}

export default function GroupingPage() {
  const [taskRabbitId, setTaskRabbitId] = useState("");
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [items, setItems] = useState<GroupedItem[]>([]);
  const [stage, setStage] = useState<UploadStage>("idle");
  const [groupingStage, setGroupingStage] = useState<GroupingStage>("idle");
  const [groupingProgress, setGroupingProgress] = useState({
    batch: 0,
    totalBatches: 0,
  });
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Photo Management ----

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

  const removePhoto = useCallback(
    (photoId: string) => {
      setPhotos((prev) => {
        const photo = prev.find((p) => p.id === photoId);
        if (photo) URL.revokeObjectURL(photo.previewUrl);
        return prev.filter((p) => p.id !== photoId);
      });
      setItems((prev) =>
        prev.map((item) => ({
          ...item,
          photos: item.photos.filter((p) => p.localPhotoId !== photoId),
        }))
      );
    },
    []
  );

  // ---- Auto Group with AI ----

  const handleAutoGroup = useCallback(async () => {
    if (photos.length === 0) return;

    setGroupingStage("resizing");
    setErrorMsg("");

    try {
      const results = await Promise.allSettled(
        photos.map(async (photo) => {
          const base64 = await resizeImage(photo.file, 512);
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

      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        const firstErr = failed[0] as PromiseRejectedResult;
        const msg =
          failed.length === 1
            ? firstErr.reason?.message ?? "Failed to load image"
            : `${failed.length} images could not be loaded (e.g. HEIC). Skipped. Try JPG/PNG.`;
        setErrorMsg(msg);
      }

      if (photoInputs.length === 0) {
        setGroupingStage("idle");
        return;
      }

      if (photoInputs.length > 200) {
        setErrorMsg("Maximum 200 photos for auto-group. Remove some photos.");
        setGroupingStage("idle");
        return;
      }

      const batches: typeof photoInputs[] = [];
      for (let i = 0; i < photoInputs.length; i += AUTO_GROUP_BATCH_SIZE) {
        batches.push(photoInputs.slice(i, i + AUTO_GROUP_BATCH_SIZE));
      }

      setGroupingProgress({ batch: 0, totalBatches: batches.length });
      setGroupingStage("analyzing");

      const allItems: GroupedItem[] = [];

      for (let i = 0; i < batches.length; i++) {
        setGroupingProgress({ batch: i + 1, totalBatches: batches.length });

        const res = await fetch("/api/auto-group", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photos: batches[i] }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || err.details || "Auto-grouping failed");
        }

        const data = await res.json();

        const batchItems: GroupedItem[] = data.groups.map(
          (group: { photos: { photoId: string; imageType: PieceImageType; isMain: boolean }[] }) => ({
            id: crypto.randomUUID(),
            photos: group.photos.map(
              (p: { photoId: string; imageType: PieceImageType }) => ({
                localPhotoId: p.photoId,
                imageType: p.imageType,
              })
            ),
          })
        );

        allItems.push(...batchItems);
      }

      setItems(allItems);
      setGroupingStage("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Auto-grouping failed");
      setGroupingStage("idle");
    }
  }, [photos]);

  const assignedPhotoIds = new Set(
    items.flatMap((item) => item.photos.map((p) => p.localPhotoId))
  );
  const unassignedPhotos = photos.filter((p) => !assignedPhotoIds.has(p.id));

  // ---- Item Management ----

  const createItem = useCallback(() => {
    setItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), photos: [] },
    ]);
  }, []);

  const removeItem = useCallback((itemId: string) => {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
  }, []);

  const addPhotoToItem = useCallback(
    (itemId: string, localPhotoId: string, imageType: PieceImageType) => {
      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== itemId) return item;
          if (item.photos.some((p) => p.localPhotoId === localPhotoId))
            return item;
          return {
            ...item,
            photos: [...item.photos, { localPhotoId, imageType }],
          };
        })
      );
    },
    []
  );

  const removePhotoFromItem = useCallback(
    (itemId: string, localPhotoId: string) => {
      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== itemId) return item;
          return {
            ...item,
            photos: item.photos.filter(
              (p) => p.localPhotoId !== localPhotoId
            ),
          };
        })
      );
    },
    []
  );

  const updatePhotoType = useCallback(
    (itemId: string, localPhotoId: string, imageType: PieceImageType) => {
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
    },
    []
  );

  // ---- Submit Flow ----

  const canSubmit =
    taskRabbitId.trim() !== "" &&
    items.length > 0 &&
    items.every((item) => item.photos.length > 0) &&
    stage === "idle";

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setStage("uploading");
    setErrorMsg("");

    try {
      const allPhotosToUpload = items.flatMap((item) => item.photos);
      const total = allPhotosToUpload.length;
      setProgress({ current: 0, total });

      const uploadResults = new Map<string, UploadImageResponse>();
      const UPLOAD_BATCH_SIZE = 10;

      for (let i = 0; i < allPhotosToUpload.length; i += UPLOAD_BATCH_SIZE) {
        const batch = allPhotosToUpload.slice(i, i + UPLOAD_BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (entry) => {
            const localPhoto = photos.find((p) => p.id === entry.localPhotoId);
            if (!localPhoto) throw new Error("Photo not found locally");
            const formData = new FormData();
            formData.append("file", localPhoto.file);
            const res = await fetch("/api/upload-image", {
              method: "POST",
              body: formData,
            });
            if (!res.ok) {
              const err = await res.json();
              throw new Error(err.error || "Image upload failed");
            }
            const data: UploadImageResponse = await res.json();
            return { localPhotoId: entry.localPhotoId, data };
          })
        );
        results.forEach(({ localPhotoId, data }) =>
          uploadResults.set(localPhotoId, data)
        );
        setProgress({ current: Math.min(i + UPLOAD_BATCH_SIZE, total), total });
      }

      setStage("submitting");

      const submitBody = {
        taskRabbitId: taskRabbitId.trim(),
        items: items.map((item) => ({
          photos: item.photos.map((p, idx) => {
            const uploaded = uploadResults.get(p.localPhotoId)!;
            const isFront = p.imageType === "FRONT";
            const isFirstFront =
              idx ===
              item.photos.findIndex(
                (pp) => pp.imageType === "FRONT"
              );
            const mainImage =
              item.photos.length === 1
                ? true
                : isFront && isFirstFront;
            return {
              photoId: uploaded.photoId,
              fileName: uploaded.fileName,
              mimeType: uploaded.mimeType,
              fileSize: uploaded.fileSize,
              imageType: p.imageType,
              isMainImage: mainImage,
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
      setResult(data);
      setStage("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStage("error");
    }
  };

  const handleReset = () => {
    photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setPhotos([]);
    setItems([]);
    setStage("idle");
    setGroupingStage("idle");
    setResult(null);
    setErrorMsg("");
    setProgress({ current: 0, total: 0 });
  };

  // ---- Drop handler ----

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer.files.length > 0) {
        addPhotos(e.dataTransfer.files);
      }
    },
    [addPhotos]
  );

  // ---- Render ----

  if (stage === "done" && result) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card-elevated p-12 max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-emerald-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-semibold mb-2 text-slate-900">
            Successfully Submitted
          </h2>
          <p className="text-slate-600 mb-6">
            {result.itemCount} item{result.itemCount !== 1 ? "s" : ""} with{" "}
            {result.photoCount} photo{result.photoCount !== 1 ? "s" : ""} sent to Fitted.
          </p>
          <div className="bg-slate-50 rounded-xl p-4 mb-8 text-left">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Reference</p>
            <p className="text-sm font-mono text-slate-700 break-all">
              {result.uploadIds.length === 1
                ? result.uploadId
                : `${result.uploadIds.length} docs · First: ${result.uploadId}`}
            </p>
          </div>
          <button
            onClick={handleReset}
            className="btn-primary w-full py-3.5 rounded-xl"
          >
            Process Next Customer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <main className="flex-1 min-h-0 overflow-auto">
        <div className="max-w-xl w-full mx-auto px-4 py-4">
          {/* Header */}
          <header className="text-center mb-4">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Fitted <span className="text-slate-400">×</span> TaskRabbit
            </h1>
            <p className="text-slate-500 text-xs mt-0.5">
              Photo grouping for closet digitization
            </p>
            {stage !== "idle" && (
              <p className="text-xs text-slate-400 mt-1 font-medium">
                {stage === "uploading" &&
                  `Uploading ${progress.current}/${progress.total}...`}
                {stage === "submitting" && "Submitting to Fitted..."}
              </p>
            )}
          </header>

          <div className="space-y-3">
            {/* TaskRabbit ID */}
            <div className="card p-4">
              <label className="block text-xs font-semibold text-slate-900 mb-1">
                TaskRabbit ID
              </label>
              <input
                type="text"
                value={taskRabbitId}
                onChange={(e) => setTaskRabbitId(e.target.value)}
                placeholder="e.g. 12345"
                disabled={stage !== "idle"}
                className="input-field w-full px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 disabled:opacity-50 disabled:bg-slate-50"
              />
            </div>

            {/* Photos */}
            <div className="card p-4">
                <h2 className="text-xs font-semibold text-slate-900 mb-2">Photos</h2>
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                  onClick={() => stage === "idle" && fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all duration-200 ${
                    stage !== "idle"
                      ? "border-slate-200 bg-slate-50 opacity-60 pointer-events-none"
                      : "border-slate-300 bg-slate-50/50 hover:border-slate-400 hover:bg-slate-100"
                  }`}
                >
                  <div className="w-8 h-8 mx-auto mb-2 rounded-lg bg-slate-200/80 flex items-center justify-center">
                    <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className="text-slate-700 text-sm font-medium">
                    Drop or click
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    JPG, PNG, HEIC · Upload in order
                  </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => e.target.files && addPhotos(e.target.files)}
                />
              </div>

                {/* Photo count + Auto Group */}
                {photos.length > 0 && (
                  <div className="mt-2 flex flex-col sm:flex-row items-center justify-between gap-2">
                  <p className="text-sm text-slate-500">
                    {photos.length} photo{photos.length !== 1 ? "s" : ""} uploaded
                    {unassignedPhotos.length > 0 && (
                      <span className="text-amber-600 ml-1 font-medium">
                        ({unassignedPhotos.length} unassigned)
                      </span>
                    )}
                  </p>
                  <button
                    onClick={handleAutoGroup}
                    disabled={
                      photos.length < 1 ||
                      stage !== "idle" ||
                      groupingStage === "resizing" ||
                      groupingStage === "analyzing"
                    }
                    className="btn-primary px-5 py-2.5 rounded-xl flex items-center gap-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none"
                  >
                {groupingStage === "resizing" ? (
                  <>
                    <Spinner /> Preparing photos...
                  </>
                ) : groupingStage === "analyzing" ? (
                  <>
                    <Spinner />{" "}
                    {groupingProgress.totalBatches > 1
                      ? `AI analyzing batch ${groupingProgress.batch}/${groupingProgress.totalBatches}...`
                      : "AI analyzing..."}
                  </>
                ) : (
                  <>
                    <span className="text-lg">&#9733;</span> Auto Group with AI
                  </>
                )}
                  </button>
                </div>
              )}

                {/* Auto-group error */}
                {errorMsg && groupingStage === "idle" && (
                  <div className="mt-2 bg-red-50 border border-red-200 rounded-lg p-2 text-red-700 text-xs flex items-center justify-between">
                  <span>{errorMsg}</span>
                  <button onClick={() => setErrorMsg("")} className="font-medium text-red-600 hover:text-red-800">
                    Dismiss
                  </button>
                </div>
              )}

                {/* AI grouping success */}
                {groupingStage === "done" && items.length > 0 && (
                  <div className="mt-2 bg-emerald-50 border border-emerald-200 rounded-lg p-2 text-emerald-700 text-xs">
                  AI grouped {photos.length} photos into {items.length} item{items.length !== 1 ? "s" : ""}. Review below, then submit.
                </div>
              )}

                {/* Unassigned photos */}
                {unassignedPhotos.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-slate-600 mb-1">
                      Unassigned ({unassignedPhotos.length})
                    </p>
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-1">
                    {unassignedPhotos.map((photo) => (
                      <PhotoThumbnail
                        key={photo.id}
                        photo={photo}
                        onRemove={() => removePhoto(photo.id)}
                        disabled={stage !== "idle"}
                      />
                    ))}
                    </div>
                  </div>
                )}
              </div>

            {/* Items */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-semibold text-slate-900">
                  Items ({items.length})
                </h2>
                <button
                  onClick={createItem}
                  disabled={stage !== "idle"}
                  className="btn-secondary text-xs px-3 py-1.5 rounded-lg disabled:opacity-50"
                >
                  + New Item
                </button>
              </div>

              {items.length === 0 && (
                <div className="bg-slate-50 rounded-lg p-4 text-center text-slate-500 text-xs">
                  <p>
                    {photos.length >= 2
                      ? 'Upload photos above, then click "Auto Group with AI" to sort them into items.'
                      : 'No items yet. Use AI auto-grouping or add items manually.'}
                  </p>
                </div>
              )}

              <div className="space-y-2 mt-2 max-h-[35vh] overflow-y-auto">
            {items.map((item, itemIndex) => (
              <ItemCard
                key={item.id}
                item={item}
                itemIndex={itemIndex}
                allPhotos={photos}
                unassignedPhotos={unassignedPhotos}
                onAddPhoto={(photoId, type) =>
                  addPhotoToItem(item.id, photoId, type)
                }
                onRemovePhoto={(photoId) =>
                  removePhotoFromItem(item.id, photoId)
                }
                onUpdateType={(photoId, type) =>
                  updatePhotoType(item.id, photoId, type)
                }
                onRemoveItem={() => removeItem(item.id)}
                disabled={stage !== "idle"}
              />
            ))}
              </div>
            </div>

            {/* Error */}
            {stage === "error" && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
                <p className="font-semibold">Error</p>
                <p className="text-sm mt-1">{errorMsg}</p>
                <button
                  onClick={() => {
                    setStage("idle");
                    setErrorMsg("");
                  }}
                  className="mt-3 text-sm font-medium text-red-600 hover:text-red-800"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
      <div className="flex-shrink-0 bg-white border-t border-slate-200 px-4 py-3 shadow-[0_-2px_10px_rgba(0,0,0,0.04)]">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="text-xs text-slate-500">
            {photos.length} photo{photos.length !== 1 ? "s" : ""},{" "}
            {items.length} item{items.length !== 1 ? "s" : ""}
            {unassignedPhotos.length > 0 && (
              <span className="text-amber-600 ml-1 font-medium">
                ({unassignedPhotos.length} unassigned)
              </span>
            )}
          </div>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="btn-primary px-6 py-2.5 rounded-xl text-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none"
          >
            {stage === "uploading"
              ? `Uploading ${progress.current}/${progress.total}`
              : stage === "submitting"
                ? "Submitting..."
                : "Submit to Fitted"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Subcomponents ----

function PhotoThumbnail({
  photo,
  onRemove,
  disabled,
}: {
  photo: LocalPhoto;
  onRemove: () => void;
  disabled: boolean;
}) {
  return (
    <div className="relative group aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shadow-sm">
      <img
        src={photo.previewUrl}
        alt={photo.file.name}
        className="w-full h-full object-cover"
      />
      {!disabled && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute top-1.5 right-1.5 bg-slate-900/80 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity font-medium"
        >
          ×
        </button>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

const IMAGE_TYPES: PieceImageType[] = ["FRONT", "BACK", "TAG"];

function ItemCard({
  item,
  itemIndex,
  allPhotos,
  unassignedPhotos,
  onAddPhoto,
  onRemovePhoto,
  onUpdateType,
  onRemoveItem,
  disabled,
}: {
  item: GroupedItem;
  itemIndex: number;
  allPhotos: LocalPhoto[];
  unassignedPhotos: LocalPhoto[];
  onAddPhoto: (photoId: string, type: PieceImageType) => void;
  onRemovePhoto: (photoId: string) => void;
  onUpdateType: (photoId: string, type: PieceImageType) => void;
  onRemoveItem: () => void;
  disabled: boolean;
}) {
  const [addingType, setAddingType] = useState<PieceImageType>("FRONT");
  const [showPicker, setShowPicker] = useState(false);

  const handlePickPhoto = (photoId: string) => {
    onAddPhoto(photoId, addingType);
    setShowPicker(false);
  };

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-slate-900 text-sm">Item {itemIndex + 1}</h3>
        {!disabled && (
          <button
            onClick={onRemoveItem}
            className="text-sm font-medium text-red-600 hover:text-red-700"
          >
            Remove
          </button>
        )}
      </div>

      {/* Assigned photos */}
      {item.photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
          {item.photos.map((p, pIdx) => {
            const localPhoto = allPhotos.find(
              (lp) => lp.id === p.localPhotoId
            );
            if (!localPhoto) return null;

            const isFront = p.imageType === "FRONT";
            const isFirstFront =
              pIdx ===
              item.photos.findIndex((pp) => pp.imageType === "FRONT");
            const isMain = isFront && isFirstFront;

            return (
              <div
                key={p.localPhotoId}
                className={`relative rounded-xl overflow-hidden border-2 shadow-sm ${isMain ? "border-slate-900 ring-2 ring-slate-900/10" : "border-slate-200"}`}
              >
                <div className="aspect-square">
                  <img
                    src={localPhoto.previewUrl}
                    alt={localPhoto.file.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="absolute top-2 left-2">
                  {isMain && (
                    <span className="bg-slate-900 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded">
                      MAIN
                    </span>
                  )}
                </div>
                <div className="p-2 bg-white border-t border-slate-100 flex items-center justify-between">
                  <select
                    value={p.imageType}
                    onChange={(e) =>
                      onUpdateType(
                        p.localPhotoId,
                        e.target.value as PieceImageType
                      )
                    }
                    disabled={disabled}
                    className="bg-transparent px-2 py-1 text-sm font-medium text-slate-700 focus:outline-none disabled:opacity-50"
                  >
                    {IMAGE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                  {!disabled && (
                    <button
                      onClick={() => onRemovePhoto(p.localPhotoId)}
                      className="text-red-600 hover:text-red-700 text-sm font-medium"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add photo to item */}
      {!disabled && (
        <div>
          {!showPicker ? (
            <button
              onClick={() => setShowPicker(true)}
              disabled={unassignedPhotos.length === 0}
              className="w-full border border-dashed border-slate-300 rounded-xl p-3 text-sm text-slate-500 hover:border-slate-400 hover:bg-white transition-colors disabled:opacity-40"
            >
              {unassignedPhotos.length === 0
                ? "No unassigned photos — upload more above"
                : "+ Add photo to this item"}
            </button>
          ) : (
            <div className="border border-slate-200 rounded-xl p-3 space-y-3 bg-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="text-sm text-slate-600 font-medium">Type:</label>
                  <select
                    value={addingType}
                    onChange={(e) =>
                      setAddingType(e.target.value as PieceImageType)
                    }
                    className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900/20"
                  >
                    {IMAGE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => setShowPicker(false)}
                  className="text-sm font-medium text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
              </div>
              <p className="text-xs text-slate-500">Select a photo to add:</p>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {unassignedPhotos.map((photo) => (
                  <button
                    key={photo.id}
                    onClick={() => handlePickPhoto(photo.id)}
                    className="aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-slate-900 transition-colors"
                  >
                    <img
                      src={photo.previewUrl}
                      alt={photo.file.name}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
