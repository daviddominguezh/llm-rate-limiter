import { ArrowRight } from "lucide-react";

export const HANDLE_SIZE = 16;
export const ICON_SIZE = 10;
export const BORDER_COLOR = "var(--secondary)";
export const BORDER_COLOR_RED = "#ef4444";

// Pre-rendered static arrows - never re-render
const ArrowDownRed = (
  <ArrowRight
    size={ICON_SIZE}
    className="absolute text-red-400"
    style={{ transform: "rotate(90deg)" }}
  />
);
const ArrowUpGreen = (
  <ArrowRight
    size={ICON_SIZE}
    className="absolute text-green-500"
    style={{ transform: "rotate(-90deg)" }}
  />
);
const ArrowUpRed = (
  <ArrowRight
    size={ICON_SIZE}
    className="absolute text-red-400"
    style={{ transform: "rotate(-90deg)" }}
  />
);
const ArrowDownGreen = (
  <ArrowRight
    size={ICON_SIZE}
    className="absolute text-green-500"
    style={{ transform: "rotate(90deg)" }}
  />
);
const ArrowRightRed = (
  <ArrowRight
    size={ICON_SIZE}
    className="absolute text-red-400"
    style={{ transform: "rotate(0deg)" }}
  />
);
const ArrowLeftGreen = (
  <ArrowRight
    size={ICON_SIZE}
    className="absolute text-green-500"
    style={{ transform: "rotate(180deg)" }}
  />
);
const ArrowLeftRed = (
  <ArrowRight
    size={ICON_SIZE}
    className="absolute text-red-400"
    style={{ transform: "rotate(180deg)" }}
  />
);
const ArrowRightGreen = (
  <ArrowRight
    size={ICON_SIZE}
    className="absolute text-green-500"
    style={{ transform: "rotate(0deg)" }}
  />
);

// Pre-rendered static handle contents - never re-render
export const TopTargetContent = (
  <div className="relative w-full h-full flex flex-col justify-center items-center">
    {ArrowDownRed}
    <div className="absolute bottom-[-1px]">
      <svg
        width={HANDLE_SIZE + 2}
        height={HANDLE_SIZE + 2}
        viewBox="-1.5 0 19 0.05"
      >
        <path
          d="M -1 0 A 9 9 0 0 0 17 0 L 17 8 L -1 8 Z"
          fill="var(--xy-background-color)"
        />
        <path
          d="M -1 0 A 9 9 0 0 0 17 0"
          fill="none"
          stroke={BORDER_COLOR}
          strokeWidth="1"
        />
      </svg>
    </div>
  </div>
);

export const TopSourceContent = (
  <div className="relative w-full h-full flex flex-col justify-center items-center">
    {ArrowUpGreen}
    <div className="absolute top-[0px]">
      <svg
        width={HANDLE_SIZE + 2}
        height={HANDLE_SIZE + 2}
        viewBox="-1.5 7.95 19 0.05"
      >
        <path
          d="M -1 8 A 9 9 0 0 1 17 8 L 17 0 L -1 0 Z"
          fill="var(--xy-background-color)"
        />
        <path
          d="M -1 8 A 9 9 0 0 1 17 8"
          fill="none"
          stroke={BORDER_COLOR}
          strokeWidth="1"
        />
      </svg>
    </div>
  </div>
);

export const BottomTargetContent = (
  <div className="relative w-full h-full flex flex-col justify-center items-center">
    {ArrowUpRed}
    <div className="absolute top-[-1px]">
      <svg
        width={HANDLE_SIZE + 2}
        height={HANDLE_SIZE + 2}
        viewBox="-1.5 7.95 19 0.05"
      >
        <path
          d="M -1 8 A 9 9 0 0 1 17 8 L 17 0 L -1 0 Z"
          fill="var(--xy-background-color)"
        />
        <path
          d="M -1 8 A 9 9 0 0 1 17 8"
          fill="none"
          stroke={BORDER_COLOR}
          strokeWidth="1"
        />
      </svg>
    </div>
  </div>
);

