<script setup lang="ts">
import { computed, ref } from "vue";
import dayjs from "dayjs";
import { ElMessage, ElMessageBox } from "element-plus";
import { useScheduleStore } from "../stores/schedule";
import type { Exemption, ExemptionStatus } from "../types";

const store = useScheduleStore();

const dialogVisible = ref(false);
const reason = ref("");
const activeConflictId = ref("");

const canRequest = computed(() => store.role !== "场记");

function sceneName(id: string) {
  const scene = store.scenes.find((item) => item.id === id);
  return scene ? `${scene.code} ${scene.title}` : id;
}

function openRequest(conflictId: string) {
  activeConflictId.value = conflictId;
  reason.value = "";
  dialogVisible.value = true;
}

function submitRequest() {
  const result = store.requestExemption(activeConflictId.value, reason.value);
  if (result.ok) {
    dialogVisible.value = false;
    if (result.pending) {
      ElMessage.warning("已保留待提交豁免，恢复后续办");
    } else {
      ElMessage.success("已提交豁免申请，等待制片、导演会签");
    }
  } else {
    ElMessage.error(result.error ?? "提交失败");
  }
}

function sign(ex: Exemption) {
  try {
    store.countersign(ex.id, ex.version);
    ElMessage.success("会签成功");
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

async function revoke(ex: Exemption) {
  try {
    const { value } = await ElMessageBox.prompt("请填写撤销原因", "撤销豁免", {
      confirmButtonText: "确认撤销",
      cancelButtonText: "取消",
      inputType: "textarea",
      inputPlaceholder: "例如：冲突已重新评估，需重新处理"
    });
    store.revokeExemption(ex.id, value);
    ElMessage.success("已撤销豁免");
  } catch (error) {
    if (error !== "cancel") ElMessage.error((error as Error).message);
  }
}

function retry() {
  store.retryPending();
  if (store.pendingExemption) {
    ElMessage.warning(store.pendingExemption.failReason || "续办失败");
  } else {
    ElMessage.success("待提交豁免已续办");
  }
}

function basisText(ex: Exemption) {
  const parts: string[] = [];
  for (const id of ex.sceneIds) {
    const basis = ex.basis[id];
    if (basis) parts.push(`${basis.code} ${basis.day} ${basis.start}–${basis.end}`);
  }
  let resource = "";
  if (ex.type === "演员档期") resource = `参与演员：${store.talentNames(ex.sharedResource).join("、") || "—"}`;
  else if (ex.type === "场地占用") resource = `场地：${store.locationName(ex.sharedResource[0])}`;
  else if (ex.type === "器材借用") resource = `参与器材：${store.equipmentNames(ex.sharedResource).join("、") || "—"}`;
  else resource = "转场间隔（无共享资源）";
  return `${parts.join(" 与 ")}；${resource}`;
}

function statusType(status: ExemptionStatus) {
  if (status === "已生效") return "success";
  if (status === "已失效") return "danger";
  if (status === "已撤销") return "info";
  return "warning";
}

function signedBy(ex: Exemption, role: "制片" | "导演") {
  return ex.countersigns.some((item) => item.role === role);
}

function canSign(ex: Exemption, role: "制片" | "导演") {
  return ex.status === "待会签" && store.role === role && !signedBy(ex, role);
}
</script>

<template>
  <section class="page">
    <div v-if="store.pendingExemption" class="draft-banner pending">
      <div>
        <b>有未提交的豁免申请</b>
        <small>失败于 {{ dayjs(store.pendingExemption.failedAt).format("MM-DD HH:mm:ss") }} · 原因：{{ store.pendingExemption.failReason }}</small>
        <small class="muted">内容：{{ store.pendingExemption.type }}（{{ store.pendingExemption.sceneIds.map(sceneName).join(" ↔ ") }}）理由：{{ store.pendingExemption.reason }}</small>
      </div>
      <div class="actions">
        <button class="primary" @click="retry">恢复后续办</button>
      </div>
    </div>

    <div class="grid-2 conflict-grid">
      <section class="panel">
        <div class="panel-head">
          <div><h2>资源冲突中心</h2><small class="muted">系统按日期和时间段检查演员、场地、器材与转场间隔</small></div>
          <span class="status">{{ store.conflicts.length }} 项待处理</span>
        </div>
        <article v-for="item in store.conflicts" :key="item.id" class="conflict">
          <span class="seal">{{ item.severity }}</span>
          <div>
            <b>{{ item.type }}</b>
            <p>{{ item.message }}</p>
            <small>{{ item.sceneIds.map(sceneName).join(" ↔ ") }}</small>
          </div>
          <button class="secondary" :disabled="!canRequest" @click="openRequest(item.id)">申请豁免</button>
        </article>
        <el-empty v-if="!store.conflicts.length" description="当前没有未处理冲突" />
      </section>

      <section class="panel">
        <div class="panel-head">
          <div><h2>豁免记录</h2><small class="muted">一项只压住授予时确认的那条冲突，资源或时段变化即失效</small></div>
        </div>
        <el-empty v-if="!store.exemptions.length" description="暂无豁免记录" />
        <article v-for="ex in store.exemptions" :key="ex.id" class="exemption" :class="{ expired: ex.status === '已失效', revoked: ex.status === '已撤销' }">
          <div class="exemption-head">
            <b>{{ ex.type }}</b>
            <el-tag :type="statusType(ex.status)" size="small">{{ ex.status }}</el-tag>
          </div>
          <small class="muted">{{ ex.sceneIds.map(sceneName).join(" ↔ ") }}</small>
          <small class="basis">依据：{{ basisText(ex) }}</small>
          <small class="muted">理由：{{ ex.reason }}</small>

          <div v-if="ex.status === '待会签'" class="countersign">
            <span class="muted">会签：</span>
            <el-tag size="small" :type="signedBy(ex, '制片') ? 'success' : 'info'">制片 {{ signedBy(ex, '制片') ? '✓' : '未签' }}</el-tag>
            <el-tag size="small" :type="signedBy(ex, '导演') ? 'success' : 'info'">导演 {{ signedBy(ex, '导演') ? '✓' : '未签' }}</el-tag>
            <button class="secondary" :disabled="!canSign(ex, '制片')" @click="sign(ex)">制片会签</button>
            <button class="secondary" :disabled="!canSign(ex, '导演')" @click="sign(ex)">导演会签</button>
          </div>

          <div v-if="ex.status === '已生效'" class="countersign">
            <el-tag size="small" type="success">制片 ✓</el-tag>
            <el-tag size="small" type="success">导演 ✓</el-tag>
            <button class="danger" @click="revoke(ex)">撤销</button>
          </div>

          <div v-if="ex.status === '已失效'" class="invalid-note">
            <b>已失效</b>
            <small>{{ ex.invalidatedReason }}</small>
            <small class="muted">{{ dayjs(ex.invalidatedAt).format("MM-DD HH:mm:ss") }}</small>
          </div>
          <div v-if="ex.status === '已撤销'" class="invalid-note">
            <b>已撤销</b>
            <small>{{ ex.revokedReason }}</small>
            <small class="muted">{{ dayjs(ex.revokedAt).format("MM-DD HH:mm:ss") }}</small>
          </div>
        </article>
      </section>
    </div>

    <el-dialog v-model="dialogVisible" title="申请豁免" width="480px">
      <p class="muted">豁免仅对当前这条冲突生效；参与资源或时段变化后将自动失效并重新计入冲突。</p>
      <el-input v-model="reason" type="textarea" :rows="3" placeholder="请说明豁免理由，例如：演员已协调档期，场地已确认调整" />
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitRequest">提交申请</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.conflict-grid { align-items: start; }
.pending { background: #fff4d8; border-color: #efcf83; margin-bottom: 18px; }
.pending small { display: block; margin-top: 3px; }
.exemption { display: grid; gap: 6px; padding: 13px; border: 1px solid var(--line); border-radius: 12px; background: #fbfcfe; margin-bottom: 10px; }
.exemption.expired { border-color: #e5b8b8; background: #fbf3f3; }
.exemption.revoked { opacity: .75; }
.exemption-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.basis { color: var(--ink); }
.countersign { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 4px; }
.countersign button { margin-left: 0; }
.invalid-note { display: grid; gap: 2px; padding: 8px 10px; border-radius: 8px; background: #fbeaea; color: #a03a3a; }
</style>
