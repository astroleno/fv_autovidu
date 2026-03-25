import * as Dialog from "@radix-ui/react-dialog";
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../services/api";
import { VeoDraftExportState } from "../../types/veo";
import {
  inferZipFileName,
  saveBlobWithZipSavePicker,
  supportsZipSavePicker,
  triggerBrowserBlobDownload,
} from "../../utils/zipDownloadDirectory";

interface VeoDraftExportModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  variantId: string;
  draftExport?: VeoDraftExportState | null;
  missingShots?: string[];
  onExported?: () => void;
}

type TargetOS = "windows" | "macos";

const DEFAULT_JIANYING_PATH_WINDOWS =
  "C:\\Users\\admin\\AppData\\Local\\JianyingPro\\User Data\\Projects\\com.lveditor.draft";
const DEFAULT_JIANYING_PATH_MACOS =
  "/Users/你的用户名/Movies/JianyingPro/User Data/Projects/com.lveditor.draft";
const MACOS_PATH_PLACEHOLDER =
  "/Users/你的用户名/Movies/JianyingPro/User Data/Projects/com.lveditor.draft";
const STORAGE_KEY_WINDOWS = "ugcflow_veo_jianying_path_windows";
const STORAGE_KEY_MACOS = "ugcflow_veo_jianying_path_macos";

function detectUserOS(): TargetOS {
  const platform = navigator.platform.toLowerCase();
  return platform.includes("mac") ? "macos" : "windows";
}

function getStorageKey(targetOS: TargetOS): string {
  return targetOS === "macos" ? STORAGE_KEY_MACOS : STORAGE_KEY_WINDOWS;
}

function getDefaultPath(targetOS: TargetOS): string {
  return targetOS === "macos"
    ? DEFAULT_JIANYING_PATH_MACOS
    : DEFAULT_JIANYING_PATH_WINDOWS;
}

function getSavedPath(targetOS: TargetOS): string {
  try {
    return localStorage.getItem(getStorageKey(targetOS)) || getDefaultPath(targetOS);
  } catch {
    return getDefaultPath(targetOS);
  }
}

function getStoredPath(targetOS: TargetOS): string | null {
  try {
    return localStorage.getItem(getStorageKey(targetOS));
  } catch {
    return null;
  }
}

function validateWindowsPath(value: string): boolean {
  if (!value.trim()) return false;
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value);
}

function validateMacPath(value: string): boolean {
  if (!value.trim()) return false;
  return value.startsWith("/");
}

function normalizeExportError(error: unknown, createZip: boolean): string {
  const message = error instanceof Error ? error.message : String(error);
  if (createZip && message.includes("AbortError")) {
    return "已取消保存";
  }
  if (createZip && message.includes("剪映草稿导出失败")) {
    return "视频打包失败";
  }
  return message;
}