export const BottomSourceContent = (
  <div className="relative w-full h-full flex flex-col justify-center items-center">
    {ArrowDownGreen}
    <div className="absolute bottom-[0px]">
      <svg
        width={HANDLE_SIZE + 2}
        height={HANDLE_SIZE + 2}
        viewBox="-1.5 0 19 0.05"
      >
        <path
          d="M -1 0 A 9 9 0 0 0 17 0 L 17 8 L -1 8 Z"
          fill="var(--xy-background-color)"
        />
        <path
          d="M -1 0 A 9 9 0 0 0 17 0"
          fill="none"
          stroke={BORDER_COLOR}
          strokeWidth="1"
        />
      </svg>
    </div>
  </div>
);

export const LeftTargetContent = (
  <div className="relative w-full h-full flex flex-col justify-center items-center">
    {ArrowRightRed}
    <div className="absolute right-[-1px]">
      <svg
        width={HANDLE_SIZE + 2}
        height={HANDLE_SIZE + 2}
        viewBox="0 -1.5 0.05 19"
      >
        <path
          d="M 0 -1 A 9 9 0 0 1 0 17 L 8 17 L 8 -1 Z"
          fill="var(--xy-background-color)"
        />
        <path
          d="M 0 -1 A 9 9 0 0 1 0 17"
          fill="none"
          stroke={BORDER_COLOR}
          strokeWidth="1"
        />
      </svg>
    </div>
  </div>
);

export const LeftSourceContent = (
  <div className="relative w-full h-full flex flex-col justify-center items-center">
    {ArrowLeftGreen}
    <div className="absolute left-[0px]">
      <svg
        width={HANDLE_SIZE + 2}
        height={HANDLE_SIZE + 2}
        viewBox="7.95 -1.5 0.05 19"
      >
        <path
          d="M 8 -1 A 9 9 0 0 0 8 17 L 0 17 L 0 -1 Z"
          fill="var(--xy-background-color)"
        />
        <path
          d="M 8 -1 A 9 9 0 0 0 8 17"
          fill="none"
          stroke={BORDER_COLOR}
          strokeWidth="1"
        />
      </svg>
    </div>
  </div>
);

export const RightTargetContent = (
  <div className="relative w-full h-full flex flex-col justify-center items-center">
    {ArrowLeftRed}
    <div className="absolute left-[-1px]">
      <svg
        width={HANDLE_SIZE + 2}
        height={HANDLE_SIZE + 2}
        viewBox="7.95 -1.5 0.05 19"
      >
        <path
          d="M 8 -1 A 9 9 0 0 0 8 17 L 0 17 L 0 -1 Z"
          fill="var(--xy-background-color)"
        />
        <path
          d="M 8 -1 A 9 9 0 0 0 8 17"
          fill="none"
          stroke={BORDER_COLOR}
          strokeWidth="1"
        />
      </svg>
    </div>
  </div>
);

export const RightSourceContent = (
  <div className="relative w-full h-full flex flex-col justify-center items-center">
    {ArrowRightGreen}
    <div className="absolute right-[0px]">
      <svg
        width={HANDLE_SIZE + 2}
        height={HANDLE_SIZE + 2}
        viewBox="0 -1.5 0.05 19"
      >
        <path
          d="M 0 -1 A 9 9 0 0 1 0 17 L 8 17 L 8 -1 Z"
          fill="var(--xy-background-color)"
        />
        <path
          d="M 0 -1 A 9 9 0 0 1 0 17"
          fill="none"
          stroke={BORDER_COLOR}
          strokeWidth="1"
        />
      </svg>
    </div>
  </div>
);

// Red border versions for nextNodeIsUser
export const TopTargetContentRed = (
  <div className="relative w-full h-full flex flex-col justify-center items-center">
    {ArrowDownRed}
    <div className="absolute bottom-[-1px]">
      <svg
        width={HANDLE_SIZE + 2}
        height={HANDLE_SIZE + 2}
        viewBox="-1.5 0 19 0.05"
      >
        <path
          d="M -1 0 A 9 9 0 0 0 17 0 L 17 8 L -1 8 Z"
          fill="var(--xy-background-color)"
        />
        <path
          d="M -1 0 A 9 9 0 0 0 17 0"
          fill="none"
          stroke={BORDER_COLOR_RED}
          strokeWidth="2"
        />
      </svg>
    </div>
  </div>
);

