/**
 * Discord incoming webhook alerts.
 * No-ops (with console warn once) if DISCORD_WEBHOOK_URL is unset.
 */

export class DiscordAlerts {
  private warnedMissing = false;

  constructor(private readonly webhookUrl: string | undefined) {}

  async send(content: string): Promise<void> {
    if (!this.webhookUrl) {
      if (!this.warnedMissing) {
        console.warn("[alerts] DISCORD_WEBHOOK_URL not set — alerts console-only");
        this.warnedMissing = true;
      }
      console.log(`[alert] ${content}`);
      return;
    }

    // Discord content limit ~2000 chars
    const body = content.slice(0, 1900);
    const res = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: body }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[alerts] Discord webhook ${res.status}: ${text.slice(0, 200)}`);
    }
  }

  heartbeat(info: string): Promise<void> {
    return this.send(`🟢 SOL SI heartbeat — ${info}`);
  }

  kill(reason: string): Promise<void> {
    return this.send(`🔴 SOL SI kill / pause — ${reason}`);
  }

  fill(detail: string): Promise<void> {
    return this.send(`📘 SOL SI execution — ${detail}`);
  }

  error(detail: string): Promise<void> {
    return this.send(`🟠 SOL SI error — ${detail}`);
  }
}
