<template>
  <div class="grid">
    <div class="card" style="grid-column: span 12">
      <h2>历史数据查询</h2>
      <div class="row">
        <select v-model="type">
          <option value="sensor">传感器</option>
          <option value="valve">电磁阀</option>
        </select>
        <select v-model="deviceId">
          <option v-for="d in list" :key="d.id" :value="d.id">{{ d.id }}（{{ d.zone }}）</option>
        </select>
        <input type="date" v-model="date" />
        <button @click="load">查询</button>
        <span class="muted">默认按天文件查询；适合 30 分钟频率与 500 亩规模模拟</span>
      </div>
      <div style="height: 10px"></div>
      <ChartBox v-if="rows.length && type === 'sensor'" :option="opt" height="420px" />
      <div v-else-if="rows.length && type === 'valve'" class="kvs">
        <div class="kv"><span>记录条数</span><span>{{ rows.length }}</span></div>
        <div class="kv" v-for="r in rows.slice(-12)" :key="r.ts">
          <span>{{ new Date(r.ts).toLocaleString() }}</span>
          <span>{{ r.state }} / {{ r.batteryV }}V</span>
        </div>
      </div>
      <div v-else class="muted">暂无数据（请先运行模拟器或切换日期/设备）</div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watchEffect } from "vue"
import ChartBox from "../ChartBox.vue"
import { createApi } from "../api"

const api = createApi(import.meta.env.VITE_API_BASE ?? "")

const props = defineProps({
  devices: { type: Object, required: true }
})

const type = ref("sensor")
const deviceId = ref("")
const date = ref(new Date().toISOString().slice(0, 10))
const rows = ref([])

const list = computed(() => (type.value === "valve" ? props.devices.valves ?? [] : props.devices.sensors ?? []))

watchEffect(() => {
  if (!deviceId.value && list.value.length) deviceId.value = list.value[0].id
})

async function load() {
  if (!deviceId.value) return
  const resp = await api.history({ deviceId: deviceId.value, type: type.value, date: date.value, limit: 2000 })
  rows.value = resp.rows ?? []
}

const opt = computed(() => {
  const xs = rows.value.map((r) => new Date(r.ts).toLocaleTimeString())
  const temp = rows.value.map((r) => r.tempC)
  const hum = rows.value.map((r) => r.humidityPct)
  return {
    tooltip: { trigger: "axis" },
    legend: { data: ["温度(℃)", "湿度(%)"] },
    grid: { left: 40, right: 20, top: 40, bottom: 30 },
    xAxis: { type: "category", data: xs, boundaryGap: false },
    yAxis: [{ type: "value", name: "温度" }, { type: "value", name: "湿度" }],
    series: [
      { name: "温度(℃)", type: "line", showSymbol: false, data: temp, yAxisIndex: 0 },
      { name: "湿度(%)", type: "line", showSymbol: false, data: hum, yAxisIndex: 1 }
    ]
  }
})
</script>

