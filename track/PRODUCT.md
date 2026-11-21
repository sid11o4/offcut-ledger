# FORMGRID Track — product

**Register:** product (operate). A task tool used on site and in the office.

**Users**
- Site team: on a construction site, often outdoors in sun, one hand, gloves, patchy network. They
  start the day, update task progress, log labour and materials, take photos, close the day, and
  ask for material.
- Track admins: set up projects, rooms, BOQ and task categories; read reports; decide material
  requests; manage who has access.
- Factory staff (factory.formgrid.in): read-only. They see how far a project is from the factory
  dashboard; they never edit Track data.

**Purpose:** a project's weighted progress (rooms -> BOQ items -> task checklists) is always one
glance away, every day has a start and an end-of-day report, and site can request material from the
live factory inventory or from outside it.

**Principles**
1. Legible outdoors: light, high contrast, large touch targets, numbers in tabular figures.
2. One accent (brand blue) on the main data element only; otherwise achromatic ledger chrome that
   matches the factory app.
3. The progress maths is unchanged from the previous tracker (see src/lib/progress.js).
4. Never lose a day's work: edits save as they are made and failures are visible, not silent.
5. Read-only means read-only for factory: enforced in the database, not in the UI.
