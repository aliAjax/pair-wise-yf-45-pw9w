import { createRouter, createWebHashHistory } from "vue-router";
import ScheduleView from "../views/ScheduleView.vue";
import ConflictView from "../views/ConflictView.vue";
import HistoryView from "../views/HistoryView.vue";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "schedule", component: ScheduleView },
    { path: "/conflicts", name: "conflicts", component: ConflictView },
    { path: "/history", name: "history", component: HistoryView }
  ]
});
