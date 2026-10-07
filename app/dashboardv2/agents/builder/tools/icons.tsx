/* Small stroke icons for the Tools tab, same weight as the builder's
   chevrons (16px box, 1.5 stroke, currentColor). */

type IconProps = { size?: number };

function Svg({ size = 14, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const BracesIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 2.5c-1.5 0-2 .7-2 2v1.6c0 .8-.4 1.4-1.3 1.9.9.5 1.3 1.1 1.3 1.9v1.6c0 1.3.5 2 2 2M10.5 2.5c1.5 0 2 .7 2 2v1.6c0 .8.4 1.4 1.3 1.9-.9.5-1.3 1.1-1.3 1.9v1.6c0 1.3-.5 2-2 2" />
  </Svg>
);

export const BoltIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 1.5 3.5 9h4L7 14.5 12.5 7h-4z" />
  </Svg>
);

export const DocIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 1.5h5.5L12.5 4.5v10h-8.5zM9.5 1.5v3h3M6 8h4.5M6 10.5h4.5" />
  </Svg>
);

export const CopyIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </Svg>
);

export const PencilIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 2.5 13.5 5 6 12.5l-3 .5.5-3z" />
  </Svg>
);

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 9h6.6l.7-9" />
  </Svg>
);

export const FilterIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 2.5v11M2.5 11.5l2 2 2-2M11.5 13.5v-11M9.5 4.5l2-2 2 2" />
  </Svg>
);

export const InfoIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.2v3.6M8 5.2v.1" />
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3" />
  </Svg>
);

export const XIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Svg>
);

export const ExpandIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" />
  </Svg>
);
