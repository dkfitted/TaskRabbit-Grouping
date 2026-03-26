import { NextRequest, NextResponse } from "next/server";
import * as admin from "firebase-admin";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 300;

const FIRESTORE_PROJECT = "fitted-upload";
const COLLECTION =
  process.env.FIRESTORE_COLLECTION ?? "clothing-item-uploads";
const SERVER_URL =
  process.env.SERVER_URL ?? "https://app.fittedcloset.com";
const DELAY_MS_BETWEEN_DOCS = 5000;

function getFirestore(): admin.firestore.Firestore {
  if (admin.apps.length === 0) {
    const credsBase64 =
      process.env.FIRESTORE_CREDENTIALS ?? process.env.GCS_CREDENTIALS;
    if (!credsBase64) {
      throw new Error(
        "FIRESTORE_CREDENTIALS or GCS_CREDENTIALS not configured"
      );
    }
    const creds = JSON.parse(
      Buffer.from(credsBase64, "base64").toString("utf-8")
    );
    admin.initializeApp({
      credential: admin.credential.cert(creds),
      projectId: FIRESTORE_PROJECT,
    });
  }
  return admin.firestore();
}

function mapPieceImageType(imageType: string): string | null {
  if (imageType === "TAG") return "BRAND_TAG";
  if (imageType === "FRONT" || imageType === "BACK") return imageType;
  return null;
}

interface PhotoInput {
  photoId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  imageType: string;
  isMainImage: boolean;
}

interface ItemInput {
  photos: PhotoInput[];
}

interface SubmitBody {
  taskRabbitId: string;
  items: ItemInput[];
  batchIndex?: number;
  batchTotal?: number;
}

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? `svr-${Date.now()}`;
  console.log("[TR-Submit] API received", { requestId });
  try {
    const body = (await req.json()) as SubmitBody;
    const { taskRabbitId, items } = body;

    if (!taskRabbitId?.trim()) {
      return NextResponse.json(
        { error: "taskRabbitId is required" },
        { status: 400 }
      );
    }
    if (!items?.length) {
      return NextResponse.json(
        { error: "At least one item is required" },
        { status: 400 }
      );
    }

    const now = new Date();
    const uploadedTimeMillis = now.getTime();
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const uploadedTime =
      `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")} -0500 (EST)`;

    const validItems = items
      .map((item) => {
        const photos = item.photos
          .map((p) => {
            const pieceImageType = mapPieceImageType(p.imageType);
            if (!pieceImageType) return null;
            return {
              cleanedImage: false,
              mainImage: p.isMainImage,
              pieceImageType,
              fileName: p.fileName,
              mimeType: p.mimeType,
              photoId: p.photoId,
              fileSize: p.fileSize,
            };
          })
          .filter((p): p is NonNullable<typeof p> => p !== null);
        return { photos };
      })
      .filter((item) => item.photos.length > 0);

    if (!validItems.length) {
      return NextResponse.json(
        { error: "No valid items (only FRONT, BACK, TAG allowed)" },
        { status: 400 }
      );
    }

    const db = getFirestore();
    const uploadIds: string[] = [];
    const customerId = `TR~${taskRabbitId.trim()}`;

    for (let i = 0; i < validItems.length; i++) {
      if (i > 0) {
        await new Promise((r) => setTimeout(r, DELAY_MS_BETWEEN_DOCS));
      }

      const itemId = 1000 + i;
      const doc = {
        bgRemoved: false,
        serverUrl: SERVER_URL,
        customerId,
        uploadedTime,
        uploadedTimeMillis,
        items: [{ itemId, photos: validItems[i].photos }],
      };

      const uploadId = randomUUID();
      const docRef = db.collection(COLLECTION).doc(uploadId);

      await docRef.create(doc);
      uploadIds.push(uploadId);

      console.log("[TR-Submit] Wrote doc", {
        requestId,
        uploadId,
        itemId,
        photoCount: validItems[i].photos.length,
      });
    }

    const itemCount = validItems.length;
    const photoCount = validItems.reduce(
      (sum, item) => sum + item.photos.length,
      0
    );

    return NextResponse.json({
      uploadIds,
      uploadId: uploadIds[0],
      itemCount,
      photoCount,
    });
  } catch (err) {
    console.error("Submit error:", err);
    const message =
      err instanceof Error ? err.message : "Submit failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
