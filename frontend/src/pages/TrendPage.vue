<template>
  <div class="grid">
    <div class="card" style="grid-column: span 12">
      <h2>实时温湿度曲线（最近 120 点）</h2>
      <div class="row">
        <select v-model="deviceId">
          <option v-for="d in devices.sensors" :key="d.id" :value="d.id">{{ d.id }}（{{ d.zone }}）</option>
        </select>
        <span class="muted">数据来自 WebSocket 实时推送</span>
      </div>
      <div style="height: 8px"></div>
      <ChartBox :option="opt" height="420px" />
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watchEffect } from "vue"
import ChartBox from "../ChartBox.vue"

const props = defineProps({
  series: { type: Object, required: true },
  devices: { type: Object, required: true }
})

const deviceId = ref("")

watchEffect(() => {
  if (!deviceId.value && props.devices.sensors?.length) deviceId.value = props.devices.sensors[0].id
})

const opt = computed(() => {
  const rows = props.series.get(deviceId.value) ?? []
  const xs = rows.map((r) => new Date(r.ts).toLocaleTimeString())
  const temp = rows.map((r) => r.tempC)
  const hum = rows.map((r) => r.humidityPct)
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

