<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import dayjs from "dayjs";
import { ElMessage, ElMessageBox } from "element-plus";
import { useScheduleStore } from "../stores/schedule";
import type { Conflict, ExemptionStatus, SignRole } from "../types";

const store = useScheduleStore();

const canSign = computed(() => store.role === "制片" || store.role === "导演");
const reasons = reactive<Record<string, string>>({});
const submitting = ref<string | null>(null);
const filter = ref<ExemptionStatus | "全部">("全部");
const retrying = ref<string | null>(null);

function reasonFor(id: string) {
  return reasons[id] ?? "";
}

function sceneName(id: string) {
  const scene = store.scenes.find((item) => item.id === id);
  return scene ? `${scene.code} ${scene.title}` : id;
}

const roles: SignRole[] = ["制片", "导演"];

function hasSigned(conflict: Conflict, who: SignRole) {
  return conflict.pendingRecord?.signoffs.some((s) => s.role === who) ?? false;
}

function isSigning(conflict: Conflict) {
  return store.signingIds.includes(conflict.id) || submitting.value === conflict.id;
}

async function sign(conflict: Conflict, who: SignRole) {
  if (!canSign.value) {
    ElMessage.warning("只有制片和导演可以会签放行");
    return;
  }
  if (hasSigned(conflict, who)) return;
  submitting.value = conflict.id;
  const result = await store.signConflict(conflict.id, who, reasonFor(conflict.id));
  submitting.value = null;
  if (result.ok) {
    if (result.status === "granted") {
      reasons[conflict.id] = "";
      ElMessage.success(result.message);
    } else {
      ElMessage.success(result.message);
    }
  } else if (result.status === "offline") {
    ElMessage.warning(result.message);
  } else {
    ElMessage.error(result.message);
  }
}

async function retry(id: string) {
  retrying.value = id;
  const result = await store.retryPending(id);
  retrying.value = null;
  if (result.ok) ElMessage.success(result.message);
  else if (result.status === "offline") ElMessage.warning(result.message);
  else ElMessage.error(result.message);
}

async function retryAll() {
  const results = await store.retryAllPending();
  if (!results.length) return;
  const ok = results.filter((r) => r.ok).length;
  if (ok === results.length) ElMessage.success("待提交豁免已全部续办成功");
  else ElMessage.warning(`续办完成：成功 ${ok} / ${results.length}，其余请看记录提示`);
}

const filteredRecords = computed(() => {
  const list = [...store.exemptionRecords].sort((a, b) =>
    (b.grantedAt ?? b.createdAt).localeCompare(a.grantedAt ?? a.createdAt));
  return filter.value === "全部" ? list : list.filter((r) => r.status === filter.value);
});

async function revoke(recordId: string) {
  if (!canSign.value) {
    ElMessage.warning("只有制片和导演可以撤销放行");
    return;
  }
  try {
    const { value } = await ElMessageBox.prompt("撤销后该冲突会立即重新出现，请说明撤销原因", "撤销放行记录", {
      confirmButtonText: "确认撤销",
      cancelButtonText: "取消",
      inputPlaceholder: "例如：协调到替代器材 / 改期"
    });
    store.revokeExemption(recordId, store.role as SignRole, value ?? "");
    ElMessage.success("已撤销，冲突已重新计入");
  } catch {
    /* 用户取消 */
  }
}

function fmt(time?: string) {
  return time ? dayjs(time).format("MM-DD HH:mm:ss") : "—";
}
</script>

