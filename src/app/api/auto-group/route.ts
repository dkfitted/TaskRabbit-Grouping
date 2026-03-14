import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const VISION_MODEL = "google/gemini-2.5-flash";

interface PhotoInput {
  id: string;
  base64: string;
  mimeType: string;
  fileName: string;
}

interface GroupedPhotoResult {
  photoId: string;
  imageType: "FRONT" | "BACK" | "TAG";
  isMain: boolean;
}

interface GroupResult {
  photos: GroupedPhotoResult[];
}

export interface AutoGroupResponse {
  groups: GroupResult[];
}

const GROUPING_PROMPT = `You are a clothing photo analysis AI. You will receive multiple photos of clothing items. Some photos may show the SAME clothing item from different angles or views.

Your task:
1. **Group** photos that show the SAME physical clothing item together. Photos of different items go in different groups.
2. **Classify** each photo's view type (use ONLY these three types):
   - "FRONT" = front view of the garment
   - "BACK" = back view of the garment, or any alternative angle (side, detail shot, etc.)
   - "TAG" = brand tag, care label, size tag, or price tag
3. **Pick the best main image** for each group (the clearest, most representative front-facing photo).

Key rules:
- Two photos belong to the same group ONLY if they clearly show the exact same physical garment (same color, pattern, brand, style).
- When in doubt, keep them as separate items.
- Every group must have exactly one photo marked as main (isMain: true).
- The main image should be a FRONT view when available.
- Use ONLY "FRONT", "BACK", or "TAG" for imageType. Never use "DETAIL". For close-up or detail shots, use "BACK".

Respond with ONLY valid JSON (no markdown, no backticks) in this exact format:
{
  "groups": [
    {
      "photos": [
        { "photoId": "<the photo's ID from the input>", "imageType": "FRONT", "isMain": true },
        { "photoId": "<another photo ID>", "imageType": "BACK", "isMain": false }
      ]
    }
  ]
}

The photos are labeled with IDs. Use those exact IDs in your response.`;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENROUTER_API_KEY not configured" },
        { status: 500 }
      );
    }

    const { photos } = (await req.json()) as { photos: PhotoInput[] };

    if (!photos?.length) {
      return NextResponse.json(
        { error: "No photos provided" },
        { status: 400 }
      );
    }

    if (photos.length > 100) {
      return NextResponse.json(
        { error: "Maximum 100 photos per request" },
        { status: 400 }
      );
    }

    const photoLabels = photos
      .map((p, i) => `Photo ${i + 1} (ID: "${p.id}"): ${p.fileName}`)
      .join("\n");

    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [];

    content.push({
      type: "text",
      text: `${GROUPING_PROMPT}\n\nHere are ${photos.length} clothing photos to analyze:\n${photoLabels}\n\nThe images follow in order:`,
    });

    for (const photo of photos) {
      const mime = photo.mimeType || "image/jpeg";
      content.push({
        type: "image_url",
        image_url: { url: `data:${mime};base64,${photo.base64}` },
      });
      content.push({
        type: "text",
        text: `(Photo ID: "${photo.id}")`,
      });
    }

    content.push({
      type: "text",
      text: "Now analyze all photos above and return the JSON grouping result.",
    });

    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [{ role: "user", content }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("OpenRouter error:", err);
      return NextResponse.json(
        { error: "AI service failed", details: err },
        { status: 502 }
      );
    }

    const json = await res.json();
    const rawText = json.choices?.[0]?.message?.content?.trim() || "";

    let cleaned = rawText;
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    let parsed: AutoGroupResponse;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", rawText);
      return NextResponse.json(
        { error: "AI returned invalid JSON. Please try again.", raw: rawText },
        { status: 502 }
      );
    }

    const validPhotoIds = new Set(photos.map((p) => p.id));
    parsed.groups = parsed.groups.filter((group) => {
      group.photos = group.photos.filter((p) => validPhotoIds.has(p.photoId));
      return group.photos.length > 0;
    });

    for (const group of parsed.groups) {
      for (const p of group.photos) {
        if ((p as { imageType: string }).imageType === "DETAIL") {
          (p as { imageType: "FRONT" | "BACK" | "TAG" }).imageType = "BACK";
        }
      }
    }

    for (const group of parsed.groups) {
      const hasMain = group.photos.some((p) => p.isMain);
      if (!hasMain && group.photos.length > 0) {
        const frontPhoto = group.photos.find((p) => p.imageType === "FRONT");
        (frontPhoto || group.photos[0]).isMain = true;
      }
    }

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("Auto-group error:", error);
    return NextResponse.json(
      { error: "Failed to auto-group photos" },
      { status: 500 }
    );
  }
}
