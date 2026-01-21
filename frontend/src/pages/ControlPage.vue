<template>
  <IrrigationControl
    :devices="devices"
    :strategy="strategy"
    :valves="valves"
    :manual-override="manualOverride"
    :policies="policies"
    @update-strategy="$emit('update-strategy', $event)"
    @set-mode="$emit('set-mode', $event)"
    @toggle-valve="$emit('toggle-valve', $event)"
    @set-override="$emit('set-override', $event)"
    @update-policies="$emit('update-policies', $event)"
  />
</template>

<script setup>
import IrrigationControl from "../components/IrrigationControl.vue"

const props = defineProps({
  devices: { type: Object, required: true },
  strategy: { type: Object, default: null },
  valves: { type: Object, required: true },
  manualOverride: { type: Object, default: null },
  policies: { type: Array, default: () => [] }
})

defineEmits(["update-strategy", "set-mode", "toggle-valve", "set-override", "update-policies"])
</script>

