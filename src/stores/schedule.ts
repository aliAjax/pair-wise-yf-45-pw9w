import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import dayjs from "dayjs";
import type {
  Conflict,
  ConflictKind,
  ConflictType,
  Equipment,
  Exemption,
  ExemptionBasis,
  HistoryEntry,
  Location,
  OfflineDraft,
  PendingSign,
  Role,
  Scene,
  SceneStatus,
  SignRole,
  Signoff,
  Talent,
  Version
} from "../types";

const STORAGE_KEY = "pair-wise-yf-45/schedule-v2";
const DRAFT_KEY = "pair-wise-yf-45/offline-draft";
const LEGACY_STORAGE_KEY = "pair-wise-yf-45/schedule-v1";

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
  { id: "s2", code: "A-013", title: "厂房追逐", day: "2026-10-08", start: "10:30", end: "13:00", talentIds: ["t1", "t2"], locationId: "l1", equipmentIds: ["e2", "e4", "e3"], status: "草稿", locked: false },
  { id: "s3", code: "B-021", title: "候车厅告别", day: "2026-10-09", start: "15:00", end: "18:30", talentIds: ["t2", "t3"], locationId: "l3", equipmentIds: ["e1"], status: "草稿", locked: false }
];

/* ------------------------------- 工具函数 ------------------------------- */

function readWorkspace(): { scenes: Scene[]; exemptions: Exemption[]; pendingSigns: PendingSign[]; history: HistoryEntry[]; versions: Version[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return {
        scenes: (data.scenes as Scene[]) ?? cloneDeep(seedScenes),
        exemptions: (data.exemptions as Exemption[]) ?? [],
        pendingSigns: (data.pendingSigns as PendingSign[]) ?? [],
        history: (data.history as HistoryEntry[]) ?? [],
        versions: (data.versions as Version[]) ?? []
      };
    }
    // 首启迁移：旧工作区只有场次 / 历史 / 版本，旧版字符串豁免一律不沿用
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const data = JSON.parse(legacy);
      return {
        scenes: (data.scenes as Scene[]) ?? cloneDeep(seedScenes),
        exemptions: [],
        pendingSigns: [],
        history: (data.history as HistoryEntry[]) ?? [],
        versions: (data.versions as Version[]) ?? []
      };
    }
  } catch {
    /* 落到初始数据 */
  }
  return { scenes: cloneDeep(seedScenes), exemptions: [], pendingSigns: [], history: [], versions: [] };
}

/** 深拷贝：兼容 Vue 响应式 Proxy（structuredClone 对 Proxy 会抛 DataCloneError） */
function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function overlaps(a: Scene, b: Scene) {
  return a.day === b.day && minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end);
}

function shared(a: string[], b: string[]) {
  return a.some((value) => b.includes(value));
}

const KIND_META: Record<ConflictKind, { type: ConflictType; suffix: string }> = {
  talent: { type: "演员档期", suffix: "talent" },
  location: { type: "场地占用", suffix: "location" },
  equipment: { type: "器材借用", suffix: "equipment" },
  transfer: { type: "转场时间", suffix: "transfer" }
};

/** 稳定配对键：场次 id 排序，不受列表顺序影响 */
function pairKey(aId: string, bId: string) {
  return [aId, bId].sort().join(":");
}

function conflictIdOf(pair: string, kind: ConflictKind) {
  return `${pair}:${KIND_META[kind].suffix}`;
}

export function parseConflictId(conflictId: string): { pairKey: string; kind: ConflictKind } {
  const index = conflictId.lastIndexOf(":");
  const suffix = conflictId.slice(index + 1) as ConflictKind;
  return { pairKey: conflictId.slice(0, index), kind: suffix in KIND_META ? suffix : "talent" };
}

