import path from "node:path";
import { Config } from "@remotion/cli/config";

// Remotion's bundler does not read tsconfig paths: the "@/" alias of the snapcn components is declared here too.
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: { ...(config.resolve?.alias ?? {}), "@": path.resolve(process.cwd(), "src") },
  },
}));
Config.setBrowserExecutable("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
Config.setChromiumOpenGlRenderer("angle");
