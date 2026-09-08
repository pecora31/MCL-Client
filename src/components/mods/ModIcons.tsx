import React from 'react';
import { Box } from 'lucide-react';

/**
 * Official Modrinth & CurseForge Logos (Authentic Vector Paths from Simple-Icons & Official Brand Kits)
 */
export const ModrinthLogo: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12.252.004a11.78 11.768 0 0 0-8.92 3.73 11 10.999 0 0 0-2.17 3.11 11.37 11.359 0 0 0-1.16 5.169c0 1.42.17 2.5.6 3.77.24.759.77 1.899 1.17 2.529a12.3 12.298 0 0 0 8.85 5.639c.44.05 2.54.07 2.76.02.2-.04.22.1-.26-1.7l-.36-1.37-1.01-.06a8.5 8.489 0 0 1-5.18-1.8 5.34 5.34 0 0 1-1.3-1.26c0-.05.34-.28.74-.5a37.572 37.545 0 0 1 2.88-1.629c.03 0 .5.45 1.06.98l1 .97 2.07-.43 2.06-.43 1.47-1.47c.8-.8 1.48-1.5 1.48-1.52 0-.09-.42-1.63-.46-1.7-.04-.06-.2-.03-1.02.18-.53.13-1.2.3-1.45.4l-.48.15-.53.53-.53.53-.93.1-.93.07-.52-.5a2.7 2.7 0 0 1-.96-1.7l-.13-.6.43-.57c.68-.9.68-.9 1.46-1.1.4-.1.65-.2.83-.33.13-.099.65-.579 1.14-1.069l.9-.9-.7-.7-.7-.7-1.95.54c-1.07.3-1.96.53-1.97.53-.03 0-2.23 2.48-2.63 2.97l-.29.35.28 1.03c.16.56.3 1.16.31 1.34l.03.3-.34.23c-.37.23-2.22 1.3-2.84 1.63-.36.2-.37.2-.44.1-.08-.1-.23-.6-.32-1.03-.18-.86-.17-2.75.02-3.73a8.84 8.839 0 0 1 7.9-6.93c.43-.03.77-.08.78-.1.06-.17.5-2.999.47-3.039-.01-.02-.1-.02-.2-.03Zm3.68.67c-.2 0-.3.1-.37.38-.06.23-.46 2.42-.46 2.52 0 .04.1.11.22.16a8.51 8.499 0 0 1 2.99 2 8.38 8.379 0 0 1 2.16 3.449 6.9 6.9 0 0 1 .4 2.8c0 1.07 0 1.27-.1 1.73a9.37 9.369 0 0 1-1.76 3.769c-.32.4-.98 1.06-1.37 1.38-.38.32-1.54 1.1-1.7 1.14-.1.03-.1.06-.07.26.03.18.64 2.56.7 2.78l.06.06a12.07 12.058 0 0 0 7.27-9.4c.13-.77.13-2.58 0-3.4a11.96 11.948 0 0 0-5.73-8.578c-.7-.42-2.05-1.06-2.25-1.06Z" />
  </svg>
);

export const CurseForgeLogo: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M18.326 9.2145S23.2261 8.4418 24 6.1882h-7.5066V4.4H0l2.0318 2.3576V9.173s5.1267-.2665 7.1098 1.2372c2.7146 2.516-3.053 5.917-3.053 5.917L5.0995 19.6c1.5465-1.4726 4.494-3.3775 9.8983-3.2857-2.0565.65-4.1245 1.6651-5.7344 3.2857h10.9248l-1.0288-3.2726s-7.918-4.6688-.8336-7.1127z" />
  </svg>
);

/**
 * Authentic Mod Loader SVGs harvested directly from Modrinth's loader API:
 * https://api.modrinth.com/v2/tag/loader
 */

export const FabricIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="23"
      d="m820 761-85.6-87.6c-4.6-4.7-10.4-9.6-25.9 1-19.9 13.6-8.4 21.9-5.2 25.4 8.2 9 84.1 89 97.2 104 2.5 2.8-20.3-22.5-6.5-39.7 5.4-7 18-12 26-3 6.5 7.3 10.7 18-3.4 29.7-24.7 20.4-102 82.4-127 103-12.5 10.3-28.5 2.3-35.8-6-7.5-8.9-30.6-34.6-51.3-58.2-5.5-6.3-4.1-19.6 2.3-25 35-30.3 91.9-73.8 111.9-90.8"
      transform="matrix(.08671 0 0 .0867 -49.8 -56)"
    />
  </svg>
);