/** 提取该项冲突在当前场次数据下的依据 */
function basisFor(conflictId: string, scenesById: Map<string, Scene>): ExemptionBasis | null {
  const { pairKey: pair, kind } = parseConflictId(conflictId);
  const [idA, idB] = pair.split(":");
  const a = scenesById.get(idA);
  const b = scenesById.get(idB);
  if (!a || !b) return null;

  const spans: Record<string, { day: string; start: string; end: string }> = {
    [a.id]: { day: a.day, start: a.start, end: a.end },
    [b.id]: { day: b.day, start: b.start, end: b.end }
  };

  let resources: string[];
  let summary: string;

  if (kind === "talent") {
    resources = a.talentIds.filter((id) => b.talentIds.includes(id)).sort();
    if (!resources.length) return null;
    const names = resources.map((id) => talents.find((t) => t.id === id)?.name ?? id).join("、");
    summary = `${names} 同时参演 ${a.code}/${b.code}（${a.day} ${a.start}-${a.end} / ${b.start}-${b.end}）`;
  } else if (kind === "location") {
    if (a.locationId !== b.locationId) return null;
    resources = [a.locationId];
    const name = locations.find((l) => l.id === a.locationId)?.name ?? a.locationId;
    summary = `${name} 被 ${a.code}/${b.code} 同时占用（${a.day} ${a.start}-${a.end} / ${b.start}-${b.end}）`;
  } else if (kind === "equipment") {
    resources = a.equipmentIds.filter((id) => b.equipmentIds.includes(id)).sort();
    if (!resources.length) return null;
    const names = resources.map((id) => equipment.find((e) => e.id === id)?.name ?? id).join("、");
    summary = `${names} 被 ${a.code}/${b.code} 同时借用（${a.day} ${a.start}-${a.end} / ${b.start}-${b.end}）`;
  } else {
    if (a.locationId === b.locationId || a.day !== b.day) return null;
    resources = [a.locationId, b.locationId].sort();
    const [first, second] = minutes(a.start) <= minutes(b.start) ? [a, b] : [b, a];
    if (minutes(second.start) - minutes(first.end) >= 30) return null;
    const na = locations.find((l) => l.id === a.locationId)?.name ?? a.locationId;
    const nb = locations.find((l) => l.id === b.locationId)?.name ?? b.locationId;
    summary = `${a.code}(${na})/${b.code}(${nb}) 同日转场不足30分钟（${a.start}-${a.end} → ${b.start}-${b.end}）`;
  }

  if (!overlaps(a, b) && kind !== "transfer") return null;

  return {
    kind,
    pairKey: pair,
    sceneIds: [a.id, b.id] as [string, string],
    resources,
    spans,
    fingerprint: JSON.stringify({ kind, resources, spans }),
    summary
  };
}

/** 依据在当前数据下是否仍成立（参与资源与时段均未变、冲突仍然存在） */
function basisStillValid(basis: ExemptionBasis, scenesById: Map<string, Scene>) {
  const current = basisFor(conflictIdOf(basis.pairKey, basis.kind), scenesById);
  return current !== null && current.fingerprint === basis.fingerprint;
}

export interface SignResult {
  ok: boolean;
  status: "granted" | "countersigned" | "duplicate" | "conflict-gone" | "stale" | "offline";
  message: string;
  pendingId?: string;
}

/* ------------------------------- Store ------------------------------- */

