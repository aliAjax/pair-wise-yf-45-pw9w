import { createApp } from "vue";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import { createI18n } from "vue-i18n";
import App from "./App.vue";
import { router } from "./router";
import "./styles.css";

const i18n = createI18n({
  legacy: false,
  locale: "zh-CN",
  messages: {
    "zh-CN": {
      schedule: "通告编排",
      conflicts: "冲突中心",
      history: "版本历史",
      save: "保存",
      draft: "离线草稿"
    }
  }
});

createApp(App).use(createPinia()).use(router).use(i18n).use(ElementPlus).mount("#root");
