const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".heic"]);

export function getFileExtension(fileName = "") {
  const dotIndex = String(fileName).lastIndexOf(".");
  return dotIndex >= 0 ? String(fileName).slice(dotIndex).toLowerCase() : "";
}

export function isPdfFile(file) {
  return file?.type === "application/pdf" || getFileExtension(file?.name) === ".pdf";
}

export function isPreviewableImage(file) {
  return Boolean(file && !isPdfFile(file) && (file.type?.startsWith("image/") || imageExtensions.has(getFileExtension(file.name))));
}

export function createImagePreview(file, urlApi = URL) {
  const url = urlApi.createObjectURL(file);
  return { url, revoke: () => urlApi.revokeObjectURL(url) };
}
