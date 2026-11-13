import type {ReactNode} from 'react';
import './admin-filter-toolbar.css';

/** One layout for admin searches, filters and adjacent actions. */
export default function AdminFilterToolbar({label,children}:{label:string;children:ReactNode}){
  return <div className="admin-filter-toolbar" role="group" aria-label={label}>{children}</div>;
}