<template>
  <section class="page">
    <!-- 写入失败后保留的待提交会签 -->
    <section v-if="store.pendingSigns.length" class="panel pending-panel">
      <div class="panel-head">
        <div>
          <h2>待提交豁免（{{ store.pendingSigns.length }}）</h2>
          <small class="muted">写入失败时保留的会签与原因；恢复在线后自动续办一次，也可手动续办</small>
        </div>
        <button class="primary" :disabled="!store.online || store.pendingSigns.every((p) => p.retried)" @click="retryAll">
          {{ store.online ? "立即续办" : "离线中…" }}
        </button>
      </div>
      <article v-for="p in store.pendingSigns" :key="p.id" class="pending-row">
        <div class="pending-main">
          <b>{{ p.type }} · {{ p.sceneIds.map(sceneName).join(" ↔ ") }}</b>
          <small class="muted">签署人：{{ p.role }} · 放行依据：{{ p.reason }}</small>
          <small class="fail-text">失败原因：{{ p.failReason }} · {{ fmt(p.at) }}<em v-if="p.retried">（已续办过一次，不再自动重试）</em></small>
        </div>
        <div class="actions">
          <button class="primary" :disabled="!store.online || p.retried || retrying === p.id" @click="retry(p.id)">
            {{ retrying === p.id ? "续办中…" : p.retried ? "已续办" : "续办一次" }}
          </button>
          <button class="secondary" @click="store.discardPending(p.id)">放弃</button>
        </div>
      </article>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>资源冲突中心</h2>
          <small class="muted">一项豁免只压住当时确认的那条冲突；演员、场地、器材或时段一改，豁免立即失效并重算</small>
        </div>
        <span class="status">{{ store.conflicts.length }} 项待处理</span>
      </div>

      <article v-for="item in store.conflicts" :key="item.id" class="conflict">
        <span class="seal">{{ item.severity }}</span>
        <div class="conflict-body">
          <b>{{ item.type }}</b>
          <p>{{ item.message }}</p>
          <small>{{ item.sceneIds.map(sceneName).join(" ↔ ") }}</small>

          <!-- 在途会签进度：未凑齐双签前冲突仍然显示、仍然计数 -->
          <div v-if="item.pendingRecord" class="sign-progress">
            <span class="chip chip-progress">会签中</span>
            <span>已签：
              <em v-for="s in item.pendingRecord.signoffs" :key="s.role">{{ s.role }}（{{ fmt(s.at) }}）</em>
              <em v-if="!item.pendingRecord.signoffs.length">暂无</em>
            </span>
            <small class="muted">放行依据：{{ item.pendingRecord.reason }}</small>
          </div>

          <!-- 旁边说明上一轮放行是被哪次改动打掉的，还是被谁撤销的 -->
          <div v-if="item.lastRecord" class="trace" :class="item.lastRecord.status">
            <template v-if="item.lastRecord.status === '已失效'">
              <span class="chip chip-stale">旧豁免已失效</span>
              <small>{{ fmt(item.lastRecord.at) }} · {{ item.lastRecord.changeText }}</small>
            </template>
            <template v-else>
              <span class="chip chip-revoked">豁免已撤销</span>
              <small>{{ fmt(item.lastRecord.at) }} · {{ item.lastRecord.revokedBy }}撤销：{{ item.lastRecord.revokeReason }}</small>
            </template>
          </div>

          <!-- 会签区：制片、导演分别签署，同一角色不能重复通过 -->
          <div class="sign-box">
            <input
              v-model="reasons[item.id]"
              :disabled="!canSign"
              :placeholder="item.pendingRecord ? '可补充放行依据，留空沿用首位会签人的说明' : '放行依据，例如：演员带妆赶场已协调、场地加棚'"
            />
            <div class="actions">
              <button
                v-for="who in roles"
                :key="who"
                :class="hasSigned(item, who) ? 'secondary' : 'primary'"
                :disabled="!canSign || hasSigned(item, who) || isSigning(item)"
                @click="sign(item, who)"
              >
                {{ hasSigned(item, who) ? `✓ ${who}已签` : `${who}会签` }}
              </button>
            </div>
            <small v-if="!canSign" class="muted">当前角色（{{ store.role }}）仅可查看，会签需制片与导演分别提交</small>
          </div>
        </div>
      </article>
      <el-empty v-if="!store.conflicts.length" description="当前没有未处理冲突（生效中的豁免正在放行）" />
    </section>

    <!-- 放行记录台账：授予 / 失效 / 撤销都可追溯 -->
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>放行记录</h2>
          <small class="muted">每条记录锁定授予时的参与资源与时段；变化后立即失效，并注明是哪次改动</small>
        </div>
        <div class="actions">
          <button
            v-for="value in ['全部','会签中','生效中','已失效','已撤销']"
            :key="value"
            class="secondary"
            :class="{ active: filter === value }"
            @click="filter = value as ExemptionStatus | '全部'"
          >{{ value }}</button>
        </div>
      </div>

      <el-empty v-if="!filteredRecords.length" description="暂无放行记录" />
      <article v-for="r in filteredRecords" :key="r.id" class="ledger-row" :class="r.status">
        <div class="ledger-main">
          <div class="ledger-title">
            <b>{{ r.type }}</b>
            <span class="chip" :class="{
              'chip-progress': r.status === '会签中',
              'chip-live': r.status === '生效中',
              'chip-stale': r.status === '已失效',
              'chip-revoked': r.status === '已撤销'
            }">{{ r.status }}</span>
          </div>
          <small class="muted">场次：{{ r.sceneIds.map(sceneName).join(" ↔ ") }}</small>
          <small>授予依据：{{ r.basis.summary }}</small>
          <small>放行说明：{{ r.reason }}</small>
          <small class="muted">
            会签：
            <em v-for="s in r.signoffs" :key="s.role + s.at">{{ s.role }} {{ fmt(s.at) }}；</em>
            <em v-if="!r.signoffs.length">无</em>
          </small>
          <small v-if="r.status === '已失效'" class="fail-text">
            失效于 {{ fmt(r.invalidatedAt) }}：{{ r.invalidatedByChange }}
          </small>
          <small v-if="r.status === '已撤销'" class="revoke-text">
            {{ r.revokedBy }} 于 {{ fmt(r.revokedAt) }} 撤销：{{ r.revokeReason }}
          </small>
        </div>
        <div class="actions">
          <button
            v-if="r.status === '生效中' || r.status === '会签中'"
            class="danger"
            :disabled="!canSign"
            @click="revoke(r.id)"
          >撤销</button>
        </div>
      </article>
    </section>
  </section>
