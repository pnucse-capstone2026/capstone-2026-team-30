import { Badge } from "@/components/ui/badge";
import { NotebookStatus } from "@/lib/notebooks-api";

type NotebookStatusBadgeProps = {
  status: NotebookStatus;
};

export function NotebookStatusBadge({ status }: NotebookStatusBadgeProps) {
  switch (status) {
    case "Running":
      return (
        <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 border-emerald-500/30">
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          Running
        </Badge>
      );
    case "Stopped":
      return (
        <Badge
          variant="secondary"
          className="bg-zinc-500/15 text-zinc-600 border-zinc-500/30"
        >
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-zinc-400" />
          Stopped
        </Badge>
      );
    case "Pending":
      return (
        <Badge
          variant="outline"
          className="bg-amber-500/15 text-amber-600 border-amber-500/30"
        >
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-500 animate-ping" />
          Pending
        </Badge>
      );
    case "Failed":
      return (
        <Badge
          variant="destructive"
          className="bg-red-500/15 text-red-600 border-red-500/30"
        >
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-500" />
          Failed
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
