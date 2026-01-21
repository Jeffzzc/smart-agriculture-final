<template>
  <div ref="el" :style="{ width: '100%', height }"></div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from "vue"
import * as echarts from "echarts"

const props = defineProps({
  option: { type: Object, required: true },
  height: { type: String, default: "320px" }
})

const el = ref(null)
let chart = null

function resize() {
  if (chart) chart.resize()
}

onMounted(() => {
  chart = echarts.init(el.value)
  chart.setOption(props.option, { notMerge: true })
  window.addEventListener("resize", resize)
})

watch(
  () => props.option,
  (opt) => {
    if (chart) chart.setOption(opt, { notMerge: true })
  },
  { deep: true }
)

onBeforeUnmount(() => {
  window.removeEventListener("resize", resize)
  if (chart) chart.dispose()
})
</script>