export function VeoDraftExportModal({
  open,
  onClose,
  projectId,
  variantId,
  draftExport,
  missingShots = [],
  onExported,
}: VeoDraftExportModalProps) {
  const [targetOS, setTargetOS] = useState<TargetOS>(detectUserOS);
  const [draftPath, setDraftPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"draft" | "zip" | null>(null);
  const supportsZipPicker = supportsZipSavePicker();

  useEffect(() => {
    if (!open) return;
    const detected = detectUserOS();
    const storedPath = getStoredPath(detected);
    const initialPath =
      draftExport?.targetPath || storedPath || getDefaultPath(detected);
    setTargetOS(detected);
    setDraftPath(initialPath);
    setError(null);

    if (draftExport?.targetPath || storedPath) {
      return;
    }

    let cancelled = false;
    void api
      .getJianyingDraftPath()
      .then((result) => {
        if (cancelled) return;
        if (
          result.data.os === detected &&
          result.data.exists &&
          result.data.detectedPath
        ) {
          setDraftPath(result.data.detectedPath);
        }
      })
      .catch(() => {
        // ignore detection failure and keep fallback default
      });

    return () => {
      cancelled = true;
    };
  }, [open, draftExport?.targetPath]);

  const validatePath = useMemo(() => {
    return targetOS === "macos" ? validateMacPath : validateWindowsPath;
  }, [targetOS]);

  const pathPlaceholder =
    targetOS === "macos" ? MACOS_PATH_PLACEHOLDER : DEFAULT_JIANYING_PATH_WINDOWS;

  const pathError =
    draftPath.trim().length > 0 && !validatePath(draftPath)
      ? targetOS === "macos"
        ? "请输入 macOS 绝对路径"
        : "请输入 Windows 绝对路径"
      : null;

  const handleTargetOSChange = (nextOS: TargetOS) => {
    setTargetOS(nextOS);
    setDraftPath(getSavedPath(nextOS));
    setError(null);
  };

  const persistPath = () => {
    try {
      localStorage.setItem(getStorageKey(targetOS), draftPath.trim());
    } catch {
      // ignore storage issues
    }
  };

  const submitExport = async (createZip: boolean) => {
    const trimmedDraftPath = draftPath.trim();
    const shouldExportDraftDir = !createZip;

    if (shouldExportDraftDir && !trimmedDraftPath) {
      setError("请先输入本地路径");
      return;
    }
    if (shouldExportDraftDir && pathError) {
      setError(pathError);
      return;
    }

    setSubmitting(createZip ? "zip" : "draft");
    setError(null);
    try {
      const exportResult = await api.exportVeoDraft(projectId, variantId, {
        draftPath: shouldExportDraftDir ? trimmedDraftPath : undefined,
        createZip,
      });

      if (createZip) {
        const zipBlob = await api.downloadVeoDraftZip(projectId, variantId);
        const zipFileName = inferZipFileName(exportResult.data?.zipPath);

        if (supportsZipPicker) {
          await saveBlobWithZipSavePicker(zipBlob, zipFileName);
        } else {
          triggerBrowserBlobDownload(zipBlob, zipFileName);
        }
      }

      if (shouldExportDraftDir) {
        persistPath();
      }
      onExported?.();
    } catch (e) {
      setError(normalizeExportError(e, createZip));
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[90] animate-in fade-in" />
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <Dialog.Content className="w-full max-w-2xl border bg-background shadow-lg sm:rounded-lg animate-in fade-in-90 zoom-in-95">
            <div className="border-b border-border px-6 py-4">
              <Dialog.Title className="text-base font-semibold tracking-tight">
                导出成片 / 剪映草稿
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                “打包下载”只生成 ZIP，不写入剪映目录；“导出草稿”才会把内容写到下面的剪映草稿根目录。
              </Dialog.Description>
            </div>

            <div className="p-6 space-y-5">
              <div className="space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  目标系统
                </div>
                <div className="flex gap-2">
                  {(["windows", "macos"] as const).map((os) => (
                    <button
                      key={os}
                      onClick={() => handleTargetOSChange(os)}
                      className={[
                        "px-3 py-1.5 text-xs font-mono border transition-all",
                        targetOS === os
                          ? "border-accent text-accent"
                          : "border-border text-muted-foreground hover:border-muted-foreground",
                      ].join(" ")}
                    >
                      {os}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  草稿路径
                </div>
                <input
                  value={draftPath}
                  onChange={(e) => setDraftPath(e.target.value)}
                  placeholder={pathPlaceholder}
                  className="w-full bg-background border border-border text-xs font-mono px-3 py-2 focus:outline-none focus:border-accent"
                />
                <div className="text-[10px] font-mono text-muted-foreground leading-relaxed">
                  这里填剪映草稿根目录，不用手动输入最终的 `veo-draft-xxx` 子目录。
                </div>
                {pathError && (
                  <div className="text-[10px] font-mono text-red-400">{pathError}</div>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  ZIP 保存方式
                </div>
                <div className="border border-border px-3 py-3 space-y-2">
                  <div className="text-[10px] font-mono text-muted-foreground leading-relaxed">
                    这条线只给“打包下载”用，和上面的剪映草稿路径完全独立。
                  </div>
                  {supportsZipPicker ? (
                    <div className="text-[10px] font-mono text-muted-foreground leading-relaxed">
                      点击“打包下载”时会弹出系统保存窗口。你可以每次手工选择保存地址，浏览器会按 ZIP 下载场景记住最近一次位置。
                    </div>
                  ) : (
                    <div className="text-[10px] font-mono text-yellow-400">
                      当前环境不支持系统保存窗口，将回退为浏览器直接下载。
                    </div>
                  )}
                </div>
              </div>

              {missingShots.length > 0 && (
                <div className="border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-[10px] font-mono text-yellow-400">
                  当前仍有未完成 shots: {missingShots.join(", ")}。导出将只包含已完成片段。
                </div>
              )}

              {draftExport?.warning && (
                <div className="border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-[10px] font-mono text-yellow-400">
                  {draftExport.warning}
                </div>
              )}

              {draftExport?.draftDir && (
                <div className="border border-border px-3 py-2 space-y-1">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    最近一次导出
                  </div>
                  <div className="text-[10px] font-mono break-all text-muted-foreground">
                    目录: {draftExport.draftDir}
                  </div>
                  {draftExport.zipPath && (
                    <div className="text-[10px] font-mono break-all text-muted-foreground">
                      ZIP: {draftExport.zipPath}
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div className="border border-red-500/30 bg-red-500/5 px-3 py-2 text-[10px] font-mono text-red-400">
                  {error}
                </div>
              )}
            </div>

            <div className="border-t border-border px-6 py-4 flex items-center justify-between gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-xs font-mono border border-border text-muted-foreground hover:border-muted-foreground transition-all"
              >
                关闭
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => submitExport(true)}
                  disabled={submitting !== null}
                  className="px-4 py-2 text-xs font-mono border border-border text-muted-foreground hover:border-accent hover:text-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting === "zip" ? "打包中…" : "打包下载"}
                </button>
                <button
                  onClick={() => submitExport(false)}
                  disabled={submitting !== null}
                  className="px-4 py-2 text-xs font-mono border border-accent text-accent hover:bg-accent hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting === "draft" ? "导出中…" : "导出草稿"}
                </button>
              </div>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default VeoDraftExportModal;
