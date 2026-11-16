import type { IconHandle } from "@animateicons/react";
import {
  BellIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleIcon,
  CircleXIcon,
  DeleteIcon,
  EyeIcon,
  EyeOffIcon,
  Grid3x3Icon,
  HistoryIcon,
  InfoIcon,
  LoaderCircleIcon,
  MicIcon,
  MicOffIcon,
  NetworkIcon,
  OctagonXIcon,
  PauseIcon,
  PencilIcon,
  PhoneCallIcon,
  PhoneForwardedIcon,
  PhoneIcon,
  PhoneIncomingIcon,
  PhoneMissedIcon,
  PhoneOffIcon,
  PlayIcon,
  PlugIcon,
  PlugZapIcon,
  PlusIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  SearchIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  StarIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UserPlusIcon,
  UserRoundIcon,
  UsersIcon,
  Volume2Icon,
  XIcon,
  AppWindowIcon,
  AudioLinesIcon,
  BugIcon,
  CircleDotIcon,
  CopyIcon,
  FolderOpenIcon,
  MenuIcon,
  PinIcon,
  ChartLineIcon,
  Building2Icon,
  CloudIcon,
  FolderPlusIcon,
  FolderIcon,
  KeyRoundIcon,
  ListChecksIcon,
  LogOutIcon,
  MailIcon,
  ServerIcon,
  ShieldCheckIcon,
  SquareCheckIcon,
} from "@animateicons/react/lucide";
import {
  type ComponentProps,
  type ComponentType,
  type ForwardRefExoticComponent,
  type RefAttributes,
  useEffect,
  useRef,
} from "react";

import { cn } from "@/lib/utils";

/**
 * The app's icons: the animated Lucide set from AnimateIcons (https://animateicons.in/icons/lucide).
 *
 * Each icon is a drop-in for its `lucide-react` namesake: it is sized with a Tailwind `size-*`
 * class (`size-4` by default), coloured with `text-*` and decorative (`aria-hidden`) unless it
 * has an `aria-label`. On top of that, it plays its animation when the pointer enters the
 * button / link / menu item that contains it — not only the icon itself.
 */
export interface IconProps {
  className?: string;
  style?: React.CSSProperties;
  "aria-label"?: string;
  "aria-hidden"?: boolean | "true" | "false";
}

export type AppIcon = ComponentType<IconProps>;

type AnimatedIcon = ForwardRefExoticComponent<
  Omit<ComponentProps<typeof PhoneIcon>, "ref"> & RefAttributes<IconHandle>
>;

/** Elements whose hover / focus should animate the icons they contain. */
const HOST =
  "button, a, [role='button'], [role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio'], [role='option'], [role='tab'], [data-icon-host]";

