export type Role = "制片" | "导演" | "演员统筹" | "场记";
export type SceneStatus = "草稿" | "已确认" | "拍摄中" | "已完成";
export type ConflictType = "演员档期" | "场地占用" | "器材借用" | "转场时间";
export type ExemptionStatus = "待会签" | "已生效" | "已失效" | "已撤销";
export type CountersignRole = "制片" | "导演";

export interface Talent {
  id: string;
  name: string;
  role: string;
}

export interface Location {
  id: string;
  name: string;
}

export interface Equipment {
  id: string;
  name: string;
}

export interface Scene {
  id: string;
  code: string;
  title: string;
  day: string;
  start: string;
  end: string;
  talentIds: string[];
  locationId: string;
  equipmentIds: string[];
  status: SceneStatus;
  locked: boolean;
}

export interface Conflict {
  id: string;
  type: ConflictType;
  sceneIds: string[];
  message: string;
  severity: "高" | "中";
}

export interface HistoryEntry {
  id: string;
  action: string;
  detail: string;
  time: string;
}

export interface Version {
  id: string;
  name: string;
  time: string;
  scenes: Scene[];
}

export interface OfflineDraft {
  scenes: Scene[];
  savedAt: string;
}

/** 豁免依据：授予豁免时该冲突涉及场次的资源与时段快照 */
export interface SceneBasis {
  code: string;
  day: string;
  start: string;
  end: string;
  talentIds: string[];
  locationId: string;
  equipmentIds: string[];
}

export interface Countersign {
  role: CountersignRole;
  at: string;
}

/** 有依据的放行记录：一项只压住授予时确认的那条冲突 */
export interface Exemption {
  id: string;
  /** 稳定冲突标识：场次对（排序）+ 冲突类型 */
  conflictId: string;
  type: ConflictType;
  sceneIds: string[];
  /** 授予时各场次的资源/时段快照，键为场次 id */
  basis: Record<string, SceneBasis>;
  /** 授予时参与该冲突的共享资源（演员/场地/器材），转场为空 */
  sharedResource: string[];
  reason: string;
  status: ExemptionStatus;
  /** 乐观锁版本号：每次会签自增 */
  version: number;
  countersigns: Countersign[];
  createdAt: string;
  invalidatedAt?: string;
  /** 哪次改动让它失效 */
  invalidatedReason?: string;
  revokedAt?: string;
  revokedReason?: string;
}

/** 写入失败后保留的待提交豁免 */
export interface PendingExemption {
  conflictId: string;
  type: ConflictType;
  sceneIds: string[];
  basis: Record<string, SceneBasis>;
  sharedResource: string[];
  reason: string;
  failedAt: string;
  failReason: string;
}
