import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { pushTokens } from "../db/schema/push-tokens.js";

// ─────────────────────────────────────────────────────────
// Push notifications via the Expo Push API.
//
// notifyUser() NEVER throws — notification failures must not
// break order flow. Tokens reported as DeviceNotRegistered
// are pruned automatically.
// ─────────────────────────────────────────────────────────

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface PushData {
  type: string;
  orderId?: string;
  [key: string]: unknown;
}

function logPush(level: "info" | "error", message: string, extra: Record<string, unknown>) {
  console[level === "error" ? "error" : "log"](
    JSON.stringify({
      level,
      type: "PUSH",
      message,
      ts: new Date().toISOString(),
      ...extra,
    }),
  );
}

/** Send a notification to every registered device of one user. */
export async function notifyUser(
  userId: string,
  title: string,
  body: string,
  data?: PushData,
): Promise<void> {
  try {
    const tokens = await db
      .select({ token: pushTokens.token })
      .from(pushTokens)
      .where(eq(pushTokens.userId, userId));

    if (tokens.length === 0) return;

    const messages = tokens.map((t) => ({
      to: t.token,
      sound: "default" as const,
      title,
      body,
      data: data ?? {},
    }));

    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });

    const json: any = await res.json().catch(() => null);
    const tickets: any[] = Array.isArray(json?.data) ? json.data : [];

    // Prune tokens Expo says are dead
    const deadTokens: string[] = [];
    tickets.forEach((ticket, i) => {
      if (ticket?.details?.error === "DeviceNotRegistered" && tokens[i]) {
        deadTokens.push(tokens[i].token);
      }
    });
    if (deadTokens.length > 0) {
      await db.delete(pushTokens).where(inArray(pushTokens.token, deadTokens));
      logPush("info", "Pruned dead push tokens", { count: deadTokens.length });
    }

    if (!res.ok) {
      logPush("error", "Expo push API returned non-OK", {
        status: res.status,
        userId,
      });
    }
  } catch (err) {
    logPush("error", "Push send failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Fire-and-forget wrapper for call sites inside request handlers. */
export function notifyUserAsync(
  userId: string,
  title: string,
  body: string,
  data?: PushData,
): void {
  void notifyUser(userId, title, body, data);
}
