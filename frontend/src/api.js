export function createApi(base = "") {
  async function getJson(path) {
    const res = await fetch(`${base}${path}`)
    if (!res.ok) {
      let detail = ""
      try {
        const j = await res.json()
        detail = j?.error ? `: ${j.error}` : ""
      } catch {}
      throw new Error(`${res.status} ${res.statusText}${detail}`)
    }
    return res.json()
  }

  async function sendJson(path, method, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {})
    })
    if (!res.ok) {
      let detail = ""
      try {
        const j = await res.json()
        detail = j?.error ? `: ${j.error}` : ""
      } catch {}
      throw new Error(`${res.status} ${res.statusText}${detail}`)
    }
    return res.json()
  }

  return {
    health: () => getJson("/api/health"),
    devices: () => getJson("/api/devices"),
    strategy: () => getJson("/api/strategy"),
    policies: () => getJson("/api/policies"),
    updatePolicies: (policies) => sendJson("/api/policies", "PUT", { policies }),
    override: () => getJson("/api/override"),
    updateOverride: (payload) => sendJson("/api/override", "POST", payload),
    updateStrategy: (s) => sendJson("/api/strategy", "PUT", s),
    setMode: (mode) => sendJson("/api/mode", "POST", { mode }),
    latest: () => getJson("/api/latest"),
    openValve: (valveId, durationSec) => sendJson(`/api/valves/${valveId}/open`, "POST", { durationSec }),
    closeValve: (valveId) => sendJson(`/api/valves/${valveId}/close`, "POST", {}),
    toggleValve: (valveId, durationSec) => sendJson(`/api/valves/${valveId}/toggle`, "POST", { durationSec }),
    history: ({ deviceId, type, date, from, to, limit }) => {
      const u = new URL(`${base}/api/history`, window.location.origin)
      u.searchParams.set("deviceId", deviceId)
      if (type) u.searchParams.set("type", type)
      if (date) u.searchParams.set("date", date)
      if (from != null) u.searchParams.set("from", String(from))
      if (to != null) u.searchParams.set("to", String(to))
      if (limit != null) u.searchParams.set("limit", String(limit))
      return getJson(u.pathname + u.search)
    }
  }
}

