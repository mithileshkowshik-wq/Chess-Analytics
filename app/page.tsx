import { UsernameForm } from "@/components/username-form";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="text-center space-y-6 max-w-xl w-full">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">
            Chess<span className="text-emerald-400">.com</span> Analytics
          </h1>
          <p className="text-slate-400 text-lg">
            See how much time you spend playing chess and track your rating
            over time.
          </p>
        </div>

        <UsernameForm />

        <p className="text-xs text-slate-600">
          Powered by the Chess.com public API · no account required
        </p>
      </div>
    </main>
  );
}
