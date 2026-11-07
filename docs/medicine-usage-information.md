# Kiosk medicine information

The existing `medicines` schema provides `name`, `description`, `dosage_information`,
`usage_instructions`, category, image, and unit price. The kiosk API maps these to
the existing Medicine interface. No verification status, reviewer, strength,
medicine form, frequency, precautions, or storage columns currently exist in the
checked-in schema. This enhancement does not migrate or update the database.

Review shows catalog metadata. Strength/form are displayed only when explicitly
present in the stored name, dosage label, or description; they are not dosing advice.
Missing strength uses a packaging fallback; missing form is omitted.

The success guide uses the transaction's medicine name. Catalog metadata is
matched by both medicine ID and name to avoid using a renamed product's details
for a recovered purchase. It requires successful payment, completed dispensing,
and the exact requested quantity confirmed. Existing catalog description, dosage,
and usage strings have no review provenance and are therefore not displayed as
verified instructions. Every missing usage field has an explicit fallback.

## Proposed extension (not applied)

Before displaying clinical instructions, add reviewed medicine-specific content:
`medicine_strength`, `medicine_type`, `intake_frequency`, `usage_precautions`,
`storage_instructions`, `instructions_verified`, `instructions_reviewed_by`, and
`instructions_reviewed_at`. Reuse description and dosage/usage columns where
appropriate. Review must cover purpose, dose, timing, precautions, and storage;
default verification to false and invalidate it when content changes. Preserve
the existing transaction-item snapshots and payment/dispense contracts.

This requires a separate reviewed migration, API mapping, staff editing and review
workflow, and content provenance checks before enabling verified instructions.
Do not enable instructions by inferring a dose from a medicine name.

The existing 20-second success reset and collection action are unchanged. The
guide scrolls independently and the collection control remains outside it.
