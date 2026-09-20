import { useEffect, useState } from "react"
import { useSimulateBotRun, SimulationResult } from "@workspace/api-client-react"
import { Play, Calculator, Clock, ActivitySquare, ArrowRightLeft, DollarSign, List, FastForward, CheckCircle, AlertTriangle, XCircle, Database } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"

export function LongRunSimulation() {
  const simulateRun = useSimulateBotRun()
  const [result, setResult] = useState<SimulationResult | null>(null)

  const handleRun = () => {
    simulateRun.mutate({
      data: {
        startingKas: 10000,
        hours: 100000,
        tradeFeePercent: 1.25
      }
    }, {
      onSuccess: (data) => {
        setResult(data)
      }
    })
  }

  useEffect(() => {
    handleRun()
  }, [])

  const isPending = simulateRun.isPending
  const error = simulateRun.error as any

  return (
    <Card className="flex-1 flex flex-col border-2 border-primary/5 shadow-sm overflow-hidden h-full">
      <CardHeader className="bg-muted/30 border-b border-border/50 pb-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FastForward className="w-5 h-5 text-primary" />
              Long-Run Projection
            </CardTitle>
            <CardDescription className="mt-1">
              Project 10,000 starting KAS until the strategy can no longer fund its next trade.
            </CardDescription>
          </div>
          <Button onClick={handleRun} disabled={isPending} className="min-w-[140px]">
            {isPending ? (
              <span className="flex items-center gap-2">
                <Calculator className="w-4 h-4 animate-spin-slow" />
                Simulating...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Play className="w-4 h-4" />
                Run Scenario
              </span>
            )}
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 p-0 overflow-auto bg-card/50">
        {isPending && !result ? (
          <div className="p-8 space-y-8 flex flex-col items-center justify-center min-h-[300px] h-full">
            <Database className="w-12 h-12 text-primary/20 animate-pulse" />
            <p className="text-sm font-medium animate-pulse text-muted-foreground">Running thousands of trades...</p>
          </div>
        ) : error ? (
          <div className="p-8 flex flex-col items-center justify-center text-center min-h-[300px] h-full space-y-3">
            <AlertTriangle className="w-10 h-10 text-destructive" />
            <div className="text-lg font-medium text-destructive">Simulation Failed</div>
            <p className="text-sm text-muted-foreground max-w-md">{error?.error || "An unknown error occurred during simulation."}</p>
          </div>
        ) : !result ? (
          <div className="p-8 flex flex-col items-center justify-center min-h-[300px] h-full space-y-4 text-center">
            <div className="bg-primary/5 p-4 rounded-full">
              <Calculator className="w-8 h-8 text-primary/40" />
            </div>
            <div>
              <h3 className="text-base font-semibold">Ready to Simulate</h3>
              <p className="text-sm text-muted-foreground max-w-md mt-1 mx-auto">
                 This scenario tests 10,000 starting KAS across a 100,000-hour ceiling with a 1.25% Kron fee on every 10 KAS trade.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-card border border-border rounded-lg p-4 shadow-sm flex flex-col">
                 <span className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Liquid KAS Balance</span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className={`text-3xl font-bold ${result.endingKas > result.startingKas ? 'text-success' : 'text-foreground'}`}>
                     {result.endingKas.toFixed(3)}
                  </span>
                  <span className="text-sm font-medium text-muted-foreground">/ {result.startingKas}</span>
                </div>
                 <div className="mt-2 text-xs font-medium text-muted-foreground">
                   Portfolio value: <span className="font-mono text-foreground">{result.endingPortfolioKas.toFixed(3)} KAS</span>
                </div>
              </div>

              <div className="bg-card border border-border rounded-lg p-4 shadow-sm flex flex-col">
                <span className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Timeline</span>
                <div className="flex items-baseline gap-2 mt-1">
                   <span className="text-3xl font-bold">{result.hoursCompleted.toFixed(2)}</span>
                  <span className="text-sm font-medium text-muted-foreground">/ {result.hoursRequested} hrs</span>
                </div>
                <div className="mt-2 text-xs font-medium flex items-center gap-1.5">
                  {result.stoppedReason === 'hours-completed' ? (
                    <span className="text-success flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Term reached</span>
                  ) : result.stoppedReason === 'insufficient-kas' ? (
                     <span className="text-destructive flex items-center gap-1"><XCircle className="w-3 h-3" /> Next trade unfunded</span>
                  ) : (
                    <span className="text-warning flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Out of tokens</span>
                  )}
                </div>
              </div>

              <div className="bg-card border border-border rounded-lg p-4 shadow-sm flex flex-col">
                <span className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Cycles</span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-3xl font-bold text-primary">{result.completedCycles}</span>
                  <span className="text-sm font-medium text-muted-foreground">completed</span>
                </div>
                <div className="mt-2 text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <ActivitySquare className="w-3 h-3" /> Buy → Sell loops
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-4">
                <h4 className="text-sm font-semibold flex items-center gap-2 border-b border-border pb-2">
                  <ArrowRightLeft className="w-4 h-4 text-muted-foreground" />
                  Trading Volume
                </h4>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Total Trades Executed</span>
                    <span className="font-mono font-medium">{result.tradesCompleted}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Buys Completed</span>
                    <span className="font-mono font-medium">{result.buysCompleted}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Sells Completed</span>
                    <span className="font-mono font-medium">{result.sellsCompleted}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Buy Notional (KAS)</span>
                    <span className="font-mono font-medium text-destructive">{result.buyNotionalKas.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Sell Proceeds (KAS)</span>
                    <span className="font-mono font-medium text-success">{result.sellProceedsKas.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-semibold flex items-center gap-2 border-b border-border pb-2">
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                  Costs & Inventory
                </h4>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                     <span className="text-sm text-muted-foreground">Total Kron Fees Paid</span>
                     <span className="font-mono font-medium text-destructive">{result.tradeFeesPaidKas.toFixed(3)} KAS</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Remaining Inventory</span>
                    <span className="font-mono font-medium">{result.endingTokenUnits.toFixed(2)} Units</span>
                  </div>
                  <Separator />
                   <div className="flex justify-between items-center">
                     <span className="text-sm text-muted-foreground">Ending Portfolio Value</span>
                     <span className="font-mono font-medium">{result.endingPortfolioKas.toFixed(3)} KAS</span>
                   </div>
                   <div className="flex justify-between items-center">
                     <span className="text-sm text-muted-foreground">Net Change</span>
                     <span className="font-mono font-medium text-destructive">{result.netChangeKas.toFixed(3)} KAS</span>
                   </div>
                   <Separator />
                  <div className="bg-muted/30 border border-border/50 rounded-md p-3 mt-4">
                    <span className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5 text-muted-foreground">
                      <List className="w-3 h-3" /> Scenario Assumptions
                    </span>
                    <ul className="space-y-1.5 mt-2">
                      {result.assumptions.map((assumption, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary/40 mt-1 shrink-0" />
                          <span className="leading-snug">{assumption}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
