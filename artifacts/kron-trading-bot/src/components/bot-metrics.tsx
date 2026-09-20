import { BotState } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatKas } from "@/lib/utils"
import { Target, ArrowRightLeft, ShieldAlert, Clock } from "lucide-react"

export function BotMetrics({ state }: { state: BotState }) {
  
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-xl flex items-center gap-2">
          <Target className="w-5 h-5 text-muted-foreground" />
          Strategy State
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1 bg-muted/30 p-3 rounded-md border border-border/50">
            <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider flex items-center gap-1">
              <ArrowRightLeft className="w-3 h-3" /> Cycle Progress
            </span>
            <div className="flex items-end justify-between">
              <div>
                <span className="font-mono text-xl font-medium">{state.phase}</span>
              </div>
              <div className="text-xs text-muted-foreground font-mono pb-1">
                {state.phase === 'buying' ? `${state.completedBuys}/${state.config.buyCount}` : `${state.completedSells}/${state.config.sellCount}`}
              </div>
            </div>
          </div>
          
          <div className="space-y-1 bg-muted/30 p-3 rounded-md border border-border/50">
            <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider flex items-center gap-1">
              <ShieldAlert className="w-3 h-3" /> Daily Loss
            </span>
            <div className="flex items-end justify-between">
              <div className="font-mono text-xl font-medium text-destructive">
                {formatKas(state.safety.dailyLossKas)}
              </div>
              <div className="text-xs text-muted-foreground font-mono pb-1">
                / {formatKas(state.config.maxDailyLossKas)}
              </div>
            </div>
          </div>

          <div className="space-y-1 bg-muted/30 p-3 rounded-md border border-border/50">
            <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider flex items-center gap-1">
              <Clock className="w-3 h-3" /> Hourly Velocity
            </span>
            <div className="flex items-end justify-between">
              <div className="font-mono text-xl font-medium">
                {state.hourlyTradeCount}
              </div>
              <div className="text-xs text-muted-foreground font-mono pb-1">
                / {state.hourlyTradeLimit} max
              </div>
            </div>
          </div>
          
          <div className="space-y-1 bg-muted/30 p-3 rounded-md border border-border/50">
             <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider flex items-center gap-1">
              Total Today
            </span>
            <div className="flex items-end justify-between">
              <div className="font-mono text-xl font-medium">
                {state.totalTradesToday}
              </div>
              <div className="text-xs text-muted-foreground font-mono pb-1">
                trades
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
