import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.samvar.ios",
  appName: "Samvar",
  webDir: "www",
  ios: {
    contentInset: "automatic",
    scheme: "Samvar",
    backgroundColor: "#faf6ee",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 800,
      backgroundColor: "#faf6ee",
    },
    LocalNotifications: {
      iconColor: "#2a78d6",
    },
  },
};

export default config;
