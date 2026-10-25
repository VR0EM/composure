import { ALL_RULES, CATEGORY_LABELS, CATEGORY_ORDER } from '../core';
import { Dialog } from './FixPreviewDialog';
import { Button, SEVERITY_LABELS, SeverityDot } from './primitives';

interface SettingsDialogProps {
  disabledRuleIds: ReadonlySet<string>;
  onToggleRule: (ruleId: string) => void;
  onEnableAll: () => void;
  onClose: () => void;
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl';

const SHORTCUTS: Array<[string, string]> = [
  [`${MOD} O`, 'Open a Compose file'],
  [`${MOD} S`, 'Export menu'],
  [`${MOD} F`, 'Search in the editor'],
  ['Ctrl Space', 'Autocomplete keys and values'],
  [`${MOD} Z`, 'Undo, including applied fixes'],
  [`${MOD} B`, 'Show or hide the editor'],
  [`${MOD} \\`, 'Show or hide the side panel'],
  ['Esc', 'Close dialogs, clear selection'],
];

function Heading({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between mb-2">
      <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">{children}</h3>
      {aside}
    </div>
  );
}

export function SettingsDialog({ disabledRuleIds, onToggleRule, onEnableAll, onClose }: SettingsDialogProps) {
  const enabledCount = ALL_RULES.length - disabledRuleIds.size;

  return (
    <Dialog
      title="Settings"
      onClose={onClose}
      width="max-w-xl"
      footer={
        <Button variant="primary" onClick={onClose} data-autofocus>
          Done
        </Button>
      }
    >
      <div className="px-5 py-4 space-y-6 text-[13px]">
        <section>
          <Heading
            aside={
              <span className="text-xs text-[var(--text-muted)] tabular">
                {enabledCount} of {ALL_RULES.length} on
                {disabledRuleIds.size > 0 && (
                  <button
                    type="button"
                    onClick={onEnableAll}
                    className="ml-2 underline underline-offset-2 hover:text-[var(--text-primary)]"
                  >
                    Turn all on
                  </button>
                )}
              </span>
            }
          >
            Rules
          </Heading>
          <p className="text-xs text-[var(--text-secondary)] mb-3">
            A rule that is off is skipped for every file. Saved in this browser only.
          </p>
          <div className="rounded-md border border-[var(--border-subtle)] max-h-72 overflow-y-auto">
            {CATEGORY_ORDER.map((category) => {
              const rules = ALL_RULES.filter((r) => r.category === category);
              if (rules.length === 0) return null;
              return (
                <div key={category}>
                  <div className="sticky top-0 px-3 h-8 flex items-center text-xs font-medium text-[var(--text-secondary)] bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)]">
                    {CATEGORY_LABELS[category]}
                  </div>
                  {rules.map((rule) => {
                    const enabled = !disabledRuleIds.has(rule.id);
                    return (
                      <label
                        key={rule.id}
                        className="flex items-center gap-3 px-3 py-2 border-b border-[var(--border-subtle)] last:border-b-0 cursor-pointer hover:bg-[var(--bg-elevated)]"
                      >
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={() => onToggleRule(rule.id)}
                          className="accent-[var(--accent)] w-3.5 h-3.5"
                        />
                        <span className="font-mono text-[11px] text-[var(--text-muted)] w-12 shrink-0">{rule.id}</span>
                        <span
                          className={`flex-1 min-w-0 truncate ${
                            enabled ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)] line-through'
                          }`}
                        >
                          {rule.title}
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] shrink-0">
                          <SeverityDot severity={rule.severity} />
                          {SEVERITY_LABELS[rule.severity]}
                        </span>
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <Heading>Accepting a single risk</Heading>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-2">
            To accept one finding instead of turning a rule off, put a comment above the line (or the
            service name, for the whole service). It works in the CLI too.
          </p>
          <pre className="p-3 rounded-md bg-[var(--bg-app)] border border-[var(--border-subtle)] font-mono text-xs leading-relaxed text-[var(--text-primary)] overflow-x-auto">
            {`# composure-ignore CMP002 -- Traefik reads container labels
- /var/run/docker.sock:/var/run/docker.sock:ro`}
          </pre>
        </section>

        <section>
          <Heading>Keyboard shortcuts</Heading>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            {SHORTCUTS.map(([keys, action]) => (
              <div key={keys} className="contents">
                <dt>
                  <kbd className="font-mono text-[11px] px-1.5 py-0.5 rounded border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-primary)]">
                    {keys}
                  </kbd>
                </dt>
                <dd className="text-[var(--text-secondary)] self-center">{action}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <Heading>Privacy</Heading>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            Everything runs in your browser. There is no backend, no analytics and no external requests;
            the page's security policy blocks them. Share links keep the file in the part of the URL after{' '}
            <code className="font-mono">#</code>, which browsers never send to a server.
          </p>
        </section>
      </div>
    </Dialog>
  );
}
