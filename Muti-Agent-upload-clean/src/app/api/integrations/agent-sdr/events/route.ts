export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Agent_SDR event proxy.
 * Returns 204 when no real Agent_SDR backend is configured.
 * Connect a real Agent_SDR later and this endpoint will proxy its SSE stream.
 */
export async function GET(_request: Request) {
  const backendUrl = process.env.AGENT_SDR_BASE_URL?.trim();
  if (!backendUrl) {
    return new Response(null, { status: 204 });
  }

  try {
    const response = await fetch(`${backendUrl}/api/events`, {
      headers: {
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
      cache: "no-store",
      signal: _request.signal,
    });

    if (!response.ok || !response.body) {
      return new Response(null, { status: 502 });
    }

    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return new Response(null, { status: 204 });
  }
}
