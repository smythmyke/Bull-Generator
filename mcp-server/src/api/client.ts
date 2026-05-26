const DEFAULT_API_BASE = "https://us-central1-solicitation-matcher-extension.cloudfunctions.net/ai/v1";

export interface ApiClientOptions {
  apiKey: string;
  baseUrl?: string;
}

export class PatentSearchApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string
  ) {
    super(message);
    this.name = "PatentSearchApiError";
  }
}

export class PatentSearchApiClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(opts: ApiClientOptions) {
    if (!opts.apiKey) {
      throw new Error("PATENT_SEARCH_API_KEY is required");
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_API_BASE).replace(/\/$/, "");
  }

  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const res = await fetch(url, {
      method,
      headers: {
        "X-API-Key": this.apiKey,
        "Content-Type": "application/json",
        "User-Agent": "patent-search-mcp-server/0.1.0",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { error: text };
    }

    if (!res.ok) {
      const errorMessage =
        (parsed as { error?: string }).error ?? `HTTP ${res.status}`;
      throw new PatentSearchApiError(
        humanizeError(res.status, errorMessage),
        res.status,
        codeForStatus(res.status)
      );
    }

    const wrapper = parsed as { data?: T };
    return (wrapper.data ?? parsed) as T;
  }
}

function codeForStatus(status: number): string {
  switch (status) {
    case 401:
      return "unauthenticated";
    case 402:
      return "payment_required";
    case 403:
      return "permission_denied";
    case 404:
      return "not_found";
    case 429:
      return "rate_limited";
    default:
      return status >= 500 ? "server_error" : "bad_request";
  }
}

function humanizeError(status: number, message: string): string {
  switch (status) {
    case 401:
      return "Invalid or missing PATENT_SEARCH_API_KEY. Mint a new key from the AI Patent Search Generator Chrome extension's Admin tab.";
    case 402:
      return "Out of credits. Purchase a credit pack from the extension's Tools tab.";
    case 429:
      return "Rate limit exceeded. Wait a moment and retry.";
    default:
      return message;
  }
}