export const useScheduleStore = defineStore("schedule", () => {
  const initial = readWorkspace();
  const scenes = ref<Scene[]>(initial.scenes);
  const history = ref<HistoryEntry[]>(initial.history);
  const versions = ref<Version[]>(initial.versions);
  const exemptionRecords = ref<Exemption[]>(initial.exemptions);
  const pendingSigns = ref<PendingSign[]>(initial.pendingSigns);
  const role = ref<Role>("制片");
  const online = ref(navigator.onLine);
  /** 模拟远端写入通道故障（网络异常 / 存储不可写） */
  const storageHealthy = ref(true);
  const signingIds = ref<string[]>([]);
  const draft = ref<OfflineDraft | null>(null);

  const talentNames = (ids: string[]) => ids.map((id) => talents.find((item) => item.id === id)?.name ?? id);
  const locationName = (id: string) => locations.find((item) => item.id === id)?.name ?? id;
  const equipmentNames = (ids: string[]) => ids.map((id) => equipment.find((item) => item.id === id)?.name ?? id);

  function log(action: string, detail: string) {
    history.value.unshift({ id: crypto.randomUUID(), action, detail, time: new Date().toISOString() });
    history.value = history.value.slice(0, 120);
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      scenes: scenes.value,
      history: history.value,
      versions: versions.value,
      exemptions: exemptionRecords.value,
      pendingSigns: pendingSigns.value
    }));
  }

  watch([scenes, history, versions, exemptionRecords, pendingSigns], persist, { deep: true });

  /** 模拟远端放行记录写入：离线或通道故障时抛错，调用方必须保留待提交 */
  function remoteWrite(): Promise<void> {
    return new Promise((resolve, reject) => {
      window.setTimeout(() => {
        if (online.value && storageHealthy.value) resolve();
        else reject(new Error(!online.value ? "当前离线，会签未能写入" : "写入通道故障，会签未能写入"));
      }, 360);
    });
  }

  /* ------------- 依据失效重算：参与资源或时段变化后立即失效 ------------- */

  function revalidateExemptions(changeText: string, touchedSceneIds?: string[], force = false) {
    const byId = new Map(scenes.value.map((s) => [s.id, s]));
    for (const record of exemptionRecords.value) {
      if (record.status !== "生效中" && record.status !== "会签中") continue;
      if (touchedSceneIds && !record.sceneIds.some((id) => touchedSceneIds.includes(id))) continue;
      // force 用于版本恢复：旧版本的豁免一律不沿用到当前结果
      if (force || !basisStillValid(record.basis, byId)) {
        record.status = "已失效";
        record.invalidatedAt = new Date().toISOString();
        record.invalidatedByChange = changeText;
        log("豁免失效", `${record.type} · ${record.basis.summary}｜失效于：${changeText}`);
      }
    }
  }

  function describeSceneChange(before: Scene, after: Scene) {
    const parts: string[] = [];
    if (before.day !== after.day) parts.push(`拍摄日 ${before.day}→${after.day}`);
    if (before.start !== after.start) parts.push(`开始 ${before.start}→${after.start}`);
    if (before.end !== after.end) parts.push(`结束 ${before.end}→${after.end}`);
    if (before.locationId !== after.locationId) parts.push(`场地 ${locationName(before.locationId)}→${locationName(after.locationId)}`);
    const addedTalent = after.talentIds.filter((id) => !before.talentIds.includes(id));
    const removedTalent = before.talentIds.filter((id) => !after.talentIds.includes(id));
    if (addedTalent.length) parts.push(`加入演员 ${talentNames(addedTalent).join("、")}`);
    if (removedTalent.length) parts.push(`移除演员 ${talentNames(removedTalent).join("、")}`);
    const addedEquip = after.equipmentIds.filter((id) => !before.equipmentIds.includes(id));
    const removedEquip = before.equipmentIds.filter((id) => !after.equipmentIds.includes(id));
    if (addedEquip.length) parts.push(`加入器材 ${equipmentNames(addedEquip).join("、")}`);
    if (removedEquip.length) parts.push(`移除器材 ${equipmentNames(removedEquip).join("、")}`);
    return `场次 ${after.code} 改动：${parts.join("，") || "内容调整"}`;
  }

  /* ------------------------------- 冲突计算 ------------------------------- */

  const conflicts = computed<Conflict[]>(() => {
    const byId = new Map(scenes.value.map((s) => [s.id, s]));
    const liveByConflict = new Map<string, Exemption[]>();
    for (const record of exemptionRecords.value) {
      const list = liveByConflict.get(record.conflictId) ?? [];
      list.push(record);
      liveByConflict.set(record.conflictId, list);
    }

    const traceFor = (conflictId: string): Conflict["lastRecord"] => {
      const list = liveByConflict.get(conflictId);
      if (!list) return undefined;
      const latest = [...list].sort((x, y) => {
        const tx = x.invalidatedAt ?? x.revokedAt ?? "";
        const ty = y.invalidatedAt ?? y.revokedAt ?? "";
        return ty.localeCompare(tx);
      })[0];
      if (!latest || (latest.status !== "已失效" && latest.status !== "已撤销")) return undefined;
      return latest.status === "已失效"
        ? { status: "已失效", at: latest.invalidatedAt!, changeText: latest.invalidatedByChange }
        : { status: "已撤销", at: latest.revokedAt!, revokedBy: latest.revokedBy, revokeReason: latest.revokeReason };
    };

    const result: Conflict[] = [];
    for (let i = 0; i < scenes.value.length; i += 1) {
      for (let j = i + 1; j < scenes.value.length; j += 1) {
        const a = scenes.value[i];
        const b = scenes.value[j];
        const pair = pairKey(a.id, b.id);

        const pushIfOpen = (kind: ConflictKind, message: string, severity: "高" | "中") => {
          const id = conflictIdOf(pair, kind);
          // 只有“依据仍成立 + 双签生效中”的放行才压住这一项
          const live = (liveByConflict.get(id) ?? []).find(
            (r) => r.status === "生效中" && basisStillValid(r.basis, byId)
          );
          if (live) return;

          const inProgress = (liveByConflict.get(id) ?? [])
            .filter((r) => r.status === "会签中")
            .sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];

          result.push({
            id,
            type: KIND_META[kind].type,
            kind,
            sceneIds: [a.id, b.id],
            message,
            severity,
            pendingRecord: inProgress
              ? { recordId: inProgress.id, signoffs: cloneDeep(inProgress.signoffs), reason: inProgress.reason }
              : undefined,
            lastRecord: traceFor(id)
          });
        };

        if (overlaps(a, b)) {
          if (shared(a.talentIds, b.talentIds)) {
            pushIfOpen("talent", `${talentNames(a.talentIds.filter((item) => b.talentIds.includes(item))).join("、")} 在两场戏中档期重叠`, "高");
          }
          if (a.locationId === b.locationId) {
            pushIfOpen("location", `${locationName(a.locationId)} 被同时占用`, "高");
          }
          if (shared(a.equipmentIds, b.equipmentIds)) {
            pushIfOpen("equipment", `${equipmentNames(a.equipmentIds.filter((item) => b.equipmentIds.includes(item))).join("、")} 发生借用重叠`, "中");
          }
        }
        if (a.day === b.day && a.locationId !== b.locationId) {
          const [first, second] = minutes(a.start) <= minutes(b.start) ? [a, b] : [b, a];
          if (minutes(second.start) - minutes(first.end) < 30) {
            pushIfOpen("transfer", "两个场地之间转场时间不足30分钟", "中");
          }
        }
      }
    }
    return result;
  });

  const sortedScenes = computed(() => [...scenes.value].sort((a, b) => `${a.day} ${a.start}`.localeCompare(`${b.day} ${b.start}`)));

  const activeExemptions = computed(() => exemptionRecords.value.filter((r) => r.status === "生效中" || r.status === "会签中"));

  /* ------------------------------- 场次操作 ------------------------------- */

  function addScene(input: Omit<Scene, "id" | "status" | "locked">) {
    scenes.value.push({ ...input, id: crypto.randomUUID(), status: "草稿", locked: false });
    log("新增场次", `${input.code} ${input.title}`);
  }

  function updateScene(id: string, patch: Partial<Omit<Scene, "id">>) {
    const index = scenes.value.findIndex((item) => item.id === id);
    if (index < 0) return;
    const before = scenes.value[index];
    if (before.locked) return;
    const after: Scene = { ...before, ...patch };
    scenes.value.splice(index, 1, after);
    const changeText = describeSceneChange(before, after);
    log("编辑场次", changeText);
    // 参与资源或时段一变：相关豁免依据立即失效并重算
    revalidateExemptions(changeText, [id]);
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

  /* ------------------------------- 版本与草稿 ------------------------------- */

  function snapshot(name = `版本 ${versions.value.length + 1}`) {
    versions.value.unshift({ id: crypto.randomUUID(), name, time: new Date().toISOString(), scenes: cloneDeep(scenes.value) });
    versions.value = versions.value.slice(0, 12);
    log("保存版本", name);
  }

  function restore(id: string) {
    const version = versions.value.find((item) => item.id === id);
    if (!version) return;
    scenes.value = cloneDeep(version.scenes);
    log("恢复版本", version.name);
    // 旧版本的豁免不得沿用到当前结果：全部按“版本快照恢复”作失效留痕
    revalidateExemptions(`版本快照恢复（${version.name}），旧版豁免不再沿用`, undefined, true);
  }

  function saveDraft() {
    draft.value = { scenes: cloneDeep(scenes.value), savedAt: new Date().toISOString() };
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
    scenes.value = cloneDeep(draft.value.scenes);
    log("同步离线草稿", `同步 ${draft.value.scenes.length} 个场次`);
    // 草稿整体覆盖当前通告后，既有放行一律重算、不沿用
    revalidateExemptions("离线草稿同步到正式通告，旧放行依据重算", undefined, true);
    draft.value = null;
    localStorage.removeItem(DRAFT_KEY);
  }

  /* ------------------------------- 会签放行 ------------------------------- */

  // 同一会签入口串行化：两人几乎同时提交时，后到者一定读到最新状态，不能重复通过
  let signQueue: Promise<unknown> = Promise.resolve();

  function findConflictContext(conflictId: string): { a: Scene; b: Scene; kind: ConflictKind } | null {
    const { pairKey: pair, kind } = parseConflictId(conflictId);
    const [idA, idB] = pair.split(":");
    const a = scenes.value.find((s) => s.id === idA);
    const b = scenes.value.find((s) => s.id === idB);
    return a && b ? { a, b, kind } : null;
  }

  function enqueue(task: () => Promise<SignResult>): Promise<SignResult> {
    const run = signQueue.then(() => task());
    // 队列链不因单次失败而中断；对外返回本次任务自己的结果
    signQueue = run.catch(() => undefined);
    return run;
  }

  /** 写入返回后立即重读存储：另一标签页可能在写入窗口内刚提交过，杜绝后写覆盖与重复通过 */
  function syncFreshState(): { records: Exemption[]; pendings: PendingSign[] } {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.exemptions)) exemptionRecords.value = data.exemptions as Exemption[];
        if (Array.isArray(data.pendingSigns)) pendingSigns.value = data.pendingSigns as PendingSign[];
        if (Array.isArray(data.history)) history.value = data.history as HistoryEntry[];
      }
    } catch {
      /* 存储不可读时沿用内存状态 */
    }
    return { records: exemptionRecords.value, pendings: pendingSigns.value };
  }

  function keepPending(conflictId: string, type: ConflictType, kind: ConflictKind, sceneIds: string[], signer: SignRole, reason: string, failReason: string): PendingSign {
    const existing = pendingSigns.value.find((p) => p.conflictId === conflictId && p.role === signer);
    if (existing) {
      existing.reason = reason;
      existing.failReason = failReason;
      existing.at = new Date().toISOString();
      existing.retried = false;
      return existing;
    }
    const pending: PendingSign = {
      id: crypto.randomUUID(),
      conflictId,
      type,
      kind,
      sceneIds: [...sceneIds],
      role: signer,
      reason,
      failReason,
      at: new Date().toISOString(),
      retried: false
    };
    pendingSigns.value.push(pending);
    return pending;
  }

  /**
   * 提交一次会签。
   * 制片、导演分别签署；同一角色再签属于重复通过，直接拒绝。
   * 写入在最后一步：只有远端写入成功才落地；失败则保留待提交豁免和原因。
   */
  function signConflict(conflictId: string, signer: SignRole, reasonInput: string): Promise<SignResult> {
    // signingIds 只作 UI busy 标记；真正的重复防护在串行队列内按最新状态判定
    signingIds.value.push(conflictId);
    return enqueue(async () => {
      try {
        const context = findConflictContext(conflictId);
        if (!context) return { ok: false, status: "conflict-gone", message: "两个场次已不构成配对，无法会签" };

        const activeRecord = exemptionRecords.value
          .filter((r) => r.conflictId === conflictId && (r.status === "会签中" || r.status === "生效中"))
          .sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];

        if (activeRecord?.signoffs.some((s) => s.role === signer)) {
          // 后到者看到最新状态：同一角色不能重复通过
          return {
            ok: false,
            status: "duplicate",
            message: activeRecord.status === "生效中"
              ? `${signer}已会签，双签已完成并生效，无需重复通过`
              : `${signer}已会签（${activeRecord.signoffs.map((s) => s.role).join("、")}），等待另一方签署`
          };
        }

        const trimmed = reasonInput.trim();
        // 第二位会签人可沿用首位已写明的放行依据；首签必须写明
        if (!trimmed && !activeRecord?.reason) {
          return { ok: false, status: "stale", message: "请填写放行依据后再提交会签" };
        }
        const finalReason = trimmed || activeRecord.reason;

        const byId = new Map(scenes.value.map((s) => [s.id, s]));
        const basis = basisFor(conflictId, byId);
        if (!basis) return { ok: false, status: "conflict-gone", message: "该冲突当前已不存在，无法会签" };

        if (activeRecord && activeRecord.basis.fingerprint !== basis.fingerprint) {
          // 在途会签期间依据已变，先把旧在途记录作失效留痕，再要求重新发起
          activeRecord.status = "已失效";
          activeRecord.invalidatedAt = new Date().toISOString();
          activeRecord.invalidatedByChange = "会签提交期间参与资源或时段已变化";
          log("豁免失效", `${activeRecord.type}｜失效于：会签提交期间参与资源或时段已变化`);
          return { ok: false, status: "stale", message: "会签期间冲突依据已变化，请按最新冲突重新发起会签" };
        }

        // 最后一步才写入；写入前不改本地记录
        try {
          await remoteWrite();
        } catch (error) {
          const failReason = error instanceof Error ? error.message : String(error);
          const pending = keepPending(conflictId, KIND_META[basis.kind].type, basis.kind, basis.sceneIds, signer, finalReason, failReason);
          log("会签待提交", `${KIND_META[basis.kind].type} · ${basis.summary}｜${signer}签署保留待提交：${failReason}`);
          return { ok: false, status: "offline", message: `${failReason}，已保留待提交豁免与原因，恢复后续办`, pendingId: pending.id };
        }

        const now = new Date().toISOString();
        const signoff: Signoff = { role: signer, at: now };

        // 写入返回后重读最新记录：后到者不能重复通过，也不能覆盖刚落地的另一签
        const { records: freshRecords } = syncFreshState();
        const freshActive = freshRecords
          .filter((r) => r.conflictId === conflictId && (r.status === "会签中" || r.status === "生效中"))
          .sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];

        if (freshActive?.signoffs.some((s) => s.role === signer)) {
          return { ok: false, status: "duplicate", message: `${signer}的会签刚刚已在另一端完成，不能重复通过` };
        }

        if (freshActive) {
          freshActive.signoffs.push(signoff);
          if (finalReason && freshActive.reason !== finalReason) freshActive.reason = `${freshActive.reason}；${finalReason}`;
          if (freshActive.signoffs.length >= 2) {
            freshActive.status = "生效中";
            freshActive.grantedAt = now;
            log("授予豁免", `${freshActive.type} · ${basis.summary}｜双签完成（${freshActive.signoffs.map((s) => s.role).join("、")}）`);
            return { ok: true, status: "granted", message: `${signer}会签成功，制片与导演双签完成，该冲突已放行` };
          }
          log("会签通过", `${freshActive.type} · ${basis.summary}｜${signer}已签，等待另一方`);
          return { ok: true, status: "countersigned", message: `${signer}会签成功，等待另一方会签` };
        }

        const record: Exemption = {
          id: crypto.randomUUID(),
          conflictId,
          type: KIND_META[basis.kind].type,
          kind: basis.kind,
          sceneIds: cloneDeep(basis.sceneIds),
          reason: finalReason,
          status: "会签中",
          basis,
          signoffs: [signoff],
          createdAt: now
        };
        exemptionRecords.value.push(record);
        log("会签通过", `${record.type} · ${basis.summary}｜${signer}首签（依据：${finalReason}），等待另一方`);
        return { ok: true, status: "countersigned", message: `${signer}会签成功，等待另一方会签` };
      } finally {
        const idx = signingIds.value.indexOf(conflictId);
        if (idx >= 0) signingIds.value.splice(idx, 1);
      }
    });
  }

  /** 恢复后续办一次：重新读取最新状态，不允许重复通过；失败不再自动续办 */
  async function retryPending(pendingId: string): Promise<SignResult> {
    const pending = pendingSigns.value.find((p) => p.id === pendingId);
    if (!pending) return { ok: false, status: "conflict-gone", message: "待提交记录不存在" };
    if (pending.retried) return { ok: false, status: "duplicate", message: "该待提交豁免已续办过一次，如需再次提交请重新发起会签" };

    if (!online.value) {
      // 仍离线不算“已续办”，不消耗唯一一次续办机会
      return { ok: false, status: "offline", message: "仍处于离线状态，待提交豁免将在恢复后续办" };
    }

    pending.retried = true;
    const signer = pending.role;
    const drop = (result: SignResult) => {
      pendingSigns.value = pendingSigns.value.filter((p) => p.id !== pending.id);
      return result;
    };

    const context = findConflictContext(pending.conflictId);
    if (!context) return drop({ ok: false, status: "conflict-gone", message: "续办时场次配对已不存在，待提交豁免关闭" });

    const byId = new Map(scenes.value.map((s) => [s.id, s]));
    const basis = basisFor(pending.conflictId, byId);
    // 冲突消失（资源被移除 / 时段不再重叠）本身就是依据变化
    if (!basis) return drop({ ok: false, status: "stale", message: "续办时该冲突已消失或依据已变化，待提交关闭，请按最新冲突重新发起会签" });

    const activeRecord = exemptionRecords.value
      .filter((r) => r.conflictId === pending.conflictId && (r.status === "会签中" || r.status === "生效中"))
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];

    if (activeRecord?.signoffs.some((s) => s.role === signer)) {
      // 别的通道（如另一个标签页）已经签过：不能重复通过，待提交关闭
      return drop({ ok: false, status: "duplicate", message: `${signer}已在最新状态中完成会签，不能重复通过，待提交已关闭` });
    }
    if (activeRecord && activeRecord.basis.fingerprint !== basis.fingerprint) {
      return drop({ ok: false, status: "stale", message: "续办时冲突依据已变化，请按最新冲突重新发起会签" });
    }

    try {
      await remoteWrite();
    } catch (error) {
      const failReason = error instanceof Error ? error.message : String(error);
      pending.failReason = failReason;
      // 已消耗唯一一次续办，保留待提交供查看，但不再自动重试
      log("会签续办失败", `${pending.type} · ${basis.summary}｜${signer}：${failReason}`);
      return { ok: false, status: "offline", message: `续办仍失败（${failReason}），待提交豁免已保留，请重新发起` };
    }

    const now = new Date().toISOString();
    const signoff: Signoff = { role: signer, at: now };
    const { records: freshRecords } = syncFreshState();
    const freshActive = freshRecords
      .filter((r) => r.conflictId === pending.conflictId && (r.status === "会签中" || r.status === "生效中"))
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];

    if (freshActive?.signoffs.some((s) => s.role === signer)) {
      return drop({ ok: false, status: "duplicate", message: `${signer}已在最新状态中完成会签，不能重复通过，待提交已关闭` });
    }

    if (freshActive) {
      freshActive.signoffs.push(signoff);
      if (freshActive.signoffs.length >= 2) {
        freshActive.status = "生效中";
        freshActive.grantedAt = now;
        log("授予豁免", `${freshActive.type} · ${basis.summary}｜离线续办双签完成（${freshActive.signoffs.map((s) => s.role).join("、")}）`);
      } else {
        log("会签通过", `${freshActive.type} · ${basis.summary}｜${signer}离线续办签署`);
      }
    } else {
      exemptionRecords.value.push({
        id: crypto.randomUUID(),
        conflictId: pending.conflictId,
        type: pending.type,
        kind: pending.kind,
        sceneIds: cloneDeep(pending.sceneIds),
        reason: pending.reason,
        status: "会签中",
        basis,
        signoffs: [signoff],
        createdAt: now
      });
      log("会签通过", `${pending.type} · ${basis.summary}｜${signer}离线续办首签`);
    }
    pendingSigns.value = pendingSigns.value.filter((p) => p.id !== pending.id);
    log("会签续办", `${pending.type} · ${basis.summary}｜${signer}的待提交会签已写入`);
    return { ok: true, status: "granted", message: "恢复后续办成功，会签已写入最新状态" };
  }

  async function retryAllPending(): Promise<SignResult[]> {
    const ids = pendingSigns.value.filter((p) => !p.retried).map((p) => p.id);
    const results: SignResult[] = [];
    for (const id of ids) results.push(await retryPending(id));
    return results;
  }

  function discardPending(id: string) {
    const pending = pendingSigns.value.find((p) => p.id === id);
    if (!pending) return;
    log("撤销待提交", `${pending.type}｜${pending.role}的待提交会签已放弃（${pending.failReason}）`);
    pendingSigns.value = pendingSigns.value.filter((p) => p.id !== id);
  }

  /** 撤销已生效的放行：记录留痕，冲突立即重新出现 */
  function revokeExemption(recordId: string, by: SignRole, reasonInput: string) {
    const record = exemptionRecords.value.find((r) => r.id === recordId);
    if (!record || (record.status !== "生效中" && record.status !== "会签中")) return;
    const reason = reasonInput.trim() || "未填写原因";
    record.status = "已撤销";
    record.revokedAt = new Date().toISOString();
    record.revokedBy = by;
    record.revokeReason = reason;
    log("撤销豁免", `${record.type} · ${record.basis.summary}｜${by}撤销：${reason}`);
  }

  /* ------------------------------- 网络 / 多标签页 ------------------------------- */

  function setOnline(value: boolean) {
    online.value = value;
    if (value) {
      // 恢复后自动续办一次
      void retryAllPending();
    }
  }

  function setStorageHealthy(value: boolean) {
    storageHealthy.value = value;
  }

  function handleStorageEvent(event: StorageEvent) {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const data = JSON.parse(event.newValue);
      exemptionRecords.value = (data.exemptions as Exemption[]) ?? [];
      pendingSigns.value = (data.pendingSigns as PendingSign[]) ?? [];
      history.value = (data.history as HistoryEntry[]) ?? history.value;
      // 另一个标签页改动场次后，本页依据同样立即重算
      if (data.scenes) scenes.value = data.scenes as Scene[];
    } catch {
      /* 忽略损坏的存储内容 */
    }
  }

  if (typeof window !== "undefined") {
    // 启动时先做一次依据对账：旧数据 / 手工改过场次的情况下立刻失效
    revalidateExemptions("启动对账：依据与当前场次不一致");
    window.addEventListener("storage", handleStorageEvent);
  }

  return {
    scenes,
    sortedScenes,
    conflicts,
    history,
    versions,
    role,
    online,
    storageHealthy,
    signingIds,
    draft,
    exemptionRecords,
    pendingSigns,
    activeExemptions,
    talents,
    locations,
    equipment,
    talentNames,
    equipmentNames,
    locationName,
    addScene,
    updateScene,
    updateStatus,
    toggleLock,
    moveScene,
    snapshot,
    restore,
    saveDraft,
    loadDraft,
    syncDraft,
    signConflict,
    retryPending,
    retryAllPending,
    discardPending,
    revokeExemption,
    setOnline,
    setStorageHealthy
  };
});
