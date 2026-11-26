export type GithubConfig = { owner: string; repo: string; ref: string; cursor?: string | null };
export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export type SnapshotFile = { path: string; text: string };
export type GithubSnapshot = { cursor: string; files: SnapshotFile[]; removed: string[]; unchanged: boolean };

const TEXT = new Set([".md", ".markdown", ".txt", ".mdx"]);

export async function fetchGithubSnapshot(config: GithubConfig, deps: { token?: string | null; fetchImpl: FetchImpl }): Promise<GithubSnapshot> {
  const base = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "viva/0.1",
    "x-github-api-version": "2022-11-28",
  };
  if (deps.token) headers.authorization = `Bearer ${deps.token}`;
  const commit = await getJson(deps.fetchImpl, `${base}/commits/${encodeURIComponent(config.ref)}`, headers);
  const sha = String(commit.sha);
  if (config.cursor && config.cursor === sha) return { cursor: sha, files: [], removed: [], unchanged: true };
  if (config.cursor) {
    const compared = await getJson(deps.fetchImpl, `${base}/compare/${config.cursor}...${sha}`, headers);
    const files: SnapshotFile[] = [];
    const removed: string[] = [];
    for (const file of (compared.files as { filename: string; status: string }[] | undefined) ?? []) {
      if (!isText(file.filename)) continue;
      if (file.status === "removed") removed.push(file.filename);
      else files.push({ path: file.filename, text: await readContent(deps.fetchImpl, base, file.filename, sha, headers) });
    }
    return { cursor: sha, files, removed, unchanged: false };
  }
  const tree = await getJson(deps.fetchImpl, `${base}/git/trees/${sha}?recursive=1`, headers);
  const files: SnapshotFile[] = [];
  for (const node of (tree.tree as { path: string; type: string; size?: number }[]) ?? []) {
    if (node.type !== "blob" || !isText(node.path)) continue;
    if ((node.size ?? 0) > 512 * 1024) continue;
    files.push({ path: node.path, text: await readContent(deps.fetchImpl, base, node.path, sha, headers) });
  }
  return { cursor: sha, files, removed: [], unchanged: false };
}

async function readContent(fetchImpl: FetchImpl, base: string, filePath: string, sha: string, headers: Record<string, string>) {
  const payload = await getJson(fetchImpl, `${base}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}?ref=${sha}`, headers);
  const encoded = String(payload.content ?? "").replace(/\n/g, "");
  return Buffer.from(encoded, "base64").toString("utf8");
}

async function getJson(fetchImpl: FetchImpl, url: string, headers: Record<string, string>) {
  const response = await fetchImpl(url, { headers });
  if (!response.ok) throw new Error(`github_${response.status}`);
  return await response.json() as Record<string, any>;
}

function isText(filePath: string) {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 && TEXT.has(filePath.slice(dot).toLowerCase());
}

export async function openPullRequest(input: {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  token?: string | null;
  enabled: boolean;
  confirm?: string;
  fetchImpl: FetchImpl;
}) {
  if (!input.enabled || input.confirm !== "open-pull-request" || !input.token) {
    return { opened: false, reason: "publish_disabled" };
  }
  const response = await input.fetchImpl(`https://api.github.com/repos/${input.owner}/${input.repo}/pulls`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
      "user-agent": "viva/0.1",
    },
    body: JSON.stringify({ title: input.title, body: input.body, head: input.head, base: input.base }),
  });
  if (!response.ok) return { opened: false, reason: `github_${response.status}` };
  const payload = await response.json() as { html_url?: string };
  return { opened: true, url: payload.html_url ?? null };
}