export const ForgeIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M2 7.5h8v-2h12v2s-7 3.4-7 6 3.1 3.1 3.1 3.1l.9 3.9H5l1-4.1s3.8.1 4-2.9c.2-2.7-6.5-.7-8-6Z" />
  </svg>
);

export const NeoForgeIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="m12 19.2v2m0-2v2" />
    <path d="m8.4 1.3c0.5 1.5 0.7 3 0.1 4.6-0.2 0.5-0.9 1.5-1.6 1.5m8.7-6.1c-0.5 1.5-0.7 3-0.1 4.6 0.2 0.6 0.9 1.5 1.6 1.5" />
    <path d="m3.6 15.8h-1.7m18.5 0h1.7" />
    <path d="m3.2 12.1h-1.7m19.3 0h1.8" />
    <path d="m8.1 12.7v1.6m7.8-1.6v1.6" />
    <path d="m10.8 18h1.2m0 1.2-1.2-1.2m2.4 0h-1.2m0 1.2 1.2-1.2" />
    <path d="m4 9.7c-0.5 1.2-0.8 2.4-0.8 3.7 0 3.1 2.9 6.3 5.3 8.2 0.9 0.7 2.2 1.1 3.4 1.1m0.1-17.8c-1.1 0-2.1 0.2-3.2 0.7m11.2 4.1c0.5 1.2 0.8 2.4 0.8 3.7 0 3.1-2.9 6.3-5.3 8.2-0.9 0.7-2.2 1.1-3.4 1.1m-0.1-17.8c1.1 0 2.1 0.2 3.2 0.7" />
    <path d="m4 9.7c-0.2-1.8-0.3-3.7 0.5-5.5s2.2-2.6 3.9-3m11.6 8.5c0.2-1.9 0.3-3.7-0.5-5.5s-2.2-2.6-3.9-3" />
    <path d="m12 21.2-2.4 0.4m2.4-0.4 2.4 0.4" />
  </svg>
);

export const QuiltIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => {
  const quiltPath =
    'M442.5 233.9c0-6.4-5.2-11.6-11.6-11.6h-197c-6.4 0-11.6 5.2-11.6 11.6v197c0 6.4 5.2 11.6 11.6 11.6h197c6.4 0 11.6-5.2 11.6-11.7v-197Z';
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={quiltPath} strokeWidth="65.6" transform="matrix(.03053 0 0 .03046 -3.2 -3.2)" />
      <path d={quiltPath} strokeWidth="65.6" transform="matrix(.03053 0 0 .03046 -3.2 7)" />
      <path d={quiltPath} strokeWidth="65.6" transform="matrix(.03053 0 0 .03046 6.9 -3.2)" />
      <path
        d="M442.5 234.8c0-7-5.6-12.5-12.5-12.5H234.7c-6.8 0-12.4 5.6-12.4 12.5V430c0 6.9 5.6 12.5 12.4 12.5H430c6.9 0 12.5-5.6 12.5-12.5V234.8Z"
        strokeWidth="70.4"
        transform="rotate(45 3.5 24) scale(.02843 .02835)"
      />
    </svg>
  );
};

