import Base
import ./LAWS.bend as Laws

# Each def proves the law of the same name from LAWS.bend.
# `{==}` proves an equality whose two sides compute to the same term.

def Laws.agent_is_effect_free(job):
  {==}

def Laws.human_accept_resolves(job):
  {==}

def Laws.accept_is_idempotent(job):
  {==}

def Laws.orientation_monotone(job, who):
  match job:
    case Laws.Job{s, a}:
      match s:
        case Laws.Proposed{}:
          match who:
            case Laws.Human{}:
              {==}
            case Laws.Agent{}:
              {==}
        case Laws.Active{}:
          match who:
            case Laws.Human{}:
              {==}
            case Laws.Agent{}:
              {==}
        case Laws.Review{}:
          match who:
            case Laws.Human{}:
              {==}
            case Laws.Agent{}:
              {==}
        case Laws.Resolved{}:
          match who:
            case Laws.Human{}:
              {==}
            case Laws.Agent{}:
              {==}

def Laws.fuel_bound(job, who, fuel):
  match fuel:
    case 0n:
      {==}
    case 1n+p:
      match p:
        case 0n:
          {==}
        case 1n+q:
          {==}
