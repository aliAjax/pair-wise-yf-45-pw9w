<script setup lang="ts">
import { computed } from "vue";
import dayjs from "dayjs";
import { useScheduleStore } from "../stores/schedule";
const store = useScheduleStore();

const exemptionActions = new Set(["会签通过", "授予豁免", "豁免失效", "撤销豁免", "会签待提交", "会签续办", "会签续办失败", "撤销待提交"]);

function tagClass(action: string) {
  if (action === "授予豁免" || action === "会签通过" || action === "会签续办") return "tag tag-grant";
  if (action === "豁免失效" || action === "会签续办失败") return "tag tag-stale";
  if (action === "撤销豁免" || action === "撤销待提交") return "tag tag-revoke";
  if (action === "会签待提交") return "tag tag-pending";
  return "";
}

const healthy = computed({
  get: () => store.storageHealthy,
  set: (value: boolean) => store.setStorageHealthy(value)
});
</script>
<template>
  <section class="page grid-2">
    <section class="panel">
      <div class="panel-head"><div><h2>版本快照</h2><small class="muted">恢复会覆盖当前通告，旧版本的豁免不沿用到当前结果，并保留恢复记录</small></div><button class="primary" :disabled="store.role === '场记'" @click="store.snapshot()">创建版本</button></div>
      <el-empty v-if="!store.versions.length" description="尚未创建版本" />
      <article v-for="item in store.versions" :key="item.id" class="draft-banner" style="margin-bottom:10px">
        <div><b>{{ item.name }}</b><br><small>{{ dayjs(item.time).format("YYYY-MM-DD HH:mm:ss") }} · {{ item.scenes.length }} 场</small></div>
        <button class="secondary" :disabled="store.role !== '制片'" @click="store.restore(item.id)">恢复</button>
      </article>

      <div class="network-test">
        <label>写入通道（演示用）</label>
        <el-switch v-model="healthy" active-text="正常" inactive-text="故障" />
        <small class="muted">切到“故障”后提交会签会写入失败，自动保留待提交豁免与原因；切回正常后自动续办一次。也可用左侧“离线”开关模拟断网。</small>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>操作历史</h2><span class="status">{{ store.history.length }} 条</span></div>
      <div class="history">
        <el-empty v-if="!store.history.length" description="暂无操作" />
        <div v-for="item in store.history" :key="item.id" class="history-row">
          <span class="muted">{{ dayjs(item.time).format("MM-DD HH:mm:ss") }}</span>
          <b>
            <span v-if="exemptionActions.has(item.action)" :class="tagClass(item.action)">{{ item.action }}</span>
            <template v-else>{{ item.action }}</template>
          </b>
          <span>{{ item.detail }}</span>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.tag { display: inline-block; padding: 2px 9px; border-radius: 99px; font-size: 12px; font-weight: 700; }
.tag-grant { background: #dff3e8; color: #19704b; }
.tag-stale { background: #f8e2c0; color: #96600d; }
.tag-revoke { background: #f3d4d4; color: #a02f2f; }
.tag-pending { background: #dde9ff; color: #1d4e9c; }
.network-test { margin-top: 14px; padding: 13px; border: 1px dashed #cfd7e5; border-radius: 10px; display: grid; gap: 8px; }
.network-test label { color: var(--muted); font-size: 13px; }
</style>
