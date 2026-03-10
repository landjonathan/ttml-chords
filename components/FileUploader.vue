<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  ttmlLoaded: [content: string, fileName: string]
  audioLoaded: [url: string, fileName: string]
}>()

const isDragging = ref(false)
const ttmlFileName = ref('')
const audioFileName = ref('')

function handleDrop(e: DragEvent) {
  isDragging.value = false
  const files = e.dataTransfer?.files
  if (files) processFiles(files)
}

function handleFileInput(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) processFiles(input.files)
}

function processFiles(files: FileList) {
  for (const file of Array.from(files)) {
    if (file.name.endsWith('.ttml') || file.name.endsWith('.xml')) {
      const reader = new FileReader()
      reader.onload = () => {
        ttmlFileName.value = file.name
        emit('ttmlLoaded', reader.result as string, file.name)
      }
      reader.readAsText(file)
    } else if (file.type.startsWith('audio/')) {
      audioFileName.value = file.name
      const url = URL.createObjectURL(file)
      emit('audioLoaded', url, file.name)
    }
  }
}

</script>

<template>
  <div class="file-uploader">
    <div
      class="drop-zone"
      :class="{ dragging: isDragging }"
      @dragover.prevent="isDragging = true"
      @dragleave="isDragging = false"
      @drop.prevent="handleDrop"
    >
      <div class="drop-content">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <p>Drop <strong>.ttml</strong> and <strong>audio</strong> files here</p>
        <label class="browse-btn">
          Browse files
          <input
            type="file"
            accept=".ttml,.xml,audio/*"
            multiple
            hidden
            @change="handleFileInput"
          />
        </label>
      </div>
    </div>

    <div class="file-status">
      <div v-if="ttmlFileName" class="file-tag ttml">
        <span class="dot"></span>{{ ttmlFileName }}
      </div>
      <div v-if="audioFileName" class="file-tag audio">
        <span class="dot"></span>{{ audioFileName }}
      </div>
    </div>

  </div>
</template>

<style scoped>
.file-uploader {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.drop-zone {
  width: 100%;
  max-width: 480px;
  border: 2px dashed rgba(255, 255, 255, 0.15);
  border-radius: 16px;
  padding: 40px 24px;
  text-align: center;
  transition: all 0.2s ease;
  cursor: pointer;
}

.drop-zone.dragging {
  border-color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.05);
}

.drop-zone:hover {
  border-color: rgba(255, 255, 255, 0.3);
}

.drop-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.drop-content p {
  margin: 0;
  font-size: 14px;
}

.browse-btn {
  display: inline-block;
  padding: 8px 20px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  transition: background 0.2s;
}

.browse-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.file-status {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.file-tag {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
}

.file-tag .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.file-tag.ttml .dot {
  background: #5ac8fa;
}

.file-tag.audio .dot {
  background: #30d158;
}

</style>
