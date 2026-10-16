import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { secrets } from 'base44:runtime';
import { callerMayCheckAlerts, presentedSchedulerToken } from './authorize.js';

const AI_STOCK_SYMBOLS = [
  "NVDA", "MSFT", "GOOGL", "META", "AMZN", "AMD", "INTC",
  "PLTR", "CRM", "SNOW", "AI", "SMCI", "AVGO", "ORCL"
];

const SCHEDULER_SECRET_NAME = "PRICE_ALERTS_SCHEDULER_SECRET";

function forbidden() {
  return Response.json({ error: "Forbidden" }, { status: 403 });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const length = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(length) && length > 8192) return {};
  let text = "";
  try {
    text = await req.text();
  } catch {
    return {};
  }
  if (!text || text.length > 8192) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function readUser(base44: { auth: { me: () => Promise<{ role?: string } | null> } }) {
  try {
    return await base44.auth.me();
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  let base44;
  try {
    base44 = createClientFromRequest(req);
  } catch (error) {
    console.error("checkPriceAlerts client error:", error instanceof Error ? error.name : "error");
    return forbidden();
  }

  const body = await readBody(req);
  const schedulerSecret = secrets.get(SCHEDULER_SECRET_NAME);
  const presentedToken = presentedSchedulerToken(
    req.headers.get("x-neuralpulse-scheduler-token"),
    body,
  );
  const user = await readUser(base44);
  if (!callerMayCheckAlerts({ user, presentedToken, schedulerSecret })) {
    if (!schedulerSecret) {
      console.error("checkPriceAlerts denied: scheduler secret is not configured");
    }
    return forbidden();
  }

  try {
    // Fetch all active alerts
    const alerts = await base44.asServiceRole.entities.PriceAlert.filter({ status: "active" });
    if (!alerts.length) return Response.json({ checked: 0, triggered: 0 });

    // Get current prices via LLM
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `Provide current approximate stock prices for: ${AI_STOCK_SYMBOLS.join(", ")}. Return only symbol and price.`,
      add_context_from_internet: true,
      response_json_schema: {
        type: "object",
        properties: {
          stocks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                symbol: { type: "string" },
                price: { type: "number" }
              }
            }
          }
        }
      },
      model: "gemini_3_flash"
    });

    const priceMap: Record<string, number> = {};
    for (const s of (result.stocks || [])) {
      priceMap[s.symbol] = s.price;
    }

    let triggered = 0;
    for (const alert of alerts) {
      const currentPrice = priceMap[alert.symbol];
      if (!currentPrice) continue;

      const shouldTrigger =
        (alert.condition === "above" && currentPrice >= alert.target_price) ||
        (alert.condition === "below" && currentPrice <= alert.target_price);

      if (shouldTrigger) {
        // Send email notification
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: alert.email,
          subject: `🚨 Price Alert: ${alert.symbol} is ${alert.condition} $${alert.target_price}`,
          body: `Your price alert for ${alert.symbol} (${alert.stock_name || alert.symbol}) has been triggered!\n\nCondition: Price ${alert.condition} $${alert.target_price}\nCurrent Price: $${currentPrice.toFixed(2)}\n\nLogin to your AI Markets Dashboard to take action.\n\nThis alert has been marked as triggered and will no longer send notifications.`
        });

        // Mark as triggered
        await base44.asServiceRole.entities.PriceAlert.update(alert.id, {
          status: "triggered",
          triggered_at: new Date().toISOString()
        });

        triggered++;
      }
    }

    return Response.json({ checked: alerts.length, triggered });
  } catch (error) {
    console.error("checkPriceAlerts error:", error instanceof Error ? error.name : "error");
    return Response.json({ error: "Price alert check failed" }, { status: 500 });
  }
});
