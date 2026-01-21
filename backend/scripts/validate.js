import fs from "node:fs"
import path from "node:path"

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return []
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function quantile(sorted, q) {
  if (!sorted.length) return null
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1))))
  return sorted[idx]
}

function main() {
  const dataDir = path.resolve(process.cwd(), "data", "history")
  const day = process.env.DATE ?? today()
  const sensorsFile = path.join(dataDir, `sensors-${day}.jsonl`)
  const valvesFile = path.join(dataDir, `valves-${day}.jsonl`)

  const sensors = readJsonl(sensorsFile)
  const valves = readJsonl(valvesFile)

  const byTick = new Map()
  for (const r of sensors) {
    const ts = Number(r.ts)
    if (!Number.isFinite(ts)) continue
    const key = String(ts)
    if (!byTick.has(key)) byTick.set(key, new Set())
    byTick.get(key).add(String(r.deviceId))
  }

  const tickTs = Array.from(byTick.keys()).map(Number).sort((a, b) => a - b)
  const tickCounts = tickTs.map((t) => byTick.get(String(t)).size)
  const tickIntervals = tickTs.slice(1).map((t, i) => t - tickTs[i])

  const latency = valves
    .map((v) => Number(v.latencyMs))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b)

  const report = {
    day,
    sensors: {
      totalRows: sensors.length,
      ticks: tickTs.length,
      perTickMin: tickCounts.length ? Math.min(...tickCounts) : 0,
      perTickMax: tickCounts.length ? Math.max(...tickCounts) : 0,
      expectedPerTick: 50,
      tickIntervalMs: tickIntervals.length
        ? { min: Math.min(...tickIntervals), max: Math.max(...tickIntervals), expected: 1800_000 }
        : null
    },
    valves: {
      totalRows: valves.length,
      latencyMs: {
        samples: latency.length,
        p50: quantile(latency, 0.5),
        p95: quantile(latency, 0.95),
        max: latency.length ? latency[latency.length - 1] : null
      }
    }
  }

  console.log(JSON.stringify(report, null, 2))
}

main()

