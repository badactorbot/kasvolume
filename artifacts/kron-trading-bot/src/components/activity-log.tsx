import { useGetBotActivity, getGetBotActivityQueryKey } from "@workspace/api-client-react"
import { ListTodo, ArrowDownToLine, ArrowUpFromLine, Info, ShieldAlert } from "lucide-react"
import { formatKas } from "@/lib/utils"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

export function ActivityLog() {
  const { data: activities, isLoading } = useGetBotActivity(
    { limit: 50 },
    { query: { refetchInterval: 5000, queryKey: getGetBotActivityQueryKey({ limit: 50 }) } }
  )

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'buy': return <ArrowDownToLine className="w-4 h-4 text-success" />
      case 'sell': return <ArrowUpFromLine className="w-4 h-4 text-destructive" />
      case 'safety': return <ShieldAlert className="w-4 h-4 text-warning" />
      default: return <Info className="w-4 h-4 text-muted-foreground" />
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed': return <Badge variant="success" className="text-[10px] uppercase font-mono">Real</Badge>
      case 'simulated': return <Badge variant="secondary" className="text-[10px] uppercase font-mono">Sim</Badge>
      case 'blocked': return <Badge variant="destructive" className="text-[10px] uppercase font-mono">Blocked</Badge>
      default: return <Badge variant="outline" className="text-[10px] uppercase font-mono">{status}</Badge>
    }
  }

  return (
    <Card className="flex-1 flex flex-col min-h-0">
      <CardHeader className="py-4 border-b border-border bg-muted/10">
        <CardTitle className="text-lg flex items-center gap-2">
          <ListTodo className="w-5 h-5" />
          Execution Log
        </CardTitle>
        <CardDescription>
          Recent actions and safety blocks.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto p-0">
        {isLoading ? (
          <div className="p-4 space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : activities && activities.length > 0 ? (
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-[0_1px_0_0_hsl(var(--border))]">
              <TableRow>
                <TableHead className="w-[180px]">Timestamp</TableHead>
                <TableHead className="w-[100px]">Action</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead className="text-right w-[140px]">Amount</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activities.map((entry) => (
                <TableRow key={entry.id} className="font-mono text-sm hover:bg-muted/30 transition-colors">
                  <TableCell className="text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleString(undefined, { 
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' 
                    })}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 capitalize">
                      {getActionIcon(entry.action)}
                      {entry.action}
                    </div>
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(entry.status)}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {entry.amountKas > 0 ? formatKas(entry.amountKas) : "-"}
                  </TableCell>
                  <TableCell className="font-sans text-muted-foreground max-w-xs truncate" title={entry.detail}>
                    {entry.detail}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
            <ListTodo className="w-8 h-8 mb-2 opacity-50" />
            <p>No recent activity</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
