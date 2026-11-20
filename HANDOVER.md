# FORMGRID Factory + Design Build — session handover

Written 2026-11-20. Repo `sid11o4/offcut-ledger` (React + Vite + Tailwind + TanStack Query). Backend is Supabase project `hawypgqheoddtoiefwls` (Postgres, RLS, SECURITY DEFINER functions, edge functions). `main` is current through PR #70 (merge commit `65aac74`). No PR is open.

## 1. Working rules the user has set

- Develop on branch `claude/formgrid-factory-webapp-58qa8f`. Push there and open a **draft** PR, then subscribe to its activity.
- **Merge only when the user types "MERGE TO MAIN"** (per PR). Then: mark the PR ready, merge with `merge_method: merge` and `expectedHeadSha` set to the verified full head SHA, then reset the branch to `origin/main` and push it (force-with-lease is fine once the history is merged).
- **"Redeploy main"** means an empty commit pushed straight to main.
- Migrations are applied live with `mcp__Supabase__apply_migration` AND mirrored as files in `supabase/migrations/` (current latest: `0138`). `execute_sql` returns only the last statement's result.
- You cannot run DB functions that need an authenticated user (e.g. `record_inventory_transaction` calls `is_active_user()`). Never impersonate users. The user clicks the buttons in the app.
- This is a cloud session: no Claude-in-Chrome. Previews: Vercel branch preview `https://offcut-ledger-96tz-git-claude-formgrid-f3f9c0-sid11o4s-projects.vercel.app`; Hostinger preview URL changes per PR (last: `entire-mediumslateblue-ibis-53.hostingersite.com`). Both use the same live DB.
- Confirm before hard-to-reverse or outward-facing actions unless the user explicitly asked. Report outcomes faithfully.
- Use the user's pronouns neutrally (they/them).

## 2. Key ids

| Thing | Id |
|---|---|
| Supabase project | `hawypgqheoddtoiefwls` |
| B2 design project (DP-152F2D) | `b4cc1629-0396-4964-8642-46a49027a02c` |
| C1 design project (DP-A73E8B) | `335da21f-1611-43a4-bcbe-e0c2efe0b1a0` |
| FEVICOL job-work service | `65c836f7-5990-4bc0-8bc7-40d723ff2eb6` |
| FEVICOL process | `629ce45a-89da-46c4-a568-0ae068fc8ce8` |

## 3. Data model essentials

