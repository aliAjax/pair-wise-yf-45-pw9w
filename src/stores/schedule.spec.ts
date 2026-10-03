// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { useScheduleStore } from "../stores/schedule";

async function flush() {
  await vi.advanceTimersByTimeAsync(500);
  await nextTick();
}

beforeEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  setActivePinia(createPinia());
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

function find(store: ReturnType<typeof useScheduleStore>, kind: "talent" | "location" | "equipment" | "transfer") {
  return store.conflicts.find((c) => c.kind === kind)!;
}

describe("有依据的放行记录", () => {
  it("一项豁免只压住那一条冲突：只豁免演员冲突，场地/器材冲突仍在", async () => {
    const store = useScheduleStore();
    const before = store.conflicts.map((c) => c.kind).sort();
    expect(before).toContain("talent");
    expect(before).toContain("location");
    expect(before).toContain("equipment");

    const talent = find(store, "talent");
    expect(await store.signConflict(talent.id, "制片", "林川赶场已协调")).toMatchObject({ ok: true, status: "countersigned" });
    expect(await store.signConflict(talent.id, "导演", "同意")).toMatchObject({ ok: true, status: "granted" });

    const kinds = store.conflicts.map((c) => c.kind);
    expect(kinds).not.toContain("talent");
    expect(kinds).toContain("location");
    expect(kinds).toContain("equipment");

    const record = store.exemptionRecords.find((r) => r.conflictId === talent.id)!;
    expect(record.status).toBe("生效中");
    expect(record.basis.resources).toEqual(["t1"]);
    expect(record.signoffs.map((s) => s.role)).toEqual(["制片", "导演"]);
  });

  it("参与资源或时段变化后立即失效并重算，并记录是哪次改动", async () => {
    const store = useScheduleStore();
    const talent = find(store, "talent");
    await store.signConflict(talent.id, "制片", "协调通过");
    await store.signConflict(talent.id, "导演", "同意");
    expect(store.conflicts.some((c) => c.id === talent.id)).toBe(false);

    // 改场次 s2 的时间：s1/s2 不再重叠
    const s2 = store.scenes.find((s) => s.id === "s2")!;
    store.updateScene("s2", { start: "14:00", end: "16:00" });

    const record = store.exemptionRecords.find((r) => r.conflictId === talent.id)!;
    expect(record.status).toBe("已失效");
    expect(record.invalidatedByChange).toContain("开始 10:30→14:00");

    // 改参与资源（场地）让场地豁免失效
    const location = store.conflicts.find((c) => c.kind === "location");
    // 时间改完后场地冲突已消失；改回重叠，再授予场地豁免
    store.updateScene("s2", { start: "10:30", end: "13:00" });
    const locationConflict = store.conflicts.find((c) => c.kind === "location")!;
    await store.signConflict(locationConflict.id, "制片", "加棚");
    await store.signConflict(locationConflict.id, "导演", "同意");
    store.updateScene("s2", { locationId: "l2" });
    const locRecord = store.exemptionRecords.find((r) => r.conflictId === locationConflict.id && r.status === "已失效")!;
    expect(locRecord.invalidatedByChange).toContain("场地 老码头→玻璃厂房");
    void s2;
  });

  it("冲突重新出现时，旁边展示是哪次改动让旧豁免失效", async () => {
    const store = useScheduleStore();
    const equipment = find(store, "equipment");
    await store.signConflict(equipment.id, "制片", "器材已加借");
    await store.signConflict(equipment.id, "导演", "同意");
    // 移除共用的 LED灯组(e3) -> 冲突消失、豁免失效；再加回来 -> 冲突重现并带失效说明
    store.updateScene("s2", { equipmentIds: ["e2", "e4"] });
    store.updateScene("s2", { equipmentIds: ["e2", "e4", "e3"] });

    const again = store.conflicts.find((c) => c.id === equipment.id)!;
    expect(again.lastRecord?.status).toBe("已失效");
    expect(again.lastRecord?.changeText).toContain("器材");
  });

  it("制片和导演分别会签；同一角色重复提交被拒绝；双签未齐不放行", async () => {
    const store = useScheduleStore();
    const talent = find(store, "talent");

    expect(await store.signConflict(talent.id, "制片", "依据A")).toMatchObject({ status: "countersigned" });
    // 制片再签：后到者看到最新状态，不能重复通过
    expect(await store.signConflict(talent.id, "制片", "依据A")).toMatchObject({ ok: false, status: "duplicate" });
    // 仍计入待处理
    expect(store.conflicts.some((c) => c.id === talent.id)).toBe(true);

    // 无依据不能签
    const location = find(store, "location");
    expect(await store.signConflict(location.id, "导演", "   ")).toMatchObject({ ok: false, status: "stale" });

    expect(await store.signConflict(talent.id, "导演", "")).toMatchObject({ status: "granted" });
    expect(store.conflicts.some((c) => c.id === talent.id)).toBe(false);
  });

  it("两人同时提交同一项：串行化后不会重复通过，且两人签名都保留", async () => {
    const store = useScheduleStore();
    const talent = find(store, "talent");
    const [r1, r2] = await Promise.all([
      store.signConflict(talent.id, "制片", "并发提交-制片"),
      store.signConflict(talent.id, "导演", "并发提交-导演")
    ]);
    expect([r1.status, r2.status].sort()).toEqual(["countersigned", "granted"]);
    const record = store.exemptionRecords.find((r) => r.conflictId === talent.id && r.status === "生效中")!;
    expect(record.signoffs.map((s) => s.role).sort()).toEqual(["制片", "导演"]);
  });

  it("写入失败保留待提交豁免和原因，恢复后续办一次；重复续办不允许", async () => {
    const store = useScheduleStore();
    store.setOnline(false);
    const talent = find(store, "talent");
    const failed = await store.signConflict(talent.id, "制片", "离线也要签的依据");
    expect(failed).toMatchObject({ ok: false, status: "offline" });
    expect(store.pendingSigns).toHaveLength(1);
    expect(store.pendingSigns[0].reason).toBe("离线也要签的依据");
    expect(store.pendingSigns[0].failReason).toContain("离线");
    // 失败时记录未落地
    expect(store.exemptionRecords.filter((r) => r.conflictId === talent.id)).toHaveLength(0);

    // 仍离线时续办：不消耗唯一一次机会
    const whileOffline = await store.retryPending(store.pendingSigns[0].id);
    expect(whileOffline.status).toBe("offline");
    expect(store.pendingSigns[0].retried).toBe(false);

    // 恢复在线后自动/手动续办一次 -> 成功，作为首签落地
    store.setOnline(true);
    // setOnline(true) 触发自动续办（模拟写入约 360ms）
    await vi.waitFor(() => expect(store.pendingSigns).toHaveLength(0), { timeout: 2000 });

    // 通道故障场景：在线但写入失败，手动续办仅一次
    const location = find(store, "location");
    store.setStorageHealthy(false);
    await store.signConflict(location.id, "导演", "故障期间签导演");
    expect(store.pendingSigns).toHaveLength(1);
    store.setStorageHealthy(true);
    const retried = await store.retryPending(store.pendingSigns[0].id);
    expect(retried.ok).toBe(true);
    expect(store.pendingSigns).toHaveLength(0);

    // 续办后该角色已签，不能重复通过
    expect(await store.signConflict(location.id, "导演", "再签一次")).toMatchObject({ status: "duplicate" });
  });

  it("续办时发现依据已变化，待提交关闭并要求按新冲突重办", async () => {
    const store = useScheduleStore();
    store.setStorageHealthy(false);
    const talent = find(store, "talent");
    await store.signConflict(talent.id, "制片", "依据");
    expect(store.pendingSigns).toHaveLength(1);

    // 恢复前改了 s2 的时段
    store.updateScene("s2", { start: "14:00", end: "16:00" });
    store.setStorageHealthy(true);
    const result = await store.retryPending(store.pendingSigns[0].id);
    expect(result.status).toBe("stale");
    expect(store.pendingSigns).toHaveLength(0);
  });

  it("版本快照恢复后旧豁免不沿用，但历史可查授予与失效", async () => {
    const store = useScheduleStore();
    const talent = find(store, "talent");
    await store.signConflict(talent.id, "制片", "v1依据");
    await store.signConflict(talent.id, "导演", "同意");
    store.snapshot("双签后的版本");
    expect(store.conflicts.some((c) => c.id === talent.id)).toBe(false);

    // 改数据制造差异后再恢复旧版本
    store.updateScene("s3", { title: "候车厅告别（改）" });
    store.restore(store.versions[0].id);

    const record = store.exemptionRecords.find((r) => r.conflictId === talent.id)!;
    expect(record.status).toBe("已失效");
    expect(record.invalidatedByChange).toContain("版本快照恢复");
    // 旧豁免不压当前结果：冲突重新出现
    expect(store.conflicts.some((c) => c.id === talent.id)).toBe(true);

    const actions = store.history.map((h) => h.action);
    expect(actions).toContain("授予豁免");
    expect(actions).toContain("豁免失效");
  });

  it("撤销后冲突立即重现，撤销人、原因和时间可查", async () => {
    const store = useScheduleStore();
    const talent = find(store, "talent");
    await store.signConflict(talent.id, "制片", "临时放行");
    await store.signConflict(talent.id, "导演", "同意");
    const recordId = store.exemptionRecords.find((r) => r.conflictId === talent.id)!.id;
    store.revokeExemption(recordId, "制片", "协调到替代演员");

    expect(store.conflicts.some((c) => c.id === talent.id)).toBe(true);
    const record = store.exemptionRecords.find((r) => r.id === recordId)!;
    expect(record.status).toBe("已撤销");
    expect(record.revokedBy).toBe("制片");
    expect(record.revokeReason).toBe("协调到替代演员");
    const shown = store.conflicts.find((c) => c.id === talent.id)!.lastRecord!;
    expect(shown.status).toBe("已撤销");
    expect(shown.revokedBy).toBe("制片");
  });

  it("重新加载工作区后仍会做依据对账：手工改过的数据让豁免失效", async () => {
    const store = useScheduleStore();
    const location = find(store, "location");
    await store.signConflict(location.id, "制片", "外部改动对账测试");
    await store.signConflict(location.id, "导演", "同意");
    await nextTick();

    const raw = JSON.parse(localStorage.getItem("pair-wise-yf-45/schedule-v2")!);
    expect(raw).toBeTruthy();
    const record = raw.exemptions.find((r: any) => r.conflictId === location.id);
    expect(record.status).toBe("生效中");
    // 外部系统直接改了 s2 的场地，绕过本页变更通道
    const s2 = raw.scenes.find((s: any) => s.id === "s2");
    s2.locationId = "l2";
    localStorage.setItem("pair-wise-yf-45/schedule-v2", JSON.stringify(raw));

    // 模拟新开页面：全新 pinia，store 重新初始化并执行启动对账
    setActivePinia(createPinia());
    const reopened = useScheduleStore();
    const target = reopened.exemptionRecords.find((r) => r.id === record.id)!;
    expect(target.status).toBe("已失效");
    expect(target.invalidatedByChange).toContain("启动对账");
  });
});
