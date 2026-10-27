/**
 * Hands a downloaded blob to the browser's save dialog. The temporary anchor
 * keeps the download working across browsers without opening a new tab.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a tick to start reading the blob before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
