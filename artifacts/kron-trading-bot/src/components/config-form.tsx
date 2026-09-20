import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useQueryClient } from "@tanstack/react-query"
import { BotState, useUpdateBotConfig, getGetBotStateQueryKey } from "@workspace/api-client-react"
import { Settings, Save, AlertTriangle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

const configSchema = z.object({
  tokenId: z.string().min(1, "Token ID is required"),
  buyCount: z.coerce.number().min(1).max(100),
  sellCount: z.coerce.number().min(1).max(100),
  tradesPerHour: z.coerce.number().min(1).max(120),
  orderSizeKas: z.coerce.number().min(0.000001),
  maxSlippagePercent: z.coerce.number().min(0.01).max(50),
  maxDailyLossKas: z.coerce.number().min(0),
  minKasReserve: z.coerce.number().min(0),
  mode: z.enum(["dry-run", "live"]),
  timeZone: z.string().min(1),
})

export function ConfigForm({ state }: { state: BotState }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const updateConfig = useUpdateBotConfig()

  const form = useForm<z.infer<typeof configSchema>>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      tokenId: state.config.tokenId,
      buyCount: state.config.buyCount,
      sellCount: state.config.sellCount,
      tradesPerHour: state.config.tradesPerHour,
      orderSizeKas: state.config.orderSizeKas,
      maxSlippagePercent: state.config.maxSlippagePercent,
      maxDailyLossKas: state.config.maxDailyLossKas,
      minKasReserve: state.config.minKasReserve,
      mode: state.config.mode,
      timeZone: state.config.timeZone,
    },
  })

  const isLive = form.watch("mode") === "live"
  const isRunning = state.status === "running"

  function onSubmit(values: z.infer<typeof configSchema>) {
    updateConfig.mutate({ data: values }, {
      onSuccess: () => {
        toast({
          title: "Configuration Saved",
          description: "Strategy parameters have been updated.",
        })
        queryClient.invalidateQueries({ queryKey: getGetBotStateQueryKey() })
      },
      onError: (err: any) => {
        toast({
          title: "Error saving configuration",
          description: err?.error || "Unknown error occurred.",
          variant: "destructive"
        })
      }
    })
  }

  return (
    <Card className="flex-1 flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="w-5 h-5" />
          Strategy Configuration
        </CardTitle>
        <CardDescription>
          Adjust parameters. Changes are locked while running.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            
            {isLive && (
              <Alert variant="warning" className="mb-6">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Live Trading Enabled</AlertTitle>
                <AlertDescription>
                  The bot will execute real transactions on the network using your wallet.
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="mode"
                render={({ field }) => (
                  <FormItem className="col-span-1 md:col-span-2">
                    <FormLabel>Execution Mode</FormLabel>
                    <Select disabled={isRunning} onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="font-mono">
                          <SelectValue placeholder="Select mode" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="dry-run">dry-run (Simulated)</SelectItem>
                        <SelectItem value="live" disabled={!state.wallet.connected}>live (Real Trades)</SelectItem>
                      </SelectContent>
                    </Select>
                    {!state.wallet.connected && (
                      <FormDescription className="text-warning-foreground">
                        Live mode requires a connected wallet.
                      </FormDescription>
                    )}
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tokenId"
                render={({ field }) => (
                  <FormItem className="col-span-1 md:col-span-2">
                    <FormLabel>Target Token ID</FormLabel>
                    <FormControl>
                      <Input disabled={isRunning} className="font-mono" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="orderSizeKas"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Order Size (KAS)</FormLabel>
                    <FormControl>
                      <Input disabled={isRunning} type="number" step="0.000001" className="font-mono" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="maxSlippagePercent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Slippage (%)</FormLabel>
                    <FormControl>
                      <Input disabled={isRunning} type="number" step="0.1" className="font-mono" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="buyCount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Buy Cycle Count</FormLabel>
                    <FormControl>
                      <Input disabled={isRunning} type="number" className="font-mono" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sellCount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sell Cycle Count</FormLabel>
                    <FormControl>
                      <Input disabled={isRunning} type="number" className="font-mono" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tradesPerHour"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Trades Per Hour Limit</FormLabel>
                    <FormControl>
                      <Input disabled={isRunning} type="number" className="font-mono" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="maxDailyLossKas"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Daily Loss Limit (KAS)</FormLabel>
                    <FormControl>
                      <Input disabled={isRunning} type="number" step="0.1" className="font-mono" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="minKasReserve"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Min KAS Reserve</FormLabel>
                    <FormControl>
                      <Input disabled={isRunning} type="number" step="0.1" className="font-mono" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            <div className="pt-4 border-t border-border flex justify-end">
              <Button type="submit" disabled={isRunning || updateConfig.isPending}>
                <Save className="w-4 h-4" />
                {updateConfig.isPending ? "Saving..." : "Save Configuration"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
