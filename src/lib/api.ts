// Shared API helpers: BigInt-safe JSON, typed errors, and a route wrapper that
// maps domain errors (TransitionError, ZodError, ApiError) to HTTP responses.
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { TransitionError } from "@/lib/status";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** JSON.stringify replacer that renders BigInt (paise) as a decimal string. */
function bigintReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

export function json(data: unknown, init?: ResponseInit): NextResponse {
  return new NextResponse(JSON.stringify(data, bigintReplacer), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

export function errorResponse(status: number, code: string, message: string): NextResponse {
  return json({ error: { code, message } }, { status });
}

/** Parse a JSON body, returning {} for an empty body and 400 for malformed JSON. */
export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "BAD_JSON", "Request body is not valid JSON.");
  }
}

/** Wrap a route handler so thrown domain errors become clean HTTP responses. */
export function route<Args extends unknown[]>(
  fn: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof TransitionError) {
        return errorResponse(e.httpStatus, e.code, e.message);
      }
      if (e instanceof ApiError) {
        return errorResponse(e.status, e.code, e.message);
      }
      if (e instanceof ZodError) {
        return errorResponse(400, "VALIDATION", e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      }
      console.error("[api] unhandled error", e);
      return errorResponse(500, "INTERNAL", "Something went wrong.");
    }
  };
}
