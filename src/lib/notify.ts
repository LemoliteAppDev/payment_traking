// Outbound notifications (Telegram). Stubbed with console.log until
// TELEGRAM_BOT_TOKEN is set — so the whole app runs without real credentials.
// Event-driven pings fire immediately on the action; the 15-min digest is the
// only cron-driven piece (see lib/reminders.ts).

export async function sendTelegram(chatId: string | null | undefined, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) {
    console.log(`[notify:stub] -> ${chatId ?? "(no chat id)"}: ${text}`);
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (e) {
    console.error("[notify] telegram send failed", e);
  }
}
