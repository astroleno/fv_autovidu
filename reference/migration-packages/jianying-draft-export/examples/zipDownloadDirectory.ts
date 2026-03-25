const ZIP_SAVE_PICKER_ID = "ugcflow-veo-zip-download";

export function supportsZipSavePicker(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

export function inferZipFileName(zipPath: string | null | undefined): string {
  const normalized = String(zipPath || "")
    .trim()
    .replace(/\\/g, "/");
  const fileName = normalized.split("/").pop();
  return fileName && fileName.endsWith(".zip") ? fileName : "veo-export.zip";
}

export async function saveBlobWithZipSavePicker(
  blob: Blob,
  fileName: string,
): Promise<void> {
  if (!supportsZipSavePicker()) {
    throw new Error("当前环境不支持系统保存弹窗");
  }

  const handle = await window.showSaveFilePicker({
    id: ZIP_SAVE_PICKER_ID,
    suggestedName: fileName,
    startIn: "downloads",
    types: [
      {
        description: "ZIP Archive",
        accept: {
          "application/zip": [".zip"],
        },
      },
    ],
  });

  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}

export function normalizeZipSavePickerError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("AbortError")) {
    return "已取消保存";
  }
  return message;
}

export function triggerBrowserBlobDownload(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}
