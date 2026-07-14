// File handling for instruction + proof uploads.
// Stored on local disk under UPLOAD_DIR (outside the web root, never /public),
// with a randomised filename. The original name is kept for display only.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "@/lib/api";

const MAX_MB = Number(process.env.MAX_UPLOAD_MB ?? "10");
export const MAX_BYTES = MAX_MB * 1024 * 1024;

function uploadDir(): string {
  return path.resolve(process.env.UPLOAD_DIR ?? "./var/uploads");
}

function isAllowedMime(mime: string): boolean {
  return mime.startsWith("image/") || mime === "application/pdf";
}

function extFor(mime: string, originalName: string): string {
  const fromName = path.extname(originalName).toLowerCase();
  if (fromName) return fromName;
  if (mime === "application/pdf") return ".pdf";
  if (mime.startsWith("image/")) return "." + mime.slice("image/".length);
  return "";
}

export interface SavedFile {
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
}

/** Validate + persist an uploaded File. Throws ApiError on bad type/size. */
export async function saveUpload(file: File): Promise<SavedFile> {
  const mimeType = file.type || "application/octet-stream";
  if (!isAllowedMime(mimeType)) {
    throw new ApiError(415, "UNSUPPORTED_TYPE", "Only images and PDF files are allowed.");
  }
  if (file.size > MAX_BYTES) {
    throw new ApiError(413, "TOO_LARGE", `File is larger than ${MAX_MB} MB.`);
  }
  const originalName = file.name || "upload";
  const storedName = `${randomUUID()}${extFor(mimeType, originalName)}`;

  const dir = uploadDir();
  await mkdir(dir, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  // Guard against a truncated/oversized stream that dodged file.size.
  if (buffer.byteLength > MAX_BYTES) {
    throw new ApiError(413, "TOO_LARGE", `File is larger than ${MAX_MB} MB.`);
  }
  await writeFile(path.join(dir, storedName), buffer);

  return { originalName, storedName, mimeType, size: buffer.byteLength };
}

/** Read a stored file's bytes. storedName is validated to prevent traversal. */
export async function readUpload(storedName: string): Promise<Buffer> {
  if (!/^[A-Za-z0-9._-]+$/.test(storedName) || storedName.includes("..")) {
    throw new ApiError(400, "BAD_NAME", "Invalid file reference.");
  }
  const full = path.join(uploadDir(), storedName);
  try {
    return await readFile(full);
  } catch {
    throw new ApiError(404, "NOT_FOUND", "File not found.");
  }
}
