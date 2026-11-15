/*
 * Dock — macOS-style dock with icon magnification, from Joly UI
 * (https://www.jolyui.dev/docs/components/navigation/dock, MIT, Copyright (c) 2025 Johuniq — see
 * THIRD_PARTY_NOTICES.md).
 *
 * Changes from upstream: items are real buttons (keyboard, focus ring, accessible name, `aria-current`), a translucent blurred glass look,
 * they forward their ref and props (so they can be a Radix trigger), `fixed` items keep their size,
 * `DockBadge` was added, the pointer is read in viewport coordinates, and magnification is off under
 * `prefers-reduced-motion`.
 */
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react"
import * as React from "react"

import { cn } from "@/lib/utils"

interface DockProps extends React.ComponentPropsWithoutRef<"div"> {
  /** Maximum scale factor when the pointer is right over an item */
  maxScale?: number
  /** Base size of the items, in pixels */
  iconSize?: number
  /** Distance from the pointer within which items are magnified, in pixels */
  distance?: number
}

const DockContext = React.createContext<{
  mouseX: ReturnType<typeof useMotionValue<number>>
  maxScale: number
  iconSize: number
  distance: number
} | null>(null)

const Dock = React.forwardRef<HTMLDivElement, DockProps>(
  (
    {
      className,
      children,
      maxScale = 1.5,
      iconSize = 48,
      distance = 140,
      onMouseMove,
      onMouseLeave,
      ...props
    },
    ref
  ) => {
    const mouseX = useMotionValue(Infinity)
    const reduceMotion = useReducedMotion()

    return (
      <DockContext.Provider
        value={{
          mouseX,
          maxScale: reduceMotion ? 1 : maxScale,
          iconSize,
          distance,
        }}
      >
        <div
          ref={ref}
          onMouseMove={(e) => {
            mouseX.set(e.clientX)
            onMouseMove?.(e)
          }}
          onMouseLeave={(e) => {
            mouseX.set(Infinity)
            onMouseLeave?.(e)
          }}
          className={cn(
            "dock mx-auto flex h-16 items-end gap-2 rounded-2xl border border-foreground/15 bg-background/25 px-3 pb-2 shadow-lg shadow-foreground/10 backdrop-blur-2xl backdrop-saturate-150 [box-shadow:inset_0_1px_0_color-mix(in_oklab,white_22%,transparent),0_10px_30px_-10px_color-mix(in_oklab,var(--foreground)_30%,transparent)]",
            className
          )}
          {...props}
        >
          {children}
        </div>
      </DockContext.Provider>
    )
  }
)
Dock.displayName = "Dock"

interface DockItemProps extends React.ComponentPropsWithoutRef<"button"> {
  /** Keeps its size when the pointer comes close (for content that must not be resized, like a WebGL canvas) */
  fixed?: boolean
  /** The item of the page being shown: marked with a dot and `aria-current` */
  active?: boolean
}

const DockItem = React.forwardRef<HTMLButtonElement, DockItemProps>(
  ({ className, children, fixed, active, ...props }, ref) => {
    const context = React.useContext(DockContext)
    const boxRef = React.useRef<HTMLDivElement>(null)

    if (!context) {
      throw new Error("DockItem must be used within a Dock")
    }

    const { mouseX, maxScale, iconSize, distance } = context

    const distanceCalc = useTransform(mouseX, (val: number) => {
      const bounds = boxRef.current?.getBoundingClientRect()
      return bounds ? val - bounds.x - bounds.width / 2 : Infinity
    })

    const widthSync = useTransform(
      distanceCalc,
      [-distance, 0, distance],
      [iconSize, iconSize * maxScale, iconSize]
    )

    const width = useSpring(widthSync, {
      mass: 0.1,
      stiffness: 150,
      damping: 12,
    })

    return (
      <motion.div
        ref={boxRef}
        style={fixed ? { width: iconSize, height: iconSize } : { width, height: width }}
        className="group relative aspect-square shrink-0"
      >
        <button
          ref={ref}
          type="button"
          aria-current={active ? "page" : undefined}
          className={cn(
            "dock-item absolute inset-0 flex cursor-pointer items-center justify-center rounded-xl bg-foreground/[0.07] text-foreground outline-none transition-colors hover:bg-foreground/[0.14] focus-visible:ring-[3px] focus-visible:ring-ring/50",
            active && "bg-primary/15 text-primary hover:bg-primary/20",
            className
          )}
          {...props}
        >
          {children}
        </button>
        {active && (
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-foreground/70"
          />
        )}
      </motion.div>
    )
  }
)
DockItem.displayName = "DockItem"

interface DockIconProps extends React.ComponentPropsWithoutRef<"div"> {}

const DockIcon = React.forwardRef<HTMLDivElement, DockIconProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "dock-icon flex h-full w-full items-center justify-center",
          "[&>svg]:h-1/2 [&>svg]:w-1/2",
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }
)
DockIcon.displayName = "DockIcon"

interface DockLabelProps extends React.ComponentPropsWithoutRef<"div"> {}

/** A tooltip above the item, shown while it is hovered or focused. Decorative: the item has its own accessible name. */
const DockLabel = React.forwardRef<HTMLDivElement, DockLabelProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        aria-hidden
        className={cn(
          "dock-label pointer-events-none absolute -top-9 left-1/2 z-10 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs whitespace-nowrap text-background opacity-0 transition-opacity group-has-[:focus-visible]:opacity-100 group-hover:opacity-100",
          className
        )}
        {...props}
      >
        {children}
        {/* Tooltip arrow */}
        <div className="absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rotate-45 bg-foreground" />
      </div>
    )
  }
)
DockLabel.displayName = "DockLabel"

interface DockBadgeProps extends React.ComponentPropsWithoutRef<"span"> {}

/** A small count over the top-right corner of an item. */
const DockBadge = React.forwardRef<HTMLSpanElement, DockBadgeProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          "dock-badge pointer-events-none absolute -top-1.5 -right-1.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white",
          className
        )}
        {...props}
      >
        {children}
      </span>
    )
  }
)
DockBadge.displayName = "DockBadge"

interface DockSeparatorProps extends React.ComponentPropsWithoutRef<"div"> {}

const DockSeparator = React.forwardRef<HTMLDivElement, DockSeparatorProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="separator"
        aria-orientation="vertical"
        className={cn(
          "dock-separator mx-1 h-10 w-px self-center bg-border",
          className
        )}
        {...props}
      />
    )
  }
)
DockSeparator.displayName = "DockSeparator"

export {
  Dock,
  DockBadge,
  DockIcon,
  DockItem,
  DockLabel,
  DockSeparator,
  type DockBadgeProps,
  type DockIconProps,
  type DockItemProps,
  type DockLabelProps,
  type DockProps,
  type DockSeparatorProps,
}
