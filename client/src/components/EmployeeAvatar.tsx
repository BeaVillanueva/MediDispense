import { useEffect, useState } from "react";

export default function EmployeeAvatar({ name, imageUrl, className }: { name: string; imageUrl?: string | null; className: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [imageUrl]);
  return <div className={className}>{imageUrl && !failed ? <img className="employee-avatar-photo" src={imageUrl} alt={`${name} profile`} onError={() => setFailed(true)} /> : name.trim().split(/\s+/).slice(0, 2).map(part => part[0] ?? "").join("").toUpperCase() || "?"}</div>;
}