</template>

<style scoped>
.conflict-body { display: grid; gap: 8px; }
.conflict-body p { margin: 0; }
.sign-box { display: grid; gap: 8px; margin-top: 4px; }
.sign-box input { border: 1px solid #cfd7e5; border-radius: 9px; padding: 8px 10px; background: #fff; }
.sign-progress { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; background: #eef4ff; border: 1px solid #c3d4f4; border-radius: 9px; padding: 8px 10px; }
.sign-progress em { font-style: normal; color: #1d4e9c; margin-right: 6px; }
.trace { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; border-radius: 9px; padding: 8px 10px; }
.trace.已失效 { background: #fdf1e4; border: 1px solid #efcf83; }
.trace.已撤销 { background: #f7ecec; border: 1px solid #e2b5b5; }
.chip { display: inline-block; padding: 2px 9px; border-radius: 99px; font-size: 12px; background: #e8edf4; color: #445065; white-space: nowrap; }
.chip-progress { background: #dde9ff; color: #1d4e9c; }
.chip-live { background: #dff3e8; color: #19704b; }
.chip-stale { background: #f8e2c0; color: #96600d; }
.chip-revoked { background: #f3d4d4; color: #a02f2f; }
.pending-panel { border-color: #efcf83; }
.pending-row { display: flex; justify-content: space-between; gap: 14px; align-items: center; padding: 11px 12px; background: #fff9ec; border: 1px solid #efcf83; border-radius: 10px; margin-bottom: 8px; }
.pending-main { display: grid; gap: 3px; }
.fail-text { color: #a35d12; }
.fail-text em { font-style: normal; color: #a02f2f; }
.ledger-row { display: flex; justify-content: space-between; gap: 14px; padding: 13px; border: 1px solid var(--line); border-radius: 12px; background: #fbfcfe; margin-bottom: 10px; }
.ledger-row.已失效 { background: #fdf8f1; }
.ledger-row.已撤销 { background: #fcf6f6; }
.ledger-main { display: grid; gap: 4px; }
.ledger-main small { display: block; }
.ledger-title { display: flex; gap: 10px; align-items: center; }
.revoke-text { color: #a02f2f; }
.actions button.active { background: var(--navy); color: #fff; }
</style>