export const BabricIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path
      strokeWidth="2"
      d="M12.35 5.89001L12.34 5.90001C10.59 7.37001 5.67003 11.13 2.64003 13.76C2.09003 14.23 1.97003 15.38 2.44003 15.93C4.24003 17.97 6.24003 20.2 6.89003 20.97C7.52003 21.69 8.91003 22.39 10 21.49C11.8 20 16.78 16.01 19.62 13.7"
    />
    <path
      strokeWidth="2"
      d="M19.59 13.66C19.34 13.33 18.02 11.53 19.05 10.25C19.52 9.63998 20.61 9.20998 21.3 9.98998C21.87 10.62 22.23 11.55 21.01 12.56C20.66 12.85 20.18 13.24 19.62 13.7C19.61 13.69 19.6 13.67 19.59 13.66Z"
    />
    <path
      strokeWidth="2"
      d="M19.63 13.71L19.62 13.7C19.61 13.69 19.6 13.67 19.59 13.66C18.65 12.59 14.44 8.13999 12.34 5.89999C11.76 5.28999 11.33 4.83999 11.18 4.66999C10.91 4.36999 9.91004 3.64999 11.63 2.46999C12.98 1.54999 13.48 1.97999 13.88 2.37999L21.3 9.97999"
    />
    <path
      fill="currentColor"
      strokeWidth="0.25"
      d="M10.6352 14.7743C10.7992 14.517 10.8811 14.2194 10.8811 13.8978C10.8811 12 9.2582 12 8.06967 12C7.61886 12 7.25 12.3538 7.25 12.8041V17.1948C7.25 17.637 7.61886 17.9989 8.06967 17.9989C8.1552 17.9965 9.54283 18.0068 9.57789 17.9909C10.3894 17.9668 11.25 17.6531 11.25 15.9886C11.25 15.7232 11.1762 15.1925 10.6352 14.7743ZM9.61886 13.8978C9.61886 14.0506 9.53686 14.1953 9.40574 14.2918H9.39753C9.29097 14.3722 9.15164 14.4205 9.00411 14.4205H8.47951V13.3831C8.56539 13.3831 8.92616 13.3832 9.00411 13.3831C9.34015 13.3831 9.61886 13.6163 9.61886 13.8978ZM9.29918 16.7927H8.47951V15.7554C8.68401 15.7555 9.09478 15.7553 9.29918 15.7554C9.71537 15.7517 10.0548 16.1404 9.85655 16.4871C9.7664 16.6641 9.54507 16.7927 9.29918 16.7927Z"
    />
  </svg>
);

export const BtaIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path
      strokeWidth="2"
      d="M12.35 5.89001L12.34 5.90001C10.59 7.37001 5.67003 11.13 2.64003 13.76C2.09003 14.23 1.97003 15.38 2.44003 15.93C4.24003 17.97 6.24003 20.2 6.89003 20.97C7.52003 21.69 8.91003 22.39 10 21.49C11.8 20 16.78 16.01 19.62 13.7"
    />
    <path
      strokeWidth="2"
      d="M19.59 13.66C19.34 13.33 18.02 11.53 19.05 10.25C19.52 9.63998 20.61 9.20998 21.3 9.98998C21.87 10.62 22.23 11.55 21.01 12.56C20.66 12.85 20.18 13.24 19.62 13.7C19.61 13.69 19.6 13.67 19.59 13.66Z"
    />
    <path
      strokeWidth="2"
      d="M19.63 13.71L19.62 13.7C19.61 13.69 19.6 13.67 19.59 13.66C18.65 12.59 14.44 8.13999 12.34 5.89999C11.76 5.28999 11.33 4.83999 11.18 4.66999C10.91 4.36999 9.91004 3.64999 11.63 2.46999C12.98 1.54999 13.48 1.97999 13.88 2.37999L21.3 9.97999"
    />
    <path
      fill="currentColor"
      strokeWidth="0.25"
      d="M10.6352 14.7743C10.7992 14.517 10.8811 14.2194 10.8811 13.8978C10.8811 12 9.2582 12 8.06967 12C7.61886 12 7.25 12.3538 7.25 12.8041V17.1948C7.25 17.637 7.61886 17.9989 8.06967 17.9989C8.1552 17.9965 9.54283 18.0068 9.57789 17.9909C10.3894 17.9668 11.25 17.6531 11.25 15.9886C11.25 15.7232 11.1762 15.1925 10.6352 14.7743ZM9.61886 13.8978C9.61886 14.0506 9.53686 14.1953 9.40574 14.2918H9.39753C9.29097 14.3722 9.15164 14.4205 9.00411 14.4205H8.47951V13.3831C8.56539 13.3831 8.92616 13.3832 9.00411 13.3831C9.34015 13.3831 9.61886 13.6163 9.61886 13.8978ZM9.29918 16.7927H8.47951V15.7554C8.68401 15.7555 9.09478 15.7553 9.29918 15.7554C9.71537 15.7517 10.0548 16.1404 9.85655 16.4871C9.7664 16.6641 9.54507 16.7927 9.29918 16.7927Z"
    />
    <path strokeWidth="1.5" d="M13.2991 11V14" />
    <path strokeWidth="1.5" d="M12 13.25L14.5981 11.75" />
    <path strokeWidth="1.5" d="M14.5981 13.25L12.0001 11.75" />
  </svg>
);

