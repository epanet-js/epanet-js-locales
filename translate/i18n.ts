import i18next from "i18next";
import FsBackend from "i18next-fs-backend";
import path from "path";
import { DEFAULT_NS, LOCALES_DIR } from "./config";

export async function initI18n() {
  await i18next.use(FsBackend).init({
    fallbackLng: "en",
    lng: "en",
    ns: [DEFAULT_NS],
    defaultNS: DEFAULT_NS,
    backend: {
      loadPath: path.join(LOCALES_DIR, "{{lng}}/{{ns}}.json"),
    },
    interpolation: { escapeValue: false },
    initImmediate: false,
  });
}
