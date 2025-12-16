export class InvalidCertError extends Error {}

export class InvalidStatusCodeError extends Error {
  statusCode: number;

  constructor(statusCode: number) {
    super(`Request Failed. Status Code: ${statusCode}`);
    this.statusCode = statusCode;
  }
}

type FetchOptions = {
  method?: string;
  headers?: Record<string, string>;
  type?: 'json' | 'text';
  data?: any;
  expectStatusCode?: number;
  full?: boolean;
};

type FullResponse<T> = {
  headers: Record<string, string>;
  status: number;
  body: T;
};

// Lightweight browser-friendly shim that mirrors the subset of micro-ftch used by @ethereumjs/util.
export default async function fetchShim<T = unknown>(url: string, options: FetchOptions = {}): Promise<T | FullResponse<T>> {
  const { method = 'GET', headers = {}, type, data, expectStatusCode, full } = options;

  const reqInit: RequestInit = {
    method,
    headers,
  };

  if (data !== undefined) {
    reqInit.body = type === 'json' ? JSON.stringify(data) : (data as BodyInit);
    if (type === 'json' && !headers['content-type']) {
      headers['content-type'] = 'application/json';
    }
  }

  const res = await globalThis.fetch(url, reqInit);

  if (expectStatusCode !== undefined && res.status !== expectStatusCode) {
    throw new InvalidStatusCodeError(res.status);
  }

  let body: any;
  if (type === 'json') {
    body = await res.json();
  } else if (type === 'text') {
    body = await res.text();
  } else {
    body = await res.arrayBuffer();
  }

  if (full) {
    const headersObj: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headersObj[key] = value;
    });
    return { headers: headersObj, status: res.status, body };
  }

  return body as T;
}
