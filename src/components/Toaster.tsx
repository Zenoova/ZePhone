import { Toaster as Ding } from "@yusufceng1z/ding-react";
import { useTheme } from "next-themes";

/** The app's alerts: Ding's spring-physics toasts (https://ding.yusufcengiz.dev), following the app theme. */
export function Toaster() {
  const { theme } = useTheme();
  return (
    <Ding
      position="top-center"
      theme={theme === "light" || theme === "dark" ? theme : "system"}
      labels={{ region: "Notifications", dismiss: "Fermer la notification" }}
    />
  );
}
