export function createWsClient(url, onMessage) {
  let ws = null
  let retry = 0
  let closed = false

  function connect() {
    if (closed) return
    ws = new WebSocket(url)
    ws.onopen = () => {
      retry = 0
    }
    ws.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(ev.data))
      } catch {}
    }
    ws.onclose = () => {
      if (closed) return
      retry += 1
      const wait = Math.min(5000, 250 * retry)
      setTimeout(connect, wait)
    }
  }

  connect()

  return {
    close() {
      closed = true
      if (ws) ws.close()
    }
  }
}

