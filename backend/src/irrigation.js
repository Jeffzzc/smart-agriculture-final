import crypto from "node:crypto"

function randomId() {
  return crypto.randomBytes(8).toString("hex")
}

export function createIrrigationController({ state, mqttClient, broadcast }) {
  function getZoneForSensor(sensorId) {
    return state.devices?.sensors?.find((d) => d.id === sensorId)?.zone ?? "Z1"
  }

  function getValveForZone(zone) {
    const match = state.devices?.valves?.find((v) => v.zone === zone)
    return match?.id ?? null
  }

  async function publishValveCommand(valveId, action, durationSec, source) {
    if (!mqttClient.connected) {
      const err = new Error("MQTT not connected")
      err.code = "MQTT_DISCONNECTED"
      throw err
    }
    const commandId = randomId()
    const payload = {
      commandId,
      valveId,
      action,
      durationSec: durationSec ?? null,
      requestedAt: Date.now(),
      source: source ?? null
    }
    state.pendingCommands.set(commandId, {
      commandId,
      valveId,
      action,
      requestedAt: payload.requestedAt
    })
    await new Promise((resolve, reject) => {
      mqttClient.publish(`farm/valves/${valveId}/downlink`, JSON.stringify(payload), { qos: 1 }, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    broadcast({ kind: "valve_command", ts: Date.now(), data: payload })
    return payload
  }

  async function openValve(valveId, durationSec, source) {
    const v = state.valves.get(valveId) ?? { id: valveId, state: "CLOSE" }
    state.valves.set(valveId, { ...v, id: valveId })
    const payload = await publishValveCommand(valveId, "OPEN", durationSec, source)
    if (durationSec && durationSec > 0) {
      const key = `close:${valveId}`
      if (state.autoJobs.has(key)) clearTimeout(state.autoJobs.get(key))
      const t = setTimeout(() => {
        void closeValve(valveId, "auto_close")
        state.autoJobs.delete(key)
      }, durationSec * 1000)
      state.autoJobs.set(key, t)
    }
    return payload
  }

  async function closeValve(valveId, source) {
    const v = state.valves.get(valveId) ?? { id: valveId, state: "CLOSE" }
    state.valves.set(valveId, { ...v, id: valveId })
    return publishValveCommand(valveId, "CLOSE", null, source)
  }

  function isManualOverrideBlocking(valveId) {
    if (!state.manualOverride?.enabled) return false
    const entry = state.manualOverride?.valves?.[valveId]
    return !!entry?.enabled
  }

  async function applyPolicyForSensor(sensorMsg) {
    const humidity = Number(sensorMsg.humidityPct)
    if (!Number.isFinite(humidity)) return null
    const sensorId = String(sensorMsg.deviceId ?? "")
    if (!sensorId) return null
    const activePolicies = Array.isArray(state.policies) ? state.policies.filter((p) => p && p.active) : []
    const matches = activePolicies.filter((p) => String(p.sensorId) === sensorId)
    if (!matches.length) return null
    const now = Date.now()
    for (const p of matches) {
      const threshold = Number(p.humidityThreshold)
      const durationSec = Number(p.durationSeconds)
      const valveId = String(p.valveId ?? "")
      if (!valveId) continue
      if (isManualOverrideBlocking(valveId)) continue
      if (!Number.isFinite(threshold)) continue
      if (humidity < threshold) {
        state.valves.set(valveId, { ...(state.valves.get(valveId) ?? { id: valveId }), lastAutoAt: now })
        const effectiveDuration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : state.strategy?.openDurationSec ?? 600
        return openValve(valveId, effectiveDuration, "policy_auto")
      }
    }
    return null
  }

  async function onSensorUplink(sensorMsg) {
    const strategy = state.strategy
    if (!strategy || strategy.mode !== "auto") return
    if (strategy.autoMethod === "policy") {
      try {
        await applyPolicyForSensor(sensorMsg)
      } catch {}
      return
    }
    const { humidityPct, deviceId } = sensorMsg
    const humidity = Number(humidityPct)
    if (!Number.isFinite(humidity)) return
    const zone = getZoneForSensor(deviceId)
    const valveId = getValveForZone(zone)
    if (!valveId) return
    if (isManualOverrideBlocking(valveId)) return
    const valve = state.valves.get(valveId)
    const valveState = valve?.state ?? "CLOSE"
    const now = Date.now()
    const lastAutoAt = valve?.lastAutoAt ?? 0
    const cooldownMs = (strategy.cooldownMinutes ?? 20) * 60_000
    if (now - lastAutoAt < cooldownMs) return

    if (humidity <= strategy.humidityLowPct && valveState !== "OPEN") {
      state.valves.set(valveId, { ...(valve ?? { id: valveId }), lastAutoAt: now })
      try {
        await openValve(valveId, strategy.openDurationSec ?? 600, "threshold_auto")
      } catch {}
    }

    if (humidity >= strategy.humidityHighPct && valveState === "OPEN") {
      try {
        await closeValve(valveId, "threshold_auto")
      } catch {}
    }
  }

  function getManualOverride() {
    return state.manualOverride
  }

  async function setManualOverride({ enabled, valveId, desiredState, durationSec }) {
    const currentGlobalEnabled = !!state.manualOverride?.enabled
    const nextGlobalEnabled =
      typeof enabled === "boolean" && !valveId ? enabled : enabled === true && valveId ? true : currentGlobalEnabled
    const next = {
      enabled: nextGlobalEnabled,
      valves: { ...(state.manualOverride?.valves ?? {}) }
    }
    if (valveId) {
      next.valves[valveId] = {
        enabled: typeof enabled === "boolean" ? enabled : true,
        desiredState: desiredState !== undefined ? desiredState : next.valves[valveId]?.desiredState ?? null,
        updatedAt: Date.now()
      }
    }
    state.manualOverride = next
    broadcast({ kind: "override", ts: Date.now(), data: state.manualOverride })
    if (valveId && desiredState === "OPEN") {
      const duration =
        (Number.isFinite(Number(durationSec)) && Number(durationSec) > 0 ? Number(durationSec) : null) ??
        state.strategy?.manualOpenDurationSec ??
        state.strategy?.openDurationSec ??
        600
      await openValve(valveId, duration, "manual_override")
    }
    if (valveId && desiredState === "CLOSE") {
      await closeValve(valveId, "manual_override")
    }
    return state.manualOverride
  }

  async function toggleValveManual(valveId, durationSec) {
    const prev = state.valves.get(valveId)
    const prevState = prev?.state ?? "CLOSE"
    const nextDesired = prevState === "OPEN" ? "CLOSE" : "OPEN"
    const dur =
      nextDesired === "OPEN"
        ? Number.isFinite(Number(durationSec)) && Number(durationSec) > 0
          ? Number(durationSec)
          : state.strategy?.manualOpenDurationSec ?? state.strategy?.openDurationSec ?? 600
        : null
    return setManualOverride({ enabled: true, valveId, desiredState: nextDesired, durationSec: dur })
  }

  return {
    onSensorUplink,
    openValve,
    closeValve,
    publishValveCommand,
    getManualOverride,
    setManualOverride,
    toggleValveManual
  }
}

