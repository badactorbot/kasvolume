import { useQueryClient } from "@tanstack/react-query"
import { BotState, useStartBot, useStopBot, useRunBotOnce, usePrepareLiveBuy, getGetBotStateQueryKey, getGetBotActivityQueryKey } from "@workspace/api-client-react"
import { Play, Square, StepForward, ActivitySquare, AlertTriangle, ShieldCheck, FileCheck2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export function BotControls({ state }: { state: BotState }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const startBot = useStartBot()
  const stopBot = useStopBot()
  const runOnce = useRunBotOnce()
  const prepareBuy = usePrepareLiveBuy()

  const isRunning = state.status === "running"
  const isLive = state.mode === "live"

  const handleStart = () => {
    startBot.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Bot Started", description: `Running in ${state.mode} mode.` })
        queryClient.invalidateQueries({ queryKey: getGetBotStateQueryKey() })
      },
      onError: (err: any) => {
        toast({ title: "Failed to start", description: err?.error || "Unknown error", variant: "destructive" })
      }
    })
  }

  const handleStop = () => {
    stopBot.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Bot Stopped", description: "All scheduled actions cancelled." })
        queryClient.invalidateQueries({ queryKey: getGetBotStateQueryKey() })
      }
    })
  }

  const handleStep = () => {
    runOnce.mutate(undefined, {
      onSuccess: (result) => {
        toast({ 
          title: "Step Completed", 
          description: `Action: ${result.action} - ${result.message}` 
        })
        queryClient.invalidateQueries({ queryKey: getGetBotStateQueryKey() })
        queryClient.invalidateQueries({ queryKey: getGetBotActivityQueryKey() })
      },
      onError: (err: any) => {
        toast({ title: "Step failed", description: err?.error || "Unknown error", variant: "destructive" })
      }
    })
  }

  return (
    <Card className="border-2 border-primary/10">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl flex items-center gap-2">
            <ActivitySquare className="w-5 h-5 text-primary" />
            Execution Controls
          </CardTitle>
          <Badge variant={isRunning ? (isLive ? "destructive" : "success") : "secondary"} className="uppercase tracking-widest text-[10px] px-2 py-0.5">
            {state.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        
        {!state.safety.canTrade && (
          <div className="mb-6 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block mb-1">Safety Block Active</span>
              {state.safety.reason}
            </div>
          </div>
        )}

        {state.safety.canTrade && state.mode === 'dry-run' && (
           <div className="mb-6 p-3 bg-muted border border-border rounded-md text-sm text-muted-foreground flex items-center gap-2">
           <ShieldCheck className="w-4 h-4 text-success shrink-0" />
           <span>Safe to run. Dry-run mode will not execute real trades.</span>
         </div>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex gap-3">
            {!isRunning ? (
              <Button 
                onClick={handleStart} 
                disabled={!state.safety.canTrade || startBot.isPending}
                className="flex-1"
                variant={isLive ? "destructive" : "default"}
              >
                <Play className="w-4 h-4" />
                Start Bot
              </Button>
            ) : (
              <Button 
                onClick={handleStop} 
                disabled={stopBot.isPending}
                className="flex-1"
                variant="outline"
              >
                <Square className="w-4 h-4 text-destructive" />
                Stop Bot
              </Button>
            )}
          </div>
          
          <Button 
            onClick={handleStep} 
            disabled={isRunning || !state.safety.canTrade || runOnce.isPending} 
            variant="secondary"
            className="w-full"
          >
            <StepForward className="w-4 h-4" />
            Execute One Step
          </Button>

          <div className="border-t border-border pt-3 mt-1">
            <Button
              onClick={() => prepareBuy.mutate()}
              disabled={prepareBuy.isPending}
              variant="outline"
              className="w-full"
            >
              <FileCheck2 className="w-4 h-4" />
              {prepareBuy.isPending ? "Preparing Live Preview..." : "Prepare 21 KAS Live Buy"}
            </Button>
            {prepareBuy.error && (
              <p className="text-xs text-destructive mt-2">
                {(prepareBuy.error as any)?.error || "Live preview could not be prepared."}
              </p>
            )}
            {prepareBuy.data && (
              <div className="mt-3 rounded-md border border-border bg-muted/40 p-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Receive</span>
                  <span className="font-mono font-medium">{prepareBuy.data.tokenOut} {prepareBuy.data.symbol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Kron fees</span>
                  <span className="font-mono">{prepareBuy.data.kronFeeKas.toFixed(6)} KAS</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Network fee</span>
                  <span className="font-mono">{prepareBuy.data.networkFeeKas.toFixed(7)} KAS</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Token output dust</span>
                  <span className="font-mono">{prepareBuy.data.recipientDustKas.toFixed(6)} KAS</span>
                </div>
                <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                  <span>Maximum debit</span>
                  <span className="font-mono">{prepareBuy.data.maximumDebitKas.toFixed(7)} KAS</span>
                </div>
                <p className="text-muted-foreground pt-1">
                  Transaction assembled only. Not signed or submitted.
                </p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
