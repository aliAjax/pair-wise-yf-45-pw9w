import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import dayjs from "dayjs";
import type { Conflict, ConflictType, CountersignRole, Equipment, Exemption, ExemptionStatus, HistoryEntry, Location, OfflineDraft, PendingExemption, Role, Scene, SceneBasis, SceneStatus, Talent, Version } from "../types";

const STORAGE_KEY = "pair-wise-yf-45/schedule-v1";
const DRAFT_KEY = "pair-wise-yf-45/offline-draft";

const talents: Talent[] = [
  { id: "t1", name: "林川", role: "男主" },
  { id: "t2", name: "周禾", role: "女主" },
  { id: "t3", name: "顾言", role: "配角" },
  { id: "t4", name: "孙宁", role: "群演领队" }
];

const locations: Location[] = [
  { id: "l1", name: "老码头" },
  { id: "l2", name: "玻璃厂房" },
  { id: "l3", name: "南站候车厅" }
];

const equipment: Equipment[] = [
  { id: "e1", name: "ARRI A机" },
  { id: "e2", name: "移动伸缩炮" },
  { id: "e3", name: "LED灯组" },
  { id: "e4", name: "跟拍车" }
];

const seedScenes: Scene[] = [
  { id: "s1", code: "A-012", title: "码头交接", day: "2026-10-08", start: "08:00", end: "11:30", talentIds: ["t1", "t3"], locationId: "l1", equipmentIds: ["e1", "e3"], status: "已确认", locked: false },
  { id: "s2", code: "A-013", title: "厂房追逐", day: "2026-10-08", start: "10:30", end: "13:00", talentIds: ["t1", "t2"], locationId: "l1", equipmentIds: ["e2", "e4"], status: "草稿", locked: false },
  { id: "s3", code: "B-021", title: "候车厅告别", day: "2026-10-09", start: "15:00", end: "18:30", talentIds: ["t2", "t3"], locationId: "l3", equipmentIds: ["e1"], status: "草稿", locked: false }
];

function readScenes(): Scene[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).scenes as Scene[] : structuredClone(seedScenes);
  } catch {
    return structuredClone(seedScenes);
  }
}

function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).history as HistoryEntry[] : [];
  } catch {
    return [];
  }
}

function readVersions(): Version[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).versions as Version[] : [];
  } catch {
    return [];
  }
}

function readExemptions(): Exemption[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw).exemptions as Exemption[]) ?? [] : [];
  } catch {
    return [];
  }
}

function readPendingExemption(): PendingExemption | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw).pendingExemption as PendingExemption | null) ?? null : null;
  } catch {
    return null;
  }
}

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

/** structuredClone 无法克隆 Vue 响应式代理，用 JSON 往返复制纯数据场次 */
function cloneScenes(scenes: Scene[]): Scene[] {
  return JSON.parse(JSON.stringify(scenes));
}

function overlaps(a: Scene, b: Scene) {
  return a.day === b.day && minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end);
}

function shared(a: string[], b: string[]) {
  return a.some((value) => b.includes(value));
}

/** 稳定冲突标识：场次对排序后拼接，避免拖拽改序导致标识漂移 */
function conflictKey(a: Scene, b: Scene, type: ConflictType) {
  return [a.id, b.id].sort().join(":") + ":" + type;
}

interface ComputedConflict {
  id: string;
  type: ConflictType;
  sceneIds: string[];
  message: string;
  severity: "高" | "中";
  basis: Record<string, SceneBasis>;
  sharedResource: string[];
}

