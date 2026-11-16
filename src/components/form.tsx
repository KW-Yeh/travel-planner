import * as RadixSwitch from "@radix-ui/react-switch";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { useId, useState, type ReactNode } from "react";
import { Drawer } from "vaul";
import { ChevronIcon, MinusIcon, PlusIcon, WarningIcon } from "./icons";

export function Switch({ id, label, checked, onChange }: { id?: string; label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <RadixSwitch.Root id={id} className="switch" aria-label={label} checked={checked} onCheckedChange={onChange}>
      <RadixSwitch.Thumb className="switch-thumb" />
    </RadixSwitch.Root>
  );
}

type Choice<T extends string> = { value: T; label: string; icon?: ReactNode };

/** Single choice that is never empty: clicking the active item keeps it selected. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  variant = "segment",
}: {
  label: string;
  value: T;
  options: readonly Choice<T>[];
  onChange: (next: T) => void;
  variant?: "segment" | "tile";
}) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      className={variant === "tile" ? "tiles" : "segmented"}
      value={value}
      onValueChange={(next) => {
        const picked = options.find((o) => o.value === next);
        if (picked) onChange(picked.value);
      }}
    >
      {options.map((o) => (
        <ToggleGroup.Item key={o.value} value={o.value} className={variant}>
          {o.icon}
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

/** `null` means "not filled in"; stepping below `min` returns to it when `nullable`. */
export function Stepper({
  label,
  value,
  min,
  max,
  nullable = false,
  onChange,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  nullable?: boolean;
  onChange: (next: number | null) => void;
}) {
  const labelId = useId();
  const canDecrease = value !== null && (value > min || nullable);
  const canIncrease = value === null || value < max;
  return (
    <>
      <span id={labelId} className="row-label">
        {label}
      </span>
      <div className="stepper" role="group" aria-labelledby={labelId}>
        <button
          type="button"
          aria-label={`減少${label}`}
          disabled={!canDecrease}
          onClick={() => {
            if (value !== null) onChange(value > min ? value - 1 : null);
          }}
        >
          <MinusIcon size={16} />
        </button>
        <output aria-live="polite">{value ?? "—"}</output>
        <button
          type="button"
          aria-label={`增加${label}`}
          disabled={!canIncrease}
          onClick={() => {
            onChange(value === null ? min : value + 1);
          }}
        >
          <PlusIcon size={16} />
        </button>
      </div>
    </>
  );
}

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="drawer-overlay" />
        <Drawer.Content className="drawer" aria-describedby={undefined}>
          <span className="drawer-handle" aria-hidden="true" />
          <Drawer.Title className="drawer-title">{title}</Drawer.Title>
          <div className="drawer-body">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export function RowButton({ label, value, onClick }: { label: string; value: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="row row-button" aria-haspopup="dialog" onClick={onClick}>
      <span className="row-label">{label}</span>
      <span className="row-value">{value}</span>
      <span className="row-chevron">
        <ChevronIcon size={16} />
      </span>
    </button>
  );
}

type PickOption<T> = { value: T; label: string };

/** A grouped-list row that opens a bottom sheet of options; picking one closes the sheet. */
export function PickerRow<T extends string | number>({
  label,
  value,
  options,
  onChange,
  layout = "list",
  extra,
}: {
  label: string;
  value: T;
  options: readonly PickOption<T>[];
  onChange: (next: T) => void;
  layout?: "list" | "grid";
  extra?: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
  };
  const current = options.find((o) => o.value === value);
  return (
    <>
      <RowButton
        label={label}
        value={current?.label ?? ""}
        onClick={() => {
          setOpen(true);
        }}
      />
      <Sheet open={open} onOpenChange={setOpen} title={label}>
        <div role="radiogroup" aria-label={label} className={layout === "grid" ? "options grid" : "options"}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={o.value === value}
              className="option"
              onClick={() => {
                onChange(o.value);
                close();
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
        {extra?.(close)}
      </Sheet>
    </>
  );
}

export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="field-error" role="alert">
      <WarningIcon size={14} />
      {message}
    </p>
  );
}
