import type { Medicine } from "@shared/medidispense";
import { medicineLabelDetails, USAGE_FALLBACK } from "@/lib/medicineInformation";

export function MedicineUsageGuide({ name, medicine }: { name: string; medicine?: Medicine }) {
  const { strength } = medicineLabelDetails(medicine);
  return (
    <section className="kv-usage-guide" aria-labelledby="medicine-usage-title">
      <h2 id="medicine-usage-title">Medicine Usage Guide</h2>
      <div className="kv-usage-scroll" role="region" aria-label="Medicine usage information" tabIndex={0}>
        <dl>
          <div><dt>Medicine</dt><dd>{name}{strength && !name.toLowerCase().replace(/\s/g, "").includes(strength.toLowerCase().replace(/\s/g, "")) ? ` · ${strength}` : ""}</dd></div>
          <div><dt>Purpose</dt><dd>Verified purpose information is not available. Refer to the medicine packaging.</dd></div>
          <div><dt>Dosage &amp; when to take</dt><dd>{USAGE_FALLBACK}</dd></div>
          <div><dt>Precautions</dt><dd>Verified precautions are not available. Check the medicine packaging or ask a pharmacist.</dd></div>
          <div><dt>Storage</dt><dd>Verified storage instructions are not available. Refer to the storage directions on the packaging.</dd></div>
        </dl>
        <p className="kv-usage-important"><strong>Important:</strong> Follow the medicine label and advice from a qualified healthcare professional.</p>
      </div>
    </section>
  );
}