**Inventory ledger**: `inventory_transactions`, `inventory_stock`, `inventory_lots`, `inventory_lot_draws`, `record_inventory_transaction` (outflows raise "Not enough stock" except reversal notes / manual_slip consumption), `apply_lot_movement` (sets the lot's `vendor_bill_id` from `reference_id` when `reference_type='supplier_bill'`, so a deleted bill id violates the FK). `inventory_transactions.reference_type` is one of `supplier_bill`, `manual_slip`, `internal_order`, `adjustment`. Other helpers: `reverse_inventory_transaction`, `bill_location_for(project)`, `ensure_inventory_item` (with aliases), `merge_inventory_item(from, into)`, `inventory_item_aliases`.

**Vendor bills**: per-line `design_project_id`, `company_level`, `consumed_directly`, `returned_qty` on `supplier_bill_items`. A bill with no project = company. Bills carry a `credit`-mode payable payment row created at scan. `approve_supplier_bill` posts each line to `bill_location_for(...)`; `consumed_directly` lines are not posted to stock. `reopen_supplier_bill`, void and delete reverse only the *net* (after returns) — see 0134. Edge function `extract-supplier-bill-scan` (v20) reads per-line discount % and tax-exclusive rates. `match-bank-payments` edge function matches statement debits to RTGS/NEFT payments (UTR, then Claude reads the payee, then amount >=95%).

**Payments**: `record_vendor_payment`, `vendor_open_balance`, `vendor_bill_open_amount`, `confirm_payment_without_statement(id, reason, utr)`, `link_statement_to_confirmed_payments`, `set_payment_utr`, `supplier_payment_reversals` / `reverse_supplier_payment`.

**Costs without touching stock** (for work done before inventory opened):
- `past_material_consumption` (design_project_id, item_id, quantity, unit_cost, total_cost generated, consumed_on, note, voided).
- `design_build_expenses` (expense_date, category_id, amount, description, design_project_id, source 'manual', notes, status 'active'). Categories need `code` and `name`: Labour, Transport, Consumables, Miscellaneous, False Ceiling (`FALSE_CEILING`).
- `inventory_items.category` check allows only: `Edgeband`, `Hardware`, `Others`, `Raw Boards`, `Skins`.
- Hardware bought from plywood shops is a pseudo item "Hardware - Aruna Plywood" / "Hardware - Balaji Plywood" (qty 1, `track_as_inventory=false`, category Hardware). Items are matched by `inventory_name_key`.

**Cost breakdown**: `design_build_cost_breakdown(project)` returns (project, grp, subgrp, amount). Groups: Labour / Materials (Raw Board, Edgeband, Skin, Adhesives, Hardware, Others) / Factory Job Work / Transport / False Ceiling / Miscellaneous. `design_cost_group_of_expense` maps categories to groups. `design_project_spend` is the single source for "Spent".

**Job work and billing**: `job_work_services` (`FEVICOL`, `Pasting`, composites), `rates` (per service x rate category; the `rates_before_insert` trigger blocks inserting a new rate with an earlier start — past rates are corrected by editing rows directly), `job_work_entries` -> `job_work_entry_components` (`component_quantity` already includes the multiplier; `amount = component_quantity * rate_value`) -> `bill_items` -> `bills` (`subtotal`, `tax_amount = round(subtotal*tax_percent/100, 2)`, `grand_total = subtotal + tax_amount + adjustments`). Composite pasting cost reads `composite_pasting_rate()` live (Pasting + FEVICOL, Design Build Order rates).

## 4. What was done this session (all merged to main, all migrations live)

PRs #56–#70, in themes:
- Per-line project / company-level / consumed-directly on vendor bills; "Consume all" / "All to inventory" buttons; bill audit queue with Approved bills list + Edit (reopen).
- Materials-consumed reports are project-wise; the 8 spend tiles; False Ceiling as its own group.
- Record a payment without a FORMGRID bill; approve payment without a statement (RTGS/NEFT) with manual UTR; Reverse payment; void/delete bill that releases stock history.
- Merge inventory items (a small Merge button per row, in company and project inventories); cancel return; change return items; return from a bill's items; cancel transfer.
- Stock reversed twice on reopen/void was fixed (0134) with `over_reversed_bill_stock` / `repair_over_reversed_bill_stock` and a **Repair stock** banner (`src/components/StockRepairBanner.jsx`, shown on Company Inventory and each project inventory page). Repair corrections post as `reference_type='adjustment'`, notes `Correction:%` (0135).
- C1 past costs loaded (0122). **B2 past costs loaded (0136)**: edgeband rows 15–24 (₹21,061.58), Fevicol Hi-per 50kg ₹17,170 (category Others), hardware ₹83,647 (Aruna 2,587 + 19,214 [handwritten correction of 26,152] + 658 + 2,466, plus the itemised Splendour Solutions hardware ₹58,722, all paid), false ceiling ₹86,000, labour (Arun) ₹147,500, transport ₹2,500. Nothing consumed from stock.
- **FEVICOL job-work rate is ₹150** (0137 set 200, 0138 corrected to 150) on all three rate categories, every entry component (58), entry totals, bill items and issued bills (24 bills; 1 already paid, so that client is now over-paid). Old values are in `fevicol_rate_change_backup` (kinds `rate/component/entry/bill_item/bill` = pre-200 values at 256; `v2_*` = values at 200).

## 5. Open items (priority order)

1. **User must click Repair stock** (Design Build -> Company Inventory, `/design-build/inventory`; banner at the top, only shown if something needs repair). Afterwards re-check all stock balances for negatives. Last known state: Company shorts were gone; only old C1 negatives were OST -5, 4MM MDF -2, 4MM HDHMR -2.
2. **"Returns are collapsed"**: the user said they changed the 450mm tandem return from 21 to 12 and "it is totally collapsed". DB checks were consistent (RTN-0007: slip total 65,396.28, 10 lines, `returned_qty` matches, 450mm 9 in stock at C1). The user was asked for a screenshot and has not sent one. Do not guess; ask again.
3. **B2 boards differ from the sheet** (user has not said to fix): 16mm HDHMR loaded ₹29,920 vs sheet ₹31,680 (rate 2,720 vs 2,880); 107 FWN loaded ₹11,750 vs sheet ₹13,250. Offer "fix both" (update `past_material_consumption` unit_cost for those rows).
4. Record opening-stock purchases on C1: 4MM HDHMR 2 sheets @ ₹864, 4MM MDF 2 sheets @ ₹550, OST (rate unknown, ask).
5. The user must delete the deployed edge function `extract-edgeband-scan` in the Supabase dashboard.
6. Undecided: should the >=95% AI auto-match in `match-bank-payments` ask for confirmation instead of confirming silently.
7. Possible follow-up on FEVICOL: the user may have meant the purchased Fevicol materials (Heatx 5 ltr, Hi-per 50kg) rather than the job-work rate. They were not touched; the job-work rate is what was changed. Confirm if the user raises it.

## 6. Gotchas learned

- Patching live function definitions: `pg_get_functiondef` + `replace` inside DO blocks; markers must match the live text.
- Reusing a deleted bill's id as `reference_id` on `supplier_bill` transactions breaks the lot FK; use `adjustment`.
- `inventory_items.category` check (see section 3) rejects "Adhesives" — use "Others".
- Vercel and Hostinger bots comment on every PR; those events need no action.
- Task-list reminders in the harness are noise; the task list is all completed.

## 7. Frontend map

`src/components/ProjectSpendTiles.jsx`, `src/pages/DesignBuild/ProjectDashboard.jsx`, `src/pages/DesignBuild/CompanyInventory.jsx`, `src/pages/DesignBuild/SupplierReturns.jsx`, `src/pages/DesignBuild/MaterialSources.jsx`, `src/pages/DesignBuild/DesignReports.jsx`, `src/pages/DesignBuild/ProjectReport.jsx`, `src/pages/DesignBuild/CompositeModal.jsx`, `src/pages/Accounts/BillAuditQueue.jsx`, `src/pages/Accounts/RtgsPayments.jsx`, `src/components/{MergeItemsModal,ReturnFromBillCard,ChangeReturnModal,RecentTransfers,StockRepairBanner,RecordPaymentModal}.jsx`, `src/lib/{costGroups,projectSpend,designReportData,directConsumption,projectCeoData,bankMatch}.js`. Tailwind tokens in use: card, btn-primary/secondary/ghost, table-base, field-input, tnum, `bg-pill-warn-bg`; `ui.jsx` exports Card, Field, Input, Select, Badge, EmptyState, LoadingBlock, PageHeader, StatCard.

## 8. Full prior transcript

`/root/.claude/projects/-home-user-offcut-ledger/cbe2fa02-5258-527a-a209-b69abf8a5400.jsonl` (this machine only).
