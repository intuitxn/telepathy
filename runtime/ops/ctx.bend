import Base

# ---- ctx.bend: the required context as one Bend equation --------------------
# The context manifest is NOT a JSON sidecar. It is this file: typed values
# (kernels, boundaries, identity) plus named laws the compiler checks. Any agent
# that reads this file knows the required set; `--check-only` proves its shape.
#
# Scope and discipline:
#   * PURE. Values are in-file. No file reads, no network, no spawn, no writes.
#     The only effect is IO.print in main.
#   * Bend cannot run the OTHER kernels' checks (no subprocess). This file
#     declares each kernel and its expected verdict; the host (make ctx) runs
#     each `bend <path> --check-only` and reconciles. That single host step is
#     the only thing outside the equation.
#   * A passing `--check-only` proves the context is well-formed; it is not
#     truth, human acceptance, or proof that each kernel is correct.

# ---- typed values -----------------------------------------------------------

# One required Bend core (a kernel) and the acceptance it must meet.
type Kernel is Data:
  Kernel{name: String, path: String, acceptance: String, required: Bool}

# One hard boundary that the system must not cross.
type Boundary is Data:
  Boundary{rule: String, mustNot: String}

# The required kernel set. Paths are checkout-relative.
def kernels() -> +List<Kernel>:
  [Kernel{"worker", "runtime/worker/system.bend", "All terms check.", True{}},
   Kernel{"adaptive", "runtime/adaptive/system.bend", "All terms check.", True{}},
   Kernel{"status", "runtime/ops/status.bend", "All terms check.", True{}},
   Kernel{"ctx", "runtime/ops/ctx.bend", "All terms check.", True{}},
   Kernel{"programs", "runtime/programs/bend-laws/PROOF.bend", "All terms check.", True{}},
   Kernel{"lorenz", "runtime/lorenz/system.bend", "All terms check.", True{}}]

def boundaries() -> +List<Boundary>:
  [Boundary{"no signing keys in the kernel process", "never load or copy a private key"},
   Boundary{"one writer per store", "never mutate a shared snapshot concurrently"},
   Boundary{"draft then owner send", "never publish or send without human review"},
   Boundary{"no subprocess in Bend", "never claim Bend spawns git or the network"}]

# ---- helpers ----------------------------------------------------------------

def text_nonblank(text: String) -> Bool:
  match text:
    case SNil{}:
      False{}
    case SCon{+h, t}:
      (Bool.not(Char.is_eq(h, ' ')) && Bool.not(Char.is_eq(h, '\t'))) || text_nonblank(t)

def kernel_well_formed(k: Kernel) -> Bool:
  match k:
    case Kernel{n, p, a, r}:
      text_nonblank(n) && text_nonblank(p) && text_nonblank(a)

def all_kernels_well_formed(+ks: +List<Kernel>) -> Bool:
  match ks:
    case Nil{}:
      True{}
    case Con{h, t}:
      kernel_well_formed(h) && all_kernels_well_formed(t)

def contains_kernel_name(+name: String, +ks: +List<Kernel>) -> Bool:
  match ks:
    case Nil{}:
      False{}
    case Con{h, t}:
      match h:
        case Kernel{n, p, a, r}:
          String.eq(name, n) || contains_kernel_name(name, t)

# Unique names: no kernel name repeats within the required set.
def names_unique(+ks: +List<Kernel>) -> Bool:
  match ks:
    case Nil{}:
      True{}
    case Con{h, t}:
      match h:
        case Kernel{n, p, a, r}:
          Bool.not(contains_kernel_name(n, t)) && names_unique(t)

def kernel_count(+ks: +List<Kernel>) -> Nat:
  match ks:
    case Nil{}:
      0n
    case Con{h, t}:
      (1n + kernel_count(t) : Nat)

def boundary_well_formed(b: Boundary) -> Bool:
  match b:
    case Boundary{rule, must}:
      text_nonblank(rule) && text_nonblank(must)

def all_boundaries_well_formed(+bs: +List<Boundary>) -> Bool:
  match bs:
    case Nil{}:
      True{}
    case Con{h, t}:
      boundary_well_formed(h) && all_boundaries_well_formed(t)

# ---- in-file fixtures -------------------------------------------------------

# The negative case a named law must reject: blank name, path and acceptance.
def malformed_kernel() -> Kernel:
  Kernel{"", "", "", True{}}

# ---- fixed-width rendering (byte-stable) -----------------------------------

def pad_amount(s: String, w: Nat) -> Nat:
  match s:
    case SNil{}:
      w
    case SCon{h, t}:
      match w:
        case 0n:
          0n
        case 1n+p:
          pad_amount(t, p)

def spaces(n: Nat) -> String:
  match n:
    case 0n:
      ""
    case 1n+p:
      " " ++ spaces(p)

def pad(+s: String, w: Nat) -> String:
  s ++ spaces(pad_amount(s, w))

def render_kernel(k: Kernel) -> String:
  match k:
    case Kernel{n, p, a, r}:
      pad(n, 12n) ++ pad(p, 40n) ++ a ++ "\n"

def render_kernels(+ks: +List<Kernel>) -> String:
  match ks:
    case Nil{}:
      ""
    case Con{h, t}:
      render_kernel(h) ++ render_kernels(t)

def render_boundary(b: Boundary) -> String:
  match b:
    case Boundary{rule, must}:
      pad(rule, 42n) ++ must ++ "\n"

def render_boundaries(+bs: +List<Boundary>) -> String:
  match bs:
    case Nil{}:
      ""
    case Con{h, t}:
      render_boundary(h) ++ render_boundaries(t)

# ---- named laws (checked by `bend ... --check-only`) ------------------------

law ctx_kernels_well_formed:
  {all_kernels_well_formed(kernels()) == True{} : Bool}

def ctx_kernels_well_formed():
  {==}

law ctx_kernel_names_unique:
  {names_unique(kernels()) == True{} : Bool}

def ctx_kernel_names_unique():
  {==}

law ctx_boundaries_well_formed:
  {all_boundaries_well_formed(boundaries()) == True{} : Bool}

def ctx_boundaries_well_formed():
  {==}

# The required set is fixed at six kernels.
law ctx_required_total:
  {kernel_count(kernels()) == 6n : Nat}

def ctx_required_total():
  {==}

# Negative case: the malformed kernel is rejected.
law ctx_malformed_rejected:
  {kernel_well_formed(malformed_kernel()) == False{} : Bool}

def ctx_malformed_rejected():
  {==}

# ---- one fixture run --------------------------------------------------------

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("context: checkout resolved via ~/.config/opencode/commands/meta.md; reviewer Shubham; bend 2.0.21")
    IO.print(pad("kernel", 12n) ++ pad("path", 40n) ++ "acceptance")
    IO.print(render_kernels(kernels()))
    IO.print(pad("boundary", 42n) ++ "must not")
    IO.print(render_boundaries(boundaries()))
    IO.print("kernels_well_formed: " ++ Bool.show(all_kernels_well_formed(kernels())))
    IO.print("names_unique: " ++ Bool.show(names_unique(kernels())))
    IO.print("required_total: " ++ Nat.show(kernel_count(kernels())))
    IO.print("malformed_rejected: " ++ Bool.show(Bool.not(kernel_well_formed(malformed_kernel()))))
