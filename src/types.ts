export type Role = "制片" | "导演" | "演员统筹" | "场记";
export type SceneStatus = "草稿" | "已确认" | "拍摄中" | "已完成";
export type ConflictType = "演员档期" | "场地占用" | "器材借用" | "转场时间";
export type ConflictKind = "talent" | "location" | "equipment" | "transfer";
export type SignRole = "制片" | "导演";
export type ExemptionStatus = "会签中" | "生效中" | "已失效" | "已撤销";

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

/** 豁免授予时锁定的“依据”：只覆盖这一项冲突当时参与的资源与时段 */
export interface ExemptionBasis {
  kind: ConflictKind;
  /** 按场次 id 排序的稳定配对键 */
  pairKey: string;
  sceneIds: [string, string];
  /** 参与该项冲突的资源 id（共用演员 / 场地 / 共用器材 / 转场两地） */
  resources: string[];
  /** 两个场次当时的拍摄日与时段，按场次 id 索引 */
  spans: Record<string, { day: string; start: string; end: string }>;
  /** 依据指纹：参与资源或时段一变，指纹即对不上 */
  fingerprint: string;
  /** 人读的依据摘要 */
  summary: string;
}

export interface Signoff {
  role: SignRole;
  at: string;
}

/** 上一轮豁免留在冲突旁边的痕迹（失效 / 撤销说明） */
export interface ConflictRecordTrace {
  status: Extract<ExemptionStatus, "已失效" | "已撤销">;
  at: string;
  changeText?: string;
  revokedBy?: SignRole;
  revokeReason?: string;
}

export interface Conflict {
  id: string;
  type: ConflictType;
  kind: ConflictKind;
  sceneIds: string[];
  message: string;
  severity: "高" | "中";
  /** 已有在途会签时的进度（仍计入待处理，未凑齐双签不放行） */
  pendingRecord?: {
    recordId: string;
    signoffs: Signoff[];
    reason: string;
  };
  /** 上一轮放行的结局，展示在冲突旁边 */
  lastRecord?: ConflictRecordTrace;
}

/** 有依据的放行记录：一项只压住当时确认的那一条冲突 */
export interface Exemption {
  id: string;
  conflictId: string;
  type: ConflictType;
  kind: ConflictKind;
  sceneIds: string[];
  /** 放行依据（为什么允许带着冲突开拍） */
  reason: string;
  status: ExemptionStatus;
  basis: ExemptionBasis;
  signoffs: Signoff[];
  createdAt: string;
  grantedAt?: string;
  invalidatedAt?: string;
  /** 是哪次改动让它失效 */
  invalidatedByChange?: string;
  revokedAt?: string;
  revokedBy?: SignRole;
  revokeReason?: string;
}

/** 写入失败后保留的待提交会签 */
export interface PendingSign {
  id: string;
  conflictId: string;
  type: ConflictType;
  kind: ConflictKind;
  sceneIds: string[];
  role: SignRole;
  /** 放行依据（首个会签人离线时一并保留） */
  reason: string;
  /** 写入失败原因 */
  failReason: string;
  at: string;
  /** 恢复后是否已续办过一次 */
  retried: boolean;
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
