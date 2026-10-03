<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { useScheduleStore } from "./stores/schedule";

const store = useScheduleStore();
const route = useRoute();
const { t } = useI18n();
const isOnline = computed({
  get: () => store.online,
  set: (value: boolean) => store.setOnline(value)
});
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <span>SC</span>
        <div><b>现场制片台</b><small>Schedule Control</small></div>
      </div>
      <nav>
        <RouterLink to="/" :class="{ active: route.name === 'schedule' }">◫ {{ t("schedule") }}</RouterLink>
        <RouterLink to="/conflicts" :class="{ active: route.name === 'conflicts' }">△ {{ t("conflicts") }} <em>{{ store.conflicts.length }}</em></RouterLink>
        <RouterLink to="/history" :class="{ active: route.name === 'history' }">↺ {{ t("history") }}</RouterLink>
      </nav>
      <div class="network-card">
        <label>运行模式</label>
        <el-switch v-model="isOnline" active-text="在线" inactive-text="离线" />
        <small>{{ isOnline ? "操作将写入本地工作区" : "请保存离线草稿，恢复后同步" }}</small>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div>
          <small>拍摄日 2026-10-08 · 项目《潮汐线》</small>
          <h1>影视剧组通告与资源冲突编排</h1>
        </div>
        <label class="role-picker">当前角色
          <select v-model="store.role">
            <option>制片</option><option>导演</option><option>演员统筹</option><option>场记</option>
          </select>
        </label>
      </header>
      <RouterView />
    </main>
  </div>
</template>
