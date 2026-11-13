import type { Medicine } from "@shared/medidispense";

export const DOSAGE_UNAVAILABLE = "Dosage guidance is not yet available. Please consult a pharmacist before use.";

export function MedicineDosageCard({ medicine }: { medicine: Medicine }) {
  const guidance = medicine.usageGuidance;
  const approved = guidance?.approvalStatus === "approved";
  return <section className="kv-dosage-card" aria-labelledby="dosage-card-title">
    <h2 id="dosage-card-title">Dosage &amp; Usage Guidelines</h2>
    {approved ? <>
      <span className="kv-guidance-status">Pharmacist reviewed</span>
      <dl className="kv-dosage-grid">
        <div><dt>Strength &amp; formulation</dt><dd>{guidance.strength} · {guidance.formulation}</dd></div>
        <div><dt>Used for</dt><dd>{guidance.purpose}</dd></div>
        <div><dt>Applicable age group</dt><dd>{guidance.ageGroup}</dd></div>
        <div><dt>Recommended dose</dt><dd>{guidance.dose}</dd></div>
        <div><dt>How often</dt><dd>{guidance.frequency}</dd></div>
        {guidance.minimumInterval && <div><dt>Minimum interval</dt><dd>{guidance.minimumInterval}</dd></div>}
        {guidance.maximumDailyDose && <div><dt>Maximum daily dose</dt><dd>{guidance.maximumDailyDose}</dd></div>}
        <div className="kv-dosage-precautions"><dt>Important precautions</dt><dd>{guidance.precautions}</dd></div>
      </dl>
      <p className="kv-dosage-source">Medical reference: <a href={guidance.sourceUrl.startsWith("https://") ? guidance.sourceUrl : undefined} target="_blank" rel="noopener noreferrer">{guidance.sourceLabel}</a></p>
    </> : <p className="kv-dosage-fallback" role="status">{DOSAGE_UNAVAILABLE}</p>}
    <p className="kv-guideline-note">Individual tablets must still be supplied with appropriate medicine labeling. Kiosk guidance does not replace the label or advice from a pharmacist.</p>
  </section>;
}
