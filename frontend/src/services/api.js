const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL || "";

export const API_BASE_URL = rawApiBaseUrl.replace(/\/+$/, "");
export const isApiConfigured = Boolean(API_BASE_URL);

export class ApiError extends Error {
  constructor(message, { status = 0, data = null, code = "API_ERROR" } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
    this.code = code;
  }
}

function getIdToken() {
  try {
    return window.localStorage.getItem("finvantage-id-token") || "";
  } catch {
    return "";
  }
}

function buildApiUrl(path) {
  if (!isApiConfigured) {
    throw new ApiError("Set VITE_API_BASE_URL before calling the backend.", {
      code: "MISSING_API_BASE_URL",
    });
  }

  return `${API_BASE_URL}${path}`;
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function apiRequest(path, options = {}) {
  const url = buildApiUrl(path);
  const idToken = getIdToken();
  const { timeoutMs = 45000, ...requestOptions } = options;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  const headers = {
    ...(requestOptions.headers || {}),
    ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
  };

  let response;

  try {
    response = await fetch(url, { ...requestOptions, headers, signal: requestOptions.signal || controller.signal });
  } catch (error) {
    window.clearTimeout(timeoutId);
    throw new ApiError("Network error while calling the backend.", {
      code: error?.name === "AbortError" ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
      data: { cause: error?.message },
    });
  }

  window.clearTimeout(timeoutId);

  const data = await readResponseBody(response);

  if (!response.ok) {
    if (response.status === 401) {
      window.localStorage.removeItem("finvantage-id-token");
      window.dispatchEvent(new CustomEvent("finvantage:unauthorized"));
    }
    throw new ApiError(
      data?.message || data?.error || `Backend request failed with status ${response.status}.`,
      { status: response.status, data, code: data?.code || "BACKEND_REQUEST_FAILED" }
    );
  }

  return data;
}

async function getFileSha256(file) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function importInvoice(file) {
  const contentSha256 = await getFileSha256(file);
  return apiRequest("/invoices/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      ...(contentSha256 ? { contentSha256 } : {}),
    }),
  });
}

export async function uploadInvoiceFile(uploadUrl, file) {
  if (!uploadUrl) {
    throw new ApiError("Backend import did not return an upload URL.", {
      code: "MISSING_UPLOAD_URL",
    });
  }

  let response;

  try {
    response = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
  } catch (error) {
    throw new ApiError("Network error while uploading to S3.", {
      code: "S3_NETWORK_ERROR",
      data: { cause: error?.message },
    });
  }

  if (!response.ok) {
    throw new ApiError(`S3 upload failed with status ${response.status}.`, {
      status: response.status,
      code: "S3_UPLOAD_FAILED",
    });
  }

  return true;
}

export function runInvoiceOcr(invoiceId, { fileKey, cacheKey } = {}) {
  return apiRequest(`/invoices/${encodeURIComponent(invoiceId)}/ocr`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileKey, cacheKey }),
  });
}

export function analyzeInvoice(invoiceId, { cacheKey } = {}) {
  return apiRequest(`/invoices/${encodeURIComponent(invoiceId)}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cacheKey }),
  });
}

export function getInvoices() {
  return apiRequest(`/invoices`);
}

export function searchInvoices(query, limit = 20) {
  const trimmed = String(query || "").trim();
  if (trimmed.length < 2) return Promise.resolve({ results: [], query: trimmed });
  return apiRequest(`/search?q=${encodeURIComponent(trimmed)}&limit=${encodeURIComponent(limit)}`);
}

export function getDashboardSummary(month = null) {
  const query = month ? `?month=${encodeURIComponent(month)}` : "";
  return apiRequest(`/dashboard-summary${query}`);
}

export function getInvoice(invoiceId) {
  return apiRequest(`/invoices/${encodeURIComponent(invoiceId)}`);
}

export function getInvoiceStatus(invoiceId, { signal } = {}) {
  return apiRequest(`/invoices/${encodeURIComponent(invoiceId)}/status`, {
    method: "GET",
    signal,
    timeoutMs: 10000,
  });
}

export function updateInvoice(invoiceId, changes) {
  return apiRequest(`/invoices/${encodeURIComponent(invoiceId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
}

export function deleteInvoice(invoiceId) {
  return apiRequest(`/invoices/${encodeURIComponent(invoiceId)}`, { method: "DELETE" });
}

export function getBudgets() {
  return apiRequest("/budgets");
}

export function saveBudget(category, amount) {
  return apiRequest("/budgets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category, amount }),
  });
}

export function deleteBudget(budgetId) {
  return apiRequest(`/budgets/${encodeURIComponent(budgetId)}`, { method: "DELETE" });
}

export function getMe() {
  return apiRequest("/me");
}

export function updateMe(changes) {
  return apiRequest("/me", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
}

export function getPreferences() {
  return apiRequest("/me/preferences");
}

export function updatePreferences(changes) {
  return apiRequest("/me/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
}

export function createAvatarUpload(file) {
  return apiRequest("/me/avatar/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, fileSize: file.size }),
  });
}

export function uploadAvatarFile(uploadUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl);
    request.setRequestHeader("Content-Type", file.type);
    request.setRequestHeader("x-amz-server-side-encryption", "AES256");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve(true);
      else reject(new ApiError(`Avatar upload failed with status ${request.status}.`, { status: request.status, code: "S3_AVATAR_UPLOAD_FAILED" }));
    };
    request.onerror = () => reject(new ApiError("Network error while uploading avatar to S3.", { code: "S3_AVATAR_NETWORK_ERROR" }));
    request.send(file);
  });
}

export function getNotifications(limit = 50) {
  return apiRequest(`/notifications?limit=${encodeURIComponent(limit)}`);
}

export function getUnreadNotificationCount() {
  return apiRequest("/notifications/unread-count");
}

export function markNotificationRead(notificationId) {
  return apiRequest(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: "PUT" });
}

export function markAllNotificationsRead() {
  return apiRequest("/notifications/read-all", { method: "PUT" });
}

export function deleteNotification(notificationId) {
  return apiRequest(`/notifications/${encodeURIComponent(notificationId)}`, { method: "DELETE" });
}
