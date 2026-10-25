import { ButtonHTMLAttributes, ReactNode, forwardRef } from 'react';
import { Severity } from '../core';

/**
 * Shared controls, so every button, toggle and status dot in the app has the
 * same shape, height and states.
 */

type ButtonVariant = 'primary' | 'secondary' | 'ghost';
type ButtonSize = 'sm' | 'md';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent)] text-[var(--accent-fg)] border border-transparent hover:opacity-90 disabled:opacity-40',
  secondary:
    'bg-[var(--bg-panel)] text-[var(--text-primary)] border border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] hover:border-[var(--border-hover)] disabled:opacity-50',
  ghost:
    'bg-transparent text-[var(--text-secondary)] border border-transparent hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-50',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-8 px-3 text-[13px] gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'sm', className = '', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    />
  );
});

export function IconButton({
  label,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`h-7 w-7 inline-flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex items-center rounded-md bg-[var(--bg-subtle)] p-0.5 text-xs"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`h-6 px-2.5 rounded-[5px] transition-colors ${
              active
                ? 'bg-[var(--bg-panel)] text-[var(--text-primary)] font-medium shadow-[0_1px_2px_rgb(0_0_0/0.12)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export const SEVERITY_SOLID: Record<Severity, string> = {
  critical: 'var(--sev-critical-border)',
  high: 'var(--sev-high-border)',
  medium: 'var(--sev-medium-border)',
  low: 'var(--sev-low-border)',
  info: 'var(--sev-info-border)',
};

export const SEVERITY_TEXT: Record<Severity, string> = {
  critical: 'var(--sev-critical-fg)',
  high: 'var(--sev-high-fg)',
  medium: 'var(--sev-medium-fg)',
  low: 'var(--sev-low-fg)',
  info: 'var(--sev-info-fg)',
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

export function SeverityDot({ severity, className = '' }: { severity: Severity; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${className}`}
      style={{ backgroundColor: SEVERITY_SOLID[severity] }}
    />
  );
}

/** Color for a 0-100 score: red below 60, amber below 75, green above. */
export function scoreColor(score: number): string {
  if (score < 60) return 'var(--sev-critical-fg)';
  if (score < 75) return 'var(--sev-medium-fg)';
  return 'var(--success-fg)';
}

export function scoreBarColor(score: number): string {
  if (score < 60) return 'var(--sev-critical-border)';
  if (score < 75) return 'var(--sev-medium-border)';
  return 'var(--success)';
}