export const JavaAgentIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M18 2L22 6" />
    <path d="M17 7L20 4" />
    <path d="M19 9L8.69995 19.3C7.69995 20.3 6.19995 20.3 5.29995 19.3L4.69995 18.7C3.69995 17.7 3.69995 16.2 4.69995 15.3L15 5" />
    <path d="M9 11L13 15" />
    <path d="M5 19L2 22" />
    <path d="M14 4L20 10" />
  </svg>
);

export const LegacyFabricIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path
      strokeWidth="2"
      d="M21.3022 9.9787L13.8798 2.38379C13.4809 1.9763 12.978 1.55147 11.634 2.47049C9.90847 3.64961 10.9056 4.36921 11.1831 4.67266C11.8941 5.45296 18.4754 12.389 19.6113 13.6895C19.8281 13.9322 17.8511 11.7387 19.0477 10.2475C19.5159 9.64057 20.6085 9.20707 21.3022 9.98737C21.8658 10.6203 22.23 11.548 21.0074 12.5624C18.8656 14.331 12.1629 19.7064 9.99518 21.4925C8.91131 22.3855 7.52395 21.6919 6.89096 20.9723C6.24064 20.2006 4.23764 17.9724 2.44274 15.9263C1.96584 15.3801 2.08723 14.227 2.64218 13.7588C5.67703 11.1318 10.6108 7.36036 12.345 5.88646"
    />
    <path strokeWidth="2" d="M8 13V17H10" />
  </svg>
);

export const LiteLoaderIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="m3.924 21.537s3.561-1.111 8.076-6.365c2.544-2.959 2.311-1.986 4-4.172" />
    <path d="m7.778 19s1.208-0.48 4.222 0c2.283 0.364 6.037-4.602 6.825-6.702 1.939-5.165 0.894-10.431 0.894-10.431s-4.277 4.936-6.855 7.133c-5.105 4.352-6.509 11-6.509 11" />
  </svg>
);

export const ModLoaderIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M1.4 18V6h3.8v1.5h1.5V9h1.5V7.5h1.5V6h3.8v12H9.7v-5.3H9v1.5H6v-1.5h-.8V18H1.4zm12.1 0V6h3.8v9h5.3v3h-9.1z" />
  </svg>
);

export const NilLoaderIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <ellipse cx="12" cy="11" rx="5" ry="8" />
    <path d="M16.563 2.72485L6.75577 19.7114L12.3865 22.9624" />
  </svg>
);

export const OrnitheIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M8 7H7.99" />
    <path d="M20.6 18H12C9.87827 18 7.84344 17.1572 6.34315 15.6569C4.84285 14.1566 4 12.1217 4 10V7.00001C3.99775 6.14792 4.26766 5.31737 4.7704 4.6294C5.27315 3.94142 5.98245 3.43197 6.79496 3.17527C7.60747 2.91857 8.48072 2.92804 9.28746 3.2023C10.0942 3.47657 10.7923 4.00129 11.28 4.70001L22 20" />
    <path d="M4 7L2 7.5L4 8" />
    <path d="M14 18V21" />
    <path d="M10 17.75V21" />
    <path d="M17 18C15.7669 18 14.5637 17.62 13.5543 16.9117C12.5448 16.2035 11.7781 15.2014 11.3584 14.0419C10.9388 12.8824 10.8866 11.6218 11.2089 10.4315C11.5313 9.24128 12.2126 8.17927 13.16 7.39001" />
  </svg>
);

export const RiftIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M2.7 6.6v10.8l9.3 5.3 9.3-5.3V6.6L12 1.3zm0 0L12 12m9.3-5.4L12 12m0 10.7V12" />
  </svg>
);

export const OptiFineIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M10.985 9.205c0-1.38-1.121-2.5-2.5-2.5H7.156a2.5 2.5 0 0 0-2.5 2.5v5.59a2.5 2.5 0 0 0 2.5 2.5h1.329c1.379 0 2.5-1.12 2.5-2.5v-5.59ZM14.793 17.295v-9.34a1.252 1.252 0 0 1 1.25-1.25h3.301M18.007 10.997h-3.214" />
  </svg>
);

