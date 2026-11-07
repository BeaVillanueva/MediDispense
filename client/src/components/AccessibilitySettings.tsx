import { useEffect, useState } from "react";
import { PersonStanding, RotateCcw, X } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";

const defaults = { largeText: false, contrast: false, motion: false };
const storageKey = "medidispense-accessibility";
export default function AccessibilitySettings() {
  const [open,setOpen]=useState(false);
  const [settings,setSettings]=useState(()=>{
    try { const saved=JSON.parse(localStorage.getItem(storageKey) ?? "{}"); return {largeText:saved?.largeText===true,contrast:saved?.contrast===true,motion:saved?.motion===true}; }
    catch {return defaults;}
  });
  useEffect(()=>{
    document.documentElement.classList.toggle("a11y-large-text",settings.largeText);
    document.documentElement.classList.toggle("a11y-contrast",settings.contrast);
    document.documentElement.classList.toggle("a11y-reduced-motion",settings.motion);
    try {localStorage.setItem(storageKey,JSON.stringify(settings));}catch{/* Preferences still work for this session. */}
  },[settings]);
  return <Popover open={open} onOpenChange={setOpen} modal={false}><PopoverTrigger asChild><button className="accessibility-launcher" aria-label="Accessibility settings" title="Accessibility settings"><PersonStanding size={26}/></button></PopoverTrigger><PopoverContent side="top" align="end" sideOffset={12} collisionPadding={12} className="accessibility-panel" aria-labelledby="accessibility-title" aria-describedby="accessibility-description"><div className="accessibility-heading"><h2 id="accessibility-title">Accessibility</h2><button className="icon-button" aria-label="Close accessibility settings" onClick={()=>setOpen(false)}><X size={16}/></button></div><p id="accessibility-description" className="accessibility-description">Adjust how MediDispense appears on this device.</p><div className="accessibility-options">{[
    {key:"largeText" as const,title:"Larger text",description:"Make labels, buttons, and table text easier to read."},
    {key:"contrast" as const,title:"High contrast",description:"Use stronger text and clearer borders."},
    {key:"motion" as const,title:"Reduce motion",description:"Turn off decorative animations and transitions."},
  ].map(option=><label className="accessibility-option" key={option.key}><span><strong>{option.title}</strong><small>{option.description}</small></span><input type="checkbox" checked={settings[option.key]} onChange={event=>setSettings(value=>({...value,[option.key]:event.target.checked}))}/></label>)}<button className="secondary-button" onClick={()=>setSettings({...defaults})}><RotateCcw size={16}/> Reset settings</button><p>Your device’s reduced-motion preference is respected even after resetting.</p></div></PopoverContent></Popover>;
}
