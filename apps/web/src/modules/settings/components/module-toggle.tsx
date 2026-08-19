'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { setModuleEnabledAction } from '@/modules/settings/actions';

/** Modul aktivieren/deaktivieren. Kernbereiche sind fix aktiviert. */
export function ModuleToggle({
  csrfToken,
  moduleId,
  moduleName,
  enabled,
  disabled = false,
}: {
  csrfToken: string;
  moduleId: string;
  moduleName: string;
  enabled: boolean;
  disabled?: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [checked, setChecked] = useState(enabled);
  const [pending, setPending] = useState(false);

  async function handleChange(next: boolean): Promise<void> {
    setPending(true);
    setChecked(next);
    const response = await setModuleEnabledAction({ csrfToken, moduleId, enabled: next });
    setPending(false);

    if (response.ok) {
      toast.success(`${moduleName} wurde ${next ? 'aktiviert' : 'deaktiviert'}.`);
      router.refresh();
    } else {
      setChecked(!next);
      toast.error(response.error.message);
    }
  }

  return (
    <Switch
      checked={checked}
      onCheckedChange={(next) => void handleChange(next)}
      disabled={disabled || pending}
      aria-label={`${moduleName} ${checked ? 'deaktivieren' : 'aktivieren'}`}
    />
  );
}
