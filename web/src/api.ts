let ready: Promise<void> | null = null;

async function bootstrap() {
  ready ??= fetch("/api/session/bootstrap", { method: "POST", credentials: "include" }).then((response) => {
    if (!response.ok) throw new Error("本机会话没有建立");
  });
  await ready;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  await bootstrap();
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "x-viva-request": "1",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(body.error || `请求失败 ${response.status}`);
  return body as T;
}
