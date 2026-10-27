"use client";

function uploadMime(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ({ pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain", xml: "application/xml", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", tiff: "image/tiff" } as Record<string, string>)[ext ?? ""] ?? "application/octet-stream";
}

async function jsonResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Error al cargar el archivo");
  return body;
}

export async function uploadContractFile(file: File, onProgress?: (fraction: number) => void): Promise<string> {
  const started = await jsonResponse(await fetch("/api/v1/contracts/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, mimeType: uploadMime(file), sizeBytes: file.size }) }));
  const id = String(started.id);
  const chunkBytes = Number(started.chunkBytes);
  try {
    for (let offset = 0, part = 1; offset < file.size; offset += chunkBytes, part++) {
      const response = await fetch(`/api/v1/contracts/uploads/${id}/parts/${part}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file.slice(offset, Math.min(file.size, offset + chunkBytes)) });
      await jsonResponse(response);
      onProgress?.(Math.min(1, (offset + chunkBytes) / file.size));
    }
    await jsonResponse(await fetch(`/api/v1/contracts/uploads/${id}`, { method: "POST" }));
    return id;
  } catch (error) {
    await fetch(`/api/v1/contracts/uploads/${id}`, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
}
