import { useEffect, useState } from "react";
import { api } from "./api";
import { Ask, Knowledge, Overview, Proposals, Runs, Settings, Sources } from "./screens";

const NAV = [
  ["overview", "总览"],
  ["sources", "来源"],
  ["knowledge", "知识"],
  ["runs", "运行"],
  ["proposals", "提案"],
  ["ask", "提问"],
  ["settings", "设置"],
] as const;

type Page = (typeof NAV)[number][0];

export function App() {
  const [page, setPage] = useState<Page>(readPage());
  const [desired, setDesired] = useState("stopped");
  const [error, setError] = useState("");

  useEffect(() => {
    const onHash = () => setPage(readPage());
    window.addEventListener("hashchange", onHash);
    api<{ desired: string }>("/api/autopilot").then((row) => setDesired(row.desired)).catch((reason) => setError(String(reason.message || reason)));
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="min-h-screen">
      <a className="skip" href="#main">跳到主要内容</a>
      <header className="border-b border-[#d9d1c3] bg-[#fffdf8]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div>
            <p className="text-xs tracking-[0.18em] text-[#3f3a33]">VIVA · 活的知识</p>
            <h1 className="text-2xl font-semibold">知识工程工作台</h1>
          </div>
          <p className="rounded-full border border-[#cfc6b8] px-3 py-1 text-sm" aria-live="polite">
            自动驾驶：{desired === "running" ? "运行中" : "已停止"}
          </p>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 md:grid-cols-[12rem_1fr]">
        <nav aria-label="工作台" className="flex gap-2 overflow-auto md:flex-col">
          {NAV.map(([id, label]) => (
            <a key={id} href={`#/${id}`} aria-current={page === id ? "page" : undefined} className={`rounded-md px-3 py-2 text-sm ${page === id ? "bg-[#0b5d43] text-white" : "bg-white"}`}>
              {label}
            </a>
          ))}
        </nav>
        <main id="main" className="min-w-0">
          {error ? <p role="alert" className="mb-4 rounded-md bg-[#f8e8e4] px-3 py-2 text-sm">{error}</p> : null}
          {page === "overview" && <Overview onDesired={setDesired} />}
          {page === "sources" && <Sources />}
          {page === "knowledge" && <Knowledge />}
          {page === "runs" && <Runs onDesired={setDesired} />}
          {page === "proposals" && <Proposals />}
          {page === "ask" && <Ask />}
          {page === "settings" && <Settings />}
        </main>
      </div>
    </div>
  );
}

function readPage(): Page {
  const name = window.location.hash.replace("#/", "") as Page;
  return NAV.some(([id]) => id === name) ? name : "overview";
}
