import express from "express"
import path from "node:path"
import { readJsonlRange, writeJsonAtomic } from "./storage.js"

export function createRoutes({ state, storagePaths, irrigation }) {
  const router = express.Router()

  router.get("/health", (req, res) => {
    res.json({
      ok: true,
      ts: Date.now(),
      mqttBroker: { host: state.strategy?.mqtt?.host, port: state.strategy?.mqtt?.port }
    })
  })

  router.get("/devices", (req, res) => {
    res.json(state.devices ?? { sensors: [], valves: [] })
  })

  router.get("/strategy", (req, res) => {
    res.json(state.strategy)
  })

  router.put("/strategy", (req, res) => {
    const body = req.body ?? {}
    state.strategy = {
      ...state.strategy,
      ...body,
      updatedAt: Date.now()
    }
    writeJsonAtomic(storagePaths.strategyFile, state.strategy)
    res.json(state.strategy)
  })

  router.get("/policies", (req, res) => {
    res.json({ policies: state.policies ?? [] })
  })

  router.put("/policies", (req, res) => {
    const raw = req.body?.policies ?? req.body
    if (!Array.isArray(raw)) return res.status(400).json({ error: "policies must be an array" })
    const now = Date.now()
    const normalized = raw
      .filter((p) => p && typeof p === "object")
      .map((p, idx) => ({
        id: p.id ?? `${now}-${idx}`,
        sensorId: String(p.sensorId ?? ""),
        valveId: String(p.valveId ?? ""),
        humidityThreshold: Number(p.humidityThreshold),
        durationSeconds: Number(p.durationSeconds),
        active: typeof p.active === "boolean" ? p.active : true
      }))
      .filter((p) => p.sensorId && p.valveId && Number.isFinite(p.humidityThreshold))
    state.policies = normalized
    writeJsonAtomic(storagePaths.policiesFile, state.policies)
    res.json({ policies: state.policies })
  })

  router.post("/mode", (req, res) => {
    const mode = req.body?.mode
    if (mode !== "auto" && mode !== "manual") return res.status(400).json({ error: "mode must be auto|manual" })
    state.strategy = { ...state.strategy, mode, updatedAt: Date.now() }
    writeJsonAtomic(storagePaths.strategyFile, state.strategy)
    res.json(state.strategy)
  })

  router.get("/override", (req, res) => {
    res.json(state.manualOverride)
  })

  router.post("/override", async (req, res) => {
    try {
      const globalEnabled = req.body?.globalEnabled
      const valveId = req.body?.valveId ? String(req.body.valveId) : null
      const enabled = typeof req.body?.enabled === "boolean" ? req.body.enabled : undefined
      const hasDesiredState = req.body && Object.hasOwn(req.body, "desiredState")
      const desiredStateRaw = hasDesiredState ? req.body.desiredState : undefined
      const desiredState =
        desiredStateRaw === "OPEN" || desiredStateRaw === "CLOSE" ? desiredStateRaw : desiredStateRaw === null ? null : undefined
      const durationSec = req.body?.durationSec
      if (typeof globalEnabled === "boolean" && !valveId) {
        await irrigation.setManualOverride({ enabled: globalEnabled })
      } else if (valveId) {
        await irrigation.setManualOverride({ enabled, valveId, desiredState, durationSec })
      } else {
        return res.status(400).json({ error: "provide globalEnabled or valveId" })
      }
      writeJsonAtomic(storagePaths.overrideFile, state.manualOverride)
      res.json(state.manualOverride)
    } catch (e) {
      res.status(500).json({ error: e?.message ?? "override update failed" })
    }
  })

  router.get("/latest", (req, res) => {
    const sensors = Array.from(state.sensors.values())
    const valves = Array.from(state.valves.values())
    res.json({ ts: Date.now(), sensors, valves })
  })

  router.post("/valves/:valveId/open", async (req, res) => {
    try {
      const valveId = req.params.valveId
      const durationSec = Number(req.body?.durationSec ?? 600)
      await irrigation.openValve(valveId, Number.isFinite(durationSec) ? durationSec : 600, "manual_open")
      res.json({ ok: true })
    } catch (e) {
      res.status(503).json({ ok: false, error: e?.message ?? "open failed" })
    }
  })

  router.post("/valves/:valveId/close", async (req, res) => {
    try {
      const valveId = req.params.valveId
      await irrigation.closeValve(valveId, "manual_close")
      res.json({ ok: true })
    } catch (e) {
      res.status(503).json({ ok: false, error: e?.message ?? "close failed" })
    }
  })

  router.post("/valves/:valveId/toggle", async (req, res) => {
    try {
      const valveId = req.params.valveId
      await irrigation.toggleValveManual(valveId, req.body?.durationSec)
      writeJsonAtomic(storagePaths.overrideFile, state.manualOverride)
      res.json({ ok: true, manualOverride: state.manualOverride })
    } catch (e) {
      res.status(503).json({ ok: false, error: e?.message ?? "toggle failed" })
    }
  })

  router.get("/history", (req, res) => {
    const deviceId = String(req.query.deviceId ?? "")
    const type = String(req.query.type ?? "sensor")
    const from = req.query.from ? Number(req.query.from) : null
    const to = req.query.to ? Number(req.query.to) : null
    const limit = req.query.limit ? Number(req.query.limit) : 2000
    if (!deviceId) return res.status(400).json({ error: "deviceId required" })

    const date = req.query.date ? String(req.query.date) : null
    const today = new Date()
    const yyyyMmDd = date ?? today.toISOString().slice(0, 10)

    const filePath =
      type === "valve"
        ? path.join(storagePaths.historyDir, `valves-${yyyyMmDd}.jsonl`)
        : path.join(storagePaths.historyDir, `sensors-${yyyyMmDd}.jsonl`)

    const rows = readJsonlRange(filePath, from, to, Number.isFinite(limit) ? limit : 2000).filter(
      (r) => r.deviceId === deviceId || r.valveId === deviceId
    )
    res.json({ deviceId, type, date: yyyyMmDd, count: rows.length, rows })
  })

  return router
}

