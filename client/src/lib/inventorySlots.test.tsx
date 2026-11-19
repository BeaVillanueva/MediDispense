import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  cells: [] as any[],
  refs: [] as any[],
  state: 0,
  ref: 0,
  options: null as any,
  begin: vi.fn(),
  complete: vi.fn(),
  refresh: vi.fn(),
  change: vi.fn(),
  close: vi.fn(),
  data: null as any,
}));
vi.mock("react", async original => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: any) => {
    const i = h.state++;
    if (!(i in h.cells))
      h.cells[i] = typeof initial === "function" ? initial() : initial;
    return [
      h.cells[i],
      (next: any) => {
        h.cells[i] = typeof next === "function" ? next(h.cells[i]) : next;
      },
    ];
  },
  useRef: (value: any) =>
    h.refs[h.ref++] ?? (h.refs[h.ref - 1] = { current: value }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ invalidate: h.refresh }),
    inventory: {
      slots: {
        useQuery: () => ({
          data: h.data,
          refetch: h.refresh,
          isPending: false,
        }),
      },
      begin: {
        useMutation: (options: any) => {
          h.options = options;
          return { mutate: h.begin, isPending: false };
        },
      },
      complete: {
        useMutation: () => ({ mutate: h.complete, isPending: false }),
      },
      restock: {
        useMutation: () => ({ mutate: h.complete, isPending: false }),
      },
    },
    medicines: {
      options: { useQuery: () => ({ data: { categories: ["Test"] } }) },
    },
  },
}));
import { InventorySlots } from "@/components/InventorySlots";
import { RestockDialog } from "@/components/RestockDialog";
import type { Medicine } from "@shared/medidispense";
const restockMedicine={id:1,name:'Test medicine',slotNumber:1,stockQuantity:5,expiryDate:'2035-01-01'} as Medicine;
function renderRestock(){h.state=0;h.ref=0;return RestockDialog({medicine:restockMedicine,onClose:h.close,onChanged:h.change});}
function enterRestock(value:string){all(renderRestock(),n=>n.props?.id==='restock-quantity')[0].props.onChange({target:{value}});return renderRestock();}
function submitRestock(tree:any){all(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault:vi.fn()});}
function all(node: any, predicate: (n: any) => boolean): any[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(n => all(n, predicate));
  return [
    ...(predicate(node) ? [node] : []),
    ...all(node.props?.children, predicate),
  ];
}
function render(canManage = true) {
  h.state = 0;
  h.ref = 0;
  return InventorySlots({
    canManage,
    selection: { action: "replace", slot: 1 },
    onSelect: vi.fn(),
    onClose: h.close,
    onChanged: h.change,
  });
}
beforeEach(() => {
  h.cells = [];
  h.refs = [];
  h.state = 0;
  h.ref = 0;
  vi.clearAllMocks();
  h.data = {
    operation: null,
    slots: [
      {
        id: 1,
        slot_number: 1,
        medicine_id: 1,
        name: "Test medicine",
        quantity: 0,
        reserved_quantity: 0,
        minimum_stock_level: 3,
        assignment_status: "OCCUPIED",
      },
    ],
  };
});
it('blocks missing, fractional, negative and over-capacity quantities before starting maintenance',()=>{
  for(const value of ['', '0','-1','1.5','6']){
    const tree=enterRestock(value);
    expect(all(tree,n=>n.type==='button'&&n.props.children==='Continue')[0].props.disabled).toBe(true);
    submitRestock(tree);
  }
  expect(h.begin).not.toHaveBeenCalled();expect(h.complete).not.toHaveBeenCalled();
});
it('previews the total and starts only one guarded operation, without recording stock',()=>{
  const tree=enterRestock('3');
  expect(all(tree,n=>n.type==='strong'&&Array.isArray(n.props.children)&&n.props.children[0]===8)).toHaveLength(1);
  submitRestock(tree);submitRestock(tree);
  expect(h.begin).toHaveBeenCalledOnce();expect(h.complete).not.toHaveBeenCalled();
});
it('resumes a saved pause without prechecking physical confirmations or starting another operation',()=>{
  h.data.operation={request_key:'c'.repeat(32),action:'restock',status:'active',old_medicine_id:1,slot_number:1};
  const tree=enterRestock('2');submitRestock(tree);
  expect(h.begin).not.toHaveBeenCalled();expect(h.complete).not.toHaveBeenCalled();
  expect(all(tree,n=>n.type==='fieldset')[0].props.disabled).toBe(true);
  expect(all(tree,n=>n.type==='input'&&n.props.type==='checkbox').every(n=>!n.props.checked)).toBe(true);
});
it("checks backend safety before showing the physical stock form", () => {
  let tree = render();
  const form = all(tree, n => n.type === "form")[0];
  form.props.onSubmit({ preventDefault: vi.fn() });
  form.props.onSubmit({ preventDefault: vi.fn() });
  expect(h.begin).toHaveBeenCalledOnce();
  expect(h.begin.mock.calls[0][0]).toMatchObject({
    slot_number: 1,
    action: "replace",
  });
  expect(h.complete).not.toHaveBeenCalled();
  h.options.onSuccess({
    request_key: "a".repeat(32),
    action: "replace",
    status: "active",
    slot_number: 1,
    old_medicine_id: 1,
    old_name: "Test medicine",
    old_quantity: 0,
  });
  h.options.onSettled();
  tree = render();
  expect(
    all(tree, n => n.type === "input" && n.props.type === "checkbox").every(
      n => n.props.checked === false
    )
  ).toBe(true);
  expect(
    all(
      tree,
      n =>
        n.type === "button" &&
        n.props.children === "Confirm physical stock change"
    )[0].props.disabled
  ).toBe(true);
  expect(
    all(tree, n => n.type === "input" && n.props.value === "").length
  ).toBeGreaterThan(3);
});
it("preserves blocked maintenance when the dialog closes, allowing resume", () => {
  h.data.operation = {
    request_key: "b".repeat(32),
    action: "remove",
    status: "active",
    slot_number: 1,
    old_medicine_id: 1,
    old_name: "Test medicine",
    old_quantity: 0,
  };
  const tree = render();
  all(
    tree,
    n => n.type === "button" && n.props.children === "Close · resume later"
  )[0].props.onClick();
  expect(h.close).toHaveBeenCalledOnce();
  expect(h.complete).not.toHaveBeenCalled();
  expect(h.begin).not.toHaveBeenCalled();
  expect(h.data.operation.status).toBe("active");
});
it("does not expose slot-changing controls to view-only staff", () => {
  const tree = render(false);
  expect(all(tree, n => n.type === "form")).toHaveLength(0);
  expect(
    all(
      tree,
      n => n.type === "button" && n.props.children === "Replace medicine"
    )
  ).toHaveLength(0);
});
it('removes duplicate slot cards while retaining the record-triggered maintenance dialog',()=>{
  const tree=render();
  expect(all(tree,n=>n.props?.className==='physical-slot-grid')).toHaveLength(0);
  expect(all(tree,n=>n.props?.className==='physical-slot-card')).toHaveLength(0);
  expect(all(tree,n=>n.type==='h2'&&n.props.children==='Three slots, one medicine each')).toHaveLength(0);
  expect(all(tree,n=>n.type==='form')).toHaveLength(1);
});
it("pauses purchases before restocking and never assumes loaded quantity or physical confirmations", () => {
  const medicine = {
    id: 1,
    name: "Test medicine",
    slotNumber: 1,
    stockQuantity: 5,
    expiryDate: "2035-01-01",
  } as Medicine;
  let first = RestockDialog({
    medicine,
    onClose: h.close,
    onChanged: h.change,
  });
  all(first,n=>n.props?.id==='restock-quantity')[0].props.onChange({target:{value:'2'}});
  h.state=0;h.ref=0;
  first=RestockDialog({medicine,onClose:h.close,onChanged:h.change});
  all(first, n => n.type === "form")[0].props.onSubmit({
    preventDefault: vi.fn(),
  });
  expect(h.begin.mock.calls[0][0]).toMatchObject({
    action: "restock",
    slot_number: 1,
  });
  expect(h.complete).not.toHaveBeenCalled();
  h.options.onSuccess({
    request_key: "c".repeat(32),
    action: "restock",
    old_medicine_id: 1,
    status: "active",
    slot_number: 1,
  });
  h.options.onSettled();
  h.state = 0;
  h.ref = 0;
  const second = RestockDialog({
    medicine,
    onClose: h.close,
    onChanged: h.change,
  });
  expect(
    all(
      second,
      n => n.type === "button" && n.props.children === "Confirm added stock"
    )[0].props.disabled
  ).toBe(true);
  expect(
    all(second, n => n.type === "input" && n.props.type === "checkbox").every(
      n => n.props.checked === false
    )
  ).toBe(true);
  expect(
    all(second, n => n.type === "input" && n.props.inputMode === "numeric")[0]
      .props.value
  ).toBe("2");
});
it("keeps the stock stepper within capacity and does not submit while changing quantity", () => {
  let tree=renderRestock();
  const button=(label:string)=>all(tree,n=>n.type==='button'&&n.props['aria-label']===label)[0];
  expect(button('Decrease tablets to add').props.disabled).toBe(true);
  button('Increase tablets to add').props.onClick();
  tree=renderRestock();
  expect(all(tree,n=>n.props?.id==='restock-quantity')[0].props.value).toBe('1');
  expect(button('Decrease tablets to add').props.disabled).toBe(true);
  for(let i=0;i<4;i++){button('Increase tablets to add').props.onClick();tree=renderRestock();}
  expect(all(tree,n=>n.props?.id==='restock-quantity')[0].props.value).toBe('5');
  expect(button('Increase tablets to add').props.disabled).toBe(true);
  button('Decrease tablets to add').props.onClick();tree=renderRestock();
  expect(all(tree,n=>n.props?.id==='restock-quantity')[0].props.value).toBe('4');
  expect(h.begin).not.toHaveBeenCalled();expect(h.complete).not.toHaveBeenCalled();
});
it("retains invalid quantity validation rather than letting the stepper submit an over-capacity value", () => {
  const tree=enterRestock('6');
  expect(all(tree,n=>n.props?.id==='restock-quantity')[0].props['aria-invalid']).toBe(true);
  expect(all(tree,n=>n.type==='button'&&n.props['aria-label']==='Increase tablets to add')[0].props.disabled).toBe(true);
  submitRestock(tree);
  expect(h.begin).not.toHaveBeenCalled();expect(h.complete).not.toHaveBeenCalled();
});
it("requires the loaded quantity to be reconfirmed when it changes through the stepper", () => {
  h.data.operation={request_key:'c'.repeat(32),action:'restock',status:'active',old_medicine_id:1,slot_number:1};
  let tree=enterRestock('2');
  for(const key of ['poweredOff','stopped','coins','loaded','sameExpiry']){
    // Checkbox order follows the existing isolation and physical loading confirmations.
    const index=['poweredOff','stopped','coins','loaded','sameExpiry'].indexOf(key);
    all(tree,n=>n.type==='input'&&n.props.type==='checkbox')[index].props.onChange({target:{checked:true}});
    tree=renderRestock();
  }
  expect(all(tree,n=>n.type==='button'&&n.props.children==='Confirm added stock')[0].props.disabled).toBe(false);
  all(tree,n=>n.type==='button'&&n.props['aria-label']==='Increase tablets to add')[0].props.onClick();tree=renderRestock();
  expect(all(tree,n=>n.type==='input'&&n.props.type==='checkbox')[3].props.checked).toBe(false);
  expect(all(tree,n=>n.type==='button'&&n.props.children==='Confirm added stock')[0].props.disabled).toBe(true);
  expect(h.complete).not.toHaveBeenCalled();
});
