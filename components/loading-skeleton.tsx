import { Skeleton } from "@/components/ui/skeleton";

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-2">
            <Skeleton className="h-3 w-24 bg-slate-700" />
            <Skeleton className="h-8 w-20 bg-slate-700" />
            <Skeleton className="h-3 w-32 bg-slate-700" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[0, 1].map((i) => (
          <div key={i} className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-3">
            <Skeleton className="h-4 w-40 bg-slate-700" />
            <Skeleton className="h-[220px] w-full bg-slate-700" />
          </div>
        ))}
      </div>
    </div>
  );
}
