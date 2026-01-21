import { WebSocketServer } from "ws"

export function attachWebSocketServer(httpServer, { state }) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" })

  function broadcast(message) {
    const raw = JSON.stringify(message)
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) ws.send(raw)
    }
  }

  wss.on("connection", (ws) => {
    ws.send(
      JSON.stringify({
        kind: "hello",
        ts: Date.now(),
        strategy: state.strategy,
        devices: state.devices,
        policies: state.policies,
        manualOverride: state.manualOverride
      })
    )
  })

  return { wss, broadcast }
}

