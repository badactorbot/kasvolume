import { useGetUserBotDashboard, useLogoutWallet, getGetUserBotDashboardQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { SquareTerminal, LogOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import { WalletConnect } from "@/components/wallet-connect";
import { BotSetupForm } from "@/components/bot-setup-form";
import { BotActivation } from "@/components/bot-activation";
import { BotDashboardView } from "@/components/bot-dashboard-view";

export default function Dashboard() {
  const { data: dashboard, isLoading, error } = useGetUserBotDashboard({
    query: {
      refetchInterval: 60_000,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: true,
      queryKey: getGetUserBotDashboardQueryKey(),
    }
  });

  const logout = useLogoutWallet();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleLogout = async () => {
    try {
      await logout.mutateAsync();
      queryClient.invalidateQueries({ queryKey: getGetUserBotDashboardQueryKey() });
    } catch (err: any) {
      toast({ title: 'Logout failed', description: err.message, variant: 'destructive' });
    }
  };

  if (isLoading && !dashboard) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // If we have an error or unauthenticated state, show connect
  if (error || !dashboard || !dashboard.authenticated) {
    return (
      <div className="min-h-[100dvh] bg-background flex flex-col font-sans selection:bg-primary/20">
        <header className="px-6 py-6 flex items-center justify-between sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-border/50">
          <div className="flex items-center gap-3">
            <SquareTerminal className="w-5 h-5 text-primary" />
            <h1 className="text-sm font-bold tracking-widest uppercase text-foreground">KasDistro Trading Bot Console</h1>
          </div>
        </header>
        <main className="flex-1 p-6 flex flex-col items-center justify-center">
          <WalletConnect />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col font-sans selection:bg-primary/20">
        <header className="px-6 py-6 flex items-center justify-between sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-border/50">
          <div className="flex items-center gap-3">
            <SquareTerminal className="w-5 h-5 text-primary" />
            <h1 className="text-sm font-bold tracking-widest uppercase text-foreground">KasDistro Trading Bot Console</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Connected Wallet</p>
              <p className="text-sm font-medium font-mono text-foreground mt-0.5">{dashboard.walletAddress.slice(0, 8)}...{dashboard.walletAddress.slice(-6)}</p>
            </div>
            <Button variant="outline" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-foreground uppercase tracking-wider text-xs font-bold">
              <LogOut className="w-3.5 h-3.5 sm:mr-2" />
              <span className="hidden sm:inline">Disconnect</span>
            </Button>
          </div>
        </header>

      <main className="flex-1 p-4 sm:p-6 w-full max-w-6xl mx-auto">
        {!dashboard.bot ? (
          <BotSetupForm strategy={dashboard.strategy} />
        ) : !dashboard.bot.activationPaid ? (
          <BotActivation strategy={dashboard.strategy} bot={dashboard.bot} />
        ) : (
          <BotDashboardView bot={dashboard.bot} strategy={dashboard.strategy} walletAddress={dashboard.walletAddress} />
        )}
      </main>
    </div>
  );
}
