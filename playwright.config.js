import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Le CSS respecte prefers-reduced-motion (transitions/animations ramenees
    // a .01ms) : on s'en sert ici pour que les captures axe-core ne tombent
    // jamais au milieu du fondu d'entree .page-enter rejoue a chaque onglet,
    // ce qui faussait aleatoirement la mesure de contraste des couleurs.
    reducedMotion: "reduce",
  },
  webServer: {
    command: "node tests/e2e/server.mjs",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
