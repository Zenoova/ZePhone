import path from "node:path";
import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";

// Remotion's bundler does not read tsconfig paths: the "@/" alias of the copied components is declared here too.
Config.overrideWebpackConfig((config) => {
  const withTailwind = enableTailwind(config);
  return {
    ...withTailwind,
    resolve: {
      ...withTailwind.resolve,
      alias: { ...(withTailwind.resolve?.alias ?? {}), "@": path.resolve(process.cwd(), "src") },
    },
  };
});
Config.setBrowserExecutable("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
Config.setChromiumOpenGlRenderer("angle");
