import http from "node:http"
import path from "node:path"
import express from "express"
import cors from "cors"
import mqtt from "mqtt"
import { startMqttBroker } from "./broker.js"
import { attachWebSocketServer } from "./ws.js"
import { appendJsonl, ensureDir, readJson, writeJsonAtomic } from "./storage.js"
import { createState } from "./state.js"
import { createIrrigationController } from "./irrigation.js"
import { createRoutes } from "./routes.js"

const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, "data")
const DEVICES_DIR = path.join(DATA_DIR, "devices")
const STRATEGY_DIR = path.join(DATA_DIR, "strategy")
const HISTORY_DIR = path.join(DATA_DIR, "history")

const storagePaths = {
  sensorsFile: path.join(DEVICES_DIR, "sensors.json"),
  valvesFile: path.join(DEVICES_DIR, "valves.json"),
  strategyFile: path.join(STRATEGY_DIR, "strategy.json"),
  policiesFile: path.join(STRATEGY_DIR, "policies.json"),
  overrideFile: path.join(STRATEGY_DIR, "override.json"),
  historyDir: HISTORY_DIR
}

ensureDir(DEVICES_DIR)
ensureDir(STRATEGY_DIR)
ensureDir(HISTORY_DIR)

const state = createState()
state.devices = {
  sensors: readJson(storagePaths.sensorsFile, []),
  valves: readJson(storagePaths.valvesFile, [])
}

state.strategy = readJson(storagePaths.strategyFile, null)
if (!state.strategy) {
  state.strategy = {
    mode: "auto",
    autoMethod: "threshold",
    humidityLowPct: 35,
    humidityHighPct: 45,
    openDurationSec: 600,
    cooldownMinutes: 20,
    acreage: 500,
    mqtt: { host: "0.0.0.0", port: 1883 },
    http: { host: "0.0.0.0", port: 3000 },
    updatedAt: Date.now()
  }
  writeJsonAtomic(storagePaths.strategyFile, state.strategy)
}
if (!state.strategy.updatedAt) {
  state.strategy = { ...state.strategy, updatedAt: Date.now() }
  writeJsonAtomic(storagePaths.strategyFile, state.strategy)
}
if (!state.strategy.autoMethod) {
  state.strategy = { ...state.strategy, autoMethod: "threshold", updatedAt: Date.now() }
  writeJsonAtomic(storagePaths.strategyFile, state.strategy)
}
if (!state.strategy.mqtt) state.strategy.mqtt = { host: "0.0.0.0", port: 1883 }
if (!state.strategy.http) state.strategy.http = { host: "0.0.0.0", port: 3000 }

state.policies = readJson(storagePaths.policiesFile, [])
if (!Array.isArray(state.policies)) state.policies = []
if (!Array.isArray(readJson(storagePaths.policiesFile, null))) {
  writeJsonAtomic(storagePaths.policiesFile, state.policies)
}

state.manualOverride = readJson(storagePaths.overrideFile, state.manualOverride)
if (!state.manualOverride || typeof state.manualOverride !== "object") state.manualOverride = { enabled: false, valves: {} }
if (typeof state.manualOverride.enabled !== "boolean") state.manualOverride.enabled = false
if (!state.manualOverride.valves || typeof state.manualOverride.valves !== "object") state.manualOverride.valves = {}
writeJsonAtomic(storagePaths.overrideFile, state.manualOverride)

const mqttHost = process.env.MQTT_HOST ?? state.strategy.mqtt.host ?? "0.0.0.0"
const mqttPort = Number(process.env.MQTT_PORT ?? state.strategy.mqtt.port ?? 1883)
const httpHost = process.env.HTTP_HOST ?? state.strategy.http.host ?? "0.0.0.0"
const httpPort = Number(process.env.HTTP_PORT ?? state.strategy.http.port ?? 3000)

let mqttServer = null
try {
  const started = await startMqttBroker({ host: mqttHost, port: mqttPort })
  mqttServer = started.server
} catch (e) {
  if (e?.code !== "EADDRINUSE") throw e
}

const httpApp = express()
httpApp.use(cors())
httpApp.use(express.json({ limit: "1mb" }))

const httpServer = http.createServer(httpApp)
const { broadcast } = attachWebSocketServer(httpServer, { state })

const mqttClient = mqtt.connect(`mqtt://127.0.0.1:${mqttPort}`, {
  clientId: `backend-${Math.random().toString(16).slice(2)}`,
  clean: true,
  reconnectPeriod: 1000
})

const irrigation = createIrrigationController({ state, mqttClient, broadcast })

httpApp.use("/api", createRoutes({ state, storagePaths, irrigation }))

httpServer.listen(httpPort, httpHost)

function todayString(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10)
}

mqttClient.on("connect", () => {
  mqttClient.subscribe("farm/sensors/+/uplink", { qos: 1 })
  mqttClient.subscribe("farm/valves/+/status", { qos: 1 })
  broadcast({ kind: "backend_status", ts: Date.now(), data: { mqtt: "connected" } })
})

mqttClient.on("message", (topic, payloadBuf) => {
  const payloadRaw = payloadBuf.toString("utf8")
  let msg
  try {
    msg = JSON.parse(payloadRaw)
  } catch {
    return
  }
  const ts = Number(msg.ts ?? Date.now())

  if (topic.includes("/sensors/") && topic.endsWith("/uplink")) {
    const deviceId = String(msg.deviceId ?? "")
    if (!deviceId) return
    const latest = { ...msg, ts }
    state.sensors.set(deviceId, latest)
    appendJsonl(path.join(HISTORY_DIR, `sensors-${todayString(ts)}.jsonl`), latest)
    broadcast({ kind: "sensor", ts: Date.now(), data: latest })
    void irrigation.onSensorUplink(latest)
    return
  }

  if (topic.includes("/valves/") && topic.endsWith("/status")) {
    const valveId = String(msg.valveId ?? "")
    if (!valveId) return
    const pending = msg.commandId ? state.pendingCommands.get(String(msg.commandId)) : null
    const latencyMs =
      pending && pending.requestedAt && msg.respondedAt ? Number(msg.respondedAt) - Number(pending.requestedAt) : null
    if (pending && msg.commandId) state.pendingCommands.delete(String(msg.commandId))
    const latest = { ...msg, ts, latencyMs }
    const prev = state.valves.get(valveId) ?? { id: valveId }
    state.valves.set(valveId, { ...prev, ...latest })
    appendJsonl(path.join(HISTORY_DIR, `valves-${todayString(ts)}.jsonl`), latest)
    broadcast({ kind: "valve", ts: Date.now(), data: latest })
  }
})

process.on("SIGINT", () => {
  try {
    mqttClient.end(true)
    if (mqttServer) mqttServer.close()
    httpServer.close()
  } finally {
    process.exit(0)
  }
})

