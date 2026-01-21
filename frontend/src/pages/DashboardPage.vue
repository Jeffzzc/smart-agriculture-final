<template>
  <div class="grid">
    <div class="card" style="grid-column: span 4">
      <h2>自动灌溉策略</h2>
      <div class="kvs" v-if="strategy">
        <div class="kv"><span>模式</span><span>{{ strategy.mode }}</span></div>
        <div class="kv"><span>湿度下限</span><span>{{ strategy.humidityLowPct }}%</span></div>
        <div class="kv"><span>湿度上限</span><span>{{ strategy.humidityHighPct }}%</span></div>
        <div class="kv"><span>开阀时长</span><span>{{ strategy.openDurationSec }}s</span></div>
        <div class="kv"><span>冷却时间</span><span>{{ strategy.cooldownMinutes }}min</span></div>
        <div class="kv"><span>农田规模</span><span>{{ strategy.acreage }}亩</span></div>
      </div>
      <div v-else class="muted">加载中...</div>
    </div>

    <div class="card" style="grid-column: span 8">
      <h2>实时概览（最近 1 条）</h2>
      <ChartBox :option="gaugeOpt" height="260px" />
    </div>

    <div class="card" style="grid-column: span 12">
      <h2>最新传感器（Top 10）</h2>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px">
        <thead>
          <tr style="text-align: left; color: #475569">
            <th style="padding: 8px; border-bottom: 1px solid #e2e8f0">设备</th>
            <th style="padding: 8px; border-bottom: 1px solid #e2e8f0">温度</th>
            <th style="padding: 8px; border-bottom: 1px solid #e2e8f0">湿度</th>
            <th style="padding: 8px; border-bottom: 1px solid #e2e8f0">电压</th>
            <th style="padding: 8px; border-bottom: 1px solid #e2e8f0">时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in topRows" :key="row.deviceId">
            <td style="padding: 8px; border-bottom: 1px solid #f1f5f9">{{ row.deviceId }}</td>
            <td style="padding: 8px; border-bottom: 1px solid #f1f5f9">{{ row.tempC }} ℃</td>
            <td style="padding: 8px; border-bottom: 1px solid #f1f5f9">{{ row.humidityPct }} %</td>
            <td style="padding: 8px; border-bottom: 1px solid #f1f5f9">{{ row.batteryV }} V</td>
            <td style="padding: 8px; border-bottom: 1px solid #f1f5f9">{{ fmtTs(row.ts) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue"
import ChartBox from "../ChartBox.vue"

const props = defineProps({
  sensors: { type: Object, required: true },
  strategy: { type: Object, default: null }
})

function fmtTs(ts) {
  if (!ts) return "-"
  return new Date(ts).toLocaleString()
}

const topRows = computed(() => {
  const rows = Array.from(props.sensors.values())
  rows.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
  return rows.slice(0, 10)
})

const gaugeOpt = computed(() => {
  const rows = topRows.value
  const avgTemp = rows.length ? rows.reduce((s, r) => s + Number(r.tempC ?? 0), 0) / rows.length : 0
  const avgHum = rows.length ? rows.reduce((s, r) => s + Number(r.humidityPct ?? 0), 0) / rows.length : 0
  return {
    grid: { left: 10, right: 10, top: 10, bottom: 10 },
    series: [
      {
        type: "gauge",
        center: ["25%", "55%"],
        radius: "90%",
        min: 0,
        max: 60,
        splitNumber: 6,
        axisLine: { lineStyle: { width: 12 } },
        title: { offsetCenter: [0, "70%"], fontSize: 12 },
        detail: { valueAnimation: true, formatter: "{value}℃", fontSize: 14 },
        data: [{ value: Number(avgTemp.toFixed(1)), name: "平均温度" }]
      },
      {
        type: "gauge",
        center: ["75%", "55%"],
        radius: "90%",
        min: 0,
        max: 100,
        splitNumber: 5,
        axisLine: { lineStyle: { width: 12 } },
        title: { offsetCenter: [0, "70%"], fontSize: 12 },
        detail: { valueAnimation: true, formatter: "{value}%", fontSize: 14 },
        data: [{ value: Number(avgHum.toFixed(1)), name: "平均湿度" }]
      }
    ]
  }
})
</script>