export const IrisIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path
      d="m22.59 12.013-3.01 3.126v4.405l.005.019-4.251-.005-2.994 3.115h-.003l-3.003-3.132H5.1l-.018.005.005-4.424-2.994-3.116-.003-.023L5.1 8.858V4.452l-.005-.019 4.252.005 2.993-3.115h.003l3.003 3.132h4.234l.018-.005-.005 4.425 2.994 3.115"
      transform="translate(-.344)"
    />
    <path
      d="m17.229 12.005-1.436 1.491v2.101l.003.009-2.028-.002-1.428 1.486h-.001l-1.433-1.494H8.887l-.008.002.002-2.11-1.428-1.486-.001-.011L8.887 10.5V8.399l-.002-.009 2.027.002 1.428-1.485h.002l1.432 1.494h2.019l.009-.003-.003 2.11 1.428 1.486"
      transform="translate(-.344)"
    />
  </svg>
);

export const VanillaIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
    <path
      fillRule="evenodd"
      d="M9.504 1.132a1 1 0 01.992 0l1.75 1a1 1 0 11-.992 1.736L10 3.152l-1.254.716a1 1 0 11-.992-1.736l1.75-1zM5.618 4.504a1 1 0 01-.372 1.364L5.016 6l.23.132a1 1 0 11-.992 1.736L4 7.723V8a1 1 0 01-2 0V6a.996.996 0 01.52-.878l1.734-.99a1 1 0 011.364.372zm8.764 0a1 1 0 011.364-.372l1.733.99A1.002 1.002 0 0118 6v2a1 1 0 11-2 0v-.277l-.254.145a1 1 0 11-.992-1.736l.23-.132-.23-.132a1 1 0 01-.372-1.364zm-7 4a1 1 0 011.364-.372L10 8.848l1.254-.716a1 1 0 11.992 1.736L11 10.58V12a1 1 0 11-2 0v-1.42l-1.246-.712a1 1 0 01-.372-1.364zM3 11a1 1 0 011 1v1.42l1.246.712a1 1 0 11-.992 1.736l-1.75-1A1 1 0 012 14v-2a1 1 0 011-1zm14 0a1 1 0 011 1v2a1 1 0 01-.504.868l-1.75 1a1 1 0 11-.992-1.736L16 13.42V12a1 1 0 011-1zm-9.618 5.504a1 1 0 011.364-.372l.254.145V16a1 1 0 112 0v.277l.254-.145a1 1 0 11.992 1.736l-1.735.992a.995.995 0 01-1.022 0l-1.735-.992a1 1 0 01-.372-1.364z"
      clipRule="evenodd"
    />
  </svg>
);

/**
 * Returns the authentic loader icon for any given loader id
 */
export const getLoaderIcon = (loaderId?: string, className = 'w-3.5 h-3.5'): React.ReactNode => {
  if (!loaderId) return <Box className={className} />;
  switch (loaderId.toLowerCase()) {
    case 'vanilla':
    case 'minecraft':
      return <VanillaIcon className={className} />;
    case 'fabric':
      return <FabricIcon className={className} />;
    case 'forge':
      return <ForgeIcon className={className} />;
    case 'neoforge':
      return <NeoForgeIcon className={className} />;
    case 'quilt':
      return <QuiltIcon className={className} />;
    case 'babric':
      return <BabricIcon className={className} />;
    case 'bta':
    case 'bta-babric':
      return <BtaIcon className={className} />;
    case 'java-agent':
      return <JavaAgentIcon className={className} />;
    case 'legacy-fabric':
      return <LegacyFabricIcon className={className} />;
    case 'liteloader':
      return <LiteLoaderIcon className={className} />;
    case 'risugami':
    case 'modloader':
      return <ModLoaderIcon className={className} />;
    case 'nilloader':
      return <NilLoaderIcon className={className} />;
    case 'ornithe':
      return <OrnitheIcon className={className} />;
    case 'rift':
      return <RiftIcon className={className} />;
    case 'optifine':
      return <OptiFineIcon className={className} />;
    case 'iris':
      return <IrisIcon className={className} />;
    default:
      return <Box className={className} />;
  }
};
