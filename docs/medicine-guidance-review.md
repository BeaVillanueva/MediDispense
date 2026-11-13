# Medicine guidance research and pharmacist review

Status: RESEARCH ONLY — no pharmacist approvals, schema changes, or medicine updates performed.
Database inspection and reference retrieval: 2026-11-11 (Asia/Manila).

## Medicines found (all three enabled records)

| ID | Database name / generic | Recorded strength and form | Brand identity |
|---|---|---|---|
| 1 | Paracetamol 500mg / Paracetamol | 500 mg tablet | Not recorded. Biogesic artwork is not proof of stock identity. |
| 2 | Vitamins / Refer to product label | Ingredients, strength, formulation unspecified | Not recorded |
| 3 | Cetirizine 10mg / Cetirizine Hydrochloride | 10 mg tablet | Not recorded |

The database has description, dosage_information and usage_instructions but no structured brand,
strength, formulation, source, or pharmacist approval fields. Existing dosage fields contain strength
metadata or generic packaging reminders, not reviewed dosing schedules. No records were overwritten.

## Research candidates — NEVER customer instructions until reviewed

### ID 1: Paracetamol 500 mg tablet

[NHS adult paracetamol](https://www.nhs.uk/medicines/paracetamol-for-adults/)
(page reviewed 24 March 2026): adult guidance is for ages 18+. Pain and fever relief;
500–1,000 mg per dose using 500 mg tablets, at least four hours between doses, no more
than eight 500 mg tablets (4 g) in 24 hours. A lower dose may be necessary below 50 kg.
Kidney/liver disease and heavy alcohol use require suitability review. Avoid other
paracetamol-containing products. NHS advises not using longer than three days unless
a doctor directs it. Excess ingestion requires prompt medical assessment.

[Unilab Biogesic product information](https://www.unilab.com.ph/products/biogesic)
and [manufacturer PIL](https://assets.unilab.com.ph/uploads/Common/Products/Biogesic/biogesic_tablet.pdf):
for the specific 500 mg Biogesic tablet, labeling covers ages 12+ with one or two tablets
at four-to-six-hour intervals as needed, up to 4 g in 24 hours. Liver injury, duplicate
paracetamol products, alcohol, kidney/liver disorders and warfarin need attention.
The linked PIL is dated April 2014; pharmacist must check the current supplied label.

Do not combine these sources into a blanket age range. Confirm actual brand, single-ingredient
immediate-release oral formulation, current local labeling, appropriate age scope, interval,
maximum and lower-dose exceptions before approving. Do not apply this to Bioflu or another
combination medicine, different strengths, liquids or modified-release products.

### ID 3: Cetirizine hydrochloride 10 mg tablet

[NHS dosing](https://www.nhs.uk/medicines/cetirizine/how-and-when-to-take-cetirizine/)
(page reviewed 18 February 2025): the usual dose for ages 12+ and adults is 10 mg once daily.
Kidney problems commonly require a lower dose. Tablets can be taken with or without food
and swallowed whole with a drink. Do not double a missed dose.
[NHS overview](https://www.nhs.uk/medicines/cetirizine/about-cetirizine/)
(page reviewed 17 February 2025): treats allergy symptoms; sleepiness can occur,
so avoid driving/cycling when affected.

Once daily corresponds to an approximately 24-hour schedule, not an independently established
minimum interval. Do not invent a separately sourced maximum or schedule for kidney impairment.
A pharmacist must confirm brand/label, age scope, daily limit, renal suitability, pregnancy advice,
interactions and complete precautions for the actual dispensed product. No child dosing is proposed.

### ID 2: Vitamins — identity unresolved

[NHS vitamins and minerals overview](https://www.nhs.uk/conditions/vitamins-and-minerals/)
explains that requirements and risks vary across nutrients. It is background information,
NOT a product-matched dosing reference. No safe product-specific dose, frequency or maximum
can be selected from the record. Obtain brand, manufacturer, ingredients and amounts per tablet,
formulation, intended ages, local product registration and current manufacturer label first.
Do not use a generic 'one daily' instruction or borrow another supplement's directions.

## Implementation and review boundary

The Review Purchase screen no longer uses unapproved legacy dosage_information/usage_instructions
as customer dosage instructions. It displays exactly:

> Dosage guidance is not yet available. Please consult a pharmacist before use.

The new card supports approved medicine/strength/form, purpose, age group, dose, frequency,
optional minimum interval and daily maximum, precautions and HTTPS medical source.
Only server-published approved guidance is accepted. Research notes are not bundled into the kiosk.
Description and strength metadata remain existing catalog information; they do not imply dose approval.

`database/proposals/medicine_usage_guidance.sql` is a proposal, NOT installed by setup or migrations.
It adds a separate revision table without altering medicines or operational tables.
The optional read-only catalog enrichment tolerates an absent table and returns null guidance.
No approval UI/API or automatic approval mechanism is added. Applying the schema alone enables no dose.

Before publishing, a registered pharmacist must:

1. Inspect the actual individual tablet/product, original packaging and local label; confirm identity,
   strength, formulation and brand, plus the age group and complete source-matched content.
2. Review the research, clinical exceptions and current approved labeling. Research does not confer approval.
3. Have an authorized maintainer apply the proposed schema through the normal reviewed deployment process.
4. Store a new reviewed revision with explicit text in every required field; use NULL for interval/maximum
   only when genuinely not applicable. Record identity_snapshot as JSON from
   `MedicineGuidance::identity($catalogMedicine)` (actual API medicine object, preserving types),
   product_identity_verified=1, pharmacist name/registration, approved_at and a future review_due_at.
   Only after the pharmacist signs off may approval_status be 'approved'. Never copy the sample
   research directly into approved status without this review. Use parameterized SQL through a trusted
   server-side maintenance session; do not expose an unauthenticated approval route.
5. Refresh `/api/medicines?available=1` and check the matching medicine's usageGuidance plus the kiosk card.
   Drafts/revocations, missing reviewer details, expired review dates, missing required content,
   unsafe source URLs or changed identity snapshots withhold the entire dosage card content.
6. Append a new draft or revoked revision to withdraw older approval. The latest revision always wins.
   Catalog identity changes require another review; no automatic matching by name or strength exists.

Physical labeling remains required: kiosk guidance does not replace medicine labels, pharmacist
counseling, dispensing requirements or applicable regulatory obligations. Stocking a new product
under an unchanged catalog identity must also trigger a new pharmacist review.

## Verification

Run `npm.cmd run check`, `npm.cmd test`, `npm.cmd run build`,
`C:\xampp\php\php.exe backend/tests/medicine-guidance.php` and PHP lint for the new service/API.
PHP tests use temporary tables only, including missing-table fallback and latest-revision withdrawal.
No ESP32, payment, inventory, dispensing or transaction state changes are part of this enhancement.
