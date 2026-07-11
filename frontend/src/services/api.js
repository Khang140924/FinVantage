const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL || "";

export const API_BASE_URL = rawApiBaseUrl.replace(/\/+$/, "");
export const DEFAULT_USER_ID = import.meta.env.VITE_DEMO_USER_ID || "demo-user";
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
  let response;

  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new ApiError("Network error while calling the backend.", {
      code: "NETWORK_ERROR",
      data: { cause: error?.message },
    });
  }

  const data = await readResponseBody(response);

  if (!response.ok) {
    throw new ApiError(
      data?.message || data?.error || `Backend request failed with status ${response.status}.`,
      { status: response.status, data, code: "BACKEND_REQUEST_FAILED" }
    );
  }

  return data;
}

export function importInvoice(file) {
  return apiRequest("/invoices/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
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

export function analyzeInvoice(invoiceId, { cacheKey, userId = DEFAULT_USER_ID } = {}) {
  return apiRequest(`/invoices/${encodeURIComponent(invoiceId)}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cacheKey, userId }),
  });
}

export function getInvoices(userId = DEFAULT_USER_ID) {
  const params = new URLSearchParams({ userId });
  return apiRequest(`/invoices?${params.toString()}`);
}

export function getDashboardSummary(userId = DEFAULT_USER_ID) {
  const params = new URLSearchParams({ userId });
  return apiRequest(`/dashboard-summary?${params.toString()}`);
}
