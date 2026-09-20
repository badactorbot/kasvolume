import { Wallet, CircleSlash2 } from "lucide-react"
import { WalletStatus as WalletStatusType } from "@workspace/api-client-react"
import { Badge } from "@/components/ui/badge"
import { formatKas } from "@/lib/utils"

export function WalletStatus({ wallet }: { wallet: WalletStatusType }) {
  if (!wallet.connected) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground border border-border px-3 py-1.5 rounded-md bg-muted/50">
        <CircleSlash2 className="w-4 h-4" />
        No Wallet Connected
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4 bg-card border border-border px-4 py-2 rounded-md shadow-sm">
      <div className="flex items-center gap-2 border-r border-border pr-4">
        <Wallet className="w-4 h-4 text-muted-foreground" />
        <span className="font-mono text-sm truncate max-w-[120px]" title={wallet.address}>
          {wallet.address.slice(0, 8)}...{wallet.address.slice(-4)}
        </span>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">KAS Balance</span>
          <span className="font-mono font-medium">{formatKas(wallet.kasBalance)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Token Balance</span>
          <span className="font-mono font-medium">{wallet.tokenBalance.toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}
