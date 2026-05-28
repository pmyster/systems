/**
 * Low-level field primitives shared across the AttributeForm tree.
 *
 * Every field is a pure controlled component — value in, change out.
 * No internal state. The form's source of truth is the `unit` prop
 * passed into AttributeForm; these are the leaf bindings.
 *
 * Keep these terse — they're rendered hundreds of times across the
 * sub-sections.
 */

import type { ChangeEvent, ReactNode } from "react";

import { humanizeEnum } from "../../lib/enums";
import styles from "./AttributeForm.module.css";

// ---------------------------------------------------------------------------
// TextField — string input.
// ---------------------------------------------------------------------------

interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly placeholder?: string;
  readonly help?: string;
  readonly readOnly?: boolean;
}

export function TextField(props: TextFieldProps): ReactNode {
  const { label, value, onChange, placeholder, help, readOnly } = props;
  return (
    <div className={styles.row}>
      <label className={styles.label}>{label}</label>
      <div>
        <input
          className={styles.input}
          type="text"
          value={value}
          placeholder={placeholder}
          readOnly={readOnly}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        />
        {help ? <div className={styles.help}>{help}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TextAreaField — multi-line string input.
// ---------------------------------------------------------------------------

interface TextAreaFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly placeholder?: string;
  readonly rows?: number;
}

export function TextAreaField(props: TextAreaFieldProps): ReactNode {
  const { label, value, onChange, placeholder, rows } = props;
  return (
    <div className={styles.row}>
      <label className={styles.label}>{label}</label>
      <textarea
        className={styles.textarea}
        value={value}
        rows={rows ?? 2}
        placeholder={placeholder}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// NumberField — numeric input with unit suffix.
//
// Stores the value as a number. Empty string is normalized to 0 so the
// schema (which requires numbers) is never fed `NaN`.
// ---------------------------------------------------------------------------

interface NumberFieldProps {
  readonly label: string;
  readonly value: number | undefined;
  readonly onChange: (next: number) => void;
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly help?: string;
  readonly readOnly?: boolean;
  readonly placeholder?: string;
}

export function NumberField(props: NumberFieldProps): ReactNode {
  const { label, value, onChange, unit, min, max, step, help, readOnly, placeholder } = props;
  return (
    <div className={styles.row}>
      <label className={styles.label}>
        {label}
        {unit ? <span className={styles.unit}>({unit})</span> : null}
      </label>
      <div>
        <input
          className={styles.input}
          type="number"
          value={value ?? ""}
          {...(min !== undefined ? { min } : {})}
          {...(max !== undefined ? { max } : {})}
          {...(step !== undefined ? { step } : {})}
          {...(placeholder !== undefined ? { placeholder } : {})}
          readOnly={readOnly}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(0);
              return;
            }
            const n = Number.parseFloat(raw);
            onChange(Number.isFinite(n) ? n : 0);
          }}
        />
        {help ? <div className={styles.help}>{help}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SelectField — single-choice dropdown over a closed string-literal union.
//
// The generic parameter T is the union; `options` is the runtime list.
// The value prop accepts T | undefined so the caller can render a
// not-yet-set state (renders the first option as default).
// ---------------------------------------------------------------------------

interface SelectFieldProps<T extends string> {
  readonly label: string;
  readonly value: T | undefined;
  readonly options: readonly T[];
  readonly onChange: (next: T) => void;
  readonly help?: string;
  readonly labelFn?: (opt: T) => string;
}

export function SelectField<T extends string>(props: SelectFieldProps<T>): ReactNode {
  const { label, value, options, onChange, help, labelFn } = props;
  const display = labelFn ?? humanizeEnum;
  return (
    <div className={styles.row}>
      <label className={styles.label}>{label}</label>
      <div>
        <select
          className={styles.select}
          value={value ?? ""}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => {
            // The select is constrained to `options`, so the value is
            // always one of T. Cast at the boundary.
            onChange(e.target.value as T);
          }}
        >
          {value === undefined ? <option value="">— select —</option> : null}
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {display(opt)}
            </option>
          ))}
        </select>
        {help ? <div className={styles.help}>{help}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CheckboxField — single boolean toggle.
// ---------------------------------------------------------------------------

interface CheckboxFieldProps {
  readonly label: string;
  readonly value: boolean;
  readonly onChange: (next: boolean) => void;
}

export function CheckboxField(props: CheckboxFieldProps): ReactNode {
  const { label, value, onChange } = props;
  return (
    <div className={styles.row}>
      <label className={styles.label}>{label}</label>
      <div>
        <input
          type="checkbox"
          checked={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReadonlyField — display-only string row (no input).
// ---------------------------------------------------------------------------

interface ReadonlyFieldProps {
  readonly label: string;
  readonly value: string;
  readonly help?: string;
}

export function ReadonlyField(props: ReadonlyFieldProps): ReactNode {
  const { label, value, help } = props;
  return (
    <div className={styles.row}>
      <label className={styles.label}>{label}</label>
      <div>
        <input className={`${styles.input} ${styles.readonly}`} type="text" value={value} readOnly />
        {help ? <div className={styles.help}>{help}</div> : null}
      </div>
    </div>
  );
}
