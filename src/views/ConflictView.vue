<script setup lang="ts">
import { useScheduleStore } from "../stores/schedule";
const store = useScheduleStore();
function sceneName(id: string) {
  const scene = store.scenes.find((item) => item.id === id);
  return scene ? `${scene.code} ${scene.title}` : id;
}
</script>
<template>
  <section class="page">
    <section class="panel">
      <div class="panel-head"><div><h2>资源冲突中心</h2><small class="muted">系统按日期和时间段检查演员、场地、器材与转场间隔</small></div><span class="status">{{ store.conflicts.length }} 项待处理</span></div>
      <article v-for="item in store.conflicts" :key="item.id" class="conflict">
        <span class="seal">{{ item.severity }}</span>
        <div><b>{{ item.type }}</b><p>{{ item.message }}</p><small>{{ item.sceneIds.map(sceneName).join(" ↔ ") }}</small></div>
        <button class="secondary" :disabled="store.role === '场记'" @click="store.exempt(item.id)">负责人豁免</button>
      </article>
      <el-empty v-if="!store.conflicts.length" description="当前没有未处理冲突" />
    </section>
  </section>
</template>
