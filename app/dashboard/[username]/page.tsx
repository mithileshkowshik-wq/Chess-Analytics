import { Dashboard } from "@/components/dashboard";
import Link from "next/link";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const decoded = decodeURIComponent(username);

  return (
    <div className="min-h-screen px-4 py-8 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-8">
        <div>
          <Link href="/" className="text-slate-500 hover:text-slate-300 text-sm mb-1 inline-block">
            ← Back
          </Link>
          <h1 className="text-2xl font-bold">
            <span className="text-slate-400">@</span>
            {decoded}
          </h1>
        </div>
        <div className="text-sm text-slate-500">Chess.com Analytics</div>
      </header>

      <Dashboard username={decoded} />
    </div>
  );
}
