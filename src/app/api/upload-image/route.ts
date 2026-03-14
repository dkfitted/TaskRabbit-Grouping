import { NextRequest, NextResponse } from "next/server";
import { Storage } from "@google-cloud/storage";
import { v4 as uuidv4 } from "uuid";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET_NAME = "fitted-image-upload-original-images";
const GCS_PROJECT = "fitted-image-upload";

function getStorageClient(): Storage {
  const credsBase64 =
    process.env.GCS_CREDENTIALS ?? process.env.FIRESTORE_CREDENTIALS;
  if (!credsBase64) {
    throw new Error("GCS_CREDENTIALS or FIRESTORE_CREDENTIALS not configured");
  }
  const creds = JSON.parse(
    Buffer.from(credsBase64, "base64").toString("utf-8")
  );
  return new Storage({ credentials: creds, projectId: GCS_PROJECT });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name || "photo.jpg";
    const mimeType = file.type || "image/jpeg";
    const photoId = uuidv4();

    const storage = getStorageClient();
    const bucket = storage.bucket(BUCKET_NAME);
    const blob = bucket.file(photoId);

    await blob.save(buffer, {
      contentType: mimeType,
      metadata: { originalName: fileName },
    });

    return NextResponse.json({
      photoId,
      fileName,
      mimeType,
      fileSize: buffer.length,
    });
  } catch (err) {
    console.error("Upload image error:", err);
    const message =
      err instanceof Error ? err.message : "Image upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