export const useScheduleStore = defineStore("schedule", () => {
  const scenes = ref<Scene[]>(readScenes());
  const history = ref<HistoryEntry[]>(readHistory());
  const versions = ref<Version[]>(readVersions());
  const role = ref<Role>("制片");
  const exemptions = ref<Exemption[]>(readExemptions());
  const pendingExemption = ref<PendingExemption | null>(readPendingExemption());
  const online = ref(navigator.onLine);
  const draft = ref<OfflineDraft | null>(null);

  const talentNames = (ids: string[]) => ids.map((id) => talents.find((item) => item.id === id)?.name ?? id);
  const locationName = (id: string) => locations.find((item) => item.id === id)?.name ?? id;
  const equipmentNames = (ids: string[]) => ids.map((id) => equipment.find((item) => item.id === id)?.name ?? id);
  const sceneCodeOf = (id: string) => scenes.value.find((item) => item.id === id)?.code ?? id;

  function buildBasis(sceneIds: string[]): Record<string, SceneBasis> {
    const basis: Record<string, SceneBasis> = {};
    for (const id of sceneIds) {
      const scene = scenes.value.find((item) => item.id === id);
      if (scene) {
        basis[id] = {
          code: scene.code,
          day: scene.day,
          start: scene.start,
          end: scene.end,
          talentIds: [...scene.talentIds],
          locationId: scene.locationId,
          equipmentIds: [...scene.equipmentIds]
        };
      }
    }
    return basis;
  }

  /** 依据当前场次状态计算全部冲突（含依据快照） */
  function computeConflicts(): ComputedConflict[] {
    const result: ComputedConflict[] = [];
    for (let i = 0; i < scenes.value.length; i += 1) {
      for (let j = i + 1; j < scenes.value.length; j += 1) {
        const a = scenes.value[i];
        const b = scenes.value[j];
        if (!overlaps(a, b)) continue;
        const pairSceneIds = [a.id, b.id].sort();
        const basis = buildBasis(pairSceneIds);
        if (shared(a.talentIds, b.talentIds)) {
          const sharedIds = a.talentIds.filter((id) => b.talentIds.includes(id));
          result.push({
            id: conflictKey(a, b, "演员档期"),
            type: "演员档期",
            sceneIds: pairSceneIds,
            message: `${talentNames(sharedIds).join("、")} 在两场戏中档期重叠`,
            severity: "高",
            basis,
            sharedResource: sharedIds
          });
        }
        if (a.locationId === b.locationId) {
          result.push({
            id: conflictKey(a, b, "场地占用"),
            type: "场地占用",
            sceneIds: pairSceneIds,
            message: `${locationName(a.locationId)} 被同时占用`,
            severity: "高",
            basis,
            sharedResource: [a.locationId]
          });
        }
        if (shared(a.equipmentIds, b.equipmentIds)) {
          const sharedIds = a.equipmentIds.filter((id) => b.equipmentIds.includes(id));
          result.push({
            id: conflictKey(a, b, "器材借用"),
            type: "器材借用",
            sceneIds: pairSceneIds,
            message: `${equipmentNames(sharedIds).join("、")} 发生借用重叠`,
            severity: "中",
            basis,
            sharedResource: sharedIds
          });
        }
        if (a.locationId !== b.locationId && minutes(b.start) - minutes(a.end) < 30) {
          result.push({
            id: conflictKey(a, b, "转场时间"),
            type: "转场时间",
            sceneIds: pairSceneIds,
            message: "两个场地之间转场时间不足30分钟",
            severity: "中",
            basis,
            sharedResource: []
          });
        }
      }
    }
    return result;
  }

  /** 判断豁免依据是否仍与当前冲突一致（时段 + 参与资源） */
  function basisMatches(ex: Exemption, conflict: ComputedConflict): boolean {
    for (const sceneId of ex.sceneIds) {
      const basis = ex.basis[sceneId];
      const current = conflict.basis[sceneId];
      if (!basis || !current) return false;
      if (basis.day !== current.day || basis.start !== current.start || basis.end !== current.end) return false;
      if (ex.type === "场地占用" && basis.locationId !== current.locationId) return false;
    }
    if (ex.type === "演员档期" || ex.type === "器材借用" || ex.type === "场地占用") {
      const [idA, idB] = ex.sceneIds;
      const a = conflict.basis[idA];
      const b = conflict.basis[idB];
      if (!a || !b) return false;
      const currentShared = ex.type === "演员档期"
        ? a.talentIds.filter((id) => b.talentIds.includes(id))
        : ex.type === "器材借用"
          ? a.equipmentIds.filter((id) => b.equipmentIds.includes(id))
          : [a.locationId];
      if (currentShared.length !== ex.sharedResource.length) return false;
      if (!currentShared.every((id) => ex.sharedResource.includes(id))) return false;
    }
    return true;
  }

  /** 用人类可读的方式列出豁免依据相对当前状态的改动 */
  function describeChanges(ex: Exemption): string {
    const changes: string[] = [];
    for (const sceneId of ex.sceneIds) {
      const current = scenes.value.find((item) => item.id === sceneId);
      const basis = ex.basis[sceneId];
      const code = basis?.code ?? sceneCodeOf(sceneId);
      if (!current) {
        changes.push(`场次 ${code} 已被删除`);
        continue;
      }
      if (!basis) {
        changes.push(`场次 ${code} 缺少授予时快照`);
        continue;
      }
      if (current.day !== basis.day) changes.push(`${code} 拍摄日由 ${basis.day} 改为 ${current.day}`);
      if (current.start !== basis.start || current.end !== basis.end) changes.push(`${code} 时间由 ${basis.start}–${basis.end} 调整为 ${current.start}–${current.end}`);
      if (ex.type === "场地占用" && current.locationId !== basis.locationId) {
        changes.push(`${code} 场地由 ${locationName(basis.locationId)} 改为 ${locationName(current.locationId)}`);
      }
    }
    if (ex.type === "演员档期" || ex.type === "器材借用") {
      const [idA, idB] = ex.sceneIds;
      const a = scenes.value.find((item) => item.id === idA);
      const b = scenes.value.find((item) => item.id === idB);
      if (a && b) {
        const currentShared = ex.type === "演员档期"
          ? a.talentIds.filter((id) => b.talentIds.includes(id))
          : a.equipmentIds.filter((id) => b.equipmentIds.includes(id));
        const label = ex.type === "演员档期" ? "演员" : "器材";
        const nameOf = (id: string) => (ex.type === "演员档期" ? talentNames([id])[0] : equipmentNames([id])[0]);
        const removed = ex.sharedResource.filter((id) => !currentShared.includes(id)).map(nameOf);
        const added = currentShared.filter((id) => !ex.sharedResource.includes(id)).map(nameOf);
        if (removed.length || added.length) {
          changes.push(`${label}重叠变化：${removed.length ? `移除 ${removed.join("、")}` : ""}${removed.length && added.length ? "，" : ""}${added.length ? `新增 ${added.join("、")}` : ""}`);
        }
      }
    }
    return changes.join("；");
  }

  /** 已生效且依据仍匹配的豁免才压住对应冲突 */
  function isCovered(conflict: ComputedConflict): boolean {
    return exemptions.value.some((ex) => ex.status === "已生效" && ex.conflictId === conflict.id && basisMatches(ex, conflict));
  }

  const conflicts = computed<Conflict[]>(() => {
    const all = computeConflicts();
    return all
      .filter((item) => !isCovered(item))
      .map(({ id, type, sceneIds, message, severity }) => ({ id, type, sceneIds, message, severity }));
  });

  const sortedScenes = computed(() => [...scenes.value].sort((a, b) => `${a.day} ${a.start}`.localeCompare(`${b.day} ${b.start}`)));

  function log(action: string, detail: string) {
    history.value.unshift({ id: crypto.randomUUID(), action, detail, time: new Date().toISOString() });
    history.value = history.value.slice(0, 80);
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      scenes: scenes.value,
      history: history.value,
      versions: versions.value,
      exemptions: exemptions.value,
      pendingExemption: pendingExemption.value
    }));
  }

  watch([scenes, history, versions, exemptions, pendingExemption], persist, { deep: true });

  /** 场次变化后，把依据已失效的豁免标记为失效并记录原因 */
  function revalidateExemptions(silent = false) {
    const current = computeConflicts();
    for (const ex of exemptions.value) {
      if (ex.status !== "已生效") continue;
      const stillExists = current.find((item) => item.id === ex.conflictId);
      const reason = stillExists ? describeChanges(ex) : describeChanges(ex) || "冲突已不存在，自动失效";
      if (reason) {
        ex.status = "已失效";
        ex.invalidatedAt = new Date().toISOString();
        ex.invalidatedReason = reason;
        if (!silent) {
          log("豁免失效", `${ex.type}（${ex.sceneIds.map(sceneCodeOf).join(" ↔ ")}）：${reason}`);
        }
      }
    }
  }

  watch(scenes, () => revalidateExemptions(), { deep: true });

  function addScene(input: Omit<Scene, "id" | "status" | "locked">) {
    scenes.value.push({ ...input, id: crypto.randomUUID(), status: "草稿", locked: false });
    log("新增场次", `${input.code} ${input.title}`);
  }

  function updateStatus(id: string, status: SceneStatus) {
    const scene = scenes.value.find((item) => item.id === id);
    if (!scene || scene.locked) return;
    scene.status = status;
    log("流转状态", `${scene.code} → ${status}`);
  }

  function toggleLock(id: string) {
    const scene = scenes.value.find((item) => item.id === id);
    if (!scene) return;
    scene.locked = !scene.locked;
    log(scene.locked ? "锁定场次" : "解锁场次", scene.code);
  }

  function moveScene(from: number, to: number) {
    if (from === to || to < 0 || to >= scenes.value.length) return;
    const [item] = scenes.value.splice(from, 1);
    scenes.value.splice(to, 0, item);
    log("调整顺序", `${item.code} 移至第 ${to + 1} 位`);
  }

  function snapshot(name = `版本 ${versions.value.length + 1}`) {
    versions.value.unshift({ id: crypto.randomUUID(), name, time: new Date().toISOString(), scenes: cloneScenes(scenes.value) });
    versions.value = versions.value.slice(0, 12);
    log("保存版本", name);
  }

  function restore(id: string) {
    const version = versions.value.find((item) => item.id === id);
    if (!version) return;
    scenes.value = cloneScenes(version.scenes);
    // 恢复后旧版本豁免不得沿用到当前结果
    let count = 0;
    for (const ex of exemptions.value) {
      if (ex.status === "待会签" || ex.status === "已生效") {
        ex.status = "已失效";
        ex.invalidatedAt = new Date().toISOString();
        ex.invalidatedReason = `恢复版本「${version.name}」，旧版本豁免不再适用于当前结果`;
        count += 1;
      }
    }
    log("恢复版本", `${version.name}${count ? `，${count} 项旧豁免已失效` : ""}`);
  }

  function saveDraft() {
    draft.value = { scenes: cloneScenes(scenes.value), savedAt: new Date().toISOString() };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft.value));
    log("保存离线草稿", dayjs(draft.value.savedAt).format("MM-DD HH:mm"));
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      draft.value = raw ? JSON.parse(raw) as OfflineDraft : null;
    } catch {
      draft.value = null;
    }
  }

  function syncDraft() {
    if (!draft.value) return;
    scenes.value = cloneScenes(draft.value.scenes);
    log("同步离线草稿", `同步 ${draft.value.scenes.length} 个场次`);
    draft.value = null;
    localStorage.removeItem(DRAFT_KEY);
  }

  /** 申请豁免：生成有依据的放行记录，写入失败则保留待提交与原因 */
  function requestExemption(conflictId: string, reason: string): { ok: boolean; pending?: boolean; error?: string } {
    if (role.value === "场记") return { ok: false, error: "场记不能申请豁免" };
    const conflict = computeConflicts().find((item) => item.id === conflictId);
    if (!conflict) return { ok: false, error: "冲突不存在或已变化，请刷新后重试" };
    if (!reason.trim()) return { ok: false, error: "请填写豁免理由" };
    const existing = exemptions.value.find((item) => item.conflictId === conflictId && (item.status === "待会签" || item.status === "已生效"));
    if (existing) return { ok: false, error: "该冲突已有待签或已生效的豁免" };

    const data = {
      conflictId: conflict.id,
      type: conflict.type,
      sceneIds: conflict.sceneIds,
      basis: conflict.basis,
      sharedResource: conflict.sharedResource,
      reason: reason.trim()
    };

    if (!online.value) {
      pendingExemption.value = { ...data, failedAt: new Date().toISOString(), failReason: "离线模式：待恢复后提交" };
      log("豁免待提交", `${conflict.type}（${conflict.sceneIds.map(sceneCodeOf).join(" ↔ ")}）：离线，已保留申请与原因`);
      return { ok: true, pending: true };
    }

    try {
      const exemption: Exemption = {
        id: crypto.randomUUID(),
        ...data,
        status: "待会签",
        version: 0,
        countersigns: [],
        createdAt: new Date().toISOString()
      };
      exemptions.value.push(exemption);
      log("提交豁免申请", `${exemption.type}（${exemption.sceneIds.map(sceneCodeOf).join(" ↔ ")}）理由：${exemption.reason}`);
      return { ok: true };
    } catch {
      pendingExemption.value = { ...data, failedAt: new Date().toISOString(), failReason: "写入失败：已保留申请，恢复后续办" };
      return { ok: true, pending: true };
    }
  }

  /** 恢复后续办一次待提交豁免 */
  function retryPending() {
    const pending = pendingExemption.value;
    if (!pending) return;
    if (!online.value) {
      pending.failReason = "仍处于离线，无法提交";
      return;
    }
    const conflict = computeConflicts().find((item) => item.id === pending.conflictId);
    if (!conflict) {
      pendingExemption.value = null;
      log("豁免续办失败", "原冲突已不存在，申请作废");
      return;
    }
    const exemption: Exemption = {
      id: crypto.randomUUID(),
      conflictId: pending.conflictId,
      type: pending.type,
      sceneIds: pending.sceneIds,
      basis: conflict.basis,
      sharedResource: conflict.sharedResource,
      reason: pending.reason,
      status: "待会签",
      version: 0,
      countersigns: [],
      createdAt: new Date().toISOString()
    };
    exemptions.value.push(exemption);
    pendingExemption.value = null;
    log("豁免续办提交", `${exemption.type}（${exemption.sceneIds.map(sceneCodeOf).join(" ↔ ")}）`);
  }

  /** 制片/导演会签：乐观锁 + 同角色不可重复通过 */
  function countersign(exemptionId: string, expectedVersion: number) {
    const exemption = exemptions.value.find((item) => item.id === exemptionId);
    if (!exemption) throw new Error("豁免记录不存在");
    if (exemption.status !== "待会签") throw new Error("当前状态不可会签");
    if (role.value !== "制片" && role.value !== "导演") throw new Error("仅制片、导演可会签");
    if (exemption.version !== expectedVersion) throw new Error("会签状态已被他人更新，请刷新后重试");
    if (exemption.countersigns.some((item) => item.role === role.value)) throw new Error("您已会签，不能重复通过");
    exemption.countersigns.push({ role: role.value as CountersignRole, at: new Date().toISOString() });
    exemption.version += 1;
    const both = exemption.countersigns.some((item) => item.role === "制片") && exemption.countersigns.some((item) => item.role === "导演");
    if (both) {
      exemption.status = "已生效";
      log("豁免生效", `${exemption.type}（${exemption.sceneIds.map(sceneCodeOf).join(" ↔ ")}）理由：${exemption.reason}`);
    } else {
      log("会签", `${role.value} 会签 ${exemption.type} 豁免（${exemption.sceneIds.map(sceneCodeOf).join(" ↔ ")}）`);
    }
  }

  /** 撤销豁免：撤销后冲突立即重新出现 */
  function revokeExemption(exemptionId: string, reason: string) {
    const exemption = exemptions.value.find((item) => item.id === exemptionId);
    if (!exemption) throw new Error("豁免记录不存在");
    if (exemption.status !== "已生效" && exemption.status !== "待会签") throw new Error("当前状态不可撤销");
    exemption.status = "已撤销";
    exemption.revokedAt = new Date().toISOString();
    exemption.revokedReason = reason.trim() || "撤销豁免";
    log("撤销豁免", `${exemption.type}（${exemption.sceneIds.map(sceneCodeOf).join(" ↔ ")}）：${exemption.revokedReason}`);
  }

  function setOnline(value: boolean) {
    online.value = value;
    if (value && pendingExemption.value) retryPending();
  }

  // 初始化时静默同步一次豁免状态（持久化场景下的安全兜底）
  revalidateExemptions(true);

  return {
    scenes, sortedScenes, conflicts, history, versions, role, exemptions, pendingExemption, online, draft,
    talents, locations, equipment,
    talentNames, equipmentNames, locationName, sceneCodeOf,
    addScene, updateStatus, toggleLock, moveScene, snapshot, restore,
    saveDraft, loadDraft, syncDraft,
    requestExemption, retryPending, countersign, revokeExemption, setOnline
  };
});
