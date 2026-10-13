export const CLAUDE_MODEL = "claude-sonnet-5";

export type ModelReply = { text: string; stopReason: string; inputTokens: number; outputTokens: number };

type Raw = { error: string } | ModelReply;

async function callOnce(system: string, user: string, maxTokens: number): Promise<Raw> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: "The AI service is not configured (ANTHROPIC_API_KEY is missing)." };

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
    });
  } catch {
    return { error: "Could not reach the AI service. Please try again." };
  }

  if (!response.ok) {
    // The body can describe billing or key problems; log it for the server, show a short reason to the user.
    console.error(`Anthropic API error ${response.status}`);
    if (response.status === 401) return { error: "The AI service rejected the API key." };
    if (response.status === 429) return { error: "The AI service is busy or the usage limit was reached. Please try again shortly." };
    if (response.status === 400 || response.status === 402) return { error: "The AI service could not take the request (the account balance may be too low)." };
    return { error: "The AI service had a problem. Please try again." };
  }

  const data = await response.json();
  const text: string = (data.content || [])
    .filter((c: { type: string; text?: string }) => c.type === "text" && c.text)
    .map((c: { text: string }) => c.text)
    .join("\n")
    .trim();
  return {
    text,
    stopReason: (data.stop_reason as string | undefined) ?? "unknown",
    inputTokens: Number(data.usage?.input_tokens) || 0,
    outputTokens: Number(data.usage?.output_tokens) || 0,
  };
}

/**
 * One call to the model. Thinking counts against max_tokens, so if the first,
 * roomy attempt runs out before any answer text appears it is retried once with
 * a larger budget.
 */
export async function askClaude(system: string, user: string, maxTokens = 4096): Promise<Raw> {
  let result = await callOnce(system, user, maxTokens);
  if ("text" in result && !result.text && result.stopReason === "max_tokens") result = await callOnce(system, user, 12000);
  return result;
}
