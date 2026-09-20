import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatKas, formatUsd, formatPercent } from "@/lib/utils"
import { Activity, TrendingDown, TrendingUp, Droplet } from "lucide-react"
import { MarketSnapshot } from "@workspace/api-client-react"

export function MarketData({ market }: { market: MarketSnapshot }) {
  const isPositive = market.change24hPercent >= 0

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-xl flex items-center gap-2">
              <Activity className="w-5 h-5 text-muted-foreground" />
              {market.symbol}
            </CardTitle>
            <CardDescription className="font-mono text-xs mt-1">
              {market.tokenId}
            </CardDescription>
          </div>
          <Badge variant={isPositive ? "success" : "destructive"} className="font-mono">
            {isPositive ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
            {formatPercent(market.change24hPercent)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <span className="text-sm text-muted-foreground">Price</span>
            <div className="font-mono text-xl font-medium">
              {formatKas(market.priceKas)}
            </div>
            <div className="text-sm text-muted-foreground font-mono">
              {formatUsd(market.priceUsd)}
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Droplet className="w-3 h-3" /> Liquidity
            </span>
            <div className="font-mono text-xl font-medium">
              {formatKas(market.liquidityKas)}
            </div>
          </div>
        </div>
        <div className="mt-6 text-xs text-muted-foreground text-right">
          Last updated: {new Date(market.updatedAt).toLocaleTimeString()}
        </div>
      </CardContent>
    </Card>
  )
}
