<template>
  <div class="grid">
    <div class="card" style="grid-column: span 6">
      <h2>模式切换</h2>
      <div class="row" v-if="strategy">
        <span>当前：{{ strategy.mode }}</span>
        <button class="secondary" @click="$emit('set-mode', 'manual')">手动</button>
        <button @click="$emit('set-mode', 'auto')">自动</button>
      </div>
      <div v-else class="muted">加载中...</div>
    </div>

    <div class="card" style="grid-column: span 6">
      <h2>自动控制方式</h2>
      <div class="row" v-if="strategy">
        <select v-model="draft.autoMethod">
          <option value="threshold">阈值策略（按分区）</option>
          <option value="policy">灌溉策略（按传感器/阀门）</option>
        </select>
        <button @click="saveAutoMethod">应用</button>
        <span class="muted">手动覆盖开启时，会阻止该阀门的自动动作。</span>
      </div>
    </div>

    <div class="card" style="grid-column: span 12" v-if="draft.autoMethod === 'threshold'">
      <h2>阈值策略配置</h2>
      <div class="row" v-if="strategy">
        <span>湿度下限</span>
        <input type="number" v-model.number="draft.low" style="width: 90px" />
        <span>湿度上限</span>
        <input type="number" v-model.number="draft.high" style="width: 90px" />
        <span>开阀时长(s)</span>
        <input type="number" v-model.number="draft.duration" style="width: 110px" />
        <button @click="saveThreshold">保存</button>
      </div>
    </div>

    <div class="card" style="grid-column: span 12" v-else>
      <h2>灌溉策略（来源：原项目 code 的 IrrigationPolicy 逻辑）</h2>
      <div class="muted">满足：humidity &lt; threshold → OPEN(duration)。可对每个传感器单独绑定阀门。</div>
      <div style="height: 10px"></div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px">
        <thead>
          <tr style="text-align: left; color: #475569">
            <th style="padding: 8px; border-bottom: 1px solid #e2e8f0">启用</th>
            <th style="padding: 8px; border-bottom: 1px solid #e2e8f0">传感器</th>
            <th style="padding: 8px; border-bottom: 1px solid #e2e8f0">阀门</th>
            <th style="padding: 8px; border-bottom: 1px solid #e2e8f0">阈值(%)</th>
            <th style="padding: 8px; border-bottom: 1px solid #e2e8f0">时长(s)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(p, idx) in policyDraft" :key="p.id ?? idx">
            <td style="padding: 8px; border-bottom: 1px solid #f1f5f9">
              <input type="checkbox" v-model="p.active" />
            </td>
            <td style="padding: 8px; border-bottom: 1px solid #f1f5f9">
              <select v-model="p.sensorId">
                <option value="">选择传感器</option>
                <option v-for="s in devices.sensors" :key="s.id" :value="s.id">{{ s.id }}（{{ s.zone }}）</option>
              </select>
            </td>
            <td style="padding: 8px; border-bottom: 1px solid #f1f5f9">
              <select v-model="p.valveId">
                <option value="">选择阀门</option>
                <option v-for="v in devices.valves" :key="v.id" :value="v.id">{{ v.id }}（{{ v.zone }}）</option>
              </select>
            </td>
            <td style="padding: 8px; border-bottom: 1px solid #f1f5f9">
              <input type="number" v-model.number="p.humidityThreshold" style="width: 110px" />
            </td>
            <td style="padding: 8px; border-bottom: 1px solid #f1f5f9">
              <input type="number" v-model.number="p.durationSeconds" style="width: 110px" />
            </td>
          </tr>
        </tbody>
      </table>
      <div style="height: 10px"></div>
      <div class="row">
        <button class="secondary" @click="addPolicy">新增策略</button>
        <button @click="savePolicies">保存策略</button>
      </div>
    </div>

    <div class="card" style="grid-column: span 12">
      <div class="row" style="justify-content: space-between">
        <h2 style="margin: 0">灌溉手动控制</h2>
        <div class="row">
          <span class="muted">手动覆盖：</span>
          <button :class="manualEnabled ? '' : 'secondary'" @click="setManualGlobal(true)">启用</button>
          <button :class="manualEnabled ? 'secondary' : ''" @click="setManualGlobal(false)">关闭</button>
        </div>
      </div>
      <div class="muted">开关按钮会进入“手动覆盖”状态：该阀门将不再被自动策略改变。</div>
      <div style="height: 10px"></div>

      <div class="valveGrid">
        <div v-for="v in devices.valves" :key="v.id" class="valveCard">
          <div class="row" style="justify-content: space-between">
            <div>
              <div class="valveTitle">{{ v.id }}</div>
              <div class="muted">分区：{{ v.zone }}</div>
            </div>
            <div class="badge" :class="valveState(v.id) === 'OPEN' ? 'on' : 'off'">
              {{ valveState(v.id) === "OPEN" ? "灌溉中" : "已关闭" }}
            </div>
          </div>
          <div style="height: 10px"></div>
          <div class="row" style="justify-content: space-between">
            <div class="muted">电压：{{ valves.get(v.id)?.batteryV ?? "-" }} V</div>
            <div class="badge" :class="isValveOverrideEnabled(v.id) ? 'manual' : 'auto'">
              {{ isValveOverrideEnabled(v.id) ? "手动覆盖" : "自动可控" }}
            </div>
          </div>
          <div style="height: 10px"></div>
          <div class="row">
            <button class="toggle" :class="valveState(v.id) === 'OPEN' ? 'toggleOn' : 'toggleOff'" @click="toggle(v.id)">
              {{ valveState(v.id) === "OPEN" ? "关闭" : "开启" }}
            </button>
            <button class="secondary" @click="release(v.id)">释放手动</button>
          </div>
        </div>
      </div>

      <div v-if="error" class="errorBox">{{ error }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watchEffect } from "vue"

