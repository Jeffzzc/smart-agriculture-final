<template>
  <div class="app">
    <aside class="side">
      <h1>精准灌溉模拟系统</h1>
      <div class="muted">MQTT → 后端 → WebSocket → 前端 / API → MQTT</div>
      <div style="height: 12px"></div>
      <div class="nav">
        <button :class="{ active: page === 'dashboard' }" @click="page = 'dashboard'">实时数据仪表盘</button>
        <button :class="{ active: page === 'trend' }" @click="page = 'trend'">温湿度变化曲线</button>
        <button :class="{ active: page === 'map' }" @click="page = 'map'">农田设备分布图</button>
        <button :class="{ active: page === 'control' }" @click="page = 'control'">灌溉控制面板</button>
        <button :class="{ active: page === 'history' }" @click="page = 'history'">历史数据查询</button>
      </div>
      <div style="height: 14px"></div>
      <div class="kvs">
        <div class="kv"><span>连接状态</span><span>{{ wsConnected ? "在线" : "离线" }}</span></div>
        <div class="kv"><span>传感器最新数</span><span>{{ sensors.size }}</span></div>
        <div class="kv"><span>阀门最新数</span><span>{{ valves.size }}</span></div>
      </div>
      <div v-if="errorText" class="sideError">{{ errorText }}</div>
    </aside>

    <main class="content">
      <DashboardPage v-if="page === 'dashboard'" :sensors="sensors" :strategy="strategy" />
      <TrendPage v-else-if="page === 'trend'" :series="series" :devices="devices" />
      <MapPage v-else-if="page === 'map'" :devices="devices" :sensors="sensors" :valves="valves" :manual-override="manualOverride" />
      <ControlPage
        v-else-if="page === 'control'"
        :devices="devices"
        :strategy="strategy"
        :valves="valves"
        :manual-override="manualOverride"
        :policies="policies"
        @update-strategy="updateStrategy"
        @set-mode="setMode"
        @toggle-valve="toggleValve"
        @set-override="setOverride"
        @update-policies="updatePolicies"
      />
      <HistoryPage v-else :devices="devices" />
    </main>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, reactive, ref } from "vue"
import { createApi } from "./api"
import { createWsClient } from "./wsClient"
import DashboardPage from "./pages/DashboardPage.vue"
import TrendPage from "./pages/TrendPage.vue"
import MapPage from "./pages/MapPage.vue"
import ControlPage from "./pages/ControlPage.vue"
import HistoryPage from "./pages/HistoryPage.vue"

const api = createApi(import.meta.env.VITE_API_BASE ?? "")
const page = ref("dashboard")
const wsConnected = ref(false)

const devices = reactive({ sensors: [], valves: [] })
const strategy = ref(null)
const sensors = reactive(new Map())
const valves = reactive(new Map())
const series = reactive(new Map())
const manualOverride = ref({ enabled: false, valves: {} })
const policies = ref([])
const errorText = ref("")

function upsertSeries(deviceId, row) {
  const buf = series.get(deviceId) ?? []
  buf.push({ ts: row.ts, tempC: row.tempC, humidityPct: row.humidityPct })
  const trimmed = buf.slice(-120)
  series.set(deviceId, trimmed)
}

async function bootstrap() {
  const [d, s, p, o] = await Promise.all([api.devices(), api.strategy(), api.policies(), api.override()])
  devices.sensors = d.sensors ?? []
  devices.valves = d.valves ?? []
  strategy.value = s
  policies.value = p.policies ?? []
  manualOverride.value = o ?? manualOverride.value
  const latest = await api.latest()
  for (const it of latest.sensors ?? []) sensors.set(it.deviceId, it)
  for (const it of latest.valves ?? []) valves.set(it.valveId, it)
}

async function updateStrategy(partial) {
  errorText.value = ""
  try {
    strategy.value = await api.updateStrategy(partial)
  } catch (e) {
    errorText.value = e?.message ?? "更新策略失败"
  }
}

async function setMode(mode) {
  errorText.value = ""
  try {
    strategy.value = await api.setMode(mode)
  } catch (e) {
    errorText.value = e?.message ?? "切换模式失败"
  }
}

async function openValve(valveId, durationSec) {
  errorText.value = ""
  try {
    await api.openValve(valveId, durationSec)
  } catch (e) {
    errorText.value = e?.message ?? "开阀失败"
  }
}

async function closeValve(valveId) {
  errorText.value = ""
  try {
    await api.closeValve(valveId)
  } catch (e) {
    errorText.value = e?.message ?? "关阀失败"
  }
}

async function toggleValve(valveId) {
  errorText.value = ""
  try {
    const res = await api.toggleValve(valveId, strategy.value?.manualOpenDurationSec ?? 600)
    if (res?.manualOverride) manualOverride.value = res.manualOverride
  } catch (e) {
    errorText.value = e?.message ?? "开关失败"
  }
}

async function setOverride(payload) {
  errorText.value = ""
  try {
    const res = await api.updateOverride(payload)
    manualOverride.value = res
  } catch (e) {
    errorText.value = e?.message ?? "手动覆盖更新失败"
  }
}

async function updatePolicies(next) {
  errorText.value = ""
  try {
    const res = await api.updatePolicies(next)
    policies.value = res.policies ?? []
  } catch (e) {
    errorText.value = e?.message ?? "保存策略失败"
  }
}

let ws = null

onMounted(async () => {
  await bootstrap()
  const wsUrl = (import.meta.env.VITE_WS_URL ?? "").trim()
  const resolvedWsUrl =
    wsUrl ||
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host.replace(":5173", ":3000")}/ws`
  ws = createWsClient(resolvedWsUrl, (msg) => {
    wsConnected.value = true
    if (msg.kind === "hello") {
      if (msg.devices) {
        devices.sensors = msg.devices.sensors ?? devices.sensors
        devices.valves = msg.devices.valves ?? devices.valves
      }
      if (msg.strategy) strategy.value = msg.strategy
      if (Array.isArray(msg.policies)) policies.value = msg.policies
      if (msg.manualOverride) manualOverride.value = msg.manualOverride
    }
    if (msg.kind === "sensor" && msg.data?.deviceId) {
      sensors.set(msg.data.deviceId, msg.data)
      upsertSeries(msg.data.deviceId, msg.data)
    }
    if (msg.kind === "valve" && msg.data?.valveId) {
      valves.set(msg.data.valveId, msg.data)
    }
    if (msg.kind === "override" && msg.data) {
      manualOverride.value = msg.data
    }
  })
})

onBeforeUnmount(() => {
  if (ws) ws.close()
})
</script>

