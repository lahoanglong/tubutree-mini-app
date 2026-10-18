# Traceability: spec requirement -> plan task step

The spec (`docs/superpowers/specs/2026-10-17-recycle-rewards-design.md`) was split into numbered requirements, `R<spec section>.<n>`, each with a line reference `(L<line>)` into the spec. `requirements-M<n>.md` lists the requirements owned by part M<n> (a requirement shared by several parts appears in each owner's list). `coverage-M<n>.md` has exactly one line per requirement of that list:

- `R<id> -> M<n>.<k> step <j>`: the step's test or instruction pins the requirement's exact value or behaviour.
- `R<id> -> other M<x>.<k>`: a task of another part pins it.
- `R<id> -> NOT PLANNED: <reason>`: not built in this release (non-goal, owner decision, or a process item tracked in the launch checklist).

The lists were checked mechanically (every requirement has one line, every cited task and step exists) and by independent reviewers who read each cited step against the spec text. Requirement text paraphrases the spec; the spec wins when they differ.

Scale: the requirement lists were extracted before the owner changed the Điểm Xanh scale on 2026-10-18 (1 điểm = 1đ). Every Điểm Xanh amount written in `requirements-M<n>.md` is on the old scale (1 điểm = 1.000đ): multiply it by 1000. VND amounts, quantities, drops and counts do not change. The spec and the plan are on the new scale and win; the `(L<line>)` references still point at the same spec lines.
