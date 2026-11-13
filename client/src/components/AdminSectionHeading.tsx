import type {LucideIcon} from 'lucide-react';
import './admin-records.css';

export default function AdminSectionHeading({icon:Icon,title,description,tone='blue'}:{icon:LucideIcon;title:string;description:string;tone?:'blue'|'mint'|'amber'|'lavender'}){
  return <header className={`admin-section-heading admin-section-${tone}`}><div className="admin-section-icon" aria-hidden="true"><Icon size={25}/></div><div><h2>{title}</h2><p>{description}</p></div></header>;
}
