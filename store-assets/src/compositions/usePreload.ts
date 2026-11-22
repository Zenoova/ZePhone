import { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";

/** Holds the render until every image is loaded and decoded (plain <img> tags are not waited for by Remotion). */
export function usePreload(urls: string[]) {
  const [handle] = useState(() => delayRender("preload images"));
  useEffect(() => {
    let live = true;
    Promise.all(
      urls.map(async (u) => {
        const img = new Image();
        img.src = u;
        await img.decode();
      }),
    )
      .catch(() => undefined)
      .finally(() => live && continueRender(handle));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