export const TopSourceContentRed = (
  <div className="relative w-full h-full flex flex-col justify-center items-center">
    {ArrowUpGreen}
    <div className="absolute top-[0px]">
      <svg
        width={HANDLE_SIZE + 2}
        height={HANDLE_SIZE + 2}
        viewBox="-1.5 7.95 19 0.05"
      >
        <path
          d="M -1 8 A 9 9 0 0 1 17 8 L 17 0 L -1 0 Z"
          fill="var(--xy-background-color)"
        />
        <path
          d="M -1 8 A 9 9 0 0 1 17 8"
          fill="none"
          stroke={BORDER_COLOR_RED}
          strokeWidth="2"
        />
      </svg>
    </div>
  </div>
);

export const BottomTargetContentRed = (
  <div className="relative w-full h-full flex flex-col justify-center items-center">
    {ArrowUpRed}
    <div className="absolute top-[-1px]">
      <svg
        width={HANDLE_SIZE + 2}
        height={HANDLE_SIZE + 2}
        viewBox="-1.5 7.95 19 0.05"
      >
        <path
          d="M -1 8 A 9 9 0 0 1 17 8 L 17 0 L -1 0 Z"
          fill="var(--xy-background-color)"
        />
        <path
          d="M -1 8 A 9 9 0 0 1 17 8"
          fill="none"
          stroke={BORDER_COLOR_RED}
          strokeWidth="2"
        />
      </svg>
    </div>
  </div>
);

export const BottomSourceContentRed = (
  <div className="relative w-full h-full flex flex-col justify-center items-center">
    {ArrowDownGreen}
    <div className="absolute bottom-[0px]">
      <svg
        width={HANDLE_SIZE + 2}
        height={HANDLE_SIZE + 2}
        viewBox="-1.5 0 19 0.05"
      >
        <path
          d="M -1 0 A 9 9 0 0 0 17 0 L 17 8 L -1 8 Z"
          fill="var(--xy-background-color)"
        />
        <path
          d="M -1 0 A 9 9 0 0 0 17 0"
          fill="none"
          stroke={BORDER_COLOR_RED}
          strokeWidth="2"
        />
      </svg>
    </div>
  </div>
);

export const LeftTargetContentRed = (
  <div className="relative w-full h-full flex flex-col justify-center items-center">
    {ArrowRightRed}
    <div className="absolute right-[-1px]">
      <svg
        width={HANDLE_SIZE + 2}
        height={HANDLE_SIZE + 2}
        viewBox="0 -1.5 0.05 19"
      >
        <path
          d="M 0 -1 A 9 9 0 0 1 0 17 L 8 17 L 8 -1 Z"
          fill="var(--xy-background-color)"
        />
        <path
          d="M 0 -1 A 9 9 0 0 1 0 17"
          fill="none"
          stroke={BORDER_COLOR_RED}
          strokeWidth="2"
        />
      </svg>
    </div>
  </div>
);

export const RightSourceContentRed = (
  <div className="relative w-full h-full flex flex-col justify-center items-center">
    {ArrowRightGreen}
    <div className="absolute right-[0px]">
      <svg
        width={HANDLE_SIZE + 2}
        height={HANDLE_SIZE + 2}
        viewBox="0 -1.5 0.05 19"
      >
        <path
          d="M 0 -1 A 9 9 0 0 1 0 17 L 8 17 L 8 -1 Z"
          fill="var(--xy-background-color)"
        />
        <path
          d="M 0 -1 A 9 9 0 0 1 0 17"
          fill="none"
          stroke={BORDER_COLOR_RED}
          strokeWidth="2"
        />
      </svg>
    </div>
  </div>
);
