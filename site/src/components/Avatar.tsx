import type { Person } from '../types'

interface AvatarProps {
  person: Person
  size?: 'small' | 'medium' | 'large'
}

export function Avatar({ person, size = 'medium' }: AvatarProps) {
  return (
    <span
      aria-label={person.name}
      className={`avatar avatar--${size} avatar--${person.id}`}
      role="img"
      title={person.name}
    >
      {person.initials}
    </span>
  )
}