const props = defineProps({
  devices: { type: Object, required: true },
  strategy: { type: Object, default: null },
  valves: { type: Object, required: true },
  manualOverride: { type: Object, default: null },
  policies: { type: Array, default: () => [] }
})

const emit = defineEmits(["update-strategy", "set-mode", "toggle-valve", "set-override", "update-policies"])

const error = ref("")
const draft = reactive({ low: 35, high: 45, duration: 600, autoMethod: "threshold" })
const policyDraft = ref([])

watchEffect(() => {
  if (!props.strategy) return
  draft.low = props.strategy.humidityLowPct
  draft.high = props.strategy.humidityHighPct
  draft.duration = props.strategy.openDurationSec
  draft.autoMethod = props.strategy.autoMethod ?? "threshold"
})

watchEffect(() => {
  policyDraft.value = (props.policies ?? []).map((p) => ({ ...p }))
})

const manualEnabled = computed(() => !!props.manualOverride?.enabled)

function valveState(valveId) {
  return (props.valves.get(valveId)?.state ?? "CLOSE") === "OPEN" ? "OPEN" : "CLOSE"
}

function isValveOverrideEnabled(valveId) {
  return !!props.manualOverride?.enabled && !!props.manualOverride?.valves?.[valveId]?.enabled
}

function saveThreshold() {
  emit("update-strategy", {
    humidityLowPct: Number(draft.low),
    humidityHighPct: Number(draft.high),
    openDurationSec: Number(draft.duration)
  })
}

function saveAutoMethod() {
  emit("update-strategy", { autoMethod: draft.autoMethod })
}

function addPolicy() {
  policyDraft.value = [
    ...policyDraft.value,
    { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, sensorId: "", valveId: "", humidityThreshold: 35, durationSeconds: 600, active: true }
  ]
}

function savePolicies() {
  emit("update-policies", policyDraft.value)
}

async function toggle(valveId) {
  error.value = ""
  try {
    emit("toggle-valve", valveId)
  } catch (e) {
    error.value = e?.message ?? "操作失败"
  }
}

function release(valveId) {
  error.value = ""
  emit("set-override", { valveId, enabled: false, desiredState: null })
}

function setManualGlobal(enabled) {
  error.value = ""
  emit("set-override", { globalEnabled: enabled })
}
</script>

<style scoped>
.valveGrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.valveCard {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 12px;
  background: #ffffff;
}

.valveTitle {
  font-weight: 700;
}

.badge {
  font-size: 12px;
  border-radius: 999px;
  padding: 6px 10px;
  border: 1px solid #e2e8f0;
}

.badge.on {
  background: rgba(34, 197, 94, 0.14);
  border-color: rgba(34, 197, 94, 0.35);
  color: #166534;
}

.badge.off {
  background: rgba(148, 163, 184, 0.12);
  border-color: rgba(148, 163, 184, 0.28);
  color: #334155;
}

.badge.manual {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.28);
  color: #92400e;
}

.badge.auto {
  background: rgba(14, 165, 233, 0.1);
  border-color: rgba(14, 165, 233, 0.25);
  color: #075985;
}

.toggle {
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid #cbd5e1;
  cursor: pointer;
  color: white;
}

.toggleOn {
  background: #ef4444;
  border-color: #ef4444;
}

.toggleOff {
  background: #22c55e;
  border-color: #22c55e;
}

.errorBox {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.08);
  color: #991b1b;
  font-size: 13px;
}

@media (max-width: 1024px) {
  .valveGrid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .valveGrid {
    grid-template-columns: 1fr;
  }
}
</style>
