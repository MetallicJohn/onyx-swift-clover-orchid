import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export function PppoeCredentialFields({
  username,
  password,
  onUsername,
  onPassword,
  onRegenUsername,
  onRegenPassword,
  busy,
}: {
  username: string;
  password: string;
  onUsername: (value: string) => void;
  onPassword: (value: string) => void;
  onRegenUsername?: () => void;
  onRegenPassword?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="PPPoE Username">
        <div className="flex gap-2">
          <Input
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={username}
            onChange={(e) => onUsername(e.target.value)}
            className="min-w-0 flex-1 font-mono"
          />
          {onRegenUsername ? (
            <Button type="button" variant="secondary" className="shrink-0" disabled={busy} onClick={onRegenUsername}>
              Regenerate
            </Button>
          ) : null}
        </div>
      </Field>
      <Field label="PPPoE Password">
        <div className="flex gap-2">
          <Input
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={password}
            onChange={(e) => onPassword(e.target.value)}
            className="min-w-0 flex-1 font-mono"
          />
          {onRegenPassword ? (
            <Button type="button" variant="secondary" className="shrink-0" disabled={busy} onClick={onRegenPassword}>
              Regenerate
            </Button>
          ) : null}
        </div>
      </Field>
    </div>
  );
}
