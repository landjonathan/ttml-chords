<script setup lang="ts">
defineProps<{
  hasChords: boolean
  transposition: number
  playbackRate: number
}>()

defineEmits<{
  transpose: [halfSteps: number]
  rateChange: [rate: number]
}>()
</script>

<template>
  <div v-if="hasChords" class="right-sidebar">
    <div class="transpose-controls">
      <button class="transpose-btn" @click="$emit('transpose', 1)">+</button>
      <span class="transpose-label">{{ transposition > 0 ? '+' : '' }}{{ transposition }}</span>
      <button class="transpose-btn" @click="$emit('transpose', -1)">-</button>
    </div>
    <span class="rate-label">{{ playbackRate.toFixed(2) }}x</span>
    <input
      type="range"
      min="0.5"
      max="2"
      step="0.05"
      :value="playbackRate"
      class="rate-input"
      orient="vertical"
      @input="(e: Event) => $emit('rateChange', parseFloat((e.target as HTMLInputElement).value))"
    />
  </div>
</template>

<style scoped>
.right-sidebar {
  position: fixed;
  right: env(safe-area-inset-right, 0px);
  top: 0;
  bottom: 0;
  width: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  z-index: 5;
}
.transpose-controls { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.transpose-btn {
  width: 22px;
  height: 22px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  padding: 0;
}
.transpose-btn:hover { background: rgba(255, 255, 255, 0.12); color: rgba(255, 255, 255, 0.9); }
.transpose-label { font-size: 10px; color: rgba(255, 255, 255, 0.35); font-variant-numeric: tabular-nums; }
.rate-input {
  writing-mode: vertical-lr;
  direction: ltr;
  height: 60vh;
  width: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
.rate-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.5);
}
.rate-label { font-size: 10px; color: rgba(255, 255, 255, 0.35); font-variant-numeric: tabular-nums; }
</style>