function createIcon(Base: AnimatedIcon, name: string): AppIcon {
  function Icon({ className, "aria-label": label, "aria-hidden": hidden, ...rest }: IconProps) {
    const anchor = useRef<HTMLSpanElement>(null);
    const handle = useRef<IconHandle>(null);

    useEffect(() => {
      const el = anchor.current;
      const host = el?.parentElement?.closest(HOST) ?? el?.firstElementChild;
      if (!host) return;
      const start = () => handle.current?.startAnimation();
      const stop = () => handle.current?.stopAnimation();
      host.addEventListener("mouseenter", start);
      host.addEventListener("mouseleave", stop);
      host.addEventListener("focusin", start);
      host.addEventListener("focusout", stop);
      return () => {
        host.removeEventListener("mouseenter", start);
        host.removeEventListener("mouseleave", stop);
        host.removeEventListener("focusin", start);
        host.removeEventListener("focusout", stop);
      };
    }, []);

    return (
      // `contents`: the wrapper only locates the host element, it takes no part in the layout.
      <span ref={anchor} data-slot="icon" className="contents">
        <Base
          ref={handle}
          className={cn(!/(^|\s)size-/.test(className ?? "") && "size-4", "shrink-0 [&>svg]:size-full!", className)}
          {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": hidden ?? true })}
          {...rest}
        />
      </span>
    );
  }
  Icon.displayName = name;
  return Icon;
}

export const Bell = createIcon(BellIcon, "Bell");
export const Check = createIcon(CheckIcon, "Check");
export const ChevronDown = createIcon(ChevronDownIcon, "ChevronDown");
export const ChevronLeft = createIcon(ChevronLeftIcon, "ChevronLeft");
export const ChevronRight = createIcon(ChevronRightIcon, "ChevronRight");
export const ChevronUp = createIcon(ChevronUpIcon, "ChevronUp");
export const Circle = createIcon(CircleIcon, "Circle");
export const CircleAlert = createIcon(CircleAlertIcon, "CircleAlert");
export const CircleCheck = createIcon(CircleCheckIcon, "CircleCheck");
export const CircleDashed = createIcon(CircleDashedIcon, "CircleDashed");
export const CircleX = createIcon(CircleXIcon, "CircleX");
export const Delete = createIcon(DeleteIcon, "Delete");
export const Eye = createIcon(EyeIcon, "Eye");
export const EyeOff = createIcon(EyeOffIcon, "EyeOff");
/** The keypad (AnimateIcons has no `Grip`). */
export const Grid3x3 = createIcon(Grid3x3Icon, "Grid3x3");
export const History = createIcon(HistoryIcon, "History");
export const Info = createIcon(InfoIcon, "Info");
export const LoaderCircle = createIcon(LoaderCircleIcon, "LoaderCircle");
export const Mic = createIcon(MicIcon, "Mic");
export const MicOff = createIcon(MicOffIcon, "MicOff");
export const Network = createIcon(NetworkIcon, "Network");
export const OctagonX = createIcon(OctagonXIcon, "OctagonX");
export const Pause = createIcon(PauseIcon, "Pause");
export const Pencil = createIcon(PencilIcon, "Pencil");
export const Phone = createIcon(PhoneIcon, "Phone");
export const PhoneCall = createIcon(PhoneCallIcon, "PhoneCall");
/** Also stands for an outgoing call in the history (AnimateIcons has no `PhoneOutgoing`). */
export const PhoneForwarded = createIcon(PhoneForwardedIcon, "PhoneForwarded");
export const PhoneIncoming = createIcon(PhoneIncomingIcon, "PhoneIncoming");
export const PhoneMissed = createIcon(PhoneMissedIcon, "PhoneMissed");
export const PhoneOff = createIcon(PhoneOffIcon, "PhoneOff");
export const Play = createIcon(PlayIcon, "Play");
export const Plug = createIcon(PlugIcon, "Plug");
export const PlugZap = createIcon(PlugZapIcon, "PlugZap");
export const Plus = createIcon(PlusIcon, "Plus");
export const RefreshCw = createIcon(RefreshCwIcon, "RefreshCw");
export const ScrollText = createIcon(ScrollTextIcon, "ScrollText");
export const Search = createIcon(SearchIcon, "Search");
export const Settings = createIcon(SettingsIcon, "Settings");
export const SlidersHorizontal = createIcon(SlidersHorizontalIcon, "SlidersHorizontal");
export const Star = createIcon(StarIcon, "Star");
export const Trash2 = createIcon(Trash2Icon, "Trash2");
export const TriangleAlert = createIcon(TriangleAlertIcon, "TriangleAlert");
export const UserPlus = createIcon(UserPlusIcon, "UserPlus");
export const UserRound = createIcon(UserRoundIcon, "UserRound");
export const Users = createIcon(UsersIcon, "Users");
export const Volume2 = createIcon(Volume2Icon, "Volume2");
export const X = createIcon(XIcon, "X");
export const AppWindow = createIcon(AppWindowIcon, "AppWindow");
export const AudioLines = createIcon(AudioLinesIcon, "AudioLines");
export const Bug = createIcon(BugIcon, "Bug");
export const CircleDot = createIcon(CircleDotIcon, "CircleDot");
export const Copy = createIcon(CopyIcon, "Copy");
export const FolderOpen = createIcon(FolderOpenIcon, "FolderOpen");
export const Menu = createIcon(MenuIcon, "Menu");
export const Pin = createIcon(PinIcon, "Pin");
export const ChartLine = createIcon(ChartLineIcon, "ChartLine");
export const Building2 = createIcon(Building2Icon, "Building2");
export const Cloud = createIcon(CloudIcon, "Cloud");
export const Folder = createIcon(FolderIcon, "Folder");
export const FolderPlus = createIcon(FolderPlusIcon, "FolderPlus");
export const KeyRound = createIcon(KeyRoundIcon, "KeyRound");
export const ListChecks = createIcon(ListChecksIcon, "ListChecks");
export const LogOut = createIcon(LogOutIcon, "LogOut");
export const Mail = createIcon(MailIcon, "Mail");
export const Server = createIcon(ServerIcon, "Server");
export const ShieldCheck = createIcon(ShieldCheckIcon, "ShieldCheck");
export const SquareCheck = createIcon(SquareCheckIcon, "SquareCheck");
