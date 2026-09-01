import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
      {...props}
    >
      {children}
    </svg>
  )
}

export function NowIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 5.5h16M4 12h11M4 18.5h7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </IconBase>
  )
}

export function PeopleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM16 11a3.2 3.2 0 0 0 0-6.2M17.5 14.7a4 4 0 0 1 3.5 4V20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </IconBase>
  )
}

export function ChangelogIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M7 4h13M7 12h13M7 20h13M3.5 4h.01M3.5 12h.01M3.5 20h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </IconBase>
  )
}

export function SunIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </IconBase>
  )
}

export function MoonIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8 8.5 8.5 0 1 0 20.2 15.1Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
    </IconBase>
  )
}

export function PinIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m8 3 8 2-2.2 4.2 3 3-4 2.1L9 20l.7-6.6L6 10.7l3.6-2.6L8 3Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
    </IconBase>
  )
}

export function ReplyIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 8 4 12l5 4v-3h4.5c3 0 5 1.3 6.5 4-1-5-3.5-8-6.5-8H9V8Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </IconBase>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m5 12.5 4.2 4L19 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </IconBase>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </IconBase>
  )
}

export function ArrowIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 12h14M14 7l5 5-5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </IconBase>
  )
}

export function ResetIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4.5 9A8 8 0 1 1 4 14M4.5 9V4.5M4.5 9H9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </IconBase>
  )
}
