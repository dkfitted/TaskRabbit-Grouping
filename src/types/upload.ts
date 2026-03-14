export type PieceImageType = "FRONT" | "BACK" | "TAG";

export interface LocalPhoto {
  id: string;
  file: File;
  previewUrl: string;
}

export interface GroupedItem {
  id: string;
  photos: { localPhotoId: string; imageType: PieceImageType }[];
}

export interface UploadImageResponse {
  photoId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export interface SubmitResponse {
  uploadIds: string[];
  uploadId: string;
  itemCount: number;
  photoCount: number;
}
